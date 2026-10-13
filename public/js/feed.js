/* 队伍动态：全站进度瀑布流（含配图） */
'use strict';

const Feed = {
  async page(view) {
    view.innerHTML = '<div class="loading">加载中…</div>';
    let list;
    try { list = await UI.api('/api/progress/recent?limit=120'); } catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }

    view.innerHTML = `
    <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px">
      <div>
        <h1>队伍动态</h1>
        <p class="sub">各队伍实时进度瀑布流 · 共 ${list.length} 条${UI.me ? '（点击配图可放大）' : ' · 登录后可查看队伍联系方式'}</p>
      </div>
      ${UI.me && UI.me.team_id ? `<a class="btn sm outline" href="#/team/${UI.me.team_id}">发布我的进度</a>` : ''}
    </div>
    ${list.length === 0 ? `
      <div class="empty" style="padding-top:60px">
        <div class="big">🛠️</div>
        <p style="font-size:15px">还没有队伍发布进度</p>
        <p style="font-size:13.5px;margin-top:6px">加入一支队伍后，在队伍页发布第一条进度（还能配图）</p>
        <div style="margin-top:20px"><a class="btn" href="#/teams">浏览队伍广场</a></div>
      </div>` : `
    <div class="feed-cols">
      ${list.map((p) => `
      <div class="feed-card">
        ${p.images && p.images.length ? `<img class="feed-img zoomable" src="${UI.esc(p.images[0])}" loading="lazy" alt="${UI.esc(p.team_name)} 进度配图">` : ''}
        <div class="feed-body">
          <div class="feed-head">
            <a class="feed-team" href="#/team/${p.team_id}">${UI.esc(p.team_name)}</a>
            <span class="tag" style="margin:0">${UI.esc(p.stage)}</span>
            <span class="feed-time">${UI.fmtTime(p.created_at, { withDate: true })}</span>
          </div>
          ${p.content ? `<div class="feed-text">${UI.esc(p.content)}</div>` : ''}
          ${p.images && p.images.length > 1 ? `<div class="progress-imgs" style="margin-top:10px">${p.images.slice(1).map((src) => `<img src="${UI.esc(src)}" class="zoomable" loading="lazy" alt="进度配图">`).join('')}</div>` : ''}
          <div class="feed-actions" style="margin-top:10px">
            <span style="font-size:12px;color:var(--ink-3)">${UI.esc(p.author_name)} 发布</span>
            <a href="#/team/${p.team_id}" style="font-size:12px;margin-left:auto">进入队伍 →</a>
          </div>
        </div>
      </div>`).join('')}
    </div>`}`;
  },
};

window.Feed = Feed;
