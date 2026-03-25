/**
 * enrich_metadata.js — 第 2 步：用准确标题批量补充元数据
 *
 * 依赖 enrich_titles.js 先把 title / original_title 标准化。
 * 用准确的名称查 Bangumi + Jikan API，再用 AI 补缺。
 *
 * 补充字段: score, totalEpisodes, durationMinutes, summary, tags,
 *           premiereDate, coverUrl, isFinished
 *
 * 支持并发，默认 3 路（受 API rate limit 约束）。
 *
 * Usage:
 *   node scripts/enrich/enrich_metadata.js [options]
 *
 * Options:
 *   --write           写入数据库（默认 dry-run）
 *   --force           刷新已有字段
 *   --fields=a,b      只补充指定字段
 *   --no-ai           跳过 AI，仅用 Bangumi/Jikan API
 *   --ai-only         跳过 API，仅用 AI
 *   --limit=N         最多处理 N 条
 *   --ids=1,2,3       只处理指定 ID
 *   --concurrency=3   并发数（默认 3）
 *   --help            显示帮助
 */

const path = require('path');
const mysql = require('mysql2/promise');
const { createDbConfig, loadDatabaseEnv, projectRoot } = require('../shared/db_env');

// 确保 .env.local 在 AI 模块 require 之前加载
loadDatabaseEnv();

// 复用 lib 内的 provider-source 和 merge-policy（避免代码重复）
const providerSource = require(path.join(projectRoot, 'lib/metadata/provider-source.js'));
const mergePolicy = require(path.join(projectRoot, 'lib/metadata/merge-policy.js'));
const aiSource = require(path.join(projectRoot, 'lib/metadata/ai-metadata-source.js'));

const { fetchAnimeMetadataByQueriesDetailed } = providerSource;
const { DEFAULT_METADATA_FIELDS, applyMetadataPatch, buildMetadataCandidate } = mergePolicy;
const { fetchAiAnimeMetadata, getAiApiKey } = aiSource;

// ── CLI ──

const ALL_FIELDS = ['score', 'totalEpisodes', 'durationMinutes', 'summary', 'tags', 'premiereDate', 'coverUrl', 'isFinished', 'originalTitle'];

