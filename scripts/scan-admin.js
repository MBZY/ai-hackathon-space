'use strict';
/*
 * 管理后台按钮扫描（管理员登录，多宽度）
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(process.env.PUPPETEER_PATH || 'C:/Users/12647/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');

const CHROME = process.env.CHROME_PATH || 'C:/Users/12647/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = path.join(__dirname, '..', '.shots');
fs.mkdirSync(OUT, { recursive: true });

const ADMIN_SID = '900000000001';
const ADMIN_PWD = '000001';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' });
  await page.evaluate(async (sid, pwd) => {
    await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ student_id: sid, password: pwd }),
    });
  }, ADMIN_SID, ADMIN_PWD);
  await page.reload({ waitUntil: 'networkidle0' });
  const who = await page.evaluate(() => document.querySelector('.nav-right')?.textContent?.trim().slice(0, 30));
  console.log('login as:', who);

  const routes = [
    ['admin-overview', '#/admin'],
    ['admin-teams', '#/admin/teams'],
    ['admin-users', '#/admin/users'],
    ['admin-review', '#/admin/review'],
    ['admin-import', '#/admin/import'],
    ['admin-announce', '#/admin/announcements'],
  ];

  for (const width of [1440, 900, 780, 390]) {
    console.log(`\n########## viewport ${width}px ##########`);
    await page.setViewport({ width, height: 900 });
    for (const [name, route] of routes) {
      await page.goto('about:blank');
      await page.goto(BASE + '/' + route, { waitUntil: 'networkidle0' });
      await new Promise(r => setTimeout(r, 700));
      const info = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('button, .btn, a.btn, .tabs a, .seg a, .seg button').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;
          const cs = getComputedStyle(el);
          const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
          const flags = [];
          if (Math.abs(padL - padR) > 0.5) flags.push('PAD-ASYM(' + padL + '/' + padR + ')');
          if (r.x < -1) flags.push('LEFT-OUT(' + Math.round(r.x) + ')');
          if (r.x + r.width > window.innerWidth + 1) flags.push('RIGHT-OUT(+' + Math.round(r.x + r.width - window.innerWidth) + ')');
          if (el.scrollWidth > el.clientWidth + 1) flags.push('TEXT-CLIP');
          out.push({
            cls: (el.className || '').toString().slice(0, 46),
            text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22),
            x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height),
            flags: flags.join(' '),
          });
        });
        return { winW: window.innerWidth, scrollW: document.documentElement.scrollWidth, btns: out };
      });
      const bad = info.btns.filter(b => b.flags);
      console.log(`\n-- ${name} scrollW=${info.scrollW}${info.scrollW > info.winW ? ' ⚠️H-SCROLL' : ''} (${info.btns.length} btns, ${bad.length} flagged)`);
      for (const b of bad) console.log(`   ⚠️ [${b.cls}] "${b.text}" x=${b.x} w=${b.w} h=${b.h} => ${b.flags}`);
      if (width === 390 || width === 1440) {
        await page.screenshot({ path: path.join(OUT, `adm-${name}-${width}.png`) });
      }
    }
  }

  if (errors.length) console.log('\nPAGE ERRORS:', errors.slice(0, 5));
  await browser.close();
  console.log('\ndone');
})().catch(e => { console.error(e); process.exit(1); });
