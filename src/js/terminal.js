const Terminal = {
  outputEl: null,
  inputEl: null,
  cwdEl: null,
  followBtn: null,
  pauseBtn: null,
  followHint: null,
  history: [],
  historyIndex: -1,
  followOutput: true,  // 自动跟随输出
  pausedOutput: false, // 是否暂停接收输出

  init() {
    this.outputEl = document.getElementById('terminalOutput');
    this.inputEl = document.getElementById('terminalInput');
    this.cwdEl = document.getElementById('terminalCwd');
    this.followBtn = document.getElementById('terminalFollowBtn');
    this.pauseBtn = document.getElementById('terminalPauseBtn');
    this.followHint = document.getElementById('terminalFollowHint');

    if (!this.inputEl) return;

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.execute();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateHistory(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.navigateHistory(1);
      }
    });

    const sendBtn = document.getElementById('terminalSendBtn');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.execute());
    }

    const clearBtn = document.getElementById('terminalClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clear());
    }

    const copyBtn = document.getElementById('terminalCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => this.copyOutput());
    }

    // 暂停/恢复输出
    if (this.pauseBtn) {
      this.pauseBtn.addEventListener('click', () => this.togglePause());
    }

    // 切换自动跟随
    if (this.followBtn) {
      this.followBtn.addEventListener('click', () => this.toggleFollow());
    }

    // 点击底部提示恢复跟随
    if (this.followHint) {
      this.followHint.addEventListener('click', () => {
        this.setFollow(true);
        this.scrollToBottom();
      });
    }

    // 监听滚动：离底部较远时暂停跟随，滚回底部时恢复
    if (this.outputEl) {
      this.outputEl.addEventListener('scroll', () => {
        const distanceFromBottom = this.outputEl.scrollHeight - this.outputEl.scrollTop - this.outputEl.clientHeight;
        if (distanceFromBottom > 50) {
          if (this.followOutput) this.setFollow(false);
        } else {
          if (!this.followOutput && !this.pausedOutput) this.setFollow(true);
        }
      });
    }
  },

  setFollow(follow) {
    this.followOutput = follow;
    if (this.followBtn) {
      this.followBtn.classList.toggle('active', follow);
    }
  },

  toggleFollow() {
    this.setFollow(!this.followOutput);
    if (this.followOutput) this.scrollToBottom();
  },

  togglePause() {
    this.pausedOutput = !this.pausedOutput;
    if (this.pauseBtn) {
      this.pauseBtn.classList.toggle('active', !this.pausedOutput);
      this.pauseBtn.title = this.pausedOutput ? '恢复输出' : '暂停输出';
    }
    // 暂停时也停止跟随
    if (this.pausedOutput) {
      this.setFollow(false);
      if (this.followHint) this.followHint.style.display = 'flex';
    } else {
      if (this.followHint) this.followHint.style.display = 'none';
    }
    if (window.App && App.showToast) {
      App.showToast(this.pausedOutput ? '已暂停终端输出' : '已恢复终端输出', 'info');
    }
  },

  scrollToBottom() {
    if (this.outputEl) {
      this.outputEl.scrollTop = this.outputEl.scrollHeight;
    }
  },

  // 切换到终端 Tab（通过 RightPanel，避免循环依赖）
  show() {
    if (window.RightPanel) {
      // 检查终端是否被关闭
      const terminalTab = document.querySelector('.rp-tab-btn[data-rp-tab="terminal"]');
      if (terminalTab && terminalTab.classList.contains('hidden-tab')) {
        RightPanel.openTerminal();
      } else {
        RightPanel.showTab('terminal');
      }
    }
    if (this.inputEl) {
      setTimeout(() => this.inputEl.focus(), 50);
    }
  },

  hide() {
    if (window.RightPanel) {
      RightPanel.showTab('preview');
    }
  },

  toggle() {
    if (window.RightPanel && RightPanel.currentTab === 'terminal') {
      this.hide();
    } else {
      this.show();
    }
  },

  async execute() {
    if (this.pausedOutput) {
      if (window.App && App.showToast) App.showToast('终端输出已暂停，请先恢复', 'warn');
      return;
    }
    const command = this.inputEl.value.trim();
    if (!command) return;

    this.inputEl.value = '';
    this.history.push(command);
    this.historyIndex = -1;

    this.appendCommand(command);

    try {
      const result = await window.api.executeBash(command);
      if (result.stdout) {
        this.appendOutput(result.stdout, 'output');
      }
      if (result.stderr) {
        this.appendOutput(result.stderr, 'error');
      }
      if (result.blocked) {
        this.appendOutput('命令被项目权限白名单拦截', 'warn');
      }
      if (this.cwdEl) {
        this.cwdEl.textContent = result.cwd ? result.cwd.split(/[\\/]/).slice(-2).join('/') : '~';
      }
    } catch (e) {
      this.appendOutput(`执行失败: ${e.message}`, 'error');
    }
  },

  appendCommand(command) {
    const line = document.createElement('div');
    line.className = 'terminal-output-line command';
    line.textContent = command;
    this.outputEl.appendChild(line);
    if (this.followOutput) this.scrollToBottom();
  },

  appendOutput(text, type = 'output') {
    if (this.pausedOutput) return;
    const lines = text.split('\n');
    lines.forEach(line => {
      const el = document.createElement('div');
      el.className = `terminal-output-line ${type}`;
      el.textContent = line;
      this.outputEl.appendChild(el);
    });
    if (this.followOutput) this.scrollToBottom();
  },

  clear() {
    if (this.outputEl) this.outputEl.innerHTML = '';
  },

  copyOutput() {
    if (!this.outputEl) return;
    const text = this.outputEl.innerText;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        if (window.App && App.showToast) {
          App.showToast('终端输出已复制', 'success');
        }
      });
    }
  },

  navigateHistory(direction) {
    if (this.history.length === 0) return;

    if (direction === -1) {
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++;
        this.inputEl.value = this.history[this.historyIndex];
      }
    } else {
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.inputEl.value = this.history[this.historyIndex] || '';
      } else {
        this.historyIndex = -1;
        this.inputEl.value = '';
      }
    }
  }
};

window.Terminal = Terminal;
