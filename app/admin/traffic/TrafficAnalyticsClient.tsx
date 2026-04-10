"use client";

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { ArrowPathIcon, ChartBarSquareIcon, EyeIcon, SignalIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { DonutChart } from '@/components/dashboard/DonutChart';
import { fetchJson } from '@/lib/client-api';

const TrafficTrendChart = dynamic(
  () => import('@/components/dashboard/TrafficTrendChart').then((mod) => mod.TrafficTrendChart),
  {
    ssr: false,
    loading: () => <div className="h-[320px] w-full rounded-[28px] surface-card-muted skeleton-shimmer" />,
  }
);

const RANGE_OPTIONS = [7, 14, 30] as const;
const PATH_COLORS = ['#56d39c', '#5dd6f2', '#f4bf62', '#8da6ff', '#fb7185', '#34d399', '#f97316', '#c084fc'] as const;

interface TrafficSummary {
  pageViews: number;
  uniqueVisitors: number;
  uniqueSessions: number;
  todayPageViews: number;
  todayUniqueVisitors: number;
}

interface TrafficPoint {
  date: string;
  pageViews: number;
  uniqueVisitors: number;
  uniqueSessions: number;
}

interface TopPathStat {
  pathname: string;
  pageViews: number;
  uniqueVisitors: number;
}

interface RecentAccessLog {
  id: number;
  pathname: string;
  referrer: string | null;
  visitorId: string;
  sessionId: string;
  ipAddress: string | null;
  createdAt: string;
}

interface AccessAnalyticsSnapshot {
  rangeDays: number;
  summary: TrafficSummary;
  daily: TrafficPoint[];
  topPaths: TopPathStat[];
  recentLogs: RecentAccessLog[];
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number) {
  if (value <= 0) return '0%';
  if (value < 0.01) return '<1%';
  return `${Math.round(value * 100)}%`;
}

function formatPath(pathname: string) {
  return pathname === '/' ? '首页 /' : pathname;
}

function formatReferrer(referrer: string | null) {
  if (!referrer) return '直接访问';
  return referrer.startsWith('/') ? referrer : `外部来源 ${referrer}`;
}

function formatDateLabel(date: string) {
  const [, month, day] = date.split('-');
  return `${month}-${day}`;
}

function formatDateTime(value: string) {
  return new Date(value.replace(' ', 'T')).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatToken(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function getReferrerType(referrer: string | null) {
  if (!referrer) return '直接';
  return referrer.startsWith('/') ? '站内' : '外部';
}

function getReferrerTone(referrer: string | null) {
  if (!referrer) return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100/90';
  if (referrer.startsWith('/')) return 'border-sky-400/20 bg-sky-400/10 text-sky-100/90';
  return 'border-amber-400/20 bg-amber-400/10 text-amber-100/90';
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<React.ComponentProps<'svg'>>;
  color: string;
}) {
  return (
    <div className="glass-panel rounded-[28px] px-5 py-5 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05),transparent_42%)] pointer-events-none" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">{label}</div>
          <div className="mt-2 text-3xl font-mono text-zinc-50">{value}</div>
          <div className="mt-2 text-sm text-zinc-500">{hint}</div>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border bg-current/10 ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function InsightCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <div className="surface-card rounded-[28px] px-5 py-5">
      <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.26em] ${tone}`}>
        {label}
      </div>
      <div className="mt-4 text-2xl font-mono text-zinc-50">{value}</div>
      <div className="mt-2 text-sm leading-6 text-zinc-500">{hint}</div>
    </div>
  );
}

export default function TrafficAnalyticsClient() {
  const [rangeDays, setRangeDays] = useState<number>(14);
  const [data, setData] = useState<AccessAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const fetchTraffic = useCallback(async (days: number, silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await fetchJson<AccessAnalyticsSnapshot>(`/api/admin/traffic?days=${days}`, undefined, '加载访问分析失败');
      setData(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载访问分析失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchTraffic(rangeDays);
  }, [fetchTraffic, rangeDays]);

  const topPathsDisplay = useMemo(
    () => (data?.topPaths || []).slice(0, 5),
    [data]
  );

  const topPathChartData = useMemo(() => (
    topPathsDisplay.map((item, index) => ({
      label: formatPath(item.pathname),
      value: item.pageViews,
      color: PATH_COLORS[index % PATH_COLORS.length],
    }))
  ), [topPathsDisplay]);

  const topPathTotal = useMemo(
    () => topPathChartData.reduce((sum, item) => sum + item.value, 0),
    [topPathChartData]
  );

  const insights = useMemo(() => {
    const currentRange = data?.rangeDays ?? rangeDays;
    const summary = data?.summary;
    const daily = data?.daily || [];
    const activeDays = daily.filter((item) => item.pageViews > 0 || item.uniqueVisitors > 0).length;
    const quietDays = Math.max(currentRange - activeDays, 0);
    const nonZeroDays = daily.filter((item) => item.pageViews > 0 || item.uniqueVisitors > 0 || item.uniqueSessions > 0);
    const peakDay = nonZeroDays.reduce<TrafficPoint | null>((best, item) => {
      if (!best) return item;
      if (item.pageViews > best.pageViews) return item;
      if (item.pageViews === best.pageViews && item.uniqueVisitors > best.uniqueVisitors) return item;
      return best;
    }, null);

    return {
      activeDays,
      quietDays,
      peakDay,
      averageViews: summary ? summary.pageViews / Math.max(currentRange, 1) : 0,
      viewsPerVisitor: summary?.uniqueVisitors ? summary.pageViews / summary.uniqueVisitors : 0,
      peakShare: summary?.pageViews && peakDay ? peakDay.pageViews / summary.pageViews : 0,
      topPathCoverage: summary?.pageViews ? topPathTotal / summary.pageViews : 0,
      lastLog: data?.recentLogs?.[0] ?? null,
      rangeDays: currentRange,
    };
  }, [data, rangeDays, topPathTotal]);

  const hasData = Boolean(data && (data.summary.pageViews > 0 || data.recentLogs.length > 0));
  const hasTrendData = Boolean(data?.daily.some((item) => item.pageViews > 0 || item.uniqueVisitors > 0));

  return (
    <main className="p-4 md:p-8 space-y-6 animate-fade-in pb-20">
      <section className="glass-panel-strong rounded-[36px] p-7 md:p-8 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,rgba(86,211,156,0.14),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(93,214,242,0.1),transparent_28%)]" />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-emerald-100/80">
              访问观察台
            </div>
            <div>
              <h1 className="text-3xl font-display tracking-tight text-zinc-50">网站访问分析</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                这里会记录公开页面的访问轨迹，方便你看最近有多少访问量、多少独立访客，以及大家最常看的页面。
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <div className="surface-card-muted flex w-fit gap-1 rounded-2xl p-1">
              {RANGE_OPTIONS.map((option) => {
                const active = rangeDays === option;

                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => startTransition(() => setRangeDays(option))}
                    className={`rounded-xl px-3 py-2 text-sm transition-colors ${active ? 'bg-emerald-400/14 text-emerald-100 border border-emerald-300/20' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200 border border-transparent'}`}
                    disabled={loading || isPending}
                  >
                    最近 {option} 天
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => void fetchTraffic(rangeDays, true)}
              className="surface-pill inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm text-zinc-200 hover:text-zinc-50 disabled:opacity-60"
              disabled={loading || refreshing}
            >
              <ArrowPathIcon className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? '刷新中...' : '刷新数据'}
            </button>
          </div>
        </div>

        <div className="relative mt-6 flex flex-wrap gap-4 text-xs text-zinc-500">
          <span>统计窗口: 最近 {data?.rangeDays ?? rangeDays} 天</span>
          <span>会话数: {formatNumber(data?.summary.uniqueSessions || 0)}</span>
          {insights.lastLog ? <span>最近记录: {formatDateTime(insights.lastLog.createdAt)} · {formatPath(insights.lastLog.pathname)}</span> : null}
          <span>仅统计公开页面，不包含后台和接口请求</span>
        </div>
      </section>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="glass-panel h-32 rounded-[28px] skeleton-shimmer" />
          ))}
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={`最近 ${data?.rangeDays ?? rangeDays} 天访问量`}
            value={formatNumber(data?.summary.pageViews || 0)}
            hint="累计页面浏览次数"
            icon={EyeIcon}
            color="text-emerald-300 border-emerald-300/20"
          />
          <StatCard
            label={`最近 ${data?.rangeDays ?? rangeDays} 天访客`}
            value={formatNumber(data?.summary.uniqueVisitors || 0)}
            hint="按浏览器访客 ID 去重"
            icon={UserGroupIcon}
            color="text-sky-300 border-sky-300/20"
          />
          <StatCard
            label="今日访问量"
            value={formatNumber(data?.summary.todayPageViews || 0)}
            hint="当天累计访问次数"
            icon={SignalIcon}
            color="text-amber-300 border-amber-300/20"
          />
          <StatCard
            label="今日访客"
            value={formatNumber(data?.summary.todayUniqueVisitors || 0)}
            hint="当天独立访问人数"
            icon={ChartBarSquareIcon}
            color="text-violet-300 border-violet-300/20"
          />
        </section>
      )}

      {!loading ? (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <InsightCard
            label="峰值日"
            value={insights.peakDay ? `${formatNumber(insights.peakDay.pageViews)} 次` : '暂无'}
            hint={insights.peakDay ? `${formatDateLabel(insights.peakDay.date)} · 占窗口访问 ${formatPercent(insights.peakShare)}` : '最近窗口内还没有形成明显的访问峰值'}
            tone="border-emerald-400/20 bg-emerald-400/10 text-emerald-100/90"
          />
          <InsightCard
            label="活跃天数"
            value={`${formatNumber(insights.activeDays)}/${formatNumber(insights.rangeDays)}`}
            hint={insights.activeDays > 0 ? `有访问的日期占 ${formatPercent(insights.activeDays / Math.max(insights.rangeDays, 1))}，静默 ${formatNumber(insights.quietDays)} 天` : '当前窗口内还没有采集到公开页面访问'}
            tone="border-sky-400/20 bg-sky-400/10 text-sky-100/90"
          />
          <InsightCard
            label="日均访问"
            value={formatDecimal(insights.averageViews)}
            hint={`按最近 ${formatNumber(insights.rangeDays)} 天平均计算的页面浏览次数`}
            tone="border-amber-400/20 bg-amber-400/10 text-amber-100/90"
          />
          <InsightCard
            label="访客深度"
            value={formatDecimal(insights.viewsPerVisitor)}
            hint={data?.summary.uniqueVisitors ? `平均每位访客浏览页数 · 共 ${formatNumber(data.summary.uniqueSessions)} 个会话` : '有访客数据后，这里会显示平均浏览深度'}
            tone="border-violet-400/20 bg-violet-400/10 text-violet-100/90"
          />
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="glass-panel rounded-[32px] p-6 lg:p-7 xl:col-span-8 overflow-visible">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-display text-zinc-100">访问趋势</h2>
              <p className="mt-1 text-sm text-zinc-500">按天看页面访问量和独立访客变化</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="rounded-full border border-white/8 px-3 py-1 text-[11px] text-zinc-500">
                共 {data?.daily.length || 0} 天
              </div>
              {insights.peakDay ? (
                <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] text-emerald-100/85">
                  峰值 {formatDateLabel(insights.peakDay.date)} · {formatNumber(insights.peakDay.pageViews)}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-5">
            {hasTrendData ? (
              <TrafficTrendChart data={data?.daily || []} />
            ) : (
              <div className="rounded-[28px] border border-dashed border-white/10 bg-white/[0.02] px-5 py-14 text-center text-sm text-zinc-500">
                当前窗口内还没有足够的访问数据，趋势图会在采集到公开页面访问后自动出现。
              </div>
            )}
          </div>
        </div>

        <div className="glass-panel rounded-[32px] p-6 lg:p-7 xl:col-span-4">
          <div>
            <h2 className="text-lg font-display text-zinc-100">热门页面</h2>
            <p className="mt-1 text-sm text-zinc-500">最近窗口内访问最多的公开页面，TOP 5 覆盖 {formatPercent(insights.topPathCoverage)}</p>
          </div>

          {topPathChartData.length > 0 ? (
            <div className="mt-6 space-y-5">
              <div className="flex items-center justify-center">
                <div className="relative flex h-44 w-44 items-center justify-center">
                  <DonutChart data={topPathChartData} size={176} strokeWidth={16} />
                  <div className="absolute text-center">
                    <div className="text-3xl font-mono text-zinc-100">{formatNumber(topPathTotal)}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.28em] text-zinc-500">TOP 5 访问</div>
                    <div className="mt-1 text-[11px] text-zinc-500">覆盖 {formatPercent(insights.topPathCoverage)}</div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {topPathsDisplay.map((item, index) => {
                  const share = data?.summary.pageViews ? item.pageViews / data.summary.pageViews : 0;

                  return (
                    <div key={item.pathname} className="surface-card-muted rounded-[24px] px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.26em] text-zinc-500">
                            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PATH_COLORS[index % PATH_COLORS.length] }} />
                            TOP {index + 1}
                          </div>
                          <div className="mt-2 truncate text-sm font-medium text-zinc-100" title={item.pathname}>
                            {formatPath(item.pathname)}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">{item.uniqueVisitors} 位访客访问过</div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-mono text-zinc-50">{formatNumber(item.pageViews)}</div>
                          <div className="text-[10px] uppercase tracking-[0.24em] text-zinc-600">浏览</div>
                        </div>
                      </div>
                      <div className="mt-3 h-1.5 rounded-full bg-white/[0.04]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${share > 0 ? Math.max(share * 100, 8) : 0}%`,
                            backgroundColor: PATH_COLORS[index % PATH_COLORS.length],
                          }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
                        <span>占窗口访问 {formatPercent(share)}</span>
                        <span>{formatNumber(item.uniqueVisitors)} 位访客</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-[28px] border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-center text-sm text-zinc-500">
              还没有访问数据，先打开首页或番剧列表逛一圈，统计就会开始出现。
            </div>
          )}
        </div>
      </section>

      <section className="glass-panel rounded-[32px] p-6 lg:p-7 overflow-hidden">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-display text-zinc-100">最近访问日志</h2>
            <p className="mt-1 text-sm text-zinc-500">保留最近 60 条访问记录，方便排查谁在看哪些页面。</p>
          </div>
          <div className="text-xs text-zinc-500">
            {hasData ? `已记录 ${formatNumber(data?.summary.pageViews || 0)} 次访问` : '暂时还没有访问日志'}
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-white/5 text-left text-sm text-zinc-400">
                <th className="px-4 py-3 font-medium">时间</th>
                <th className="px-4 py-3 font-medium">页面</th>
                <th className="px-4 py-3 font-medium">来源</th>
                <th className="px-4 py-3 font-medium">访客</th>
                <th className="px-4 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recentLogs || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-zinc-500">
                    暂无访问日志
                  </td>
                </tr>
              ) : (
                (data?.recentLogs || []).map((log) => (
                  <tr key={log.id} className="border-b border-white/[0.03] text-sm text-zinc-300 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-400">{formatDateTime(log.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-100">{formatPath(log.pathname)}</div>
                      <div className="mt-1 text-[11px] text-zinc-600">{formatDateLabel(log.createdAt.slice(0, 10))}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] ${getReferrerTone(log.referrer)}`}>
                        {getReferrerType(log.referrer)}
                      </div>
                      <div className="mt-2 text-zinc-400">{log.referrer ? formatReferrer(log.referrer) : '无来源页'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-zinc-300">{formatToken(log.visitorId)}</div>
                      <div className="mt-1 font-mono text-[11px] text-zinc-600">会话 {formatToken(log.sessionId)}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{log.ipAddress || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 text-xs leading-6 text-zinc-500">
          独立访客基于浏览器本地生成的访客 ID 统计，同一人更换设备或清理浏览器存储后，会被视为新的访客。
        </div>
      </section>
    </main>
  );
}