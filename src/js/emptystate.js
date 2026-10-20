/* ============================================================
   EmptyState - 全局统一空状态组件
   ============================================================ */
const EmptyState = {
  icons: {
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    skills: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    diff: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/>',
    preview: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    generic: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
  },

  render(options) {
    const {
      icon = 'generic',
      title = '暂无内容',
      desc = '这里还没有任何内容',
      actionText = '',
      onAction = null,
      variant = ''
    } = options;

    const iconPath = this.icons[icon] || this.icons.generic;
    const variantClass = variant ? ` variant-${variant}` : '';
    const actionHtml = actionText
      ? `<button class="empty-state-action">${actionText}</button>`
      : '';

    const container = document.createElement('div');
    container.className = `empty-state${variantClass}`;
    container.innerHTML = `
      <div class="empty-state-icon">
        <svg viewBox="0 0 24 24">${iconPath}</svg>
      </div>
      <div class="empty-state-title">${title}</div>
      <div class="empty-state-desc">${desc}</div>
      ${actionHtml}
    `;

    if (onAction && actionText) {
      const btn = container.querySelector('.empty-state-action');
      if (btn) btn.addEventListener('click', onAction);
    }

    return container;
  },

  // 预设空状态
  chat() {
    return this.render({
      icon: 'chat',
      title: '开启新对话',
      desc: '选择一个模型开始与 AI 交流，或从最近的会话中继续。',
      actionText: '新建会话',
      onAction: () => {
        if (window.App) App.newTopic();
      },
      variant: 'chat'
    });
  },

  file() {
    return this.render({
      icon: 'file',
      title: '空目录',
      desc: '当前工作目录没有文件，选择其他目录或新建项目。',
      actionText: '选择目录',
      onAction: () => {
        if (window.FileSystem) FileSystem.selectDirectory();
      },
      variant: 'file'
    });
  },

  noSearchResult() {
    return this.render({
      icon: 'search',
      title: '未找到相关会话',
      desc: '没有匹配关键词的会话，尝试其他搜索词。',
      variant: 'search'
    });
  },

  noSkills() {
    return this.render({
      icon: 'skills',
      title: '技能库为空',
      desc: '没有已安装的技能，从技能市场添加或导入自定义技能。'
    });
  },

  noTerminal() {
    return this.render({
      icon: 'terminal',
      title: '终端尚未启动',
      desc: '在输入框输入命令并回车执行，或点击发送按钮开始。'
    });
  },

  noPreview() {
    return this.render({
      icon: 'preview',
      title: '选择文件预览',
      desc: '从左侧文件树点击文件，在右侧查看其内容。'
    });
  },

  noDiff() {
    return this.render({
      icon: 'diff',
      title: '暂无代码对比',
      desc: '当 AI 生成代码修改时，可在此查看差异并决定是否应用。'
    });
  }
};

window.EmptyState = EmptyState;
