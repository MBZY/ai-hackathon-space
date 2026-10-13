'use strict';
/*
 * 全页面多宽度按钮扫描（管理员登录态）
 * 用途：回归"按钮被挤出视口/文字竖排/页面横向滚动"类布局问题（2026-10-13 管理后台表格按钮溢出事件后新增）
 * 前置：本地服务在 3100 端口运行；测试账号 900000000001（密码=学号后6位）需存在
 * 用法：node scripts/scan-all-widths.js
 * 配套：scripts/scan-admin.js（管理后台 6 个子页 × 4 宽度，含截图）
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(process.env.PUPPETEER_PATH || 'C:/Users/12647/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');

const CHROME = process.env.CHROME_PATH || 'C:/Users/12647/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = path.join(__dirname, '..', '.shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ student_id: '900000000001', password: '000001' }),
    });
  });
  await page.reload({ waitUntil: 'networkidle0' });

  const routes = [
    ['home', '#/'],
    ['teams', '#/teams'],
    ['team-detail', '#/team/t_3a60d03db661deae'],
    ['feed', '#/feed'],
    ['players', '#/players'],
    ['rules', '#/rules'],
    ['team-new', '#/team/new'],
    ['messages', '#/messages'],
    ['register', '#/register'],
    ['notifications', '#/notifications'],
  ];

  const widths = [1440, 1024, 780, 480, 390];
  for (const width of widths) {
    console.log(`\n########## ${width}px ##########`);
    await page.setViewport({ width, height: 900 });
    for (const [name, route] of routes) {
      await page.goto('about:blank');
      await page.goto(BASE + '/' + route, { waitUntil: 'networkidle0' });
      await new Promise(r => setTimeout(r, 600));
      const info = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('button, .btn, a.btn').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;
          const cs = getComputedStyle(el);
          const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
          const flags = [];
          if (Math.abs(padL - padR) > 0.5) flags.push('PAD-ASYM(' + padL + '/' + padR + ')');
          if (r.x < -1) flags.push('LEFT-OUT(' + Math.round(r.x) + ')');
          if (r.x + r.width > window.innerWidth + 1) flags.push('RIGHT-OUT(+' + Math.round(r.x + r.width - window.innerWidth) + ')');
          if (el.scrollWidth > el.clientWidth + 1) flags.push('TEXT-CLIP');
          if (flags.length) out.push({
            cls: (el.className || '').toString().slice(0, 46),
            text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22),
            x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height),
            flags: flags.join(' '),
          });
        });
        return { scrollW: document.documentElement.scrollWidth, btns: out };
      });
      const hscroll = info.scrollW > width + 1 ? ` ⚠️PAGE-HSCROLL(${info.scrollW})` : '';
      if (info.btns.length || hscroll) {
        console.log(`-- ${name}: ${info.btns.length} flagged${hscroll}`);
        info.btns.slice(0, 6).forEach(b => console.log(`     [${b.cls}] "${b.text}" x=${b.x} w=${b.w} => ${b.flags}`));
        if (info.btns.length > 6) console.log(`     ... 等 ${info.btns.length} 个`);
      } else {
        console.log(`-- ${name}: clean`);
      }
    }
  }

  await browser.close();
  console.log('\ndone');
})().catch(e => { console.error(e); process.exit(1); });
