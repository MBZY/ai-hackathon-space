'use strict';

// 队伍域：广场、建队、详情、申请/邀请、成员管理、锁定、进度日志
const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDb, save, uid, teamIdOf } = require('../store');
const config = require('../config');
const { requireAuth, publicUser } = require('../auth');
const { badRequest, forbidden, notFound, conflict, unprocessable } = require('../errors');

const router = express.Router();

// ---------- 工具 ----------
// 进度配图：dataURL → 落盘 data/uploads，日志内保存 /uploads/xx 路径
function saveProgressImage(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw unprocessable('配图格式不支持（仅 JPEG / PNG / WebP）');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw unprocessable('配图内容为空');
  if (buf.length > 420 * 1024) throw unprocessable('单张配图不能超过约 400KB，请重试');
  const ext = m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg';
  const dir = path.join(config.dataDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const name = uid('img') + '.' + ext;
  fs.writeFileSync(path.join(dir, name), buf);
  return '/uploads/' + name;
}
function nowTeamStatus(team) {
  // 10/16 22:00 后所有 recruiting/full 队伍视为 locked（延迟生效，不强制改库）
  if (team.status === 'locked' || team.status === 'submitted') return team.status;
  if (Date.now() >= config.event.teamBuildingEnd.getTime()) return 'locked';
  return team.status;
}

function activeMembers(d, teamId) {
  return d.team_members.filter((m) => m.team_id === teamId);
}

function findTeam(d, id) {
  const team = d.teams.find((t) => t.id === id);
  if (!team) throw notFound('队伍不存在');
  return team;
}

function notify(d, userId, type, title, content, link) {
  d.notifications.push({
    id: uid('n'),
    user_id: userId,
    type,
    title,
    content: content || '',
    link: link || '',
    is_read: false,
    created_at: new Date().toISOString(),
  });
}

// 一人一队：某用户加入/创建队伍后，其余待处理申请/邀请自动失效（申请类通知对应队长，避免空追）
function expireOtherPendings(d, userId, keepId) {
  const now = new Date().toISOString();
  const name = d.users.find((u) => u.id === userId)?.name || '对方';
  d.invites
    .filter((i) => i.status === 'pending' && i.user_id === userId && i.id !== keepId)
    .forEach((i) => {
      i.status = 'expired';
      i.updated_at = now;
      const t = d.teams.find((x) => x.id === i.team_id);
      if (t) {
        notify(
          d,
          t.captain_id,
          'apply_expired',
          `${name} 已加入其他队伍`,
          `与「${t.name}」的${i.direction === 'apply' ? '申请' : '邀请'}已自动关闭`,
          `#/team/${t.id}/manage`
        );
      }
    });
}

function trackName(key) {
  return config.tracks.find((t) => t.key === key)?.name || key;
}

// 队伍公开视图。includeContact：仅登录用户可见队伍联系方式（防爬虫）
// viewer：登录者对象，用于「队友互见个人联系方式」判定
function teamView(d, team, { includeContact = false, withMembers = false, viewer = null } = {}) {
  const members = activeMembers(d, team.id);
  const out = {
    id: team.id,
    name: team.name,
    track: team.track,
    track_name: trackName(team.track),
    topic_title: team.topic_title,
    topic_brief: team.topic_brief,
    need_skills: team.need_skills || [],
    status: nowTeamStatus(team),
    member_count: members.length,
    max_size: config.team.maxSize,
    captain_id: team.captain_id,
    created_at: team.created_at,
    locked_at: team.locked_at || null,
  };
  if (includeContact) out.contact = team.contact || '';
  if (withMembers) {
    out.members = members.map((m) => {
      const u = d.users.find((x) => x.id === m.user_id);
      return {
        user_id: m.user_id,
        role_in_team: m.role_in_team,
        joined_at: m.joined_at,
        is_captain: m.user_id === team.captain_id,
        user: u ? publicUser(u, { viewer }) : null,
      };
    });
  }
  return out;
}

// ---------- 公开接口 ----------
// 注意：具体路径路由必须先于 /:id 系列注册，否则会被参数路由吞掉

// 我的申请/邀请记录
router.get('/invites/mine', requireAuth, (req, res) => {
  const d = getDb();
  const list = d.invites
    .filter((i) => i.user_id === req.user.id || d.teams.find((t) => t.id === i.team_id)?.captain_id === req.user.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 100)
    .map((i) => ({
      ...i,
      team_name: d.teams.find((t) => t.id === i.team_id)?.name || '',
      user_name: d.users.find((u) => u.id === i.user_id)?.name || '',
    }));
  res.json({ data: list });
});

// 队伍广场
router.get('/', (req, res) => {
  const d = getDb();
  const { track, status, skill, sort } = req.query;
  let teams = [...d.teams];

  // 延迟锁定落库（仅在实际发生变更时写盘）
  const past = Date.now() >= config.event.teamBuildingEnd.getTime();
  if (past) {
    let changed = false;
    teams.forEach((t) => {
      if (t.status === 'recruiting' || t.status === 'full') {
        t.status = 'locked';
        t.locked_at = t.locked_at || new Date().toISOString();
        changed = true;
      }
    });
    if (changed) save();
  }

  if (track) teams = teams.filter((t) => t.track === track);
  if (status) teams = teams.filter((t) => nowTeamStatus(t) === status);
  if (skill) teams = teams.filter((t) => (t.need_skills || []).includes(skill));
  if (sort === 'members') teams.sort((a, b) => activeMembers(d, a.id).length - activeMembers(d, b.id).length);
  else teams.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({ data: teams.map((t) => teamView(d, t, { includeContact: !!req.user })) });
});

router.get('/:id', (req, res) => {
  const d = getDb();
  const team = findTeam(d, req.params.id);
  const view = teamView(d, team, { includeContact: !!req.user, withMembers: true, viewer: req.user });
  view.project = (d.projects || []).find((p) => p.team_id === team.id) || null;
  view.progress = d.progress_logs
    .filter((p) => p.team_id === team.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 50)
    .map((p) => ({ ...p, author_name: d.users.find((u) => u.id === p.author_id)?.name || '未知' }));
  // 当前用户与本队关系
  if (req.user) {
    view.my_role = req.user.id === team.captain_id ? 'captain' : activeMembers(d, team.id).some((m) => m.user_id === req.user.id) ? 'member' : 'guest';
    view.my_pending_invite = d.invites.find(
      (i) => i.user_id === req.user.id && i.team_id === team.id && i.direction === 'invite' && i.status === 'pending'
    ) || null;
    // 我发出的、等待队长处理的加入申请（详情页显示状态并支持撤回）
    view.my_pending_apply = d.invites.find(
      (i) => i.user_id === req.user.id && i.team_id === team.id && i.direction === 'apply' && i.status === 'pending'
    ) || null;
  }
  res.json({ data: view });
});

// ---------- 建队 ----------
router.post('/', requireAuth, (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const track = String(body.track || '');
  const topic_title = String(body.topic_title || '').trim().slice(0, 50);
  const topic_brief = String(body.topic_brief || '').trim().slice(0, 300);
  const contact = String(body.contact || '').trim().slice(0, 40);
  const need_skills = Array.isArray(body.need_skills) ? body.need_skills.filter((s) => config.skills.includes(s)) : [];

  const errors = [];
  if (name.length < 2 || name.length > 16) errors.push('队名需 2-16 个字符');
  if (!config.tracks.some((t) => t.key === track)) errors.push('请选择参赛赛道');
  if (!topic_title) errors.push('请填写选题名称');
  if (Date.now() >= config.event.teamBuildingEnd.getTime()) errors.push('组队已截止（10/16 22:00）');

  const d = getDb();
  if (d.teams.some((t) => t.name === name)) errors.push('队名已被使用');
  if (teamIdOf(d, req.user.id)) errors.push('你已加入或创建了一支队伍（一人一队）');

  if (errors.length) throw unprocessable('无法创建队伍', errors);

  const team = {
    id: uid('t'),
    name,
    track,
    topic_title,
    topic_brief,
    need_skills,
    contact: contact || req.user.contact || '',
    status: 'recruiting',
    captain_id: req.user.id,
    created_at: new Date().toISOString(),
    locked_at: null,
  };
  d.teams.push(team);
  d.team_members.push({
    id: uid('m'),
    team_id: team.id,
    user_id: req.user.id,
    role_in_team: String(body.role_in_team || '产品').slice(0, 10),
    joined_at: new Date().toISOString(),
  });
  const me = d.users.find((u) => u.id === req.user.id);
  if (me) me.looking_for_team = false;
  expireOtherPendings(d, req.user.id, null); // 建队后自动关闭其余待处理申请/邀请
  save();
  res.status(201).json({ data: { id: team.id } });
});

// ---------- 队长编辑 / 锁定 ----------
router.put('/:id', requireAuth, (req, res) => {
  const d = getDb();
  const team = findTeam(d, req.params.id);
  if (team.captain_id !== req.user.id) throw forbidden('仅队长可编辑队伍信息');
  if (nowTeamStatus(team) === 'locked') throw conflict('队伍已锁定，如需修改请联系赛务组');

  const body = req.body || {};
  if (body.topic_title !== undefined) team.topic_title = String(body.topic_title).trim().slice(0, 50);
  if (body.topic_brief !== undefined) team.topic_brief = String(body.topic_brief).trim().slice(0, 300);
  if (body.contact !== undefined) team.contact = String(body.contact).trim().slice(0, 40);
  if (body.need_skills !== undefined && Array.isArray(body.need_skills)) {
    team.need_skills = body.need_skills.filter((s) => config.skills.includes(s));
  }
  save();
  res.json({ data: { ok: true } });
});

router.post('/:id/lock', requireAuth, (req, res) => {
  const d = getDb();
  const team = findTeam(d, req.params.id);
  if (team.captain_id !== req.user.id && req.user.role !== 'admin') throw forbidden('仅队长可锁定');
  if (activeMembers(d, team.id).length < config.team.minSize) throw conflict('队伍人数不足');
  team.status = 'locked';
  team.locked_at = new Date().toISOString();
  save();
  activeMembers(d, team.id).forEach((m) =>
    notify(d, m.user_id, 'team_locked', `队伍「${team.name}」已锁定`, '队伍报名信息已确认，10/17 正式开赛见！', `#/team/${team.id}`)
  );
  res.json({ data: { ok: true } });
});

// ---------- 申请 / 邀请 ----------
router.post('/:id/apply', requireAuth, (req, res) => {
  const d = getDb();
  const team = findTeam(d, req.params.id);
  const message = String((req.body || {}).message || '').trim().slice(0, 200);
  const role_in_team = String((req.body || {}).role_in_team || '').slice(0, 10);

  if (nowTeamStatus(team) !== 'recruiting') throw conflict('该队伍当前不在招募中');
  if (activeMembers(d, team.id).length >= config.team.maxSize) throw conflict('该队伍已满员');
  if (teamIdOf(d, req.user.id)) throw conflict('你已加入或创建了一支队伍（一人一队）');
  if (d.invites.some((i) => i.team_id === team.id && i.user_id === req.user.id && i.direction === 'apply' && i.status === 'pending')) {
    throw conflict('已申请过该队伍，请等待队长处理');
  }

  d.invites.push({
    id: uid('i'),
    team_id: team.id,
    user_id: req.user.id,
    direction: 'apply',
    status: 'pending',
    message,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  // 保存期望分工到用户备注：直接挂在 invite 上方便审批展示
  const inv = d.invites[d.invites.length - 1];
  inv.role_in_team = role_in_team;
  notify(d, team.captain_id, 'team_apply', `${req.user.name} 申请加入「${team.name}」`, message, `#/team/${team.id}/manage`);
  save();
  res.status(201).json({ data: { ok: true } });
});

router.post('/:id/invite', requireAuth, (req, res) => {
  const d = getDb();
  const team = findTeam(d, req.params.id);
  if (team.captain_id !== req.user.id) throw forbidden('仅队长可邀请成员');
  if (nowTeamStatus(team) !== 'recruiting') throw conflict('队伍已锁定，无法邀请新成员');
  if (activeMembers(d, team.id).length >= config.team.maxSize) throw conflict('队伍已满员（最多 5 人）');

  const targetId = String((req.body || {}).user_id || '');
  const message = String((req.body || {}).message || '').trim().slice(0, 200);
  const target = d.users.find((u) => u.id === targetId);
  if (!target) throw notFound('用户不存在');
  if (teamIdOf(d, target.id)) throw conflict('对方已加入其他队伍');
  if (d.invites.some((i) => i.team_id === team.id && i.user_id === target.id && i.direction === 'invite' && i.status === 'pending')) {
    throw conflict('已邀请过对方，请等待处理');
  }

  d.invites.push({
    id: uid('i'),
    team_id: team.id,
    user_id: target.id,
    direction: 'invite',
    status: 'pending',
    message,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  notify(d, target.id, 'team_invite', `${req.user.name} 邀请你加入「${team.name}」`, message, `#/team/${team.id}`);
  save();
  res.status(201).json({ data: { ok: true } });
});

// 邀请/申请处理：accept / decline / cancel
router.post('/invites/:id/:action', requireAuth, (req, res) => {
  const { id, action } = req.params;
  const d = getDb();
  const inv = d.invites.find((i) => i.id === id);
  if (!inv) throw notFound('记录不存在');
  if (inv.status !== 'pending') throw conflict('该记录已处理');

  const team = findTeam(d, inv.team_id);
  const me = req.user.id;

  if (action === 'cancel') {
    // 申请人撤回自己的申请 / 队长撤回自己的邀请
    const allowed = (inv.direction === 'apply' && inv.user_id === me) || (inv.direction === 'invite' && team.captain_id === me);
    if (!allowed) throw forbidden();
    inv.status = 'cancelled';
    if (inv.direction === 'apply') {
      notify(d, team.captain_id, 'apply_cancelled', `${req.user.name} 撤回了加入「${team.name}」的申请`, '', `#/team/${team.id}/manage`);
    } else {
      notify(d, inv.user_id, 'invite_cancelled', `「${team.name}」撤回了邀请`, '可以继续逛逛队伍广场', '#/teams');
    }
  } else if (action === 'decline') {
    // 被邀请人拒绝 / 队长拒绝申请
    const allowed = (inv.direction === 'invite' && inv.user_id === me) || (inv.direction === 'apply' && team.captain_id === me);
    if (!allowed) throw forbidden();
    inv.status = 'declined';
    if (inv.direction === 'invite') {
      notify(d, team.captain_id, 'invite_declined', `${req.user.name} 婉拒了「${team.name}」的邀请`, '', `#/team/${team.id}/manage`);
    } else {
      notify(d, inv.user_id, 'apply_declined', `你加入「${team.name}」的申请未通过`, '可以继续看看其他队伍，或完善名片等待被邀请', '#/teams');
    }
  } else if (action === 'accept') {
    if (inv.direction === 'invite') {
      // 被邀请人接受
      if (inv.user_id !== me) throw forbidden();
      if (teamIdOf(d, me)) throw conflict('你已加入其他队伍');
      if (nowTeamStatus(team) !== 'recruiting') throw conflict('队伍已锁定');
      if (activeMembers(d, team.id).length >= config.team.maxSize) throw conflict('队伍已满员');
      d.team_members.push({
        id: uid('m'),
        team_id: team.id,
        user_id: me,
        role_in_team: '',
        joined_at: new Date().toISOString(),
      });
      const meUser = d.users.find((u) => u.id === me);
      if (meUser) meUser.looking_for_team = false;
      inv.status = 'accepted';
      expireOtherPendings(d, me, inv.id); // 入队后其余待处理申请/邀请自动失效
      notify(d, team.captain_id, 'member_joined', `${req.user.name} 已加入「${team.name}」`, '', `#/team/${team.id}`);
      if (activeMembers(d, team.id).length >= config.team.maxSize) team.status = 'full';
    } else {
      // 队长接受申请
      if (team.captain_id !== me) throw forbidden('仅队长可处理申请');
      const applicant = d.users.find((u) => u.id === inv.user_id);
      if (!applicant || teamIdOf(d, applicant.id)) throw conflict('对方已加入其他队伍');
      if (nowTeamStatus(team) !== 'recruiting') throw conflict('队伍已锁定');
      if (activeMembers(d, team.id).length >= config.team.maxSize) throw conflict('队伍已满员');
      d.team_members.push({
        id: uid('m'),
        team_id: team.id,
        user_id: applicant.id,
        role_in_team: inv.role_in_team || '',
        joined_at: new Date().toISOString(),
      });
      applicant.looking_for_team = false;
      inv.status = 'accepted';
      expireOtherPendings(d, applicant.id, inv.id); // 入队后其余待处理申请/邀请自动失效
      notify(d, applicant.id, 'member_joined', `你已加入「${team.name}」`, '组队成功！10/17 正式开赛见。', `#/team/${team.id}`);
      if (activeMembers(d, team.id).length >= config.team.maxSize) team.status = 'full';
    }
  } else {
    throw badRequest('未知操作');
  }

  inv.updated_at = new Date().toISOString();
  save();
  res.json({ data: { ok: true } });
});

// ---------- 成员管理 ----------
router.delete('/:id/members/:userId', requireAuth, (req, res) => {
  const d = getDb();
  const team = findTeam(d, req.params.id);
  if (team.captain_id !== req.user.id && req.user.role !== 'admin') throw forbidden('仅队长可移除成员');
  if (req.params.userId === team.captain_id) throw badRequest('不能移除队长，请先转让队长');
  const idx = d.team_members.findIndex((m) => m.team_id === team.id && m.user_id === req.params.userId);
  if (idx === -1) throw notFound('该成员不在队伍中');
  d.team_members.splice(idx, 1);
  const kicked = d.users.find((u) => u.id === req.params.userId);
  if (kicked) kicked.looking_for_team = true;
  notify(d, req.params.userId, 'member_removed', `你已离开「${team.name}」`, '可以去队伍广场继续找队', '#/teams');
  // 队伍若从 full 回到未满
  if (team.status === 'full' && activeMembers(d, team.id).length < config.team.maxSize && Date.now() < config.event.teamBuildingEnd.getTime()) {
    team.status = 'recruiting';
  }
  save();
  res.json({ data: { ok: true } });
});

// ---------- 解散队伍（队长 / 赛务组）----------
// 语义：队伍整体注销 —— 队伍、成员关系、待处理申请/邀请、进度日志、作品一并清除，
//       成员恢复「找队中」并收到通知；解散前的完整快照写入 d.disbanded_teams 便于事后查证。
// 约束：队长仅在组队截止（10/16 22:00 自动锁定）前可自行解散；锁定后需赛务组处理（管理员不受限）。
router.delete('/:id', requireAuth, (req, res) => {
  const d = getDb();
  const team = findTeam(d, req.params.id);
  const isCaptain = team.captain_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!isCaptain && !isAdmin) throw forbidden('仅队长可解散队伍');
  if (!isAdmin && nowTeamStatus(team) === 'locked') {
    throw conflict('队伍已锁定（组队截止 10/16 22:00），如需解散请联系赛务组');
  }

  const members = activeMembers(d, team.id);
  const invites = d.invites.filter((i) => i.team_id === team.id);
  const logs = d.progress_logs.filter((p) => p.team_id === team.id);
  const projects = (d.projects || []).filter((p) => p.team_id === team.id);
  const now = new Date().toISOString();

  // 归档快照（不可恢复操作留痕，便于赛务组事后查证与人工恢复）
  d.disbanded_teams = d.disbanded_teams || [];
  d.disbanded_teams.push({
    team,
    members,
    invites,
    progress_logs: logs,
    projects,
    member_names: members.map((m) => d.users.find((u) => u.id === m.user_id)?.name || ''),
    operator_id: req.user.id,
    operator_name: req.user.name,
    by_admin: isAdmin && !isCaptain,
    by_captain: isCaptain,
    reason: String((req.body || {}).reason || '').slice(0, 200),
    disbanded_at: now,
  });

  // 待处理的申请 / 邀请关闭并通知对方（队伍没了，通知里不再带队伍链接）
  invites
    .filter((i) => i.status === 'pending')
    .forEach((i) => {
      if (i.direction === 'apply') {
        notify(d, i.user_id, 'apply_cancelled', `你加入「${team.name}」的申请已关闭`, '该队伍已解散，可以继续看看其他队伍', '#/teams');
      } else {
        notify(d, i.user_id, 'invite_cancelled', `「${team.name}」的邀请已取消`, '该队伍已解散，可以继续看看其他队伍', '#/teams');
      }
    });
  // 通知其余成员
  members
    .filter((m) => m.user_id !== req.user.id)
    .forEach((m) =>
      notify(
        d,
        m.user_id,
        'team_disbanded',
        `队伍「${team.name}」已解散`,
        '队长已解散该队伍，你可以去队伍广场重新找队（组队截止 10/16 22:00）',
        '#/teams'
      )
    );

  // 成员恢复「找队中」
  members.forEach((m) => {
    const u = d.users.find((x) => x.id === m.user_id);
    if (u) u.looking_for_team = true;
  });

  // 删除进度配图文件（严格限定在 data/uploads 内，用 basename 防目录穿越）
  const uploadsDir = path.join(config.dataDir, 'uploads');
  logs.forEach((p) =>
    (p.images || []).forEach((src) => {
      if (!String(src).startsWith('/uploads/')) return;
      const f = path.join(uploadsDir, path.basename(String(src)));
      if (f.indexOf(uploadsDir) === 0 && fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (e) { /* 文件已删/被占用时忽略 */ }
      }
    })
  );

  // 级联清理
  const projectIds = new Set(projects.map((p) => p.id));
  d.teams = d.teams.filter((t) => t.id !== team.id);
  d.team_members = d.team_members.filter((m) => m.team_id !== team.id);
  d.invites = d.invites.filter((i) => i.team_id !== team.id);
  d.progress_logs = d.progress_logs.filter((p) => p.team_id !== team.id);
  d.projects = (d.projects || []).filter((p) => p.team_id !== team.id);
  d.project_likes = (d.project_likes || []).filter((l) => !projectIds.has(l.project_id));
  d.milestone_checks = (d.milestone_checks || []).filter((c) => c.team_id !== team.id);
  save();

  res.json({
    data: { ok: true, team_name: team.name, member_count: members.length, projects: projects.length },
  });
});

router.post('/:id/transfer', requireAuth, (req, res) => {
  const d = getDb();
  const team = findTeam(d, req.params.id);
  if (team.captain_id !== req.user.id) throw forbidden('仅队长可转让');
  const targetId = String((req.body || {}).user_id || '');
  if (!activeMembers(d, team.id).some((m) => m.user_id === targetId)) throw badRequest('对方需为队伍成员');
  team.captain_id = targetId;
  notify(d, targetId, 'captain_transfer', `你已成为「${team.name}」的队长`, '', `#/team/${team.id}`);
  save();
  res.json({ data: { ok: true } });
});

// ---------- 进度日志（支持配图，最多 3 张/条）----------
router.post('/:id/progress', requireAuth, (req, res) => {
  const d = getDb();
  const team = findTeam(d, req.params.id);
  const isMember = activeMembers(d, team.id).some((m) => m.user_id === req.user.id);
  if (!isMember) throw forbidden('仅队伍成员可发布进度');
  const content = String((req.body || {}).content || '').trim().slice(0, 500);
  const stage = String((req.body || {}).stage || '开发实现').slice(0, 10);
  const rawImages = Array.isArray((req.body || {}).images) ? (req.body || {}).images.slice(0, 3) : [];
  if (!content && !rawImages.length) throw badRequest('进度内容不能为空');
  const images = rawImages.map(saveProgressImage);
  d.progress_logs.push({
    id: uid('p'),
    team_id: team.id,
    stage,
    content,
    images,
    author_id: req.user.id,
    created_at: new Date().toISOString(),
  });
  save();
  res.status(201).json({ data: { ok: true } });
});

// ---------- 作品提交（队长提交/更新，每队一份）----------
router.post('/:id/project', requireAuth, (req, res) => {
  const d = getDb();
  const team = findTeam(d, req.params.id);
  if (team.captain_id !== req.user.id && req.user.role !== 'admin') throw forbidden('仅队长可提交作品');
  const body = req.body || {};
  const title = String(body.title || '').trim().slice(0, 60);
  const intro = String(body.intro || '').trim().slice(0, 500);
  const repo_url = String(body.repo_url || '').trim().slice(0, 300);
  const demo_url = String(body.demo_url || '').trim().slice(0, 300);
  const video_url = String(body.video_url || '').trim().slice(0, 300);
  const doc_url = String(body.doc_url || '').trim().slice(0, 300);
  const ai_declaration = String(body.ai_declaration || '').trim().slice(0, 1500);

  const errors = [];
  if (title.length < 2) errors.push('请填写作品名称（2-60 字）');
  if (!repo_url) errors.push('请填写代码仓库链接');
  const isUrl = (s) => !s || /^https?:\/\/\S+$/.test(s);
  if (!isUrl(repo_url) || !isUrl(demo_url) || !isUrl(video_url) || !isUrl(doc_url)) {
    errors.push('链接需以 http(s):// 开头');
  }
  if (errors.length) throw unprocessable('作品信息有误', errors);

  d.projects = d.projects || [];
  const now = new Date().toISOString();
  let proj = d.projects.find((p) => p.team_id === team.id);
  const isNew = !proj;
  if (proj) {
    Object.assign(proj, { title, intro, repo_url, demo_url, video_url, doc_url, ai_declaration, updated_at: now });
  } else {
    proj = {
      id: uid('pr'),
      team_id: team.id,
      title,
      intro,
      repo_url,
      demo_url,
      video_url,
      doc_url,
      ai_declaration,
      submitted_by: req.user.id,
      created_at: now,
      updated_at: now,
    };
    d.projects.push(proj);
  }
  // 通知队员（首次提交）
  if (isNew) {
    activeMembers(d, team.id).forEach((m) => {
      if (m.user_id !== req.user.id) {
        notify(d, m.user_id, 'project_submitted', `队伍「${team.name}」已提交作品`, title, `#/team/${team.id}`);
      }
    });
  }
  save();
  res.status(201).json({ data: { ok: true, is_new: isNew } });
});

// ---------- 队长管理视图 ----------
router.get('/:id/manage', requireAuth, (req, res) => {
  const d = getDb();
  const team = findTeam(d, req.params.id);
  if (team.captain_id !== req.user.id && req.user.role !== 'admin') throw forbidden('仅队长可访问');
  const view = teamView(d, team, { includeContact: true, withMembers: true, viewer: req.user });
  view.pending_applies = d.invites
    .filter((i) => i.team_id === team.id && i.direction === 'apply' && i.status === 'pending')
    .map((i) => {
      const u = d.users.find((x) => x.id === i.user_id);
      // 申请行为即授权向该队长提供联系方式（revealContact），便于队长沟通
      return { ...i, user: u ? publicUser(u, { revealContact: true }) : null };
    });
  view.pending_invites = d.invites
    .filter((i) => i.team_id === team.id && i.direction === 'invite' && i.status === 'pending')
    .map((i) => ({ ...i, user_name: d.users.find((u) => u.id === i.user_id)?.name || '' }));
  res.json({ data: view });
});

module.exports = { router, teamView, nowTeamStatus, activeMembers, findTeam, notify, trackName };
