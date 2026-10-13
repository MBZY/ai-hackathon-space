'use strict';

const express = require('express');
const crypto = require('crypto');
const { getDb, save, uid, teamIdOf } = require('../store');
const config = require('../config');
const { rateLimit } = require('../ratelimit');
const { badRequest, unauthorized, unprocessable, conflict, forbidden } = require('../errors');

const router = express.Router();

// 登录/注册/改密限速：单 IP 每分钟 30 次（防脚本爆破，正常使用无感）
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: '操作过于频繁，请稍等一分钟再试',
});

// ---------- 密码 ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function makeSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const d = getDb();
  d.sessions[token] = { userId, expiresAt: Date.now() + config.session.ttlMs };
  // 顺手清理过期 session
  const now = Date.now();
  for (const [t, s] of Object.entries(d.sessions)) {
    if (s.expiresAt < now) delete d.sessions[t];
  }
  save();
  return token;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

// ---------- 中间件 ----------
function attachUser(req, res, next) {
  const token = parseCookies(req)[config.session.cookieName];
  req.user = null;
  if (token) {
    const d = getDb();
    const session = d.sessions[token];
    if (session && session.expiresAt > Date.now()) {
      const user = d.users.find((u) => u.id === session.userId);
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('仅赛务组可访问'));
  next();
}

// ---------- 校验 ----------
function validateProfile(body, { partial = false } = {}) {
  const errors = [];
  const out = {};

  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (name.length < 2 || name.length > 20) errors.push('姓名需 2-20 个字符');
    out.name = name;
  }
  if (!partial || body.student_id !== undefined) {
    const sid = String(body.student_id || '').trim();
    if (!/^\d{8,15}$/.test(sid)) errors.push('学号需为 8-15 位数字');
    out.student_id = sid;
  }
  if (body.college !== undefined) out.college = String(body.college || '').trim().slice(0, 40);
  if (body.major !== undefined) out.major = String(body.major || '').trim().slice(0, 40);
  if (body.grade !== undefined) out.grade = String(body.grade || '').trim().slice(0, 20);
  if (body.contact !== undefined) out.contact = String(body.contact || '').trim().slice(0, 40);
  if (body.bio !== undefined) out.bio = String(body.bio || '').trim().slice(0, 200);
  if (body.skills !== undefined) {
    const skills = Array.isArray(body.skills) ? body.skills : [];
    out.skills = skills.filter((s) => config.skills.includes(s)).slice(0, 8);
  }
  if (body.ai_level !== undefined) {
    out.ai_level = config.aiLevels.includes(body.ai_level) ? body.ai_level : '入门';
  }
  if (body.looking_for_team !== undefined) out.looking_for_team = !!body.looking_for_team;

  return { errors, out };
}

// ---------- 路由 ----------
// 报名模式：survey = 问卷报名制
//  - 自助注册保留，但提交后为「待审核」状态（status='pending'），须赛务组在后台审核通过后才能登录
//  - 已通过问卷报名的同学直接用学号登录（初始密码=学号后6位）
router.post('/register', authLimiter, (req, res) => {
  const { errors, out } = validateProfile(req.body || {});
  const password = String((req.body || {}).password || '');
  if (password.length < 6 || password.length > 64) errors.push('密码需 6-64 位');
  if (errors.length) throw unprocessable('注册信息有误', errors);

  const d = getDb();
  if (d.users.some((u) => u.student_id === out.student_id)) {
    throw conflict('该学号已注册或已提交申请，请直接登录（忘记密码请联系赛务组重置）');
  }

  const needReview = config.registration.mode === 'survey';
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: uid('u'),
    ...out,
    password_hash: hashPassword(password, salt),
    salt,
    looking_for_team: out.looking_for_team !== undefined ? out.looking_for_team : true,
    role: config.adminStudentIds.includes(out.student_id) ? 'admin' : 'user',
    team_id: '',
    created_at: new Date().toISOString(),
  };
  if (needReview) user.status = 'pending'; // 待赛务组审核
  d.users.push(user);

  if (needReview) {
    // 通知全体管理员（排除其他待审核用户）
    d.users
      .filter((u) => u.role === 'admin' && u.status !== 'pending' && u.status !== 'rejected')
      .forEach((a) => {
        d.notifications.push({
          id: uid('n'),
          user_id: a.id,
          type: 'register_apply',
          title: `新的报名申请：${user.name}`,
          content: `学号 ${user.student_id}${user.major ? ' · ' + user.major : ''}，请前往「报名审核」处理`,
          link: '#/admin/review',
          is_read: false,
          created_at: new Date().toISOString(),
        });
      });
    save();
    return res.status(201).json({
      data: { pending: true, name: user.name, message: '报名申请已提交，等待赛务组审核通过后即可登录' },
    });
  }

  // open 模式：直接激活并登录（原行为）
  d.notifications.push({
    id: uid('n'),
    user_id: user.id,
    type: 'welcome',
    title: '欢迎来到 AI 黑客松组队空间',
    content: '完善名片、去队伍广场找队友吧！组队截止 10/16 22:00。',
    link: '#/teams',
    is_read: false,
    created_at: new Date().toISOString(),
  });
  save();

  const token = makeSession(user.id);
  setSessionCookie(req, res, token);
  res.status(201).json({ data: publicUser(user) });
});

