import 'server-only';
import crypto from 'crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { query } from './db';

const ACCESS_LOGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS access_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pathname VARCHAR(255) NOT NULL,
  visitor_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  referrer VARCHAR(512),
  user_agent VARCHAR(255),
  ip_address VARCHAR(64),
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_access_logs_createdAt (createdAt),
  INDEX idx_access_logs_path_createdAt (pathname, createdAt),
  INDEX idx_access_logs_visitor_createdAt (visitor_id, createdAt),
  INDEX idx_access_logs_session_createdAt (session_id, createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

const BLOCKED_PREFIXES = ['/api', '/_next', '/admin', '/backup', '/setup', '/login', '/register'] as const;

let ensureAccessLogsTablePromise: Promise<void> | null = null;

interface TrafficSummaryRow extends RowDataPacket {
  pageViews: number;
  uniqueVisitors: number;
  uniqueSessions: number;
}

interface TodayTrafficRow extends RowDataPacket {
  pageViews: number;
  uniqueVisitors: number;
}

interface DailyTrafficRow extends RowDataPacket {
  date: string;
  pageViews: number;
  uniqueVisitors: number;
  uniqueSessions: number;
}

interface TopPathRow extends RowDataPacket {
  pathname: string;
  pageViews: number;
  uniqueVisitors: number;
}

interface RecentLogRow extends RowDataPacket {
  id: number;
  pathname: string;
  referrer: string | null;
  visitorId: string;
  sessionId: string;
  ipAddress: string | null;
  createdAt: string;
}

export interface AccessLogInput {
  pathname: string;
  visitorId: string;
  sessionId: string;
  referrer?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface TrafficSummary {
  pageViews: number;
  uniqueVisitors: number;
  uniqueSessions: number;
  todayPageViews: number;
  todayUniqueVisitors: number;
}

export interface TrafficPoint {
  date: string;
  pageViews: number;
  uniqueVisitors: number;
  uniqueSessions: number;
}

export interface TopPathStat {
  pathname: string;
  pageViews: number;
  uniqueVisitors: number;
}

export interface RecentAccessLog {
  id: number;
  pathname: string;
  referrer: string | null;
  visitorId: string;
  sessionId: string;
  ipAddress: string | null;
  createdAt: string;
}

export interface AccessAnalyticsSnapshot {
  rangeDays: number;
  summary: TrafficSummary;
  daily: TrafficPoint[];
  topPaths: TopPathStat[];
  recentLogs: RecentAccessLog[];
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toMysqlDateTime(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(daysFromToday = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return date;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function cleanText(value: string | null | undefined, maxLength: number) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\u0000/g, '').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

function normalizeToken(value: string | null | undefined) {
  const cleaned = cleanText(value, 64);
  if (!cleaned) return null;

  const token = cleaned.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return token || null;
}

function normalizePathname(value: string | null | undefined) {
  const cleaned = cleanText(value, 255);
  if (!cleaned) return null;

  try {
    const pathname = cleaned.startsWith('http://') || cleaned.startsWith('https://')
      ? new URL(cleaned).pathname
      : cleaned;

    const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return normalized.replace(/\/+/g, '/').slice(0, 255);
  } catch {
    return null;
  }
}

function normalizeReferrer(value: string | null | undefined) {
  const cleaned = cleanText(value, 512);
  if (!cleaned) return null;

  if (cleaned.startsWith('/')) {
    return cleaned;
  }

  try {
    const url = new URL(cleaned);
    return `${url.hostname}${url.pathname}`.slice(0, 512);
  } catch {
    return cleaned;
  }
}

function maskIpAddress(value: string | null | undefined) {
  const cleaned = cleanText(value, 64);
  if (!cleaned) return null;

  const first = cleaned.split(',')[0]?.trim();
  if (!first) return null;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(first)) {
    const parts = first.split('.');
    parts[3] = 'x';
    return parts.join('.');
  }

  const hash = crypto.createHash('sha256').update(first).digest('hex').slice(0, 8);
  return `ipv6:${hash}`;
}

export function shouldTrackPathname(pathname: string) {
  if (!pathname || pathname === '/favicon.ico') return false;

  return !BLOCKED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function ensureAccessLogsTable() {
  if (!ensureAccessLogsTablePromise) {
    ensureAccessLogsTablePromise = query<ResultSetHeader>(ACCESS_LOGS_TABLE_SQL)
      .then(() => undefined)
      .catch((error) => {
        ensureAccessLogsTablePromise = null;
        throw error;
      });
  }

  await ensureAccessLogsTablePromise;
}

export async function recordAccessLog(input: AccessLogInput) {
  await ensureAccessLogsTable();

  const pathname = normalizePathname(input.pathname);
  if (!pathname || !shouldTrackPathname(pathname)) {
    return { logged: false as const, reason: 'ignored' as const };
  }

  const visitorId = normalizeToken(input.visitorId);
  const sessionId = normalizeToken(input.sessionId);
  if (!visitorId || !sessionId) {
    return { logged: false as const, reason: 'invalid-identity' as const };
  }

  const duplicateRows = await query<RowDataPacket[]>(
    `SELECT id
       FROM access_logs
      WHERE visitor_id = ?
        AND session_id = ?
        AND pathname = ?
        AND createdAt >= (NOW() - INTERVAL 15 SECOND)
      ORDER BY id DESC
      LIMIT 1`,
    [visitorId, sessionId, pathname]
  );

  if (duplicateRows.length > 0) {
    return { logged: false as const, reason: 'duplicate' as const };
  }

  await query<ResultSetHeader>(
    `INSERT INTO access_logs (pathname, visitor_id, session_id, referrer, user_agent, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      pathname,
      visitorId,
      sessionId,
      normalizeReferrer(input.referrer),
      cleanText(input.userAgent, 255),
      maskIpAddress(input.ipAddress),
    ]
  );

  return { logged: true as const };
}

export async function getAccessAnalyticsSnapshot(rangeDays = 14): Promise<AccessAnalyticsSnapshot> {
  await ensureAccessLogsTable();

  const normalizedRangeDays = Math.min(Math.max(Math.floor(rangeDays) || 14, 1), 90);
  const rangeStart = startOfDay(-(normalizedRangeDays - 1));
  const todayStart = startOfDay();
  const rangeStartValue = toMysqlDateTime(rangeStart);
  const todayStartValue = toMysqlDateTime(todayStart);

  const [summaryRows, todayRows, dailyRows, topPathRows, recentRows] = await Promise.all([
    query<TrafficSummaryRow[]>(
      `SELECT COUNT(*) AS pageViews,
              COUNT(DISTINCT visitor_id) AS uniqueVisitors,
              COUNT(DISTINCT session_id) AS uniqueSessions
         FROM access_logs
        WHERE createdAt >= ?`,
      [rangeStartValue]
    ),
    query<TodayTrafficRow[]>(
      `SELECT COUNT(*) AS pageViews,
              COUNT(DISTINCT visitor_id) AS uniqueVisitors
         FROM access_logs
        WHERE createdAt >= ?`,
      [todayStartValue]
    ),
    query<DailyTrafficRow[]>(
      `SELECT DATE_FORMAT(MIN(createdAt), '%Y-%m-%d') AS date,
              COUNT(*) AS pageViews,
              COUNT(DISTINCT visitor_id) AS uniqueVisitors,
              COUNT(DISTINCT session_id) AS uniqueSessions
         FROM access_logs
        WHERE createdAt >= ?
        GROUP BY DATE(createdAt)
        ORDER BY DATE(createdAt) ASC`,
      [rangeStartValue]
    ),
    query<TopPathRow[]>(
      `SELECT pathname,
              COUNT(*) AS pageViews,
              COUNT(DISTINCT visitor_id) AS uniqueVisitors
         FROM access_logs
        WHERE createdAt >= ?
        GROUP BY pathname
        ORDER BY pageViews DESC, uniqueVisitors DESC, pathname ASC
        LIMIT 8`,
      [rangeStartValue]
    ),
    query<RecentLogRow[]>(
      `SELECT id,
              pathname,
              referrer,
              visitor_id AS visitorId,
              session_id AS sessionId,
              ip_address AS ipAddress,
              DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS createdAt
         FROM access_logs
        ORDER BY id DESC
        LIMIT 60`
    ),
  ]);

  const dailyLookup = new Map(
    dailyRows.map((row) => [row.date, row])
  );

  const daily: TrafficPoint[] = Array.from({ length: normalizedRangeDays }, (_, index) => {
    const date = addDays(rangeStart, index);
    const key = toDateKey(date);
    const row = dailyLookup.get(key);

    return {
      date: key,
      pageViews: Number(row?.pageViews || 0),
      uniqueVisitors: Number(row?.uniqueVisitors || 0),
      uniqueSessions: Number(row?.uniqueSessions || 0),
    };
  });

  const summaryRow = summaryRows[0];
  const todayRow = todayRows[0];

  return {
    rangeDays: normalizedRangeDays,
    summary: {
      pageViews: Number(summaryRow?.pageViews || 0),
      uniqueVisitors: Number(summaryRow?.uniqueVisitors || 0),
      uniqueSessions: Number(summaryRow?.uniqueSessions || 0),
      todayPageViews: Number(todayRow?.pageViews || 0),
      todayUniqueVisitors: Number(todayRow?.uniqueVisitors || 0),
    },
    daily,
    topPaths: topPathRows.map((row) => ({
      pathname: row.pathname,
      pageViews: Number(row.pageViews || 0),
      uniqueVisitors: Number(row.uniqueVisitors || 0),
    })),
    recentLogs: recentRows.map((row) => ({
      id: Number(row.id),
      pathname: row.pathname,
      referrer: row.referrer,
      visitorId: row.visitorId,
      sessionId: row.sessionId,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt,
    })),
  };
}