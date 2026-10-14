'use strict';
/* 解散队伍回归：权限矩阵 / 级联清理 / 通知 / 归档留痕 / 重新组队
 * 用法：node scripts/test-disband.js
 * 隔离：临时 DATA_DIR，不碰项目 data/ */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-disband-'));
const PORT = 3199;
let pass = 0, fail = 0;
const results = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; results.push(`  ✓ ${name}`); } else { fail++; results.push(`  ✗ ${name} ${extra}`); } };

// 1x1 白色 JPEG
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

function seed() {
  const iso = new Date().toISOString();
  const salt = () => crypto.randomBytes(16).toString('hex');
  const hash = (pwd, s) => crypto.scryptSync(pwd, s, 32).toString('hex');
  const mk = (id, name, sid, pwd, role, looking) => ({
    id, name, student_id: sid, college: '人工智能学院', major: '软件工程', grade: '2024级',
    contact: '微信 t', skills: [], ai_level: '入门', bio: '', looking_for_team: looking, role, team_id: '',
    created_at: iso,
    ...(() => { const s = salt(); return { salt: s, password_hash: hash(pwd, s) }; })(),
  });
  const db = {
    meta: { version: 1, createdAt: iso },
    sessions: {},
    users: [
      mk('u_admin', '测试管理员', '202440025279', 'admin123', 'admin', true),
      mk('u_cap', '队长甲', '202400000201', 'p111111', 'user', false),
      mk('u_m1', '成员乙', '202400000202', 'p111111', 'user', false),
      mk('u_ap', '申请人丙', '202400000203', 'p111111', 'user', true),
      mk('u_in', '受邀人丁', '202400000204', 'p111111', 'user', true),
      mk('u_other', '陌生人戊', '202400000205', 'p111111', 'user', true),
      mk('u_cap2', '队长己', '202400000206', 'p111111', 'user', false),
      mk('u_m2', '成员庚', '202400000207', 'p111111', 'user', false),
    ],
    teams: [
      { id: 't1', name: '测试解散队', track: 'web', topic_title: '解散测试', topic_brief: '简介', need_skills: [], contact: '微信 abc', status: 'recruiting', captain_id: 'u_cap', created_at: iso, locked_at: null },
      { id: 't2', name: '已锁定队', track: 'game', topic_title: '锁定测试', topic_brief: '', need_skills: [], contact: '', status: 'locked', captain_id: 'u_cap2', created_at: iso, locked_at: iso },
    ],
    team_members: [
      { id: 'm1', team_id: 't1', user_id: 'u_cap', role_in_team: '产品', joined_at: iso },
      { id: 'm2', team_id: 't1', user_id: 'u_m1', role_in_team: '前端', joined_at: iso },
      { id: 'm3', team_id: 't2', user_id: 'u_cap2', role_in_team: '产品', joined_at: iso },
      { id: 'm4', team_id: 't2', user_id: 'u_m2', role_in_team: '后端', joined_at: iso },
    ],
    invites: [
      { id: 'i1', team_id: 't1', user_id: 'u_ap', direction: 'apply', status: 'pending', role_in_team: '后端', message: '想加入', created_at: iso, updated_at: iso },
      { id: 'i2', team_id: 't1', user_id: 'u_in', direction: 'invite', status: 'pending', message: '来吧', created_at: iso, updated_at: iso },
    ],
    messages: [],
    notifications: [],
    progress_logs: [],
    announcements: [],
    projects: [{ id: 'pr_fixed', team_id: 't1', title: '解散前作品', intro: '', repo_url: 'https://github.com/a/b', demo_url: '', video_url: '', doc_url: '', ai_declaration: '', submitted_by: 'u_cap', created_at: iso, updated_at: iso }],
    milestone_checks: [{ id: 'mc1', team_id: 't1', stage: '中检' }],
    project_likes: [{ id: 'l1', project_id: 'pr_fixed', user_id: 'u_m1', created_at: iso }],
    disbanded_teams: [],
  };
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, 'db.json'), JSON.stringify(db));
}

function readDb() { return JSON.parse(fs.readFileSync(path.join(TMP, 'db.json'), 'utf8')); }

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    const t0 = Date.now();
    const timer = setInterval(async () => {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) { clearInterval(timer); resolve(child); } }
      catch (e) { if (Date.now() - t0 > 9000) { clearInterval(timer); reject(new Error(out)); } }
    }, 200);
  });
}

