'use strict';

// 消息域：1v1 私信
const express = require('express');
const { getDb, save, uid, teamIdOf } = require('../store');
const { requireAuth } = require('../auth');
const { badRequest, notFound } = require('../errors');

const router = express.Router();

function convKey(a, b) {
  return [a, b].sort().join('~');
}

// 会话列表（最近联系人 + 最后一条 + 未读数）
router.get('/conversations', requireAuth, (req, res) => {
  const d = getDb();
  const me = req.user.id;
  const related = d.messages.filter((m) => m.from_id === me || m.to_id === me);
  const byPeer = {};
  related.forEach((m) => {
    const peer = m.from_id === me ? m.to_id : m.from_id;
    if (!byPeer[peer]) byPeer[peer] = { peer, last: m, unread: 0 };
    if (new Date(m.created_at) > new Date(byPeer[peer].last.created_at)) byPeer[peer].last = m;
    if (m.to_id === me && !m.is_read) byPeer[peer].unread += 1;
  });
  const list = Object.values(byPeer)
    .sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at))
    .slice(0, 50)
    .map((c) => {
      const peer = d.users.find((u) => u.id === c.peer);
      return {
        peer_id: c.peer,
        peer_name: peer?.name || '未知用户',
        last_content: c.last.content.slice(0, 60),
        last_at: c.last.created_at,
        unread: c.unread,
      };
    });
  res.json({ data: { list, total_unread: list.reduce((s, c) => s + c.unread, 0) } });
});

// 与某人的消息（进入会话即标记已读）
router.get('/:peerId', requireAuth, (req, res) => {
  const d = getDb();
  const me = req.user.id;
  const peerId = req.params.peerId;
  if (me === peerId) throw badRequest('不能查看与自己的会话');
  const peer = d.users.find((u) => u.id === peerId);
  if (!peer) throw notFound('用户不存在');

  const msgs = d.messages
    .filter((m) => (m.from_id === me && m.to_id === peerId) || (m.from_id === peerId && m.to_id === me))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(-100);

  // 标记对方发来的未读为已读
  let changed = false;
  d.messages.forEach((m) => {
    if (m.from_id === peerId && m.to_id === me && !m.is_read) {
      m.is_read = true;
      changed = true;
    }
  });
  if (changed) save();

  res.json({
    data: {
      messages: msgs,
      peer: { id: peer.id, name: peer.name, contact: peer.contact || '', major: peer.major, team_id: teamIdOf(d, peer.id) },
    },
  });
});

// 发送消息
router.post('/', requireAuth, (req, res) => {
  const content = String((req.body || {}).content || '').trim();
  const toId = String((req.body || {}).to_id || '');
  if (!content) throw badRequest('消息不能为空');
  if (content.length > 500) throw badRequest('消息过长（≤500 字）');
  if (toId === req.user.id) throw badRequest('不能给自己发消息');
  const d = getDb();
  const to = d.users.find((u) => u.id === toId);
  if (!to) throw notFound('用户不存在');

  const msg = {
    id: uid('msg'),
    from_id: req.user.id,
    to_id: toId,
    content,
    is_read: false,
    created_at: new Date().toISOString(),
  };
  d.messages.push(msg);
  save();
  res.status(201).json({ data: msg });
});

module.exports = { router };