router.post('/login', authLimiter, (req, res) => {
  const sid = String((req.body || {}).student_id || '').trim();
  const password = String((req.body || {}).password || '');
  if (!sid || !password) throw badRequest('请输入学号和密码');

  const d = getDb();
  const user = d.users.find((u) => u.student_id === sid);
  if (!user) {
    if (config.registration.mode === 'survey') {
      throw unauthorized(
        '该学号暂无报名记录。请先填写报名问卷，赛务组导入名单后即可用学号登录（初始密码为学号后 6 位）；如已填写请稍后再试或联系赛务组。'
      );
    }
    throw unauthorized('学号或密码错误');
  }
  if (hashPassword(password, user.salt) !== user.password_hash) {
    throw unauthorized(
      config.registration.mode === 'survey' ? '密码错误（初始密码为学号后 6 位，可在登录后修改）' : '学号或密码错误'
    );
  }
  // 审核状态拦截（问卷制下，自助注册的申请需赛务组通过）
  if (user.status === 'pending') throw forbidden('报名申请审核中，赛务组通过后即可登录（一般当天处理）');
  if (user.status === 'rejected') throw forbidden('报名申请未通过，如有疑问请联系赛务组');
  const token = makeSession(user.id);
  setSessionCookie(req, res, token);
  res.json({ data: publicUser(user) });
});

router.post('/logout', (req, res) => {
  const d = getDb();
  if (req.sessionToken) {
    delete d.sessions[req.sessionToken];
    save();
  }
  res.clearCookie(config.session.cookieName, { path: '/' });
  res.json({ data: { ok: true } });
});

// 修改密码：验证原密码，改密后踢掉其他设备会话（保留当前会话）
router.post('/change-password', requireAuth, (req, res) => {
  const oldPwd = String((req.body || {}).old_password || '');
  const newPwd = String((req.body || {}).new_password || '');
  if (newPwd.length < 6 || newPwd.length > 64) throw unprocessable('新密码需 6-64 位');
  const d = getDb();
  const me = d.users.find((u) => u.id === req.user.id);
  if (!me) throw unauthorized();
  if (hashPassword(oldPwd, me.salt) !== me.password_hash) throw badRequest('原密码不正确');
  if (oldPwd === newPwd) throw badRequest('新密码不能与原密码相同');
  const salt = crypto.randomBytes(16).toString('hex');
  me.salt = salt;
  me.password_hash = hashPassword(newPwd, salt);
  for (const [t, s] of Object.entries(d.sessions)) {
    if (s.userId === me.id && t !== req.sessionToken) delete d.sessions[t];
  }
  save();
  res.json({ data: { ok: true } });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ data: publicUser(req.user, true) });
});

function setSessionCookie(req, res, token) {
  const fwdProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = req.secure || fwdProto === 'https';
  res.setHeader(
    'Set-Cookie',
    `${config.session.cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
      config.session.ttlMs / 1000
    )}${secure ? '; Secure' : ''}`
  );
}

// 公开视图（含 own 标志决定是否返回联系方式等私有字段）
// team_id 动态计算：以 team_members / captain_id 为唯一事实来源
function publicUser(u, own = false) {
  const d = getDb();
  const base = {
    id: u.id,
    name: u.name,
    student_id: u.student_id,
    college: u.college,
    major: u.major,
    grade: u.grade,
    skills: u.skills || [],
    ai_level: u.ai_level,
    bio: u.bio,
    looking_for_team: u.looking_for_team,
    role: u.role,
    team_id: teamIdOf(d, u.id),
    created_at: u.created_at,
  };
  if (own) base.contact = u.contact || '';
  return base;
}

module.exports = { router, attachUser, requireAuth, requireAdmin, publicUser, hashPassword, validateProfile };
