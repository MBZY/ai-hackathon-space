'use strict';
/*
 * 前端 UI 实测（puppeteer-core + 本机 Chromium）
 * 前置：本地服务已在 3100 端口运行，且已跑过 scripts/smoke-test.js 造数。
 * 用法：node scripts/ui-check.js
 * 说明：复用 environment 中 agent-browser 下载的 Chromium 与本机隔离的 puppeteer-core。
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3100';
const CHROME = process.env.CHROME_PATH || 'C:/Users/12647/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe';
const PUPPETEER = process.env.PUPPETEER_PATH || 'C:/Users/12647/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core';
const SHOT_DIR = path.join(__dirname, '..', '.shots');

const puppeteer = require(PUPPETEER);

// 测试账号：自动从本地数据中发现「冒烟队员 / 冒烟队长」（需先运行 smoke-test.js 造数）
const dbPath = path.join(__dirname, '..', 'data', 'db.json');
let TEST_SID = process.env.TEST_SID || '';
let CAPTAIN_SID = '';
const TEST_PWD = process.env.TEST_PWD || 'pass123456';
if (!TEST_SID) {
  try {
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const member = db.users.find((u) => u.name === '冒烟队员');
    const captain = db.users.find((u) => u.name === '冒烟队长');
    if (member) TEST_SID = member.student_id;
    if (captain) CAPTAIN_SID = captain.student_id;
  } catch (e) { /* ignore */ }
}

let pass = 0;
let fail = 0;
const failures = [];
const pageErrors = [];

