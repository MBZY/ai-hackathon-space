'use strict';

// 通知域 + 公告域 + 公开统计
const express = require('express');
const { getDb, save, uid } = require('../store');
const config = require('../config');
const { requireAuth, requireAdmin } = require('../auth');
const { badRequest, notFound } = require('../errors');

const router = express.Router();

// ---------- 通知（本 router 挂载于 /api）----------
router.get('/notifications', requireAuth, (req, res) => {
  const d = getDb();
  const list = d.notifications
    .filter((n) => n.user_id === req.user.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 50);
  res.json({ data: { list, unread: list.filter((n) => !n.is_read).length } });
});

router.post('/notifications/read-all', requireAuth, (req, res) => {
  const d = getDb();
  let changed = false;
  d.notifications.forEach((n) => {
    if (n.user_id === req.user.id && !n.is_read) {
      n.is_read = true;
      changed = true;
    }
  });
  if (changed) save();
  res.json({ data: { ok: true } });
});

// ---------- 公告 ----------
router.get('/announcements', (req, res) => {
  const d = getDb();
  const list = [...d.announcements]
    .sort((a, b) => (b.is_pinned - a.is_pinned) || (new Date(b.created_at) - new Date(a.created_at)))
    .slice(0, 20);
  res.json({ data: list });
});

router.post('/announcements', requireAdmin, (req, res) => {
  const title = String((req.body || {}).title || '').trim().slice(0, 60);
  const content = String((req.body || {}).content || '').trim().slice(0, 1000);
  const is_pinned = !!(req.body || {}).is_pinned;
  if (!title || !content) throw badRequest('标题和内容不能为空');
  const d = getDb();
  const item = {
    id: uid('a'),
    title,
    content,
    is_pinned,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  d.announcements.push(item);
  // 全员通知
  d.users.forEach((u) =>
    d.notifications.push({
      id: uid('n'),
      user_id: u.id,
      type: 'announcement',
      title: `公告：${title}`,
      content: content.slice(0, 80),
      link: '#/',
      is_read: false,
      created_at: new Date().toISOString(),
    })
  );
  save();
  res.status(201).json({ data: item });
});

router.put('/announcements/:id', requireAdmin, (req, res) => {
  const d = getDb();
  const item = d.announcements.find((a) => a.id === req.params.id);
  if (!item) throw notFound('公告不存在');
  const body = req.body || {};
  if (body.title !== undefined) item.title = String(body.title).trim().slice(0, 60);
  if (body.content !== undefined) item.content = String(body.content).trim().slice(0, 1000);
  if (body.is_pinned !== undefined) item.is_pinned = !!body.is_pinned;
  item.updated_at = new Date().toISOString();
  save();
  res.json({ data: item });
});

router.delete('/announcements/:id', requireAdmin, (req, res) => {
  const d = getDb();
  const idx = d.announcements.findIndex((a) => a.id === req.params.id);
  if (idx === -1) throw notFound('公告不存在');
  d.announcements.splice(idx, 1);
  save();
  res.json({ data: { ok: true } });
});

// ---------- 全站进度动态（瀑布流页）----------
router.get('/progress/recent', (req, res) => {
  const d = getDb();
  const limit = Math.min(parseInt(req.query.limit || '80', 10) || 80, 300);
  const teamName = Object.fromEntries(d.teams.map((t) => [t.id, t.name]));
  const userName = Object.fromEntries(d.users.map((u) => [u.id, u.name]));
  const list = [...d.progress_logs]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      team_id: p.team_id,
      team_name: teamName[p.team_id] || '未知队伍',
      stage: p.stage,
      content: p.content,
      images: p.images || [],
      author_name: userName[p.author_id] || '队员',
      created_at: p.created_at,
    }));
  res.json({ data: list });
});

// ---------- 公开统计（首页快报）----------
router.get('/stats', (req, res) => {
  const d = getDb();
  const activeUsers = d.users.filter((u) => u.status !== 'pending' && u.status !== 'rejected');
  const locked = d.teams.filter((t) => t.status === 'locked').length;
  const trackCount = {};
  config.tracks.forEach((t) => {
    trackCount[t.key] = d.teams.filter((x) => x.track === t.key).length;
  });
  res.json({
    data: {
      users: activeUsers.length,
      teams: d.teams.length,
      locked_teams: locked,
      looking: activeUsers.filter((u) => u.looking_for_team).length,
      tracks: trackCount,
      messages: d.messages.length,
      // 报名模式（前端注册页/首页引导用）
      registration: {
        mode: config.registration.mode,
        survey_title: config.registration.surveyTitle,
        survey_url: config.registration.surveyUrl,
        initial_password_hint: config.registration.initialPasswordHint,
      },
    },
  });
});

module.exports = { router };
