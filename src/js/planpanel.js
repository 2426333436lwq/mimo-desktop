/* ============================================================
   PlanPanel - 任务规划面板
   - 渲染 AI 生成的任务计划（仅展示，不执行）
   - 支持 确认/拒绝/取消 操作
   ============================================================ */
const PlanPanel = {
  panelEl: null,
  currentPlan: null,
  onConfirm: null,
  onReject: null,
  onCancel: null,

  init() {
    this.panelEl = document.getElementById('planPanel');
  },

  // 渲染任务计划
  // plan 结构：{ title, summary, steps: [{ title, description, status }] }
  render(plan) {
    if (!this.panelEl) return;
    if (!plan || !plan.steps || plan.steps.length === 0) {
      this.clear();
      return;
    }

    this.currentPlan = plan;
    const stepsHtml = plan.steps.map((step, idx) => {
      const status = step.status || 'pending';
      const icon = this.getStatusIcon(status);
      return `
        <div class="plan-step ${status}" data-index="${idx}">
          <div class="plan-step-icon">${icon}</div>
          <div class="plan-step-body">
            <div class="plan-step-title">${this.escapeHtml(step.title || `步骤 ${idx + 1}`)}</div>
            ${step.description ? `<div class="plan-step-desc">${this.escapeHtml(step.description)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    this.panelEl.innerHTML = `
      <div class="plan-panel-inner">
        <div class="plan-header">
          <div class="plan-header-left">
            <span class="plan-header-icon">📋</span>
            <div>
              <div class="plan-title">${this.escapeHtml(plan.title || '任务计划')}</div>
              ${plan.summary ? `<div class="plan-summary">${this.escapeHtml(plan.summary)}</div>` : ''}
            </div>
          </div>
          <div class="plan-actions">
            <button class="btn btn-primary btn-sm plan-confirm-btn">确认执行</button>
            <button class="btn btn-secondary btn-sm plan-reject-btn">拒绝</button>
            <button class="btn btn-secondary btn-sm plan-cancel-btn">关闭</button>
          </div>
        </div>
        <div class="plan-steps">${stepsHtml}</div>
      </div>
    `;

    this.panelEl.classList.remove('hidden');

    const confirmBtn = this.panelEl.querySelector('.plan-confirm-btn');
    const rejectBtn = this.panelEl.querySelector('.plan-reject-btn');
    const cancelBtn = this.panelEl.querySelector('.plan-cancel-btn');

    if (confirmBtn) confirmBtn.addEventListener('click', () => {
      if (this.onConfirm) this.onConfirm(this.currentPlan);
      this.hide();
    });
    if (rejectBtn) rejectBtn.addEventListener('click', () => {
      if (this.onReject) this.onReject(this.currentPlan);
      this.hide();
    });
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      if (this.onCancel) this.onCancel(this.currentPlan);
      this.hide();
    });
  },

  getStatusIcon(status) {
    const map = {
      pending: '○',
      active: '◑',
      done: '●',
      skipped: '◌',
      failed: '✕'
    };
    return map[status] || '○';
  },

  // 更新单个步骤状态
  updateStep(index, status) {
    if (!this.panelEl) return;
    const stepEl = this.panelEl.querySelector(`.plan-step[data-index="${index}"]`);
    if (!stepEl) return;
    stepEl.className = `plan-step ${status}`;
    const iconEl = stepEl.querySelector('.plan-step-icon');
    if (iconEl) iconEl.textContent = this.getStatusIcon(status);
  },

  show() {
    if (this.panelEl) this.panelEl.classList.remove('hidden');
  },

  hide() {
    if (this.panelEl) this.panelEl.classList.add('hidden');
  },

  clear() {
    this.currentPlan = null;
    if (this.panelEl) {
      this.panelEl.innerHTML = '';
      this.panelEl.classList.add('hidden');
    }
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
};

window.PlanPanel = PlanPanel;
