'use strict';
/* 部署前保数据：从线上拉取最新数据，合并回本地 data/db.json
 *
 * 背景：发布（部署）会把本地项目目录整体上传，其中 data/ 会覆盖服务器上的 data/。
 *      所以部署前必须先执行本脚本，把线上「最新真实数据」同步回本地，
 *      否则线上产生的新数据会在下一次部署时被本地旧数据冲掉。
 *
 * 用法：
 *   node scripts/pull-online-data.js [选项]
 *
 * 选项：
 *   --base <url>   线上地址（默认 https://ai-hackathon-space.app.workbuddy.host）
 *   --sid <学号>   管理员学号（默认环境变量 ADMIN_SID 或 202440025279）
 *   --dry-run      只拉取并保存备份，不合并进本地 data/db.json
 *
 * 密码：优先读取环境变量 ADMIN_PASSWORD，否则在终端交互式输入（不回显）。
 *
 * 合并规则（与 scripts/merge-online-backup.js 一致）：
 *   users      —— 本地为准（保留密码哈希，线上备份不含哈希）；线上独有用户补入，密码重置为学号后 6 位
 *   其余集合   —— 按 id 取并集，同 id 以线上为准（线上为最新状态）
 *
 * 备份落盘位置：
 *   1) <项目>/data/backups/online-<时间戳>.json      —— 便于本地查看（已 gitignore）
 *   2) <用户目录>/.hackathon-space-backups/…          —— 项目外兜底，即使误部署也不丢
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const LOCAL_BACKUP_DIR = path.join(ROOT, 'data', 'backups');
const SAFE_BACKUP_DIR = path.join(os.homedir(), '.hackathon-space-backups');

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = (getArg('--base') || 'https://ai-hackathon-space.app.workbuddy.host').replace(/\/+$/, '');
const SID = getArg('--sid') || process.env.ADMIN_SID || '202440025279';
const DRY = args.includes('--dry-run');

const COLLECTIONS = [
  'teams', 'team_members', 'invites', 'messages', 'notifications',
  'progress_logs', 'announcements', 'projects', 'milestone_checks', 'project_likes',
];

function promptPassword() {
  if (process.env.ADMIN_PASSWORD) return Promise.resolve(process.env.ADMIN_PASSWORD);
  return new Promise((resolve) => {
    process.stdout.write(`管理员 ${SID} 的密码（输入不回显）：`);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    let buf = '';
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          if (stdin.isTTY) stdin.setRawMode(wasRaw);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else if (ch >= ' ') buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function login(sid, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: sid, password }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (_) { /* ignore */ }
    throw new Error(`登录失败：${msg}（请确认学号与密码，且该账号为管理员）`);
  }
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')];
  const cookie = raw.filter(Boolean).map((c) => String(c).split(';')[0]).join('; ');
  if (!cookie) throw new Error('登录成功但未取得会话 Cookie');
  return cookie;
}

async function fetchBackup(cookie) {
  const res = await fetch(`${BASE}/api/admin/backup`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`拉取线上备份失败：HTTP ${res.status}（确认该账号为管理员）`);
  return res.json();
}

function merge(local, online) {
  // users：本地为准（保留密码哈希），线上独有补入
  const localIds = new Set((local.users || []).map((u) => u.id));
  let addedUsers = 0;
  for (const u of (online.users || [])) {
    if (!localIds.has(u.id)) {
      const salt = crypto.randomBytes(16).toString('hex');
      u.salt = salt;
      u.password_hash = crypto.scryptSync(String(u.student_id || '000000').slice(-6), salt, 32).toString('hex');
      local.users.push(u);
      addedUsers += 1;
    }
  }
  // 其余集合：union，线上为准
  const stats = {};
  for (const key of COLLECTIONS) {
    const byId = new Map((local[key] || []).map((x) => [x.id, x]));
    let added = 0, updated = 0;
    for (const x of (online[key] || [])) {
      if (byId.has(x.id)) {
        if (JSON.stringify(byId.get(x.id)) !== JSON.stringify(x)) updated += 1;
        byId.set(x.id, x);
      } else {
        byId.set(x.id, x);
        added += 1;
      }
    }
    local[key] = Array.from(byId.values());
    if (added || updated) stats[key] = { added, updated, total: local[key].length };
  }
  return { addedUsers, stats };
}

(async () => {
  console.log(`[pull] 线上地址：${BASE}`);
  const password = await promptPassword();
  const cookie = await login(SID, password);
  console.log('[pull] 登录成功，正在拉取线上备份…');

  const online = await fetchBackup(cookie);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fname = `online-${ts}.json`;
  fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
  fs.mkdirSync(SAFE_BACKUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOCAL_BACKUP_DIR, fname), JSON.stringify(online, null, 1));
  fs.writeFileSync(path.join(SAFE_BACKUP_DIR, fname), JSON.stringify(online, null, 1));
  console.log(`[pull] 备份已保存：`);
  console.log(`       ${path.join(LOCAL_BACKUP_DIR, fname)}`);
  console.log(`       ${path.join(SAFE_BACKUP_DIR, fname)}`);
  console.log(`[pull] 线上数据统计：users=${(online.users || []).length} teams=${(online.teams || []).length} messages=${(online.messages || []).length}`);

  if (DRY) { console.log('[pull] --dry-run：仅备份，未合并本地 data/db.json'); return; }

  if (!fs.existsSync(DB_FILE)) {
    console.warn(`[pull] 本地 ${DB_FILE} 不存在，跳过合并`);
    return;
  }
  const local = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const { addedUsers, stats } = merge(local, online);
  fs.writeFileSync(DB_FILE, JSON.stringify(local, null, 1));
  console.log(`[pull] 合并完成：线上补入用户 ${addedUsers} 个，本地用户合计 ${local.users.length}`);
  console.log('[pull] 集合更新：', JSON.stringify(stats));
  console.log('[pull] ✅ 本地数据已与线上对齐，现在可以安全部署。');
})().catch((e) => {
  console.error('[pull] 失败：', e && e.message ? e.message : e);
  process.exit(1);
});
