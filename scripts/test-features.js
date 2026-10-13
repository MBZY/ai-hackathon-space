'use strict';
/* 新功能回归：进度配图 / 作品提交 / 瀑布流接口
 * 用法：node scripts/test-features.js
 * 隔离：临时 DATA_DIR，不碰项目 data/ */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-feat-'));
const PORT = 3195;
let pass = 0, fail = 0;
const results = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; results.push(`  ✓ ${name}`); } else { fail++; results.push(`  ✗ ${name} ${extra}`); } };

// 1x1 白色 JPEG
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const BIG_IMG = 'data:image/jpeg;base64,' + Buffer.alloc(520 * 1024, 7).toString('base64');

function seed() {
  const salt = () => crypto.randomBytes(16).toString('hex');
  const hash = (pwd, s) => crypto.scryptSync(pwd, s, 32).toString('hex');
  const mk = (id, name, sid, pwd, role) => ({
    id, name, student_id: sid, college: '人工智能学院', major: '软件工程', grade: '2024级',
    contact: '微信 t', skills: [], ai_level: '入门', bio: '', looking_for_team: true, role, team_id: '',
    created_at: new Date().toISOString(),
    ...(() => { const s = salt(); return { salt: s, password_hash: hash(pwd, s) }; })(),
  });
  const db = {
    meta: { version: 1, createdAt: new Date().toISOString() },
    sessions: {},
    users: [mk('u_admin', '测试管理员', '202440025279', 'admin123', 'admin'), mk('u_p1', '测试选手', '202400000301', 'p1123456', 'user')],
    teams: [], team_members: [], invites: [], messages: [], notifications: [], progress_logs: [],
    announcements: [], projects: [], milestone_checks: [], project_likes: [],
  };
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, 'db.json'), JSON.stringify(db));
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
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
  let json = null; try { json = await res.json(); } catch (e) {}
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const s = sc.map((x) => x.split(';')[0]).find((x) => x.startsWith('hk_session=')) || '';
  return { status: res.status, json, cookie: s };
}

