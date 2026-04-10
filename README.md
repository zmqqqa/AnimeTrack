# AnimeTrack

一个自用的动漫记录站，用来整理看过、在看和想看的动画，也会顺手记录进度、时间线和一些元数据。

在线预览：https://anime.zmqaa.com/

## 主要功能

- 记录观看状态、集数进度和历史
- 查看时间线、季度视图和简单统计
- 管理封面、简介、标签、声优、首播日期等资料
- 用 AI 辅助补全标题和元数据

## 快速开始

需要 Node.js 20+ 和 MySQL。

```bash
git clone https://github.com/zmqqqa/AnimeTrack.git
cd AnimeTrack
npm install
cp .env.example .env.local
# 编辑 .env.local，填上 MySQL 密码
npm run dev
```

然后浏览器打开 `http://localhost:3000/setup`，点一键初始化，再用 `guest / guest` 登录即可。


## 说明

- 这是一个长期自用项目，公开仓库以展示和浏览为主
- 线上站点主要用于我自己的追番记录和整理

## 技术栈

Next.js 14 / React 18 / TypeScript / Tailwind CSS / MySQL / NextAuth.js