async function jfetch(p, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch (e) { /* ignore */ }
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const s = sc.map((x) => x.split(';')[0]).find((x) => x.startsWith('hk_session=')) || '';
  return { status: res.status, json, cookie: s };
}

async function login(sid, pwd) {
  const r = await jfetch('/api/auth/login', { method: 'POST', body: { student_id: sid, password: pwd } });
  if (r.status !== 200) throw new Error(`登录失败 ${sid}: ${JSON.stringify(r.json)}`);
  return r.cookie;
}
const notes = (cookie) => jfetch('/api/notifications', { cookie }).then((r) => (r.json && r.json.data && r.json.data.list) || []);

(async () => {
  seed();
  const srv = await startServer();
  const uploadsDir = path.join(TMP, 'uploads');
  try {
    const cap = await login('202400000201', 'p111111');
    const m1 = await login('202400000202', 'p111111');
    const ap = await login('202400000203', 'p111111');
    const inn = await login('202400000204', 'p111111');
    const other = await login('202400000205', 'p111111');
    const cap2 = await login('202400000206', 'p111111');
    const m2 = await login('202400000207', 'p111111');
    const admin = await login('202440025279', 'admin123');

    // 造数据：一条带配图的进度（验证 uploads 文件随解散清理）
    let r = await jfetch('/api/teams/t1/progress', { method: 'POST', cookie: cap, body: { stage: '开发实现', content: '解散前的一条进度', images: [TINY_JPEG] } });
    ok('队长发布带图进度 201', r.status === 201, JSON.stringify(r.json));
    const uploadedBefore = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
    ok('配图已落盘 data/uploads', uploadedBefore.length === 1, `files=${uploadedBefore.length}`);

    // ---------- 权限矩阵 ----------
    r = await jfetch('/api/teams/t1', { method: 'DELETE' });
    ok('未登录解散 → 401', r.status === 401, `status=${r.status}`);
    r = await jfetch('/api/teams/t1', { method: 'DELETE', cookie: m1 });
    ok('普通成员解散 → 403', r.status === 403, `status=${r.status}`);
    r = await jfetch('/api/teams/t1', { method: 'DELETE', cookie: other });
    ok('非成员解散 → 403', r.status === 403, `status=${r.status}`);
    r = await jfetch('/api/teams/t1', { method: 'DELETE', cookie: cap2 });
    ok('其他队长解散他人队伍 → 403', r.status === 403, `status=${r.status}`);
    r = await jfetch('/api/teams/t2', { method: 'DELETE', cookie: cap2 });
    ok('队长解散已锁定队伍 → 409', r.status === 409, `status=${r.status}`);
    r = await jfetch('/api/teams/t_nonexist', { method: 'DELETE', cookie: cap });
    ok('解散不存在的队伍 → 404', r.status === 404, `status=${r.status}`);
    ok('被拒后队伍仍在', readDb().teams.some((t) => t.id === 't1'));

    // ---------- 队长解散 ----------
    r = await jfetch('/api/teams/t1', { method: 'DELETE', cookie: cap });
    ok('队长解散自己的队伍 → 200', r.status === 200 && r.json.data.ok === true, JSON.stringify(r.json));
    ok('返回队伍名与成员数', r.json.data.team_name === '测试解散队' && r.json.data.member_count === 2, JSON.stringify(r.json.data));

    r = await jfetch('/api/teams');
    ok('广场不再出现该队', !r.json.data.some((t) => t.id === 't1'));
    r = await jfetch('/api/teams/t1');
    ok('队伍详情 → 404', r.status === 404, `status=${r.status}`);
    r = await jfetch('/api/teams/t1/manage', { cookie: cap });
    ok('队长管理页 → 404', r.status === 404, `status=${r.status}`);

    // ---------- 成员状态与通知 ----------
    r = await jfetch('/api/auth/me', { cookie: m1 });
    ok('成员已退出队伍且恢复找队中', r.json.data.team_id === '' && r.json.data.looking_for_team === true,
      JSON.stringify({ team_id: r.json.data.team_id, looking: r.json.data.looking_for_team }));
    ok('成员收到解散通知', (await notes(m1)).some((n) => n.type === 'team_disbanded'));
    ok('申请人收到申请关闭通知', (await notes(ap)).some((n) => n.type === 'apply_cancelled'));
    ok('受邀人收到邀请取消通知', (await notes(inn)).some((n) => n.type === 'invite_cancelled'));
    ok('队长自己不收解散通知', !(await notes(cap)).some((n) => n.type === 'team_disbanded'));

    // ---------- 数据级联清理 ----------
    const db = readDb();
    ok('teams 已删除', !db.teams.some((t) => t.id === 't1'));
    ok('team_members 已清理', !db.team_members.some((m) => m.team_id === 't1'));
    ok('invites 已清理（含已处理记录）', !db.invites.some((i) => i.team_id === 't1'));
    ok('progress_logs 已清理', !db.progress_logs.some((p) => p.team_id === 't1'));
    ok('projects 已清理', !db.projects.some((p) => p.team_id === 't1'));
    ok('project_likes 已清理', !db.project_likes.some((l) => l.project_id === 'pr_fixed'));
    ok('milestone_checks 已清理', !db.milestone_checks.some((c) => c.team_id === 't1'));
    ok('其他队伍与成员未受影响', db.teams.some((t) => t.id === 't2') && db.team_members.filter((m) => m.team_id === 't2').length === 2);
    ok('归档快照写入 1 条', (db.disbanded_teams || []).length === 1, `len=${(db.disbanded_teams || []).length}`);
    const arc = (db.disbanded_teams || [])[0] || {};
    ok('归档含队伍/成员/申请/进度/作品快照',
      arc.team && arc.team.id === 't1' && (arc.members || []).length === 2 && (arc.invites || []).length === 2 &&
      (arc.progress_logs || []).length === 1 && (arc.projects || []).length === 1,
      JSON.stringify({ m: (arc.members || []).length, i: (arc.invites || []).length, p: (arc.progress_logs || []).length, pr: (arc.projects || []).length }));
    ok('归档标记队长自主解散', arc.by_captain === true && arc.by_admin === false && arc.operator_name === '队长甲',
      JSON.stringify({ by_captain: arc.by_captain, by_admin: arc.by_admin, op: arc.operator_name }));
    const uploadedAfter = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
    ok('进度配图文件已删除', uploadedAfter.length === 0, `files=${uploadedAfter.join(',')}`);

    // ---------- 重新组队 / 队名复用 ----------
    r = await jfetch('/api/teams', { method: 'POST', cookie: cap, body: { name: '测试解散队', track: 'web', topic_title: '重组测试', role_in_team: '产品', contact: '微信 abc' } });
    ok('解散后可再次建队且队名可复用 → 201', r.status === 201, JSON.stringify(r.json));
    const t3 = r.json.data.id;
    r = await jfetch('/api/auth/me', { cookie: cap });
    ok('新队伍已绑定到本人', r.json.data.team_id === t3, `team_id=${r.json.data.team_id}`);

    // ---------- 赛务组强制解散已锁定队伍 ----------
    r = await jfetch('/api/teams/t2', { method: 'DELETE', cookie: admin });
    ok('管理员强解散锁定队伍 → 200', r.status === 200 && r.json.data.ok === true, JSON.stringify(r.json));
    ok('锁定队成员收到解散通知', (await notes(m2)).some((n) => n.type === 'team_disbanded'));
    const db2 = readDb();
    const arc2 = (db2.disbanded_teams || []).find((a) => a.team && a.team.id === 't2');
    ok('管理员解散归档标记 by_admin', !!arc2 && arc2.by_admin === true && arc2.by_captain === false, JSON.stringify(arc2 && { a: arc2.by_admin, c: arc2.by_captain }));
    r = await jfetch('/api/teams/t2', { method: 'DELETE', cookie: admin });
    ok('重复解散 → 404', r.status === 404, `status=${r.status}`);

    // ---------- 正常路径回归 ----------
    r = await jfetch(`/api/teams/${t3}`, { method: 'DELETE', cookie: cap });
    ok('新队伍可正常解散 → 200', r.status === 200, `status=${r.status}`);
    r = await jfetch('/api/teams', { method: 'POST', cookie: m1, body: { name: '乙的新队', track: 'open', topic_title: '复用测试', role_in_team: '前端', contact: '微信 x' } });
    ok('原成员可自主建队 → 201', r.status === 201, JSON.stringify(r.json));
  } finally {
    srv.kill('SIGTERM');
  }

  console.log('\n========== 解散队伍回归 ==========');
  console.log(results.join('\n'));
  console.log(`\n通过 ${pass} / ${pass + fail}${fail ? `，失败 ${fail}` : '，全部通过 ✓'}`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(2); });
