/**
 * enrich_premiere_dates.js — 专门补充开播日期
 *
 * 流程：
 *   1. 查 Bangumi API（用 original_title 或 title）
 *   2. 查 Jikan/MAL API
 *   3. 以上都没拿到 → 查 AI
 *
 * 控制台详细输出每部动漫查到的日期和来源。
 *
 * Usage:
 *   node scripts/enrich/enrich_premiere_dates.js [options]
 *
 * Options:
 *   --write           写入数据库（默认 dry-run）
 *   --force           也处理已有日期的记录
 *   --limit=N         最多处理 N 条
 *   --ids=1,2,3       只处理指定 ID
 *   --concurrency=3   并发数（默认 3，上限 5）
 *   --no-ai           跳过 AI
 *   --ai-only         跳过 Provider API，仅用 AI
 *   --help            显示帮助
 */

const path = require('path');
const mysql = require('mysql2/promise');
const { createDbConfig, loadDatabaseEnv, projectRoot } = require('../shared/db_env');

// 确保 .env.local 在 AI 模块 require 之前加载
loadDatabaseEnv();

const FETCH_TIMEOUT_MS = 10000;
const AI_API_URL = String(process.env.AI_API_URL || '').trim() || 'https://api.deepseek.com/chat/completions';
const AI_MODEL = String(process.env.AI_MODEL || '').trim() || 'deepseek-chat';

function getApiKey() {
  return String(process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim();
}

// ── CLI ──

function parseArgs(argv) {
  const opts = { dryRun: true, force: false, limit: undefined, ids: undefined, concurrency: 3, noAi: false, aiOnly: false };
  for (const arg of argv) {
    if (arg === '--help') { printHelp(); process.exit(0); }
    if (arg === '--write') { opts.dryRun = false; continue; }
    if (arg === '--force') { opts.force = true; continue; }
    if (arg === '--no-ai') { opts.noAi = true; continue; }
    if (arg === '--ai-only') { opts.aiOnly = true; continue; }
    if (arg.startsWith('--limit=')) { const n = Number(arg.slice(8)); if (n > 0) opts.limit = n; continue; }
    if (arg.startsWith('--concurrency=')) { const n = Number(arg.slice(14)); if (n > 0) opts.concurrency = Math.min(n, 5); continue; }
    if (arg.startsWith('--ids=')) { opts.ids = arg.slice(6).split(',').map(Number).filter(n => n > 0); continue; }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/enrich/enrich_premiere_dates.js [options]
  --write             写入数据库（默认 dry-run）
  --force             也处理已有日期的记录
  --limit=N           最多处理 N 条
  --ids=1,2,3         只处理指定 ID
  --concurrency=3     并发数（默认 3，上限 5）
  --no-ai             跳过 AI
  --ai-only           跳过 Provider API，仅用 AI`);
}

// ── 工具函数 ──

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function normalizeDate(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ── 标题相似度检查 ──

/** 去除标点、空格、大小写、季度表述差异后做对比 */
function normalizeTitleForMatch(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[\s\-_:：·・'"`~!！?？,，.。()/\\\[\]【】♪♫★×☆]/g, '')
    .replace(/第([一二三四五六七八九十]+)季/g, (_, cn) => {
      const map = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' };
      return `s${map[cn] || cn}`;
    })
    .replace(/第(\d+)季/g, 's$1')
    .replace(/season\s*(\d+)/gi, 's$1')
    .trim();
}

/**
 * 计算两个标题的相似度 (0-100)
 * 完全相同 = 100, 互相包含根据比例给分, 无关 = 0
 */
function titleSimilarity(queryTitle, candidateTitle) {
  const a = normalizeTitleForMatch(queryTitle);
  const b = normalizeTitleForMatch(candidateTitle);
  if (!a || !b) return 0;
  if (a === b) return 100;

  // 互相包含
  if (b.includes(a) || a.includes(b)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return Math.round(60 + (shorter / longer) * 40);
  }

  // 公共前缀
  let common = 0;
  const minLen = Math.min(a.length, b.length);
  while (common < minLen && a[common] === b[common]) common++;

  if (common >= Math.min(4, minLen)) {
    return Math.round((common / Math.max(a.length, b.length)) * 80);
  }

  return 0;
}

/** 从搜索结果中挑选最佳匹配，低于阈值返回 null */
function pickBestMatch(list, queries, titleExtractor, minScore = 50) {
  let bestItem = null;
  let bestScore = 0;
  let bestTitle = '';

  for (const item of list) {
    const titles = titleExtractor(item);
    for (const query of queries) {
      for (const t of titles) {
        const score = titleSimilarity(query, t);
        if (score > bestScore) {
          bestScore = score;
          bestItem = item;
          bestTitle = t;
        }
      }
    }
  }

  if (bestScore < minScore) return null;
  return { item: bestItem, score: bestScore, matchedTitle: bestTitle };
}

