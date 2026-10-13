'use strict';
/*
 * 全流程冒烟测试（本地）
 * 用法：PORT=3100 node server.js 启动后，运行 node scripts/smoke-test.js
 * 环境变量 BASE 可覆盖地址，默认 http://localhost:3100
 */

const BASE = process.env.BASE || 'http://localhost:3100';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL ${name}${extra !== undefined ? '  => ' + JSON.stringify(extra).slice(0, 240) : ''}`);
  }
}

async function api(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* non-json */ }
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const session = raw.map((s) => s.split(';')[0]).find((s) => s.startsWith('hk_session=')) || '';
  return { status: res.status, json, text, session };
}

function idOf(u) { return `#${String(u.student_id).slice(-4)}`; }

async function main() {
  const rnd = String(Date.now()).slice(-6);
  const sidA = `9${rnd}1`; // 8 位数字
  const sidB = `9${rnd}2`;
  const sidC = `9${rnd}3`;
  const pw = 'pass123456';

  console.log(`\n== AI 黑客松组队空间 · 全流程冒烟 @ ${BASE} ==\n`);

  // ---------- 0. 基础 ----------
  console.log('[0] 服务基础');
  const health = await api('/api/health');
  check('health 200', health.status === 200 && health.json.status === 'ok');

  // 模式守卫：冒烟测试依赖自助注册造数，survey（问卷报名制）模式下会被拒
  const stats0 = await api('/api/stats');
  if (stats0.json && stats0.json.data && stats0.json.data.registration && stats0.json.data.registration.mode === 'survey') {
    console.error('\n⚠️  当前服务为 survey（问卷报名制）模式，自助注册已关闭，冒烟测试无法造数。');
    console.error('   请用 open 模式重启服务后重跑，例如：');
    console.error('   REG_MODE=open PORT=3100 node server.js\n');
    console.error('   （survey 模式的专项回归请运行：node scripts/test-regmode.js）\n');
    process.exit(1);
  }

  // ---------- 1. 注册 / 登录 ----------
  console.log('\n[1] 注册登录');
  const regA = await api('/api/auth/register', {
    method: 'POST',
    body: { name: '冒烟队长', student_id: sidA, password: pw, college: '人工智能学院', major: '软件工程', grade: '2024级', contact: 'wx_captain_test', skills: ['后端', '算法'], ai_level: '熟练', bio: '测试用队长账号' },
  });
  check('注册 A 201', regA.status === 201, regA.json);
  const cookieA = regA.session;
  check('注册后返回 session cookie', !!cookieA);

  const regB = await api('/api/auth/register', {
    method: 'POST',
    body: { name: '冒烟队员', student_id: sidB, password: pw, contact: 'wx_member_test', skills: ['前端'], ai_level: '入门' },
  });
  check('注册 B 201', regB.status === 201, regB.json);
  const cookieB = regB.session;

  const regDup = await api('/api/auth/register', { method: 'POST', body: { name: '重复', student_id: sidA, password: pw, contact: 'x' } });
  check('重复学号注册 409', regDup.status === 409);

  const loginBad = await api('/api/auth/login', { method: 'POST', body: { student_id: sidA, password: 'wrong-pass' } });
  check('错误密码登录 401', loginBad.status === 401);

  const loginA = await api('/api/auth/login', { method: 'POST', body: { student_id: sidA, password: pw } });
  check('正确登录 200 并返回用户', loginA.status === 200 && loginA.json.data.student_id === sidA);

  // ---------- 2. 建队 ----------
  console.log('\n[2] 建队');
  const createTeam = await api('/api/teams', {
    method: 'POST',
    cookie: cookieA,
    body: { name: `冒烟战队${rnd.slice(-3)}`, track: 'web', role_in_team: '后端', topic_title: '冒烟测试选题', topic_brief: '用于回归验证', need_skills: ['前端'], contact: 'wx_captain_test' },
  });
  check('建队 201', createTeam.status === 201, createTeam.json);
  const teamId = createTeam.json && createTeam.json.data && createTeam.json.data.id;

  const meA = await api('/api/auth/me', { cookie: cookieA });
  check('A /me 返回 team_id', meA.json && meA.json.data.team_id === teamId, meA.json && meA.json.data);

  const createDup = await api('/api/teams', { method: 'POST', cookie: cookieA, body: { name: 'second', track: 'web', topic_title: 'x' } });
  check('一人一队：重复建队 422', createDup.status === 422);

  // ---------- 3. 申请 -> 审批 -> 入队 ----------
  console.log('\n[3] 申请与审批');
  const apply = await api(`/api/teams/${teamId}/apply`, { method: 'POST', cookie: cookieB, body: { role_in_team: '前端', message: '带我上车' } });
  check('B 申请加入 201', apply.status === 201, apply.json);

  const meB0 = await api('/api/auth/me', { cookie: cookieB });
  check('申请未通过前 B 无队伍', meB0.json && meB0.json.data.team_id === '');

  const manage = await api(`/api/teams/${teamId}/manage`, { cookie: cookieA });
  check('队长管理视图含 1 条待审申请', manage.status === 200 && manage.json.data.pending_applies.length === 1, manage.json && manage.json.data && manage.json.data.pending_applies && manage.json.data.pending_applies.length);
  const applyId = manage.json && manage.json.data.pending_applies[0] && manage.json.data.pending_applies[0].id;

  const accept = await api(`/api/teams/invites/${applyId}/accept`, { method: 'POST', cookie: cookieA });
  check('队长通过申请 200', accept.status === 200, accept.json);

  const meB1 = await api('/api/auth/me', { cookie: cookieB });
  check('入队后 B /me 的 team_id 正确', meB1.json && meB1.json.data.team_id === teamId, meB1.json && meB1.json.data && { team_id: meB1.json.data.team_id, expected: teamId });

  const teamView = await api(`/api/teams/${teamId}`, { cookie: cookieB });
  check('队伍详情 member_count=2', teamView.json && teamView.json.data.member_count === 2, teamView.json && teamView.json.data && teamView.json.data.member_count);

  // ---------- 4. 通知 ----------
  console.log('\n[4] 通知中心');
  const notif = await api('/api/notifications', { cookie: cookieB });
  check('通知返回结构 { list, unread }', notif.json && Array.isArray(notif.json.data.list) && typeof notif.json.data.unread === 'number', notif.json && notif.json.data);
  const readAll = await api('/api/notifications/read-all', { method: 'POST', cookie: cookieB });
  check('全部已读 200', readAll.status === 200);
  const notif2 = await api('/api/notifications', { cookie: cookieB });
  check('已读后 unread=0', notif2.json && notif2.json.data.unread === 0, notif2.json && notif2.json.data && notif2.json.data.unread);

  // ---------- 5. 私信 ----------
  console.log('\n[5] 私信');
  const sendMsg = await api('/api/messages', { method: 'POST', cookie: cookieB, body: { to_id: meA.json.data.id, content: '队长你好，几点开工？' } });
  check('B 发私信给 A 201', sendMsg.status === 201, sendMsg.json);

  const convB = await api('/api/messages/conversations', { cookie: cookieB });
  check('会话列表结构 { list, total_unread }', convB.json && Array.isArray(convB.json.data.list) && typeof convB.json.data.total_unread === 'number', convB.json && convB.json.data);

  const convA = await api('/api/messages/conversations', { cookie: cookieA });
  check('A 有 1 条未读', convA.json && convA.json.data.total_unread === 1, convA.json && convA.json.data);

  const chatA = await api(`/api/messages/${meB1.json.data.id}`, { cookie: cookieA });
  check('聊天记录结构 { messages, peer }', chatA.json && Array.isArray(chatA.json.data.messages) && chatA.json.data.peer && chatA.json.data.peer.name === '冒烟队员', chatA.json && chatA.json.data);

  const chatA2 = await api(`/api/messages/${meB1.json.data.id}`, { cookie: cookieA });
  check('查看会话后消息已读', chatA2.json && chatA2.json.data.messages.every((m) => m.is_read));

  // ---------- 6. 名片广场 ----------
  console.log('\n[6] 名片广场');
  const searchSid = await api('/api/players?q=' + sidA, { cookie: cookieB });
  check('按学号搜索能命中', searchSid.json && searchSid.json.data.some((u) => u.student_id === sidA), searchSid.json && searchSid.json.data && searchSid.json.data.length);

  const searchName = await api('/api/players?q=' + encodeURIComponent('冒烟队长'), { cookie: cookieB });
  check('按姓名搜索能命中', searchName.json && searchName.json.data.some((u) => u.student_id === sidA));

  const guestPlayers = await api('/api/players');
  check('游客视角不暴露联系方式', guestPlayers.json && guestPlayers.json.data.every((u) => u.contact === undefined));

  // ---------- 7. 进度日志 ----------
  console.log('\n[7] 进度日志');
  const prog = await api(`/api/teams/${teamId}/progress`, { method: 'POST', cookie: cookieB, body: { stage: '开发实现', content: '冒烟：进度一条' } });
  check('队员发布进度 201', prog.status === 201);
  const teamView2 = await api(`/api/teams/${teamId}`);
  check('队伍详情含进度', teamView2.json && teamView2.json.data.progress.length === 1);

  // ---------- 8. 权限 ----------
  console.log('\n[8] 权限边界');
  const manageByB = await api(`/api/teams/${teamId}/manage`, { cookie: cookieB });
  check('非队长访问管理视图 403', manageByB.status === 403);
  const anonManage = await api(`/api/teams/${teamId}/manage`);
  check('游客访问管理视图 401', anonManage.status === 401);
  const exportByB = await api('/api/admin/export?type=teams', { cookie: cookieB });
  check('非管理员导出 403', exportByB.status === 403);

  // ---------- 9. 管理员 ----------
  console.log('\n[9] 赛务后台');
  // 白名单学号注册即 admin —— 仅本地测试库
  const regAdmin = await api('/api/auth/register', { method: 'POST', body: { name: '冒烟赛务', student_id: '202440025279', password: pw, contact: 'wx_admin_test' } });
  let adminCookie = regAdmin.status === 201 ? regAdmin.session : '';
  if (regAdmin.status === 409) {
    const relogin = await api('/api/auth/login', { method: 'POST', body: { student_id: '202440025279', password: pw } });
    check('管理员账号已存在（登录复用）', relogin.status === 200, relogin.json);
    if (relogin.status === 200) {
      adminCookie = relogin.session;
      const me2 = await api('/api/auth/me', { cookie: relogin.session });
      check('管理员 role=admin', me2.json && me2.json.data.role === 'admin');
    }
  } else {
    check('管理员注册 201', regAdmin.status === 201, regAdmin.json);
    const me2 = await api('/api/auth/me', { cookie: adminCookie });
    check('管理员 role=admin', me2.json && me2.json.data.role === 'admin');
  }
  const adminGet = adminCookie || '';
  if (adminGet) {
    const ov = await api('/api/admin/overview', { cookie: adminGet });
    check('后台总览 200', ov.status === 200, ov.json);
    const csv = await api('/api/admin/export?type=teams', { cookie: adminGet });
    check('CSV 导出 200', csv.status === 200 && csv.text.includes('队伍名称'));
    const csvP = await api('/api/admin/export?type=players', { cookie: adminGet });
    check('人员表导出 200', csvP.status === 200 && csvP.text.includes('学号'));
    const lockT = await api(`/api/admin/teams/${teamId}/lock`, { method: 'POST', cookie: adminGet });
    check('管理员锁定队伍 200', lockT.status === 200);
    const tLocked = await api(`/api/teams/${teamId}`);
    check('锁定后状态 locked', tLocked.json && tLocked.json.data.status === 'locked');
    const unlockT = await api(`/api/admin/teams/${teamId}/unlock`, { method: 'POST', cookie: adminGet });
    check('管理员解锁队伍 200', unlockT.status === 200);
    const ann = await api('/api/announcements', { method: 'POST', cookie: adminGet, body: { title: '冒烟公告', content: '这是一条测试公告' } });
    check('发布公告 201', ann.status === 201, ann.json);
    const annList = await api('/api/announcements');
    check('公告列表含新公告', annList.json && annList.json.data.some((a) => a.title === '冒烟公告'));
  } else {
    check('管理员登录可用（跳过后台断言）', false);
  }

  // ---------- 10. 改密 ----------
  console.log('\n[10] 修改密码');
  const chg = await api('/api/auth/change-password', { method: 'POST', cookie: cookieA, body: { old_password: pw, new_password: 'new-pass-7788' } });
  check('修改密码接口可用', chg.status === 200, chg.json);
  if (chg.status === 200) {
    const reLogin = await api('/api/auth/login', { method: 'POST', body: { student_id: sidA, password: 'new-pass-7788' } });
    check('新密码可登录', reLogin.status === 200);
    const oldLogin = await api('/api/auth/login', { method: 'POST', body: { student_id: sidA, password: pw } });
    check('旧密码已失效', oldLogin.status === 401);
    await api('/api/auth/change-password', { method: 'POST', cookie: cookieA, body: { old_password: 'new-pass-7788', new_password: pw } });
  }

  // ---------- 汇总 ----------
  console.log(`\n== 结果：${pass} 通过 / ${fail} 失败 ==`);
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('测试脚本异常：', e);
  process.exitCode = 1;
});
