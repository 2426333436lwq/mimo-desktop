/* ============================================================
   StatusBar - 底部状态栏
   - 模型 / 沙箱 / 任务 / Token / 网络
   ============================================================ */
const StatusBar = {
  modelEl: null,
  sandboxEl: null,
  taskEl: null,
  tokenEl: null,
  networkEl: null,

  init() {
    this.modelEl = document.getElementById('statusModelValue');
    this.sandboxEl = document.getElementById('statusSandboxValue');
    this.taskEl = document.getElementById('statusTaskValue');
    this.tokenEl = document.getElementById('statusTokenValue');
    this.networkEl = document.getElementById('statusNetworkValue');

    // 网络状态监听
    window.addEventListener('online', () => this.setOnline(true));
    window.addEventListener('offline', () => this.setOnline(false));
    this.setOnline(navigator.onLine);
  },

  setModel(model) {
    if (this.modelEl) this.modelEl.textContent = model || '-';
  },

  setSandbox(status) {
    if (!this.sandboxEl) return;
    const map = {
      safe: { text: '安全', cls: 'ok' },
      warning: { text: '受限', cls: 'warning' },
      danger: { text: '危险', cls: 'error' },
      idle: { text: '未启用', cls: '' }
    };
    const item = map[status] || { text: status || '-', cls: '' };
    this.sandboxEl.textContent = item.text;
    const parent = this.sandboxEl.closest('.status-item');
    if (parent) parent.className = `status-item ${item.cls}`;
  },

  setTask(status) {
    if (!this.taskEl) return;
    const map = {
      idle: { text: '空闲', cls: '' },
      running: { text: '运行中...', cls: 'ok' },
      thinking: { text: '思考中...', cls: 'ok' },
      error: { text: '出错', cls: 'error' },
      done: { text: '已完成', cls: 'ok' }
    };
    const item = map[status] || { text: status || '空闲', cls: '' };
    this.taskEl.textContent = item.text;
    const parent = this.taskEl.closest('.status-item');
    if (parent) parent.className = `status-item ${item.cls}`;
  },

  setToken(count) {
    if (this.tokenEl) {
      const n = parseInt(count, 10) || 0;
      this.tokenEl.textContent = n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    }
  },

  setNetwork(online) {
    this.setOnline(online);
  },

  setOnline(online) {
    if (!this.networkEl) return;
    this.networkEl.textContent = online ? '在线' : '离线';
    const parent = this.networkEl.closest('.status-item');
    if (parent) parent.className = `status-item clickable ${online ? 'ok' : 'error'}`;
  },

  // 生成任务中（用于 Chat 流式响应）
  setBusy() {
    this.setTask('running');
  },

  setIdle() {
    this.setTask('idle');
  }
};

window.StatusBar = StatusBar;
