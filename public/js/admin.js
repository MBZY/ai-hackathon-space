/* 赛务后台：总览 / 队伍 / 选手 / 公告 / 导出 */
'use strict';

const Admin = {
  async guard() {
    if (!UI.me) { location.hash = '#/login'; return false; }
    if (UI.me.role !== 'admin') {
      UI.$('#view').innerHTML = `<div class="empty" style="padding-top:90px"><div class="big">🚫</div>仅赛务组可访问管理后台</div>`;
      return false;
    }
    return true;
  },

  tabsHTML(tab) {
    return `
    <div class="admin-tabs">
      <a href="#/admin" class="${tab === 'overview' ? 'on' : ''}">总览</a>
      <a href="#/admin/teams" class="${tab === 'teams' ? 'on' : ''}">队伍管理</a>
      <a href="#/admin/users" class="${tab === 'users' ? 'on' : ''}">选手管理</a>
      <a href="#/admin/review" class="${tab === 'review' ? 'on' : ''}">报名审核</a>
      <a href="#/admin/import" class="${tab === 'import' ? 'on' : ''}">导入报名</a>
      <a href="#/admin/announcements" class="${tab === 'announcements' ? 'on' : ''}">公告管理</a>
    </div>`;
  },

  async overviewPage(view) {
    if (!(await Admin.guard())) return;
    let d;
    try { d = await UI.api('/api/admin/overview'); } catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }
    view.innerHTML = `
    <div class="page-head"><h1>赛务后台</h1><p class="sub">数据总览 · ${new Date().toLocaleDateString('zh-CN')}</p></div>
    ${Admin.tabsHTML('overview')}
    ${d.pending_review > 0 ? `
    <div class="card" style="border-color:var(--coral);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;padding:14px 18px">
      <b style="color:var(--coral)">有 ${d.pending_review} 条报名申请待审核</b>
      <a class="btn sm" href="#/admin/review">去审核 →</a>
    </div>` : ''}
    <div class="stat-strip">
      <div class="stat-box"><div class="stat-num">${d.users}</div><div class="stat-label">注册人数</div></div>
      <div class="stat-box"><div class="stat-num">${d.teams}</div><div class="stat-label">队伍总数</div></div>
      <div class="stat-box"><div class="stat-num">${d.locked}</div><div class="stat-label">已锁定</div></div>
      <div class="stat-box"><div class="stat-num">${d.unteamed}</div><div class="stat-label">未组队人数</div></div>
    </div>
    <div class="grid grid-2c" style="margin-top:16px">
      <div class="card">
        <h3 style="font-family:var(--serif);margin-bottom:12px">赛道分布</h3>
        ${Object.values(d.tracks).map((t) => `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
          <span style="width:110px;font-size:13.5px">${UI.esc(t.name)}</span>
          <div style="flex:1;height:9px;background:var(--green-bg);border-radius:5px;overflow:hidden">
            <div style="width:${d.teams ? Math.round((t.teams / d.teams) * 100) : 0}%;height:100%;background:var(--green)"></div>
          </div>
          <b style="width:24px;text-align:right;font-size:14px">${t.teams}</b>
        </div>`).join('')}
      </div>
      <div class="card">
        <h3 style="font-family:var(--serif);margin-bottom:12px">运营要点</h3>
        <div style="font-size:14px;line-height:2">
          待处理入队申请：<b>${d.pending_applies}</b> 个<br>
          进度日志：<b>${d.progress_logs}</b> 条<br>
          已提交作品：<b>${d.projects || 0}</b> 支队伍<br>
          私信消息：<b>${d.messages}</b> 条<br>
          ${d.unteamed > 0 ? `<span style="color:var(--coral)">未组队 ${d.unteamed} 人 —— 10/15 起准备兜底分配</span>` : '<span style="color:var(--green)">全员已组队 ✓</span>'}
        </div>
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn sm outline" href="/api/admin/export?type=teams" target="_blank">导出组队登记表</a>
          <a class="btn sm outline" href="/api/admin/export?type=players" target="_blank">导出人员表</a>
        </div>
      </div>
    </div>`;
  },

  async teamsPage(view) {
    if (!(await Admin.guard())) return;
    let teams;
    try { teams = await UI.api('/api/admin/teams'); } catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }
    view.innerHTML = `
    <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end">
      <div><h1>队伍管理</h1><p class="sub">共 ${teams.length} 支队伍 · 名单核对视图</p></div>
      <a class="btn outline sm" href="/api/admin/export?type=teams" target="_blank">导出 CSV</a>
    </div>
    ${Admin.tabsHTML('teams')}
    <div class="card" style="overflow-x:auto">
      <table class="data">
        <tr><th>队伍</th><th>赛道</th><th>选题</th><th>状态</th><th>成员</th><th>联系方式</th><th>操作</th></tr>
        ${teams.map((t) => `
        <tr>
          <td><b>${UI.esc(t.name)}</b><div style="font-size:12px;color:var(--ink-3)">队长：${UI.esc(t.captain)}</div></td>
          <td>${UI.esc(t.track_name)}</td>
          <td style="max-width:150px">${UI.esc(t.topic_title)}</td>
          <td>${UI.statusTag(t.status)}</td>
          <td style="max-width:230px">${t.members.map((m) => `${UI.esc(m.name)}<span style="color:var(--ink-3);font-size:11.5px">(${UI.esc(m.role_in_team || '-')})</span>`).join('、')}</td>
          <td style="font-size:12.5px">${UI.esc(t.contact || '-')}</td>
          <td style="white-space:nowrap">
            ${t.status !== 'locked' ? `<button class="btn sm" onclick="Admin.lock('${t.id}')">锁定</button>` : `<button class="btn sm outline" onclick="Admin.unlock('${t.id}')">解锁</button>`}
          </td>
        </tr>`).join('')}
      </table>
    </div>`;
  },

  async usersPage(view) {
    if (!(await Admin.guard())) return;
    let users;
    try { users = await UI.api('/api/admin/users'); } catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }
    view.innerHTML = `
    <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end">
      <div><h1>选手管理</h1><p class="sub">共 ${users.length} 人 · 未组队 ${users.filter((u) => !u.team_name).length} 人（兜底分配候选）</p></div>
      <a class="btn outline sm" href="/api/admin/export?type=players" target="_blank">导出 CSV</a>
    </div>
    ${Admin.tabsHTML('users')}
    <div class="card" style="overflow-x:auto">
      <table class="data">
        <tr><th>姓名</th><th>学号</th><th>学院/专业</th><th>技能</th><th>AI基础</th><th>联系方式</th><th>队伍</th><th>操作</th></tr>
        ${users.map((u) => `
        <tr>
          <td><b>${UI.esc(u.name)}</b>${u.role === 'admin' ? ' <span class="tag">管理员</span>' : ''}${u.status === 'pending' ? ' <span class="tag warn">待审核</span>' : ''}${u.status === 'rejected' ? ' <span class="tag coral">已拒绝</span>' : ''}</td>
          <td>${UI.esc(u.student_id)}</td>
          <td style="font-size:12.5px">${UI.esc(u.college || '')}<br>${UI.esc(u.major || '')} ${UI.esc(u.grade || '')}</td>
          <td>${UI.renderTags(u.skills || [])}</td>
          <td>${UI.esc(u.ai_level || '-')}</td>
          <td style="font-size:12.5px">${UI.esc(u.contact || '-')}</td>
          <td>${u.team_name ? UI.esc(u.team_name) : '<span class="tag coral">未组队</span>'}</td>
          <td style="white-space:nowrap">
            ${u.role === 'admin' ? `<button class="btn sm outline" onclick="Admin.setRole('${u.id}','user')">取消管理员</button>` : `<button class="btn sm outline" onclick="Admin.setRole('${u.id}','admin')">设为赛务组</button>`}
            <button class="btn sm outline" onclick="Admin.resetPwd('${u.id}','${UI.esc(u.name)}')">重置密码</button>
          </td>
        </tr>`).join('')}
      </table>
    </div>`;
  },

  // ---------- 导入报名（腾讯问卷 → 用户名单）----------
  // 支持粘贴 JSON 数组，或直接粘贴腾讯问卷/Excel 导出的表格文本（自动识别列名）
  parseImportText(text) {
    const t = String(text || '').trim();
    if (!t) return { rows: [], warnings: ['内容为空'] };
    if (t.startsWith('[') || t.startsWith('{')) {
      try {
        const json = JSON.parse(t);
        const arr = Array.isArray(json) ? json : Array.isArray(json.users) ? json.users : null;
        if (!arr) return { rows: [], warnings: ['JSON 里没有找到数组'] };
        return { rows: arr, warnings: [] };
      } catch (e) {
        return { rows: [], warnings: ['JSON 解析失败：' + e.message] };
      }
    }
    // 表格文本：自动识别分隔符（tab > 逗号 > 分号）
    const lines = t.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { rows: [], warnings: ['至少需要表头 + 1 行数据'] };
    const delim = lines[0].includes('\t') ? '\t' : lines[0].split(',').length >= lines[0].split(';').length ? ',' : ';';
    const parseLine = (line) => {
      const out = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
          } else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === delim) { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out.map((s) => s.trim());
    };
    const header = parseLine(lines[0]);
    // 列名模糊匹配（腾讯问卷导出表头为题目原文，如「1、姓名」）
    const match = (h) => {
      const s = h.replace(/\s/g, '');
      if (/学号/.test(s)) return 'student_id';
      if (/姓名/.test(s)) return 'name';
      if (/微信|联系方式|手机|电话|QQ|邮箱|联络/i.test(s)) return 'contact';
      if (/学院/.test(s)) return 'college';
      if (/专业/.test(s)) return 'major';
      if (/年级/.test(s)) return 'grade';
      if (/技能|方向|擅长/.test(s)) return 'skills';
      if (/AI.*基础|AI.*水平|人工智能.*(基础|水平)/i.test(s)) return 'ai_level';
      if (/自荐|介绍|说说|补充|期待/.test(s)) return 'bio';
      return '';
    };
    const mapping = header.map(match);
    if (!mapping.includes('name') || !mapping.includes('student_id')) {
      return { rows: [], warnings: ['未能从表头识别出「姓名」「学号」列，请检查表头或改用 JSON 格式。识别结果：' + header.map((h, i) => `${h}${mapping[i] ? '→' + mapping[i] : ''}`).join(' | ')] };
    }
    const rows = [];
    const warnings = [];
    for (let li = 1; li < lines.length; li++) {
      const cells = parseLine(lines[li]);
      const row = {};
      mapping.forEach((key, i) => {
        if (!key) return;
        let v = cells[i] || '';
        if (key === 'skills') v = v.split(/[、,，/｜|;；\s]+/).filter(Boolean);
        if (key === 'ai_level' && !['零基础', '入门', '熟练'].includes(v)) v = '';
        row[key] = v;
      });
      if (row.name || row.student_id) rows.push(row);
      else warnings.push(`第 ${li + 1} 行没有姓名/学号，已跳过`);
    }
    if (mapping.includes('contact') && header[mapping.indexOf('contact')] && /微信昵称/.test(header[mapping.indexOf('contact')])) {
      warnings.push('提示：检测到「微信昵称」列被当作联系方式，如有专门的微信/手机号列请检查表头顺序');
    }
    return { rows, warnings };
  },

  async importPage(view) {
    if (!(await Admin.guard())) return;
    view.innerHTML = `
    <div class="page-head"><h1>导入报名</h1><p class="sub">从腾讯问卷名单批量创建账号 · 初始密码 = 学号后 6 位</p></div>
    ${Admin.tabsHTML('import')}
    <div class="grid grid-13">
      <div class="card">
        <h3 style="font-family:var(--serif);margin-bottom:10px">粘贴报名数据</h3>
        <p style="font-size:13px;color:var(--ink-2);margin-bottom:10px;line-height:1.8">
          支持两种格式：① 腾讯问卷导出/表格复制的文本（需包含「姓名」「学号」表头，其余列自动识别）；<br>
          ② JSON 数组，如 <code>[{"name":"张三","student_id":"2024...","contact":"微信 xx"}]</code>
        </p>
        <textarea id="impText" style="min-height:220px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px" placeholder="在此粘贴数据…"></textarea>
        <div style="display:flex;gap:12px;align-items:flex-end;margin-top:12px;flex-wrap:wrap">
          <div class="form-item" style="margin:0;min-width:190px"><label>重复学号处理</label>
            <select id="impConflict">
              <option value="skip">跳过已存在的账号（推荐）</option>
              <option value="fill">已存在：仅补充空字段</option>
              <option value="overwrite">已存在：覆盖基本信息</option>
            </select></div>
          <button class="btn outline" id="impDry">预检（不写入）</button>
          <button class="btn" id="impSubmit">导入</button>
        </div>
      </div>
      <div class="card" id="impResult">
        <h3 style="font-family:var(--serif);margin-bottom:10px">导入结果</h3>
        <p style="color:var(--ink-3);font-size:14px">粘贴数据后先点「预检」，确认识别无误再导入。导入的账号会收到站内欢迎通知。</p>
        <div style="margin-top:14px;font-size:13px;color:var(--ink-2);line-height:2">
          提示：<br>
          · 问卷重复提交以最新为准（同批同学号自动去重）<br>
          · 学号格式需 8-15 位数字，姓名 2-20 字<br>
          · 导入后可在「选手管理」核对名单，或导出 CSV
        </div>
      </div>
    </div>`;

    const run = async (dryRun) => {
      const parsed = Admin.parseImportText(UI.$('#impText').value);
      if (!parsed.rows.length) {
        UI.$('#impResult').innerHTML = `<h3 style="font-family:var(--serif);margin-bottom:10px">导入结果</h3><p style="color:var(--coral);font-size:14px">${parsed.warnings.map(UI.esc).join('<br>') || '未解析到数据'}</p>`;
        return;
      }
      const btn = dryRun ? UI.$('#impDry') : UI.$('#impSubmit');
      btn.disabled = true; btn.textContent = dryRun ? '预检中…' : '导入中…';
      try {
        const r = await UI.api('/api/admin/import-users', {
          method: 'POST',
          body: { users: parsed.rows, conflict: UI.$('#impConflict').value, dry_run: dryRun },
        });
        UI.$('#impResult').innerHTML = `
          <h3 style="font-family:var(--serif);margin-bottom:10px">${dryRun ? '预检结果（未写入）' : '导入完成'}</h3>
          <div class="stat-strip grid-3c">
            <div class="stat-box"><div class="stat-num">${r.added}</div><div class="stat-label">${dryRun ? '将新增' : '已新增'}</div></div>
            <div class="stat-box"><div class="stat-num">${r.updated}</div><div class="stat-label">${dryRun ? '将更新' : '已更新'}</div></div>
            <div class="stat-box"><div class="stat-num">${r.skipped}</div><div class="stat-label">跳过（已存在）</div></div>
          </div>
          ${r.invalid.length ? `
          <p style="margin-top:12px;color:var(--coral);font-weight:600;font-size:13.5px">无效 ${r.invalid.length} 条：</p>
          <div style="max-height:180px;overflow:auto;font-size:12.5px;line-height:1.9">
            ${r.invalid.map((x) => `第 ${x.row} 条 ${UI.esc(x.name || '')} ${UI.esc(x.student_id || '')}：${UI.esc(x.reason)}`).join('<br>')}
          </div>` : ''}
          ${r.notes && r.notes.length ? `<p style="margin-top:10px;font-size:12.5px;color:var(--ink-2)">${r.notes.map(UI.esc).join('<br>')}</p>` : ''}
          ${parsed.warnings.length ? `<p style="margin-top:10px;font-size:12.5px;color:var(--ink-3)">解析提醒：${parsed.warnings.map(UI.esc).join('；')}</p>` : ''}
          ${dryRun ? `<p style="margin-top:12px;font-size:13px;color:var(--ink-2)">确认无误后点「导入」正式写入。</p>` : '<p style="margin-top:12px;font-size:13px;color:var(--green)">名单已生效，可到「选手管理」查看。</p>'}`;
        UI.toast(dryRun ? '预检完成（未写入）' : `导入完成：新增 ${r.added} / 更新 ${r.updated} / 跳过 ${r.skipped}`, 'ok');
      } catch (e) {
        UI.toast(e.message, 'err');
      } finally {
        btn.disabled = false; btn.textContent = dryRun ? '预检（不写入）' : '导入';
      }
    };
    UI.$('#impDry').onclick = () => run(true);
    UI.$('#impSubmit').onclick = () => run(false);
  },

  // ---------- 报名审核（直接注册申请） ----------
  async reviewPage(view) {
    if (!(await Admin.guard())) return;
    let list;
    try { list = await UI.api('/api/admin/review'); } catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }
    view.innerHTML = `
    <div class="page-head"><h1>报名审核</h1><p class="sub">${list.length ? `共 ${list.length} 条待审核申请 · 通过后对方即可登录` : '没有待审核的申请'}</p></div>
    ${Admin.tabsHTML('review')}
    ${list.length === 0 ? `
    <div class="card" style="text-align:center;padding:36px 20px;color:var(--ink-3)">
      <p style="font-size:15px">当前没有待审核的报名申请</p>
      <p style="font-size:13px;margin-top:6px">同学通过「报名 → 方式二：直接注册申请」提交后会出现在这里</p>
    </div>` : `
    <div class="card" style="overflow-x:auto">
      <table class="data">
        <tr><th>姓名</th><th>学号</th><th>学院/专业</th><th>技能</th><th>联系方式</th><th>自荐</th><th>提交时间</th><th>操作</th></tr>
        ${list.map((u) => `
        <tr>
          <td><b>${UI.esc(u.name)}</b></td>
          <td>${UI.esc(u.student_id)}</td>
          <td style="font-size:12.5px">${UI.esc(u.college || '')}<br>${UI.esc(u.major || '')} ${UI.esc(u.grade || '')}</td>
          <td>${UI.renderTags(u.skills || [])}</td>
          <td style="font-size:12.5px">${UI.esc(u.contact || '-')}</td>
          <td style="font-size:12.5px;max-width:170px">${UI.esc((u.bio || '').slice(0, 50))}</td>
          <td style="font-size:12.5px;white-space:nowrap">${UI.fmtTime(u.created_at, { withDate: true })}</td>
          <td style="white-space:nowrap">
            <button class="btn sm" onclick="Admin.approve('${u.id}','${UI.esc(u.name)}')">通过</button>
            <button class="btn sm outline" style="color:var(--coral)" onclick="Admin.reject('${u.id}','${UI.esc(u.name)}')">拒绝</button>
          </td>
        </tr>`).join('')}
      </table>
    </div>`}`;
  },

  async approve(id, name) {
    if (!(await UI.confirm(`通过「${name}」的报名申请？通过后对方即可登录。`, { okText: '通过' }))) return;
    try {
      await UI.api(`/api/admin/users/${id}/approve`, { method: 'POST' });
      UI.toast('已通过，对方现在可以登录了', 'ok');
      Admin.reviewPage(UI.$('#view'));
    } catch (e) { UI.toast(e.message, 'err'); }
  },

  async reject(id, name) {
    if (!(await UI.confirm(`拒绝「${name}」的报名申请？对方将无法登录（可人工再联系）。`, { okText: '拒绝', danger: true }))) return;
    try {
      await UI.api(`/api/admin/users/${id}/reject`, { method: 'POST' });
      UI.toast('已拒绝', 'ok');
      Admin.reviewPage(UI.$('#view'));
    } catch (e) { UI.toast(e.message, 'err'); }
  },

  async announcementsPage(view) {
    if (!(await Admin.guard())) return;
    let list;
    try { list = await UI.api('/api/announcements'); } catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }
    view.innerHTML = `
    <div class="page-head"><h1>公告管理</h1><p class="sub">发布后全员收到站内通知</p></div>
    ${Admin.tabsHTML('announcements')}
    <div class="grid grid-12">
      <div class="card">
        <h3 style="font-family:var(--serif);margin-bottom:12px">发布公告</h3>
        <div class="form-item"><label>标题<span class="req">*</span></label><input type="text" id="anTitle" maxlength="60"></div>
        <div class="form-item"><label>内容<span class="req">*</span></label><textarea id="anContent" maxlength="1000" style="min-height:110px"></textarea></div>
        <div class="form-item"><label>置顶</label><select id="anPin"><option value="">普通</option><option value="1">置顶</option></select></div>
        <button class="btn" id="anSubmit">发布</button>
      </div>
      <div class="card">
        <h3 style="font-family:var(--serif);margin-bottom:8px">现有公告（${list.length}）</h3>
        ${list.length === 0 ? '<p style="color:var(--ink-3);font-size:14px;padding:20px 0">暂无公告</p>' : list.map((a) => `
        <div class="announce-item">
          <div style="display:flex;justify-content:space-between;gap:10px">
            <div class="announce-title">${a.is_pinned ? '<span class="tag">置顶</span> ' : ''}${UI.esc(a.title)}</div>
            <div style="white-space:nowrap">
              <button class="btn sm outline" onclick="Admin.pinAnn('${a.id}',${a.is_pinned ? 0 : 1})">${a.is_pinned ? '取消置顶' : '置顶'}</button>
              <button class="btn sm outline" style="color:var(--coral)" onclick="Admin.delAnn('${a.id}')">删除</button>
            </div>
          </div>
          <div class="announce-content">${UI.esc(a.content)}</div>
          <div class="announce-time">${UI.fmtTime(a.created_at, { withDate: true })}</div>
        </div>`).join('')}
      </div>
    </div>`;

    UI.$('#anSubmit').onclick = async () => {
      try {
        await UI.api('/api/announcements', {
          method: 'POST',
          body: { title: UI.$('#anTitle').value.trim(), content: UI.$('#anContent').value.trim(), is_pinned: !!UI.$('#anPin').value },
        });
        UI.toast('公告已发布，全员已通知', 'ok');
        Admin.announcementsPage(view);
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  },

  async lock(id) {
    if (!(await UI.confirm('锁定该队伍？', { okText: '锁定' }))) return;
    try { await UI.api(`/api/admin/teams/${id}/lock`, { method: 'POST' }); UI.toast('已锁定', 'ok'); Admin.teamsPage(UI.$('#view')); }
    catch (e) { UI.toast(e.message, 'err'); }
  },
  async unlock(id) {
    if (!(await UI.confirm('解锁该队伍？', { okText: '解锁' }))) return;
    try { await UI.api(`/api/admin/teams/${id}/unlock`, { method: 'POST' }); UI.toast('已解锁', 'ok'); Admin.teamsPage(UI.$('#view')); }
    catch (e) { UI.toast(e.message, 'err'); }
  },
  async setRole(id, role) {
    const label = role === 'admin' ? '设为赛务组管理员' : '取消管理员权限';
    if (!(await UI.confirm(`确定${label}？`, { okText: '确定' }))) return;
    try { await UI.api(`/api/admin/users/${id}/role`, { method: 'POST', body: { role } }); UI.toast('已更新', 'ok'); Admin.usersPage(UI.$('#view')); }
    catch (e) { UI.toast(e.message, 'err'); }
  },
  async resetPwd(id, name) {
    if (!(await UI.confirm(`重置「${name}」的密码为学号后 6 位？`, { okText: '重置' }))) return;
    try {
      const r = await UI.api(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
      UI.toast(`已重置，新密码：${r.new_password}（请线下告知本人）`, 'ok');
    } catch (e) { UI.toast(e.message, 'err'); }
  },
  async pinAnn(id, pinned) {
    try { await UI.api(`/api/announcements/${id}`, { method: 'PUT', body: { is_pinned: !!pinned } }); UI.toast('已更新', 'ok'); Admin.announcementsPage(UI.$('#view')); }
    catch (e) { UI.toast(e.message, 'err'); }
  },
  async delAnn(id) {
    if (!(await UI.confirm('删除该公告？', { okText: '删除', danger: true }))) return;
    try { await UI.api(`/api/announcements/${id}`, { method: 'DELETE' }); UI.toast('已删除', 'ok'); Admin.announcementsPage(UI.$('#view')); }
    catch (e) { UI.toast(e.message, 'err'); }
  },
};

window.Admin = Admin;