(async () => {
  seed();
  const srv = await startServer();
  try {
    let r = await jfetch('/api/auth/login', { method: 'POST', body: { student_id: '202440025279', password: 'admin123' } });
    const adminCookie = r.cookie;
    ok('管理员登录', r.status === 200 && !!adminCookie);

    r = await jfetch('/api/auth/login', { method: 'POST', body: { student_id: '202400000301', password: 'p1123456' } });
    const p1Cookie = r.cookie;
    ok('选手登录', r.status === 200 && !!p1Cookie);

    // 建队（admin）
    r = await jfetch('/api/teams', { method: 'POST', cookie: adminCookie, body: { name: '测试战队', track: 'web', topic_title: '测试选题', contact: '微信 t' } });
    ok('建队 201', r.status === 201, JSON.stringify(r.json));
    const teamId = r.json.data.id;

    // ---------- 进度配图 ----------
    r = await jfetch(`/api/teams/${teamId}/progress`, { method: 'POST', cookie: adminCookie, body: { stage: '开发实现', content: '纯文字进度' } });
    ok('纯文字进度发布', r.status === 201);

    r = await jfetch(`/api/teams/${teamId}/progress`, { method: 'POST', cookie: adminCookie, body: { stage: '原型设计', content: '带图进度', images: [TINY_JPEG, TINY_JPEG] } });
    ok('带 2 张图进度发布', r.status === 201, JSON.stringify(r.json));

    r = await jfetch(`/api/teams/${teamId}`, { cookie: adminCookie });
    const withImgs = r.json.data.progress.find((p) => p.images && p.images.length);
    ok('详情返回图片路径', !!withImgs && withImgs.images.length === 2 && withImgs.images[0].startsWith('/uploads/'), JSON.stringify(withImgs && withImgs.images));
    const imgPath = withImgs.images[0];
    const imgRes = await fetch(`http://127.0.0.1:${PORT}${imgPath}`);
    ok('图片文件可访问（200 + image 类型）', imgRes.status === 200 && /image/.test(imgRes.headers.get('content-type') || ''), `status=${imgRes.status} ct=${imgRes.headers.get('content-type')}`);

    r = await jfetch(`/api/teams/${teamId}/progress`, { method: 'POST', cookie: adminCookie, body: { stage: '开发实现', content: 'x', images: [BIG_IMG] } });
    ok('超大图片被拒（422）', r.status === 422, `status=${r.status}`);

    r = await jfetch(`/api/teams/${teamId}/progress`, { method: 'POST', cookie: adminCookie, body: { stage: '开发实现', content: '四张图', images: [TINY_JPEG, TINY_JPEG, TINY_JPEG, TINY_JPEG] } });
    ok('发送 4 张图不报错', r.status === 201, `status=${r.status}`);
    r = await jfetch(`/api/teams/${teamId}`, { cookie: adminCookie });
    const capped = r.json.data.progress.find((p) => p.content === '四张图');
    ok('存储时最多保留 3 张', capped && capped.images.length === 3, `len=${capped && capped.images.length}`);

    // ---------- 瀑布流接口 ----------
    r = await jfetch('/api/progress/recent?limit=10');
    ok('瀑布流接口公开可访问', r.status === 200 && Array.isArray(r.json.data));
    const feedItem = r.json.data[0];
    ok('瀑布流字段完整（team_name/author/stage/images）', feedItem && 'team_name' in feedItem && 'author_name' in feedItem && 'images' in feedItem);
    ok('瀑布流按时间倒序', r.json.data.length >= 2 && new Date(r.json.data[0].created_at) >= new Date(r.json.data[1].created_at));

    // ---------- 作品提交 ----------
    r = await jfetch(`/api/teams/${teamId}/project`, { method: 'POST', cookie: p1Cookie, body: { title: '越权作品', repo_url: 'https://github.com/x/y' } });
    ok('非队长提交作品 403', r.status === 403, `status=${r.status}`);

    r = await jfetch(`/api/teams/${teamId}/project`, { method: 'POST', cookie: adminCookie, body: { title: '测试作品', repo_url: 'not-a-url' } });
    ok('非法链接 422', r.status === 422);

    r = await jfetch(`/api/teams/${teamId}/project`, { method: 'POST', cookie: adminCookie, body: { title: '测试作品', intro: '一个测试作品', repo_url: 'https://github.com/x/y', demo_url: 'https://demo.example.com', video_url: 'https://b23.tv/abc', doc_url: 'https://docs.qq.com/abc', ai_declaration: 'AI 辅助了代码生成，人工完成设计与调试。' } });
    ok('队长提交作品 201', r.status === 201 && r.json.data.is_new === true, JSON.stringify(r.json));

    r = await jfetch(`/api/teams/${teamId}`);
    ok('详情含 project', !!r.json.data.project && r.json.data.project.title === '测试作品', JSON.stringify(r.json.data.project && r.json.data.project.title));

    const before = r.json.data.project.updated_at;
    await new Promise((r2) => setTimeout(r2, 30));
    r = await jfetch(`/api/teams/${teamId}/project`, { method: 'POST', cookie: adminCookie, body: { title: '测试作品V2', repo_url: 'https://github.com/x/y' } });
    ok('更新作品 is_new=false', r.status === 201 && r.json.data.is_new === false);
    r = await jfetch(`/api/teams/${teamId}`);
    ok('更新后标题与时间变化', r.json.data.project.title === '测试作品V2' && r.json.data.project.updated_at !== before);

    // 后台总览含 projects 计数
    r = await jfetch('/api/admin/overview', { cookie: adminCookie });
    ok('后台总览 projects 计数', r.json.data.projects === 1, `projects=${r.json.data.projects}`);

    // CSV 导出含作品列
    const csvRes = await fetch(`http://127.0.0.1:${PORT}/api/admin/export?type=teams`, { headers: { Cookie: adminCookie } });
    const csv = await csvRes.text();
    ok('CSV 含作品名称与仓库列', csv.includes('作品名称') && csv.includes('测试作品V2') && csv.includes('github.com/x/y'));
  } finally {
    srv.kill('SIGTERM');
  }

  console.log('\n========== 新功能回归（配图/作品/瀑布流）==========');
  console.log(results.join('\n'));
  console.log(`\n通过 ${pass} / ${pass + fail}${fail ? `，失败 ${fail}` : '，全部通过 ✓'}`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(2); });
