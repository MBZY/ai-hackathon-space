'use strict';

// 入口：Express 应用 —— API + 静态前端 + 全局错误处理
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./src-server/config');
const { AppError } = require('./src-server/errors');
const { attachUser } = require('./src-server/auth');
const authRoutes = require('./src-server/auth');
const teamsRoutes = require('./src-server/teams');
const usersRoutes = require('./src-server/users');
const messagesRoutes = require('./src-server/messages');
const notificationsRoutes = require('./src-server/notifications');
const adminRoutes = require('./src-server/admin');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // 平台反向代理后取真实客户端 IP（限速用）
app.use(express.json({ limit: '4mb' })); // 4mb：进度配图走 base64（客户端已压缩 ≤400KB/张）
app.use(attachUser);

// ---------- API ----------
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes.router);
app.use('/api/teams', teamsRoutes.router);
app.use('/api/players', usersRoutes.router);
app.use('/api/messages', messagesRoutes.router);
app.use('/api', notificationsRoutes.router); // /api/notifications、/api/announcements、/api/stats
app.use('/api/admin', adminRoutes.router);

// ---------- 静态前端 ----------
const PUBLIC_DIR = path.join(__dirname, 'public');
// 上传的进度配图（存放在 data/uploads，部署时随 data/ 同步）
app.use('/uploads', express.static(path.join(config.dataDir, 'uploads'), { maxAge: '7d' }));
// JS/CSS 走版本号（index.html 中 ?v=）可长缓存；HTML 一律 no-cache，保证部署后即时生效
app.use(
  express.static(PUBLIC_DIR, {
    index: 'index.html',
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);
// SPA hash 路由兜底：任何未匹配的 GET 返回首页
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath, { headers: { 'Cache-Control': 'no-cache' } });
  }
  res.status(404).json({ error: 'not found' });
});

// 404 API
app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }));

// ---------- 全局错误处理 ----------
app.use((err, req, res, next) => {
  if (err instanceof AppError && err.isOperational) {
    if (err.statusCode >= 500) {
      console.error(`[error] ${req.method} ${req.path}`, err.message);
    }
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  // JSON 解析错误等
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: '请求体格式错误' } });
  }
  console.error(`[error] UNEXPECTED ${req.method} ${req.path}`, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器开小差了，请稍后重试' } });
});

// ---------- 启动 ----------
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[hackathon-space] listening on :${config.port} env=${config.env}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('[hackathon-space] SIGTERM, shutting down');
  server.close(() => process.exit(0));
});

module.exports = app;
