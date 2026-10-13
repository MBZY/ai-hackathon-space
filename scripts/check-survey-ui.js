'use strict';
/* 报名模式 + 新功能 UI 实测（puppeteer）
 * 覆盖：首页 / 报名页（问卷+申请两种方式）/ 登录页 / 注册申请提交 / 后台审核 /
 *       队伍进度配图发布 / 作品提交 / 队伍动态瀑布流
 * 用法：node scripts/check-survey-ui.js
 * 产出：.shots/survey-*.png 截图 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH || 'C:/Users/12647/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe';
const PUPPETEER = process.env.PUPPETEER_PATH || 'C:/Users/12647/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core';
const SHOT_DIR = path.join(ROOT, '.shots');
const PORT = 3198;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-ui-'));

const puppeteer = require(PUPPETEER);
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ' => ' + String(extra).slice(0, 200) : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 预置：管理员（有队伍）；另存一张 1x1 PNG 供上传测试
const PNG_FILE = path.join(TMP, 'test-pixel.png');
(function seed() {
  fs.writeFileSync(PNG_FILE, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const salt = () => crypto.randomBytes(16).toString('hex');
  const hash = (pwd, s) => crypto.scryptSync(pwd, s, 32).toString('hex');
  const s1 = salt();
  const now = new Date().toISOString();
  const db = {
    meta: { version: 1, createdAt: now },
    sessions: {},
    users: [{
      id: 'u_admin', name: '雷子希', student_id: '202440025279', college: '人工智能学院', major: '软件工程', grade: '2024级',
      contact: '微信 t', skills: ['AI / 算法'], ai_level: '入门', bio: '', looking_for_team: false, role: 'admin', team_id: '',
      created_at: now, salt: s1, password_hash: hash('admin123', s1),
    }],
    teams: [{ id: 't_test', name: 'UI测试战队', track: 'web', topic_title: 'UI 测试选题', topic_brief: '', need_skills: [], contact: '微信 ui', status: 'recruiting', captain_id: 'u_admin', created_at: now, locked_at: null }],
    team_members: [{ id: 'm_1', team_id: 't_test', user_id: 'u_admin', role_in_team: '产品', joined_at: now }],
    invites: [], messages: [], notifications: [], progress_logs: [], announcements: [], projects: [], milestone_checks: [], project_likes: [],
  };
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, 'db.json'), JSON.stringify(db));
})();

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    const t0 = Date.now();
    const timer = setInterval(async () => {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) { clearInterval(timer); resolve(child); } }
      catch (e) { if (Date.now() - t0 > 9000) { clearInterval(timer); reject(new Error(out)); } }
    }, 200);
  });
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const srv = await startServer();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 980 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const go = async (hash, wait = 700) => {
    // 相同 hash 直接用 goto 不会重载（same-document），先跳空白页强制重载
    const cur = await page.evaluate(() => location.hash).catch(() => '');
    if (cur === hash) { await page.goto('about:blank'); }
    await page.goto(`http://127.0.0.1:${PORT}/${hash}`, { waitUntil: 'networkidle0' });
    await sleep(wait);
  };

  // ---------- 1) 首页 ----------
  await go('#/');
  const hero = await page.$eval('.hero-actions', (el) => el.textContent.replace(/\s+/g, ' '));
  check('首页 CTA 为「用学号登录组队」', /用学号登录组队/.test(hero), hero);
  check('首页有报名说明', /报名统一通过|先填问卷|报名方式/.test(await page.$eval('.hero', (el) => el.textContent)));
  const footer = await page.$eval('.footer', (el) => el.innerText.replace(/\s+/g, ' '));
  check('页脚新样式（协会名+节点）', /人工智能创新协会/.test(footer) && /组队截止 10\/16/.test(footer), footer);
  await page.screenshot({ path: path.join(SHOT_DIR, 'survey-home.png') });

  // ---------- 2) 报名页（两种方式） ----------
  await go('#/register');
  const regText = await page.$eval('#view', (el) => el.textContent);
  check('报名页方式一（问卷）', /方式一/.test(regText) && /填写报名问卷/.test(regText));
  check('报名页方式二（直接注册申请）', /方式二/.test(regText) && /直接注册申请/.test(regText));
  await page.screenshot({ path: path.join(SHOT_DIR, 'survey-register.png') });

  // ---------- 3) 方式二 → 注册申请表单 → 提交 ----------
  await page.click('#toManualReg');
  await sleep(400);
  check('申请表单出现（含审核提示）', /提交后由赛务组审核/.test(await page.$eval('#view', (el) => el.textContent)));
  await page.type('#regName', '测试申请同学');
  await page.type('#regSid', '202650000001');
  await page.type('#regPwd', 'abc123456');
  await page.type('#regContact', '微信 newstu');
  await page.click('#regBtn');
  await sleep(1200);
  const doneText = await page.$eval('#view', (el) => el.textContent);
  check('提交后显示「注册申请已提交」', /注册申请已提交/.test(doneText), doneText.slice(0, 80));
  await page.screenshot({ path: path.join(SHOT_DIR, 'survey-apply-done.png') });

  // 未通过前不能登录
  await go('#/login');
  await page.type('#loginSid', '202650000001');
  await page.type('#loginPwd', 'abc123456');
  await page.click('#loginBtn');
  await sleep(1200);
  const toastText = await page.$eval('#toastWrap', (el) => el.textContent).catch(() => '');
  check('待审核账号登录被拦截', /审核中/.test(toastText), toastText);

  // ---------- 4) 管理员登录 → 报名审核 ----------
  await go('#/login');
  await page.type('#loginSid', '202440025279');
  await page.type('#loginPwd', 'admin123');
  await page.click('#loginBtn');
  await sleep(1500);
  check('管理员登录成功', (await page.evaluate(() => UI.me && UI.me.name)) === '雷子希');
  await go('#/admin/review');
  const reviewText = await page.$eval('#view', (el) => el.textContent);
  check('审核页列出申请', /测试申请同学/.test(reviewText));
  await page.screenshot({ path: path.join(SHOT_DIR, 'survey-admin-review.png') });
  // 点「通过」（第一个按钮）
  const approved = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('#view button')).find((b) => b.textContent.trim() === '通过');
    if (!btn) return false;
    btn.click();
    return true;
  });
  check('点击通过按钮', approved);
  await sleep(500);
  const okBtn = await page.$('#mOk');
  if (okBtn) { await okBtn.click(); }
  await sleep(1200);
  check('通过后审核列表清空', /没有待审核/.test(await page.$eval('#view', (el) => el.textContent)));

  // ---------- 5) 队伍页：发布带图进度 ----------
  await go('#/team/t_test');
  check('队伍页含「参赛作品」区块', /参赛作品/.test(await page.$eval('#view', (el) => el.textContent)));
  const fileInput = await page.$('#pgFile');
  await fileInput.uploadFile(PNG_FILE);
  await sleep(900);
  const pickThumbs = await page.$$('#pgPicks .pick-thumb');
  check('图片选择后出现缩略图', pickThumbs.length === 1, `thumbs=${pickThumbs.length}`);
  await page.type('#pgContent', '设计稿第一版，欢迎围观');
  await page.click('#pgBtn');
  await sleep(1500);
  const detailText = await page.$eval('#view', (el) => el.textContent);
  check('进度发布成功（含图）', /设计稿第一版/.test(detailText));
  const imgs = await page.$$('.progress-imgs img');
  check('进度图片渲染', imgs.length >= 1, `imgs=${imgs.length}`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'survey-team-detail.png') });

  // ---------- 6) 作品提交 ----------
  await page.click('#btnSubmitProject').catch(() => {});
  await sleep(500);
  const modalText = await page.$eval('#modalBox', (el) => el.textContent).catch(() => '');
  check('作品提交弹窗打开', /作品名称/.test(modalText), modalText.slice(0, 60));
  await page.type('#prTitle', '创新小工具');
  await page.type('#prIntro', '一个用 AI 做的效率小工具');
  await page.type('#prRepo', 'https://github.com/demo/tool');
  await page.type('#prDemo', 'https://tool.example.com');
  await page.type('#prAi', 'AI 辅助 UI 设计，代码人工完成。');
  await page.click('#prSubmit');
  await sleep(1500);
  const afterProject = await page.$eval('#view', (el) => el.textContent);
  check('作品卡渲染（标题+仓库按钮）', /创新小工具/.test(afterProject) && /代码仓库/.test(afterProject));
  await page.screenshot({ path: path.join(SHOT_DIR, 'survey-project.png') });

  // ---------- 7) 队伍动态瀑布流 ----------
  await go('#/feed');
  const feedText = await page.$eval('#view', (el) => el.textContent);
  check('瀑布流页渲染动态', /UI测试战队/.test(feedText) && /设计稿第一版/.test(feedText));
  const feedImgs = await page.$$('.feed-card img');
  check('瀑布流卡片含配图', feedImgs.length >= 1, `imgs=${feedImgs.length}`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'survey-feed.png') });

  // ---------- 8) 已通过账号可登录 ----------
  await page.evaluate(() => { UI.me = null; });
  await go('#/login');
  await page.type('#loginSid', '202650000001');
  await page.type('#loginPwd', 'abc123456');
  await page.click('#loginBtn');
  await sleep(1500);
  check('审核通过后可登录', (await page.evaluate(() => UI.me && UI.me.name)) === '测试申请同学');

  const realErrors = errors.filter((e) => !/40[13]/.test(e) && !/favicon/i.test(e));
  check('无页面 JS 错误', realErrors.length === 0, realErrors.join(' | '));

  await browser.close();
  srv.kill('SIGTERM');
  console.log(`\nUI 检查通过 ${pass} / ${pass + fail}`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('UI 检查异常：', e); process.exit(2); });
