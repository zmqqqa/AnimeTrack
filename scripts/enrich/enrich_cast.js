/**
 * enrich_cast.js — 第 3 步：补充声优信息 + 中文别名
 *
 * 用准确的 original_title / title 查 Bangumi + Jikan API 获取声优列表，
 * 然后用 AI 生成中文别名。
 *
 * 支持并发，默认 3 路。
 *
 * Usage:
 *   node scripts/enrich/enrich_cast.js [options]
 *
 * Options:
 *   --write           写入数据库（默认 dry-run）
 *   --force           刷新已有 cast 的记录
 *   --limit=N         最多处理 N 条
 *   --ids=1,2,3       只处理指定 ID
 *   --concurrency=3   并发数（默认 3）
 *   --no-aliases      跳过 AI 别名生成，仅获取声优名单
 *   --help            显示帮助
 */

const path = require('path');
const mysql = require('mysql2/promise');
const { createDbConfig, loadDatabaseEnv, projectRoot } = require('../shared/db_env');

// 确保 .env.local 在 AI 配置读取之前加载
loadDatabaseEnv();

const providerSource = require(path.join(projectRoot, 'lib/metadata/provider-source.js'));
const { fetchAnimeMetadataByQueriesDetailed } = providerSource;

const AI_API_URL = String(process.env.AI_API_URL || '').trim() || 'https://api.deepseek.com/chat/completions';
const AI_MODEL = String(process.env.AI_MODEL || '').trim() || 'deepseek-chat';

function getApiKey() {
  return String(process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim();
}

// ── CLI ──

function parseArgs(argv) {
  const opts = { dryRun: true, force: false, limit: undefined, ids: undefined, concurrency: 3, noAliases: false };
  for (const arg of argv) {
    if (arg === '--help') { printHelp(); process.exit(0); }
    if (arg === '--write') { opts.dryRun = false; continue; }
    if (arg === '--force') { opts.force = true; continue; }
    if (arg === '--no-aliases') { opts.noAliases = true; continue; }
    if (arg.startsWith('--limit=')) { const n = Number(arg.slice(8)); if (n > 0) opts.limit = n; continue; }
    if (arg.startsWith('--concurrency=')) { const n = Number(arg.slice(14)); if (n > 0) opts.concurrency = Math.min(n, 5); continue; }
    if (arg.startsWith('--ids=')) { opts.ids = arg.slice(6).split(',').map(Number).filter(n => n > 0); continue; }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/enrich/enrich_cast.js [options]
  --write             写入数据库（默认 dry-run）
  --force             强制刷新已有 cast
  --limit=N           最多处理 N 条
  --ids=1,2,3         只处理指定 ID
  --concurrency=3     并发数（默认 3，上限 5）
  --no-aliases        跳过 AI 中文别名生成`);
}

// ── 辅助 ──

function parseJsonSafe(value) {
  if (!value || typeof value !== 'string') return [];
  try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; }
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter(v => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s || seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

// ── AI 别名生成 ──

async function generateChineseAliases(castNames, apiKey) {
  if (!castNames.length || !apiKey) return castNames;

  const response = await fetch(AI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: '你是动漫声优资料助手，只输出 JSON，不输出解释。' },
        {
          role: 'user',
          content: `以下是一组声优名字（可能是日文、英文或罗马音），请为每个名字提供简体中文常用译名。

声优列表：${JSON.stringify(castNames)}

返回 JSON：
{
  "aliases": ["中文译名1", "中文译名2", ...]
}

规则：
1. 保持顺序，与输入列表一一对应
2. 如果输入已经是中文，原样返回
3. 如果不确定中文译名，返回原名
4. 姓在前，名在后（日式顺序）`,
        },
      ],
      temperature: 0.1,
      ...(process.env.AI_JSON_FORMAT !== 'false' ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!response.ok) return castNames;

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return castNames;

  try {
    const payload = JSON.parse(content);
    const aliases = Array.isArray(payload.aliases) ? payload.aliases : [];
    return uniqueStrings([...castNames, ...aliases.map(a => typeof a === 'string' ? a.trim() : '').filter(Boolean)]);
  } catch {
    return castNames;
  }
}

// ── 并发控制 ──

async function runConcurrent(tasks, concurrency) {
  const results = new Array(tasks.length);
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

// ── 主函数 ──

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = opts.noAliases ? null : getApiKey();

  if (!opts.noAliases && !apiKey) {
    console.warn('⚠️  未设置 AI_API_KEY，跳过中文别名生成');
    opts.noAliases = true;
  }

  const connection = await mysql.createConnection(createDbConfig());

  try {
    const [rows] = await connection.execute(
      'SELECT id, title, original_title, cast, cast_aliases FROM anime ORDER BY updatedAt DESC'
    );
    const all = Array.isArray(rows) ? rows : [];

    let candidates = opts.ids ? all.filter(r => opts.ids.includes(r.id)) : all;
    if (!opts.force) candidates = candidates.filter(r => parseJsonSafe(r.cast).length === 0);
    if (opts.limit) candidates = candidates.slice(0, opts.limit);

    console.log(`共 ${all.length} 条，将处理 ${candidates.length} 条（缺 cast）`);
    console.log(`模式: ${opts.dryRun ? 'dry-run' : 'WRITE'} | 并发: ${opts.concurrency} | 别名: ${opts.noAliases ? '关' : '开'}\n`);

    if (candidates.length === 0) { console.log('没有需要处理的记录。'); return; }

    const stats = { updated: 0, skip: 0, error: 0 };

    const tasks = candidates.map((row, i) => async () => {
      const label = `[${i + 1}/${candidates.length}] #${row.id} "${row.title}"`;
      const queries = [row.original_title, row.title].filter(Boolean);
      if (queries.length === 0) { stats.skip++; return; }

      try {
        const result = await fetchAnimeMetadataByQueriesDetailed(queries);
        const providerCast = result?.metadata?.cast;

        if (!Array.isArray(providerCast) || providerCast.length === 0) {
          console.log(`  ${label} → 未找到声优信息`);
          stats.skip++;
          return;
        }

        let castAliases = [...providerCast];
        if (!opts.noAliases) {
          try {
            castAliases = await generateChineseAliases(providerCast, apiKey);
          } catch (err) {
            console.error(`  ${label} 别名生成失败: ${err?.message}`);
            castAliases = providerCast;
          }
        }

        const existingAliases = parseJsonSafe(row.cast_aliases);
        const mergedAliases = uniqueStrings([...castAliases, ...existingAliases]);

        if (opts.dryRun) {
          console.log(`  ${label} [dry-run] cast=${providerCast.length}人, aliases=${mergedAliases.length}个`);
          stats.updated++;
          return;
        }

        await connection.execute(
          'UPDATE anime SET cast = ?, cast_aliases = ?, updatedAt = NOW() WHERE id = ?',
          [JSON.stringify(providerCast), JSON.stringify(mergedAliases), row.id]
        );
        console.log(`  ${label} [写入] cast=${providerCast.length}人, aliases=${mergedAliases.length}个`);
        stats.updated++;
      } catch (err) {
        stats.error++;
        console.error(`  ${label} [错误] ${err?.message || err}`);
      }
    });

    await runConcurrent(tasks, opts.concurrency);

    console.log(`\n完成: 更新=${stats.updated}, 跳过=${stats.skip}, 错误=${stats.error}`);
  } finally {
    await connection.end();
  }
}

main().catch(err => { console.error(err?.message || err); process.exit(1); });
