'use strict';
/* 申请/审批 + 联系方式可见性 回归测试
 * 用法：node scripts/test-apply-flow.js
 * 隔离：临时 DATA_DIR（REG_MODE=open 便于测试注册默认值），不碰项目 data/
 * 覆盖：
 *  1) 联系方式默认不公开 / 本人可见 / 开启公开后他人可见 / 关闭后恢复隐藏 / 注册默认关闭
 *  2) 申请→队长管理页可见（含联系方式 reveal）/ 重复申请 / 撤回 / 重新申请
 *  3) 通过（入队 + 队友互见 + 外人不可见 + 分工落库）/ 拒绝（通知文案）
 *  4) 邀请→我的待处理→接受/婉拒/撤回（通知文案）
 *  5) 一人一队：入队后其余 pending 自动失效 + 队长收到失效通知
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-apply-'));
const PORT = 3196;
let pass = 0, fail = 0;
const results = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; results.push(`  ✓ ${name}`); } else { fail++; results.push(`  ✗ ${name} ${extra}`); } };

function seed() {
  const salt = () => crypto.randomBytes(16).toString('hex');
  const hash = (pwd, s) => crypto.scryptSync(pwd, s, 32).toString('hex');
  const mk = (id, name, sid, contact) => ({
    id, name, student_id: sid, college: '人工智能学院', major: '软件工程', grade: '2024级',
    contact, skills: ['前端开发'], ai_level: '入门', bio: `${name}的自荐`, looking_for_team: true, role: 'user', team_id: '',
    created_at: new Date().toISOString(),
    ...(() => { const s = salt(); return { salt: s, password_hash: hash('p1234567', s) }; })(),
  });
  const db = {
    meta: { version: 1, createdAt: new Date().toISOString() },
    sessions: {},
    users: [
      mk('u_cap', '队长甲', '202400000101', '微信 cap'),
      mk('u_cap2', '队长乙', '202400000102', '微信 cap2'),
      mk('u_a', '选手甲', '202400000103', '微信 aaa'),
      mk('u_b', '选手乙', '202400000104', '微信 bbb'),
      mk('u_c', '选手丙', '202400000105', '微信 ccc'),
    ],
    teams: [], team_members: [], invites: [], messages: [], notifications: [], progress_logs: [],
    announcements: [], projects: [], milestone_checks: [], project_likes: [],
  };
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, 'db.json'), JSON.stringify(db));
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP, REG_MODE: 'open' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (out += b));
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

const login = async (sid) => {
  const r = await jfetch('/api/auth/login', { method: 'POST', body: { student_id: sid, password: 'p1234567' } });
  return r.cookie;
};
// 从 /api/players 拉某个人的名片数据（登录态）
const playerOf = async (cookie, q) => {
  const r = await jfetch('/api/players?q=' + encodeURIComponent(q), { cookie });
  return (r.json && r.json.data || []).find((u) => u.name === q) || null;
};
const notifTitles = async (cookie) => {
  const r = await jfetch('/api/notifications', { cookie });
  return (r.json && r.json.data.list || []).map((n) => n.title);
};

(async () => {
  seed();
  const srv = await startServer();
  try {
    // ---------- 登录 ----------
    const capC = await login('202400000101');
    const cap2C = await login('202400000102');
    const aC = await login('202400000103');
    const bC = await login('202400000104');
    const cC = await login('202400000105');
    ok('5 个账号登录', !!(capC && cap2C && aC && bC && cC));

    // ---------- 1. 联系方式可见性 ----------
    let p = await playerOf(bC, '选手甲');
    ok('默认不公开：他人视角 contact=undefined', p && p.contact === undefined, JSON.stringify(p && p.contact));
    ok('默认不公开：contact_visible=false', p && p.contact_visible === false);

    p = await playerOf(aC, '选手甲');
    ok('本人视角可见自己的联系方式', p && p.contact === '微信 aaa', JSON.stringify(p && p.contact));

    let r = await jfetch('/api/players', {});
    ok('游客视角全部无 contact', r.json.data.every((u) => u.contact === undefined));

    r = await jfetch('/api/players/me', { method: 'PUT', cookie: aC, body: { contact_visible: true } });
    ok('开启公开 200', r.status === 200 && r.json.data.contact_visible === true, JSON.stringify(r.json && r.json.data));

    p = await playerOf(bC, '选手甲');
    ok('开启后他人可见', p && p.contact === '微信 aaa', JSON.stringify(p && p.contact));

    r = await jfetch('/api/players/me', { method: 'PUT', cookie: aC, body: { contact_visible: false } });
    p = await playerOf(bC, '选手甲');
    ok('关闭后恢复隐藏', r.status === 200 && p && p.contact === undefined);

    // 注册默认不公开（open 模式）
    r = await jfetch('/api/auth/register', { method: 'POST', body: { name: '新同学', student_id: '202400000199', password: 'p1234567', contact: '微信 new' } });
    ok('注册成功且默认 contact_visible=false', r.status === 201 && r.json.data.contact_visible === false, JSON.stringify(r.json && r.json.data));
    ok('注册响应（本人）自带 contact', r.json.data.contact === '微信 new');

    // ---------- 2. 建队 + 申请 ----------
    r = await jfetch('/api/teams', { method: 'POST', cookie: capC, body: { name: '测试队甲', track: 'web', topic_title: '选题甲', contact: '微信 cap', role_in_team: '产品' } });
    ok('队长甲建队 201', r.status === 201, JSON.stringify(r.json));
    const t1 = r.json.data.id;
    r = await jfetch('/api/teams', { method: 'POST', cookie: cap2C, body: { name: '测试队乙', track: 'game', topic_title: '选题乙', contact: '微信 cap2' } });
    const t2 = r.json.data.id;
    ok('队长乙建队 201', r.status === 201);

    r = await jfetch(`/api/teams/${t1}/apply`, { method: 'POST', cookie: aC, body: { role_in_team: '前端', message: '带我上车' } });
    ok('甲申请加入 201', r.status === 201, JSON.stringify(r.json));
    r = await jfetch(`/api/teams/${t1}/apply`, { method: 'POST', cookie: aC, body: { role_in_team: '前端' } });
    ok('重复申请被拒 409', r.status === 409, `status=${r.status}`);
    r = await jfetch(`/api/teams/${t1}/apply`, { method: 'POST', cookie: bC, body: { role_in_team: '后端', message: '乙来也' } });
    ok('乙申请加入 201', r.status === 201);

    r = await jfetch(`/api/teams/${t1}`, { cookie: aC });
    ok('详情：my_pending_apply 存在', !!r.json.data.my_pending_apply && r.json.data.my_pending_apply.status === 'pending');
    ok('详情：申请人 my_role=guest', r.json.data.my_role === 'guest');

    r = await jfetch(`/api/teams/${t1}/manage`, { cookie: capC });
    const applies = r.json.data.pending_applies;
    ok('队长管理页看到 2 条待审', applies.length === 2, `len=${applies.length}`);
    const apA = applies.find((x) => x.user_id === 'u_a');
    ok('待审申请附带联系方式（revealContact，默认不公开也可见）', apA && apA.user.contact === '微信 aaa', JSON.stringify(apA && apA.user));
    ok('待审申请带分工与自荐语', apA && apA.role_in_team === '前端' && apA.message === '带我上车');
    ok('管理页含已发出邀请结构', Array.isArray(r.json.data.pending_invites));

    // 非队长不能审批
    r = await jfetch(`/api/teams/invites/${apA.id}/accept`, { method: 'POST', cookie: bC });
    ok('非队长审批被拒 403', r.status === 403, `status=${r.status}`);

    // ---------- 3. 撤回 + 重新申请 ----------
    const apB = applies.find((x) => x.user_id === 'u_b');
    r = await jfetch(`/api/teams/invites/${apB.id}/cancel`, { method: 'POST', cookie: bC });
    ok('申请人撤回 200', r.status === 200, JSON.stringify(r.json));
    r = await jfetch(`/api/teams/${t1}/apply`, { method: 'POST', cookie: bC, body: { role_in_team: '后端' } });
    ok('撤回后可重新申请 201', r.status === 201, `status=${r.status}`);

    // ---------- 4. 拒绝申请 → 通知文案（用丙的申请验证；乙的申请保留，供第 7 步验证自动作废） ----------
    r = await jfetch(`/api/teams/${t1}/apply`, { method: 'POST', cookie: cC, body: { role_in_team: '宣发', message: '丙来也' } });
    ok('丙申请加入 201', r.status === 201);
    const apC = (await jfetch(`/api/teams/${t1}/manage`, { cookie: capC })).json.data.pending_applies.find((x) => x.user_id === 'u_c');
    r = await jfetch(`/api/teams/invites/${apC.id}/decline`, { method: 'POST', cookie: capC });
    ok('队长拒绝申请 200', r.status === 200);
    let titles = await notifTitles(cC);
    ok('被拒方收到「申请未通过」通知', titles.some((t) => t.includes('申请未通过') && t.includes('测试队甲')), JSON.stringify(titles.slice(0, 3)));

    // ---------- 5. 通过申请 → 入队 ----------
    r = await jfetch(`/api/teams/invites/${apA.id}/accept`, { method: 'POST', cookie: capC });
    ok('队长通过申请 200', r.status === 200, JSON.stringify(r.json));

    r = await jfetch(`/api/teams/${t1}`, { cookie: aC });
    ok('甲入队后 my_role=member', r.json.data.my_role === 'member');
    ok('队伍人数 2', r.json.data.member_count === 2, `count=${r.json.data.member_count}`);
    const memberA = r.json.data.members.find((m) => m.user_id === 'u_a');
    ok('入队分工落库（前端）', memberA && memberA.role_in_team === '前端', JSON.stringify(memberA));

    titles = await notifTitles(aC);
    ok('新成员收到入队通知', titles.some((t) => t.includes('你已加入') && t.includes('测试队甲')), JSON.stringify(titles.slice(0, 3)));

    // 队友互见联系方式
    r = await jfetch(`/api/teams/${t1}`, { cookie: capC });
    const mvA = r.json.data.members.find((m) => m.user_id === 'u_a');
    ok('队友互见联系方式（队长视角）', mvA && mvA.user.contact === '微信 aaa', JSON.stringify(mvA && mvA.user.contact));
    // 外人不可见
    r = await jfetch(`/api/teams/${t1}`, { cookie: cC });
    const mvA2 = r.json.data.members.find((m) => m.user_id === 'u_a');
    ok('外人视角队友联系方式隐藏', mvA2 && mvA2.user.contact === undefined, JSON.stringify(mvA2 && mvA2.user.contact));

    // 一人一队：已入队的甲再申请乙队 → 409
    r = await jfetch(`/api/teams/${t2}/apply`, { method: 'POST', cookie: aC, body: {} });
    ok('已入队者再申请 → 409', r.status === 409, `status=${r.status}`);

    // ---------- 6. 邀请流程 ----------
    r = await jfetch(`/api/teams/${t2}/invite`, { method: 'POST', cookie: cap2C, body: { user_id: 'u_b', message: '来乙队' } });
    ok('邀请 201', r.status === 201, JSON.stringify(r.json));
    r = await jfetch(`/api/teams/${t2}/invite`, { method: 'POST', cookie: cap2C, body: { user_id: 'u_b' } });
    ok('重复邀请 409', r.status === 409);

    r = await jfetch(`/api/teams/${t2}`, { cookie: bC });
    ok('被邀者详情：my_pending_invite 存在', !!r.json.data.my_pending_invite && r.json.data.my_pending_invite.status === 'pending');

    r = await jfetch('/api/teams/invites/mine', { cookie: bC });
    const mineB = r.json.data;
    ok('myInvites 含待处理邀请（带 team_name）', mineB.some((i) => i.status === 'pending' && i.direction === 'invite' && i.team_name === '测试队乙'), JSON.stringify(mineB.slice(0, 2)));

    const invB = mineB.find((i) => i.status === 'pending' && i.direction === 'invite');
    r = await jfetch(`/api/teams/invites/${invB.id}/accept`, { method: 'POST', cookie: bC });
    ok('乙接受邀请 200', r.status === 200, JSON.stringify(r.json));

    r = await jfetch(`/api/teams/${t2}`, { cookie: cap2C });
    ok('乙入队（队乙 2 人）', r.json.data.member_count === 2, `count=${r.json.data.member_count}`);
    titles = await notifTitles(cap2C);
    ok('邀请人被通知「已加入」', titles.some((t) => t.includes('选手乙') && t.includes('已加入')), JSON.stringify(titles.slice(0, 3)));

    // ---------- 7. 一人一队：入队后其余 pending 自动失效 ----------
    // 乙此前申请过队甲（第 3 步重新申请后未处理）——现在乙已入队乙，该申请应自动 expired
    r = await jfetch(`/api/teams/${t1}/manage`, { cookie: capC });
    ok('队甲待审不再含乙（自动失效）', !r.json.data.pending_applies.some((x) => x.user_id === 'u_b'), JSON.stringify(r.json.data.pending_applies.map((x) => x.user_id)));
    titles = await notifTitles(capC);
    ok('队甲队长收到「已加入其他队伍」通知', titles.some((t) => t.includes('选手乙') && t.includes('已加入其他队伍')), JSON.stringify(titles.slice(0, 4)));
    r = await jfetch('/api/teams/invites/mine', { cookie: bC });
    ok('乙的申请记录显示 expired', r.json.data.some((i) => i.direction === 'apply' && i.status === 'expired' && i.team_name === '测试队甲'));

    // ---------- 8. 婉拒 / 撤回邀请 ----------
    r = await jfetch(`/api/teams/${t2}/invite`, { method: 'POST', cookie: cap2C, body: { user_id: 'u_c' } });
    ok('邀请丙 201', r.status === 201, JSON.stringify(r.json));
    r = await jfetch('/api/teams/invites/mine', { cookie: cC });
    const invC = r.json.data.find((i) => i.status === 'pending' && i.direction === 'invite');
    r = await jfetch(`/api/teams/invites/${invC.id}/decline`, { method: 'POST', cookie: cC });
    ok('丙婉拒邀请 200', r.status === 200);
    titles = await notifTitles(cap2C);
    ok('邀请人收到「婉拒」通知', titles.some((t) => t.includes('选手丙') && t.includes('婉拒')), JSON.stringify(titles.slice(0, 3)));

    r = await jfetch(`/api/teams/${t2}/invite`, { method: 'POST', cookie: cap2C, body: { user_id: 'u_c' } });
    ok('婉拒后可再次邀请 201', r.status === 201);
    r = await jfetch(`/api/teams/${t2}/manage`, { cookie: cap2C });
    const pinv = r.json.data.pending_invites.find((x) => x.user_id === 'u_c');
    ok('管理页显示已发出邀请', !!pinv && pinv.user_name === '选手丙', JSON.stringify(r.json.data.pending_invites));
    r = await jfetch(`/api/teams/invites/${pinv.id}/cancel`, { method: 'POST', cookie: cap2C });
    ok('队长撤回邀请 200', r.status === 200);
    titles = await notifTitles(cC);
    ok('被邀者收到「撤回邀请」通知', titles.some((t) => t.includes('撤回了邀请')), JSON.stringify(titles.slice(0, 3)));

    // ---------- 9. 名片广场：已入队者信息 ----------
    p = await playerOf(cC, '选手甲');
    ok('名片广场含队名（已入队）', p && p.team_name === '测试队甲', JSON.stringify(p && p.team_name));

    // ---------- 汇总 ----------
    console.log(`\n== 申请/审批 + 联系方式可见性 测试 @ ${PORT} ==\n`);
    results.forEach((l) => console.log(l));
    console.log(`\n${pass} 通过 / ${fail} 失败\n`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error('测试异常：', e);
    console.error(results.join('\n'));
    process.exitCode = 1;
  } finally {
    srv.kill();
  }
})();
