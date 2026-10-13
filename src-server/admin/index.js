'use strict';

// 赛务后台：总览、队伍管理、导出 CSV、密码重置、数据备份/恢复
const express = require('express');
const { getDb, save, uid, DB_FILE } = require('../store');
const config = require('../config');
const { requireAdmin, hashPassword, NAME_RE } = require('../auth');
const { activeMembers, nowTeamStatus, notify } = require('../teams');
const { badRequest, notFound } = require('../errors');
const crypto = require('crypto');

const router = express.Router();
router.use(requireAdmin);

// 用户状态辅助：问卷制下自助注册的申请为 status='pending'
const isPending = (u) => u.status === 'pending';

// ---------- 总览 ----------
router.get('/overview', (req, res) => {
  const d = getDb();
  const activeUsers = d.users.filter((u) => u.status !== 'pending' && u.status !== 'rejected');
  const memberUserIds = new Set(d.team_members.map((m) => m.user_id));
  const tracks = {};
  config.tracks.forEach((t) => {
    tracks[t.key] = { name: t.name, teams: d.teams.filter((x) => x.track === t.key).length };
  });
  res.json({
    data: {
      users: activeUsers.length,
      pending_review: d.users.filter(isPending).length,
      teams: d.teams.length,
      locked: d.teams.filter((t) => nowTeamStatus(t) === 'locked').length,
      recruiting: d.teams.filter((t) => nowTeamStatus(t) === 'recruiting').length,
      unteamed: activeUsers.filter((u) => !memberUserIds.has(u.id)).length,
      pending_applies: d.invites.filter((i) => i.direction === 'apply' && i.status === 'pending').length,
      progress_logs: d.progress_logs.length,
      messages: d.messages.length,
      projects: (d.projects || []).length,
      tracks,
      teams_deadline_passed: Date.now() >= config.event.teamBuildingEnd.getTime(),
    },
  });
});

// ---------- 队伍列表（含成员明细）----------
router.get('/teams', (req, res) => {
  const d = getDb();
  const list = d.teams
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((t) => ({
      id: t.id,
      name: t.name,
      track: t.track,
      track_name: config.tracks.find((x) => x.key === t.track)?.name || t.track,
      topic_title: t.topic_title,
      status: nowTeamStatus(t),
      contact: t.contact,
      captain: d.users.find((u) => u.id === t.captain_id)?.name || '',
      members: activeMembers(d, t.id).map((m) => {
        const u = d.users.find((x) => x.id === m.user_id);
        return {
          name: u?.name || '',
          student_id: u?.student_id || '',
          college: u?.college || '',
          major: u?.major || '',
          role_in_team: m.role_in_team,
          contact: u?.contact || '',
        };
      }),
      created_at: t.created_at,
    }));
  res.json({ data: list });
});

// ---------- 用户列表 ----------
router.get('/users', (req, res) => {
  const d = getDb();
  const memberTeam = {};
  d.team_members.forEach((m) => {
    memberTeam[m.user_id] = m.team_id;
  });
  const teamName = Object.fromEntries(d.teams.map((t) => [t.id, t.name]));
  const list = [...d.users]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((u) => ({
      id: u.id,
      name: u.name,
      student_id: u.student_id,
      college: u.college,
      major: u.major,
      grade: u.grade,
      contact: u.contact,
      skills: u.skills,
      ai_level: u.ai_level,
      looking_for_team: u.looking_for_team,
      role: u.role,
      status: u.status || '',
      team_name: memberTeam[u.id] ? teamName[memberTeam[u.id]] || '' : '',
      created_at: u.created_at,
    }));
  res.json({ data: list });
});

// ---------- 锁定/解锁 ----------
router.post('/teams/:id/lock', (req, res) => {
  const d = getDb();
  const team = d.teams.find((t) => t.id === req.params.id);
  if (!team) throw notFound('队伍不存在');
  team.status = 'locked';
  team.locked_at = new Date().toISOString();
  save();
  activeMembers(d, team.id).forEach((m) =>
    notify(d, m.user_id, 'team_locked', `队伍「${team.name}」已由赛务组锁定`, '', `#/team/${team.id}`)
  );
  res.json({ data: { ok: true } });
});

