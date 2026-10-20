/* ============================================================
   UI - 骨架屏 & 网络状态管理
   ============================================================ */
const UI = {
  _online: true,
  _listeners: [],

  init() {
    // 监听网络状态
    window.addEventListener('online', () => {
      this._online = true;
      this.hideNetworkBar();
      this._listeners.forEach(fn => fn('online'));
    });

    window.addEventListener('offline', () => {
      this._online = false;
      this.showNetworkBar('offline', '网络已断开，请检查网络连接');
      this._listeners.forEach(fn => fn('offline'));
    });

    // 定期 ping 检测
    setInterval(() => this.checkConnection(), 30000);
  },

  get online() {
    return this._online;
  },

  onNetworkChange(fn) {
    this._listeners.push(fn);
  },

  async checkConnection() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      // 真实网络探测：data: URL 不走网络，无法用于检测在线状态
      await fetch('https://www.gstatic.com/generate_204', {
        signal: controller.signal,
        cache: 'no-store',
        mode: 'no-cors'
      });
      clearTimeout(timeout);
      if (!this._online) {
        this._online = true;
        this.hideNetworkBar();
        this._listeners.forEach(fn => fn('online'));
      }
    } catch {
      if (this._online) {
        this._online = false;
        this.showNetworkBar('offline', '网络连接不稳定，部分功能可能受限');
        this._listeners.forEach(fn => fn('offline'));
      }
    }
  },

  showNetworkBar(type = 'warning', text = '网络连接不稳定') {
    const bar = document.getElementById('networkBar');
    const textEl = document.getElementById('networkBarText');
    const actionBtn = document.getElementById('networkBarAction');
    if (!bar) return;

    bar.classList.remove('offline');
    if (type === 'offline') bar.classList.add('offline');

    if (textEl) textEl.textContent = text;
    if (actionBtn) {
      actionBtn.textContent = type === 'offline' ? '重试' : '知道了';
      actionBtn.onclick = () => {
        if (type === 'offline') {
          this.checkConnection();
        } else {
          this.hideNetworkBar();
        }
      };
    }
    bar.classList.add('show');
  },

  hideNetworkBar() {
    const bar = document.getElementById('networkBar');
    if (bar) bar.classList.remove('show');
  },

  /* ---------- 骨架屏 ---------- */

  // 消息骨架屏（用于 AI 回复加载中）
  renderMessageSkeleton(lines = 4) {
    const el = document.createElement('div');
    el.className = 'skeleton-message';
    el.innerHTML = `
      <div class="skeleton skeleton-avatar"></div>
      <div class="skeleton-body">
        ${Array.from({ length: lines }).map((_, i) => {
          const widths = ['full', 'long', 'medium', 'short'];
          return `<div class="skeleton skeleton-line ${widths[i % widths.length]}"></div>`;
        }).join('')}
      </div>
    `;
    return el;
  },

  // 会话列表骨架屏
  renderTopicSkeleton(count = 5) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'skeleton-topic';
      el.innerHTML = `
        <div class="skeleton skeleton-line long" style="margin-bottom:6px"></div>
        <div class="skeleton skeleton-line short"></div>
      `;
      frag.appendChild(el);
    }
    return frag;
  },

  // 文件内容骨架屏
  renderFileSkeleton(lines = 12) {
    const el = document.createElement('div');
    el.className = 'skeleton-body';
    el.style.padding = '16px';
    const widths = ['full', 'long', 'full', 'medium', 'long', 'short', 'full', 'long', 'medium', 'short', 'full', 'long'];
    el.innerHTML = Array.from({ length: lines }).map((_, i) =>
      `<div class="skeleton skeleton-line ${widths[i % widths.length]}"></div>`
    ).join('');
    return el;
  },

  // 显示骨架屏并自动在 promise 完成后替换
  async showSkeleton(container, skeletonFn, loadPromise) {
    container.innerHTML = '';
    container.appendChild(skeletonFn());
    try {
      await loadPromise;
    } finally {
      // 内容由调用方替换
    }
  }
};

window.UI = UI;
