'use strict';
/* UI 回归：队长解散自己创建的队伍
 * 用法：node scripts/ui-disband-check.js
 * 隔离：真实数据副本起独立服务（不碰 data/），注入队长 / 普通成员两个会话
 * 截图落盘 .shots/（disband-*.png）
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 3194;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-uidb-'));
const SHOT = path.join(ROOT, '.shots');
const puppeteer = require('C:/Users/12647/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');
const CHROME = 'C:/Users/12647/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${extra}`); }
};

// ---- 数据副本 ----
const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
db.disbanded_teams = db.disbanded_teams || [];
const team = db.teams[0];
if (!team) { console.error('本地无队伍，无法验证'); process.exit(1); }
team.status = 'recruiting'; // 副本内确保未锁定，走队长自主解散分支
const captain = db.users.find((u) => u.id === team.captain_id);
if (!captain) { console.error('找不到队长'); process.exit(1); }
const memberIds = new Set(db.team_members.map((m) => m.user_id));
// 该队的非队长成员（用于验证权限 + 让解散弹窗出现「队友会被移出」文案）
let memberOther = db.users.find((u) => u.id !== captain.id && !u.test && db.team_members.some((m) => m.team_id === team.id && m.user_id === u.id));
if (!memberOther) {
  memberOther = db.users.find((u) => u.id !== captain.id && !u.test && u.status === undefined && !memberIds.has(u.id));
  if (memberOther) {
    db.team_members.push({ id: 'm_uidisband_' + Date.now(), team_id: team.id, user_id: memberOther.id, role_in_team: '测试', joined_at: new Date().toISOString() });
    memberIds.add(memberOther.id);
  }
}
if (!memberOther) { console.error('找不到非队长样例'); process.exit(1); }

const mkToken = (uid, tag) => { db.sessions[tag] = { userId: uid, expiresAt: Date.now() + 3600 * 1000 }; return tag; };
db.sessions = db.sessions || {};
const T_CAP = mkToken(captain.id, 'uidisbandcaptain01');
const T_MEM = mkToken(memberOther.id, 'uidisbandmember001');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'db.json'), JSON.stringify(db));
console.log(`目标队伍「${team.name}」队长=${captain.name} 成员样例=${memberOther.name}`);

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP }, stdio: ['ignore', 'pipe', 'pipe'] });
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

(async () => {
  fs.mkdirSync(SHOT, { recursive: true });
  const srv = await startServer();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const errors = [];
  const bad = [];
  const newPage = async (token, tag = 'p', width = 1280) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setCookie({ name: 'hk_session', value: token, domain: 'localhost', path: '/' });
    await page.setViewport({ width, height: 1000 });
    page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${String(e && e.message)}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); });
    page.on('response', async (res) => {
      const u = res.url();
      if (res.status() >= 400) bad.push(`[${tag}] ${res.request().method()} ${u.replace(`http://localhost:${PORT}`, '')} -> ${res.status()}`);
      if (u.includes('/api/') && (res.request().method() !== 'GET' || res.status() >= 400)) {
        let body = ''; try { body = (await res.text()).slice(0, 160); } catch (e) { /* ignore */ }
        console.log(`    [net:${tag}] ${res.request().method()} ${u.replace(`http://localhost:${PORT}`, '')} -> ${res.status()} ${body}`);
      }
    });
    return page;
  };
  const base = `http://localhost:${PORT}/`;

  try {
    // ---------- 1. 队长管理页出现解散入口 ----------
    const p1 = await newPage(T_CAP, 'cap');
    await p1.goto(base + `#/team/${team.id}/manage`, { waitUntil: 'networkidle2' });
    await sleep(700);
    let txt = await p1.evaluate(() => document.body.innerText);
    check('管理页渲染出「解散队伍」区块', txt.includes('解散队伍'));
    check('解散按钮存在', await p1.$('#disbandBtn') !== null);
    check('危险提示含「不可恢复」', txt.includes('不可恢复'));
    await p1.screenshot({ path: path.join(SHOT, 'disband-1-manage.png'), fullPage: true });

    // ---------- 2. 普通成员进管理页会被挡回（解散前验证权限）----------
    const p2 = await newPage(T_MEM, 'mem');
    await p2.goto(base + `#/team/${team.id}/manage`, { waitUntil: 'networkidle2' });
    await sleep(900);
    const txt2 = await p2.evaluate(() => document.body.innerText);
    check('普通成员访问管理页被拦截', !(await p2.$('#disbandBtn')) && !txt2.includes('解散队伍'), txt2.slice(0, 40).replace(/\n/g, ' '));
    check('成员端提示无权限', txt2.includes('仅队长'), txt2.slice(0, 40).replace(/\n/g, ' '));
    await p2.screenshot({ path: path.join(SHOT, 'disband-2-member-blocked.png') });

    // ---------- 3. 点击 → 二次确认弹窗 ----------
    await p1.click('#disbandBtn');
    await sleep(400);
    const modalText = await p1.evaluate(() => (document.querySelector('#modalBox') || {}).innerText || '');
    check('弹出确认弹窗', modalText.includes('解散队伍'));
    check('弹窗说明后果（不可恢复）', modalText.includes('无法恢复'));
    check('弹窗提示队友会被移出', modalText.includes('队友') && modalText.includes('移出'), modalText.replace(/\n/g, ' ').slice(0, 80));
    check('确认按钮为危险样式', await p1.evaluate(() => !!document.querySelector('#mOk.coral')));
    await p1.screenshot({ path: path.join(SHOT, 'disband-3-confirm.png') });

    // ---------- 4. 取消不生效 ----------
    await p1.click('#mCancel');
    await sleep(300);
    check('取消后仍停留在管理页', (await p1.evaluate(() => location.hash)) === `#/team/${team.id}/manage`);

    // ---------- 5. 确认解散 ----------
    await p1.click('#disbandBtn');
    await sleep(300);
    await p1.click('#mOk');
    await sleep(1200);
    const hash = await p1.evaluate(() => location.hash);
    check('解散后跳转到队伍广场', hash === '#/teams', `hash=${hash}`);
    txt = await p1.evaluate(() => document.body.innerText);
    check('广场不再出现该队', !txt.includes(team.name));
    check('导航不再显示「我的队伍」', !txt.includes('我的队伍'));
    await p1.screenshot({ path: path.join(SHOT, 'disband-4-after.png'), fullPage: true });

    const apiAfter = await p1.evaluate(async (id) => {
      const r = await fetch('/api/teams/' + id);
      return r.status;
    }, team.id);
    check('队伍详情接口返回 404', apiAfter === 404, `status=${apiAfter}`);

    const meAfter = await p1.evaluate(async () => {
      const r = await fetch('/api/auth/me');
      const j = await r.json();
      return j.data;
    });
    check('登录态中 team_id 已清空', meAfter.team_id === '', `team_id=${meAfter.team_id}`);

    // ---------- 6. 解散后原成员可回到广场重新找队 ----------
    await p2.goto(base + '#/teams', { waitUntil: 'networkidle2' });
    await sleep(700);
    const txt3 = await p2.evaluate(() => document.body.innerText);
    check('成员端广场已无该队', !txt3.includes(team.name));

    // ---------- 7. 全站页面无 JS 报错 ----------
    errors.length = 0; bad.length = 0;
    for (const h of ['#/', '#/teams', '#/team/new', '#/me', '#/feed']) {
      await p2.goto(base + h, { waitUntil: 'networkidle2' });
      await sleep(450);
    }
    check('全站浏览无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
    check('全站浏览无失败请求', bad.length === 0, bad.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    srv.kill('SIGTERM');
  }

  console.log(`\n========== 解散队伍 UI 回归 ==========`);
  console.log(`通过 ${pass} / ${pass + fail}${fail ? `，失败 ${fail}` : '，全部通过 ✓'}`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(2); });
