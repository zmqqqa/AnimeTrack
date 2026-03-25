// 导航菜单项配置
export type NavigationSection = '主馆区' | '分析馆' | '管理区';

export interface NavigationItem {
  label: string;
  href: string;
  description: string;
  section: NavigationSection;
  adminOnly?: boolean;
}

export const navigationItems: NavigationItem[] = [
  {
    label: '总览',
    href: '/',
    description: '私藏番剧总览',
    section: '主馆区',
  },
  {
    label: '番剧列表',
    href: '/anime',
    description: '片库与进度管理',
    section: '主馆区',
  },
  {
    label: '时间轴',
    href: '/anime/timeline',
    description: '观看记录回放',
    section: '主馆区',
  },
  {
    label: '图谱馆',
    href: '/anime/atlas',
    description: '制作与标签分布',
    section: '分析馆',
  },
  {
    label: '档期簿',
    href: '/anime/seasons',
    description: '首播档期与完结状态',
    section: '分析馆',
  },
  {
    label: '数据管理',
    href: '/admin',
    description: '历史记录管理与维护',
    section: '管理区',
    adminOnly: true,
  },
];

export const config = {
  appName: '动漫记录',
  version: 'v1.0.0',
  startDate: 'Since 2026',
};
