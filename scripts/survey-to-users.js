'use strict';
/* 腾讯问卷「2026 秋季 AI 黑客松报名问卷」(sid=28096194) 答卷 → 组队空间导入数据
 * 用法：node scripts/survey-to-users.js <answers.json> [outDir]
 * 产出：users.json（导入用）+ survey-import-report.md（给赛务组的核对报告）
 * 说明：题目 ID 按本问卷固定映射；变更问卷需同步维护 QID 表。 */

const fs = require('fs');
const path = require('path');

const QID = {
  name: 'q-2-d711',
  sid: 'q-3-b2c6',
  grade: 'q-4-6c31',
  major: 'q-5-940a',
  phone: 'q-6-8a59',
  email: 'q-7-575c',
  wx: 'q-8-1cd8',
  aicourse: 'q-9-326d',
  teamq: 'q-10-0652',
  teamname: 'q-11-038c',
  mates: 'q-12-9329',
  track: 'q-13-5cfa',
  skills: 'q-14-7fc0',
  idea: 'q-15-c008',
  source: 'q-16-6b0c',
};

// 年级文本 → 入学年份（2026 年秋季在办）
const GRADE_MAP = { '大一': '2026级', '大二': '2025级', '大三': '2024级', '大四': '2023级' };
// 组队情况 → 是否在系统内找队
const TEAMQ_LOOKING = { '已组好队伍': false, '暂未组队，希望官方匹配': true, '单人参赛': false };

function getQ(a, qid) {
  for (const pg of a.answer || []) for (const q of pg.questions || []) if (q.id === qid) return q;
  return null;
}
const textOf = (q) => (q ? String(q.text || '').trim() : '');
const selOf = (q) => (q && q.options ? q.options.filter((o) => o.checked === 1).map((o) => o.text) : []);

