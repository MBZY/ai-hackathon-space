/* UI 工具：API 封装、转义、toast、modal、头像、时间 */
'use strict';

const UI = {
  me: null, // 当前登录用户缓存

  $(sel, root) { return (root || document).querySelector(sel); },
  $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },

  esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  async api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
      });
    } catch (e) {
      throw { message: '网络连接失败，请检查网络后重试' };
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) {
      const err = (json && json.error) || {};
      if (res.status === 401 && !path.includes('/auth/')) {
        UI.toast(err.message || '请先登录', 'err');
        setTimeout(() => (location.hash = '#/login'), 600);
      }
      const e = new Error(err.message || '请求失败');
      e.details = err.details;
      e.code = err.code;
      e.status = res.status;
      throw e;
    }
    return json ? json.data : null;
  },

  toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    UI.$('#toastWrap').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 400); }, 3200);
  },

  modal(html) {
    const mask = UI.$('#modalMask');
    UI.$('#modalBox').innerHTML = html;
    mask.hidden = false;
    mask.onclick = (e) => { if (e.target === mask) UI.closeModal(); };
    return UI.$('#modalBox');
  },

  closeModal() {
    UI.$('#modalMask').hidden = true;
    UI.$('#modalBox').innerHTML = '';
  },

  confirm(text, { title = '确认操作', okText = '确认', danger = false } = {}) {
    return new Promise((resolve) => {
      UI.modal(`
        <h3>${UI.esc(title)}</h3>
        <p style="font-size:14.5px">${UI.esc(text)}</p>
        <div class="modal-actions">
          <button class="btn outline" id="mCancel">取消</button>
          <button class="btn ${danger ? 'coral' : ''}" id="mOk">${UI.esc(okText)}</button>
        </div>`);
      UI.$('#mCancel').onclick = () => { UI.closeModal(); resolve(false); };
      UI.$('#mOk').onclick = () => { UI.closeModal(); resolve(true); };
    });
  },

  // 姓名首字头像，按 id 稳定取色（深底适配的亮色板，深字）
  avatar(name, id, cls = '') {
    const colors = ['#34E39B', '#8B7BF7', '#FF8A65', '#5FA8FF', '#5CD86A', '#F77BB0', '#6FD3C7', '#E8B44D'];
    const c = colors[(String(id || name || '').split('').reduce((s, ch) => s + ch.charCodeAt(0), 0)) % colors.length];
    const ch = String(name || '?').charAt(0);
    return `<span class="avatar ${cls}" style="background:${c}">${UI.esc(ch)}</span>`;
  },

  fmtTime(iso, { withDate = false } = {}) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (!withDate) return hm;
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  },
  fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  },

  statusTag(status) {
    const map = {
      recruiting: ['招募中', ''],
      full: ['已满员', 'gray'],
      locked: ['已锁定', 'warn'],
      submitted: ['已提交', ''],
      draft: ['筹备中', 'gray'],
      developing: ['开发中', ''],
    };
    const [text, cls] = map[status] || [status, 'gray'];
    return `<span class="tag ${cls}">${UI.esc(text)}</span>`;
  },

  chips(skills) {
    return (skills || []).map((s) => `<span class="tag">${UI.esc(s)}</span>`).join('');
  },

  contactRow(contact, { label = '联系方式' } = {}) {
    if (!UI.me) return `<div class="contact-row"><span class="lock-hint">登录后可见${UI.esc(label)}</span></div>`;
    return `<div class="contact-row"><span class="ck">${UI.esc(label)}：</span><b>${UI.esc(contact || '未填写')}</b></div>`;
  },

  // 分页选择器等简单渲染帮助
  renderTags(list) { return list.map((x) => `<span class="tag gray">${UI.esc(x)}</span>`).join(''); },

  // ---------- 图片工具 ----------
  // 客户端压缩：等比缩放到最长边 maxSide，转 JPEG 并压到 maxBytes 以内，返回 dataURL
  compressImage(file, { maxSide = 1600, quality = 0.82, maxBytes = 300 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // PNG 透明区填白
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let q = quality;
        let dataUrl = canvas.toDataURL('image/jpeg', q);
        while (dataUrl.length * 0.75 > maxBytes && q > 0.4) {
          q -= 0.12;
          dataUrl = canvas.toDataURL('image/jpeg', q);
        }
        if (dataUrl.length * 0.75 > maxBytes * 1.35) return reject(new Error('图片过大，请换一张更小的图'));
        resolve(dataUrl);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  },

  lightbox(src) {
    const el = document.createElement('div');
    el.className = 'lightbox';
    const im = document.createElement('img');
    im.src = src;
    el.appendChild(im);
    el.onclick = () => el.remove();
    document.body.appendChild(el);
  },
};

// 全局：点击任意 .zoomable 图片放大（减少各处绑定）
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.classList.contains('zoomable')) UI.lightbox(t.src);
});

window.UI = UI;
