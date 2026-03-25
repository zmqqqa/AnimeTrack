/**
 * enrich_titles.js — 第 1 步：AI 标准化番剧名称
 *
 * 用用户输入的名字询问 AI，获取：
 *   - officialTitle: 标准简体中文名
 *   - originalTitle: 原始标题（日文/英文，可能带特殊符号）
 *
 * 支持并发，默认 5 路。
 *
 * Usage:
 *   node scripts/enrich/enrich_titles.js [options]
 *
 * Options:
 *   --write           实际写入数据库（默认 dry-run）
 *   --force           也处理已有 original_title 的行
 *   --no-update-title 不覆盖中文标题，仅填充 original_title
 *   --limit=N         最多处理 N 条
 *   --ids=1,2,3       只处理指定 ID
 *   --concurrency=5   AI 并发数（默认 5）
 *   --help            显示帮助
 */

const mysql = require('mysql2/promise');
const { createDbConfig, loadDatabaseEnv } = require('../shared/db_env');

// 确保 .env.local 在读取 AI 配置之前加载
loadDatabaseEnv();

function getAiConfig() {
  return {
    apiUrl: String(process.env.AI_API_URL || '').trim() || 'https://api.deepseek.com/chat/completions',
    model: String(process.env.AI_MODEL || '').trim() || 'deepseek-chat',
    apiKey: String(process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim(),
  };
}

// ── CLI ──

function parseArgs(argv) {
  const opts = { dryRun: true, force: false, updateTitle: true, limit: undefined, ids: undefined, concurrency: 5 };
  for (const arg of argv) {
    if (arg === '--help') { printHelp(); process.exit(0); }
    if (arg === '--write') { opts.dryRun = false; continue; }
    if (arg === '--force') { opts.force = true; continue; }
    if (arg === '--no-update-title') { opts.updateTitle = false; continue; }
    if (arg.startsWith('--limit=')) { const n = Number(arg.slice(8)); if (n > 0) opts.limit = n; continue; }
    if (arg.startsWith('--concurrency=')) { const n = Number(arg.slice(14)); if (n > 0) opts.concurrency = Math.min(n, 5); continue; }
    if (arg.startsWith('--ids=')) { opts.ids = arg.slice(6).split(',').map(Number).filter(n => n > 0); continue; }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/enrich/enrich_titles.js [options]
  --write             写入数据库（默认 dry-run）
  --force             强制刷新已有 original_title 的记录
  --no-update-title   不覆盖中文标题
  --limit=N           最多处理 N 条
  --ids=1,2,3         只处理指定 ID
  --concurrency=5     AI 并发数（默认 5，上限 5）`);
}

// ── AI ──

const SYSTEM_PROMPT = '你是动漫资料整理助手，只输出 JSON，不输出解释。信息不确定时宁可留空，不要编造。';

function buildUserPrompt(title) {
  return `请识别这部动画，并返回它的标准标题信息。

用户输入的名字：${title}

返回 JSON：
{
  "officialTitle": "标准简体中文标题",
  "originalTitle": "原始标题（日文/英文，含特殊符号），不确定可留空"
}

关键规则：
1. officialTitle 必须是"具体动画条目"的标准简体中文标题，不能是漫画/轻小说/游戏名。
2. 分季、续作、剧场版、OVA 返回该具体条目的标题。
3. 有稳定通行的官方中文副标题时，优先用副标题形式（如"南家三姐妹 再来一碗"而非"南家三姐妹 第二季"）。
4. 如果用户输入含"第一季"但标准名称不含，则去掉。例如"间谍过家家第一季"→"SPY×FAMILY"对应的标准中文名。
5. originalTitle 必须是同一动画条目的原始标题（日文居多），注意保留特殊符号如 ×、★、♪ 等。不要返回漫画连载名或原作书名。
6. 不同季度是不同的条目，如"间谍过家家"和"间谍过家家 第二季"。
7. 如果完全无法识别，officialTitle 返回用户输入原文, originalTitle 返回空字符串。`;
}

async function fetchAiTitleInfo(title, aiConfig) {
  const normalized = String(title || '').trim();
  if (!normalized || !aiConfig.apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(aiConfig.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiConfig.apiKey}` },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(normalized) },
        ],
        temperature: 0.1,
        ...(process.env.AI_JSON_FORMAT !== 'false' ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`AI ${response.status}: ${detail.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;

    // 容错：从可能包含多余文字的响应中提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const payload = JSON.parse(jsonMatch[0]);
    return {
      officialTitle: typeof payload.officialTitle === 'string' ? payload.officialTitle.trim() : normalized,
      originalTitle: typeof payload.originalTitle === 'string' ? payload.originalTitle.trim() : '',
    };
  } finally {
    clearTimeout(timer);
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
  const connection = await mysql.createConnection(createDbConfig());
  const aiConfig = getAiConfig();
  if (!aiConfig.apiKey) throw new Error('需要 AI_API_KEY 或 DEEPSEEK_API_KEY');

  console.log(`\n🎬 动画标题标准化`);
  console.log(`AI: ${aiConfig.apiUrl} | model: ${aiConfig.model}`);
  console.log(`模式: ${opts.dryRun ? 'DRY-RUN（不写入）' : 'WRITE（写入数据库）'} | 并发: ${opts.concurrency} | force=${opts.force} | updateTitle=${opts.updateTitle}\n`);

  const stats = { titleChanged: 0, originalAdded: 0, bothChanged: 0, skipped: 0, noReturn: 0, errors: 0 };

  try {
    const [rows] = await connection.execute('SELECT id, title, original_title AS originalTitle FROM anime ORDER BY id ASC');
    const all = Array.isArray(rows) ? rows : [];

    let candidates = opts.ids ? all.filter(r => opts.ids.includes(r.id)) : all;
    if (!opts.force) {
      const before = candidates.length;
      candidates = candidates.filter(r => !r.originalTitle || !String(r.originalTitle).trim());
      console.log(`共 ${all.length} 条，缺少原名 ${candidates.length} 条（已有 ${before - candidates.length} 条跳过）`);
    } else {
      console.log(`共 ${all.length} 条，强制处理全部`);
    }
    if (opts.limit) candidates = candidates.slice(0, opts.limit);
    console.log(`本次处理: ${candidates.length} 条\n`);

    if (candidates.length === 0) { console.log('没有需要处理的记录。'); return; }

    const tasks = candidates.map((row, i) => async () => {
      const currentTitle = String(row.title || '').trim();
      const currentOriginal = String(row.originalTitle || '').trim();
      const label = `[${i + 1}/${candidates.length}] #${row.id}`;

      try {
        const result = await fetchAiTitleInfo(currentTitle, aiConfig);
        if (!result) {
          console.log(`  ${label} "${currentTitle}" ⚠ AI 无返回`);
          stats.noReturn++;
          return;
        }

        const titleChanged = opts.updateTitle && result.officialTitle && result.officialTitle !== currentTitle;
        const originalChanged = result.originalTitle && result.originalTitle !== currentOriginal;

        if (!titleChanged && !originalChanged) {
          // 没有原名返回，也提示一下
          if (!result.originalTitle) {
            console.log(`  ${label} "${currentTitle}" → AI 未识别出原名`);
            stats.noReturn++;
          } else {
            console.log(`  ${label} "${currentTitle}" = 无变化`);
            stats.skipped++;
          }
          return;
        }

        const updates = {};
        const parts = [];

        if (titleChanged) {
          updates.title = result.officialTitle;
          parts.push(`中文名: "${currentTitle}" → "${result.officialTitle}"`);
        }
        if (originalChanged) {
          updates.original_title = result.originalTitle;
          parts.push(`原名: "${currentOriginal || '(空)'}" → "${result.originalTitle}"`);
        }

        const tag = opts.dryRun ? '[dry-run]' : '[写入]';
        console.log(`  ${label} ✓ ${tag} ${parts.join(' | ')}`);

        if (!opts.dryRun) {
          const sets = Object.keys(updates).map(c => `${c} = ?`);
          sets.push('updatedAt = NOW()');
          await connection.execute(`UPDATE anime SET ${sets.join(', ')} WHERE id = ?`, [...Object.values(updates), row.id]);
        }

        if (titleChanged && originalChanged) stats.bothChanged++;
        else if (titleChanged) stats.titleChanged++;
        else stats.originalAdded++;
      } catch (err) {
        stats.errors++;
        console.error(`  ${label} ✗ 错误: ${err?.message || err}`);
      }
    });

    await runConcurrent(tasks, opts.concurrency);

    // 汇总
    const total = stats.titleChanged + stats.originalAdded + stats.bothChanged;
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`完成: 变更=${total} (仅中文名=${stats.titleChanged}, 仅原名=${stats.originalAdded}, 两者=${stats.bothChanged})`);
    console.log(`      无变化=${stats.skipped}, 未识别=${stats.noReturn}, 错误=${stats.errors}`);
  } finally {
    await connection.end();
  }
}

main().catch(err => { console.error(err?.message || err); process.exit(1); });
