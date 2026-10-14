'use strict';

// JSON 文件存储：活动规模 ≤100 人 / ≤30 队，同步读写整个库文件即可。
// Node 单线程 + 同步写 = 天然串行无并发问题；每次变更立即落盘，重启不丢数据。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const DB_FILE = path.join(config.dataDir, 'db.json');

function emptyDb() {
  return {
    meta: { version: 1, createdAt: new Date().toISOString() },
    sessions: {}, // token -> { userId, expiresAt }
    users: [], // {id,name,student_id,password_hash,salt,college,major,grade,contact,skills,ai_level,bio,looking_for_team,role,created_at}
    teams: [], // {id,name,track,topic_title,topic_brief,need_skills,contact,status,captain_id,created_at,locked_at}
    team_members: [], // {id,team_id,user_id,role_in_team,joined_at}
    invites: [], // {id,team_id,user_id,direction,status,message,created_at,updated_at}
    messages: [], // {id,from_id,to_id,content,is_read,created_at}
    notifications: [], // {id,user_id,type,title,content,link,is_read,created_at}
    progress_logs: [], // {id,team_id,stage,content,author_id,created_at}
    announcements: [], // {id,title,content,is_pinned,created_at,updated_at}
    projects: [],
    milestone_checks: [],
    project_likes: [],
    disbanded_teams: [], // 解散归档：{team,members,invites,progress_logs,projects,operator_*,reason,disbanded_at}
  };
}

let db = null;

function load() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      // 兼容新增集合
      const fresh = emptyDb();
      for (const key of Object.keys(fresh)) {
        if (db[key] === undefined) db[key] = fresh[key];
      }
      return;
    } catch (e) {
      const backup = DB_FILE + '.corrupted.' + Date.now();
      fs.copyFileSync(DB_FILE, backup);
      console.error('[store] db.json parse failed, backed up to', backup, e.message);
    }
  }
  db = emptyDb();
  save();
}

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}

function getDb() {
  if (!db) load();
  return db;
}

function uid(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

// 用户当前所属队伍（成员关系为唯一事实来源，动态计算避免字段不同步）
function teamIdOf(d, userId) {
  if (!userId) return '';
  const asMember = d.team_members.find((m) => m.user_id === userId);
  if (asMember) return asMember.team_id;
  const asCaptain = d.teams.find((t) => t.captain_id === userId);
  return asCaptain ? asCaptain.id : '';
}

module.exports = { getDb, save, uid, teamIdOf, DB_FILE };