router.post('/teams/:id/unlock', (req, res) => {
  const d = getDb();
  const team = d.teams.find((t) => t.id === req.params.id);
  if (!team) throw notFound('队伍不存在');
  if (Date.now() >= config.event.teamBuildingEnd.getTime()) {
    throw badRequest('组队已截止，无法解锁（如需调整请人工处理名单）');
  }
  team.status = 'recruiting';
  team.locked_at = null;
  save();
  res.json({ data: { ok: true } });
});

// ---------- 密码重置（重置为学号后 6 位）----------
router.post('/users/:id/reset-password', (req, res) => {
  const d = getDb();
  const u = d.users.find((x) => x.id === req.params.id);
  if (!u) throw notFound('用户不存在');
  const newPwd = u.student_id.slice(-6);
  const salt = crypto.randomBytes(16).toString('hex');
  u.salt = salt;
  u.password_hash = hashPassword(newPwd, salt);
  save();
  notify(d, u.id, 'password_reset', '密码已被赛务组重置', '新密码为你的学号后 6 位，登录后请尽快在赛务组协助下修改。', '#/login');
  save();
  res.json({ data: { ok: true, new_password: newPwd } });
});

// ---------- 角色管理（把赛务组同事提权为管理员）----------
router.post('/users/:id/role', (req, res) => {
  const d = getDb();
  const u = d.users.find((x) => x.id === req.params.id);
  if (!u) throw notFound('用户不存在');
  const role = (req.body || {}).role === 'admin' ? 'admin' : 'user';
  if (u.id === req.user.id && role !== 'admin') throw badRequest('不能取消自己的管理员权限');
  u.role = role;
  save();
  notify(d, u.id, 'role_change', role === 'admin' ? '你已被设为赛务组管理员' : '你的管理员权限已被移除', role === 'admin' ? '现在可以访问 /admin 管理后台' : '', '#/admin');
  save();
  res.json({ data: { ok: true, role: u.role } });
});

