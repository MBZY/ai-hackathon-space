'use strict';
/*
 * XSS 纵深防御回归：姓名白名单 + 历史数据兼容
 * 用法：node scripts/test-xss.js
 *
 * 背景：管理后台曾把用户名拼进内联 onclick 的 JS 字符串（HTML 转义在 JS 字符串上下文里失效），
 *       前端已改为 data-name + event 传值；后端补一道姓名字符白名单作为纵深防御。
 *       本脚本只回归后端这一层：注册、资料更新、批量导入三处校验，以及白名单上线前
 *       已存在的数据不被锁死。
 *
 * 隔离：自起实例，使用临时 DATA_DIR，不触碰项目 data/。
 * 白名单规则与 src-server/auth/index.js 的 NAME_RE 保持一致。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-xss-'));
const PORT = 3196;
const BASE = `http://127.0.0.1:${PORT}`;

const PAYLOAD = "');window.x=1//"; // 15 字符，符合 2-20 字长度要求，只靠白名单挡住
const TAG_PAYLOAD = '<img/x>';

let pass = 0;
let fail = 0;
const results = [];
function check(name, cond, extra) {
  if (cond) { pass += 1; results.push(`  ✓ ${name}`); }
  else { fail += 1; results.push(`  ✗ ${name}${extra !== undefined ? ' => ' + JSON.stringify(extra).slice(0, 200) : ''}`); }
}

// ---------- 造数：一个管理员 + 一条姓名含引号的历史记录 ----------
function newAuth(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, password_hash: crypto.scryptSync(pwd, salt, 32).toString('hex') };
}
function seed() {
  const now = new Date().toISOString();
  const mkUser = (name, sid, role) => ({
    id: 'u_' + crypto.randomBytes(8).toString('hex'),
    name, student_id: sid, college: '人工智能学院', major: '软件工程', grade: '2024级',
    contact: '测试', bio: '', skills: [], ai_level: '入门', looking_for_team: true,
    role, team_id: '', created_at: now, ...newAuth(sid.slice(-6)),
  });
  // 只写必要的键，其余集合由 store.load() 自动补齐
  const db = {
    meta: { version: 1, createdAt: now },
    sessions: {},
    users: [
      mkUser('赛务管理员', '202440025279', 'admin'),
      mkUser(PAYLOAD, '900000000801', 'user'), // 模拟白名单上线前就存在的历史数据
    ],
  };
  fs.writeFileSync(path.join(TMP, 'db.json'), JSON.stringify(db, null, 1));
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP, REG_MODE: 'open' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    const t0 = Date.now();
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) { clearInterval(timer); resolve(child); return; }
      } catch (e) { /* 还没起来 */ }
      if (Date.now() - t0 > 10000) { clearInterval(timer); reject(new Error(out)); }
    }, 200);
  });
}

async function api(p, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const session = setCookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('hk_session=')) || '';
  let json = null;
  try { json = await res.json(); } catch (e) { /* 可能不是 JSON */ }
  return { status: res.status, json, cookie: session };
}

