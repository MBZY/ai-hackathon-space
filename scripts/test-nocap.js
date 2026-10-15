/* 专项验证：组队人数上限已取消 —— 7 人队伍（队长+6）应可正常组建，状态保持 recruiting，响应不含 max_size */
'use strict';
const BASE = 'http://localhost:3100';
async function api(path, opt = {}) {
  const res = await fetch(BASE + path, {
    method: opt.method || 'GET',
    headers: { 'content-type': 'application/json', ...(opt.cookie ? { cookie: opt.cookie } : {}) },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  return { status: res.status, json: await res.json().catch(() => null), cookie: set ? set.split(';')[0] : '' };
}
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name, extra !== undefined ? JSON.stringify(extra) : ''); } };

(async () => {
  const ts = Date.now();
  const users = [];
  for (let i = 0; i < 7; i++) {
    const sid = '9' + String(ts).slice(-10) + i;
    const reg = await api('/api/auth/register', { method: 'POST', body: { name: '压测' + String(ts).slice(-5) + i, student_id: sid, password: 'pass123456', contact: '' } });
    ok(`注册用户${i}（${sid}）`, reg.status === 201 || reg.status === 409, reg.json);
    const login = await api('/api/auth/login', { method: 'POST', body: { student_id: sid, password: 'pass123456' } });
    ok(`登录用户${i}`, login.status === 200, login.json);
    users.push(login.cookie);
  }
  const [cap, ...rest] = users;
  const ct = await api('/api/teams', { method: 'POST', cookie: cap, body: { name: '压测大队' + String(ts).slice(-5), track: 'open', role_in_team: '产品', topic_title: '人数上限专项验证', need_skills: [], contact: 't' } });
  ok('建队 201', ct.status === 201, ct.json);
  const tid = ct.json.data.id;

  for (let i = 0; i < rest.length; i++) {
    const ap = await api(`/api/teams/${tid}/apply`, { method: 'POST', cookie: rest[i], body: { message: '', role_in_team: '测试' } });
    ok(`成员${i + 1} 申请 201（超过旧上限 5 人不再拒绝）`, ap.status === 201, ap.json);
    const mv = await api(`/api/teams/${tid}/manage`, { cookie: cap });
    const pend = mv.json.data.pending_applies[0];
    const ac = await api(`/api/teams/invites/${pend.id}/accept`, { method: 'POST', cookie: cap });
    ok(`成员${i + 1} 审批通过 200`, ac.status === 200, ac.json);
  }

  const det = await api(`/api/teams/${tid}`, { cookie: cap });
  ok('成员数 = 7（队长 + 6）', det.json.data.member_count === 7, det.json.data.member_count);
  ok('状态仍为 recruiting（不产生 full）', det.json.data.status === 'recruiting', det.json.data.status);
  ok('响应已不含 max_size 字段', !('max_size' in det.json.data));

  const del = await api(`/api/teams/${tid}`, { method: 'DELETE', cookie: cap, body: { reason: '测试清理' } });
  ok('解散清理 200', del.status === 200, del.json);

  console.log(`\n== 人数上限专项：${pass} 通过 / ${fail} 失败 ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
