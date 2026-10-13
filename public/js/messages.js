/* 私信中心：会话列表 + 聊天窗（轮询） */
'use strict';

const Messages = {
  pollTimer: null,

  stopPoll() {
    if (Messages.pollTimer) { clearInterval(Messages.pollTimer); Messages.pollTimer = null; }
  },

  // 会话列表
  async listPage(view) {
    if (!UI.me) { location.hash = '#/login'; return; }
    Messages.stopPoll();
    view.innerHTML = '<div class="loading">加载中…</div>';
    let data;
    try { data = await UI.api('/api/messages/conversations'); }
    catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }
    const render = (list) => {
      view.innerHTML = `
      <div class="page-head"><h1>私信</h1><p class="sub">与队友、候选队友的 1v1 会话</p></div>
      <div class="card conv-list-wrap">
        ${list.length === 0 ? `<div class="empty" style="padding:36px"><div class="big">💬</div>还没有会话。去 <a href="#/players">名片广场</a> 或 <a href="#/teams">队伍广场</a> 主动打个招呼吧</div>` : list.map((c) => `
        <div class="conv-item" onclick="location.hash='#/messages/${c.peer_id}'">
          ${UI.avatar(c.peer_name, c.peer_id)}
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;gap:8px">
              <span class="c-name">${UI.esc(c.peer_name)}</span>
              <span style="font-size:11.5px;color:var(--ink-3)">${UI.fmtTime(c.last_at, { withDate: true })}</span>
            </div>
            <div style="display:flex;justify-content:space-between;gap:8px">
              <span class="c-last">${UI.esc(c.last_content)}</span>
              ${c.unread ? `<span class="badge-dot" style="position:static">${c.unread}</span>` : ''}
            </div>
          </div>
        </div>`).join('')}
      </div>`;
    };
    render(data.list);

    Messages.pollTimer = setInterval(async () => {
      try {
        const fresh = await UI.api('/api/messages/conversations');
        render(fresh.list);
        App.refreshNav();
      } catch (e) { /* 静默 */ }
    }, 30000);
  },

  // 聊天窗
  async chatPage(view, peerId) {
    if (!UI.me) { location.hash = '#/login'; return; }
    Messages.stopPoll();
    view.innerHTML = '<div class="loading">加载中…</div>';
    let payload;
    try { payload = await UI.api(`/api/messages/${peerId}`); }
    catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }

    const peer = payload.peer;
    view.innerHTML = `
    <div class="page-head" style="display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;align-items:center;gap:10px">
        <a href="#/messages" style="font-size:20px;color:var(--ink-3)">←</a>
        ${UI.avatar(peer.name, peer.id)}
        <div><h1 style="font-size:20px">${UI.esc(peer.name)}</h1>
        <p class="sub">${UI.esc(peer.major || '')}${peer.contact ? ' · ' + UI.esc(peer.contact) : ''}</p></div>
      </div>
    </div>
    <div class="card msg-layout" style="padding:0;overflow:hidden">
      <div class="chat-box" style="grid-column:1/-1">
        <div class="chat-scroll" id="chatScroll"></div>
        <div class="chat-input">
          <textarea id="chatText" maxlength="500" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
          <button class="btn" id="chatSend">发送</button>
        </div>
      </div>
    </div>`;

    const renderMsgs = (msgs, scroll) => {
      UI.$('#chatScroll').innerHTML = msgs.map((m) => `
        <div class="bubble ${m.from_id === UI.me.id ? 'mine' : 'theirs'}">
          ${UI.esc(m.content)}
          <div class="bubble-time">${UI.fmtTime(m.created_at, { withDate: true })}</div>
        </div>`).join('');
      if (scroll !== false) {
        const box = UI.$('#chatScroll');
        box.scrollTop = box.scrollHeight;
      }
    };
    renderMsgs(payload.messages);

    const send = async () => {
      const text = UI.$('#chatText').value.trim();
      if (!text) return;
      UI.$('#chatText').value = '';
      try {
        const msg = await UI.api('/api/messages', { method: 'POST', body: { to_id: peerId, content: text } });
        payload.messages.push(msg);
        renderMsgs(payload.messages);
      } catch (e) { UI.toast(e.message, 'err'); }
    };
    UI.$('#chatSend').onclick = send;
    UI.$('#chatText').onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };

    Messages.pollTimer = setInterval(async () => {
      try {
        const fresh = await UI.api(`/api/messages/${peerId}`);
        if (fresh.messages.length !== payload.messages.length) {
          payload = fresh;
          renderMsgs(fresh.messages);
        }
      } catch (e) { /* 静默 */ }
    }, 8000);
  },

  // 通知页
  async notificationsPage(view) {
    if (!UI.me) { location.hash = '#/login'; return; }
    let data;
    try { data = await UI.api('/api/notifications'); }
    catch (e) { view.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; return; }

    view.innerHTML = `
    <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end">
      <div><h1>通知中心</h1><p class="sub">申请、邀请、队伍动态与公告</p></div>
      ${data.unread ? '<button class="btn outline sm" id="readAll">全部已读</button>' : ''}
    </div>
    <div class="card">
      ${data.list.length === 0 ? '<div class="empty" style="padding:36px">暂无通知</div>' : data.list.map((n) => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}" style="cursor:${n.link ? 'pointer' : 'default'}" ${n.link ? `onclick="location.hash='${n.link.replace(/^#/, '')}'"` : ''}>
        <div style="flex:1">
          <div class="n-title">${UI.esc(n.title)}</div>
          ${n.content ? `<div class="n-content">${UI.esc(n.content)}</div>` : ''}
          <div class="n-time">${UI.fmtTime(n.created_at, { withDate: true })}</div>
        </div>
      </div>`).join('')}
    </div>`;
    if (UI.$('#readAll')) {
      UI.$('#readAll').onclick = async () => {
        await UI.api('/api/notifications/read-all', { method: 'POST' });
        App.refreshNav();
        Messages.notificationsPage(view);
      };
    }
  },
};

window.Messages = Messages;