function cleanPhone(v) {
  return String(v || '').replace(/[\s-]/g, '').replace(/^\+?86/, '').trim();
}
function cleanWx(v) {
  // 去掉括号备注、首尾空白（如 "QQ18124447905（这个就是微信号）"）
  return String(v || '').replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, '').trim();
}
function buildContact(wx, phone) {
  const parts = [];
  if (wx) parts.push(`微信 ${wx}`);
  if (phone) parts.push(`手机 ${phone}`);
  return parts.join('；').slice(0, 40);
}
function toIso(ts) {
  // "2026-10-09 17:21:39"（北京时间）
  const m = String(ts || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return new Date().toISOString();
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
}

(async () => {
  const src = process.argv[2];
  const outDir = process.argv[3] || path.dirname(src);
  if (!src || !fs.existsSync(src)) {
    console.error('用法：node scripts/survey-to-users.js <answers.json> [outDir]');
    process.exit(2);
  }
  let raw = fs.readFileSync(src, 'utf8');
  raw = raw.slice(raw.indexOf('{'));
  const list = JSON.parse(raw).list || [];

  const users = [];
  const skipped = [];
  const records = [];

  for (const a of list) {
    const name = textOf(getQ(a, QID.name));
    const sid = textOf(getQ(a, QID.sid));
    const rec = {
      answer_id: a.answer_id, ended_at: a.ended_at, name, sid,
      grade_raw: selOf(getQ(a, QID.grade))[0] || '',
      major: textOf(getQ(a, QID.major)),
      phone: cleanPhone(textOf(getQ(a, QID.phone))),
      email: textOf(getQ(a, QID.email)),
      wx: cleanWx(textOf(getQ(a, QID.wx))),
      aicourse: selOf(getQ(a, QID.aicourse))[0] || '',
      teamq: selOf(getQ(a, QID.teamq))[0] || '',
      teamname: textOf(getQ(a, QID.teamname)),
      mates: textOf(getQ(a, QID.mates)),
      track: selOf(getQ(a, QID.track))[0] || '',
      skills: selOf(getQ(a, QID.skills)),
      idea: textOf(getQ(a, QID.idea)),
    };
    records.push(rec);

    if (!/^\d{8,15}$/.test(sid)) {
      skipped.push({ ...rec, reason: /^\d{17}[\dX]$/i.test(sid) ? '学号栏填了 18 位身份证号' : `学号格式无效（${sid || '空'}）` });
      continue;
    }
    if (!name || name.length < 2) {
      skipped.push({ ...rec, reason: '姓名无效' });
      continue;
    }

    users.push({
      name,
      student_id: sid,
      college: '', // 问卷未收集学院
      major: rec.major,
      grade: GRADE_MAP[rec.grade_raw] || rec.grade_raw,
      contact: buildContact(rec.wx, rec.phone),
      skills: rec.skills,
      // ai_level 不传：问卷未收集 AI 水平（AI 基础课完成情况仅入报告），后端默认「入门」
      bio: rec.idea.slice(0, 200),
      looking_for_team: TEAMQ_LOOKING[rec.teamq] !== undefined ? TEAMQ_LOOKING[rec.teamq] : true,
      created_at: toIso(rec.ended_at),
    });
  }

  fs.writeFileSync(path.join(outDir, 'users.json'), JSON.stringify(users, null, 1));

  // ---------- 报告 ----------
  const cnt = (arr, f) => arr.reduce((m, r) => (m[f(r)] = (m[f(r)] || 0) + 1, m), {});
  const byTeamq = cnt(records, (r) => r.teamq);
  const byGrade = cnt(records, (r) => r.grade_raw);
  const byTrack = cnt(records, (r) => r.track);
  const grouped = {};
  records.filter((r) => r.teamq === '已组好队伍' && r.teamname).forEach((r) => {
    const k = r.teamname;
    (grouped[k] = grouped[k] || []).push(r);
  });

  const lines = [];
  lines.push('# 报名问卷导入报告（sid=28096194）');
  lines.push('');
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(`- 答卷总数：${list.length} 条`);
  lines.push(`- **成功导入候选：${users.length} 人**`);
  lines.push(`- 跳过：${skipped.length} 人（需赛务组跟进）`);
  lines.push('');
  lines.push('## 需人工跟进（学号无效）');
  lines.push('');
  if (skipped.length) {
    lines.push('| 姓名 | 填写的"学号" | 原因 | 联系方式 | 问卷提交时间 |');
    lines.push('|---|---|---|---|---|');
    skipped.forEach((s) => {
      const contact = buildContact(s.wx, s.phone) || '（无）';
      lines.push(`| ${s.name} | ${s.sid} | ${s.reason} | ${contact} | ${s.ended_at} |`);
    });
    lines.push('');
    lines.push('建议：请以上同学重新提交问卷或直接在群里报正确学号，赛务组随后在后台「导入报名」补充。');
  } else {
    lines.push('（无）');
  }
  lines.push('');
  lines.push('## 分布统计');
  lines.push('');
  lines.push(`- 年级：${Object.entries(byGrade).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  lines.push(`- 组队情况：${Object.entries(byTeamq).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  lines.push(`- 意向赛道：${Object.entries(byTrack).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  const skillCnt = cnt(records.flatMap((r) => r.skills.map((s) => ({ s }))), (x) => x.s);
  lines.push(`- 技能：${Object.entries(skillCnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  lines.push('');
  lines.push('## 已在问卷中组好队伍的队伍一览（共 ' + Object.keys(grouped).length + ' 个队名）');
  lines.push('');
  Object.entries(grouped).forEach(([tn, rs]) => {
    lines.push(`- **${tn}**：${rs.map((r) => `${r.name}(${r.sid})`).join('、')} · 赛道：${rs[0].track}`);
  });
  lines.push('');
  lines.push('> 注：以上队伍仅为问卷登记，尚未在组队空间内建队；请提醒相应同学登录后在系统内完成建队/入队并锁定。');
  fs.writeFileSync(path.join(outDir, 'survey-import-report.md'), lines.join('\n'));

  console.log(`✓ 有效导出 ${users.length} 人 → users.json`);
  console.log(`✗ 跳过 ${skipped.length} 人：${skipped.map((s) => s.name + '(' + s.reason + ')').join('、')}`);
  console.log(`报告 → survey-import-report.md`);
  console.log('组队情况分布：', JSON.stringify(byTeamq));
})().catch((e) => { console.error(e); process.exit(1); });
