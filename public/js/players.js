/* 选手名片广场 */
'use strict';

const Players = {
  async listPage(view, query = {}) {
    if (!UI.me) {
      view.innerHTML = `
      <div class="empty" style="padding-top:80px">
        <div class="big">🔐</div>
        <p style="font-size:15px">选手名片仅对报名同学开放</p>
        <p style="font-size:13.5px;margin-top:6px">登录后可查看技能、AI 基础与联系方式，直接私信或邀请入队</p>
        <div style="margin-top:22px"><a class="btn" href="#/login">去登录</a>
        <a class="btn outline" style="margin-left:8px" href="#/register">报名方式</a></div>
      </div>`;
      return;
    }

    const skills = ['前端开发','后端开发','游戏开发','AI / 算法','UI / 设计','产品 / 策划','新媒体运营','暂无经验，想学习'];
    view.innerHTML = `
      <div class="page-head"><h1>选手名片广场</h1><p class="sub">按技能找人，主动邀请组队 —— 找队中的同学优先展示</p></div>
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
    return `
    <div class="card">
      <div style="display:flex;gap:12px;align-items:center">
        ${UI.avatar(u.name, u.id, 'lg')}
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:16px">${UI.esc(u.name)} ${isMe ? '<span class="tag">我</span>' : ''}</div>
          <div style="font-size:12.5px;color:var(--ink-3)">${UI.esc(u.college || '')} ${UI.esc(u.major || '')} ${UI.esc(u.grade || '')}</div>
        </div>
        ${u.team_name ? '<span class="tag gray">已入队</span>' : u.looking_for_team ? '<span class="tag coral">找队中</span>' : ''}
      </div>
      <div style="margin-top:10px">${UI.chips(u.skills)}<span class="tag gray">AI · ${UI.esc(u.ai_level || '入门')}</span></div>
      ${u.bio ? `<p style="font-size:13px;color:var(--ink-2);margin-top:9px">${UI.esc(u.bio)}</p>` : ''}
      <div class="contact-row" style="margin-top:10px"><span>联系：</span><b>${UI.esc(u.contact || '未填写')}</b></div>
      ${u.team_name ? `<div style="margin-top:8px;font-size:12.5px;color:var(--ink-3)">所属队伍：${UI.esc(u.team_name)}</div>` : ''}
      <div style="margin-top:12px;display:flex;gap:8px">
        ${!isMe ? `<button class="btn sm outline" style="flex:1" onclick="location.hash='#/messages/${u.id}'">私信</button>` : `<a class="btn sm outline" style="flex:1" href="#/my">编辑名片</a>`}
      </div>
    </div>`;
  },
};

window.Players = Players;
