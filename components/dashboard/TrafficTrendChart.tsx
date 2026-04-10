"use client";

import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import ReactECharts from 'echarts-for-react';

interface TrafficTrendPoint {
  date: string;
  pageViews: number;
  uniqueVisitors: number;
  uniqueSessions: number;
}

interface TrafficTrendChartProps {
  data: TrafficTrendPoint[];
  height?: number;
}

function formatLabel(date: string) {
  return date.slice(5);
}

function formatCount(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function TrafficTrendChart({ data, height = 320 }: TrafficTrendChartProps) {
  const maxValue = useMemo(
    () => Math.max(0, ...data.flatMap((item) => [item.pageViews, item.uniqueVisitors, item.uniqueSessions])),
    [data]
  );

  const labelInterval = data.length > 24 ? 3 : data.length > 14 ? 1 : 0;
  const showSymbols = data.length <= 20 || maxValue <= 8;

  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 450,
    legend: {
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: {
        color: '#a1a1aa',
        fontSize: 11,
        fontFamily: 'var(--font-body), sans-serif',
      },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'line',
        lineStyle: {
          color: 'rgba(148,163,184,0.26)',
          width: 1,
        },
      },
      backgroundColor: 'rgba(8, 14, 13, 0.96)',
      borderColor: 'rgba(255,255,255,0.12)',
      borderWidth: 1,
      textStyle: {
        color: '#eef9ff',
        fontSize: 12,
        fontFamily: 'var(--font-body), sans-serif',
      },
      extraCssText: 'box-shadow: 0 18px 40px rgba(0,0,0,0.35); border-radius: 14px; padding: 10px 12px;',
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as Array<{ seriesName: string; value: number; color: string; axisValueLabel: string; dataIndex: number }>;
        const point = data[items[0]?.dataIndex ?? -1];
        const rows = items.map((item) => `
          <div style="display:flex; justify-content:space-between; gap:18px; margin-top:4px;">
            <span style="display:flex; align-items:center; gap:8px; color:#cbd5e1;">
              <span style="width:8px; height:8px; border-radius:999px; background:${item.color}; display:inline-block;"></span>
              ${item.seriesName}
            </span>
            <strong style="color:#f8fafc; font-weight:600;">${formatCount(Number(item.value || 0))}</strong>
          </div>
        `).join('');

        const sessionRow = point ? `
          <div style="display:flex; justify-content:space-between; gap:18px; margin-top:6px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.08);">
            <span style="display:flex; align-items:center; gap:8px; color:#94a3b8;">会话数</span>
            <strong style="color:#e2e8f0; font-weight:600;">${formatCount(point.uniqueSessions)}</strong>
          </div>
        ` : '';

        return `
          <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#94a3b8;">访问趋势</div>
          <div style="margin-top:6px; color:#f8fafc; font-size:14px;">${items[0]?.axisValueLabel || ''}</div>
          ${rows}
          ${sessionRow}
        `;
      },
    },
    grid: {
      top: 48,
      right: 12,
      bottom: 26,
      left: 10,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: data.map((item) => formatLabel(item.date)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: '#71717a',
        fontSize: 10,
        margin: 12,
        interval: labelInterval,
      },
    },
    yAxis: {
      type: 'value',
      min: 0,
      minInterval: 1,
      splitNumber: maxValue <= 4 ? Math.max(maxValue, 1) : 4,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: '#71717a',
        fontSize: 10,
        formatter: (value: string | number) => formatCount(Number(value)),
      },
      splitLine: {
        lineStyle: {
          color: 'rgba(255,255,255,0.05)',
          type: 'dashed',
        },
      },
    },
    series: [
      {
        name: '访问量',
        type: 'line',
        smooth: false,
        showSymbol: showSymbols,
        symbol: 'circle',
        symbolSize: 7,
        emphasis: {
          focus: 'series',
        },
        lineStyle: {
          width: 3,
          color: '#56d39c',
        },
        itemStyle: {
          color: '#56d39c',
          borderColor: '#07110f',
          borderWidth: 2,
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(86, 211, 156, 0.28)' },
              { offset: 1, color: 'rgba(86, 211, 156, 0.03)' },
            ],
          },
        },
        data: data.map((item) => item.pageViews),
      },
      {
        name: '独立访客',
        type: 'line',
        smooth: false,
        showSymbol: showSymbols,
        symbol: 'circle',
        symbolSize: 6,
        emphasis: {
          focus: 'series',
        },
        lineStyle: {
          width: 2,
          color: '#5dd6f2',
          type: 'dashed',
        },
        itemStyle: {
          color: '#5dd6f2',
          borderColor: '#07110f',
          borderWidth: 2,
        },
        data: data.map((item) => item.uniqueVisitors),
      },
    ],
  }), [data, labelInterval, maxValue, showSymbols]);

  return <ReactECharts option={option} style={{ height, width: '100%' }} opts={{ renderer: 'svg' }} />;
}