'use strict';
/* UI 回归：选手名片（联系方式可见性/布局）+ 申请·邀请·审批 全流程
 * 用法：node scripts/ui-apply-check.js
 * 隔离：真实数据副本起独立服务（不碰 data/），注入 3 个会话（自由同学 / 队长 / 已入队者）
 * 截图落盘 .shots/（after-*.png）
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 3193;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-uiv-'));
const SHOT = path.join(ROOT, '.shots');
const puppeteer = require('C:/Users/12647/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');
const CHROME = 'C:/Users/12647/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${extra}`); }
};

// ---- 准备数据副本 ----
const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
const memberIds = new Set(db.team_members.map((m) => m.user_id));
const team = db.teams[0];
if (!team) { console.error('本地无队伍，无法验证'); process.exit(1); }
team.status = 'recruiting'; // 本地队伍可能是 locked，副本内改为招募中以验证申请/邀请链路
const captain = db.users.find((u) => u.id === team.captain_id);
const free = (name) => db.users.find((u) => u.name === name);
const viewer1 = free('曾睿') || db.users.find((u) => !memberIds.has(u.id) && !u.test && u.status === undefined);
const targetHidden = free('沈皓宇') || db.users.find((u) => !u.test && String(u.contact || '').length > 20);
const targetShown = free('李之博') || db.users.find((u) => u !== viewer1 && u !== targetHidden && !u.test);
let memberOther = db.users.find((u) => u.id !== captain.id && memberIds.has(u.id));
// 队伍若只有队长一人，复制数据里补一名成员（不依赖真实数据形态）
if (!memberOther) {
  memberOther = db.users.find((u) => u !== viewer1 && u !== targetHidden && u !== targetShown && u.id !== captain.id && !u.test);
  db.team_members.push({ id: 'm_uicheck_' + Date.now(), team_id: team.id, user_id: memberOther.id, role_in_team: '测试', joined_at: new Date().toISOString() });
  memberIds.add(memberOther.id);
}
targetShown.contact_visible = true; // 「主动公开」样例
if (viewer1 === targetHidden || viewer1 === targetShown || !memberOther) { console.error('样例用户选择失败'); process.exit(1); }

const mkToken = (uid, tag) => { db.sessions[tag] = { userId: uid, expiresAt: Date.now() + 3600 * 1000 }; return tag; };
db.sessions = db.sessions || {};
const T1 = mkToken(viewer1.id, 'uiviewer1000000001');
const T2 = mkToken(captain.id, 'uiviewer1000000002');
const T3 = mkToken(memberOther.id, 'uiviewer1000000003');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'db.json'), JSON.stringify(db));
console.log(`观者1=${viewer1.name}(自由) 观者2=${captain.name}(队长) 观者3=${memberOther.name}(已入队)`);
console.log(`样例：隐藏=${targetHidden.name} 公开=${targetShown.name}`);

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
  const newPage = async (token, width = 1280) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setCookie({ name: 'hk_session', value: token, domain: 'localhost', path: '/' });
    await page.setViewport({ width, height: 940 });
    page.on('response', async (res) => {
      const u = res.url();
      const m = res.request().method();
      // 只打印写操作与失败响应，便于定位问题
      if (u.includes('/api/') && (m !== 'GET' || res.status() >= 400)) {
        let body = '';
        try { body = (await res.text()).slice(0, 160); } catch (e) { /* ignore */ }
        console.log(`    [net] ${m} ${u.replace(`http://localhost:${PORT}`, '')} -> ${res.status()} ${body}`);
      }
    });
    return page;
  };
  // 强制整页重载（相同 hash 直接 goto 不会触发任何事件，必须带唯一查询串）
  const goto = async (page, hash) => { await page.goto(`http://localhost:${PORT}/?r=${Date.now()}${hash}`, { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {}); await sleep(600); };
  const searchAndShot = async (page, name, file) => {
    await page.$eval('#pkSearch', (el) => { el.value = ''; }).catch(() => {});
    await page.type('#pkSearch', name, { delay: 10 });
    await sleep(900);
    const card = await page.$('#pkList .card');
    if (card && file) await card.screenshot({ path: path.join(SHOT, file) });
    return card;
  };

  console.log('\n== UI 验证 ==\n');
  try {
    // ========== 观者1：普通同学视角 ==========
    const p1 = await newPage(T1);
    await goto(p1, '#/players');

    let card = await searchAndShot(p1, targetHidden.name, 'after-card-hidden.png');
    let hint = card ? await card.$eval('.contact-row', (el) => el.textContent) : '';
    check('名片卡：未公开提示', hint.includes('未公开'), hint);
    let subText = card ? await card.$eval('.player-sub', (el) => el.textContent) : '';
    check('名片卡：元信息含年级', /级/.test(subText), subText);

    card = await searchAndShot(p1, targetShown.name, 'after-card-shown.png');
    const shownContact = card ? await card.$eval('.contact-row b', (el) => el.textContent).catch(() => '') : '';
    check('名片卡：已公开联系方式展示', shownContact.includes('微信'), shownContact);
    const inviteBtn = card ? await card.$$eval('.player-actions .btn.sm:not(.outline)', (els) => els.length).catch(() => 0) : 0;
    check('普通同学看不到「邀请入队」', inviteBtn === 0, `found=${inviteBtn}`);

    // 自己的卡
    card = await searchAndShot(p1, viewer1.name, 'after-card-self.png');
    const selfText = card ? await card.$eval('.player-actions', (el) => el.textContent) : '';
    check('自己名片显示「编辑名片」', selfText.includes('编辑名片'), selfText);
    const selfTag = card ? await card.$eval('.contact-row', (el) => el.textContent) : '';
    check('自己名片显示可见性标记', selfTag.includes('未公开') || selfTag.includes('已公开'), selfTag);

    // ========== 队长视角：邀请 + 申请管理 ==========
    const p2 = await newPage(T2);
    await goto(p2, '#/players');
    card = await searchAndShot(p2, viewer1.name, 'after-card-invitebtn.png');
    const hasInvite = card ? await card.$$eval('.player-actions .btn.sm:not(.outline)', (els) => els.map((e) => e.textContent)).catch(() => []) : [];
    check('队长可见「邀请入队」按钮', hasInvite.some((t) => t.includes('邀请')), JSON.stringify(hasInvite));
    // 点击邀请并发起
    if (hasInvite.length) {
      await card.$eval('.player-actions .btn.sm:not(.outline)', (el) => el.click());
      await sleep(400);
      const modalTitle = await p2.$eval('#modalBox h3', (el) => el.textContent).catch(() => '');
      check('邀请弹窗打开', modalTitle.includes('邀请'), modalTitle);
      await p2.click('#invSend');
      await sleep(800);
      const invited = await p2.$eval('#pkList', (el) => el.textContent);
      check('邀请后按钮变「已邀请」', invited.includes('已邀请'), invited.slice(0, 80));
    }
    // 队长管理页：已发出的邀请
    await goto(p2, `#/team/${team.id}/manage`);
    const manageText = await p2.$eval('#view', (el) => el.textContent);
    check('管理页显示已发出邀请', manageText.includes('已发出的邀请') && manageText.includes(viewer1.name), manageText.slice(0, 120));
    // 撤回邀请
    const cancelInvBtn = await p2.$$eval('button', (els) => els.some((e) => e.textContent.includes('撤回邀请')));
    check('管理页有撤回邀请按钮', cancelInvBtn);
    if (cancelInvBtn) {
      await p2.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((e) => e.textContent.includes('撤回邀请')); b && b.click(); });
      await sleep(800);
      const after = await p2.$eval('#view', (el) => el.textContent);
      check('撤回后列表更新', !after.includes('已发出的邀请'), after.slice(0, 100));
    }

    // ========== 观者1：申请加入全流程 ==========
    await goto(p1, `#/team/${team.id}`);
    let applyExists = await p1.$('#btnApply');
    check('队伍详情有「申请加入」按钮', !!applyExists);
    await p1.screenshot({ path: path.join(SHOT, 'after-team-detail.png'), fullPage: true });
    if (applyExists) {
      await p1.click('#btnApply');
      await sleep(400);
      const apTitle = await p1.$eval('#modalBox h3', (el) => el.textContent).catch(() => '');
      check('申请弹窗打开', apTitle.includes('申请加入'), apTitle);
      const apHint = await p1.$eval('#modalBox', (el) => el.textContent).catch(() => '');
      check('申请弹窗提示联系可见性', apHint.includes('联系方式'), apHint.slice(0, 80));
      await p1.click('#apSubmit');
      await sleep(900);
      const detailText = await p1.$eval('#view', (el) => el.textContent);
      check('申请后显示「已申请，等待队长处理」', detailText.includes('已申请，等待队长处理'), detailText.slice(0, 100));
      check('申请后「申请加入」按钮消失', !(await p1.$('#btnApply')));
      check('申请后有「撤回申请」按钮', detailText.includes('撤回申请'));
      await p1.screenshot({ path: path.join(SHOT, 'after-team-applied.png'), fullPage: true });
      // 撤回
      await p1.click('#btnCancelApply');
      await sleep(400);
      await p1.click('#mOk');
      await sleep(900);
      const afterCancel = await p1.$eval('#view', (el) => el.textContent);
      check('撤回后恢复「申请加入」', afterCancel.includes('申请加入') && !afterCancel.includes('等待队长处理'), afterCancel.slice(0, 100));
    }

    // ========== 观者2：管理页看到申请（观者1 已撤回，重新申请一次） ==========
    await goto(p1, `#/team/${team.id}`);
    if (await p1.$('#btnApply')) { await p1.click('#btnApply'); await sleep(300); await p1.click('#apSubmit'); await sleep(800); }
    await goto(p2, `#/team/${team.id}/manage`);
    const mgText = await p2.$eval('#view', (el) => el.textContent);
    check('队长管理页出现待审申请', mgText.includes('待审申请') && mgText.includes(viewer1.name), mgText.slice(0, 120));
    const hasBioLine = mgText.includes('一句话自荐');
    check('待审卡片含自荐语行', hasBioLine || mgText.includes('（无自荐语）'));
    await p2.screenshot({ path: path.join(SHOT, 'after-manage-applies.png'), fullPage: true });
    // 通过申请
    await p2.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((e) => e.textContent.trim() === '通过'); b && b.click(); });
    await sleep(900);
    const mgAfter = await p2.$eval('#view', (el) => el.textContent);
    check('通过后成员列表含新成员', mgAfter.includes(viewer1.name), mgAfter.slice(0, 120));

    // ========== 观者3：已入队者的详情页 ==========
    const p3 = await newPage(T3);
    await goto(p3, `#/team/${team.id}`);
    const p3Text = await p3.$eval('#view', (el) => el.textContent);
    check('队员视角无「申请加入」', !p3Text.includes('申请加入'));
    check('队员可见队伍进度区', p3Text.includes('队伍进度'));

    // ========== 我的空间：可见性开关 ==========
    await goto(p1, '#/my');
    const hasToggle = !!(await p1.$('#pfContactVisible'));
    check('我的名片含公开开关', hasToggle);
    const checkedVal = hasToggle ? await p1.$eval('#pfContactVisible', (el) => el.checked) : null;
    check('开关状态反映当前设置（默认关）', checkedVal === false, String(checkedVal));
    // 打开并保存
    if (hasToggle) {
      await p1.click('#pfContactVisible');
      await sleep(150);
      await p1.evaluate(() => { const b = document.querySelector('#pfSave'); b && b.scrollIntoView(); b && b.click(); });
      await sleep(800);
      const r = await fetch(`http://localhost:${PORT}/api/players?q=` + encodeURIComponent(viewer1.name), { headers: { Cookie: `hk_session=${T2}` } });
      const list = (await r.json()).data;
      const meCard = list.find((u) => u.name === viewer1.name);
      check('保存后服务端 contact_visible=true', !!meCard && meCard.contact_visible === true, JSON.stringify(meCard && meCard.contact_visible));
    }

    // ========== 注册页（问卷制「直接注册申请」表单）含开关 ==========
    const p4 = await newPage(T1);
    await goto(p4, '#/register');
    if (await p4.$('#toManualReg')) { await p4.click('#toManualReg'); await sleep(400); }
    const regToggle = !!(await p4.$('#regContactVisible'));
    check('注册表单含公开开关', regToggle);

    // ========== 整页视觉抽查（首页/队伍广场无回归） ==========
    const pv = await newPage(T1);
    await goto(pv, '#/');
    await pv.screenshot({ path: path.join(SHOT, 'after-home.png'), fullPage: false });
    await goto(pv, '#/teams');
    await pv.screenshot({ path: path.join(SHOT, 'after-teams.png'), fullPage: false });

    console.log(`\n${pass} 通过 / ${fail} 失败\n`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error('异常：', e);
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }
})();