// ── Bangumi API ──

async function searchBangumiPremiereDate(queries) {
  // 逐个 query 搜索，找到第一个合格结果就返回
  for (const query of queries) {
    const url = `https://api.bgm.tv/search/subject/${encodeURIComponent(query)}?type=2&responseGroup=large&max_results=10`;
    let resp;
    try {
      resp = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'PersonalAnimeTracker/1.0', Accept: 'application/json' },
      });
    } catch { continue; }
    if (!resp.ok) continue;

    const data = await resp.json();
    const list = Array.isArray(data?.list) ? data.list : [];
    if (list.length === 0) continue;

    const match = pickBestMatch(list, queries, item => [
      item.name || '', item.name_cn || '',
    ].filter(Boolean));

    if (match) {
      const date = normalizeDate(match.item.air_date);
      if (date) return { date, source: 'bangumi', matchedTitle: match.matchedTitle, score: match.score };
    }
  }
  return null;
}

// ── Jikan/MAL API ──

async function searchJikanPremiereDate(queries) {
  for (const query of queries) {
    const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=10&sfw=true`;
    let resp;
    try {
      resp = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
    } catch { continue; }
    if (!resp.ok) continue;

    const data = await resp.json();
    const list = Array.isArray(data?.data) ? data.data : [];
    if (list.length === 0) continue;

    const match = pickBestMatch(list, queries, item => [
      item.title || '',
      item.title_japanese || '',
      item.title_english || '',
      ...(Array.isArray(item.title_synonyms) ? item.title_synonyms : []),
      ...(Array.isArray(item.titles) ? item.titles.map(e => e?.title || '') : []),
    ].filter(Boolean));

    if (match) {
      const aired = match.item?.aired?.from;
      const date = normalizeDate(aired);
      if (date) return { date, source: 'jikan', matchedTitle: match.matchedTitle, score: match.score };
    }
  }
  return null;
}

// ── AI 查询 ──

async function askAiPremiereDate(title, apiKey) {
  const useJsonFormat = process.env.AI_JSON_FORMAT !== 'false';
  const resp = await fetchWithTimeout(AI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: '你是动漫资料助手，只输出 JSON，不输出任何解释文字。' },
        { role: 'user', content: `请告诉我这部动画的首播日期（第一集播出日）。

动画名称：${title}

返回 JSON 格式：
{
  "premiereDate": "YYYY-MM-DD",
  "confidence": 0.9
}

规则：
1. premiereDate 是该动画第一集首播的日期，格式必须是 YYYY-MM-DD
2. 如果是续作/第二季等，返回该季的首播日期，不是第一季的
3. confidence 是你对日期准确性的把握（0-1），低于 0.6 则 premiereDate 返回 null
4. 完全不确定就返回 {"premiereDate": null, "confidence": 0}` },
      ],
      temperature: 0.1,
      ...(useJsonFormat ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`AI ${resp.status}: ${detail.slice(0, 150)}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;

  // 从可能包含多余文字的响应中提取 JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const payload = JSON.parse(jsonMatch[0]);
  const confidence = typeof payload.confidence === 'number' ? payload.confidence : 0;
  if (confidence < 0.6) return null;

  const date = normalizeDate(payload.premiereDate);
  if (date) return { date, source: 'ai', confidence };
  return null;
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

async function processAnime(row, opts, apiKey) {
  const title = String(row.title || '').trim();
  const originalTitle = String(row.original_title || '').trim();
  const currentDate = row.premiere_date ? normalizeDate(String(row.premiere_date)) : null;
  const label = `#${row.id} "${title}"`;
  // 搜索查询列表：原名优先，中文名兜底
  const queries = [originalTitle, title].filter(Boolean);
  const displaySearch = originalTitle || title;

  // 已有日期且非强制 → 跳过
  if (currentDate && !opts.force) {
    return { status: 'skip', label, currentDate };
  }

  let result = null;

  // 1. Bangumi（传入所有 queries，内部按相似度挑最佳匹配）
  if (!opts.aiOnly && !result) {
    try {
      result = await searchBangumiPremiereDate(queries);
    } catch (err) {
      console.log(`  ${label} ⚠ Bangumi 错误: ${err?.message?.slice(0, 80)}`);
    }
  }

  // 2. Jikan
  if (!opts.aiOnly && !result) {
    try {
      result = await searchJikanPremiereDate(queries);
    } catch (err) {
      console.log(`  ${label} ⚠ Jikan 错误: ${err?.message?.slice(0, 80)}`);
    }
  }

  // 3. AI
  if (!opts.noAi && !result && apiKey) {
    try {
      result = await askAiPremiereDate(displaySearch, apiKey);
    } catch (err) {
      console.log(`  ${label} ⚠ AI 错误: ${err?.message?.slice(0, 80)}`);
    }
  }

  if (!result) {
    console.log(`  ${label} ✗ 未找到日期 (搜索: ${displaySearch})`);
    return { status: 'no-data', label };
  }

  // 与现有日期相同 → 无变化
  if (currentDate === result.date) {
    console.log(`  ${label} = ${result.date} (${result.source}) 与现有相同`);
    return { status: 'no-change', label };
  }

  const changeDesc = currentDate
    ? `${currentDate} → ${result.date}`
    : `null → ${result.date}`;

  const sourceDetail = result.source === 'ai'
    ? `ai (confidence: ${result.confidence})`
    : `${result.source} (匹配: ${result.matchedTitle}, 相似度: ${result.score})`;

  return { status: 'update', label, date: result.date, changeDesc, sourceDetail, id: row.id };
}

// ── 主函数 ──

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = opts.noAi ? null : getApiKey();

  if (!opts.noAi && !apiKey) {
    console.warn('⚠️  未设置 AI_API_KEY，AI 补充将跳过');
    opts.noAi = true;
  }

  console.log(`\n🎬 开播日期批量补充`);
  console.log(`AI: ${AI_API_URL} | model: ${AI_MODEL}`);
  console.log(`模式: ${opts.dryRun ? 'DRY-RUN（不写入）' : 'WRITE（写入数据库）'} | 并发: ${opts.concurrency} | force=${opts.force} | AI: ${opts.noAi ? '关' : '开'}\n`);

  const connection = await mysql.createConnection(createDbConfig());

  try {
    const [rows] = await connection.execute(`
      SELECT id, title, original_title, premiere_date, status
      FROM anime ORDER BY id ASC
    `);
    const all = Array.isArray(rows) ? rows : [];

    let candidates = opts.ids ? all.filter(r => opts.ids.includes(r.id)) : all;
    if (!opts.force) {
      const before = candidates.length;
      candidates = candidates.filter(r => !r.premiere_date);
      console.log(`共 ${all.length} 条，缺少日期 ${candidates.length} 条（已有 ${before - candidates.length} 条跳过）`);
    } else {
      console.log(`共 ${all.length} 条，强制处理全部`);
    }
    if (opts.limit) candidates = candidates.slice(0, opts.limit);
    console.log(`本次处理: ${candidates.length} 条\n`);

    if (candidates.length === 0) { console.log('没有需要处理的记录。'); return; }

    const stats = { updated: 0, noData: 0, noChange: 0, skip: 0, error: 0 };
    const updates = [];

    const tasks = candidates.map((row) => async () => {
      try {
        const result = await processAnime(row, opts, apiKey);
        if (result.status === 'skip') { stats.skip++; return; }
        if (result.status === 'no-data') { stats.noData++; return; }
        if (result.status === 'no-change') { stats.noChange++; return; }
        if (result.status === 'update') {
          stats.updated++;
          updates.push(result);
          const tag = opts.dryRun ? '[dry-run]' : '[写入]';
          console.log(`  ${result.label} ✓ ${tag} ${result.changeDesc} ← ${result.sourceDetail}`);
        }
      } catch (err) {
        stats.error++;
        console.error(`  #${row.id} ✗ 错误: ${err?.message || err}`);
      }
    });

    await runConcurrent(tasks, opts.concurrency);

    // 批量写入
    if (!opts.dryRun && updates.length > 0) {
      for (const u of updates) {
        await connection.execute(
          'UPDATE anime SET premiere_date = ?, updatedAt = NOW() WHERE id = ?',
          [u.date, u.id]
        );
      }
    }

    // 汇总
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`完成: 更新=${stats.updated}, 无变化=${stats.noChange}, 未找到=${stats.noData}, 错误=${stats.error}`);

    if (updates.length > 0) {
      console.log(`\n📋 更新明细:`);
      const bySource = { bangumi: 0, jikan: 0, ai: 0 };
      for (const u of updates) {
        const src = u.sourceDetail.split(' ')[0];
        bySource[src] = (bySource[src] || 0) + 1;
      }
      console.log(`  来源统计: Bangumi=${bySource.bangumi || 0}, Jikan=${bySource.jikan || 0}, AI=${bySource.ai || 0}`);
    }
  } finally {
    await connection.end();
  }
}

main().catch(err => { console.error(err?.message || err); process.exit(1); });
