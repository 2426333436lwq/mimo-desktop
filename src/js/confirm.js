/* ============================================================
   Confirm - 分级确认弹窗
   - warning: 黄色警告（普通操作确认）
   - danger: 红色高危（带 3 秒倒计时双确认）
   ============================================================ */
const Confirm = {
  callbacks: [],

  init() {
    const modal = document.getElementById('confirmModal');
    if (!modal) return;

    const cancelBtn = document.getElementById('confirmCancelBtn');
    const okBtn = document.getElementById('confirmOkBtn');
    const mask = modal.querySelector('.confirm-mask');

    if (cancelBtn) cancelBtn.addEventListener('click', () => this.cancel());
    if (okBtn) okBtn.addEventListener('click', () => this.confirm());
    if (mask) mask.addEventListener('click', () => this.cancel());

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        this.cancel();
      }
    });
  },

  show(options) {
    const {
      title = '确认操作',
      message = '确定要执行此操作吗？',
      extra = '',
      level = 'warning',    // 'warning' | 'danger'
      confirmText = '确定',
      cancelText = '取消',
      onConfirm,
      onCancel
    } = options;

    const modal = document.getElementById('confirmModal');
    const dialog = document.getElementById('confirmDialog');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const extraEl = document.getElementById('confirmExtra');
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');

    titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    if (extra) {
      extraEl.textContent = extra;
      extraEl.style.display = 'block';
    } else {
      extraEl.style.display = 'none';
    }

    // 级别样式
    dialog.classList.remove('danger');
    if (level === 'danger') dialog.classList.add('danger');

    // 高危级别：3 秒倒计时
    if (level === 'danger') {
      okBtn.disabled = true;
      okBtn.textContent = `${confirmText} (3)`;
      let countdown = 3;
      const timer = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
          clearInterval(timer);
          okBtn.disabled = false;
          okBtn.textContent = confirmText;
        } else {
          okBtn.textContent = `${confirmText} (${countdown})`;
        }
      }, 1000);
      this._countdownTimer = timer;
    } else {
      okBtn.disabled = false;
    }

    // 注册回调
    this.callbacks = [onConfirm, onCancel];

    modal.classList.remove('hidden');
  },

  confirm() {
    const [onConfirm] = this.callbacks;
    this.hide();
    if (typeof onConfirm === 'function') onConfirm();
  },

  cancel() {
    const [, onCancel] = this.callbacks;
    this.hide();
    if (typeof onCancel === 'function') onCancel();
  },

  hide() {
    const modal = document.getElementById('confirmModal');
    if (modal) modal.classList.add('hidden');
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
    this.callbacks = [];
  }
};

window.Confirm = Confirm;
