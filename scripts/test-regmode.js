'use strict';
/* 报名模式（survey）+ 批量导入回归测试
 * 用法：node scripts/test-regmode.js
 * 说明：用临时 DATA_DIR 起两个隔离实例（open 模式注册管理员 → survey 模式全流程验证），
 *       不触碰项目 data/ 目录。 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-regmode-'));
let pass = 0, fail = 0;
const results = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name} ${extra}`); }
}

function startServer(port, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), DATA_DIR: TMP, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    const t0 = Date.now();
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (res.ok) { clearInterval(timer); resolve(child); }
      } catch (e) {
        if (Date.now() - t0 > 8000) { clearInterval(timer); reject(new Error('server not up: ' + out)); }
      }
    }, 200);
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.on('exit', resolve);
    child.kill('SIGTERM');
  });
}

async function jfetch(port, p, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) {}
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/hk_session=([^;]+)/);
  return { status: res.status, json, cookie: m ? `hk_session=${m[1]}` : '', raw: setCookie };
}

(async () => {
  const ADMIN_SID = '202440025279';
  const adminUser = {
    name: '雷子希', student_id: ADMIN_SID, password: 'admin123',
    college: '人工智能学院', major: '软件工程', grade: '2024级', contact: '微信 test_admin',
    skills: ['后端'], ai_level: '熟练', bio: '测试管理员',
  };

  // ---------- 阶段 1：open 模式注册管理员 ----------
  let srv = await startServer(3199, { REG_MODE: 'open' });
  let r = await jfetch(3199, '/api/auth/register', { method: 'POST', body: adminUser });
  ok('open 模式下自助注册可用', r.status === 201, `status=${r.status} ${JSON.stringify(r.json)}`);
  ok('open 模式注册返回 role=admin（白名单）', r.json && r.json.data.role === 'admin');
  await stopServer(srv);

  // ---------- 阶段 2：survey 模式全流程 ----------
  srv = await startServer(3199, { REG_MODE: 'survey' });

  // survey 模式：自助注册 → 待审核申请
  r = await jfetch(3199, '/api/auth/register', { method: 'POST', body: { name: '待审同学甲', student_id: '202400000088', password: '123456', contact: '微信 a' } });
  ok('survey 注册返回 pending（201）', r.status === 201 && r.json.data.pending === true, `status=${r.status} ${JSON.stringify(r.json)}`);
  r = await jfetch(3199, '/api/auth/register', { method: 'POST', body: { name: '待审同学乙', student_id: '202400000089', password: '123456', contact: '微信 b' } });
  ok('第二条申请同样 pending', r.status === 201 && r.json.data.pending === true);

  r = await jfetch(3199, '/api/auth/login', { method: 'POST', body: { student_id: '202400000088', password: '123456' } });
  ok('pending 用户不能登录（403 审核中）', r.status === 403 && /审核中/.test((r.json.error || {}).message));

  r = await jfetch(3199, '/api/stats');
  ok('stats 用户数不含待审核', r.json.data.users === 1, `users=${r.json.data.users}`);
  r = await jfetch(3199, '/api/players');
  ok('名片广场不含待审核用户', !r.json.data.some((u) => u.student_id === '202400000088'));

  r = await jfetch(3199, '/api/auth/login', { method: 'POST', body: { student_id: '202400000099', password: '123456' } });
  ok('未报名学号登录提示报名引导（401）', r.status === 401 && /暂无报名记录/.test((r.json.error || {}).message));

  r = await jfetch(3199, '/api/auth/login', { method: 'POST', body: { student_id: ADMIN_SID, password: 'wrong-pass' } });
  ok('密码错误提示初始密码（401）', r.status === 401 && /初始密码/.test((r.json.error || {}).message));

  r = await jfetch(3199, '/api/auth/login', { method: 'POST', body: { student_id: ADMIN_SID, password: 'admin123' } });
  ok('管理员登录成功', r.status === 200 && r.cookie);
  const adminCookie = r.cookie;

  // 审核流：列表 → 通过 / 拒绝
  r = await jfetch(3199, '/api/admin/review', { cookie: adminCookie });
  ok('待审核列表 2 条', r.status === 200 && r.json.data.length === 2);
  const pendingA = r.json.data.find((u) => u.student_id === '202400000088');
  const pendingB = r.json.data.find((u) => u.student_id === '202400000089');
  r = await jfetch(3199, `/api/admin/users/${pendingA.id}/approve`, { method: 'POST', cookie: adminCookie });
  ok('通过申请', r.status === 200);
  r = await jfetch(3199, `/api/admin/users/${pendingB.id}/reject`, { method: 'POST', cookie: adminCookie });
  ok('拒绝申请', r.status === 200);
  r = await jfetch(3199, '/api/admin/review', { cookie: adminCookie });
  ok('审核后列表清空', r.json.data.length === 0);
  r = await jfetch(3199, '/api/auth/login', { method: 'POST', body: { student_id: '202400000088', password: '123456' } });
  ok('通过后可登录', r.status === 200);
  r = await jfetch(3199, '/api/auth/login', { method: 'POST', body: { student_id: '202400000089', password: '123456' } });
  ok('被拒后不能登录（403）', r.status === 403 && /未通过/.test((r.json.error || {}).message));
  r = await jfetch(3199, '/api/stats');
  ok('通过后 stats 计入（2 人）', r.json.data.users === 2, `users=${r.json.data.users}`);
  r = await jfetch(3199, '/api/players');
  ok('通过后名片可见、被拒不可见', r.json.data.some((u) => u.student_id === '202400000088') && !r.json.data.some((u) => u.student_id === '202400000089'));

  // 非管理员不可审核
  r = await jfetch(3199, `/api/admin/users/${pendingB.id}/reject`, { method: 'POST' });
  ok('未登录不可审核（401/403）', r.status === 401 || r.status === 403);

  // 非法数据导入
  r = await jfetch(3199, '/api/admin/import-users', { method: 'POST', cookie: adminCookie, body: { users: [
    { name: '王', student_id: '202400000011' },
    { name: '王小二', student_id: 'xyz' },
    { name: '正常同学', student_id: '202400000001', contact: '微信 wx001', college: '人工智能学院', major: '软件工程', grade: '2024级' },
  ] } });
  ok('导入：2 条无效被拦 + 1 条新增', r.status === 200 && r.json.data.added === 1 && r.json.data.invalid.length === 2, JSON.stringify(r.json));
  ok('无效原因区分姓名/学号', r.json.data.invalid.some((x) => /姓名/.test(x.reason)) && r.json.data.invalid.some((x) => /学号格式/.test(x.reason)));

  // 重复学号 skip
  r = await jfetch(3199, '/api/admin/import-users', { method: 'POST', cookie: adminCookie, body: { users: [{ name: '重复者', student_id: '202400000001' }] } });
  ok('重复学号默认跳过', r.json.data.skipped === 1 && r.json.data.added === 0);

  // fill 模式：仅补充空字段
  r = await jfetch(3199, '/api/admin/import-users', { method: 'POST', cookie: adminCookie, body: { users: [{ name: '正常同学', student_id: '202400000001', contact: '微信 wx001-new', bio: '补一句自荐' }], conflict: 'fill' } });
  ok('fill 模式：更新计数 = 1', r.json.data.updated === 1);

  // dry_run 不写入
  r = await jfetch(3199, '/api/admin/import-users', { method: 'POST', cookie: adminCookie, body: { users: [{ name: '预检同学', student_id: '202400000002' }], dry_run: true } });
  ok('dry_run 报告将新增但不写入', r.json.data.added === 1 && r.json.data.dry_run === true);
  r = await jfetch(3199, '/api/admin/users', { cookie: adminCookie });
  const pre = r.json.data.find((u) => u.student_id === '202400000002');
  ok('dry_run 后用户确实未创建', !pre);

  // 批内去重（同学号取最新）
  r = await jfetch(3199, '/api/admin/import-users', { method: 'POST', cookie: adminCookie, body: { users: [
    { name: '小明旧', student_id: '202400000003', contact: '旧联系' },
    { name: '小明新', student_id: '202400000003', contact: '新联系' },
  ] } });
  ok('批内重复学号只建一个', r.json.data.added === 1 && r.json.data.notes.length === 1);

  // 导入用户可用 学号后6位 登录
  r = await jfetch(3199, '/api/auth/login', { method: 'POST', body: { student_id: '202400000003', password: '000003' } });
  ok('导入用户初始密码=学号后6位 可登录', r.status === 200 && r.json.data.name === '小明新');

  // looking_for_team 透传：明确 false 的落库 false，缺省为 true
  r = await jfetch(3199, '/api/admin/import-users', { method: 'POST', cookie: adminCookie, body: { users: [
    { name: '已组队者', student_id: '202400000005', looking_for_team: false },
  ] } });
  r = await jfetch(3199, '/api/auth/login', { method: 'POST', body: { student_id: '202400000005', password: '000005' } });
  ok('导入 looking_for_team=false 生效', r.status === 200 && r.json.data.looking_for_team === false);
  ok('导入缺省 looking_for_team=true', (await jfetch(3199, '/api/auth/login', { method: 'POST', body: { student_id: '202400000003', password: '000003' } })).json.data.looking_for_team === true);

  // 非管理员不可导入
  const userCookie = r.cookie;
  r = await jfetch(3199, '/api/admin/import-users', { method: 'POST', cookie: userCookie, body: { users: [{ name: '越权', student_id: '202400000004' }] } });
  ok('普通用户导入被拒（403）', r.status === 403, `status=${r.status}`);

  // stats 带 registration
  r = await jfetch(3199, '/api/stats');
  ok('stats.registration.mode=survey', r.json.data.registration && r.json.data.registration.mode === 'survey');
  ok('stats.registration 有 survey_url 字段', 'survey_url' in r.json.data.registration);

  // backup 接口仍可用
  r = await jfetch(3199, '/api/admin/backup', { cookie: adminCookie });
  ok('管理员备份导出可用', r.status === 200 && r.json && Array.isArray(r.json.users));

  await stopServer(srv);

  console.log('\n========== 报名模式 + 导入 回归测试 ==========');
  console.log(results.join('\n'));
  console.log(`\n通过 ${pass} / ${pass + fail}${fail ? `，失败 ${fail}` : '，全部通过 ✓'}`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常：', e); process.exit(2); });
