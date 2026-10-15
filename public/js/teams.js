/* 队伍域：广场、建队、详情（申请/邀请/进度/队长管理） */
'use strict';

const Teams = {
  // ---------- 队伍广场 ----------
  async listPage(view, query = {}) {
    view.innerHTML = '<div class="loading">加载中…</div>';
    const params = new URLSearchParams();
    if (query.track) params.set('track', query.track);
    if (query.status) params.set('status', query.status);
    let teams;
    try {
      teams = await UI.api('/api/teams' + (params.toString() ? '?' + params : ''));
    } catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }

    const trackOpts = [
      ['', '全部赛道'], ['web', '网站与应用开发'], ['game', '游戏开发'], ['media', '新媒体与智能体'], ['open', '综合赛道'],
    ];
    const statusOpts = [['', '全部状态'], ['recruiting', '招募中'], ['locked', '已锁定']];

    view.innerHTML = `
      <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px">
        <div><h1>队伍广场</h1><p class="sub">找到心仪的队伍，或发布你的招募 ${UI.me ? '' : '· 联系方式登录后可见'}</p></div>
        ${UI.me ? (UI.me.team_id ? `<a class="btn outline" href="#/team/${UI.me.team_id}">查看我的队伍</a>` : `<a class="btn" href="#/team/new">+ 创建队伍</a>`) : `<a class="btn" href="#/login">登录后组队</a>`}
      </div>
      <div class="card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:12px 16px;margin-bottom:18px">
        <select id="fTrack" style="padding:7px 10px;border:1px solid var(--line);border-radius:8px">
          ${trackOpts.map(([v, t]) => `<option value="${v}" ${query.track === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <select id="fStatus" style="padding:7px 10px;border:1px solid var(--line);border-radius:8px">
          ${statusOpts.map(([v, t]) => `<option value="${v}" ${query.status === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <span style="font-size:13px;color:var(--ink-3)">共 ${teams.length} 支队伍</span>
      </div>
      ${teams.length === 0 ? `<div class="empty"><div class="big">⛵</div>还没有队伍，来当第一个船长吧</div>` : `
      <div class="grid grid-2">${teams.map((t) => Teams.cardHTML(t)).join('')}</div>`}`;

    UI.$('#fTrack').onchange = (e) => { query.track = e.target.value; Teams.listPage(view, query); };
    UI.$('#fStatus').onchange = (e) => { query.status = e.target.value; Teams.listPage(view, query); };
  },

  cardHTML(t) {
    const needSkillTags = (t.need_skills || []).map((s) => `<span class="tag coral">${UI.esc(s)}</span>`).join('');
    return `
    <a href="#/team/${t.id}" class="card clickable">
      <div class="team-card-top">
        <span class="team-name">${UI.esc(t.name)}</span>
        ${UI.statusTag(t.status)}
      </div>
      <div class="team-topic">${UI.esc(t.topic_title)}</div>
      ${t.topic_brief ? `<div class="team-brief">${UI.esc(t.topic_brief)}</div>` : ''}
      <div class="team-meta">
        <span class="track-badge ${t.track}">${UI.esc(t.track_name)}</span>
        ${needSkillTags || '<span class="tag gray">不限技能</span>'}
      </div>
      <div class="team-meta" style="margin-top:14px">
        <span class="tag gray">${t.member_count} 人</span>
      </div>
      ${UI.contactRow(t.contact, { label: '队长联系' })}
    </a>`;
  },

  // ---------- 建队 ----------
  async newPage(view) {
    if (!UI.me) { location.hash = '#/login'; return; }
    // 先刷新登录态：队伍可能刚被解散/被移除，避免用过期 team_id 把建队页误导到已不存在的队伍
    try {
      UI.me = await UI.api('/api/auth/me');
      App.refreshNav();
    } catch (e) { /* 网络异常时沿用缓存 */ }
    if (UI.me.team_id) { location.hash = `#/team/${UI.me.team_id}`; return; }
    const skillChips = ['前端开发','后端开发','游戏开发','AI / 算法','UI / 设计','产品 / 策划','新媒体运营','暂无经验，想学习'].map((s) => `<span class="chip" data-skill="${s}">${s}</span>`).join('');
    view.innerHTML = `
    <div style="max-width:560px;margin:0 auto">
      <div class="page-head"><h1>创建队伍</h1><p class="sub">即数字版「组队登记表」，锁定（10/16 22:00）前可修改</p></div>
      <div class="card">
        <div class="form-item"><label>队伍名称<span class="req">*</span></label><input type="text" id="tName" maxlength="16" placeholder="2-16 字，全场唯一"></div>
        <div class="form-item"><label>参赛赛道<span class="req">*</span></label>
          <select id="tTrack">
            <option value="">请选择</option>
            <option value="web">网站与应用开发（对接技术部）</option>
            <option value="game">游戏开发（对接椰风游戏组）</option>
            <option value="media">新媒体与智能体（对接信宣部）</option>
            <option value="open">综合赛道（跨部门协同）</option>
          </select></div>
        <div class="form-item"><label>我的队内分工<span class="req">*</span></label>
          <select id="tRole">${['产品','前端','后端','美术','策划','宣发','测试'].map((r) => `<option>${r}</option>`).join('')}</select></div>
        <div class="form-item"><label>选题名称<span class="req">*</span></label><input type="text" id="tTopic" maxlength="50" placeholder="一句话说清要做什么"></div>
        <div class="form-item"><label>选题简介</label><textarea id="tBrief" maxlength="300" placeholder="目标用户、核心玩法/功能、想解决什么问题"></textarea></div>
        <div class="form-item"><label>招募技能（多选）</label><div class="chips" id="tSkills">${skillChips}</div></div>
        <div class="form-item"><label>队长联系方式（微信/QQ/手机）<span class="req">*</span></label>
          <input type="text" id="tContact" maxlength="40" value="${UI.esc(UI.me.contact || '')}" placeholder="展示在队伍卡上（登录用户可见）">
          <p class="form-hint">没想好选题也可以先建队招人，锁定前都能改</p></div>
        <button class="btn" id="tSubmit" style="width:100%">创建队伍</button>
      </div>
    </div>`;
    UI.$$('#tSkills .chip').forEach((c) => { c.onclick = () => c.classList.toggle('on'); });
    UI.$('#tSubmit').onclick = async () => {
      const btn = UI.$('#tSubmit');
      btn.disabled = true;
      try {
        const data = await UI.api('/api/teams', {
          method: 'POST',
          body: {
            name: UI.$('#tName').value.trim(),
            track: UI.$('#tTrack').value,
            role_in_team: UI.$('#tRole').value,
            topic_title: UI.$('#tTopic').value.trim(),
            topic_brief: UI.$('#tBrief').value.trim(),
            need_skills: UI.$$('#tSkills .chip.on').map((c) => c.dataset.skill),
            contact: UI.$('#tContact').value.trim(),
          },
        });
        UI.me.team_id = data.id;
        UI.toast('队伍创建成功！', 'ok');
        location.hash = `#/team/${data.id}`;
      } catch (e) {
        UI.toast((e.details && e.details[0]) || e.message, 'err');
        btn.disabled = false;
      }
    };
  },

  // ---------- 队伍详情 ----------
  async detailPage(view, id) {
    view.innerHTML = '<div class="loading">加载中…</div>';
    let t;
    try { t = await UI.api(`/api/teams/${id}`); } catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }

    const myRole = t.my_role || 'guest';
    const isMember = myRole === 'captain' || myRole === 'member';
    const myPendingApply = t.my_pending_apply || null;
    // 可申请：未入队 + 无待处理申请/邀请 + 招募中（人数不设上限，仅推荐 3~5 人）
    const canApply = UI.me && myRole === 'guest' && !UI.me.team_id && !myPendingApply && !t.my_pending_invite
      && t.status === 'recruiting';
    // 不能申请时给出原因（不再让按钮静默消失）
    const applyHint = UI.me && myRole === 'guest' && !canApply && !myPendingApply && !t.my_pending_invite
      ? (UI.me.team_id ? '你已加入其他队伍（一人一队）'
        : t.status !== 'recruiting' ? '已停止招募' : '')
      : '';
    const stageOpts = ['选题确认', '原型设计', '开发实现', '联调测试', '打磨提交'];

    view.innerHTML = `
    <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px">
      <div><h1>${UI.esc(t.name)}</h1>
        <p class="sub"><span class="track-badge ${t.track}">${UI.esc(t.track_name)}</span>
          ${UI.statusTag(t.status)} <span class="tag gray">${t.member_count} 人</span>
          <span class="tag gray">创建于 ${UI.fmtDate(t.created_at)}</span></p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        ${canApply ? `<button class="btn" id="btnApply">申请加入</button>` : ''}
        ${myPendingApply ? `<span class="tag warn">已申请，等待队长处理</span><button class="btn sm outline" id="btnCancelApply">撤回申请</button>` : ''}
        ${UI.me && myRole === 'guest' && t.my_pending_invite ? `<button class="btn coral" onclick="Teams.respondInvite('${t.my_pending_invite.id}','accept')">接受邀请加入</button><button class="btn outline" onclick="Teams.respondInvite('${t.my_pending_invite.id}','decline')">婉拒</button>` : ''}
        ${applyHint ? `<span class="tag gray">${applyHint}</span>` : ''}
        ${myRole === 'captain' ? `<a class="btn outline" href="#/team/${t.id}/manage">队长管理</a>` : ''}
      </div>
    </div>

    <div class="grid grid-main">
      <div>
        <div class="card" style="margin-bottom:16px">
          <h3 style="font-family:var(--serif);margin-bottom:10px">选题</h3>
          <p style="font-size:16px;font-weight:600">${UI.esc(t.topic_title)}</p>
          ${t.topic_brief ? `<p style="color:var(--ink-2);font-size:14px;margin-top:6px;white-space:pre-wrap">${UI.esc(t.topic_brief)}</p>` : ''}
          <div style="margin-top:12px">${(t.need_skills || []).length ? '期望技能：' + UI.chips(t.need_skills) : '<span class="tag gray">不限技能</span>'}</div>
          ${UI.contactRow(t.contact, { label: '队长联系方式' })}
        </div>

        ${t.project ? `
        <div class="card" style="margin-bottom:16px;border-color:var(--green-line)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
            <h3 style="font-family:var(--serif)">参赛作品</h3>
            ${myRole === 'captain' ? `<button class="btn sm outline" id="btnEditProject">更新作品</button>` : ''}
          </div>
          <p style="font-size:17px;font-weight:600;margin-top:8px">${UI.esc(t.project.title)}</p>
          ${t.project.intro ? `<p style="color:var(--ink-2);font-size:14px;margin-top:6px;white-space:pre-wrap">${UI.esc(t.project.intro)}</p>` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            <a class="btn sm" href="${UI.esc(t.project.repo_url)}" target="_blank" rel="noopener">代码仓库 ↗</a>
            ${t.project.demo_url ? `<a class="btn sm outline" href="${UI.esc(t.project.demo_url)}" target="_blank" rel="noopener">在线体验 ↗</a>` : ''}
            ${t.project.video_url ? `<a class="btn sm outline" href="${UI.esc(t.project.video_url)}" target="_blank" rel="noopener">演示视频 ↗</a>` : ''}
            ${t.project.doc_url ? `<a class="btn sm outline" href="${UI.esc(t.project.doc_url)}" target="_blank" rel="noopener">说明文档 ↗</a>` : ''}
          </div>
          ${t.project.ai_declaration ? `<details style="margin-top:12px"><summary style="font-size:13.5px;color:var(--ink-2);cursor:pointer">AI 使用声明</summary><p style="font-size:13px;color:var(--ink-2);white-space:pre-wrap;margin-top:8px">${UI.esc(t.project.ai_declaration)}</p></details>` : ''}
          <div class="tl-meta" style="margin-top:10px">提交于 ${UI.fmtTime(t.project.created_at, { withDate: true })} · 最近更新 ${UI.fmtTime(t.project.updated_at, { withDate: true })}</div>
        </div>` : (myRole === 'captain' ? `
        <div class="card" style="margin-bottom:16px">
          <h3 style="font-family:var(--serif);margin-bottom:8px">参赛作品</h3>
          <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:12px">作品提交截止 <b>10/30 22:00</b>，提交后可随时更新。先把基础信息填上，后续迭代补充。</p>
          <button class="btn" id="btnSubmitProject">提交作品</button>
        </div>` : '')}

        <div class="card">
          <h3 style="font-family:var(--serif);margin-bottom:14px">队伍进度</h3>
          ${isMember ? `
          <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <select id="pgStage" style="padding:8px 10px;border:1px solid var(--line);border-radius:8px">
              ${stageOpts.map((s) => `<option>${s}</option>`).join('')}</select>
            <input type="text" id="pgContent" maxlength="500" placeholder="更新一条进度（做了什么 / 卡在哪 / 下一步）" style="flex:1;min-width:180px;padding:8px 12px;border:1px solid var(--line);border-radius:8px">
            <button class="btn sm" id="pgBtn">发布</button>
          </div>
          <div class="img-pick" id="pgPicks"></div>
          <input type="file" id="pgFile" accept="image/*" multiple hidden>
          <p class="form-hint" style="margin-bottom:14px">可附开发截图（最多 3 张，自动压缩）——发布后会出现在「队伍动态」页</p>` : ''}
          ${t.progress && t.progress.length ? `
          <div class="timeline">${t.progress.map((p) => `
            <div class="tl-item">
              <span class="tl-stage">${UI.esc(p.stage)}</span>
              <div class="tl-content">${UI.esc(p.content)}</div>
              ${(p.images || []).length ? `<div class="progress-imgs">${p.images.map((src) => `<img src="${UI.esc(src)}" class="zoomable" loading="lazy" alt="进度配图">`).join('')}</div>` : ''}
              <div class="tl-meta">${UI.esc(p.author_name)} · ${UI.fmtTime(p.created_at, { withDate: true })}</div>
            </div>`).join('')}</div>` : `<p style="color:var(--ink-3);font-size:13.5px">暂无进度记录${isMember ? '，发一条让全场看到你们在动工' : ''}</p>`}
        </div>
      </div>

      <div>
        <div class="card">
          <h3 style="font-family:var(--serif);margin-bottom:8px">成员（${t.member_count} 人）</h3>
          ${t.members.map((m) => `
          <div class="member-row">
            ${UI.avatar(m.user?.name, m.user_id)}
            <div class="member-info">
              <div class="member-name">${UI.esc(m.user?.name || '未知')} ${m.is_captain ? '<span class="tag">队长</span>' : ''}</div>
              <div class="member-sub">${UI.esc(m.user ? `${m.user.college || ''} ${m.user.major || ''}` : '')}${m.role_in_team ? ' · ' + UI.esc(m.role_in_team) : ''}</div>
            </div>
            ${UI.me && m.user_id !== UI.me.id ? `<button class="btn sm outline" onclick="location.hash='#/messages/${m.user_id}'">私信</button>` : ''}
          </div>`).join('')}
        </div>
        ${!UI.me ? `<div class="card" style="margin-top:16px;text-align:center"><p style="font-size:14px;color:var(--ink-2);margin-bottom:12px">登录后可申请加入、查看联系方式</p><a class="btn" href="#/login">去登录</a></div>` : ''}
      </div>
    </div>`;

    if (UI.$('#btnApply')) {
      UI.$('#btnApply').onclick = () => Teams.applyModal(t);
    }
    if (UI.$('#btnCancelApply')) {
      UI.$('#btnCancelApply').onclick = () => Teams.cancelApply(myPendingApply.id, id);
    }
    if (UI.$('#btnSubmitProject')) UI.$('#btnSubmitProject').onclick = () => Teams.projectModal(t, () => Teams.detailPage(view, id));
    if (UI.$('#btnEditProject')) UI.$('#btnEditProject').onclick = () => Teams.projectModal(t, () => Teams.detailPage(view, id));
    // 进度配图选择（最多 3 张，客户端压缩）
    const pgImages = [];
    const renderPicks = () => {
      const box = UI.$('#pgPicks');
      if (!box) return;
      box.innerHTML =
        pgImages.map((d, i) => `<div class="pick-thumb"><img src="${d}" alt="配图"><button class="rm" data-i="${i}" title="移除">✕</button></div>`).join('') +
        (pgImages.length < 3
          ? `<div class="pick-add" id="pgAdd">＋ 配图<div style="font-size:11px;color:var(--ink-3)">${pgImages.length}/3</div></div>`
          : '');
      if (UI.$('#pgAdd')) UI.$('#pgAdd').onclick = () => UI.$('#pgFile').click();
      UI.$$('#pgPicks .rm').forEach((b) => {
        b.onclick = () => { pgImages.splice(Number(b.dataset.i), 1); renderPicks(); };
      });
    };
    renderPicks();
    if (UI.$('#pgFile')) {
      UI.$('#pgFile').onchange = async (e) => {
        const files = Array.from(e.target.files || []).slice(0, 3 - pgImages.length);
        e.target.value = '';
        for (const f of files) {
          try { pgImages.push(await UI.compressImage(f)); }
          catch (err) { UI.toast(err.message, 'err'); }
        }
        renderPicks();
      };
    }
    if (UI.$('#pgBtn')) {
      UI.$('#pgBtn').onclick = async () => {
        const content = UI.$('#pgContent').value.trim();
        if (!content && !pgImages.length) return UI.toast('写点进度内容，或至少配一张图', 'err');
        const btn = UI.$('#pgBtn');
        btn.disabled = true; btn.textContent = '发布中…';
        try {
          await UI.api(`/api/teams/${t.id}/progress`, {
            method: 'POST',
            body: { stage: UI.$('#pgStage').value, content, images: pgImages },
          });
          UI.toast('进度已发布', 'ok');
          Teams.detailPage(view, id);
        } catch (e) {
          UI.toast(e.message, 'err');
          btn.disabled = false; btn.textContent = '发布';
        }
      };
    }
  },

  applyModal(t) {
    UI.modal(`
      <h3>申请加入「${UI.esc(t.name)}」</h3>
      <div class="form-item"><label>期望分工<span class="req">*</span></label>
        <select id="apRole">${['产品','前端','后端','美术','策划','宣发','测试'].map((r) => `<option>${r}</option>`).join('')}</select></div>
      <div class="form-item"><label>自荐语</label><textarea id="apMsg" maxlength="200" placeholder="让队长更快了解你（技能、经验、热情）"></textarea></div>
      <p class="form-hint">提交后队长将看到你的名片与联系方式（便于沟通）；处理结果会通过站内通知告知你。</p>
      <div class="modal-actions">
        <button class="btn outline" onclick="UI.closeModal()">取消</button>
        <button class="btn" id="apSubmit">提交申请</button>
      </div>`);
    UI.$('#apSubmit').onclick = async () => {
      try {
        await UI.api(`/api/teams/${t.id}/apply`, {
          method: 'POST',
          body: { role_in_team: UI.$('#apRole').value, message: UI.$('#apMsg').value.trim() },
        });
        UI.closeModal();
        UI.toast('申请已发送，等待队长处理', 'ok');
        Teams.detailPage(UI.$('#view'), t.id);
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  },

  // 撤回自己发出的入队申请
  async cancelApply(invId, teamId) {
    const ok = await UI.confirm('撤回加入该队伍的申请吗？', { okText: '撤回' });
    if (!ok) return;
    try {
      await UI.api(`/api/teams/invites/${invId}/cancel`, { method: 'POST' });
      UI.toast('已撤回申请', 'ok');
      Teams.detailPage(UI.$('#view'), teamId);
    } catch (e) { UI.toast(e.message, 'err'); }
  },

  // ---------- 作品提交弹窗（队长） ----------
  projectModal(t, onDone) {
    const p = t.project || {};
    const editing = !!t.project;
    UI.modal(`
      <h3>${editing ? '更新作品信息' : '提交参赛作品'}</h3>
      <div class="form-item"><label>作品名称<span class="req">*</span></label><input type="text" id="prTitle" maxlength="60" value="${UI.esc(p.title || '')}" placeholder="作品名称"></div>
      <div class="form-item"><label>作品简介</label><textarea id="prIntro" maxlength="500" placeholder="一句话说清：做了什么、解决什么问题、亮点是什么">${UI.esc(p.intro || '')}</textarea></div>
      <div class="form-item"><label>代码仓库链接<span class="req">*</span></label><input type="text" id="prRepo" maxlength="300" value="${UI.esc(p.repo_url || '')}" placeholder="https://github.com/..."></div>
      <div class="form-item"><label>在线体验链接</label><input type="text" id="prDemo" maxlength="300" value="${UI.esc(p.demo_url || '')}" placeholder="https://...（部署后的可访问地址）"></div>
      <div class="form-item"><label>演示视频链接</label><input type="text" id="prVideo" maxlength="300" value="${UI.esc(p.video_url || '')}" placeholder="B 站 / 腾讯视频等，建议 ≤3 分钟"></div>
      <div class="form-item"><label>说明文档链接</label><input type="text" id="prDoc" maxlength="300" value="${UI.esc(p.doc_url || '')}" placeholder="腾讯文档 / README 等"></div>
      <div class="form-item"><label>AI 使用声明</label><textarea id="prAi" maxlength="1500" placeholder="如实说明 AI 参与了哪些环节（用了什么工具、生成或辅助了什么、人工做了什么）">${UI.esc(p.ai_declaration || '')}</textarea></div>
      <div class="modal-actions">
        <button class="btn outline" onclick="UI.closeModal()">取消</button>
        <button class="btn" id="prSubmit">${editing ? '保存更新' : '提交作品'}</button>
      </div>`);
    UI.$('#prSubmit').onclick = async () => {
      const btn = UI.$('#prSubmit');
      btn.disabled = true; btn.textContent = '提交中…';
      try {
        await UI.api(`/api/teams/${t.id}/project`, {
          method: 'POST',
          body: {
            title: UI.$('#prTitle').value.trim(),
            intro: UI.$('#prIntro').value.trim(),
            repo_url: UI.$('#prRepo').value.trim(),
            demo_url: UI.$('#prDemo').value.trim(),
            video_url: UI.$('#prVideo').value.trim(),
            doc_url: UI.$('#prDoc').value.trim(),
            ai_declaration: UI.$('#prAi').value.trim(),
          },
        });
        UI.closeModal();
        UI.toast(editing ? '作品信息已更新' : '作品已提交，队友会收到通知', 'ok');
        onDone();
      } catch (e) {
        UI.toast((e.details && e.details[0]) || e.message, 'err');
        btn.disabled = false; btn.textContent = editing ? '保存更新' : '提交作品';
      }
    };
  },

  async respondInvite(invId, action) {
    try {
      await UI.api(`/api/teams/invites/${invId}/${action}`, { method: 'POST' });
      UI.toast(action === 'accept' ? '已加入队伍！' : '已处理', 'ok');
      // 刷新登录态与当前页面（身份/角色可能变化）
      try { UI.me = await UI.api('/api/auth/me'); } catch (e) { /* ignore */ }
      App.refreshNav();
      App.route();
    } catch (e) { UI.toast(e.message, 'err'); }
  },

  // ---------- 队长管理 ----------
  async managePage(view, id) {
    if (!UI.me) { location.hash = '#/login'; return; }
    view.innerHTML = '<div class="loading">加载中…</div>';
    let t;
    try { t = await UI.api(`/api/teams/${id}/manage`); } catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }
    if (t.captain_id !== UI.me.id && UI.me.role !== 'admin') { location.hash = `#/team/${id}`; return; }

    // 解散区：组队期内队长可自行解散；锁定后仅赛务组可强制解散
    const iAmAdmin = UI.me.role === 'admin' && t.captain_id !== UI.me.id;
    const disbandHTML = t.status !== 'locked'
      ? `<p style="font-size:13.5px;color:var(--ink-2);margin-bottom:12px">解散后队伍将从广场移除，全部成员退出队伍（可重新组队），已发布的进度与作品信息一并清除，<b>不可恢复</b>。</p>
         <button class="btn coral" id="disbandBtn">解散队伍</button>`
      : iAmAdmin
        ? `<p style="font-size:13.5px;color:var(--ink-2);margin-bottom:12px">队伍已锁定（成员不可变更）。赛务组可强制解散，成员将收到通知并恢复「找队中」。</p>
           <button class="btn coral" id="disbandBtn">赛务组强制解散</button>`
        : `<p style="font-size:13.5px;color:var(--ink-2)">队伍已锁定（组队截止 10/16 22:00 后不可自行解散），如需解散请联系赛务组。</p>`;

    view.innerHTML = `
    <div class="page-head"><h1>队长管理 · ${UI.esc(t.name)}</h1>
      <p class="sub">${UI.statusTag(t.status)} <span class="tag gray">${t.member_count} 人</span>
      ${t.status !== 'locked' ? '<span class="tag warn">锁定前可自由调整成员与信息</span>' : '<span class="tag gray">已锁定，成员不可变更</span>'}</p></div>

    <div class="grid grid-2c">
      <div>
        ${t.pending_applies.length ? `
        <div class="card" style="margin-bottom:16px;border-color:var(--green)">
          <h3 style="font-family:var(--serif);margin-bottom:6px">待审申请（${t.pending_applies.length}）</h3>
          ${t.pending_applies.map((a) => `
          <div style="padding:12px 0;border-bottom:1px dashed var(--line)">
            <div style="display:flex;gap:10px;align-items:center">
              ${UI.avatar(a.user?.name, a.user_id, 'sm')}
              <b>${UI.esc(a.user?.name || '')}</b>
              <span class="tag">${UI.esc(a.role_in_team || '未填分工')}</span>
              <span class="tag gray">${UI.esc(a.user?.ai_level || '')}</span>
            </div>
            <div style="font-size:13px;color:var(--ink-2);margin:6px 0">${UI.esc(a.message || '（无自荐语）')}</div>
            ${a.user?.bio ? `<div style="font-size:12.5px;color:var(--ink-3);margin-bottom:4px">一句话自荐：${UI.esc(a.user.bio)}</div>` : ''}
            <div style="font-size:12.5px;color:var(--ink-3)">技能：${UI.esc((a.user?.skills || []).join(' / ') || '未填')} ｜ 联系：${UI.esc(a.user?.contact || '未填')}</div>
            <div style="font-size:12px;color:var(--ink-3);margin-top:3px">申请于 ${UI.fmtTime(a.created_at, { withDate: true })}</div>
            <div style="margin-top:10px;display:flex;gap:8px">
              <button class="btn sm" onclick="Teams.manageInvite('${a.id}','accept','${id}')">通过</button>
              <button class="btn sm outline" onclick="Teams.manageInvite('${a.id}','decline','${id}')">拒绝</button>
            </div>
          </div>`).join('')}
        </div>` : `<div class="card" style="margin-bottom:16px"><p style="color:var(--ink-3);font-size:14px">暂无待审申请。可以去 <a href="#/players">选手名片广场</a> 主动邀请合适的同学</p></div>`}

        ${t.pending_invites && t.pending_invites.length ? `
        <div class="card" style="margin-bottom:16px">
          <h3 style="font-family:var(--serif);margin-bottom:6px">已发出的邀请（${t.pending_invites.length}）</h3>
          ${t.pending_invites.map((i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px dashed var(--line)">
            <span style="flex:1;font-size:14px;min-width:0"><b>${UI.esc(i.user_name)}</b>
              <span style="font-size:12.5px;color:var(--ink-3)">邀请于 ${UI.fmtTime(i.created_at, { withDate: true })}，等待对方回应</span></span>
            <button class="btn sm outline" onclick="Teams.manageInvite('${i.id}','cancel','${id}')">撤回邀请</button>
          </div>`).join('')}
        </div>` : ''}

        <div class="card">
          <h3 style="font-family:var(--serif);margin-bottom:10px">邀请成员</h3>
          <p style="font-size:13px;color:var(--ink-2);margin-bottom:12px">输入对方学号或姓名查找（需对方尚未入队）</p>
          <div style="display:flex;gap:8px">
            <input type="text" id="invSearch" placeholder="学号 / 姓名" style="flex:1;min-width:0;padding:8px 12px;border:1px solid var(--line);border-radius:8px">
            <button class="btn sm" id="invBtn">搜索</button>
          </div>
          <div id="invResult" style="margin-top:10px"></div>
        </div>
      </div>

      <div>
        <div class="card" style="margin-bottom:16px">
          <h3 style="font-family:var(--serif);margin-bottom:10px">成员管理</h3>
          ${t.members.map((m) => `
          <div class="member-row">
            ${UI.avatar(m.user?.name, m.user_id, 'sm')}
            <div class="member-info">
              <div class="member-name">${UI.esc(m.user?.name || '')} ${m.is_captain ? '<span class="tag">队长</span>' : ''}</div>
              <div class="member-sub">${UI.esc(m.user?.student_id || '')} · ${UI.esc(m.role_in_team || '未定分工')} · ${UI.esc(m.user?.contact || '无联系方式')}</div>
            </div>
            ${!m.is_captain && t.status !== 'locked' ? `
            <button class="btn sm outline" title="设为队长" onclick="Teams.transfer('${id}','${m.user_id}')">转让</button>
            <button class="btn sm outline" style="color:var(--coral)" data-name="${UI.esc(m.user?.name || '')}" onclick="Teams.kick('${id}','${m.user_id}', event)">移除</button>` : ''}
          </div>`).join('')}
        </div>

        <div class="card" style="margin-bottom:16px">
          <h3 style="font-family:var(--serif);margin-bottom:10px">队伍信息</h3>
          <div class="form-item"><label>选题名称</label><input type="text" id="edTopic" value="${UI.esc(t.topic_title)}" maxlength="50"></div>
          <div class="form-item"><label>选题简介</label><textarea id="edBrief" maxlength="300">${UI.esc(t.topic_brief || '')}</textarea></div>
          <div class="form-item"><label>队长联系方式</label><input type="text" id="edContact" value="${UI.esc(t.contact || '')}" maxlength="40"></div>
          <button class="btn outline sm" id="edSave">保存信息</button>
        </div>

        <div class="card" style="margin-bottom:16px">
          <h3 style="font-family:var(--serif);margin-bottom:10px">锁定队伍</h3>
          <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:12px">锁定 = 确认报名信息（等同提交组队登记表）。锁定后成员不再变动；10/16 22:00 系统将自动锁定所有队伍。</p>
          ${t.status !== 'locked'
            ? `<button class="btn coral" id="lockBtn">确认锁定队伍</button>`
            : `<span class="tag warn">已锁定</span> ${UI.me.role === 'admin' ? '<button class="btn sm outline" style="margin-left:8px" onclick="Teams.adminUnlock(\'' + id + '\')">管理员解锁</button>' : '（需调整请联系赛务组）'}`}
        </div>

        <div class="card" style="border-color:var(--coral)">
          <h3 style="font-family:var(--serif);margin-bottom:10px">解散队伍</h3>
          ${disbandHTML}
        </div>
      </div>
    </div>`;

    // 事件绑定
    UI.$('#invBtn').onclick = async () => {
      const kw = UI.$('#invSearch').value.trim();
      if (!kw) return;
      try {
        const users = await UI.api('/api/players?q=' + encodeURIComponent(kw));
        const box = UI.$('#invResult');
        if (!users.length) { box.innerHTML = '<p style="color:var(--ink-3);font-size:13px">未找到匹配的同学</p>'; return; }
        box.innerHTML = users.slice(0, 6).map((u) => `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line)">
            ${UI.avatar(u.name, u.id, 'sm')}
            <div style="flex:1;min-width:0">
              <b style="font-size:14px">${UI.esc(u.name)}</b>
              <span style="font-size:12px;color:var(--ink-3);margin-left:6px">${UI.esc(u.student_id)} ${u.team_name ? '· 已入队' + u.team_name : ''}</span>
              <div style="font-size:12px;color:var(--ink-3)">${UI.esc((u.skills || []).join('/'))} · ${u.contact !== undefined ? UI.esc(u.contact || '未填写') : '联系方式未公开'}</div>
            </div>
            ${!u.team_name && !u.team_id ? `<button class="btn sm" onclick="Teams.inviteUser('${id}','${u.id}')">邀请</button>` : '<span class="tag gray">已入队</span>'}
          </div>`).join('');
      } catch (e) { UI.toast(e.message, 'err'); }
    };
    UI.$('#edSave').onclick = async () => {
      try {
        await UI.api(`/api/teams/${id}`, {
          method: 'PUT',
          body: { topic_title: UI.$('#edTopic').value.trim(), topic_brief: UI.$('#edBrief').value.trim(), contact: UI.$('#edContact').value.trim() },
        });
        UI.toast('队伍信息已保存', 'ok');
      } catch (e) { UI.toast(e.message, 'err'); }
    };
    if (UI.$('#lockBtn')) {
      UI.$('#lockBtn').onclick = async () => {
        const ok = await UI.confirm('锁定后成员不再变动（等同提交组队登记表），确定锁定吗？', { okText: '锁定', danger: true });
        if (!ok) return;
        try {
          await UI.api(`/api/teams/${id}/lock`, { method: 'POST' });
          UI.toast('队伍已锁定，报名信息确认！', 'ok');
          Teams.managePage(view, id);
        } catch (e) { UI.toast(e.message, 'err'); }
      };
    }
    if (UI.$('#disbandBtn')) {
      UI.$('#disbandBtn').onclick = () => Teams.disband(id, t.name, t.member_count, iAmAdmin);
    }
  },

  // 解散队伍（队长 / 赛务组）——不可恢复，需二次确认
  async disband(teamId, name, memberCount, asAdmin = false) {
    const extra = memberCount > 1 ? `队伍里还有 ${memberCount - 1} 位队友，他们会被移出队伍并收到通知。` : '';
    const ok = await UI.confirm(
      `「${name}」将被删除：成员全部退出队伍（可重新组队），进度与作品信息一并清除，且无法恢复。${extra}确定解散吗？`,
      { title: '解散队伍', okText: asAdmin ? '强制解散' : '确认解散', danger: true }
    );
    if (!ok) return;
    try {
      await UI.api(`/api/teams/${teamId}`, { method: 'DELETE' });
      UI.toast('队伍已解散，可以去队伍广场重新组队', 'ok');
      // 刷新登录态与导航（我的队伍链接需清空）
      try { UI.me = await UI.api('/api/auth/me'); } catch (e) { /* ignore */ }
      App.refreshNav();
      if (location.hash === '#/teams') App.route();
      else location.hash = '#/teams';
    } catch (e) { UI.toast(e.message, 'err'); }
  },

  async manageInvite(invId, action, teamId) {
    const labels = { accept: '已通过申请，新成员入队！', decline: '已拒绝该申请', cancel: '已撤回邀请' };
    try {
      await UI.api(`/api/teams/invites/${invId}/${action}`, { method: 'POST' });
      UI.toast(labels[action] || '已处理', 'ok');
      Teams.managePage(UI.$('#view'), teamId);
      App.refreshNav();
    } catch (e) { UI.toast(e.message, 'err'); }
  },

  async inviteUser(teamId, userId, onDone) {
    UI.modal(`
      <h3>发送入队邀请</h3>
      <p class="form-hint" style="margin-bottom:10px">对方接受后即加入队伍；若对方已入其他队伍，邀请将自动关闭。</p>
      <div class="form-item"><label>附言（可选）</label><textarea id="invMsg" maxlength="200" placeholder="简单介绍队伍和你在做的事，提高接受率"></textarea></div>
      <div class="modal-actions">
        <button class="btn outline" onclick="UI.closeModal()">取消</button>
        <button class="btn" id="invSend">发送邀请</button>
      </div>`);
    UI.$('#invSend').onclick = async () => {
      try {
        await UI.api(`/api/teams/${teamId}/invite`, { method: 'POST', body: { user_id: userId, message: UI.$('#invMsg').value.trim() } });
        UI.closeModal();
        UI.toast('邀请已发送', 'ok');
        if (onDone) onDone();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  },

  async kick(teamId, userId, ev) {
    const name = UI.eventText(ev, 'name');
    const ok = await UI.confirm(`确定将「${name}」移出队伍吗？`, { okText: '移除', danger: true });
    if (!ok) return;
    try {
      await UI.api(`/api/teams/${teamId}/members/${userId}`, { method: 'DELETE' });
      UI.toast('已移除', 'ok');
      Teams.managePage(UI.$('#view'), teamId);
    } catch (e) { UI.toast(e.message, 'err'); }
  },

  async transfer(teamId, userId) {
    const ok = await UI.confirm('确定把队长转让给该成员吗？转让后你成为普通成员。', { okText: '转让' });
    if (!ok) return;
    try {
      await UI.api(`/api/teams/${teamId}/transfer`, { method: 'POST', body: { user_id: userId } });
      UI.toast('队长已转让', 'ok');
      Teams.managePage(UI.$('#view'), teamId);
    } catch (e) { UI.toast(e.message, 'err'); }
  },

  async adminUnlock(teamId) {
    const ok = await UI.confirm('管理员解锁该队伍？解锁后队伍可继续调整成员。', { okText: '解锁' });
    if (!ok) return;
    try {
      await UI.api(`/api/admin/teams/${teamId}/unlock`, { method: 'POST' });
      UI.toast('已解锁', 'ok');
      Teams.managePage(UI.$('#view'), teamId);
    } catch (e) { UI.toast(e.message, 'err'); }
  },
};

window.Teams = Teams;