// ---------- 批量导入报名（腾讯问卷 → 用户名单）----------
// 支持粘贴 JSON / CSV 解析后的结构化数据；初始密码 = 学号后 6 位
// conflict 策略：skip=跳过已存在（默认）｜ fill=仅补充空字段 ｜ overwrite=覆盖
router.post('/import-users', (req, res) => {
  const body = req.body || {};
  const list = Array.isArray(body.users) ? body.users : [];
  const conflict = ['skip', 'fill', 'overwrite'].includes(body.conflict) ? body.conflict : 'skip';
  const dryRun = !!body.dry_run;
  if (!list.length) throw badRequest('导入数据为空');
  if (list.length > 500) throw badRequest('单次最多导入 500 条');

  const d = getDb();
  const now = new Date().toISOString();
  const result = { total: list.length, added: 0, updated: 0, skipped: 0, invalid: [], notes: [] };

  // 批内按学号去重（重复提交保留最后一条）
  const seen = new Map();
  list.forEach((item, i) => {
    const sid = String((item && item.student_id) || '').trim();
    if (sid && seen.has(sid)) {
      result.notes.push(`第 ${i + 1} 条学号 ${sid} 与前面的重复，已取最新一条`);
    }
    seen.set(sid || `__bad_${i}`, { ...item, __row: i + 1 });
  });

  for (const raw of seen.values()) {
    const row = raw.__row;
    const name = String(raw.name || '').trim().slice(0, 20);
    const sid = String(raw.student_id || '').trim();

    if (!name || name.length < 2) {
      result.invalid.push({ row, name, student_id: sid, reason: '姓名缺失或少于 2 字' });
      continue;
    }
    if (!NAME_RE.test(name)) {
      result.invalid.push({ row, name, student_id: sid, reason: '姓名含不支持的字符（仅限中英文、数字、空格与间隔号）' });
      continue;
    }
    if (!/^\d{8,15}$/.test(sid)) {
      result.invalid.push({ row, name, student_id: sid, reason: '学号格式不正确（需 8-15 位数字）' });
      continue;
    }

    const fields = {
      name,
      college: String(raw.college || '').trim().slice(0, 40),
      major: String(raw.major || '').trim().slice(0, 40),
      grade: String(raw.grade || '').trim().slice(0, 20),
      contact: String(raw.contact || '').trim().slice(0, 40),
      bio: String(raw.bio || '').trim().slice(0, 200),
      skills: Array.isArray(raw.skills) ? raw.skills.filter((s) => config.skills.includes(s)).slice(0, 8) : [],
      ai_level: config.aiLevels.includes(raw.ai_level) ? raw.ai_level : '入门',
    };
    const createdAt = /^\d{4}-\d{2}-\d{2}T/.test(String(raw.created_at || '')) ? raw.created_at : now;

    const existing = d.users.find((u) => u.student_id === sid);
    if (existing) {
      if (conflict === 'skip') {
        result.skipped += 1;
        continue;
      }
      if (!dryRun) {
        if (conflict === 'fill') {
          Object.entries(fields).forEach(([k, v]) => {
            if (k === 'name' || k === 'ai_level') return; // 姓名/等级不覆盖；AI 等级有默认值不作填充
            if (!existing[k] && (Array.isArray(v) ? v.length : v)) existing[k] = v;
          });
        } else {
          Object.assign(existing, fields);
        }
      }
      result.updated += 1;
      continue;
    }

    if (dryRun) {
      result.added += 1;
      continue;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: uid('u'),
      ...fields,
      student_id: sid,
      password_hash: hashPassword(sid.slice(-6), salt),
      salt,
      // 问卷「已组好队伍/单人参赛」会带 looking_for_team:false；缺省视为找队中
      looking_for_team: raw.looking_for_team === false ? false : true,
      role: config.adminStudentIds.includes(sid) ? 'admin' : 'user',
      team_id: '',
      created_at: createdAt,
      imported: true,
    };
    d.users.push(user);
    notify(
      d,
      user.id,
      'welcome',
      '欢迎来到 AI 黑客松组队空间',
      `报名名单已导入，初始密码为学号后 6 位（登录后可在「我的空间」修改）。组队截止 10/16 22:00。`,
      '#/teams'
    );
    result.added += 1;
  }

  if (!dryRun) save();
  res.json({ data: { ...result, dry_run: dryRun, conflict } });
});

// ---------- 报名审核（问卷制下自助注册的申请）----------
router.get('/review', (req, res) => {
  const d = getDb();
  const list = d.users
    .filter(isPending)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((u) => ({
      id: u.id,
      name: u.name,
      student_id: u.student_id,
      college: u.college,
      major: u.major,
      grade: u.grade,
      contact: u.contact,
      skills: u.skills || [],
      ai_level: u.ai_level,
      bio: u.bio,
      created_at: u.created_at,
    }));
  res.json({ data: list });
});

router.post('/users/:id/approve', (req, res) => {
  const d = getDb();
  const u = d.users.find((x) => x.id === req.params.id);
  if (!u) throw notFound('用户不存在');
  if (!isPending(u)) throw badRequest('该用户不在待审核状态');
  delete u.status;
  notify(d, u.id, 'register_approved', '报名申请已通过 ✓', '欢迎加入 AI 黑客松组队空间！完善名片、去队伍广场找队友吧（组队截止 10/16 22:00）。', '#/teams');
  save();
  res.json({ data: { ok: true } });
});

router.post('/users/:id/reject', (req, res) => {
  const d = getDb();
  const u = d.users.find((x) => x.id === req.params.id);
  if (!u) throw notFound('用户不存在');
  if (!isPending(u)) throw badRequest('该用户不在待审核状态');
  u.status = 'rejected';
  save();
  res.json({ data: { ok: true } });
});

