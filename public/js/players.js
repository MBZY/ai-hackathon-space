/* 选手名片广场 */
'use strict';

const Players = {
  _myTeam: null,          // 我加入的队伍详情（若我是队长且招募中，名片卡显示「邀请入队」）
  _invitedIds: new Set(), // 本会话已邀请过的用户（防重复点击，服务端仍会二次校验）
  _refresh: null,         // 列表刷新闭包（邀请成功后局部刷新）

  async listPage(view, query = {}) {
    if (!UI.me) {
      view.innerHTML = `
      <div class="empty" style="padding-top:80px">
        <div class="big">🔐</div>
        <p style="font-size:15px">选手名片仅对报名同学开放</p>
        <p style="font-size:13.5px;margin-top:6px">登录后可查看技能与自我介绍；联系方式由同学选择是否公开，可先私信或申请入队沟通</p>
        <div style="margin-top:22px"><a class="btn" href="#/login">去登录</a>
        <a class="btn outline" style="margin-left:8px" href="#/register">报名方式</a></div>
      </div>`;
      return;
    }

    // 载入我的队伍（决定名片卡是否显示「邀请入队」按钮）
    Players._myTeam = null;
    if (UI.me.team_id) {
      try { Players._myTeam = await UI.api('/api/teams/' + UI.me.team_id); } catch (e) { /* ignore */ }
    }

    const skills = ['前端开发','后端开发','游戏开发','AI / 算法','UI / 设计','产品 / 策划','新媒体运营','暂无经验，想学习'];
    view.innerHTML = `
      <div class="page-head"><h1>选手名片广场</h1><p class="sub">按技能找人，主动邀请组队 —— 联系方式由同学选择公开，未公开可先私信</p></div>
      <div class="card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:12px 16px;margin-bottom:18px">
        <div class="chips" id="pkSkills">
          <span class="chip ${query.looking === '1' ? 'on' : ''}" data-looking="1">找队中</span>
          ${skills.map((s) => `<span class="chip ${query.skill === s ? 'on' : ''}" data-skill="${s}">${s}</span>`).join('')}
        </div>
        <input type="text" id="pkSearch" placeholder="搜姓名 / 学号 / 专业…" value="${UI.esc(query.q || '')}" style="margin-left:auto;padding:7px 12px;border:1px solid var(--line);border-radius:999px;width:190px">
        <span id="pkCount" style="font-size:13px;color:var(--ink-3)"></span>
      </div>
      <div id="pkList"><div class="loading">加载中…</div></div>`;

    // 只刷新列表区 + 筛选态，输入框焦点不丢
    const refresh = async () => {
      const params = new URLSearchParams();
      if (query.skill) params.set('skill', query.skill);
      if (query.looking) params.set('looking', query.looking);
      if (query.q) params.set('q', query.q);
      const listEl = UI.$('#pkList');
      let users;
      try {
        users = await UI.api('/api/players' + (params.toString() ? '?' + params : ''));
      } catch (e) {
        listEl.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`;
        return;
      }
      UI.$$('#pkSkills .chip').forEach((c) => {
        if (c.dataset.looking) c.classList.toggle('on', query.looking === '1');
        else c.classList.toggle('on', query.skill === c.dataset.skill);
      });
      UI.$('#pkCount').textContent = `共 ${users.length} 位同学`;
      listEl.innerHTML = users.length === 0
        ? `<div class="empty"><div class="big">🧑‍💻</div>暂无匹配的同学</div>`
        : `<div class="grid grid-3">${users.map((u) => Players.cardHTML(u)).join('')}</div>`;
    };
    Players._refresh = refresh;

    UI.$$('#pkSkills .chip').forEach((c) => {
      c.onclick = () => {
        if (c.dataset.looking) query.looking = query.looking === '1' ? '' : '1';
        else query.skill = query.skill === c.dataset.skill ? '' : c.dataset.skill;
        refresh();
      };
    });
    let searchTimer;
    UI.$('#pkSearch').oninput = (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { query.q = e.target.value.trim(); refresh(); }, 350);
    };

    await refresh();
  },

  cardHTML(u) {
    const isMe = UI.me && u.id === UI.me.id;
    // 元信息：过滤空字段，用「·」分隔；每段独立成块，避免「2026级」被折成「2026 / 级」
    const metaParts = [u.college, u.major, u.grade].filter(Boolean);
    const metaHTML = metaParts.length
      ? metaParts.map((s) => `<span>${UI.esc(s)}</span>`).join(' <i class="sep">·</i> ')
      : '<span>资料待完善</span>';
    const statusTag = u.team_name
      ? '<span class="tag gray status">已入队</span>'
      : u.looking_for_team ? '<span class="tag coral status">找队中</span>' : '';
    // 联系方式：API 已按规则返回（本人 / 队友 / 主动公开）—— 未返回则显示未公开提示
    const contactHTML = u.contact !== undefined
      ? `<div class="contact-row"><span class="ck">联系：</span><b>${UI.esc(u.contact || '未填写')}</b>${
          isMe
            ? (u.contact_visible
              ? '<span class="tag">已公开</span>'
              : '<span class="tag gray" title="可在「我的空间 → 我的名片」开启公开">未公开</span>')
            : ''
        }</div>`
      : '<div class="contact-row"><span class="lock-hint">联系方式未公开 · 私信或申请入队后可见</span></div>';

    // 邀请入队：我是队长、队伍招募中、对方尚未入队（人数不设上限，仅推荐 3~5 人）
    const myTeam = Players._myTeam;
    const canInvite = !!(UI.me && !isMe && !u.team_id && myTeam
      && myTeam.my_role === 'captain' && myTeam.status === 'recruiting');
    const invited = Players._invitedIds.has(u.id);

    return `
    <div class="card player-card">
      <div class="player-head">
        ${UI.avatar(u.name, u.id, 'lg')}
        <div class="player-head-main">
          <div class="player-name-row">
            <span class="player-name">${UI.esc(u.name)}</span>
            ${isMe ? '<span class="tag">我</span>' : ''}
            ${statusTag}
          </div>
          <div class="player-sub">${metaHTML}</div>
        </div>
      </div>
      <div style="margin-top:10px">${UI.chips(u.skills)}<span class="tag gray">AI · ${UI.esc(u.ai_level || '入门')}</span></div>
      ${u.bio ? `<p class="player-bio">${UI.esc(u.bio)}</p>` : ''}
      ${contactHTML}
      ${u.team_name ? `<div class="player-team">所属队伍：${UI.esc(u.team_name)}</div>` : ''}
      <div class="player-actions">
        ${!isMe
          ? `<button class="btn sm outline" onclick="location.hash='#/messages/${u.id}'">私信</button>`
          : `<a class="btn sm outline" href="#/my">编辑名片</a>`}
        ${canInvite ? `<button class="btn sm" ${invited ? 'disabled' : ''} onclick="Players.invite('${u.id}')">${invited ? '已邀请' : '邀请入队'}</button>` : ''}
      </div>
    </div>`;
  },

  invite(userId) {
    const myTeam = Players._myTeam;
    if (!myTeam || Players._invitedIds.has(userId)) return;
    Teams.inviteUser(myTeam.id, userId, () => {
      Players._invitedIds.add(userId);
      if (Players._refresh) Players._refresh();
    });
  },
};

window.Players = Players;
