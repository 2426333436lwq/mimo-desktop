/* ============================================================
   FileSystem - 文件浏览器
   - 树形展开/折叠
   - 文件图标映射
   - 右键菜单（刷新/打开/复制路径/重选目录）
   ============================================================ */
const FileSystem = {
  currentPath: '',
  relPath: '', // 当前目录相对于工作区根的路径（'' = 根）
  onNavigate: null,
  onFileSelect: null,
  files: [],
  expandedDirs: new Set(),
  fileStatuses: new Map(),

  async init(options = {}) {
    this.onNavigate = options.onNavigate || (() => {});
    this.onFileSelect = options.onFileSelect || (() => {});
    this.currentPath = '';
    this.relPath = '';
    await this.navigate('');
    this.initContextMenu();
  },

  async navigate(relativePath) {
    const result = await window.api.listFiles(relativePath);
    if (result.error) {
      this.renderError(result.error);
      return;
    }
    this.currentPath = result.path;
    this.relPath = relativePath || '';
    this.files = result.items;
    this.onNavigate(result);
  },

  async goUp() {
    // 基于相对路径向上，避免绝对路径拼接越出工作区
    const rel = this.relPath || '';
    if (!rel) return; // 已在工作区根目录
    const parts = rel.split('/');
    parts.pop();
    await this.navigate(parts.join('/'));
  },

  async selectDirectory() {
    const dirPath = await window.api.selectDirectory();
    if (dirPath) {
      const config = await Storage.loadConfig();
      config.sandboxPath = dirPath;
      await Storage.saveConfig(config);
      this.expandedDirs.clear();
      await this.navigate('');
      if (window.App && App.showToast) App.showToast('工作区已切换', 'success');
    }
  },

  async readFile(relativePath) {
    return window.api.readFile(relativePath);
  },

  async writeFile(relativePath, content) {
    return window.api.writeFile(relativePath, content);
  },

  async mkdir(relativePath) {
    return window.api.mkdir(relativePath);
  },

  async deletePath(relativePath) {
    if (!confirm(`确定删除 ${relativePath} 吗？`)) return null;
    return window.api.deletePath(relativePath);
  },

  async resolvePath(relativePath) {
    return window.api.resolvePath(relativePath);
  },

  // 根据扩展名获取文件图标类名
  getFileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = {
      js: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
      ts: 'ts', tsx: 'ts',
      json: 'json',
      md: 'md', markdown: 'md',
      css: 'css', scss: 'css', less: 'css',
      html: 'html', htm: 'html', xml: 'html',
      py: 'py',
      png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', ico: 'image',
      txt: 'txt', log: 'txt'
    };
    return map[ext] || 'file';
  },

  // 文件图标 SVG
  getFileIconSvg(name, isDir) {
    if (isDir) {
      return '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>';
    }
    const type = this.getFileIcon(name);
    // 通用文件图标，CSS 会根据类名着色
    return '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>';
  },

  renderTree(result) {
    const tree = document.getElementById('fileTree');
    const filePath = document.getElementById('filePath');
    if (!tree) return;

    if (filePath) filePath.textContent = result.path;

    if (!result.items || result.items.length === 0) {
      tree.innerHTML = '';
      tree.appendChild(EmptyState.file());
      return;
    }

    const sorted = [...result.items].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    tree.innerHTML = this.renderFileList(sorted, '');
    this.bindFileItems(tree);
  },

  // 递归渲染文件列表（用于子目录展开）
  renderFileItems(items, basePath) {
    const sorted = [...items].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return this.renderFileList(sorted, basePath);
  },

  renderFileList(items, basePath) {
    return items.map(item => {
      const relativePath = basePath ? `${basePath}/${item.name}` : item.name;
      const iconClass = item.isDir ? 'is-dir' : this.getFileIcon(item.name);
      const status = this.fileStatuses.get(relativePath);
      const statusClass = status ? ` ${status}` : '';
      const chevron = item.isDir ? '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>' : '';

      return `
        <div class="file-item ${iconClass}${statusClass}" data-name="${this.escapeAttr(item.name)}" data-path="${this.escapeAttr(relativePath)}" data-is-dir="${item.isDir}">
          ${chevron}
          <svg class="file-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${this.getFileIconSvg(item.name, item.isDir)}
          </svg>
          <span class="file-item-name">${this.escapeHtml(item.name)}</span>
          ${item.isFile && item.size > 0 ? `<span class="file-item-size">${this.formatSize(item.size)}</span>` : ''}
          ${status ? `<span class="file-item-status ${status}">${this.getStatusLabel(status)}</span>` : ''}
        </div>
        ${item.isDir ? `<div class="file-tree-children" data-parent="${this.escapeAttr(relativePath)}"></div>` : ''}
      `;
    }).join('');
  },

  getStatusLabel(status) {
    return { added: '新', modified: '改', deleted: '删' }[status] || '';
  },

  bindFileItems(container) {
    container.querySelectorAll('.file-item').forEach(el => {
      if (el.dataset.bound) return;
      el.dataset.bound = '1';

      el.addEventListener('click', async (e) => {
        const name = el.dataset.name;
        const relativePath = el.dataset.path;
        const isDir = el.dataset.isDir === 'true';

        // 点击 chevron 展开/折叠
        if (e.target.closest('.chevron') && isDir) {
          e.stopPropagation();
          await this.toggleExpand(el, relativePath);
          return;
        }

        if (isDir) {
          // 单击目录导航进入
          await this.navigate(relativePath);
        } else {
          // 单击文件预览
          await this.openFile(relativePath, name);
        }
      });

      // 右键菜单
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showFileContextMenu(e, el);
      });
    });
  },

  async toggleExpand(dirEl, relativePath) {
    const childrenEl = dirEl.nextElementSibling;
    if (!childrenEl || !childrenEl.classList.contains('file-tree-children')) return;

    if (this.expandedDirs.has(relativePath)) {
      // 折叠
      this.expandedDirs.delete(relativePath);
      childrenEl.classList.remove('expanded');
      childrenEl.innerHTML = '';
      dirEl.classList.remove('expanded');
    } else {
      // 展开
      this.expandedDirs.add(relativePath);
      dirEl.classList.add('expanded');
      childrenEl.classList.add('expanded');

      try {
        const result = await window.api.listFiles(relativePath);
        if (result.error) {
          childrenEl.innerHTML = '<div class="no-topics" style="padding:4px 12px;font-size:11px;">读取失败</div>';
          return;
        }
        if (!result.items || result.items.length === 0) {
          childrenEl.innerHTML = '<div class="no-topics" style="padding:4px 12px;font-size:11px;color:var(--text-tertiary);">空目录</div>';
          return;
        }
        childrenEl.innerHTML = this.renderFileItems(result.items, relativePath);
        this.bindFileItems(childrenEl);
      } catch (e) {
        childrenEl.innerHTML = '<div class="no-topics" style="padding:4px 12px;font-size:11px;">读取失败</div>';
      }
    }
  },

  async openFile(relativePath, name) {
    const result = await window.api.readFile(relativePath);
    if (result.error) {
      if (window.App && App.showToast) App.showToast('读取失败: ' + result.error, 'error');
      return;
    }

    // 记录当前文件（供代码块"应用"使用）
    if (window.Chat) {
      Chat._lastFilePath = relativePath;
      Chat._lastFileContent = result.content;
    }

    // 在右侧面板预览
    if (window.RightPanel) {
      RightPanel.previewFile(relativePath, result.content);
    }

    if (this.onFileSelect) {
      this.onFileSelect(relativePath, name, result.content);
    }
  },

  /* ---------- 右键菜单 ---------- */
  initContextMenu() {
    document.addEventListener('click', () => {
      this.hideContextMenu();
    });
  },

  showFileContextMenu(e, fileEl) {
    const menu = document.getElementById('contextMenu');
    if (!menu) return;

    const relativePath = fileEl.dataset.path;
    const isDir = fileEl.dataset.isDir === 'true';
    const name = fileEl.dataset.name;

    const actions = [];
    if (isDir) {
      actions.push({ label: '进入目录', action: () => this.navigate(relativePath) });
      actions.push({ label: '全部展开', action: () => this.expandAll() });
    } else {
      actions.push({ label: '打开文件', action: () => this.openFile(relativePath, name) });
      actions.push({ label: 'Diff 对比', action: () => {
        const result = window.Chat?._lastFileContent;
        if (result && window.RightPanel) RightPanel.showDiff(result, '', name);
      }});
      actions.push({ label: '恢复最近版本', action: () => this.restoreLatest(relativePath, name) });
    }
    actions.push({ separator: true });
    actions.push({ label: '复制路径', action: () => this.copyPath(relativePath) });
    actions.push({ label: '在资源管理器中显示', action: () => this.showInExplorer(relativePath) });
    actions.push({ separator: true });
    actions.push({ label: '刷新目录', action: () => this.refresh() });
    actions.push({ label: '重选工作区', action: () => this.selectDirectory() });
    actions.push({ separator: true });
    actions.push({ label: '忽略此文件', action: () => {
      if (window.App && App.showToast) App.showToast(`已忽略 ${name}（同步过滤规则至后端）`, 'info');
    }});

    menu.innerHTML = actions.map(a => {
      if (a.separator) return '<div class="context-menu-separator"></div>';
      return `<div class="context-menu-item" data-label="${this.escapeAttr(a.label)}">${a.label}</div>`;
    }).join('');

    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.remove('hidden');

    // 确保不超出视窗
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
    }

    // 绑定点击事件（用 data-label 匹配 action）
    const clickableActions = actions.filter(a => !a.separator);
    menu.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.hideContextMenu();
        const label = item.dataset.label;
        const action = clickableActions.find(a => a.label === label);
        if (action) action.action();
      });
    });
  },

  hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    if (menu) menu.classList.add('hidden');
  },

  async copyPath(relativePath) {
    const fullPath = await this.resolvePath(relativePath);
    if (!fullPath) {
      if (window.App && App.showToast) App.showToast('路径超出工作区范围', 'warn');
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(fullPath);
      if (window.App && App.showToast) App.showToast('路径已复制', 'success');
    }
  },

  async showInExplorer(relativePath) {
    const fullPath = await this.resolvePath(relativePath);
    if (!fullPath) {
      if (window.App && App.showToast) App.showToast('路径超出工作区范围', 'warn');
      return;
    }
    if (window.api.showItemInFolder) {
      window.api.showItemInFolder(fullPath);
    }
  },

  // Checkpoint：把文件恢复到最近的自动备份版本
  async restoreLatest(relativePath, name) {
    if (!window.api.listCheckpoints || !window.api.restoreCheckpoint) {
      if (window.App && App.showToast) App.showToast('当前版本不支持恢复', 'warn');
      return;
    }
    const list = await window.api.listCheckpoints(relativePath);
    if (!list || list.length === 0) {
      if (window.App && App.showToast) App.showToast('该文件没有可恢复的历史版本', 'info');
      return;
    }
    const latest = list[0];
    if (window.Confirm) {
      Confirm.show({
        title: '恢复最近版本',
        message: `将 ${name} 恢复到 ${latest.time} 的版本？当前内容会被覆盖。`,
        level: 'warning',
        confirmText: '恢复',
        cancelText: '取消',
        onConfirm: async () => {
          const result = await window.api.restoreCheckpoint(latest.ts);
          if (result.error) {
            if (window.App && App.showToast) App.showToast('恢复失败: ' + result.error, 'error');
            return;
          }
          await this.refresh();
          if (window.App && App.showToast) App.showToast(`已恢复 ${name} 到 ${latest.time} 的版本`, 'success');
        }
      });
    }
  },

  async refresh() {
    this.expandedDirs.clear();
    await this.navigate(this.relPath || '');
    if (window.App && App.showToast) App.showToast('已刷新', 'info');
  },

  // 全部展开
  async expandAll() {
    const tree = document.getElementById('fileTree');
    if (!tree) return;
    const dirItems = tree.querySelectorAll('.file-item.is-dir');
    for (const el of dirItems) {
      const relativePath = el.dataset.path;
      if (!this.expandedDirs.has(relativePath)) {
        await this.toggleExpand(el, relativePath);
      }
    }
    if (window.App && App.showToast) App.showToast('已全部展开', 'info');
  },

  // 全部折叠
  collapseAll() {
    const tree = document.getElementById('fileTree');
    if (!tree) return;
    this.expandedDirs.clear();
    // 重新渲染
    const items = tree.querySelectorAll('.file-item');
    items.forEach(el => {
      el.classList.remove('expanded');
      const next = el.nextElementSibling;
      if (next && next.classList.contains('file-tree-children')) {
        next.classList.remove('expanded');
        next.innerHTML = '';
      }
    });
    if (window.App && App.showToast) App.showToast('已全部折叠', 'info');
  },

  renderError(error) {
    const tree = document.getElementById('fileTree');
    if (!tree) return;
    tree.innerHTML = `<div class="no-topics"><span class="no-topics-icon">⚠</span>读取目录失败<br><span class="hint">${this.escapeHtml(error)}</span></div>`;
  },

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  },

  escapeAttr(text) {
    return String(text == null ? '' : text).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
};

window.FileSystem = FileSystem;
