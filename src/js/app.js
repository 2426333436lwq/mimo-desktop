/* ============================================================
   App - 应用主控制器
   - 顶栏按钮绑定（新建/打开项目/清空/模型切换/设置/侧栏/右栏/窗口控制）
   - 侧栏 Tab / 右栏 Tab / 设置 Tab 切换
   - 侧栏 / 右栏拖拽调宽
   - 主题切换 / 字体大小 / 缓存管理
   - Toast / 右键菜单 / 全局快捷键
   - 初始化所有子模块
   ============================================================ */
const App = {
  currentTopicId: null,
  currentFile: null,
  attachments: [],
  isPinned: false,
  // 预置模型（兜底，会被 API /v1/models 的拉取结果合并覆盖）
  modelList: [
    { id: 'mimo-v2.5', name: 'MiMo v2.5' }
  ],
  // 从 API 拉取到的可用模型列表
  remoteModels: [],

  async init() {
    await this.initConfig();
    this.initTopBar();
    this.initSidebar();
    this.initChat();
    this.initSettings();
    this.initPermissions();
    this.initResizers();
    this.initCodeFullscreen();
    this.initShortcuts();
    this.initTrayEvents();

    // 初始化子模块
    if (window.StatusBar) StatusBar.init();
    if (window.RightPanel) RightPanel.init();
    if (window.PlanPanel) PlanPanel.init();
    if (window.Skills) await Skills.init();
    if (window.Confirm) Confirm.init();
    if (window.UI) UI.init();

    // 加载主题与字体
    await this.applyTheme();
    await this.applyFontSize();

    // 加载会话列表
    const topicList = await Storage.listTopics();
    if (topicList.length > 0) {
      await Chat.init(topicList[0].id);
      this.currentTopicId = topicList[0].id;
      this.renderTopicList();
    } else {
      Chat.createNewTopic();
      Chat.renderMessages();
      this.renderTopicList();
    }

    // 同步：顶栏按钮 / 设置弹窗输入框 / 底部状态栏
    const config = await Storage.loadConfig();
    if (window.PermissionEngine) PermissionEngine.init(config);
    this.setModel(config.model || 'mimo-v2.5');
    if (window.StatusBar) {
      StatusBar.setSandbox(config.sandboxPath ? 'safe' : 'idle');
    }

    // 默认根据 Key 自动拉取可用模型（可在设置中禁用）
    if (config.autoFetchModels !== false) {
      try {
        await this.refreshModelList(false);
      } catch {
        // 拉取失败忽略，使用兜底预置模型
      }
    }
  },

  async initConfig() {
    const config = await Storage.loadConfig();
    if (!config.apiEndpoint || !config.apiKey) {
      setTimeout(() => this.showSettings(), 500);
    }
  },

  /* ---------- 顶栏 ---------- */
  initTopBar() {
    // 新建会话下拉
    this.initTopbarDropdown('newTopicBtn', 'newTopicDropdown', [
      { id: 'chat', name: '通用闲聊会话', icon: '💬', desc: '自由对话、问答交流' },
      { id: 'project', name: '工程任务会话', icon: '🛠', desc: '项目工程化任务执行' }
    ], (id) => this.newTopic(id));

    document.getElementById('openProjectBtn').addEventListener('click', () => this.openProject());

    // 计划模式开关（对标 Reasonix Plan Mode）
    const planModeBtn = document.getElementById('planModeBtn');
    if (planModeBtn) {
      planModeBtn.addEventListener('click', () => {
        const on = Chat.togglePlanMode();
        planModeBtn.classList.toggle('active', on);
        const label = document.getElementById('planModeLabel');
        if (label) label.textContent = on ? '计划中' : '计划';
        this.showToast(on ? '已开启计划模式：先出计划，批准后执行' : '已关闭计划模式', on ? 'info' : 'success');
      });
    }

    // 清空对话下拉
    this.initTopbarDropdown('clearChatBtn', 'clearChatDropdown', [
      { id: 'ui', name: '仅清空界面展示', icon: '🧹', desc: '保留会话记录，仅清除当前显示' },
      { id: 'all', name: '删除会话缓存数据', icon: '🗑', desc: '彻底删除当前会话所有消息' }
    ], (id) => this.clearChat(id));

    document.getElementById('settingsBtn').addEventListener('click', () => this.showSettings());

    document.getElementById('toggleSidebarBtn').addEventListener('click', () => this.toggleSidebar());
    document.getElementById('toggleRightPanelBtn').addEventListener('click', () => {
      if (window.RightPanel) RightPanel.toggle();
    });

    // 模型切换器
    this.initModelSwitcher();

    // 窗口控制
    document.getElementById('pinTopBtn').addEventListener('click', () => this.togglePin());
    document.getElementById('minimizeBtn').addEventListener('click', () => {
      if (window.api.minimizeWindow) window.api.minimizeWindow();
    });
    document.getElementById('closeBtn').addEventListener('click', () => {
      if (window.api.closeWindow) window.api.closeWindow();
    });
  },

  // 通用顶栏下拉初始化
  initTopbarDropdown(btnId, dropdownId, items, onSelect) {
    const btn = document.getElementById(btnId);
    const dropdown = document.getElementById(dropdownId);
    if (!btn || !dropdown) return;

    const wrap = btn.closest('.topbar-dropdown-wrap');

    const close = () => {
      dropdown.classList.add('hidden');
      if (wrap) wrap.classList.remove('open');
    };

    const open = () => {
      dropdown.innerHTML = items.map(item => `
        <div class="model-dropdown-item" data-id="${item.id}">
          <span style="margin-right:6px;">${item.icon || ''}</span>
          <div style="flex:1;">
            <div style="font-size:13px;">${this.escapeHtml(item.name)}</div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">${this.escapeHtml(item.desc || '')}</div>
          </div>
        </div>
      `).join('');
      dropdown.classList.remove('hidden');
      if (wrap) wrap.classList.add('open');

      dropdown.querySelectorAll('.model-dropdown-item').forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = opt.dataset.id;
          close();
          onSelect && onSelect(id);
        });
      });
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.classList.contains('hidden')) open();
      else close();
    });

    // 点击其他地方关闭
    document.addEventListener('click', (e) => {
      if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && e.target !== btn) {
        close();
      }
    });
  },

  initModelSwitcher() {
    const btn = document.getElementById('modelSwitcherBtn');
    const dropdown = document.getElementById('modelDropdown');
    if (!btn || !dropdown) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
      if (!dropdown.classList.contains('hidden')) {
        this.renderModelDropdown();
      }
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && e.target !== btn) {
        dropdown.classList.add('hidden');
      }
    });
  },

  async renderModelDropdown() {
    const dropdown = document.getElementById('modelDropdown');
    if (!dropdown) return;

    try {
      const config = await Storage.loadConfig();
      const current = config.model || 'mimo-v2.5';

      // 优先级：远端 API 返回的列表 > 预置兜底 > 当前使用的自定义模型
      const items = [];
      const seenIds = new Set();

      // 1. 远端拉取到的可用模型（API 授权过的，放最前）
      if (this.remoteModels && this.remoteModels.length > 0) {
        for (const m of this.remoteModels) {
          if (seenIds.has(m.id)) continue;
          seenIds.add(m.id);
          items.push({ id: m.id, name: m.name || m.id, remote: true });
        }
      }

      // 2. 预置兜底模型
      for (const m of this.modelList) {
        if (seenIds.has(m.id)) continue;
        seenIds.add(m.id);
        items.push({ id: m.id, name: m.name || m.id, preset: true });
      }

      // 3. 当前正在使用的自定义模型（若未包含在上述列表中则补上）
      if (current && !seenIds.has(current)) {
        items.unshift({ id: current, name: current, custom: true });
      }

      dropdown.innerHTML = items.map(m => `
        <div class="model-dropdown-item ${m.id === current ? 'active' : ''}" data-id="${this.escapeAttr(m.id)}">
          <span>${this.escapeHtml(m.name)}${m.custom ? ' <span class="hint">（自定义）</span>' : ''}</span>
          ${m.id === current ? '<svg class="check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
        </div>
      `).join('');

      dropdown.querySelectorAll('.model-dropdown-item').forEach(opt => {
        opt.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = opt.dataset.id;
          try {
            const cfg = await Storage.loadConfig();
            cfg.model = id;
            const result = await Storage.saveConfig(cfg);
            if (result && result.success !== false) {
              this.setModel(id);
              dropdown.classList.add('hidden');
              this.showToast('模型已切换', 'success');
            } else {
              this.showToast('模型切换失败', 'error');
            }
          } catch (err) {
            console.error('切换模型失败:', err);
            this.showToast('切换模型失败: ' + (err.message || err), 'error');
          }
        });
      });
    } catch (err) {
      console.error('渲染模型列表失败:', err);
      dropdown.innerHTML = `<div class="model-dropdown-empty">加载模型列表失败</div>`;
    }
  },

  // 统一设置模型：顶栏按钮、设置弹窗输入框、底部状态栏三处同步
  setModel(model) {
    // 1. 顶栏模型切换按钮显示
    const topBtnEl = document.getElementById('currentModelName');
    if (topBtnEl) {
      let m = this.modelList.find(x => x.id === model);
      if (!m && this.remoteModels && this.remoteModels.length > 0) {
        m = this.remoteModels.find(x => x.id === model);
      }
      topBtnEl.textContent = m ? (m.name || m.id) : model;
    }
    // 2. 设置弹窗内"模型名称"输入框（如果已挂载）
    const settingsInput = document.getElementById('modelName');
    if (settingsInput) {
      settingsInput.value = model;
    }
    // 3. 底部状态栏
    if (window.StatusBar) {
      StatusBar.setModel(model);
    }
  },

  updateModelName(model) {
    // 保留旧接口，调用统一方法
    this.setModel(model);
  },

  async togglePin() {
    this.isPinned = !this.isPinned;
    if (window.api.pinWindow) {
      await window.api.pinWindow(this.isPinned);
    }
    const btn = document.getElementById('pinTopBtn');
    if (btn) btn.classList.toggle('active', this.isPinned);
    this.showToast(this.isPinned ? '窗口已置顶' : '已取消置顶', 'info');
  },

  // Reasonix 风格问答卡：AI 调用 ask 工具时弹窗，用户选择后把答案返回给模型
  async askUser(questions) {
    return new Promise((resolve) => {
      const modal = document.getElementById('askModal');
      const body = document.getElementById('askModalBody');
      const submitBtn = document.getElementById('askSubmitBtn');
      const skipBtn = document.getElementById('askSkipBtn');
      if (!modal || !body) return resolve(null);

      body.innerHTML = questions.map((q, qi) => `
        <div class="ask-question">
          <div class="ask-question-text">${qi + 1}. ${this.escapeHtml(q.question)}</div>
          <div class="ask-options">
            ${q.options.map((opt, oi) => `
              <label class="ask-option">
                <input type="radio" name="ask-q${qi}" value="${this.escapeAttr(opt)}" ${oi === 0 ? 'checked' : ''}>
                <span>${this.escapeHtml(opt)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      `).join('');

      const done = (result) => {
        modal.classList.add('hidden');
        submitBtn.onclick = null;
        skipBtn.onclick = null;
        resolve(result);
      };
      submitBtn.onclick = () => {
        const selected = questions.map((q, qi) => {
          const checked = body.querySelector(`input[name="ask-q${qi}"]:checked`);
          return checked ? checked.value : '';
        });
        done(selected);
      };
      skipBtn.onclick = () => done(null);
      modal.classList.remove('hidden');
    });
  },

  async newTopic(type = 'chat') {
    // 生成中切新会话：先中止旧请求，防止旧回调污染新话题（B4）
    if (Chat.isGenerating && Chat.abort) Chat.abort();
    Chat.createNewTopic(type);
    this.currentTopicId = null;
    Chat.renderMessages();
    const titleEl = document.getElementById('topicTitle');
    if (titleEl) titleEl.textContent = type === 'project' ? '工程任务会话' : '新对话';
    this.renderTopicList();
  },

  async openProject() {
    await FileSystem.selectDirectory();
  },

  clearChat(mode = 'ui') {
    if (!Chat.messages || Chat.messages.length === 0) {
      this.showToast('当前对话为空', 'info');
      return;
    }
    if (mode === 'ui') {
      // 仅清空界面展示
      if (window.Confirm) {
        Confirm.show({
          title: '清空界面',
          message: '清空当前对话的界面展示？（会话记录将保留）',
          level: 'warning',
          confirmText: '清空',
          cancelText: '取消',
          onConfirm: () => {
            Chat.messages = [];
            Chat.renderMessages();
            this.showToast('界面已清空', 'success');
          }
        });
      } else {
        Chat.messages = [];
        Chat.renderMessages();
        this.showToast('界面已清空', 'success');
      }
    } else {
      // 删除会话缓存数据
      if (window.Confirm) {
        Confirm.show({
          title: '删除会话数据',
          message: '确定彻底删除当前会话的所有消息？此操作不可恢复！',
          level: 'danger',
          confirmText: '彻底删除',
          cancelText: '取消',
          onConfirm: () => {
            Chat.messages = [];
            if (Chat.topic) {
              Chat.topic.messages = [];
              Chat.save();
            }
            Chat.renderMessages();
            this.showToast('会话数据已删除', 'success');
          }
        });
      } else {
        Chat.messages = [];
        if (Chat.topic) {
          Chat.topic.messages = [];
          Chat.save();
        }
        Chat.renderMessages();
      }
    }
  },

  /* ---------- 侧栏 ---------- */
  initSidebar() {
    // Tab 切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const el = document.getElementById(tab + 'List');
        if (el) el.classList.add('active');
      });
    });

    // 会话搜索
    const topicSearch = document.getElementById('topicSearchInput');
    if (topicSearch) {
      topicSearch.addEventListener('input', () => this.filterTopics(topicSearch.value));
    }

    // 设置按钮（侧栏底部）
    const settingsBtn2 = document.getElementById('settingsBtn2');
    if (settingsBtn2) {
      settingsBtn2.addEventListener('click', () => this.showSettings());
    }

    // 文件工具条
    const fileBackBtn = document.getElementById('fileBackBtn');
    if (fileBackBtn) fileBackBtn.addEventListener('click', () => FileSystem.goUp());
    const fileSelectBtn = document.getElementById('fileSelectBtn');
    if (fileSelectBtn) fileSelectBtn.addEventListener('click', () => FileSystem.selectDirectory());
    const fileRefreshBtn = document.getElementById('fileRefreshBtn');
    if (fileRefreshBtn) fileRefreshBtn.addEventListener('click', () => FileSystem.refresh());
    const fileExpandAllBtn = document.getElementById('fileExpandAllBtn');
    if (fileExpandAllBtn) fileExpandAllBtn.addEventListener('click', () => FileSystem.expandAll());
    const fileCollapseAllBtn = document.getElementById('fileCollapseAllBtn');
    if (fileCollapseAllBtn) fileCollapseAllBtn.addEventListener('click', () => FileSystem.collapseAll());

    // 初始化文件系统
    FileSystem.init({
      onNavigate: (result) => FileSystem.renderTree(result),
      onFileSelect: (relativePath, name, content) => {
        this.currentFile = { path: relativePath, name, content };
      }
    });
  },

  filterTopics(keyword) {
    // 重置分页并重新渲染（renderTopicList 内部已包含搜索过滤+高亮）
    this._topicPage = 1;
    this.renderTopicList();
  },

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('collapsed');
  },

  /* ---------- 对话区 ---------- */
  initChat() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const stopBtn = document.getElementById('stopBtn');
    const attachBtn = document.getElementById('attachBtn');
    const exportBtn = document.getElementById('exportBtn');
    const toggleTerminalBtn = document.getElementById('toggleTerminalBtn');
    const inputContainer = document.querySelector('.composer-card');
    const dropHint = document.getElementById('dropHint');

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
      input.addEventListener('paste', (e) => this.handlePaste(e));
      input.addEventListener('input', () => {
        this.autoResizeInput();
        this.updateCharCount();
      });
    }

    // 字符数统计
    this.updateCharCount();

    // 拖拽文件上传
    if (inputContainer && dropHint) {
      const showDrop = () => dropHint.classList.remove('hidden');
      const hideDrop = () => dropHint.classList.add('hidden');

      ['dragenter', 'dragover'].forEach(evt => {
        inputContainer.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
          showDrop();
        });
      });
      ['dragleave', 'drop'].forEach(evt => {
        inputContainer.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (evt === 'dragleave' && inputContainer.contains(e.relatedTarget)) return;
          hideDrop();
        });
      });
      inputContainer.addEventListener('drop', async (e) => {
        const files = Array.from(e.dataTransfer?.files || []);
        for (const file of files) {
          const dataUrl = await this.fileToDataUrl(file);
          const att = await Storage.saveAttachment(file.name, dataUrl);
          this.attachments.push({ ...att, name: file.name });
        }
        this.renderAttachments();
      });
    }

    if (sendBtn) sendBtn.addEventListener('click', () => this.sendMessage());
    if (attachBtn) {
      attachBtn.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.onchange = async (e) => {
          for (const file of e.target.files) {
            const dataUrl = await this.fileToDataUrl(file);
            const att = await Storage.saveAttachment(file.name, dataUrl);
            this.attachments.push({ ...att, name: file.name });
            this.renderAttachments();
          }
        };
        fileInput.click();
      });
    }

    if (exportBtn) exportBtn.addEventListener('click', () => this.exportConversation());

    if (toggleTerminalBtn) {
      toggleTerminalBtn.addEventListener('click', () => {
        if (window.RightPanel) {
          // 检查终端是否被关闭
          const terminalTab = document.querySelector('.rp-tab-btn[data-rp-tab="terminal"]');
          if (terminalTab && terminalTab.classList.contains('hidden-tab')) {
            RightPanel.openTerminal();
          } else {
            RightPanel.showTab('terminal');
          }
        }
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        // 只发起中止，让 generateResponse 的 finally 统一收尾（避免双生成竞态 B6）
        if (Chat.abort) Chat.abort();
      });
    }

    // 生成结束回调（Chat.generateResponse finally 调用）：恢复按钮与状态栏
    this.onGenerationEnd = () => {
      this.updateSendButton();
      if (window.StatusBar) StatusBar.setIdle();
    };

    Chat.onPermissionRequest = async (funcName, args) => {
      return new Promise((resolve) => {
        this.showPermissionModal(funcName, args, resolve);
      });
    };
  },

  updateCharCount() {
    const input = document.getElementById('chatInput');
    const counter = document.getElementById('charCount');
    if (!input || !counter) return;
    const len = input.value.length;
    counter.textContent = len;
    // 超过 32000 字符标红警告（软限制）
    if (len > 32000) {
      counter.classList.add('over-limit');
      counter.textContent = len + ' ⚠';
    } else {
      counter.classList.remove('over-limit');
    }
  },

  autoResizeInput() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 220) + 'px';
  },

  /* ---------- 设置 ---------- */
  initSettings() {
    const modal = document.getElementById('settingsModal');
    const closeBtn = document.getElementById('settingsCloseBtn');
    const saveBtn = document.getElementById('settingsSaveBtn');
    const testBtn = document.getElementById('settingsTestBtn');
    const browseBtn = document.getElementById('browseSandboxBtn');
    const permSaveBtn = document.getElementById('permSaveBtn');
    const clearCacheBtn = document.getElementById('clearCacheBtn');
    const refreshModelsBtn = document.getElementById('refreshModelsBtn');

    if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    if (saveBtn) saveBtn.addEventListener('click', () => this.saveSettings());
    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        const result = await MiMoAPI.testConnection();
        this.showToast(result.message, result.success ? 'success' : 'error');
      });
    }
    if (browseBtn) {
      browseBtn.addEventListener('click', async () => {
        const dir = await window.api.selectDirectory();
        if (dir) document.getElementById('sandboxPath').value = dir;
      });
    }
    if (permSaveBtn) permSaveBtn.addEventListener('click', () => this.saveProjectPermissions());
    if (clearCacheBtn) clearCacheBtn.addEventListener('click', () => this.clearCache());
    if (refreshModelsBtn) {
      refreshModelsBtn.addEventListener('click', async () => {
        // 先保存当前输入框中的 API 配置（若用户尚未点保存设置），确保刷新用到的是最新 Key
        const cfg = await Storage.loadConfig();
        cfg.apiEndpoint = document.getElementById('apiEndpoint').value.trim() || cfg.apiEndpoint;
        cfg.apiKey = document.getElementById('apiKey').value.trim() || cfg.apiKey;
        await Storage.saveConfig(cfg);
        await this.refreshModelList(true);
      });
    }

    // 设置 Tab 切换
    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const stab = tab.dataset.stab;
        document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
        const pane = document.querySelector(`.settings-pane[data-spane="${stab}"]`);
        if (pane) pane.classList.add('active');

        // 切换到缓存 Tab 时刷新大小
        if (stab === 'cache') this.refreshCacheSize();
      });
    });

    // 模型输入框自定义下拉
    this.bindModelNameInput();

    // 主题选择
    document.querySelectorAll('input[name="theme"]').forEach(radio => {
      radio.addEventListener('change', () => this.applyTheme(radio.value));
    });

    // 字体大小
    const fontSize = document.getElementById('fontSize');
    if (fontSize) {
      fontSize.addEventListener('change', () => this.applyFontSize(fontSize.value));
    }
  },

  async applyTheme(theme) {
    if (!theme) {
      const config = await Storage.loadConfig();
      theme = config.theme || 'dark';
    }
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('input[name="theme"]').forEach(r => {
      r.checked = r.value === theme;
    });
  },

  async applyFontSize(size) {
    if (!size) {
      const config = await Storage.loadConfig();
      size = config.fontSize || 13;
    }
    document.documentElement.style.fontSize = size + 'px';
    const select = document.getElementById('fontSize');
    if (select) select.value = size;
  },

  async refreshCacheSize() {
    if (!window.api.getCacheSize) return;
    const sizes = await window.api.getCacheSize();
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = this.formatSize(val);
    };
    set('cacheTopicsSize', sizes.topics);
    set('cacheAttachmentsSize', sizes.attachments);
    set('cacheConfigSize', sizes.config);
    set('cacheTotalSize', sizes.total);
  },

  async clearCache() {
    Confirm.show({
      title: '清空缓存',
      message: '确定清空所有缓存吗？这将删除所有对话和附件。',
      level: 'danger',
      confirmText: '清空',
      cancelText: '取消',
      onConfirm: async () => {
        const result = await Storage.clearCache();
        if (result.success) {
          this.showToast('缓存已清空', 'success');
          await this.refreshCacheSize();
          Chat.createNewTopic();
          this.currentTopicId = null;
          Chat.renderMessages();
          this.renderTopicList();
        } else {
          this.showToast('清空失败: ' + (result.error || '未知错误'), 'error');
        }
      }
    });
  },

  showSettings() {
    document.getElementById('settingsModal').classList.remove('hidden');
    this.loadSettings();
  },

  async loadSettings() {
    const config = await Storage.loadConfig();
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val ?? '';
    };
    set('apiEndpoint', config.apiEndpoint);
    set('apiKey', config.apiKey);
    set('modelName', config.model || 'mimo-v2.5');
    set('temperature', config.temperature ?? 0.7);
    set('maxTokens', config.maxTokens ?? 4096);
    set('systemPrompt', config.systemPrompt);
    set('sandboxPath', config.sandboxPath);

    const tools = config.allowedTools || [];
    const check = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.checked = v;
    };
    check('toolBash', tools.includes('bash'));
    check('toolFileRead', tools.includes('file_read'));
    check('toolFileWrite', tools.includes('file_write'));
    check('toolFileEdit', tools.includes('file_edit'));

    // 主题与字体
    document.querySelectorAll('input[name="theme"]').forEach(r => {
      r.checked = r.value === (config.theme || 'dark');
    });
    const fontSizeEl = document.getElementById('fontSize');
    if (fontSizeEl) fontSizeEl.value = config.fontSize || 13;

    // 布局
    check('layoutShowSidebar', config.layoutShowSidebar !== false);
    check('layoutShowRightPanel', config.layoutShowRightPanel === true);

    // 模型
    check('autoFetchModels', config.autoFetchModels !== false);
    // 把已拉取的模型同步到 <datalist>，提供输入联想
    this.syncModelDatalist();

    // 项目权限
    try {
      const perms = await Storage.loadProjectPermissions();
      check('permBashAllowAll', perms.bashAllowAll !== false);
      set('permBashWhitelist', (perms.bashCommandWhitelist || []).join('\n'));
      check('permEditAllowed', perms.editAllowed !== false);
      check('permFileWriteAllowed', perms.fileWriteAllowed !== false);
      const permPath = await Storage.getPermissionsPath();
      set('permFilePath', permPath || '');
    } catch (e) {
      console.warn('加载项目权限失败:', e);
    }

    // 审批模式与权限规则（Reasonix 风格 deny/ask/allow）
    set('approvalMode', config.approvalMode || 'ask');
    set('ruleDeny', ((config.permissionRules && config.permissionRules.deny) || []).join('\n'));
    set('ruleAsk', ((config.permissionRules && config.permissionRules.ask) || []).join('\n'));
    set('ruleAllow', ((config.permissionRules && config.permissionRules.allow) || []).join('\n'));

    this.refreshCacheSize();
  },

  // 持久化当前权限规则（"总是允许"时调用）
  async savePermissionRules() {
    const config = await Storage.loadConfig();
    config.approvalMode = PermissionEngine.mode;
    config.permissionRules = {
      deny: PermissionEngine.rules.deny || [],
      ask: PermissionEngine.rules.ask || [],
      allow: PermissionEngine.rules.allow || []
    };
    await Storage.saveConfig(config);
  },

  async saveProjectPermissions() {
    const whitelistText = document.getElementById('permBashWhitelist').value;
    const permissions = {
      bashAllowAll: document.getElementById('permBashAllowAll').checked,
      bashCommandWhitelist: whitelistText.split('\n').map(s => s.trim()).filter(Boolean),
      editAllowed: document.getElementById('permEditAllowed').checked,
      fileWriteAllowed: document.getElementById('permFileWriteAllowed').checked
    };
    const result = await Storage.saveProjectPermissions(permissions);
    if (result.error) {
      this.showToast('保存失败: ' + result.error, 'error');
    } else {
      const permPath = await Storage.getPermissionsPath();
      document.getElementById('permFilePath').value = permPath || '';
      this.showToast('项目权限已保存', 'success');
    }
  },

  async saveSettings() {
    const config = await Storage.loadConfig();
    config.apiEndpoint = document.getElementById('apiEndpoint').value.trim();
    config.apiKey = document.getElementById('apiKey').value.trim();
    config.model = document.getElementById('modelName').value.trim() || 'mimo-v2.5';
    config.temperature = parseFloat(document.getElementById('temperature').value) || 0.7;
    config.maxTokens = parseInt(document.getElementById('maxTokens').value) || 4096;
    config.systemPrompt = document.getElementById('systemPrompt').value;
    config.sandboxPath = document.getElementById('sandboxPath').value.trim();

    const allowedTools = [];
    if (document.getElementById('toolBash').checked) allowedTools.push('bash');
    if (document.getElementById('toolFileRead').checked) allowedTools.push('file_read');
    if (document.getElementById('toolFileWrite').checked) allowedTools.push('file_write');
    if (document.getElementById('toolFileEdit').checked) allowedTools.push('file_edit');
    config.allowedTools = allowedTools;

    // 主题与字体
    const themeRadio = document.querySelector('input[name="theme"]:checked');
    config.theme = themeRadio ? themeRadio.value : 'dark';
    config.fontSize = parseInt(document.getElementById('fontSize').value) || 13;

    // 布局
    config.layoutShowSidebar = document.getElementById('layoutShowSidebar').checked;
    config.layoutShowRightPanel = document.getElementById('layoutShowRightPanel').checked;

    // 模型自动拉取
    config.autoFetchModels = document.getElementById('autoFetchModels').checked;

    // 审批模式与权限规则（Reasonix 风格）
    config.approvalMode = document.getElementById('approvalMode').value || 'ask';
    const splitRules = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.split('\n').map(s => s.trim()).filter(Boolean) : [];
    };
    config.permissionRules = {
      deny: splitRules('ruleDeny'),
      ask: splitRules('ruleAsk'),
      allow: splitRules('ruleAllow')
    };
    if (window.PermissionEngine) {
      PermissionEngine.mode = config.approvalMode;
      PermissionEngine.rules = config.permissionRules;
    }

    await Storage.saveConfig(config);

    await this.applyTheme(config.theme);
    await this.applyFontSize(config.fontSize);
    this.setModel(config.model);
    if (window.StatusBar) {
      StatusBar.setSandbox(config.sandboxPath ? 'safe' : 'idle');
    }

    // 保存设置后若开启自动拉取，则拉一次模型列表
    if (config.autoFetchModels) {
      try {
        await this.refreshModelList(false);
      } catch {
        // 忽略拉取失败
      }
    }

    document.getElementById('settingsModal').classList.add('hidden');
    this.showToast('设置已保存', 'success');
  },

  /* ---------- 权限弹窗 ---------- */
  initPermissions() {
    const modal = document.getElementById('permissionModal');
    const onceBtn = document.getElementById('permissionOnceBtn');
    const sessionBtn = document.getElementById('permissionSessionBtn');
    const alwaysBtn = document.getElementById('permissionAlwaysBtn');
    const denyBtn = document.getElementById('permissionDenyBtn');

    const finish = (decision) => {
      modal.classList.add('hidden');
      if (!this._permissionResolve) return;
      const resolve = this._permissionResolve;
      this._permissionResolve = null;
      resolve(decision);
    };

    const close = () => {
      // 点遮罩/取消 = 拒绝本次
      modal.classList.add('hidden');
      if (this._permissionResolve) {
        const resolve = this._permissionResolve;
        this._permissionResolve = null;
        resolve(false);
      }
    };

    if (onceBtn) onceBtn.addEventListener('click', () => finish(true));
    if (sessionBtn) {
      sessionBtn.addEventListener('click', () => {
        const { tool, args } = this._permissionCtx || {};
        if (tool) PermissionEngine.grantSession(tool, PermissionEngine.subjectFor(tool, args));
        finish(true);
      });
    }
    if (alwaysBtn) {
      alwaysBtn.addEventListener('click', async () => {
        const { tool, args } = this._permissionCtx || {};
        if (tool) {
          const rule = PermissionEngine.addPersistentAllow(tool, PermissionEngine.subjectFor(tool, args));
          if (rule && window.App && App.showToast) App.showToast(`已添加持久规则: ${rule}`, 'success');
          // 持久规则立即保存到配置
          await this.savePermissionRules();
        }
        finish(true);
      });
    }
    if (denyBtn) denyBtn.addEventListener('click', () => finish(false));

    // 点击遮罩关闭 = 拒绝
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
  },

  showPermissionModal(funcName, args, resolve) {
    this._permissionResolve = resolve;
    this._permissionCtx = { tool: funcName, args };
    const modal = document.getElementById('permissionModal');
    document.getElementById('permissionTitle').textContent = `MiMo 请求执行: ${funcName}`;
    document.getElementById('permissionDetails').textContent = JSON.stringify(args, null, 2);

    // 显示当前审批模式与规则提示
    const modeTag = document.getElementById('permissionModeTag');
    if (modeTag) {
      const map = { ask: 'Ask 模式', auto: 'Auto 模式', yolo: 'YOLO 模式' };
      modeTag.textContent = map[PermissionEngine.mode] || PermissionEngine.mode;
    }
    const hint = document.getElementById('permissionRuleHint');
    if (hint) {
      const denyHit = PermissionEngine.findMatchingRule('deny', funcName, args);
      hint.textContent = denyHit ? `匹配 deny 规则: ${denyHit}` : '';
    }
    modal.classList.remove('hidden');
  },

  /* ---------- 拖拽调宽 ---------- */
  initResizers() {
    const sidebarResizer = document.getElementById('sidebarResizer');
    if (sidebarResizer) {
      sidebarResizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.startResize('sidebar', e.clientX);
      });
    }

    const rightPanelResizer = document.getElementById('rightPanelResizer');
    if (rightPanelResizer) {
      rightPanelResizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.startResize('rightPanel', e.clientX);
      });
    }
  },

  startResize(target, startX) {
    const sidebar = document.getElementById('sidebar');
    const rightPanel = document.getElementById('rightPanel');
    const startWidth = target === 'sidebar'
      ? sidebar.offsetWidth
      : rightPanel.offsetWidth;

    const onMove = (e) => {
      if (target === 'sidebar') {
        const newWidth = Math.max(200, Math.min(500, startWidth + (e.clientX - startX)));
        sidebar.style.width = newWidth + 'px';
      } else {
        const newWidth = Math.max(280, Math.min(700, startWidth - (e.clientX - startX)));
        rightPanel.style.width = newWidth + 'px';
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  },

  /* ---------- 代码全屏 ---------- */
  initCodeFullscreen() {
    const modal = document.getElementById('codeFullscreenModal');
    const closeBtn = document.getElementById('codeFullscreenCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    }
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    }
  },

  /* ---------- 全局快捷键 ---------- */
  initShortcuts() {
    if (window.api.onShortcutSend) {
      window.api.onShortcutSend(() => this.sendMessage());
    }
    if (window.api.onShortcutNewTopic) {
      window.api.onShortcutNewTopic(() => this.newTopic('chat'));
    }
    if (window.api.onShortcutSave) {
      window.api.onShortcutSave(() => {
        if (Chat.topic) {
          Chat.save();
          this.showToast('对话已保存', 'success');
        }
      });
    }
    if (window.api.onShortcutClosePreview) {
      window.api.onShortcutClosePreview(() => {
        if (window.RightPanel) RightPanel.collapse();
      });
    }
  },

  initTrayEvents() {
    if (window.api.onTrayNewTopic) {
      window.api.onTrayNewTopic(() => this.newTopic('chat'));
    }
  },

  /* ---------- 发送消息 ---------- */
  async sendMessage() {
    const input = document.getElementById('chatInput');
    const content = input.value.trim();
    // 生成中发送：明确提示而不是静默丢弃（用户以为"发不出去"）
    if (Chat.isGenerating) {
      this.showToast('正在生成中，请等待完成或点击停止按钮', 'info');
      return;
    }
    if (!content) return;

    input.value = '';
    input.style.height = 'auto';
    this.updateCharCount();

    if (window.StatusBar) StatusBar.setBusy();

    await Chat.sendMessage(content, this.attachments);
    this.attachments = [];
    this.renderAttachments();
    this.updateSendButton();

    if (window.StatusBar) StatusBar.setIdle();
  },

  async handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    let imageItem = null;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        imageItem = item;
        break;
      }
    }
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const dataUrl = await this.fileToDataUrl(file);
    const att = await Storage.saveClipboardAttachment(dataUrl);
    this.attachments.push({ id: att.id, name: att.name, path: att.path });
    this.renderAttachments();
  },

  renderAttachments() {
    const bar = document.getElementById('attachmentsBar');
    if (this.attachments.length === 0) {
      bar.innerHTML = '';
      return;
    }
    bar.innerHTML = this.attachments.map((a, i) => `
      <div class="attachment-item">
        <span class="attachment-name">${this.escapeHtml(a.name)}</span>
        <button class="attachment-remove" data-index="${i}">✕</button>
      </div>
    `).join('');

    bar.querySelectorAll('.attachment-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.attachments.splice(idx, 1);
        this.renderAttachments();
      });
    });
  },

  updateSendButton() {
    const sendBtn = document.getElementById('sendBtn');
    const stopBtn = document.getElementById('stopBtn');
    if (Chat.isGenerating) {
      sendBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
    } else {
      sendBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
    }
  },

  /* ---------- 会话列表 ---------- */
  async renderTopicList() {
    const list = await Storage.listTopics();
    const container = document.getElementById('topicsContainer');
    const searchInput = document.getElementById('topicSearchInput');
    const keyword = (searchInput?.value || '').trim().toLowerCase();

    if (list.length === 0) {
      container.innerHTML = '<div class="no-topics"><span class="no-topics-icon">💬</span>暂无对话<br>点击 + 新建</div>';
      return;
    }

    // 过滤（标题 + 最近消息预览）
    const filtered = keyword
      ? list.filter(t => (t.title || '').toLowerCase().includes(keyword) ||
          (t.preview || '').toLowerCase().includes(keyword))
      : list;

    // 分页（超过 50 条滚动加载）
    const PAGE_SIZE = 50;
    if (!this._topicPage) this._topicPage = 1;
    const visible = filtered.slice(0, this._topicPage * PAGE_SIZE);
    const hasMore = filtered.length > visible.length;

    // 分组：置顶 → 今天 → 昨天 → 近7天 → 更早
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOf7DaysAgo = startOfToday - 7 * 86400000;

    const pinned = visible.filter(t => t.pinned).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const today = visible.filter(t => !t.pinned && (t.updatedAt || 0) >= startOfToday);
    const yesterday = visible.filter(t => !t.pinned && (t.updatedAt || 0) >= startOfYesterday && (t.updatedAt || 0) < startOfToday);
    const week = visible.filter(t => !t.pinned && (t.updatedAt || 0) >= startOf7DaysAgo && (t.updatedAt || 0) < startOfYesterday);
    const older = visible.filter(t => !t.pinned && (t.updatedAt || 0) < startOf7DaysAgo);

    const highlight = (text) => {
      if (!keyword) return this.escapeHtml(text);
      const esc = this.escapeHtml(text);
      const kw = this.escapeHtml(keyword);
      const re = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      return esc.replace(re, '<mark class="search-highlight">$1</mark>');
    };

    const renderGroup = (items, label, icon) => {
      if (items.length === 0) return '';
      return `
        <div class="topic-group">
          <div class="topic-group-title">${icon ? icon + ' ' : ''}${label}</div>
          ${items.map(t => this._renderTopicItem(t, keyword, highlight)).join('')}
        </div>
      `;
    };

    let html = '';
    html += renderGroup(pinned, '置顶', '📌');
    html += renderGroup(today, '今天');
    html += renderGroup(yesterday, '昨天');
    html += renderGroup(week, '近 7 天');
    if (older.length > 0) {
      // 按年月再分组
      const monthGroups = {};
      older.forEach(t => {
        const d = new Date(t.updatedAt || 0);
        const key = `${d.getFullYear()}年${d.getMonth() + 1}月`;
        if (!monthGroups[key]) monthGroups[key] = [];
        monthGroups[key].push(t);
      });
      for (const [key, items] of Object.entries(monthGroups)) {
        html += renderGroup(items, key);
      }
    }

    if (hasMore) {
      html += '<div class="topic-load-more" id="topicLoadMore">点击加载更多</div>';
    }

    container.innerHTML = html;

    // 绑定事件
    container.querySelectorAll('.topic-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.topic-delete') || e.target.closest('.topic-pin')) return;
        const id = item.dataset.id;
        this.loadTopic(id);
      });
    });

    container.querySelectorAll('.topic-title').forEach(span => {
      span.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.startRenameTopic(span);
      });
    });

    container.querySelectorAll('.topic-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (window.Confirm) {
          Confirm.show({
            title: '删除对话',
            message: '确定删除这个对话吗？此操作不可撤销。',
            level: 'danger',
            confirmText: '删除',
            cancelText: '取消',
            onConfirm: async () => {
              await Storage.deleteTopic(id);
              if (this.currentTopicId === id) {
                Chat.createNewTopic();
                this.currentTopicId = null;
                Chat.renderMessages();
              }
              this.renderTopicList();
            }
          });
        } else {
          await Storage.deleteTopic(id);
          if (this.currentTopicId === id) {
            Chat.createNewTopic();
            this.currentTopicId = null;
            Chat.renderMessages();
          }
          this.renderTopicList();
        }
      });
    });

    container.querySelectorAll('.topic-pin').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const topic = list.find(t => t.id === id);
        if (!topic) return;
        topic.pinned = !topic.pinned;
        await Storage.saveTopic(topic);
        this.renderTopicList();
      });
    });

    // 懒加载
    const loadMore = document.getElementById('topicLoadMore');
    if (loadMore) {
      loadMore.addEventListener('click', () => {
        this._topicPage = (this._topicPage || 1) + 1;
        this.renderTopicList();
      });
    }
  },

  _renderTopicItem(t, keyword, highlight) {
    const isActive = t.id === this.currentTopicId;
    const pinned = t.pinned ? ' pinned' : '';
    const typeIcon = t.type === 'project'
      ? '<svg class="topic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'
      : '<svg class="topic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    const title = highlight(t.title || '新对话');
    const timeStr = this._formatTopicTime(t.updatedAt);
    return `
      <div class="topic-item${isActive ? ' active' : ''}${pinned}" data-id="${t.id}">
        <span class="topic-icon-wrap">${typeIcon}</span>
        <div class="topic-body">
          <span class="topic-title" data-id="${t.id}" title="双击重命名">${title}</span>
          <span class="topic-time">${timeStr}</span>
        </div>
        <div class="topic-actions">
          <button class="topic-pin" data-id="${t.id}" title="${t.pinned ? '取消置顶' : '置顶'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="${t.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 17v5"/>
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
            </svg>
          </button>
          <button class="topic-delete" data-id="${t.id}" title="删除">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  },

  _formatTopicTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.floor((today - day) / 86400000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (diffDays === 0) return `${hh}:${mm}`;
    if (diffDays === 1) return `昨天 ${hh}:${mm}`;
    if (diffDays < 7) return `${diffDays}天前`;
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  },

  startRenameTopic(span) {
    const id = span.dataset.id;
    const oldTitle = span.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'topic-rename-input';
    input.value = oldTitle;
    input.maxLength = 60;
    span.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const newTitle = input.value.trim();
      if (commit && newTitle && newTitle !== oldTitle) {
        await this.confirmRenameTopic(id, newTitle);
      } else {
        this.renderTopicList();
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  },

  async confirmRenameTopic(id, title) {
    if (id === this.currentTopicId && Chat.topic) {
      await Chat.renameTopic(title);
    } else {
      await Storage.renameTopic(id, title);
    }
    this.renderTopicList();
  },

  onTopicRenamed(topic) {
    if (topic.id === this.currentTopicId) {
      const titleEl = document.getElementById('topicTitle');
      if (titleEl) titleEl.textContent = topic.title;
    }
    this.renderTopicList();
  },

  async loadTopic(id) {
    // 生成中切换话题：先中止旧请求，防止旧回调污染新话题（B5）
    if (Chat.isGenerating && Chat.abort) Chat.abort();
    await Chat.init(id);
    this.currentTopicId = id;
    const titleEl = document.getElementById('topicTitle');
    if (titleEl) titleEl.textContent = Chat.topic?.title || (Chat.topic?.type === 'project' ? '工程任务会话' : '新对话');
    Chat.renderMessages();
    this.renderTopicList();
    this.updateCharCount();
  },

  /* ---------- 导出 ---------- */
  async exportConversation() {
    if (Chat.messages.length === 0) {
      this.showToast('没有可导出的对话', 'info');
      return;
    }

    let markdown = `# ${Chat.topic?.title || '对话记录'}\n\n`;
    markdown += `> 导出时间: ${new Date().toLocaleString('zh-CN')}\n\n---\n\n`;

    for (const msg of Chat.messages) {
      if (msg.role === 'user') {
        markdown += `## 我\n\n${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        markdown += `## MiMo\n\n${msg.content}\n\n`;
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          markdown += `\n<details><summary>工具调用</summary>\n\n`;
          for (const tc of msg.toolCalls) {
            markdown += `### ${tc.function?.name}\n\n\`\`\`json\n${tc.function?.arguments}\n\`\`\`\n\n`;
          }
          markdown += `</details>\n\n`;
        }
      } else if (msg.role === 'tool') {
        markdown += `\n> 工具返回\n\n\`\`\`json\n${msg.content}\n\`\`\`\n\n`;
      }
    }

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${Chat.topic?.title || 'mimo-conversation'}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('对话已导出', 'success');
  },

  /* ---------- Toast ---------- */
  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    // 触发动画
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  /* ---------- 工具 ---------- */
  fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
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
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  /* ---------- 模型列表自动拉取 ---------- */

  // 调用 /v1/models 刷新可用模型列表，合并进 App.remoteModels
  async refreshModelList(showToast = true) {
    if (!window.api.listModels && !window.MiMoAPI?.fetchModels) {
      if (showToast) this.showToast('当前不支持刷新模型列表', 'warn');
      return;
    }
    let result;
    try {
      result = window.MiMoAPI && MiMoAPI.fetchModels
        ? await MiMoAPI.fetchModels()
        : await window.api.listModels();
    } catch (e) {
      if (showToast) this.showToast('刷新失败: ' + e.message, 'error');
      return;
    }
    if (!result || !result.success) {
      if (showToast) this.showToast(result?.error || '刷新模型列表失败', 'error');
      return;
    }
    this.remoteModels = Array.isArray(result.models) ? result.models : [];
    this.syncModelDatalist();
    const count = this.remoteModels.length;
    if (showToast) {
      this.showToast(`已加载 ${count} 个可用模型`, count > 0 ? 'success' : 'warn');
    }
  },

  // 把已加载的模型同步到设置弹窗的自定义下拉列表
  syncModelDatalist() {
    const dl = document.getElementById('modelNameDropdown');
    if (!dl) return;
    const list = [];
    const seen = new Set();
    const pushUnique = (m) => {
      if (!m || !m.id || seen.has(m.id)) return;
      seen.add(m.id);
      list.push(m);
    };
    (this.remoteModels || []).forEach(pushUnique);
    (this.modelList || []).forEach(pushUnique);

    // 优先用输入框当前值判断 active（用户在设置里选了新模型但未保存时也能正确高亮）
    const inputEl = document.getElementById('modelName');
    const inputVal = inputEl ? inputEl.value.trim() : '';

    Storage.loadConfig().then(cfg => {
      if (cfg.model) pushUnique({ id: cfg.model, name: cfg.model });
      const current = inputVal || cfg.model || '';

      if (list.length === 0) {
        dl.innerHTML = `<div class="model-dropdown-empty">暂无可用模型，请先在顶栏下拉选择或点击"刷新模型列表"</div>`;
        return;
      }

      dl.innerHTML = list.map(m => `
        <div class="model-dropdown-item ${m.id === current ? 'active' : ''}" data-value="${this.escapeAttr(m.id)}">
          <span>${this.escapeHtml(m.name || m.id)}</span>
          ${m.id === current ? '<svg class="check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
        </div>
      `).join('');
    }).catch(() => {});
  },

  // 绑定设置弹窗里模型输入框的自定义下拉交互
  bindModelNameInput() {
    const input = document.getElementById('modelName');
    const dl = document.getElementById('modelNameDropdown');
    if (!input || !dl) return;

    // 用 fixed 定位显示下拉框到输入框下方
    const showDropdown = () => {
      this.syncModelDatalist();
      const rect = input.getBoundingClientRect();
      dl.style.top = (rect.bottom + 4) + 'px';
      dl.style.left = rect.left + 'px';
      dl.style.minWidth = rect.width + 'px';
      // 防止超出底部
      const dropdownH = 260;
      if (rect.bottom + dropdownH > window.innerHeight) {
        dl.style.top = (rect.top - dropdownH - 4) + 'px';
      }
      dl.classList.remove('hidden');
    };

    // 聚焦/点击输入框时显示下拉
    input.addEventListener('focus', () => showDropdown());
    input.addEventListener('click', (e) => {
      e.stopPropagation();
      showDropdown();
    });

    // 输入时过滤
    input.addEventListener('input', () => {
      const keyword = input.value.trim().toLowerCase();
      const items = dl.querySelectorAll('.model-dropdown-item');
      items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = (!keyword || text.includes(keyword)) ? '' : 'none';
      });
      showDropdown();
    });

    // 点击页面其他地方关闭
    document.addEventListener('click', (e) => {
      if (!dl.classList.contains('hidden') && !dl.contains(e.target) && e.target !== input) {
        dl.classList.add('hidden');
      }
    });

    // 滚动/resize 时关闭（避免悬空）
    const closeOnScroll = () => dl.classList.add('hidden');
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnScroll);

    // 点击下拉选项填充值，并立即刷新对勾
    dl.addEventListener('click', (e) => {
      const item = e.target.closest('.model-dropdown-item');
      if (item) {
        e.stopPropagation();
        input.value = item.dataset.value;
        // 重新渲染下拉列表，让对勾立即移到新选中项
        this.syncModelDatalist();
        dl.classList.add('hidden');
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