// ---------- CSV 导出 ----------
function csvEscape(v) {
  const s = String(v === null || v === undefined ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(rows) {
  return '\uFEFF' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

router.get('/export', (req, res) => {
  const type = String(req.query.type || '');
  const d = getDb();
  let rows = [];
  let filename = 'export.csv';

  if (type === 'teams') {
    filename = '组队登记表.csv';
    rows.push(['队伍名称', '参赛赛道', '选题名称', '队伍状态', '队长', '成员数', '成员（姓名/学号/分工）', '队长联系方式', '作品名称', '作品仓库', '创建时间']);
    d.teams.forEach((t) => {
      const members = activeMembers(d, t.id)
        .map((m) => {
          const u = d.users.find((x) => x.id === m.user_id);
          return `${u?.name || '?'}/${u?.student_id || '?'}/${m.role_in_team || '-'}`;
        })
        .join('；');
      const proj = (d.projects || []).find((p) => p.team_id === t.id);
      rows.push([
        t.name,
        config.tracks.find((x) => x.key === t.track)?.name || t.track,
        t.topic_title,
        nowTeamStatus(t),
        d.users.find((u) => u.id === t.captain_id)?.name || '',
        activeMembers(d, t.id).length,
        members,
        t.contact,
        proj ? proj.title : '',
        proj ? proj.repo_url : '',
        t.created_at.slice(0, 16).replace('T', ' '),
      ]);
    });
  } else if (type === 'players') {
    filename = '报名人员表.csv';
    rows.push(['姓名', '学号', '学院', '专业', '年级', '联系方式', '技能', 'AI基础', '是否找队', '所属队伍', '注册时间']);
    const memberTeam = {};
    d.team_members.forEach((m) => {
      memberTeam[m.user_id] = m.team_id;
    });
    const teamName = Object.fromEntries(d.teams.map((t) => [t.id, t.name]));
    d.users.filter((u) => u.status !== 'pending' && u.status !== 'rejected').forEach((u) => {
      rows.push([
        u.name,
        u.student_id,
        u.college,
        u.major,
        u.grade,
        u.contact,
        (u.skills || []).join('/'),
        u.ai_level,
        u.looking_for_team ? '找队中' : '已入队',
        memberTeam[u.id] ? teamName[memberTeam[u.id]] || '' : '',
        u.created_at.slice(0, 16).replace('T', ' '),
      ]);
    });
  } else {
    throw badRequest('未知的导出类型（支持 teams / players）');
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(toCsv(rows));
});

// ---------- 数据备份 / 恢复（重新部署时保数据）----------
router.get('/backup', (req, res) => {
  const d = getDb();
  // 剔除敏感字段后导出（密码无法还原，恢复后需重置）
  const safe = JSON.parse(JSON.stringify(d));
  delete safe.sessions;
  safe.users = safe.users.map((u) => {
    const { password_hash, salt, ...rest } = u;
    return rest;
  });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('hackathon-backup.json')}`);
  res.send(JSON.stringify(safe));
});

router.post('/restore', (req, res) => {
  // 从 JSON 恢复（合并策略：按 id 覆盖/追加，不删除现有数据）
  const payload = req.body;
  if (!payload || typeof payload !== 'object') throw badRequest('无效的备份数据');
  const d = getDb();
  const collections = ['users', 'teams', 'team_members', 'invites', 'messages', 'notifications', 'progress_logs', 'announcements'];
  let restored = {};
  collections.forEach((key) => {
    if (Array.isArray(payload[key])) {
      const existing = new Set(d[key].map((x) => x.id));
      let added = 0;
      payload[key].forEach((item) => {
        if (item && item.id && !existing.has(item.id)) {
          if (key === 'users') {
            // 恢复的用户需要临时密码：学号后 6 位
            const salt = crypto.randomBytes(16).toString('hex');
            item.salt = salt;
            item.password_hash = hashPassword(String(item.student_id || '000000').slice(-6), salt);
          }
          d[key].push(item);
          added += 1;
        }
      });
      restored[key] = added;
    }
  });
  save();
  res.json({ data: { ok: true, restored } });
});

module.exports = { router };
