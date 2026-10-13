'use strict';
/* 合并线上备份 → 本地 data/db.json（部署前保数据流程 + 追加测试账号）
 * 用法：node scripts/merge-online-backup.js <online-backup.json> [--test-accounts]
 * 规则：
 *   users        —— 以本地为准（本地有密码哈希）；线上独有的用户补入（密码重置=学号后6位）
 *   其余集合     —— 按 id 取并集，同 id 以线上为准（线上是最新状态）
 *   --test-accounts —— 追加测试账号（3 管理员 + 1 选手，学号 900000000001-3 / 900000000101，密码=学号后6位） */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const COLLECTIONS = ['teams', 'team_members', 'invites', 'messages', 'notifications', 'progress_logs', 'announcements', 'projects', 'milestone_checks', 'project_likes'];

const hashPassword = (pwd, salt) => crypto.scryptSync(pwd, salt, 32).toString('hex');
const newAuth = (pwd) => { const salt = crypto.randomBytes(16).toString('hex'); return { salt, password_hash: hashPassword(pwd, salt) }; };

const backupFile = process.argv[2];
const withTest = process.argv.includes('--test-accounts');
if (!backupFile || !fs.existsSync(backupFile)) {
  console.error('用法：node scripts/merge-online-backup.js <online-backup.json> [--test-accounts]');
  process.exit(2);
}
if (!fs.existsSync(DB_FILE)) {
  console.error(`本地 ${DB_FILE} 不存在——请先用 scripts/prepare-online-data.js 生成基础库`);
  process.exit(2);
}

const local = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const online = JSON.parse(fs.readFileSync(backupFile, 'utf8'));

// ---------- users：本地为准 + 线上补缺 ----------
const localUserIds = new Set(local.users.map((u) => u.id));
let addedUsers = 0;
(online.users || []).forEach((u) => {
  if (!localUserIds.has(u.id)) {
    // 线上独有用户：无哈希，重置密码=学号后6位（与恢复机制一致）
    Object.assign(u, newAuth(String(u.student_id || '000000').slice(-6)));
    local.users.push(u);
    addedUsers += 1;
  }
});

// ---------- 其余集合：union，线上优先 ----------
const stats = {};
for (const key of COLLECTIONS) {
  const localArr = local[key] || [];
  const onlineArr = online[key] || [];
  const byId = new Map();
  localArr.forEach((x) => byId.set(x.id, x));
  let updated = 0, added = 0;
  onlineArr.forEach((x) => {
    if (byId.has(x.id)) { if (JSON.stringify(byId.get(x.id)) !== JSON.stringify(x)) updated += 1; byId.set(x.id, x); }
    else { byId.set(x.id, x); added += 1; }
  });
  local[key] = Array.from(byId.values());
  if (added || updated) stats[key] = { added, updated, total: local[key].length };
}

// ---------- 测试账号 ----------
if (withTest) {
  const TEST_ACCOUNTS = [
    { name: '测试赛务1', sid: '900000000001', role: 'admin' },
    { name: '测试赛务2', sid: '900000000002', role: 'admin' },
    { name: '测试赛务3', sid: '900000000003', role: 'admin' },
    { name: '测试选手1', sid: '900000000101', role: 'user' },
  ];
  const now = new Date().toISOString();
  TEST_ACCOUNTS.forEach((t) => {
    if (local.users.some((u) => u.student_id === t.sid)) return;
    local.users.push({
      id: 'u_' + crypto.randomBytes(8).toString('hex'),
      name: t.name,
      student_id: t.sid,
      college: '测试', major: '测试', grade: '—',
      contact: '测试账号（可删除）',
      skills: [], ai_level: '入门', bio: '',
      looking_for_team: true, role: t.role, team_id: '',
      created_at: now,
      test: true,
      ...newAuth(t.sid.slice(-6)),
    });
    console.log(`[test] 追加 ${t.name}（${t.sid} / 初始密码 ${t.sid.slice(-6)}，${t.role}）`);
  });
}

fs.writeFileSync(DB_FILE, JSON.stringify(local, null, 1));
console.log(`[merge] 用户: 本地 ${localUserIds.size} + 线上补入 ${addedUsers} → 共 ${local.users.length}`);
console.log('[merge] 集合合并:', JSON.stringify(stats));
console.log('[merge] teams:', local.teams.length, '| team_members:', local.team_members.length, '| progress_logs:', local.progress_logs.length);
console.log(`[done] 已写回 ${DB_FILE}`);
