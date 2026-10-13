/* 认证页：登录 / 注册 + 我的空间（资料编辑、申请记录） */
'use strict';

const Auth = {
  // 登录页：按报名模式（survey / open）渲染不同提示
  async loginPage(view) {
    const reg = await App.loadRegInfo();
    const isSurvey = reg.mode !== 'open';
    view.innerHTML = `
    <div style="max-width:420px;margin:40px auto">
      <div class="page-head"><h1>登录</h1><p class="sub">使用学号登录组队空间</p></div>
      <div class="card">
        <div class="form-item"><label>学号<span class="req">*</span></label><input type="text" id="loginSid" placeholder="8-15 位数字" maxlength="15"></div>
        <div class="form-item"><label>密码<span class="req">*</span></label><input type="password" id="loginPwd" placeholder="${isSurvey ? '初始密码为学号后 6 位' : '注册时设置的密码'}"></div>
        <button class="btn" id="loginBtn" style="width:100%">登 录</button>
        <p style="text-align:center;margin-top:14px;font-size:13.5px;color:var(--ink-2)">
          ${isSurvey
            ? `还没有报名？<a href="#/register">查看报名方式</a> ｜ 忘记密码请联系赛务组重置
               <br><span style="font-size:12.5px;color:var(--ink-3)">初始密码为学号后 6 位，登录后可在「我的空间」修改</span>`
            : `还没有账号？<a href="#/register">立即注册</a> ｜ 忘记密码请联系赛务组重置`}
        </p>
      </div>
    </div>`;
    Auth.bindLogin(view);
  },

  // 报名页：问卷制显示报名指引；开放注册模式回退到注册表单
  async registerPage(view) {
    const reg = await App.loadRegInfo();
    if (reg.mode === 'open') {
      view.innerHTML = Auth.registerFormHTML();
      Auth.bindRegister(view);
      return;
    }
    const surveyUrl = reg.survey_url && reg.survey_url !== 'https://wj.qq.com/' ? reg.survey_url : '';
    view.innerHTML = `
    <div style="max-width:560px;margin:30px auto">
      <div class="page-head"><h1>报名参加</h1><p class="sub">两种方式任选其一 · 实名信息仅用于本次活动组队与联络</p></div>
      <div class="card">
        <h3 style="font-family:var(--serif);margin-bottom:12px">方式一：填写报名问卷（推荐 · 无需审核）</h3>
        <div class="timeline">
          <div class="tl-item"><span class="tl-stage">第 1 步</span><div class="tl-content">填写报名问卷（约 1 分钟，需要姓名 / 学号 / 联系方式）</div></div>
          <div class="tl-item"><span class="tl-stage">第 2 步</span><div class="tl-content">赛务组将名单导入本空间（提交后一般当天处理）</div></div>
          <div class="tl-item"><span class="tl-stage">第 3 步</span><div class="tl-content">用 <b>学号</b> + <b>学号后 6 位</b> 登录本空间 → 完善名片 → 找队友组队（截止 10/16 22:00）</div></div>
        </div>
        <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
          ${surveyUrl
            ? `<a class="btn" href="${UI.esc(surveyUrl)}" target="_blank" rel="noopener">填写报名问卷 ↗</a>`
            : `<span class="tag warn" style="align-self:center">报名问卷链接配置中，请留意协会群通知</span>`}
          <a class="btn outline" href="#/login">已报名？直接登录</a>
        </div>
        <p style="margin-top:16px;font-size:13px;color:var(--ink-2);line-height:1.9">
          若登录时提示「该学号暂无报名记录」，可能是名单尚未导入，请稍后再试或联系赛务组；<br>
          问卷重复提交以最新一次为准，姓名如有修改请重新提交并在群里告知赛务组。
        </p>
      </div>
      <div class="card" style="margin-top:16px">
        <h3 style="font-family:var(--serif);margin-bottom:8px">方式二：直接注册申请（需赛务组审核）</h3>
        <p style="font-size:13.5px;color:var(--ink-2);line-height:1.9">
          不想填问卷？也可以直接在本系统填写信息提交注册申请，赛务组审核通过后即可登录（一般当天处理）。
        </p>
        <button class="btn outline" id="toManualReg" style="margin-top:12px">填写信息并提交申请 →</button>
      </div>
    </div>`;
    UI.$('#toManualReg').onclick = () => {
      view.innerHTML = Auth.registerFormHTML({ manual: true });
      Auth.bindRegister(view);
    };
  },

  registerFormHTML({ manual = false } = {}) {
    const skillChips = ['前端开发','后端开发','游戏开发','AI / 算法','UI / 设计','产品 / 策划','新媒体运营','暂无经验，想学习'].map((s) => `<span class="chip" data-skill="${s}">${s}</span>`).join('');
    return `
    <div style="max-width:520px;margin:30px auto">
      <div class="page-head"><h1>${manual ? '注册申请' : '注册'}</h1><p class="sub">${manual ? '直接注册 · 提交后由赛务组审核（一般当天处理）' : '实名注册 · 信息仅用于本次活动组队与联络'}</p></div>
      <div class="card">
        ${manual ? `<div style="background:var(--green-bg);border-radius:9px;padding:10px 14px;font-size:13px;color:var(--green-dark);margin-bottom:16px;line-height:1.8">提示：如你已填写过报名问卷，无需重复注册——等待名单导入后直接用「学号 + 学号后 6 位」登录即可。<br>提交本申请后，赛务组审核通过才能登录（一般当天处理）。</div>` : ''}
        <div class="form-item"><label>姓名<span class="req">*</span></label><input type="text" id="regName" maxlength="20" placeholder="真实姓名"></div>
        <div class="form-item"><label>学号<span class="req">*</span></label><input type="text" id="regSid" maxlength="15" placeholder="8-15 位数字，登录凭证"></div>
        <div class="form-item"><label>密码<span class="req">*</span></label><input type="password" id="regPwd" placeholder="至少 6 位${manual ? '，用于审核通过后登录' : ''}"></div>
        <div class="form-item"><label>学院</label><input type="text" id="regCollege" maxlength="40" placeholder="如：人工智能学院"></div>
        <div class="form-item"><label>专业</label><input type="text" id="regMajor" maxlength="40" placeholder="如：软件工程"></div>
        <div class="form-item"><label>年级</label><input type="text" id="regGrade" maxlength="20" placeholder="如：2024级"></div>
        <div class="form-item"><label>联系方式（微信 / QQ / 手机）<span class="req">*</span></label>
          <input type="text" id="regContact" maxlength="40" placeholder="如：微信 abc123（用于组队联系）">
          <p class="form-hint">默认不在名片广场公开；你申请加入队伍时，会提供给该队队长。</p></div>
        <div class="form-item"><label>联系方式公开展示</label>
          <label class="check-line"><input type="checkbox" id="regContactVisible"> 在选手名片广场公开展示我的联系方式</label>
          <p class="form-hint">保持关闭即为「默认不公开」；之后可随时在「我的空间 → 我的名片」修改。</p></div>
        <div class="form-item"><label>技能方向（多选）</label><div class="chips" id="regSkills">${skillChips}</div></div>
        <div class="form-item"><label>AI 基础</label>
          <select id="regAi"><option>零基础</option><option selected>入门</option><option>熟练</option></select></div>
        <div class="form-item"><label>一句话自荐</label><textarea id="regBio" maxlength="200" placeholder="如：想找个游戏方向的队，会一点 Godot，肯学"></textarea></div>
        <button class="btn" id="regBtn" style="width:100%">${manual ? '提交注册申请' : '注册并登录'}</button>
        <p style="text-align:center;margin-top:14px;font-size:13.5px;color:var(--ink-2)">${manual ? '<a href="#/register">← 返回报名方式</a>' : '已有账号？<a href="#/login">直接登录</a>'}</p>
      </div>
    </div>`;
  },

  bindLogin(view) {
    const doLogin = async () => {
      const btn = UI.$('#loginBtn');
      btn.disabled = true; btn.textContent = '登录中…';
      try {
        const data = await UI.api('/api/auth/login', {
          method: 'POST',
          body: { student_id: UI.$('#loginSid').value.trim(), password: UI.$('#loginPwd').value },
        });
        UI.me = data;
        UI.toast(`欢迎回来，${data.name}！`, 'ok');
        location.hash = data.team_id ? '#/my' : '#/teams';
        if (window.App) { App.ensureBadgePolling(); App.refreshNav(); }
      } catch (e) {
        UI.toast(e.message, 'err');
        btn.disabled = false; btn.textContent = '登 录';
      }
    };
    UI.$('#loginBtn').onclick = doLogin;
    UI.$('#loginPwd').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
  },

  bindRegister(view) {
    UI.$$('#regSkills .chip').forEach((c) => {
      c.onclick = () => c.classList.toggle('on');
    });
    const idleLabel = UI.$('#regBtn').textContent;
    UI.$('#regBtn').onclick = async () => {
      const btn = UI.$('#regBtn');
      const skills = UI.$$('#regSkills .chip.on').map((c) => c.dataset.skill);
      btn.disabled = true; btn.textContent = '提交中…';
      try {
        const data = await UI.api('/api/auth/register', {
          method: 'POST',
          body: {
            name: UI.$('#regName').value.trim(),
            student_id: UI.$('#regSid').value.trim(),
            password: UI.$('#regPwd').value,
            college: UI.$('#regCollege').value.trim(),
            major: UI.$('#regMajor').value.trim(),
            grade: UI.$('#regGrade').value.trim(),
            contact: UI.$('#regContact').value.trim(),
            contact_visible: !!UI.$('#regContactVisible').checked,
            skills,
            ai_level: UI.$('#regAi').value,
            bio: UI.$('#regBio').value.trim(),
          },
        });
        if (data && data.pending) {
          // 问卷制：进入「待审核」状态，展示提交成功页
          view.innerHTML = `
          <div style="max-width:520px;margin:40px auto">
            <div class="card" style="text-align:center;padding:44px 30px">
              <div style="width:56px;height:56px;border-radius:50%;background:var(--green-bg);color:var(--green);display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 14px">✓</div>
              <h2 style="font-family:var(--serif);font-size:22px">注册申请已提交</h2>
              <p style="color:var(--ink-2);margin-top:10px;font-size:14.5px">${UI.esc(data.message || '等待赛务组审核通过后即可登录')}</p>
              <p style="color:var(--ink-3);font-size:13px;margin-top:6px">审核通过后，用「学号 + 你设置的密码」登录；如需加急可在群里联系赛务组</p>
              <div style="margin-top:22px;display:flex;gap:10px;justify-content:center">
                <a class="btn" href="#/login">去登录</a>
                <a class="btn outline" href="#/">返回首页</a>
              </div>
            </div>
          </div>`;
          UI.toast('申请已提交，等待赛务组审核', 'ok');
          return;
        }
        UI.me = data;
        UI.toast('注册成功，欢迎参加 AI 黑客松！', 'ok');
        location.hash = '#/teams';
        if (window.App) { App.ensureBadgePolling(); App.refreshNav(); }
      } catch (e) {
        UI.toast((e.details && e.details[0]) || e.message, 'err');
        btn.disabled = false; btn.textContent = idleLabel;
      }
    };
  },

  // ---------- 我的空间 ----------
  async myPage(view) {
    if (!UI.me) { location.hash = '#/login'; return; }
    view.innerHTML = '<div class="loading">加载中…</div>';
    let me, myInvites, myTeamDetail = null;
    try {
      me = await UI.api('/api/auth/me');
      UI.me = me;
      myInvites = await UI.api('/api/teams/invites/mine');
      if (me.team_id) {
        myTeamDetail = await UI.api(`/api/teams/${me.team_id}`);
      }
    } catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }

    // 只展示与「我」直接相关的记录：别人邀请我 / 我发出的申请
    const pendingInvites = myInvites.filter((i) => i.status === 'pending' && i.direction === 'invite' && i.user_id === me.id);
    const pendingApplies = myInvites.filter((i) => i.status === 'pending' && i.direction === 'apply' && i.user_id === me.id);
    // 最近处理过的记录（便于回顾申请/邀请的结果）
    const handledMeta = { accepted: ['已加入', ''], declined: ['已拒绝', 'gray'], cancelled: ['已撤回', 'gray'], expired: ['已失效', 'gray'] };
    const handled = myInvites
      .filter((i) => i.status !== 'pending' && i.user_id === me.id)
      .slice(0, 6)
      .map((i) => {
        const meta = handledMeta[i.status] || [i.status, 'gray'];
        return { ...i, status_label: meta[0], status_cls: meta[1] };
      });

    view.innerHTML = `
      <div class="page-head"><h1>我的空间</h1><p class="sub">管理名片、查看队伍与邀请</p></div>

      ${pendingInvites.length ? `
      <div class="card" style="border-color:var(--coral);margin-bottom:16px">
        <b style="color:var(--coral)">收到 ${pendingInvites.length} 个入队邀请</b>
        ${pendingInvites.map((i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px dashed var(--line)">
            <div style="flex:1"><b>「${UI.esc(i.team_name)}」</b> 邀请你加入
              ${i.message ? `<span style="color:var(--ink-2);font-size:13px">“${UI.esc(i.message)}”</span>` : ''}</div>
            <button class="btn sm" onclick="Auth.respondInvite('${i.id}','accept')">接受</button>
            <button class="btn sm outline" onclick="Auth.respondInvite('${i.id}','decline')">婉拒</button>
          </div>`).join('')}
      </div>` : ''}

      ${pendingApplies.length ? `
      <div class="card" style="margin-bottom:16px">
        <b>我的申请（${pendingApplies.length} 个待处理）</b>
        ${pendingApplies.map((i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px dashed var(--line)">
            <div style="flex:1">申请加入 <b>「${UI.esc(i.team_name)}」</b></div>
            <button class="btn sm outline" onclick="Auth.respondInvite('${i.id}','cancel')">撤回</button>
          </div>`).join('')}
      </div>` : ''}

      ${handled.length ? `
      <div class="card" style="margin-bottom:16px">
        <b>最近记录</b>
        ${handled.map((i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line)">
            <span style="flex:1;font-size:13.5px;color:var(--ink-2);min-width:0">${i.direction === 'invite' ? `收到「${UI.esc(i.team_name)}」的邀请` : `申请加入「${UI.esc(i.team_name)}」`}</span>
            <span class="tag ${i.status_cls}" style="flex:none">${UI.esc(i.status_label)}</span>
            <span style="font-size:12px;color:var(--ink-3);flex:none">${UI.fmtTime(i.updated_at || i.created_at, { withDate: true })}</span>
          </div>`).join('')}
      </div>` : ''}

      <div class="grid grid-2c" style="gap:16px" id="myGrid">
        <div class="card">
          <h3 style="font-family:var(--serif);margin-bottom:12px">我的名片</h3>
          ${Auth.profileFormHTML(me)}
        </div>
        <div class="card">
          <h3 style="font-family:var(--serif);margin-bottom:12px">我的队伍</h3>
          ${myTeamDetail ? `
            <a href="#/team/${myTeamDetail.id}" class="card clickable embed" style="border:none;padding:12px;margin:-12px">
              <div class="team-name">${UI.esc(myTeamDetail.name)}</div>
              <div class="team-meta"><span class="track-badge ${myTeamDetail.track}">${UI.esc(myTeamDetail.track_name)}</span>
                ${UI.statusTag(myTeamDetail.status)} <span class="tag gray">${myTeamDetail.member_count}/${myTeamDetail.max_size} 人</span></div>
              <div class="team-topic">${UI.esc(myTeamDetail.topic_title)}</div>
            </a>
            ${myTeamDetail.my_role === 'captain' ? `<a class="btn outline sm" style="margin-top:10px" href="#/team/${myTeamDetail.id}">进入队长管理</a>` : ''}
          ` : `
            <p style="color:var(--ink-3);font-size:14px;margin-bottom:14px">还没有加入任何队伍</p>
            <a class="btn" href="#/team/new">创建队伍</a>
            <a class="btn outline" style="margin-left:8px" href="#/teams">去队伍广场看看</a>
          `}
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h3 style="font-family:var(--serif);margin-bottom:12px">账号安全</h3>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
          <div class="form-item" style="flex:1;min-width:170px;margin:0"><label>原密码</label><input type="password" id="cpOld" maxlength="64" autocomplete="current-password"></div>
          <div class="form-item" style="flex:1;min-width:170px;margin:0"><label>新密码（至少 6 位）</label><input type="password" id="cpNew" maxlength="64" autocomplete="new-password"></div>
          <button class="btn outline" id="cpBtn">修改密码</button>
        </div>
      </div>`;
    Auth.bindProfileForm(me);
    UI.$('#cpBtn').onclick = async () => {
      const oldPwd = UI.$('#cpOld').value;
      const newPwd = UI.$('#cpNew').value;
      if (!oldPwd || !newPwd) return UI.toast('请填写原密码和新密码', 'err');
      if (newPwd.length < 6) return UI.toast('新密码至少 6 位', 'err');
      try {
        await UI.api('/api/auth/change-password', { method: 'POST', body: { old_password: oldPwd, new_password: newPwd } });
        UI.$('#cpOld').value = '';
        UI.$('#cpNew').value = '';
        UI.toast('密码已修改，其他设备需重新登录', 'ok');
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  },

  profileFormHTML(me) {
    const skillChips = ['前端开发','后端开发','游戏开发','AI / 算法','UI / 设计','产品 / 策划','新媒体运营','暂无经验，想学习']
      .map((s) => `<span class="chip ${(me.skills || []).includes(s) ? 'on' : ''}" data-skill="${s}">${s}</span>`).join('');
    return `
      <div class="form-item"><label>姓名</label><input type="text" id="pfName" value="${UI.esc(me.name)}" maxlength="20"></div>
      <div class="form-item"><label>学号</label><input type="text" value="${UI.esc(me.student_id)}" disabled></div>
      <div class="form-item"><label>学院 / 专业 / 年级</label>
        <div style="display:flex;gap:8px">
          <input type="text" id="pfCollege" value="${UI.esc(me.college || '')}" placeholder="学院" style="flex:1;min-width:0">
          <input type="text" id="pfMajor" value="${UI.esc(me.major || '')}" placeholder="专业" style="flex:1;min-width:0">
        </div>
        <input type="text" id="pfGrade" value="${UI.esc(me.grade || '')}" placeholder="年级" style="margin-top:8px">
      </div>
      <div class="form-item"><label>联系方式（微信/QQ/手机）</label><input type="text" id="pfContact" value="${UI.esc(me.contact || '')}" maxlength="40"></div>
      <div class="form-item"><label>联系方式公开展示</label>
        <label class="check-line"><input type="checkbox" id="pfContactVisible" ${me.contact_visible ? 'checked' : ''}> 在选手名片广场公开展示我的联系方式</label>
        <p class="form-hint">默认不公开。本人、队友，以及你申请加入的队伍队长始终可见。</p></div>
      <div class="form-item"><label>技能方向</label><div class="chips" id="pfSkills">${skillChips}</div></div>
      <div class="form-item"><label>AI 基础</label>
        <select id="pfAi">${['零基础','入门','熟练'].map((x) => `<option ${x === me.ai_level ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="form-item"><label>一句话自荐</label><textarea id="pfBio" maxlength="200">${UI.esc(me.bio || '')}</textarea></div>
      <div class="form-item"><label>状态</label>
        <select id="pfLooking"><option value="1" ${me.looking_for_team ? 'selected' : ''}>找队中（名片广场优先展示）</option>
        <option value="" ${!me.looking_for_team ? 'selected' : ''}>已入队 / 暂不找队</option></select></div>
      <button class="btn" id="pfSave">保存名片</button>`;
  },

  bindProfileForm() {
    UI.$$('#pfSkills .chip').forEach((c) => { c.onclick = () => c.classList.toggle('on'); });
    UI.$('#pfSave').onclick = async () => {
      try {
        await UI.api('/api/players/me', {
          method: 'PUT',
          body: {
            name: UI.$('#pfName').value.trim(),
            college: UI.$('#pfCollege').value.trim(),
            major: UI.$('#pfMajor').value.trim(),
            grade: UI.$('#pfGrade').value.trim(),
            contact: UI.$('#pfContact').value.trim(),
            contact_visible: !!UI.$('#pfContactVisible').checked,
            bio: UI.$('#pfBio').value.trim(),
            skills: UI.$$('#pfSkills .chip.on').map((c) => c.dataset.skill),
            ai_level: UI.$('#pfAi').value,
            looking_for_team: !!UI.$('#pfLooking').value,
          },
        });
        UI.toast('名片已更新', 'ok');
        App.refreshNav();
      } catch (e) { UI.toast((e.details && e.details[0]) || e.message, 'err'); }
    };
  },

  async respondInvite(id, action) {
    const labels = { accept: '接受', decline: '婉拒', cancel: '撤回' };
    const doneText = { accept: '已加入队伍！', decline: '已婉拒', cancel: '已撤回' };
    const ok = await UI.confirm(`确定${labels[action] || action}这条记录吗？`, { okText: labels[action] || '确认' });
    if (!ok) return;
    try {
      await UI.api(`/api/teams/invites/${id}/${action}`, { method: 'POST' });
      UI.toast(doneText[action] || '已处理', 'ok');
      await Auth.myPage(UI.$('#view'));
      App.refreshNav();
    } catch (e) { UI.toast(e.message, 'err'); }
  },
};

window.Auth = Auth;
