'use strict';

const path = require('path');

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  env: process.env.NODE_ENV || 'production',
  session: {
    cookieName: 'hk_session',
    ttlMs: 7 * 24 * 3600 * 1000,
  },
  team: {
    minSize: 1,
    maxSize: 5,
  },
  // 管理员学号白名单（对应活动组织架构：总负责人 + 赛务 + 技术保障）
  adminStudentIds: (process.env.ADMIN_IDS || '202440025279')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  event: {
    teamBuildingEnd: new Date('2026-10-16T22:00:00+08:00'),
    midtermEnd: new Date('2026-10-24T14:00:00+08:00'),
    submitEnd: new Date('2026-10-30T22:00:00+08:00'),
    showcaseDate: '2026-10-31',
  },
  // 报名模式：'survey' = 问卷报名制（自助注册关闭，名单由赛务组从腾讯问卷导入）；
  //           'open'   = 开放自助注册（早期模式，保留可切回）
  registration: {
    mode: process.env.REG_MODE || 'survey',
    surveyTitle: '2026 秋季 AI 黑客松报名问卷',
    surveyUrl: process.env.SURVEY_URL || 'https://wj.qq.com/s2/28096194/w0pm',
    initialPasswordHint: '初始密码为学号后 6 位',
  },
  tracks: [
    { key: 'web', name: '网站与应用开发', dept: '技术部' },
    { key: 'game', name: '游戏开发', dept: '椰风游戏开发组' },
    { key: 'media', name: '新媒体与智能体', dept: '信宣部' },
    { key: 'open', name: '综合赛道', dept: '跨部门协同' },
  ],
  // 技能选项与报名问卷（腾讯问卷 28096194）保持一致，便于名单导入与筛选
  skills: ['前端开发', '后端开发', '游戏开发', 'AI / 算法', 'UI / 设计', '产品 / 策划', '新媒体运营', '暂无经验，想学习'],
  aiLevels: ['零基础', '入门', '熟练'],
  teamRoles: ['产品', '前端', '后端', '美术', '策划', '宣发', '测试'],
};

if (!Number.isFinite(config.port) || config.port <= 0) {
  throw new Error('Invalid PORT');
}

module.exports = config;
