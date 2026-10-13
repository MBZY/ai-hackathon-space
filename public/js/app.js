/* 主应用：hash 路由、导航态、首页、规则页、通知轮询 */
'use strict';

const App = {
  notifTimer: null,
  unreadNotif: 0,
  unreadMsg: 0,
  regInfo: null, // 报名模式信息（/api/stats 里带回，登录/注册页与导航共用）

  // 拉取报名模式（带缓存；失败时按问卷制兜底）
  async loadRegInfo() {
    if (App.regInfo) return App.regInfo;
    try {
      const stats = await UI.api('/api/stats');
      App.regInfo = stats.registration || { mode: 'survey' };
    } catch (e) {
      App.regInfo = { mode: 'survey' };
    }
    return App.regInfo;
  },

  // 导航图标（内联 SVG，保持报刊风质感）
  svgBell: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  svgMail: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m22 7-10 6L2 7"/></svg>',

  // ---------- 活动节点 ----------
  milestones: [
    { at: new Date('2026-10-16T22:00:00+08:00'), label: '组队截止', next: '中期检查' },
    { at: new Date('2026-10-24T14:00:00+08:00'), label: '中期检查', next: '作品提交' },
    { at: new Date('2026-10-30T22:00:00+08:00'), label: '作品提交', next: '展示评审' },
  ],
  phase() {
    const now = Date.now();
    if (now < new Date('2026-10-16T22:00:00+08:00').getTime()) return { key: 'teaming', name: '组队期', range: '10/11 — 10/16' };
    if (now < new Date('2026-10-30T22:00:00+08:00').getTime()) return { key: 'hacking', name: '赛期', range: '10/17 — 10/30' };
    return { key: 'showcase', name: '展示评审', range: '10/31' };
  },
  nextDeadline() {
    for (const m of App.milestones) {
      if (Date.now() < m.at.getTime()) return m;
    }
    return null;
  },
  countdownHTML() {
    const m = App.nextDeadline();
    if (!m) {
      return `<div class="countdown-wrap"><div class="cd-head"><span class="cd-label">展示日 10/31 · 现场见</span><span class="cd-sys">FINAL DAY</span></div><div class="cd-ticks" style="margin-top:6px"></div></div>`;
    }
    let diff = m.at.getTime() - Date.now();
    const d = Math.floor(diff / 86400000); diff -= d * 86400000;
    const h = Math.floor(diff / 3600000); diff -= h * 3600000;
    const mi = Math.floor(diff / 60000);
    return `
    <div class="countdown-wrap">
      <div class="cd-head"><span class="cd-label">距「${m.label}」还有</span><span class="cd-sys">T-MINUS</span></div>
      <div class="cd-vals">
        ${d > 0 ? `<div class="cd-cell"><b>${d}</b><span>天</span></div>` : ''}
        <div class="cd-cell"><b>${String(h).padStart(2, '0')}</b><span>时</span></div>
        <div class="cd-cell"><b>${String(mi).padStart(2, '0')}</b><span>分</span></div>
      </div>
      <div class="cd-ticks"></div>
    </div>`;
  },

  // ---------- 导航 ----------
  refreshNav() {
    const right = UI.$('#navRight');
    if (!UI.me) {
      const isOpen = App.regInfo && App.regInfo.mode === 'open';
      right.innerHTML = `
        <a class="btn sm outline" href="#/login">登录</a>
        <a class="btn sm" href="#/register">${isOpen ? '注册' : '报名'}</a>`;
    } else {
      right.innerHTML = `
        <a class="nav-bell" href="#/notifications" title="通知">
          ${App.svgBell}${App.unreadNotif ? `<span class="badge-dot">${App.unreadNotif}</span>` : ''}
        </a>
        <a class="nav-bell" href="#/messages" title="私信">
          ${App.svgMail}${App.unreadMsg ? `<span class="badge-dot">${App.unreadMsg}</span>` : ''}
        </a>
        <a href="#/my" title="${UI.esc(UI.me.name)}" style="display:flex;align-items:center;gap:8px;text-decoration:none">
          ${UI.avatar(UI.me.name, UI.me.id, 'sm')}
          <span class="uname" style="font-size:14px;color:var(--ink)">${UI.esc(UI.me.name)}</span>
        </a>
        ${UI.me.role === 'admin' ? '<a class="tag" href="#/admin" style="cursor:pointer">后台</a>' : ''}
        <button class="nav-logout" id="navLogout" title="退出登录">退出</button>`;
    }
    const logoutBtn = UI.$('#navLogout');
    if (logoutBtn) logoutBtn.onclick = () => Auth.logout();
    // 高亮当前导航
    const key = (location.hash || '#/').split('/')[1] || 'home';
    UI.$$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === (key === '' ? 'home' : key)));
  },

  async pollBadges() {
    if (!UI.me) return;
    try {
      const [notif, conv] = await Promise.all([
        UI.api('/api/notifications'),
        UI.api('/api/messages/conversations'),
      ]);
      const changed = App.unreadNotif !== notif.unread || App.unreadMsg !== conv.total_unread;
      App.unreadNotif = notif.unread;
      App.unreadMsg = conv.total_unread;
      if (changed) App.refreshNav();
    } catch (e) { /* 静默 */ }
  },

  // 徽标轮询（幂等：登录后调用即可，全局唯一轮询）
  ensureBadgePolling() {
    if (!UI.me) return;
    App.pollBadges();
    if (!App.notifTimer) App.notifTimer = setInterval(() => App.pollBadges(), 30000);
  },

  // ---------- 首页 ----------
  async homePage(view) {
    view.innerHTML = '<div class="loading">加载中…</div>';
    let stats, anns, teams;
    try {
      [stats, anns, teams] = await Promise.all([
        UI.api('/api/stats'),
        UI.api('/api/announcements'),
        UI.api('/api/teams'),
      ]);
    } catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }

    const phase = App.phase();
    const tracks = [
      { key: 'web', name: '网站与应用开发', desc: 'Web 应用、小程序、效率工具', dept: '技术部对接' },
      { key: 'game', name: '游戏开发', desc: '2D / 3D 小游戏，引擎不限', dept: '椰风游戏组对接' },
      { key: 'media', name: '新媒体与智能体', desc: 'AI 内容生产、智能体应用', dept: '信宣部对接' },
      { key: 'open', name: '综合赛道', desc: '其他方向的跨界创作', dept: '跨部门协同' },
    ];

    view.innerHTML = `
    <div class="hero">
      <div class="hero-status"><span class="hdot"></span> SYSTEM LIVE <span class="hsep">/</span> ${phase.name} <span class="hsep">·</span> ${phase.range}</div>
      <div class="hero-grid">
        <div class="hero-main">
          <p class="hero-kicker">华南师范大学 · 人工智能创新协会 · 全国科普月项目</p>
          <h1>2026 秋季 <span class="h1-en">AI</span> 黑客松</h1>
          <p class="hero-sub">14 天，用 AI 做出一件完整的作品。<br>自由组队 · 四大赛道 · 现场展示评审。</p>
          <div class="hero-actions">
            ${UI.me ? (UI.me.team_id
              ? `<a class="btn" href="#/team/${UI.me.team_id}">进入我的队伍</a>`
              : `<a class="btn" href="#/team/new">创建队伍</a><a class="btn outline" href="#/teams">浏览队伍</a>`)
            : (stats.registration && stats.registration.mode === 'open'
              ? `<a class="btn" href="#/register">立即注册组队</a><a class="btn outline" href="#/teams">先逛逛队伍广场</a>`
              : `<a class="btn" href="#/login">用学号登录组队</a><a class="btn outline" href="#/register">报名方式</a>`)}
          </div>
          <p class="hero-note">每队 1—5 人 · 不设统一命题，赛道内自由选题${!UI.me && stats.registration && stats.registration.mode !== 'open'
            ? `<br>报名统一通过「${UI.esc(stats.registration.survey_title || '腾讯问卷')}」收集：先填问卷，名单导入后用学号登录（<b>${UI.esc(stats.registration.initial_password_hint || '初始密码为学号后 6 位')}</b>）`
            : ''}</p>
        </div>
        <div class="hero-meter">${App.countdownHTML()}</div>
      </div>
    </div>

    <div class="stat-strip">
      <div class="stat-box"><div class="stat-num">${stats.users}</div><div class="stat-label">已报名同学</div></div>
      <div class="stat-box"><div class="stat-num">${stats.teams}</div><div class="stat-label">参赛队伍</div></div>
      <div class="stat-box"><div class="stat-num">${stats.looking}</div><div class="stat-label">找队中</div></div>
      <div class="stat-box"><div class="stat-num">${stats.locked_teams}</div><div class="stat-label">已锁定队伍</div></div>
    </div>

    <div class="section-title">赛道 <span class="more">评审：完成度 30% · 技术难度 25% · 创新 20% · 协作 15% · 宣发 10%</span></div>
    <div class="grid grid-2">
      ${tracks.map((t, i) => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="track-code">TRACK ${String(i + 1).padStart(2, '0')}</span>
          <span class="track-badge ${t.key}" style="font-size:11px">${stats.tracks[t.key] || 0} 队</span>
        </div>
        <b style="font-size:16.5px;display:block;margin-top:9px">${t.name}</b>
        <p style="font-size:13.5px;color:var(--ink-2);margin-top:6px">${t.desc}</p>
        <p style="font-size:12px;color:var(--ink-3);margin-top:4px">${t.dept}</p>
      </div>`).join('')}
    </div>

    <div class="section-title">公告 <span class="more"><a href="#/rules">赛事规则与 AI 使用规范 →</a></span></div>
    <div class="card">
      ${anns.length === 0 ? `<div class="announce-item"><div class="announce-content">暂无公告。关键节点：组队截止 <b>10/16 22:00</b> · 中期检查 <b>10/24 14:00</b> · 作品提交 <b>10/30 22:00</b> · 展示评审 <b>10/31</b></div></div>`
      : anns.slice(0, 4).map((a) => `
        <div class="announce-item">
          <div class="announce-title">${a.is_pinned ? '<span class="tag">置顶</span> ' : ''}${UI.esc(a.title)}</div>
          <div class="announce-content">${UI.esc(a.content)}</div>
          <div class="announce-time">${UI.fmtTime(a.created_at, { withDate: true })}</div>
        </div>`).join('')}
    </div>

    ${teams.length ? `
    <div class="section-title">最新队伍 <span class="more"><a href="#/teams">查看全部 ${teams.length} 支 →</a></span></div>
    <div class="grid grid-2">${teams.slice(0, 4).map((t) => Teams.cardHTML(t)).join('')}</div>` : ''}`;
  },

  // ---------- 规则页 ----------
  rulesPage(view) {
    view.innerHTML = `
    <div class="page-head"><h1>赛事规则与 AI 使用规范</h1><p class="sub">依据《AI 黑客松活动计划书》整理，冲突时以计划书为准</p></div>
    <div class="grid grid-2c">
      <div class="card">
        <h3 style="font-family:var(--serif);margin-bottom:12px">赛程</h3>
        <div class="timeline">
          <div class="tl-item"><span class="tl-stage">10/11</span><div class="tl-content">路演现场宣讲，报名开放</div></div>
          <div class="tl-item"><span class="tl-stage">10/12 — 10/16 22:00</span><div class="tl-content">报名与组队期（本平台完成组队并锁定）</div></div>
          <div class="tl-item"><span class="tl-stage">10/17</span><div class="tl-content">正式开赛（线上开赛，不设线下开幕式）</div></div>
          <div class="tl-item"><span class="tl-stage">10/24 14:00</span><div class="tl-content">中期检查：提交进度说明与可运行版本</div></div>
          <div class="tl-item"><span class="tl-stage">10/30 22:00</span><div class="tl-content">作品提交截止：代码仓库 + 演示视频(≤3min) + 说明文档 + AI 使用声明</div></div>
          <div class="tl-item"><span class="tl-stage">10/31</span><div class="tl-content">作品展览、现场评审与人气投票</div></div>
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:16px">
          <h3 style="font-family:var(--serif);margin-bottom:12px">赛制要点</h3>
          <ul style="font-size:14px;line-height:2;padding-left:20px;color:var(--ink-2)">
            <li>以团队报名，每队 <b>3—5 人</b>（特殊情况可 1 人独立参赛），鼓励跨专业跨年级</li>
            <li><b>不设统一命题</b>，赛道内自由选题；作品须为赛期内新启动项目</li>
            <li>四大赛道：网站与应用开发 / 游戏开发 / 新媒体与智能体 / 综合</li>
            <li>奖项：一等奖 1 组、二等奖 2 组、三等奖 3 组、最佳人气奖 3 组、完赛奖全员</li>
            <li>完赛数据作为协会各部门人才遴选参考</li>
          </ul>
        </div>
        <div class="card">
          <h3 style="font-family:var(--serif);margin-bottom:12px">AI 使用规范（要点）</h3>
          <ul style="font-size:14px;line-height:2;padding-left:20px;color:var(--ink-2)">
            <li>仅使用协会统一备案、国内合规可访问的 AI 工具</li>
            <li>严禁向 AI 工具上传学校涉密信息、未公开教学科研资料、他人个人信息</li>
            <li>作品须随附《AI 使用声明》，如实说明 AI 参与环节</li>
            <li>素材来源合法，AI 生成素材确认可用于非商业展示</li>
            <li>线上作品部署遵守网络安全法规，接受两级内容审查</li>
          </ul>
        </div>
      </div>
    </div>`;
  },

  // ---------- 路由 ----------
  async route() {
    const view = UI.$('#view');
    const hash = location.hash || '#/';
    const parts = hash.replace(/^#\//, '').split('/').filter(Boolean);
    const page = parts[0] || 'home';
    const arg = parts[1];
    const sub = parts[2];
    Messages.stopPoll();

    try {
      if (page === 'home') await App.homePage(view);
      else if (page === 'login') await Auth.loginPage(view);
      else if (page === 'register') await Auth.registerPage(view);
      else if (page === 'teams') await Teams.listPage(view, {});
      else if (page === 'feed') await Feed.page(view);
      else if (page === 'team' && arg === 'new') Teams.newPage(view);
      else if (page === 'team' && arg && sub === 'manage') await Teams.managePage(view, arg);
      else if (page === 'team' && arg) await Teams.detailPage(view, arg);
      else if (page === 'players') await Players.listPage(view, {});
      else if (page === 'my') await Auth.myPage(view);
      else if (page === 'messages' && arg) await Messages.chatPage(view, arg);
      else if (page === 'messages') await Messages.listPage(view);
      else if (page === 'notifications') await Messages.notificationsPage(view);
      else if (page === 'rules') App.rulesPage(view);
      else if (page === 'admin' && arg === 'teams') await Admin.teamsPage(view);
      else if (page === 'admin' && arg === 'users') await Admin.usersPage(view);
      else if (page === 'admin' && arg === 'review') await Admin.reviewPage(view);
      else if (page === 'admin' && arg === 'import') await Admin.importPage(view);
      else if (page === 'admin' && arg === 'announcements') await Admin.announcementsPage(view);
      else if (page === 'admin') await Admin.overviewPage(view);
      else view.innerHTML = '<div class="empty">页面不存在 <a href="#/">回首页</a></div>';
    } catch (e) {
      view.innerHTML = `<div class="empty">${UI.esc(e.message || '页面加载失败')}</div>`;
    }
    App.refreshNav();
    window.scrollTo(0, 0);
  },

  async boot() {
    // 恢复登录态
    try { UI.me = await UI.api('/api/auth/me'); } catch (e) { UI.me = null; }
    window.addEventListener('hashchange', () => App.route());
    App.route();
    if (UI.me) App.ensureBadgePolling();
    // 首页倒计时每分钟刷新
    setInterval(() => {
      if ((location.hash || '#/') === '#/' && UI.$('.countdown-wrap')) {
        const el = UI.$('.countdown-wrap');
        if (el) el.outerHTML = App.countdownHTML();
      }
    }, 60000);
  },
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.boot());
