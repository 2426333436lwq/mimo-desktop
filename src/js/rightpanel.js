/* ============================================================
   RightPanel - 右侧面板
   - Tab 切换：预览 / 对比 / 终端 / 日志
   - 文件预览（语法高亮只读）
   - Diff 对比视图
   - 任务执行日志
   ============================================================ */
const RightPanel = {
  currentTab: 'preview',
  diffData: null, // { oldCode, newCode, fileName }
  openFiles: [], // [{ path, name, content, status }]
  activeFile: null, // 当前激活的文件路径

  init() {
    // 初始化 Tab 内容显示状态
    document.querySelectorAll('.rp-tab-content').forEach(content => {
      if (content.classList.contains('active')) {
        content.style.display = ''; // 激活状态的显示
      } else {
        content.style.display = 'none'; // 非激活状态的隐藏
      }
    });

    // Tab 切换
    document.querySelectorAll('.rp-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        // 点击关闭按钮时不触发 tab 切换
        if (e.target.closest('.rp-tab-close')) return;
        this.showTab(btn.dataset.rpTab);
      });
    });

    // 终端 Tab 关闭按钮
    document.querySelectorAll('.rp-tab-close').forEach(closeBtn => {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabName = closeBtn.dataset.closeTab;
        if (tabName === 'terminal') {
          this.closeTerminal();
        }
      });
    });

    // 重新打开终端按钮
    const reopenBtn = document.getElementById('reopenTerminalBtn');
    if (reopenBtn) {
      reopenBtn.addEventListener('click', () => this.openTerminal());
    }

    // 关闭全部按钮
    const closeAllBtn = document.getElementById('rpCloseAllBtn');
    if (closeAllBtn) closeAllBtn.addEventListener('click', () => this.closeAllFiles());

    // 关闭按钮
    const closeBtn = document.getElementById('closeRightPanelBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.collapse());
    }

    // Diff 操作按钮
    const diffApplyBtn = document.getElementById('diffApplyBtn');
    if (diffApplyBtn) diffApplyBtn.addEventListener('click', () => this.applyDiff());
    const diffRevertBtn = document.getElementById('diffRevertBtn');
    if (diffRevertBtn) diffRevertBtn.addEventListener('click', () => this.revertDiff());
    const diffSaveBtn = document.getElementById('diffSaveBtn');
    if (diffSaveBtn) diffSaveBtn.addEventListener('click', () => this.saveDiff());

    // 日志清空
    const logsClearBtn = document.getElementById('logsClearBtn');
    if (logsClearBtn) logsClearBtn.addEventListener('click', () => this.clearLogs());

    // 初始化空状态
    this.renderEmptyPreview();
    this.renderEmptyLogs();

    // 初始化终端
    this.initTerminal();
    
    console.log('[RightPanel] 初始化完成');
  },

  // 关闭终端 Tab
  closeTerminal() {
    console.log('[RightPanel] 关闭终端');
    
    // 隐藏终端 Tab 按钮
    const terminalTab = document.querySelector('.rp-tab-btn[data-rp-tab="terminal"]');
    if (terminalTab) {
      terminalTab.classList.add('hidden-tab');
      terminalTab.style.display = 'none'; // 直接设置 display 确保隐藏
    }
    
    // 隐藏终端内容
    const terminalContent = document.getElementById('rpTerminal');
    if (terminalContent) {
      terminalContent.classList.remove('active');
      terminalContent.style.display = 'none'; // 直接设置 display 确保隐藏
    }
    
    // 显示重新打开按钮
    const reopenBtn = document.getElementById('reopenTerminalBtn');
    if (reopenBtn) {
      reopenBtn.style.display = 'inline-flex';
    }
    
    // 如果当前在终端 tab，切换到预览
    if (this.currentTab === 'terminal') {
      this.showTab('preview');
    }
    
    console.log('[RightPanel] 终端已关闭');
  },

  // 打开终端 Tab
  openTerminal() {
    console.log('[RightPanel] 打开终端');
    
    // 显示终端 Tab 按钮
    const terminalTab = document.querySelector('.rp-tab-btn[data-rp-tab="terminal"]');
    if (terminalTab) {
      terminalTab.classList.remove('hidden-tab');
      terminalTab.style.display = ''; // 恢复默认显示
    }
    
    // 显示终端内容
    const terminalContent = document.getElementById('rpTerminal');
    if (terminalContent) {
      terminalContent.style.display = ''; // 恢复默认显示
    }
    
    // 隐藏重新打开按钮
    const reopenBtn = document.getElementById('reopenTerminalBtn');
    if (reopenBtn) {
      reopenBtn.style.display = 'none';
    }
    
    // 切换到终端
    this.showTab('terminal');
    
    console.log('[RightPanel] 终端已打开');
  },

  showTab(tab) {
    // 如果终端已关闭，不允许切换到终端
    if (tab === 'terminal') {
      const terminalTab = document.querySelector('.rp-tab-btn[data-rp-tab="terminal"]');
      if (!terminalTab || terminalTab.classList.contains('hidden-tab')) {
        console.log('[RightPanel] 终端已关闭，无法切换');
        return;
      }
    }
    
    this.currentTab = tab;
    
    // 更新 Tab 按钮状态
    document.querySelectorAll('.rp-tab-btn').forEach(btn => {
      // 跳过已关闭的 Tab
      if (btn.classList.contains('hidden-tab')) return;
      btn.classList.toggle('active', btn.dataset.rpTab === tab);
    });
    
    // 隐藏所有内容
    document.querySelectorAll('.rp-tab-content').forEach(content => {
      content.classList.remove('active');
      // 只隐藏非终端内容，终端内容的显示由 openTerminal 控制
      if (content.id !== 'rpTerminal') {
        content.style.display = 'none';
      }
    });
    
    const tabMap = {
      preview: 'rpPreview',
      diff: 'rpDiff',
      terminal: 'rpTerminal',
      logs: 'rpLogs'
    };
    const el = document.getElementById(tabMap[tab]);
    if (el) {
      el.classList.add('active');
      el.style.display = ''; // 恢复默认显示
    }
  },

  collapse() {
    const panel = document.getElementById('rightPanel');
    if (panel) panel.classList.add('collapsed');
  },

  expand() {
    const panel = document.getElementById('rightPanel');
    if (panel) panel.classList.remove('collapsed');
  },

  toggle() {
    const panel = document.getElementById('rightPanel');
    if (panel) panel.classList.toggle('collapsed');
  },

  /* ---------- 文件预览 ---------- */
  previewFile(filePath, content) {
    console.log('[RightPanel.previewFile] 收到预览请求:', filePath, '内容长度:', content?.length);
    this.showTab('preview');
    this.expand();
    const name = filePath.split(/[\\/]/).pop();
    const ext = name.split('.').pop().toLowerCase();
    const existingIndex = this.openFiles.findIndex(f => f.path === filePath);
    console.log('[RightPanel.previewFile] 文件名:', name, '扩展名:', ext, '已存在?', existingIndex >= 0);

    if (existingIndex >= 0) {
      // 已打开，更新内容
      this.openFiles[existingIndex].content = content;
      this.openFiles[existingIndex].status = 'saved';
      // 如果是 HTML 文件但之前没设置过 viewMode，默认渲染模式
      if (!this.openFiles[existingIndex].viewMode && this._isRenderable(ext)) {
        this.openFiles[existingIndex].viewMode = 'render';
      }
    } else {
      this.openFiles.push({
        path: filePath,
        name,
        content: content || '',
        status: 'saved',
        viewMode: this._isRenderable(ext) ? 'render' : 'code'
      });
    }

    this.activeFile = filePath;
    this.renderFileTabs();
    this.renderActiveFile();
  },

  // 是否支持实时渲染预览
  _isRenderable(ext) {
    return ['html', 'htm', 'svg', 'md', 'markdown'].includes(ext);
  },

  // 切换当前文件的视图模式（render / code）
  toggleViewMode(mode) {
    const file = this.openFiles.find(f => f.path === this.activeFile);
    if (!file) return;
    file.viewMode = mode;
    this.renderActiveFile();
  },

  renderFileTabs() {
    const scroll = document.getElementById('rpFileTabsScroll');
    const closeAllBtn = document.getElementById('rpCloseAllBtn');
    if (!scroll) return;

    if (this.openFiles.length === 0) {
      scroll.innerHTML = '';
      if (closeAllBtn) closeAllBtn.style.display = 'none';
      return;
    }

    if (closeAllBtn) closeAllBtn.style.display = 'flex';

    scroll.innerHTML = this.openFiles.map(f => {
      const statusDot = f.status ? `<span class="rp-file-tab-status ${f.status}"></span>` : '';
      const active = f.path === this.activeFile ? ' active' : '';
      return `
        <div class="rp-file-tab${active}" data-path="${this.escapeAttr(f.path)}">
          ${statusDot}
          <span class="rp-file-tab-name">${this.escapeHtml(f.name)}</span>
          <span class="rp-file-tab-close" data-close="${this.escapeAttr(f.path)}">✕</span>
        </div>
      `;
    }).join('');

    // 绑定 tab 切换
    scroll.querySelectorAll('.rp-file-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if (e.target.dataset.close) {
          e.stopPropagation();
          this.closeFile(e.target.dataset.close);
          return;
        }
        this.activeFile = tab.dataset.path;
        this.renderFileTabs();
        this.renderActiveFile();
      });
    });
  },

  renderActiveFile() {
    const contentEl = document.querySelector('#rpPreview .rp-content');
    if (!contentEl) return;

    const file = this.openFiles.find(f => f.path === this.activeFile);
    if (!file) {
      contentEl.innerHTML = '';
      contentEl.appendChild(EmptyState.noPreview());
      return;
    }

    if (!file.content) {
      contentEl.innerHTML = '';
      contentEl.appendChild(EmptyState.render({
        icon: 'preview',
        title: '无法读取文件',
        desc: '该文件可能为空或已被删除。'
      }));
      return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    const viewMode = file.viewMode || 'code';
    const isRenderable = this._isRenderable(ext);
    const switcher = isRenderable ? this._renderViewSwitcher(viewMode) : '';

    if (viewMode === 'render' && isRenderable) {
      // 实时渲染视图
      contentEl.innerHTML = `
        <div class="preview-header">
          <span class="preview-filename">${this.escapeHtml(file.name)}</span>
          <span class="preview-meta">${this.formatSize(file.content.length)} · ${ext}</span>
          ${switcher}
        </div>
        <div class="preview-render-frame">
          ${this._renderContent(file.content, ext)}
        </div>
      `;
    } else {
      // 代码视图
      const highlighted = this.highlightSyntax(file.content, ext);
      contentEl.innerHTML = `
        <div class="preview-header">
          <span class="preview-filename">${this.escapeHtml(file.name)}</span>
          <span class="preview-meta">${this.formatSize(file.content.length)} · ${ext}</span>
          ${switcher}
        </div>
        <pre>${highlighted}</pre>
      `;
    }

    // 绑定视图切换按钮
    contentEl.querySelectorAll('.pv-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.pv;
        if (mode) this.toggleViewMode(mode);
      });
    });
  },

  _renderViewSwitcher(mode) {
    return `
      <div class="preview-view-switcher" role="tablist">
        <button class="pv-btn ${mode === 'render' ? 'active' : ''}" data-pv="render" title="渲染预览">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span>预览</span>
        </button>
        <button class="pv-btn ${mode === 'code' ? 'active' : ''}" data-pv="code" title="源代码">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <polyline points="16 18 22 12 16 6"/>
            <polyline points="8 6 2 12 8 18"/>
          </svg>
          <span>代码</span>
        </button>
      </div>
    `;
  },

  _renderContent(content, ext) {
    if (ext === 'html' || ext === 'htm') {
      // HTML 用 Blob + iframe sandbox 渲染，确保样式独立
      // 注意：不能加 allow-same-origin（blob 继承父页 origin，会允许沙箱内脚本访问 window.api，导致任意命令执行）
      const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      return `<iframe class="preview-iframe" sandbox="allow-scripts allow-forms allow-modals" src="${url}" onload="setTimeout(()=>URL.revokeObjectURL('${url}'),2000)"></iframe>`;
    }
    if (ext === 'svg') {
      return `<div class="preview-svg-wrap">${content}</div>`;
    }
    if (ext === 'md' || ext === 'markdown') {
      // 简易 Markdown 渲染
      return `<div class="preview-md">${this.escapeHtml(content)}</div>`;
    }
    return `<div class="preview-unsupported">不支持的预览类型</div>`;
  },

  closeFile(filePath) {
    const idx = this.openFiles.findIndex(f => f.path === filePath);
    if (idx === -1) return;
    this.openFiles.splice(idx, 1);

    if (this.activeFile === filePath) {
      // 激活相邻文件
      const next = this.openFiles[idx] || this.openFiles[idx - 1];
      this.activeFile = next ? next.path : null;
    }

    if (!this.activeFile && this.openFiles.length === 0) {
      // 全部关闭后显示空态
    }

    this.renderFileTabs();
    this.renderActiveFile();
  },

  closeAllFiles() {
    this.openFiles = [];
    this.activeFile = null;
    this.renderFileTabs();
    this.renderActiveFile();
  },

  renderEmptyPreview() {
    // 不再使用，由 renderActiveFile 处理
  },

  // 简易语法高亮
  highlightSyntax(code, lang) {
    const escaped = this.escapeHtml(code);
    const keywords = {
      js: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'new', 'import', 'export', 'default', 'async', 'await', 'try', 'catch', 'throw', 'typeof', 'instanceof'],
      ts: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'new', 'import', 'export', 'default', 'async', 'await', 'try', 'catch', 'throw', 'typeof', 'interface', 'type', 'enum', 'public', 'private', 'protected', 'readonly'],
      py: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'as', 'try', 'except', 'finally', 'with', 'async', 'await', 'lambda', 'yield', 'global', 'nonlocal', 'pass', 'break', 'continue'],
      html: [],
      css: []
    };
    const kwList = keywords[lang] || keywords.js;

    let html = escaped;

    // 注释和字符串先处理（避免被关键字替换）
    if (lang === 'py') {
      html = html.replace(/(#[^\n]*)/g, '<span class="tok-comment">$1</span>');
    } else {
      html = html.replace(/(\/\/[^\n]*)/g, '<span class="tok-comment">$1</span>');
      html = html.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="tok-comment">$1</span>');
    }
    html = html.replace(/(&quot;[^&]*?&quot;)/g, '<span class="tok-string">$1</span>');
    html = html.replace(/(&#39;[^&]*?&#39;)/g, '<span class="tok-string">$1</span>');
    html = html.replace(/(`[^`]*?`)/g, '<span class="tok-string">$1</span>');

    // 数字
    html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="tok-number">$1</span>');

    // 关键字
    const kwRegex = new RegExp(`\\b(${kwList.join('|')})\\b`, 'g');
    html = html.replace(kwRegex, '<span class="tok-keyword">$1</span>');

    // 函数调用
    html = html.replace(/\b([a-zA-Z_$][\w$]*)\s*\(/g, '<span class="tok-function">$1</span>(');

    return html;
  },

  /* ---------- Diff 对比 ---------- */
  showDiff(oldCode, newCode, fileName) {
    this.showTab('diff');
    this.diffData = { oldCode, newCode, fileName };

    const diffView = document.getElementById('diffView');
    if (!diffView) return;

    const oldLines = (oldCode || '').split('\n');
    const newLines = (newCode || '').split('\n');

    // 标记变更行（简易逐行对比）
    const maxLines = Math.max(oldLines.length, newLines.length);
    const changeLines = []; // 记录变更行索引供跳转

    let addCount = 0;
    let delCount = 0;

    let oldHtml = '';
    let newHtml = '';

    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === newLine) {
        oldHtml += this.renderDiffLine(i + 1, oldLine, 'ctx');
        newHtml += this.renderDiffLine(i + 1, newLine, 'ctx');
      } else {
        if (oldLine !== undefined) {
          delCount++;
          changeLines.push(i);
          oldHtml += this.renderDiffLine(i + 1, oldLine, 'del');
          newHtml += this.renderDiffLine(i + 1, '', 'del');
        } else {
          oldHtml += this.renderDiffLine(i + 1, '', 'del-empty');
        }
        if (newLine !== undefined) {
          addCount++;
          if (oldLine === undefined) changeLines.push(i); // 新增行也记一次
          newHtml += this.renderDiffLine(i + 1, newLine, 'add');
          if (oldLine === undefined) {
            // 已在上方记录
          } else {
            oldHtml += this.renderDiffLine(i + 1, '', 'add-empty');
          }
        }
      }
    }

    diffView.innerHTML = `
      <div class="diff-toolbar">
        <div class="diff-nav">
          <button class="diff-nav-btn" id="diffPrevBtn" title="上一处变更">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="18 15 12 9 6 15"/>
            </svg>
          </button>
          <span class="diff-nav-counter"><span id="diffCurrentChange">0</span>/<span id="diffTotalChange">${changeLines.length}</span></span>
          <button class="diff-nav-btn" id="diffNextBtn" title="下一处变更">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        </div>
        <span class="diff-file-path">${this.escapeHtml(fileName || '未命名')}</span>
        <span class="diff-file-stats">
          <span class="stat-add">+${addCount}</span>
          <span class="stat-del">-${delCount}</span>
        </span>
      </div>
      <div class="diff-container">
        <div class="diff-pane diff-pane-old">
          <div class="diff-pane-header">原始</div>
          <div class="diff-pane-body" id="diffOldPane">${oldHtml}</div>
        </div>
        <div class="diff-pane diff-pane-new">
          <div class="diff-pane-header">修改</div>
          <div class="diff-pane-body" id="diffNewPane">${newHtml}</div>
        </div>
      </div>
    `;

    // 同步滚动
    const oldPane = document.getElementById('diffOldPane');
    const newPane = document.getElementById('diffNewPane');
    if (oldPane && newPane) {
      let syncing = false;
      oldPane.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true;
        newPane.scrollTop = oldPane.scrollTop;
        syncing = false;
      });
      newPane.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true;
        oldPane.scrollTop = newPane.scrollTop;
        syncing = false;
      });
    }

    // 变更跳转
    let currentChangeIdx = -1;
    const total = changeLines.length;
    const counterEl = document.getElementById('diffCurrentChange');

    const jumpToChange = (direction) => {
      if (total === 0) return;
      currentChangeIdx = direction > 0
        ? (currentChangeIdx + 1) % total
        : (currentChangeIdx - 1 + total) % total;
      const targetLine = changeLines[currentChangeIdx];
      const oldPaneEl = document.getElementById('diffOldPane');
      if (oldPaneEl) {
        const target = oldPaneEl.querySelectorAll('.diff-line')[targetLine];
        if (target) {
          target.scrollIntoView({ block: 'center', behavior: 'smooth' });
          // 高亮闪烁
          target.classList.add('change-flash');
          setTimeout(() => target.classList.remove('change-flash'), 600);
        }
      }
      if (counterEl) counterEl.textContent = currentChangeIdx + 1;
    };

    const prevBtn = document.getElementById('diffPrevBtn');
    const nextBtn = document.getElementById('diffNextBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => jumpToChange(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => jumpToChange(1));

    // 存储变更跳转方法
    this._diffJumpToChange = jumpToChange;
  },

  renderDiffLine(lineNum, content, type) {
    const escaped = this.escapeHtml(content || '');
    return `<div class="diff-line ${type}"><span class="gutter">${lineNum}</span><span class="content">${escaped}</span></div>`;
  },

  applyDiff() {
    if (!this.diffData) return;
    if (window.App && App.showToast) App.showToast('差异已应用到本地视图', 'info');
  },

  revertDiff() {
    if (!this.diffData) return;
    if (window.App && App.showToast) App.showToast('已撤销差异应用', 'info');
  },

  async saveDiff() {
    if (!this.diffData) return;
    if (!this.diffData.fileName) {
      if (window.App && App.showToast) App.showToast('未指定文件路径', 'error');
      return;
    }
    try {
      await window.api.writeFile(this.diffData.fileName, this.diffData.newCode);
      if (window.App && App.showToast) App.showToast('已保存到原文件', 'success');
    } catch (e) {
      if (window.App && App.showToast) App.showToast('保存失败: ' + e.message, 'error');
    }
  },

  /* ---------- 日志 ---------- */
  appendLog(entry) {
    const logsView = document.getElementById('logsView');
    if (!logsView) return;

    // 移除空状态
    if (logsView.classList.contains('empty')) {
      logsView.classList.remove('empty');
      logsView.innerHTML = '';
    }

    const time = new Date(entry.timestamp || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
    const status = entry.status || 'info';
    const statusText = { success: '成功', error: '失败', warn: '警告', info: '信息' }[status] || '信息';

    const logEl = document.createElement('div');
    logEl.className = `log-entry ${status}`;
    logEl.innerHTML = `
      <div class="log-entry-header">
        <span class="log-entry-time">${time}</span>
        <span class="log-entry-tool">${this.escapeHtml(entry.tool || '-')}</span>
        <span class="log-entry-status">${statusText}</span>
      </div>
      ${entry.result ? `<div class="log-entry-result">${this.escapeHtml(entry.result)}</div>` : ''}
    `;
    logsView.appendChild(logEl);
    logsView.scrollTop = logsView.scrollHeight;
  },

  clearLogs() {
    const logsView = document.getElementById('logsView');
    if (logsView) {
      logsView.innerHTML = '';
      this.renderEmptyLogs();
    }
  },

  renderEmptyLogs() {
    const logsView = document.getElementById('logsView');
    if (logsView && !logsView.innerHTML.trim()) {
      logsView.classList.add('empty');
      logsView.innerHTML = '暂无任务日志';
    }
  },

  /* ---------- 终端 ---------- */
  initTerminal() {
    if (window.Terminal) {
      Terminal.init();
    }
  },

  /* ---------- 工具 ---------- */
  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }
};

window.RightPanel = RightPanel;