(async () => {
  console.log('\n== XSS 纵深防御回归（姓名白名单）==\n');
  seed();
  const server = await startServer();
  try {
    // ---------- 历史数据不被锁死 ----------
    console.log('[1] 历史数据（姓名含引号）');
    const legacyLogin = await api('/api/auth/login', { method: 'POST', body: { student_id: '900000000801', password: '000801' } });
    check('姓名含引号的历史账号仍可登录', legacyLogin.status === 200, legacyLogin.json);
    const legacyCookie = legacyLogin.cookie;

    const keepSame = await api('/api/players/me', { method: 'PUT', cookie: legacyCookie, body: { name: PAYLOAD } });
    check('历史记录提交原名（未变更）仍可保存', keepSame.status === 200, keepSame.json);

    const fixName = await api('/api/players/me', { method: 'PUT', cookie: legacyCookie, body: { name: '张三' } });
    check('历史记录可改名为合规姓名', fixName.status === 200, fixName.json);

    // ---------- 注册 ----------
    console.log('\n[2] 注册校验');
    const regPayload = await api('/api/auth/register', { method: 'POST', body: { name: PAYLOAD, student_id: '900000000802', password: 'pass123456', contact: 'x' } });
    check('注册：引号注入姓名被拒（422）', regPayload.status === 422, regPayload.json);
    check('注册：拒绝理由指向字符不支持', JSON.stringify(regPayload.json || '').includes('不支持的字符'), regPayload.json);

    const regTag = await api('/api/auth/register', { method: 'POST', body: { name: TAG_PAYLOAD, student_id: '900000000803', password: 'pass123456', contact: 'x' } });
    check('注册：尖括号姓名被拒（422）', regTag.status === 422, regTag.json);

    const regOk = await api('/api/auth/register', { method: 'POST', body: { name: '正常同学', student_id: '900000000804', password: 'pass123456', contact: 'x' } });
    check('注册：中文姓名放行（201）', regOk.status === 201, regOk.json);

    const regDigit = await api('/api/auth/register', { method: 'POST', body: { name: '测试赛务1', student_id: '900000000805', password: 'pass123456', contact: 'x' } });
    check('注册：中文+数字姓名放行（201）', regDigit.status === 201, regDigit.json);

    const regDot = await api('/api/auth/register', { method: 'POST', body: { name: '阿依古丽·阿不都', student_id: '900000000806', password: 'pass123456', contact: 'x' } });
    check('注册：带间隔号的姓名放行（201）', regDot.status === 201, regDot.json);

    // ---------- 资料更新 ----------
    console.log('\n[3] 资料更新校验');
    const updPayload = await api('/api/players/me', { method: 'PUT', cookie: regOk.cookie, body: { name: PAYLOAD } });
    check('改名：引号注入被拒（422）', updPayload.status === 422, updPayload.json);
    const updTag = await api('/api/players/me', { method: 'PUT', cookie: regOk.cookie, body: { name: TAG_PAYLOAD } });
    check('改名：尖括号被拒（422）', updTag.status === 422, updTag.json);
    const updOk = await api('/api/players/me', { method: 'PUT', cookie: regOk.cookie, body: { name: '李四', bio: '正常' } });
    check('改名：合规姓名放行（200）', updOk.status === 200 && updOk.json.data.name === '李四', updOk.json && updOk.json.data);

    // ---------- 批量导入 ----------
    console.log('\n[4] 批量导入校验');
    const adminLogin = await api('/api/auth/login', { method: 'POST', body: { student_id: '202440025279', password: '025279' } });
    check('管理员登录成功', adminLogin.status === 200, adminLogin.json);

    const imp = await api('/api/admin/import-users', {
      method: 'POST',
      cookie: adminLogin.cookie,
      body: {
        users: [
          { name: '王五', student_id: '900000000901', contact: 'x' },
          { name: PAYLOAD, student_id: '900000000902', contact: 'x' },
          { name: TAG_PAYLOAD, student_id: '900000000903', contact: 'x' },
        ],
      },
    });
    const r = (imp.json && imp.json.data) || {};
    check('导入：正常姓名新增 1 条', r.added === 1, r);
    check('导入：两条非法姓名被拦下', r.invalid && r.invalid.length === 2, r.invalid);

    const list = await api('/api/admin/users', { cookie: adminLogin.cookie });
    const names = (list.json && list.json.data ? list.json.data : []).map((u) => u.name);
    check('导入后名单中不含注入姓名', !names.includes(PAYLOAD) && !names.includes(TAG_PAYLOAD), names.filter((n) => /window|img/.test(n)));
    check('导入后名单中含正常姓名', names.includes('王五'), names.slice(-4));
  } finally {
    server.kill('SIGTERM');
  }

  console.log('\n' + results.join('\n'));
  console.log(`\n通过 ${pass} / ${pass + fail}${fail ? '，失败 ' + fail : '，全部通过 ✓'}\n`);
  if (fail) process.exitCode = 1;
})().catch((e) => {
  console.error('测试脚本异常：', e);
  process.exitCode = 1;
});