function check(name, cond, extra) {
  if (cond) { pass += 1; console.log(`  ok  ${name}`); }
  else { fail += 1; failures.push(name); console.log(`  FAIL ${name}${extra !== undefined ? '  => ' + String(extra).slice(0, 300) : ''}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!TEST_SID) {
    console.error('未找到测试账号（data/db.json 中无「冒烟队员」）。请先运行 scripts/smoke-test.js 造数。');
    process.exit(1);
  }
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,940'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 940 });

  page.on('pageerror', (e) => pageErrors.push('[pageerror] ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push('[console] ' + msg.text().slice(0, 200)); });

  const gotoHash = async (hash) => {
    await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
    await sleep(350);
  };
  const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, name) });

  console.log(`\n== UI 实测 @ ${BASE} ==\n`);

  // ---------- 1. 首页（游客） ----------
  console.log('[1] 游客首页');
  await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await sleep(400);
  const heroH1 = await page.$eval('.hero h1', (el) => el.textContent).catch(() => '');
  check('hero 标题渲染', heroH1.includes('AI 黑客松'), heroH1);
  const statNums = await page.$$eval('.stat-strip .stat-num', (els) => els.map((e) => e.textContent.trim()));
  check('统计条有数据（≥4 格）', statNums.length >= 4, JSON.stringify(statNums));
  const guestHero = await page.$eval('.hero-actions', (el) => el.textContent).catch(() => '');
  check('游客 hero 显示注册按钮', guestHero.includes('立即注册'));
  await shot('01-home-guest.png');

  // ---------- 2. 登录（有队伍的队员账号） ----------
  console.log('\n[2] 登录跳转（有队伍用户）');
  await gotoHash('#/login');
  await page.type('#loginSid', TEST_SID, { delay: 10 });
  await page.type('#loginPwd', TEST_PWD, { delay: 10 });
  await page.click('#loginBtn');
  await page.waitForFunction(() => location.hash === '#/my', { timeout: 8000 }).catch(() => {});
  const hashAfterLogin = await page.evaluate(() => location.hash);
  check('有队伍用户登录后跳转 #/my（不再 404）', hashAfterLogin === '#/my', hashAfterLogin);
  await sleep(500);
  const myText = await page.$eval('#view', (el) => el.textContent).catch(() => '');
  check('我的空间显示“我的队伍”', myText.includes('我的队伍'));
  check('我的空间显示队伍名', myText.includes('冒烟战队'), myText.slice(0, 200));
  check('导航显示用户名', (await page.$eval('#navRight', (el) => el.textContent)).includes('冒烟队员'));
  await shot('02-my-after-login.png');

  // ---------- 3. 私信列表（曾必崩） ----------
  console.log('\n[3] 私信列表');
  await gotoHash('#/messages');
  await sleep(400);
  const convCount = await page.$$eval('.conv-item', (els) => els.length).catch(() => 0);
  const msgPageText = await page.$eval('#view', (el) => el.textContent).catch(() => '');
  check('私信页不崩溃（有标题）', msgPageText.includes('私信') && !msgPageText.includes('页面加载失败'));
  check('会话列表渲染出会话', convCount >= 1, convCount);
  await shot('03-messages.png');

  // ---------- 4. 聊天窗（曾必崩） ----------
  console.log('\n[4] 聊天窗');
  if (convCount >= 1) {
    await page.click('.conv-item');
    await sleep(600);
    const bubbles = await page.$$eval('.bubble', (els) => els.length).catch(() => 0);
    const chatPeer = await page.$eval('.page-head h1', (el) => el.textContent).catch(() => '');
    check('聊天页不崩溃且显示对方名字', chatPeer.includes('冒烟队长'), chatPeer);
    check('历史消息气泡渲染', bubbles >= 1, bubbles);
    // 发一条消息
    await page.type('#chatText', 'UI 实测：收到请回复', { delay: 5 });
    await page.click('#chatSend');
    await sleep(700);
    const bubbles2 = await page.$$eval('.bubble', (els) => els.length).catch(() => 0);
    check('发送后气泡 +1', bubbles2 === bubbles + 1, `${bubbles} -> ${bubbles2}`);
    await shot('04-chat.png');
  }

  // ---------- 5. 通知中心（曾必崩） ----------
  console.log('\n[5] 通知中心');
  await gotoHash('#/notifications');
  await sleep(400);
  const notifCount = await page.$$eval('.notif-item', (els) => els.length).catch(() => 0);
  const notifText = await page.$eval('#view', (el) => el.textContent).catch(() => '');
  check('通知页不崩溃', notifText.includes('通知中心') && !notifText.includes('页面加载失败'));
  check('通知列表渲染', notifCount >= 1, notifCount);
  const navBadgeBefore = await page.$$eval('#navRight .badge-dot', (els) => els.length);
  check('导航红点存在（有未读）', navBadgeBefore >= 1, navBadgeBefore);
  await shot('05-notifications.png');

  // ---------- 6. 选手名片搜索（焦点保持） ----------
  console.log('\n[6] 选手搜索焦点');
  await gotoHash('#/players');
  await sleep(500);
  await page.focus('#pkSearch');
  await page.type('#pkSearch', '冒烟', { delay: 20 });
  await sleep(900); // debounce 350ms + 请求
  const activeId = await page.evaluate(() => (document.activeElement && document.activeElement.id) || '');
  check('搜索后输入框保持焦点', activeId === 'pkSearch', activeId);
  const typedVal = await page.$eval('#pkSearch', (el) => el.value);
  check('输入内容未丢失', typedVal === '冒烟', typedVal);
  const playerCount = await page.$$eval('#pkList .card', (els) => els.length).catch(() => 0);
  check('搜索结果渲染', playerCount >= 1, playerCount);
  await shot('06-players-search.png');

  // 按学号搜索
  await page.$eval('#pkSearch', (el) => { el.value = ''; });
  await page.type('#pkSearch', CAPTAIN_SID || '97697801', { delay: 15 });
  await sleep(900);
  const nameHit = await page.$eval('#pkList', (el) => el.textContent).catch(() => '');
  check('按学号搜到队长', nameHit.includes('冒烟队长'), nameHit.slice(0, 120));

  // ---------- 7. 退出（点导航按钮）+ 管理员登录 ----------
  console.log('\n[7] 退出登录 + 管理后台');
  await page.click('#navLogout');
  await sleep(250);
  await page.click('#mOk'); // 确认弹窗
  await sleep(700);
  const afterLogout = await page.evaluate(async () => ({
    hash: location.hash,
    me: !!UI.me,
    hasLoginEntry: !!document.querySelector('#navRight a[href="#/login"]'),
    meStatus: (await fetch('/api/auth/me')).status,
  }));
  check('点「退出」后回到首页', afterLogout.hash === '#/', afterLogout.hash);
  check('前端登录态已清空且导航显示登录入口', !afterLogout.me && afterLogout.hasLoginEntry, JSON.stringify(afterLogout));
  check('服务端会话已失效（/api/auth/me 401）', afterLogout.meStatus === 401, afterLogout.meStatus);
  await shot('07-logout.png');
  await gotoHash('#/login');
  await page.type('#loginSid', '202440025279', { delay: 10 });
  await page.type('#loginPwd', 'pass123456', { delay: 10 });
  await page.click('#loginBtn');
  await sleep(900);
  const hashAdminLogin = await page.evaluate(() => location.hash);
  check('管理员登录跳转正常（#/my 或 #/teams）', ['#/my', '#/teams'].includes(hashAdminLogin), hashAdminLogin);
  await gotoHash('#/admin');
  await sleep(500);
  const adminText = await page.$eval('#view', (el) => el.textContent).catch(() => '');
  check('后台总览渲染', adminText.includes('赛务后台') && adminText.includes('注册人数'));
  const adminTabs = await page.$$eval('.admin-tabs a', (els) => els.length).catch(() => 0);
  check('后台 tab 渲染', adminTabs === 4, adminTabs);
  await shot('08-admin.png');

  // ---------- 8. 首页（登录态） ----------
  console.log('\n[8] 登录态首页');
  await gotoHash('#/');
  await sleep(400);
  const heroActions = await page.$eval('.hero-actions', (el) => el.textContent).catch(() => '');
  check('登录后 hero 按钮正常（管理员无队伍→创建队伍）', heroActions.includes('创建队伍'), heroActions.trim());

  // ---------- 9. Modal 开合（遮罩修复的配套验证） ----------
  console.log('\n[9] 弹窗模态开合');
  const modalOpen = await page.evaluate(() => {
    UI.modal('<h3>回归测试弹窗</h3><p>内容</p>');
    const mask = document.querySelector('#modalMask');
    return { hidden: mask.hidden, display: getComputedStyle(mask).display };
  });
  check('modal 打开时遮罩正常可见', !modalOpen.hidden && modalOpen.display === 'flex', JSON.stringify(modalOpen));
  await shot('09-modal-open.png');
  const modalClose = await page.evaluate(() => {
    UI.closeModal();
    const mask = document.querySelector('#modalMask');
    return { hidden: mask.hidden, display: getComputedStyle(mask).display };
  });
  check('modal 关闭后遮罩完全隐藏（不再挡页面）', modalClose.hidden && modalClose.display === 'none', JSON.stringify(modalClose));

  // ---------- 汇总 ----------
  // 未登录访问 /api/auth/me 返回 401 是设计内行为（boot 时静默处理），浏览器会自动记一条 console 提示
  const realErrors = pageErrors.filter((e) => !e.includes('favicon') && !(e.includes('401') && e.includes('Unauthorized')));
  console.log('\n== 页面运行时错误 ==');
  if (realErrors.length === 0) console.log('  （无）');
  else realErrors.forEach((e) => console.log('  ! ' + e));

  console.log(`\n== UI 结果：${pass} 通过 / ${fail} 失败 ==`);
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log(`截图目录：${SHOT_DIR}`);

  await browser.close();
  if (fail || realErrors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('UI 测试异常：', e);
  process.exitCode = 1;
});