function parseArgs(argv) {
  const opts = { dryRun: true, force: false, fields: undefined, noAi: false, aiOnly: false, limit: undefined, ids: undefined, concurrency: 3 };
  for (const arg of argv) {
    if (arg === '--help') { printHelp(); process.exit(0); }
    if (arg === '--write') { opts.dryRun = false; continue; }
    if (arg === '--force') { opts.force = true; continue; }
    if (arg === '--no-ai') { opts.noAi = true; continue; }
    if (arg === '--ai-only') { opts.aiOnly = true; continue; }
    if (arg.startsWith('--fields=')) { opts.fields = arg.slice(9).split(',').map(s => s.trim()).filter(Boolean); continue; }
    if (arg.startsWith('--limit=')) { const n = Number(arg.slice(8)); if (n > 0) opts.limit = n; continue; }
    if (arg.startsWith('--concurrency=')) { const n = Number(arg.slice(14)); if (n > 0) opts.concurrency = Math.min(n, 5); continue; }
    if (arg.startsWith('--ids=')) { opts.ids = arg.slice(6).split(',').map(Number).filter(n => n > 0); continue; }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/enrich/enrich_metadata.js [options]
  --write             写入数据库（默认 dry-run）
  --force             强制刷新已有字段
  --fields=a,b        只补充指定字段（${ALL_FIELDS.join(', ')}）
  --no-ai             仅用 Bangumi/Jikan API，跳过 AI
  --ai-only           仅用 AI，跳过 API
  --limit=N           最多处理 N 条
  --ids=1,2,3         只处理指定 ID
  --concurrency=3     并发数（默认 3，上限 5）`);
}

// ── 辅助 ──

function parseJsonSafe(value) {
  if (!value || typeof value !== 'string') return [];
  try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; }
}

function isMissing(field, value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && !value.trim()) return true;
  if (field === 'tags' || field === 'cast' || field === 'castAliases') {
    const arr = Array.isArray(value) ? value : parseJsonSafe(value);
    return arr.length === 0;
  }
  if (field === 'score' || field === 'totalEpisodes' || field === 'durationMinutes') {
    return !Number.isFinite(Number(value)) || Number(value) <= 0;
  }
  return false;
}

function buildCurrentRecord(row) {
  return {
    title: row.title,
    originalTitle: row.original_title || undefined,
    coverUrl: row.coverUrl || undefined,
    status: row.status,
    score: row.score ? Number(row.score) : undefined,
    progress: row.progress || 0,
    totalEpisodes: row.totalEpisodes || undefined,
    durationMinutes: row.durationMinutes || undefined,
    notes: row.notes || undefined,
    tags: parseJsonSafe(row.tags),
    cast: parseJsonSafe(row.cast),
    castAliases: parseJsonSafe(row.cast_aliases),
    summary: row.summary || undefined,
    startDate: row.start_date || undefined,
    endDate: row.end_date || undefined,
    premiereDate: row.premiere_date || undefined,
    isFinished: row.isFinished != null ? Boolean(row.isFinished) : undefined,
  };
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

// ── 单条处理 ──

async function processAnime(row, opts, apiKey, connection) {
  const current = buildCurrentRecord(row);
  const fields = opts.fields || DEFAULT_METADATA_FIELDS;
  const label = `#${row.id} "${row.title}"`;

  // 检查是否需要处理
  if (!opts.force) {
    const needsWork = fields.some(f => isMissing(f, current[f]));
    if (!needsWork) return { status: 'skip', label };
  }

  const queries = [current.originalTitle, current.title].filter(Boolean);
  let providerCandidate = null;
  let aiCandidate = null;

  // 查 Bangumi + Jikan API
  if (!opts.aiOnly) {
    try {
      const result = await fetchAnimeMetadataByQueriesDetailed(queries);
      if (result?.metadata) providerCandidate = result.metadata;
    } catch (err) {
      console.error(`  ${label} provider 错误: ${err?.message}`);
    }
  }

  // 查 AI
  if (!opts.noAi && apiKey) {
    try {
      const queryName = current.originalTitle || current.title;
      aiCandidate = await fetchAiAnimeMetadata(queryName, apiKey);
    } catch (err) {
      console.error(`  ${label} AI 错误: ${err?.message}`);
    }
  }

  if (!providerCandidate && !aiCandidate) return { status: 'no-data', label };

  // 合并
  const merged = buildMetadataCandidate(providerCandidate, aiCandidate);
  const { patch, sources } = applyMetadataPatch(current, merged, {
    fields,
    force: opts.force,
    allowReplaceFilledCover: opts.force,
    allowCastAliasAugment: true,
    allowIsFinishedUpgrade: true,
  });

  const patchKeys = Object.keys(patch).filter(k => k !== 'title');
  if (patchKeys.length === 0) return { status: 'no-change', label };

  // 构造 SQL
  const dbFieldMap = {
    originalTitle: 'original_title', coverUrl: 'coverUrl', score: 'score',
    totalEpisodes: 'totalEpisodes', durationMinutes: 'durationMinutes',
    summary: 'summary', tags: 'tags', premiereDate: 'premiere_date',
    cast: 'cast', castAliases: 'cast_aliases', isFinished: 'isFinished',
  };

  const sets = [];
  const params = [];
  for (const key of patchKeys) {
    const dbCol = dbFieldMap[key];
    if (!dbCol) continue;
    let val = patch[key];
    if (Array.isArray(val)) val = JSON.stringify(val);
    if (typeof val === 'boolean') val = val ? 1 : 0;
    sets.push(`${dbCol} = ?`);
    params.push(val);
  }

  if (sets.length === 0) return { status: 'no-change', label };

  const desc = patchKeys.map(k => `${k}=${sources[k] || '?'}`).join(', ');

  if (opts.dryRun) {
    console.log(`  ${label} [dry-run] ${desc}`);
    return { status: 'would-update', label };
  }

  sets.push('updatedAt = NOW()');
  params.push(row.id);
  await connection.execute(`UPDATE anime SET ${sets.join(', ')} WHERE id = ?`, params);
  console.log(`  ${label} [写入] ${desc}`);
  return { status: 'updated', label };
}

// ── 主函数 ──

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = opts.noAi ? null : getAiApiKey();

  if (!opts.noAi && !apiKey) {
    console.warn('⚠️  未设置 AI_API_KEY，仅使用 Bangumi/Jikan API');
    opts.noAi = true;
  }

  const connection = await mysql.createConnection(createDbConfig());

  try {
    const [rows] = await connection.execute(`
      SELECT id, title, original_title, coverUrl, status, score, progress,
             totalEpisodes, durationMinutes, notes, tags, summary,
             start_date, end_date, premiere_date, cast, cast_aliases, isFinished
      FROM anime ORDER BY updatedAt DESC
    `);
    const all = Array.isArray(rows) ? rows : [];

    let candidates = opts.ids ? all.filter(r => opts.ids.includes(r.id)) : all;
    if (opts.limit) candidates = candidates.slice(0, opts.limit);

    console.log(`共 ${all.length} 条，将处理 ${candidates.length} 条`);
    console.log(`模式: ${opts.dryRun ? 'dry-run' : 'WRITE'} | 并发: ${opts.concurrency} | AI: ${opts.noAi ? '关' : '开'} | force=${opts.force}`);
    if (opts.fields) console.log(`字段: ${opts.fields.join(', ')}`);
    console.log('');

    const stats = { updated: 0, skip: 0, noData: 0, noChange: 0, error: 0 };

    const tasks = candidates.map((row, i) => async () => {
      try {
        const result = await processAnime(row, opts, apiKey, connection);
        if (result.status === 'skip') stats.skip++;
        else if (result.status === 'no-data') { stats.noData++; console.log(`  ${result.label} → 无数据源`); }
        else if (result.status === 'no-change') stats.noChange++;
        else stats.updated++;
      } catch (err) {
        stats.error++;
        console.error(`  #${row.id} [错误] ${err?.message || err}`);
      }
    });

    await runConcurrent(tasks, opts.concurrency);

    console.log(`\n完成: 更新=${stats.updated}, 无变化=${stats.noChange}, 跳过=${stats.skip}, 无数据=${stats.noData}, 错误=${stats.error}`);
  } finally {
    await connection.end();
  }
}

main().catch(err => { console.error(err?.message || err); process.exit(1); });
