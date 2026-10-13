'use strict';

// 用户域：名片广场、我的资料
const express = require('express');
const { getDb, save } = require('../store');
const config = require('../config');
const { requireAuth, publicUser, validateProfile } = require('../auth');
const { unprocessable, notFound } = require('../errors');

const router = express.Router();

// 名片广场：登录可见。联系方式默认不公开——仅本人 / 队友 / 主动开启公开的同学会随视图返回
router.get('/', (req, res) => {
  const d = getDb();
  const { skill, looking, q } = req.query;
  // 待审核/被拒绝的申请不进入名片广场
  let users = d.users.filter((u) => u.status !== 'pending' && u.status !== 'rejected');

  if (skill) users = users.filter((u) => (u.skills || []).includes(skill));
  if (looking === '1') users = users.filter((u) => u.looking_for_team);
  if (q) {
    const kw = String(q).toLowerCase();
    users = users.filter(
      (u) =>
        u.name.toLowerCase().includes(kw) ||
        String(u.student_id || '').includes(kw) ||
        (u.major || '').toLowerCase().includes(kw) ||
        (u.college || '').toLowerCase().includes(kw)
    );
  }
  // 找队中的排前面，最近注册优先
  users.sort((a, b) => (b.looking_for_team === true) - (a.looking_for_team === true) || new Date(b.created_at) - new Date(a.created_at));

  const teamNameById = Object.fromEntries(d.teams.map((t) => [t.id, t.name]));
  const memberTeam = {};
  d.team_members.forEach((m) => {
    memberTeam[m.user_id] = m.team_id;
  });

  res.json({
    data: users.slice(0, 200).map((u) => ({
      ...publicUser(u, { own: req.user ? u.id === req.user.id : false, viewer: req.user }),
      team_name: memberTeam[u.id] ? teamNameById[memberTeam[u.id]] || '' : '',
    })),
  });
});

// 单人名片（队伍页/私信跳转用）
router.get('/:id', (req, res) => {
  const d = getDb();
  const u = d.users.find((x) => x.id === req.params.id);
  if (!u || u.status === 'pending' || u.status === 'rejected') throw notFound('用户不存在');
  const member = d.team_members.find((m) => m.user_id === u.id);
  const team = member ? d.teams.find((t) => t.id === member.team_id) : null;
  res.json({
    data: {
      ...publicUser(u, { own: req.user ? u.id === req.user.id : false, viewer: req.user }),
      team_name: team ? team.name : '',
    },
  });
});

// 更新我的资料
router.put('/me', requireAuth, (req, res) => {
  const body = req.body || {};
  const d = getDb();
  const me = d.users.find((u) => u.id === req.user.id);
  if (!me) throw notFound();

  // 允许更新的字段（学号不可改）
  const patch = {};
  // 姓名未变更时不重复校验，避免历史数据里的特殊字符把资料编辑锁死
  if (body.name !== undefined && String(body.name).trim() !== String(me.name || '').trim()) patch.name = body.name;
  if (body.college !== undefined) patch.college = body.college;
  if (body.major !== undefined) patch.major = body.major;
  if (body.grade !== undefined) patch.grade = body.grade;
  if (body.contact !== undefined) patch.contact = body.contact;
  if (body.contact_visible !== undefined) patch.contact_visible = !!body.contact_visible;
  if (body.bio !== undefined) patch.bio = body.bio;
  if (body.skills !== undefined) patch.skills = body.skills;
  if (body.ai_level !== undefined) patch.ai_level = body.ai_level;
  if (body.looking_for_team !== undefined) patch.looking_for_team = body.looking_for_team;

  const { errors, out } = validateProfile(patch, { partial: true });
  if (errors.length) throw unprocessable('资料有误', errors);
  Object.assign(me, out);
  save();
  res.json({ data: publicUser(me, true) });
});

module.exports = { router };
