'use strict';
/* 生成上线用 data/db.json：管理员(雷子希) + 问卷报名名单导入
 * 用法：node scripts/prepare-online-data.js <users.json>
 *   users.json：[{name, student_id, contact, college?, major?, grade?, skills?, ai_level?, bio?, created_at?}, ...]
 * 流程：初始化 db（仅管理员）→ survey 模式起服 → 管理员登录 → import-users 导入 → 校验 → 停服
 * 说明：生成的 data/db.json 会随部署上传到线上沙箱，即为线上初始数据。 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = 3197;
const ADMIN = { name: '雷子希', student_id: '202440025279', college: '人工智能学院', major: '软件工程', grade: '2024级' };

function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 32).toString('hex'); }

function initDb() {
  if (fs.existsSync(DB_FILE)) {
    const backup = DB_FILE + '.bak.' + Date.now();
    fs.copyFileSync(DB_FILE, backup);
    console.log(`[init] 已存在计划外的 ${DB_FILE}，备份到 ${backup}`);
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const db = {
    meta: { version: 1, createdAt: new Date().toISOString() },
    sessions: {},
    users: [{
      id: 'u_admin_' + crypto.randomBytes(6).toString('hex'),
      ...ADMIN, contact: '微信（赛务组）', skills: [], ai_level: '熟练', bio: '', looking_for_team: true,
      role: 'admin', team_id: '',
      password_hash: hashPassword(ADMIN.student_id.slice(-6), salt), salt,
      created_at: new Date().toISOString(),
    }],
    teams: [], team_members: [], invites: [], messages: [], notifications: [],
    progress_logs: [], announcements: [], projects: [], milestone_checks: [], project_likes: [],
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
  console.log(`[init] 初始化 ${DB_FILE}（管理员 ${ADMIN.name}，初始密码=学号后6位）`);
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DATA_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    const t0 = Date.now();
    const timer = setInterval(async () => {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) { clearInterval(timer); resolve(child); } }
      catch (e) { if (Date.now() - t0 > 8000) { clearInterval(timer); reject(new Error(out)); } }
    }, 200);
  });
}

async function jfetch(p, opts = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/hk_session=([^;]+)/);
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, json, cookie: m ? `hk_session=${m[1]}` : '' };
}

(async () => {
  const inputFile = process.argv[2];
  if (!inputFile || !fs.existsSync(inputFile)) {
    console.error('用法：node scripts/prepare-online-data.js <users.json>');
    process.exit(2);
  }
  const users = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  if (!Array.isArray(users) || !users.length) {
    console.error('users.json 应为非空数组');
    process.exit(2);
  }
  console.log(`[prepare] 待导入 ${users.length} 条报名数据`);

  // 1) 如 db 不存在则初始化（幂等：存在则保留，交给导入去重）
  if (!fs.existsSync(DB_FILE)) initDb();
  else console.log('[init] data/db.json 已存在，跳过初始化（导入将按学号去重）');

  // 2) 起服 + 导入
  const srv = await startServer();
  try {
    let r = await jfetch('/api/auth/login', { method: 'POST', body: { student_id: ADMIN.student_id, password: ADMIN.student_id.slice(-6) } });
    if (r.status !== 200) throw new Error('管理员登录失败: ' + JSON.stringify(r.json));
    const cookie = r.cookie;

    // 预检
    r = await jfetch('/api/admin/import-users', { method: 'POST', cookie, body: { users, dry_run: true } });
    console.log('[precheck]', JSON.stringify(r.json.data));

    // 正式导入
    r = await jfetch('/api/admin/import-users', { method: 'POST', cookie, body: { users } });
    if (r.status !== 200) throw new Error('导入失败: ' + JSON.stringify(r.json));
    console.log('[import]', JSON.stringify(r.json.data));

    // 3) 校验
    r = await jfetch('/api/admin/users', { cookie });
    const list = r.json.data;
    console.log(`[verify] 用户总数: ${list.length}`);
    const noTeam = list.filter((u) => !u.team_name).length;
    console.log(`[verify] 未组队: ${noTeam}（含管理员）`);
    const dup = list.map((u) => u.student_id).filter((s, i, a) => a.indexOf(s) !== i);
    console.log(dup.length ? `[verify] 注意：重复学号 ${dup.join(',')}` : '[verify] 学号无重复 ✓');

    // 4) 每 10 个抽样打印
    console.log('[sample]');
    list.slice(0, 10).forEach((u) => console.log(`  - ${u.name} ${u.student_id} ${u.contact || '(无联系方式)'}`));
  } finally {
    srv.kill('SIGTERM');
  }
  console.log(`\n[done] data/db.json 就绪：${DATA_DIR}`);
})().catch((e) => { console.error('异常：', e.message); process.exit(1); });
