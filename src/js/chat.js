const Chat = {
  topic: null,
  messages: [],
  isGenerating: false,
  _chatRequestId: null, // 当前流式请求 ID（用于停止生成）
  pendingToolCalls: [],
  onPermissionRequest: null,
  tokenUsed: 0,
  // Plan 模式（对标 Reasonix）：先出计划，批准后才继续执行工具
  planMode: false,
  _planApproved: false,
  _autoApproveTools: false, // 计划批准后的本轮工具自动放行窗口
  _generationId: 0, // 生成代际：切换话题/新会话后旧回调失效，防止数据污染

  async init(topicId = null) {
    // 重置生成状态（切换话题/新会话后，旧请求已 abort，代际 token 使其失效）
    this.isGenerating = false;
    this._chatRequestId = null;
    let loaded = false;
    if (topicId) {
      try {
        const topic = await Storage.loadTopic(topicId);
        if (topic) {
          this.topic = topic;
          this.messages = topic.messages || [];
          loaded = true;
        }
      } catch (e) {
        // 话题数据损坏/读取失败：回退到新会话，避免应用初始化中断
        console.warn('[Chat.init] 话题加载失败，回退到新会话:', e);
      }
    }
    if (!loaded) this.createNewTopic();
    this._lastDisplayToken = 0;
    this.recalcHistoryTokens();
    this.syncTokenDisplay();
  },

  createNewTopic(type = 'chat') {
    const isProject = type === 'project';
    this.topic = {
      id: this.generateId(),
      title: isProject ? '工程任务会话' : '新对话',
      type: type,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      titleSource: 'auto',
      autoTitleMeta: null,
      messages: []
    };
    this.messages = [];
    this.tokenUsed = 0;
    this._chatRequestId = null;
    this._lastDisplayToken = 0;
    this.renderMessages();
    this.syncTokenDisplay();
  },

  async save() {
    this.topic.messages = this.messages;
    this.topic.updatedAt = Date.now();
    return Storage.saveTopic(this.topic);
  },

  // 手动重命名话题（标记来源为 manual，清空自动标题元数据）
  async renameTopic(title) {
    if (!this.topic || !title) return;
    this.topic.title = title;
    this.topic.titleSource = 'manual';
    this.topic.autoTitleMeta = null;
    this.topic.updatedAt = Date.now();
    await Storage.saveTopic(this.topic);
    if (typeof App !== 'undefined' && App.onTopicRenamed) App.onTopicRenamed(this.topic);
  },

  // 计算首条用户消息的哈希（用于判断是否需要重新生成标题）
  firstMessageHash() {
    const first = this.messages.find(m => m.role === 'user');
    if (!first) return null;
    let s = String(first.content || '');
    if (s.length > 200) s = s.slice(0, 200);
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return String(h);
  },

  // 在合适的时机尝试自动生成 AI 标题（已手动重命名或已生成且首条未变则跳过）
  async maybeGenerateAutoTitle() {
    if (!this.topic || this.messages.length === 0) return;
    if (this.topic.titleSource === 'manual') return;
    const hash = this.firstMessageHash();
    const meta = this.topic.autoTitleMeta || {};
    if (meta.generated && meta.firstMessageHash === hash) return;
    await this.generateAutoTitle(hash);
  },

  // 调用 MiMo API 生成简短话题标题（失败回退到首条消息截断）
  async generateAutoTitle(hash) {
    const first = this.messages.find(m => m.role === 'user');
    if (!first) return;
    let promptText = String(first.content || '').replace(/\s+/g, ' ').trim();
    if (!promptText) return;
    // 快照发起时的话题 id：异步完成时若用户已切换话题，放弃写入（B19）
    const topicIdAtStart = this.topic ? this.topic.id : null;
    const stillCurrent = () => this.topic && this.topic.id === topicIdAtStart;

    try {
      const config = await Storage.loadConfig();
      if (!config.apiEndpoint || !config.apiKey) throw new Error('未配置 API');

      const result = await window.api.chat(
        [
          { role: 'system', content: '你是话题标题生成器。根据用户消息生成一个简短的话题标题，不超过15个字，不要加引号、标点或换行，直接输出标题文本。' },
          { role: 'user', content: promptText.slice(0, 500) }
        ],
        false,
        null
      );

      if (result.error) throw new Error(result.error);
      let title = '';
      const choice = result.choices?.[0];
      if (choice?.message?.content) {
        title = choice.message.content.replace(/[""''\n\r]+/g, '').trim();
      }
      if (!title) throw new Error('空标题');
      if (title.length > 30) title = title.slice(0, 30);
      if (!stillCurrent()) return; // 用户已切换话题，放弃写入

      this.topic.title = title;
      this.topic.titleSource = 'auto';
      this.topic.autoTitleMeta = {
        generated: true,
        firstMessageHash: hash,
        generatedAt: Date.now()
      };
      await Storage.saveTopic(this.topic);
      if (typeof App !== 'undefined' && App.onTopicRenamed) App.onTopicRenamed(this.topic);
    } catch (e) {
      if (!stillCurrent()) return; // 用户已切换话题，放弃写入
      // 回退：截断首条消息
      const fallback = promptText.slice(0, 30) || '新对话';
      this.topic.title = fallback;
      this.topic.titleSource = 'auto';
      this.topic.autoTitleMeta = { generated: true, firstMessageHash: hash, generatedAt: Date.now(), fallback: true };
      await Storage.saveTopic(this.topic);
      if (typeof App !== 'undefined' && App.onTopicRenamed) App.onTopicRenamed(this.topic);
    }
  },

  generateId() {
    return 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  },

  async sendMessage(content, attachments = []) {
    if (this.isGenerating) return;

    const config = await Storage.loadConfig();

    let userContent = content;
    if (attachments.length > 0) {
      const attachmentTexts = attachments.map(a => `[附件: ${a.name}]`).join(' ');
      userContent = `${content}\n\n${attachmentTexts}`;
    }

    this.messages.push({
      role: 'user',
      content: userContent,
      timestamp: Date.now(),
      attachments
    });

    // 历史过长时自动压缩（Reasonix compaction）：保留最近 2 轮对话，更早的压缩为摘要
    await this.maybeCompactHistory();

    // 记录本次生成是否处于计划模式（快照，避免切换状态污染进行中的请求）
    this._currentPlanMode = this.planMode;

    // 累加用户侧 token
    this.addTokens(userContent, false);

    // 增量追加用户消息，避免全量重渲染
    this.appendMessage(this.messages[this.messages.length - 1]);
    this.save();

    // 异步生成 AI 话题标题（不阻塞对话流程，后台调用 API）
    this.maybeGenerateAutoTitle();

    await this.generateResponse();
  },

  // 判断本次对话是否需要提供工具（基于最后一条用户消息的关键词启发式）
  shouldUseTools() {
    if (this._planApproved) return true; // 计划已批准：需要工具执行
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        const text = String(this.messages[i].content || '');
        if (text.startsWith('[') && text.includes(']')) continue; // 跳过系统注入消息
        const kws = [
          '命令', '执行', '运行', '文件', '目录', '代码', '创建', '修改', '编辑', '删除', '移动',
          '搜索', '查找', '编译', '安装', '启动', '脚本', '项目', '测试', '部署', '查看', '打开',
          'git', 'npm', 'node ', 'python', 'cd ', 'ls ', 'dir ', 'echo ', 'bash', '终端', '日志',
          'read ', 'write ', 'format', '格式化', '仓库', '依赖', '报错', '调试', '修复'
        ];
        return kws.some(k => text.toLowerCase().includes(k));
      }
    }
    return false;
  },

  async generateResponse() {
    if (this.isGenerating) return;
    this.isGenerating = true;
    this._lastDisplayToken = 0; // 重置节流基线

    const config = await Storage.loadConfig();
    const tools = MiMoAPI.buildToolsList(config.allowedTools || []);
    // 纯聊天/问答消息不提供工具，防止模型对"你好"等乱调工具（导致空回复/卡"思考中"）
    const useTools = tools.length > 0 && this.shouldUseTools();
    let systemPrompt = MiMoAPI.getSystemPrompt(config);
    // Plan 模式：注入规划指示（对标 Reasonix PlanModeMarker），批准后才进入执行
    if (this._currentPlanMode && !this._planApproved) {
      systemPrompt += '\n\n[Plan mode] 当前处于规划模式：本轮请先输出详细的分步计划（用列表列出步骤），不要直接执行修改性工具。计划会提交给用户审批，批准后才开始执行。';
    }

    const assistantMessage = {
      role: 'assistant',
      content: '',
      reasoning: '',
      timestamp: Date.now(),
      reasoningStartTime: Date.now(),
      reasoningEndTime: null,
      reasoningComplete: false,
      toolCalls: []
    };
    this.messages.push(assistantMessage);
    // 增量追加 assistant 消息占位
    this.appendMessage(assistantMessage);

    const contentIndex = this.messages.length - 1;

    try {
      // 本轮请求 ID：用于"停止生成"时通过主进程中止底层 fetch
      this._chatRequestId = 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      const genId = ++this._generationId; // 本代生成标记，旧回调据此失效

      let iteration = 0;
      const maxIterations = 15;
      let currentMsgIndex = contentIndex;

      while (iteration < maxIterations) {
        iteration++;

        let fullContent = '';
        let fullReasoning = '';
        let toolCalls = [];

        const result = await MiMoAPI.chat(
          [
            { role: 'system', content: systemPrompt },
            ...this.messages
          ],
          {
            tools: useTools ? tools : null,
            requestId: this._chatRequestId,
            onChunk: (chunk) => {
              if (genId !== this._generationId) return; // 旧代际回调丢弃
              fullContent += chunk;
              this.messages[currentMsgIndex].content = fullContent;
              this.addTokens(chunk, true);
              this.updateStreamingMessage(currentMsgIndex);
            },
            onReasoning: (chunk) => {
              if (genId !== this._generationId) return;
              fullReasoning += chunk;
              this.messages[currentMsgIndex].reasoning = fullReasoning;
              this.addTokens(chunk, true);
              this.updateStreamingMessage(currentMsgIndex);
            },
            onToolCall: (tcs) => {
              if (genId !== this._generationId) return;
              toolCalls = tcs;
              this.messages[currentMsgIndex].toolCalls = toolCalls;
              this.renderSingleMessage(currentMsgIndex);
            }
          }
        );

        // 清理 IPC 监听器，防止泄漏
        if (result.cleanup) result.cleanup();

        // 用户点了"停止"：保留已生成的内容，结束本轮（不再继续工具调用）
        if (result.aborted) {
          this.messages[currentMsgIndex].content += '\n\n⏹️ 已停止生成';
          this.renderSingleMessage(currentMsgIndex);
          this.save();
          break;
        }

        // ===== Plan 模式门禁（对标 Reasonix）：第一轮回复后等待用户批准计划 =====
        if (this._currentPlanMode && iteration === 1 && !this._planApproved) {
          const proposal = this.messages[currentMsgIndex].content || '';
          const decision = await this.requestPlanApproval(proposal);
          if (decision === 'approved') {
            this._planApproved = true;
            this._autoApproveTools = true; // 本轮回剩余工具调用自动放行
            // 批准后若本轮无工具调用：注入"已批准"提示，让模型开始执行
            if (!result.toolCalls || result.toolCalls.length === 0) {
              const goMsg = {
                role: 'user',
                content: '[计划已获批准。请立即开始执行计划中的步骤。]',
                timestamp: Date.now()
              };
              this.messages.push(goMsg);
              this.appendMessage(goMsg);
              const iterAssistantMsg = {
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                reasoningStartTime: Date.now(),
                reasoningEndTime: null,
                reasoningComplete: false,
                toolCalls: []
              };
              this.messages.push(iterAssistantMsg);
              this.appendMessage(iterAssistantMsg);
              currentMsgIndex = this.messages.length - 1;
              continue;
            }
            // 有工具调用：直接进入下方执行（本轮工具自动放行）
          } else if (decision === 'revise') {
            this.planMode = true; // 保持计划模式，等用户下一条消息修改计划
            this.messages[currentMsgIndex].content += '\n\n⏸️ 计划未批准。请根据用户反馈修改计划后重新提交。';
            this.renderSingleMessage(currentMsgIndex);
            this.save();
            break;
          } else {
            // exit：退出计划模式，不执行
            this.planMode = false;
            this.messages[currentMsgIndex].content += '\n\n⏹️ 已退出计划模式（计划未执行）。';
            this.renderSingleMessage(currentMsgIndex);
            this.save();
            break;
          }
        }

        this.messages[currentMsgIndex].content = result.content || fullContent;
        this.messages[currentMsgIndex].reasoning = result.reasoning || fullReasoning;
        // 工具调用以流式收到的为准（result.toolCalls 可能因最终帧为空而丢失，导致工具不执行 + 消息残留 toolCalls）
        const finalToolCalls = (Array.isArray(toolCalls) && toolCalls.length > 0) ? toolCalls : (result.toolCalls || []);
        this.messages[currentMsgIndex].toolCalls = finalToolCalls;
        // 标记本轮思考完成，自动折叠 reasoning
        if (!this.messages[currentMsgIndex].reasoningComplete) {
          this.messages[currentMsgIndex].reasoningComplete = true;
          this.messages[currentMsgIndex].reasoningEndTime = Date.now();
          this.collapseReasoning(currentMsgIndex);
        }

        if (!finalToolCalls || finalToolCalls.length === 0) {
          // 清理消息中残留的未执行 toolCalls，避免下一轮请求出现 assistant 带 tool_calls 而无 tool 消息
          // 导致 API 400 "tool_call_id is not set"（Reasonix：tool_calls 必须与 tool 消息成对）
          if (this.messages[currentMsgIndex].toolCalls && this.messages[currentMsgIndex].toolCalls.length > 0) {
            this.messages[currentMsgIndex].toolCalls = [];
          }
          break;
        }

        const toolResults = await this.executeToolCalls(finalToolCalls);
        if (toolResults.length === 0) break;

        for (const tc of finalToolCalls) {
          const resultItem = toolResults.find(r => r.toolCallId === tc.id);
          const toolMsg = {
            role: 'tool',
            // 防止双重 stringify：_executeWithRetry 返回的 content 已是 JSON 字符串
            content: (resultItem && typeof resultItem.content === 'string') ? resultItem.content : JSON.stringify(resultItem || { error: '执行失败' }),
            toolCallId: tc.id,
            timestamp: Date.now()
          };
          this.messages.push(toolMsg);
          // 增量追加工具返回结果
          this.appendMessage(toolMsg);
        }

        // 准备下一轮迭代的 assistant 消息
        const iterAssistantMsg = {
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          reasoningStartTime: Date.now(),
          reasoningEndTime: null,
          reasoningComplete: false,
          toolCalls: []
        };
        this.messages.push(iterAssistantMsg);
        this.appendMessage(iterAssistantMsg);
        currentMsgIndex = this.messages.length - 1;
      }

      // 完成后做一次完整渲染（确保 markdown 完整解析 + 最终状态）
      // 空回复占位：模型未输出内容时给用户明确提示，而不是静默空白
      const lastMsg = this.messages[currentMsgIndex];
      if (lastMsg && !lastMsg.content && (!lastMsg.toolCalls || lastMsg.toolCalls.length === 0)) {
        lastMsg.content = '（模型未输出内容，可能是推理超时或被中断，请重试或点击停止后重发）';
      }
      this.renderSingleMessage(currentMsgIndex);

      // 如果 AI 没调用工具但回复中包含 HTML 代码块，自动预览
      this._autoPreviewHtmlFromContent(currentMsgIndex);

      this.save();
    } catch (e) {
      console.error('生成失败:', e);
      this.messages[currentMsgIndex].content += `\n\n⚠️ 生成出错: ${e.message}`;
      this.renderSingleMessage(currentMsgIndex);
    } finally {
      const isCurrentGen = genId === this._generationId;
      this.isGenerating = false;
      this._chatRequestId = null; // 清理请求 ID，停止按钮不再生效
      this._currentPlanMode = false;
      this._planApproved = false;
      this._autoApproveTools = false;
      // 重新计算准确的 token 总数（包含输入+输出）
      this.recalcHistoryTokens();
      this.syncTokenDisplay();
      // 只有最新代际才保存并恢复 UI（旧代际被新话题替换时不写脏数据）
      if (isCurrentGen) {
        this.save();
        if (window.App && App.onGenerationEnd) App.onGenerationEnd();
      }
    }
  },

  // 中止当前生成（通过主进程中止底层 fetch）
  abort() {
    if (this._chatRequestId && window.api.abortChat) {
      window.api.abortChat(this._chatRequestId);
    }
  },

  // Plan 模式：弹出计划审批卡（批准执行 / 修改计划 / 退出计划模式）
  requestPlanApproval(proposal) {
    return new Promise((resolve) => {
      const modal = document.getElementById('planApprovalModal');
      const textEl = document.getElementById('planApprovalText');
      const approveBtn = document.getElementById('planApproveBtn');
      const reviseBtn = document.getElementById('planReviseBtn');
      const exitBtn = document.getElementById('planExitBtn');
      if (!modal || !textEl) return resolve('exit');
      textEl.innerHTML = this.formatMarkdown(proposal || '（未生成计划文本）');
      const done = (d) => {
        modal.classList.add('hidden');
        approveBtn.onclick = null;
        reviseBtn.onclick = null;
        exitBtn.onclick = null;
        resolve(d);
      };
      approveBtn.onclick = () => done('approved');
      reviseBtn.onclick = () => done('revise');
      exitBtn.onclick = () => done('exit');
      modal.classList.remove('hidden');
    });
  },

  // 切换计划模式（由顶栏按钮调用）
  togglePlanMode() {
    this.planMode = !this.planMode;
    this._planApproved = false;
    this._autoApproveTools = false;
    return this.planMode;
  },

  // 自动从 AI 回复内容中提取 HTML 代码块并预览
  _autoPreviewHtmlFromContent(msgIndex) {
    const msg = this.messages[msgIndex];
    if (!msg || !msg.content) return;

    // 如果这一轮已经有工具调用执行了（file_write 等），就不需要再提取
    if (msg.toolCalls && msg.toolCalls.length > 0) return;

    // 提取 ```html ... ``` 代码块
    const htmlMatch = msg.content.match(/```html\s*\n([\s\S]*?)```/i);
    if (htmlMatch && htmlMatch[1]) {
      const htmlContent = htmlMatch[1].trim();
      // 只对完整的 HTML 文档自动预览（包含 <html 或 <!DOCTYPE）
      if (htmlContent.includes('<html') || htmlContent.includes('<!DOCTYPE') || htmlContent.includes('<body')) {
        const fileName = `preview-${Date.now()}.html`;
        console.log('[AutoPreview] 从回复中提取到 HTML 代码块，自动预览:', fileName);
        if (window.RightPanel) {
          RightPanel.previewFile(fileName, htmlContent);
        }
      }
    }
  },

  async executeToolCalls(toolCalls) {
    // Reasonix 模式：分区执行（只读并行 + 写入串行）+ 依赖屏障
    const validCalls = toolCalls.filter(tc => tc.id && tc.function);
    if (validCalls.length === 0) return [];

    // 解析所有工具调用的参数
    const parsed = validCalls.map(tc => {
      const funcName = tc.function.name;
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }

      // 参数别名兼容
      const resolvedArgs = {
        path: args.path || args.file_path || args.filePath || args.filename || args.fileName || '',
        content: args.content || args.file_content || args.fileContent || '',
        command: args.command || args.cmd || '',
        old_string: args.old_string || args.oldString || args.search || args.find || '',
        new_string: args.new_string || args.newString || args.replace || args.replacement || '',
        cwd: args.cwd || args.working_dir || args.workingDir || undefined,
        pattern: args.pattern || args.query || '',
        url: args.url || args.uri || '',
        source: args.source || args.src || '',
        destination: args.destination || args.dest || '',
        edits: Array.isArray(args.edits) ? args.edits : (Array.isArray(args.changes) ? args.changes : []),
        start_anchor: args.start_anchor || args.startAnchor || '',
        end_anchor: args.end_anchor || args.endAnchor || '',
        questions: Array.isArray(args.questions) ? args.questions : []
      };

      return { tc, funcName, args: resolvedArgs };
    });

    // 分区：只读工具可并行，写入工具串行
    const readOnly = (name) => PermissionEngine.isReadOnlyTool(name);
    const mutating = (name) => ['bash', 'file_write', 'file_edit', 'multi_edit', 'delete_range', 'move_file'].includes(name);

    const batches = [];
    for (let i = 0; i < parsed.length;) {
      if (readOnly(parsed[i].funcName)) {
        const start = i;
        while (i < parsed.length && readOnly(parsed[i].funcName)) i++;
        batches.push({ start, end: i, parallel: true });
      } else {
        batches.push({ start: i, end: i + 1, parallel: false });
        i++;
      }
    }

    const results = new Array(parsed.length);
    let mutationBarrier = false; // 依赖屏障：写入失败后阻止后续写入
    let recoveryStop = false; // 恢复停止：超过最大失败次数

    for (const batch of batches) {
      if (recoveryStop) {
        // 填充剩余的 blocked 结果
        for (let i = batch.start; i < batch.end; i++) {
          const blockedMsg = 'blocked: 自动恢复已暂停本轮工具调用。请在下一条消息中继续。';
          results[i] = { toolCallId: parsed[i].tc.id, content: JSON.stringify({ error: blockedMsg, blocked: true }) };
        }
        continue;
      }

      if (mutationBarrier && batch.parallel === false) {
        // 依赖屏障：跳过写入工具
        for (let i = batch.start; i < batch.end; i++) {
          const blockedMsg = 'blocked: 因为本批次中较早的修改操作失败或被阻止，此工具被跳过。请先修复失败的更改。';
          results[i] = { toolCallId: parsed[i].tc.id, content: JSON.stringify({ error: blockedMsg, blocked: true }) };
          if (window.ToolLogger) {
            ToolLogger.log(parsed[i].funcName, parsed[i].args, { error: blockedMsg }, 0);
          }
        }
        continue;
      }

      if (batch.parallel && batch.end - batch.start > 1) {
        // 并行执行只读批次（最多 8 个并发）
        const maxParallel = 8;
        const slice = parsed.slice(batch.start, batch.end);
        const parallelResults = await Promise.all(
          slice.slice(0, maxParallel).map(async (item, idx) => {
            return { idx: batch.start + idx, result: await this._executeWithRetry(item) };
          })
        );
        for (const { idx, result } of parallelResults) {
          results[idx] = result;
        }
      } else {
        // 串行执行写入批次
        for (let i = batch.start; i < batch.end; i++) {
          const result = await this._executeWithRetry(parsed[i]);
          results[i] = result;

          // 检查是否需要触发依赖屏障
          try {
            const parsed_result = JSON.parse(result.content);
            if (parsed_result.error || parsed_result.blocked) {
              mutationBarrier = true;
              console.warn(`[Dependency Barrier] ${parsed[i].funcName} 失败，后续写入工具将被跳过`);
            }
          } catch {}

          // 检查恢复停止条件
          if (window.ToolLogger && ToolLogger.getCount() >= 10) {
            recoveryStop = true;
            console.warn('[Recovery Stop] 失败次数过多，停止本轮工具调用');
          }
        }
      }
    }

    return results;
  },

  // 单个工具的执行+重试逻辑（Reasonix executeOne 模式）
  async _executeWithRetry(parsedItem) {
    const { tc, funcName, args: resolvedArgs } = parsedItem;

    // 路径参数检查
    if (['file_read', 'file_write', 'file_edit'].includes(funcName) && !resolvedArgs.path) {
      const errResult = { error: '缺少路径参数（path）', hint: '请提供文件路径，支持 path/file_path/filename 等字段名' };
      if (window.ToolLogger) ToolLogger.log(funcName, resolvedArgs, errResult, 0);
      return { toolCallId: tc.id, content: JSON.stringify(errResult) };
    }

    // 权限检查（Ask/Auto/YOLO 姿态 + deny/ask/allow 规则引擎，对标 Reasonix）
    // 计划批准后的本轮执行窗口：跳过 ask 弹窗，但 deny 规则仍生效
    const decision = window.PermissionEngine ? PermissionEngine.decide(funcName, resolvedArgs) : 'ask';
    if (decision === 'deny') {
      const errResult = { error: '操作被权限规则拒绝（deny）', blocked: true };
      if (window.ToolLogger) ToolLogger.log(funcName, resolvedArgs, errResult, 0);
      return { toolCallId: tc.id, content: JSON.stringify(errResult) };
    }
    if (decision === 'ask' && this.onPermissionRequest && !this._autoApproveTools) {
      const granted = await this.onPermissionRequest(funcName, resolvedArgs);
      if (!granted) {
        const errResult = { error: '用户拒绝了权限请求', blocked: true };
        if (window.ToolLogger) ToolLogger.log(funcName, resolvedArgs, errResult, 0);
        return { toolCallId: tc.id, content: JSON.stringify(errResult) };
      }
    }

    // 执行工具（最多 3 次尝试）
    const maxAttempts = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this._executeSingleTool(funcName, resolvedArgs, attempt);

        // 判断成功/失败
        const hasError = result.error || result.blocked || (result.exitCode !== undefined && result.exitCode !== 0);

        if (window.ToolLogger) {
          ToolLogger.log(funcName, resolvedArgs, hasError ? result : { success: true }, attempt);
        }

        // 成功直接返回
        if (!hasError) {
          return { toolCallId: tc.id, content: JSON.stringify(result) };
        }

        // 失败：如果是可恢复错误，重试
        const fakeError = new Error(result.error || result.stderr || `exitCode: ${result.exitCode}`);
        const recoverable = this._isRecoverableError(fakeError, funcName);
        lastError = fakeError;

        if (!recoverable || attempt >= maxAttempts) {
          // 不可恢复或已用完重试次数：返回结构化错误
          const structuredError = this._structureError(fakeError, funcName, resolvedArgs);
          if (window.ToolLogger) {
            const summary = ToolLogger.getFailureSummary();
            if (summary) structuredError.failureLog = summary;
          }
          return { toolCallId: tc.id, content: JSON.stringify(structuredError) };
        }

        // 等待后重试
        await new Promise(r => setTimeout(r, 300 * attempt));
      } catch (e) {
        lastError = e;
        if (window.ToolLogger) {
          ToolLogger.log(funcName, resolvedArgs, { error: e.message || String(e) }, attempt);
        }

        const recoverable = this._isRecoverableError(e, funcName);
        if (!recoverable || attempt >= maxAttempts) {
          const structuredError = this._structureError(e, funcName, resolvedArgs);
          if (window.ToolLogger) {
            const summary = ToolLogger.getFailureSummary();
            if (summary) structuredError.failureLog = summary;
          }
          return { toolCallId: tc.id, content: JSON.stringify(structuredError) };
        }

        await new Promise(r => setTimeout(r, 300 * attempt));
      }
    }

    // 所有重试均失败
    const structuredError = this._structureError(lastError, funcName, resolvedArgs);
    if (window.ToolLogger) {
      const summary = ToolLogger.getFailureSummary();
      if (summary) structuredError.failureLog = summary;
    }
    return { toolCallId: tc.id, content: JSON.stringify(structuredError) };
  },

  _executeSingleTool(funcName, args, attempt) {
    switch (funcName) {
      case 'bash':
        return this.executeBash(args.command, args.cwd, attempt);
      case 'file_read':
        return this.executeFileRead(args.path);
      case 'file_write':
        return this.executeFileWrite(args.path, args.content);
      case 'file_edit':
        return this.executeFileEdit(args.path, args.old_string, args.new_string);
      case 'multi_edit':
        return this.executeMultiEdit(args.path, args.edits);
      case 'delete_range':
        return this.executeDeleteRange(args.path, args.start_anchor, args.end_anchor);
      case 'move_file':
        return this.executeMove(args.source, args.destination);
      case 'glob':
        return this.executeGlob(args.pattern);
      case 'grep':
        return this.executeGrep(args.pattern, args.path, args.maxResults);
      case 'web_fetch':
        return this.executeWebFetch(args.url);
      case 'ask':
        return this.executeAsk(args.questions);
      default:
        return { error: `未知工具: ${funcName}` };
    }
  },

  // 判断错误是否可恢复（值得重试）
  _isRecoverableError(error, funcName) {
    const msg = (error.message || String(error)).toLowerCase();
    // 临时性错误：网络超时、资源占用、端口冲突等
    const recoverablePatterns = [
      'timeout', 'timed out', 'etimedout',
      'eaddrinuse', 'address already in use', 'port',
      'econnreset', 'econnrefused', 'connection',
      'temporary', 'retry', 'resource',
      'busy', 'locked', 'permission denied',
      'enoent', 'not found', 'no such file',
      'shell', 'spawn',
      'is not a function', 'not available'  // API 未就绪
    ];
    return recoverablePatterns.some(p => msg.includes(p));
  },

  // 结构化错误信息，让 AI 能更好地分析和修复
  _structureError(error, funcName, args) {
    const errMsg = error.message || String(error);

    // 错误类型分类
    let errorType = 'unknown';
    let suggestion = '';

    if (errMsg.includes('is not a function') || errMsg.includes('not available')) {
      errorType = 'api_unavailable';
      suggestion = '工具 API 暂时不可用，可能需要重启应用或检查 Electron preload 脚本是否加载成功';
    } else if (errMsg.includes('ENOENT') || errMsg.includes('not found')) {
      errorType = 'file_not_found';
      suggestion = `文件路径不存在: ${args.path}，请检查路径是否正确`;
    } else if (errMsg.includes('EACCES') || errMsg.includes('permission')) {
      errorType = 'permission_denied';
      suggestion = '权限不足，请尝试在有权限的目录下执行';
    } else if (errMsg.includes('EADDRINUSE') || errMsg.includes('port')) {
      errorType = 'port_in_use';
      suggestion = '端口被占用，请换一个端口或先关闭占用进程';
    } else if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
      errorType = 'timeout';
      suggestion = '命令执行超时，可能是命令本身需要交互或执行时间过长';
    } else if (errMsg.includes('shell') || errMsg.includes('spawn')) {
      errorType = 'shell_error';
      suggestion = 'Shell 执行失败，可能是系统不支持该命令或命令不存在';
    } else if (errMsg.includes('路径越界') || errMsg.includes('outside')) {
      errorType = 'path_security';
      suggestion = '路径超出工作区范围，只能操作项目目录内的文件';
    } else if (errMsg.includes('blocked') || errMsg.includes('白名单')) {
      errorType = 'blocked_by_whitelist';
      suggestion = '命令被项目安全策略拦截，需要在 .mimo/permissions.json 中添加到白名单';
    }

    return {
      error: errMsg,
      errorType,
      tool: funcName,
      args: funcName === 'bash' ? args.command : (args.path || args),
      suggestion,
      recoverable: false,
      help: this._getToolHelp(funcName)
    };
  },

  _getToolHelp(funcName) {
    const helps = {
      bash: '参数: { command: "命令", cwd?: "工作目录" }。Windows 用 cmd 命令，Linux/Mac 用 bash 命令',
      file_read: '参数: { path: "文件路径" }。读取文件内容，返回 UTF-8 文本',
      file_write: '参数: { path: "文件路径", content: "文件内容" }。创建或覆盖文件',
      file_edit: '参数: { path: "文件路径", old_string: "原字符串", new_string: "新字符串" }。精确替换文件中的字符串'
    };
    return helps[funcName] || '';
  },

  async executeBash(command, cwd, attempt = 1) {
    // 注册实时输出监听器（带降级处理）
    let offBashOutput = null;
    const supportsRealtime = typeof window.api.onBashOutput === 'function';

    if (window.Terminal && supportsRealtime) {
      Terminal.appendCommand(command);
      offBashOutput = window.api.onBashOutput((data) => {
        if (data.type === 'stdout') {
          Terminal.appendOutput(data.content, 'output');
        } else if (data.type === 'stderr') {
          Terminal.appendOutput(data.content, 'error');
        }
      });
    } else if (window.Terminal) {
      // 降级：不支持实时输出时，仍显示命令
      Terminal.appendCommand(command);
    }

    try {
      const result = await window.api.executeBash(command, cwd);

      // 非实时模式：将完整输出追加到终端
      if (window.Terminal && !supportsRealtime && result) {
        if (result.stdout) Terminal.appendOutput(result.stdout, 'output');
        if (result.stderr) Terminal.appendOutput(result.stderr, 'error');
      }

      return {
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 8000),
        stderr: result.stderr.slice(0, 4000),
        cwd: result.cwd,
        blocked: result.blocked || false
      };
    } catch (e) {
      // 重试时，如果是 API 不可用错误，抛出让重试逻辑处理
      if (attempt < 3 && (e.message?.includes('not a function') || e.message?.includes('not available'))) {
        throw e;
      }
      // 其他错误直接返回
      return {
        exitCode: -1,
        error: e.message || String(e),
        stdout: '',
        stderr: e.message || String(e),
        cwd: cwd || ''
      };
    } finally {
      if (offBashOutput) {
        try { offBashOutput(); } catch (_) {}
      }
    }
  },

  async executeFileRead(path) {
    const result = await window.api.readFile(path);
    if (result.error) return { error: result.error };

    // 读取后自动预览（非二进制，代码文件）
    if (window.RightPanel) {
      RightPanel.previewFile(result.path || path, result.content);
    }

    return { path: result.path, content: result.content.slice(0, 50000) };
  },

  async executeFileWrite(path, content) {
    console.log('[executeFileWrite] 开始写入:', path, '内容长度:', content?.length);
    const result = await window.api.writeFile(path, content);
    console.log('[executeFileWrite] 写入结果:', result);
    if (result.error) return { error: result.error };

    // 写入成功后自动预览
    if (window.RightPanel) {
      console.log('[executeFileWrite] 触发预览:', result.path || path);
      RightPanel.previewFile(result.path || path, content);
    } else {
      console.warn('[executeFileWrite] RightPanel 不存在');
    }

    // 刷新文件树
    if (window.Filesystem && typeof Filesystem.refresh === 'function') {
      try { await Filesystem.refresh(); } catch (_) {}
    }

    return { success: true, path: result.path };
  },

  async executeFileEdit(path, oldString, newString) {
    const readResult = await window.api.readFile(path);
    if (readResult.error) return { error: readResult.error };

    if (!readResult.content.includes(oldString)) {
      return { error: '找不到要替换的字符串' };
    }

    const newContent = readResult.content.replace(oldString, newString);
    const writeResult = await window.api.writeFile(path, newContent);
    if (writeResult.error) return { error: writeResult.error };

    // 编辑后自动预览
    if (window.RightPanel) {
      RightPanel.previewFile(writeResult.path || path, newContent);
    }

    // 刷新文件树
    if (window.Filesystem && typeof Filesystem.refresh === 'function') {
      try { await Filesystem.refresh(); } catch (_) {}
    }

    return { success: true, path: writeResult.path };
  },

  // ===== 扩展工具（Reasonix 风格） =====

  async executeMultiEdit(path, edits) {
    if (!path || !Array.isArray(edits) || edits.length === 0) {
      return { error: '缺少参数（path/edits），edits 需为 [{old_string,new_string}] 数组' };
    }
    const readResult = await window.api.readFile(path);
    if (readResult.error) return { error: readResult.error };
    let content = readResult.content;
    let applied = 0;
    for (const ed of edits) {
      const oldS = ed && (ed.old_string !== undefined ? ed.old_string : ed.oldString);
      const newS = ed && (ed.new_string !== undefined ? ed.new_string : ed.newString);
      if (oldS === undefined || oldS === null || oldS === '') {
        return { error: `edits 第 ${applied + 1} 项缺少非空 old_string，全部未提交` };
      }
      const count = content.split(oldS).length - 1;
      if (count === 0) return { error: `edits 第 ${applied + 1} 项找不到 old_string，全部未提交` };
      if (count > 1) return { error: `edits 第 ${applied + 1} 项 old_string 匹配 ${count} 处，需唯一匹配，全部未提交` };
      content = content.replace(oldS, newS);
      applied++;
    }
    const writeResult = await window.api.writeFile(path, content);
    if (writeResult.error) return { error: writeResult.error };
    if (window.RightPanel) RightPanel.previewFile(writeResult.path || path, content);
    if (window.Filesystem && typeof Filesystem.refresh === 'function') {
      try { await Filesystem.refresh(); } catch (_) {}
    }
    return { success: true, applied, path: writeResult.path };
  },

  async executeDeleteRange(path, startAnchor, endAnchor) {
    if (!path || !startAnchor || !endAnchor) {
      return { error: '缺少参数（path/start_anchor/end_anchor）' };
    }
    const readResult = await window.api.readFile(path);
    if (readResult.error) return { error: readResult.error };
    const lines = readResult.content.split('\n');
    const findLines = (text) => {
      const idxs = [];
      lines.forEach((l, i) => { if (l.includes(text)) idxs.push(i); });
      return idxs;
    };
    const startIdxs = findLines(startAnchor);
    const endIdxs = findLines(endAnchor);
    if (startIdxs.length !== 1) return { error: `start_anchor 需唯一匹配，实际 ${startIdxs.length} 处` };
    if (endIdxs.length !== 1) return { error: `end_anchor 需唯一匹配，实际 ${endIdxs.length} 处` };
    const s = startIdxs[0];
    const e = endIdxs[0];
    if (s > e) return { error: 'start_anchor 位于 end_anchor 之后' };
    const newContent = [...lines.slice(0, s), ...lines.slice(e + 1)].join('\n');
    const writeResult = await window.api.writeFile(path, newContent);
    if (writeResult.error) return { error: writeResult.error };
    if (window.RightPanel) RightPanel.previewFile(writeResult.path || path, newContent);
    if (window.Filesystem && typeof Filesystem.refresh === 'function') {
      try { await Filesystem.refresh(); } catch (_) {}
    }
    return { success: true, deletedLines: e - s + 1, path: writeResult.path };
  },

  async executeMove(source, destination) {
    if (!source || !destination) return { error: '缺少参数（source/destination）' };
    const result = await window.api.movePath(source, destination);
    if (result.error) return { error: result.error };
    if (window.Filesystem && typeof Filesystem.refresh === 'function') {
      try { await Filesystem.refresh(); } catch (_) {}
    }
    return { success: true, moved: `${source} -> ${destination}` };
  },

  async executeGlob(pattern) {
    if (!pattern) return { error: '缺少参数（pattern）' };
    const result = await window.api.glob(pattern);
    if (result.error) return { error: result.error };
    return { matches: result.matches, count: result.matches.length };
  },

  async executeGrep(pattern, path, maxResults) {
    if (!pattern) return { error: '缺少参数（pattern）' };
    const result = await window.api.grep(pattern, path, maxResults);
    if (result.error) return { error: result.error };
    return { results: result.results, count: result.results.length };
  },

  async executeWebFetch(url) {
    if (!url) return { error: '缺少参数（url）' };
    const result = await window.api.webFetch(url);
    if (result.error) return { error: result.error };
    return { status: result.status, url: result.url, content: result.content };
  },

  // ask：向用户提问（Reasonix 问答卡），等待用户选择后把答案文本返回给模型
  async executeAsk(questions) {
    if (!Array.isArray(questions) || questions.length === 0) return { error: '缺少参数（questions）' };
    const qs = questions.slice(0, 4).map(q => ({
      header: (q && q.header) || '问题',
      question: (q && q.question) || '',
      options: ((q && q.options) || []).slice(0, 4).map(o => (typeof o === 'string' ? o : String((o && (o.label !== undefined ? o.label : o)) || '')))
    })).filter(q => q.question && q.options.length >= 2);
    if (qs.length === 0) return { error: '每个问题至少需要 2 个选项' };
    if (window.App && typeof App.askUser === 'function') {
      const answers = await App.askUser(qs);
      if (!answers) {
        return { note: '用户跳过了提问，请停止当前任务并等待用户下一条指令。' };
      }
      const lines = answers.map((a, i) => `问题 ${i + 1}【${qs[i].header}】: ${a}`).join('\n');
      return { answers: lines };
    }
    return { error: '问答界面不可用' };
  },

  renderMessages() {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    if (this.messages.length === 0) {
      container.innerHTML = this.renderWelcome();
      return;
    }

    container.innerHTML = this.messages.map((msg, idx) => {
      if (msg.role === 'tool') {
        return this.renderToolResult(msg, idx);
      }
      return this.renderMessage(msg, idx);
    }).join('');

    container.scrollTop = container.scrollHeight;
    this.bindCodeActions();
    this.detectPlan();
  },

  // 增量追加单条消息到 DOM（避免全量重渲染导致的闪烁和滚动重置）
  appendMessage(msg) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    // 清空欢迎屏
    const welcome = container.querySelector('.welcome-screen');
    if (welcome) container.innerHTML = '';

    const idx = this.messages.indexOf(msg);
    const html = msg.role === 'tool'
      ? this.renderToolResult(msg, idx)
      : this.renderMessage(msg, idx);

    const temp = document.createElement('div');
    temp.innerHTML = html;
    const el = temp.firstElementChild;
    if (!el) return;

    container.appendChild(el);

    // 滚动到底部（保存当前位置，追加后自然滚动）
    container.scrollTop = container.scrollHeight;

    // 绑定新元素的事件
    this.bindCodeActions();
  },

  // 流式增量更新：只更新指定索引的消息，避免重建整个列表导致闪烁
  // 使用 requestAnimationFrame 节流，避免每个 chunk 都操作 DOM
  updateStreamingMessage(index) {
    // rAF 节流：同一帧内只处理最后一次更新
    if (this._pendingStreamingIndex === index && this._streamingRafId) return;
    this._pendingStreamingIndex = index;

    const doUpdate = () => {
      this._streamingRafId = null;
      const idx = this._pendingStreamingIndex;
      this._pendingStreamingIndex = null;
      this._doUpdateStreamingMessage(idx);
    };

    if (this._streamingRafId) return; // 已在等待 rAF
    this._streamingRafId = requestAnimationFrame(doUpdate);
  },

  _doUpdateStreamingMessage(index) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const msg = this.messages[index];
    if (!msg) return;

    const targetEl = container.querySelector(`[data-msg-index="${index}"]`);
    if (!targetEl) {
      // 元素不存在，回退到全量渲染（仅首次）
      this.renderMessages();
      return;
    }

    const contentEl = targetEl.querySelector('.message-content');
    if (!contentEl) return;

    // 1. 更新文本内容（流式用 textContent，避免频繁 markdown 解析）
    const textEl = contentEl.querySelector('.message-text');
    if (textEl) {
      textEl.textContent = msg.content || '';
    }

    // 2. 更新/插入 reasoning 块
    const existingReasoning = contentEl.querySelector('.reasoning');
    const reasoningText = msg.reasoning || '';
    const hasReasoning = !!reasoningText.trim();

    if (hasReasoning) {
      if (existingReasoning) {
        const reasoningBodyEl = existingReasoning.querySelector('.reasoning__body');
        if (reasoningBodyEl) reasoningBodyEl.textContent = reasoningText;
        // 运行中自动展开
        if (this.isGenerating && !msg.reasoningComplete) {
          existingReasoning.classList.add('reasoning--open');
          existingReasoning.setAttribute('data-running', '');
          const labelEl = existingReasoning.querySelector('.reasoning__label');
          if (labelEl && labelEl.childNodes[0]) {
            const statusSpan = labelEl.querySelector('.reasoning__status');
            if (statusSpan) statusSpan.textContent = '思考中';
          }
        }
      } else if (msg.role !== 'user') {
        // 新增 reasoning 块（只插入 DOM 元素，不做全量替换）
        const reasoningHtml = this.renderReasoningBlock(msg);
        const temp = document.createElement('div');
        temp.innerHTML = reasoningHtml;
        const reasoningEl = temp.firstElementChild;
        if (reasoningEl && textEl) {
          contentEl.insertBefore(reasoningEl, textEl);
        }
      }
    }

    // 3. 更新/插入 tool-calls 块
    const existingToolCalls = contentEl.querySelector('.tool-calls');
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      if (!existingToolCalls) {
        // 新增 tool-calls 块
        const toolCallsHtml = this.renderToolCalls(msg.toolCalls);
        const temp = document.createElement('div');
        temp.innerHTML = toolCallsHtml;
        const toolCallsEl = temp.firstElementChild;
        if (toolCallsEl) {
          const refEl = contentEl.querySelector('.reasoning') || textEl;
          contentEl.insertBefore(toolCallsEl, refEl);
          this.bindCodeActions();
        }
      }
    }

    // 4. 平滑滚动到底部（使用 requestAnimationFrame 避免抖动）
    if (!this._scrollRafId) {
      this._scrollRafId = requestAnimationFrame(() => {
        this._scrollRafId = null;
        container.scrollTop = container.scrollHeight;
      });
    }
  },

  // 单条消息重渲染 - 只更新内部内容，避免 outerHTML 全量替换导致闪烁
  renderSingleMessage(index) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const msg = this.messages[index];
    if (!msg) return;

    const targetEl = container.querySelector(`[data-msg-index="${index}"]`);
    if (!targetEl) {
      this.appendMessage(msg);
      return;
    }

    const prevScrollTop = container.scrollTop;

    if (msg.role === 'tool') {
      // 工具结果消息：替换内容区
      const newHtml = this.renderToolResult(msg, index);
      const temp = document.createElement('div');
      temp.innerHTML = newHtml;
      const newContent = temp.firstElementChild?.querySelector('.message-content');
      const oldContent = targetEl.querySelector('.message-content');
      if (newContent && oldContent) {
        oldContent.replaceWith(newContent);
      }
    } else {
      const contentEl = targetEl.querySelector('.message-content');
      if (!contentEl) return;

      // 1. 更新 message-text（Markdown 渲染）
      const textEl = contentEl.querySelector('.message-text');
      if (textEl) {
        textEl.innerHTML = this.formatMarkdown(msg.content || '');
      }

      // 2. 更新或插入 reasoning 块
      const existingReasoning = contentEl.querySelector('.reasoning');
      const hasReasoning = !!(msg.reasoning && msg.reasoning.trim());
      if (hasReasoning) {
        if (existingReasoning) {
          const reasoningBodyEl = existingReasoning.querySelector('.reasoning__body');
          if (reasoningBodyEl) reasoningBodyEl.textContent = msg.reasoning;
          if (msg.reasoningComplete) {
            existingReasoning.classList.remove('reasoning--open');
            existingReasoning.removeAttribute('data-running');
          }
        } else {
          const reasoningHtml = this.renderReasoningBlock(msg);
          const temp = document.createElement('div');
          temp.innerHTML = reasoningHtml;
          const reasoningEl = temp.firstElementChild;
          if (reasoningEl && textEl) {
            contentEl.insertBefore(reasoningEl, textEl);
          }
        }
      } else if (existingReasoning) {
        // 如果没有 reasoning 但存在 reasoning 块，移除它
        existingReasoning.remove();
      }

      // 3. 更新或插入 tool-calls 块
      const existingToolCalls = contentEl.querySelector('.tool-calls');
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const toolCallsHtml = this.renderToolCalls(msg.toolCalls);
        const temp = document.createElement('div');
        temp.innerHTML = toolCallsHtml;
        const newToolCallsEl = temp.firstElementChild;
        if (newToolCallsEl) {
          if (existingToolCalls) {
            existingToolCalls.replaceWith(newToolCallsEl);
          } else {
            const refEl = contentEl.querySelector('.reasoning') || textEl;
            contentEl.insertBefore(newToolCallsEl, refEl);
          }
          this.bindCodeActions();
        }
      } else if (existingToolCalls) {
        existingToolCalls.remove();
      }
    }

    // 调整滚动位置
    const heightDiff = targetEl.offsetHeight + targetEl.offsetTop;
    if (Math.abs(heightDiff) < 500) {
      container.scrollTop = prevScrollTop + heightDiff;
    } else {
      container.scrollTop = container.scrollHeight;
    }
  },

  // 渲染 reasoning 块
  renderReasoningBlock(msg) {
    const reasoningText = this.escapeHtml(msg.reasoning || '');
    const isComplete = msg.reasoningComplete;
    const statusText = isComplete ? '已思考完成' : '思考中';
    return `
      <details class="reasoning" ${!isComplete ? 'open' : ''}>
        <summary class="reasoning__label">
          <span class="reasoning__chevron">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
          <span class="reasoning__status">${statusText}</span>
          <span class="reasoning__spacer"></span>
        </summary>
        <div class="reasoning__body">${reasoningText}</div>
      </details>
    `;
  },

  // 渲染 tool-calls 块
  renderToolCalls(toolCalls) {
    const itemsHtml = toolCalls.map(tc => {
      let argsDisplay = '';
      try {
        argsDisplay = JSON.stringify(JSON.parse(tc.function?.arguments || '{}'), null, 2);
      } catch {
        argsDisplay = tc.function?.arguments || '';
      }
      const funcName = tc.function?.name || 'unknown';
      let argsPreview = '';
      try {
        const parsed = JSON.parse(tc.function?.arguments || '{}');
        const keys = Object.keys(parsed);
        if (keys.length > 0) {
          const firstKey = keys[0];
          const firstVal = String(parsed[firstKey]);
          argsPreview = firstVal.length > 40 ? firstVal.slice(0, 40) + '…' : firstVal;
        }
      } catch {}

      return `
        <details class="tool-card" data-msg-index="${tc.id}">
          <summary class="tool-card__head">
            <span class="tool-card__chevron">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </span>
            <span class="tool-card__icon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            </span>
            <span class="tool-card__name">${this.escapeHtml(funcName)}</span>
            ${argsPreview ? `<span class="tool-card__preview">${this.escapeHtml(argsPreview)}</span>` : ''}
          </summary>
          <div class="tool-card__body">
            <pre class="tool-card__args">${this.escapeHtml(argsDisplay)}</pre>
          </div>
        </details>
      `;
    }).join('');
    return `<div class="tool-calls">${itemsHtml}</div>`;
  },

  renderWelcome() {
    const suggestions = [
      { title: '代码调试', desc: '帮我分析代码错误并给出修复建议' },
      { title: '功能开发', desc: '帮我实现一个新功能或组件' },
      { title: '代码审查', desc: '审查我的代码并提供改进建议' },
      { title: '技术问答', desc: '回答编程和技术相关问题' }
    ];

    return `
      <div class="welcome-screen">
        <span class="welcome-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M2 17l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
        </span>
        <div class="welcome-title">MiMo 智能助手</div>
        <div class="welcome-desc">为 MiMo 大模型深度优化的桌面助手</div>
        <div class="welcome-suggestions">
          ${suggestions.map(s => `
            <div class="suggestion-card" onclick="Chat.sendWelcomeSuggestion('${s.desc}')">
              <div class="suggestion-title">${s.title}</div>
              <div class="suggestion-desc">${s.desc}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  sendWelcomeSuggestion(text) {
    const input = document.getElementById('chatInput');
    if (input) {
      input.value = text;
      App.sendMessage();
    }
  },

  renderMessage(msg, idx) {
    const roleIcon = msg.role === 'user'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><circle cx="19" cy="5" r="1.5"/><circle cx="5" cy="19" r="1.5"/></svg>';
    const roleClass = msg.role === 'user' ? 'user' : 'ai';
    const formattedText = this.formatMarkdown(msg.content);

    // 思考过程（仅 AI 消息）— Reasonix 风格：
    // - 默认折叠（body 完全隐藏，非 3 行预览）
    // - 流式时自动展开
    // - 思考完成时自动折叠
    // - 运行中显示 shimmer 动画 + "思考中"标签
    // - 完成后显示"思考过程" + 耗时
    // - 左侧竖线边框
    let reasoningHtml = '';
    if (msg.role !== 'user') {
      const hasReasoning = !!(msg.reasoning && msg.reasoning.trim());
      const isRunning = this.isGenerating && !msg.reasoningComplete;
      // 有内容或正在运行时才渲染
      if (hasReasoning || isRunning) {
        const isStreaming = isRunning && hasReasoning;
        // 流式时自动展开（用户手动操作后不再自动跟随）
        const autoOpen = isStreaming;
        const escapedReasoning = this.escapeHtml(msg.reasoning || '');
        const duration = msg.reasoningEndTime
          ? this.formatDuration(msg.reasoningEndTime - (msg.reasoningStartTime || msg.timestamp))
          : '';
        const label = isRunning ? '思考中' : '思考过程';
        const metaHtml = duration ? `<span class="reasoning__meta">${duration}</span>` : '';
        const openClass = autoOpen ? ' reasoning--open' : '';
        const runningAttr = isRunning ? ' data-running' : '';

        reasoningHtml = `
          <div class="reasoning${openClass}"${runningAttr}>
            <button class="reasoning__head" type="button">
              <span class="reasoning__icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 4a2 2 0 0 1 2 2v1a2 2 0 0 1 2 2 2 2 0 0 1 0 4 2 2 0 0 1-1 3.46V17a2 2 0 0 1-3 1.73A2 2 0 0 1 9 17v-.54A2 2 0 0 1 8 13a2 2 0 0 1 0-4 2 2 0 0 1 2-2V6a2 2 0 0 1 2-2z"/>
                  <path d="M12 4v16"/>
                </svg>
              </span>
              <span class="reasoning__label">${label}</span>
              ${metaHtml}
              <span class="reasoning__chevron">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </button>
            <div class="reasoning__body">${escapedReasoning}</div>
          </div>
        `;
      }
    }

    // 工具调用 — Reasonix 风格卡片：可折叠，默认折叠
    const hasToolCalls = !!(msg.toolCalls && msg.toolCalls.length > 0);
    let toolCallsHtml = '';
    if (hasToolCalls) {
      const itemsHtml = msg.toolCalls.map(tc => {
        let argsDisplay = '';
        try {
          argsDisplay = JSON.stringify(JSON.parse(tc.function?.arguments || '{}'), null, 2);
        } catch {
          argsDisplay = tc.function?.arguments || '';
        }
        const funcName = tc.function?.name || 'unknown';
        // 参数预览（折叠态显示第一行关键参数）
        let argsPreview = '';
        try {
          const parsed = JSON.parse(tc.function?.arguments || '{}');
          const keys = Object.keys(parsed);
          if (keys.length > 0) {
            const firstKey = keys[0];
            const firstVal = String(parsed[firstKey]);
            argsPreview = firstVal.length > 40 ? firstVal.slice(0, 40) + '…' : firstVal;
          }
        } catch {}

        return `
          <details class="tool-card">
            <summary class="tool-card__head">
              <span class="tool-card__chevron">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </span>
              <span class="tool-card__icon">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
              </span>
              <span class="tool-card__name">${this.escapeHtml(funcName)}</span>
              ${argsPreview ? `<span class="tool-card__preview">${this.escapeHtml(argsPreview)}</span>` : ''}
            </summary>
            <div class="tool-card__body">
              <pre class="tool-card__args">${this.escapeHtml(argsDisplay)}</pre>
            </div>
          </details>
        `;
      }).join('');
      toolCallsHtml = `<div class="tool-calls">${itemsHtml}</div>`;
    }

    return `
      <div class="message ${roleClass}" data-msg-index="${idx}">
        <div class="message-avatar">${roleIcon}</div>
        <div class="message-content">
          <div class="message-role">${msg.role === 'user' ? '我' : 'MiMo'} · ${this.formatTime(msg.timestamp)}</div>
          ${reasoningHtml}
          ${toolCallsHtml}
          <div class="message-text">${formattedText}</div>
        </div>
      </div>
    `;
  },

  renderToolResult(msg, idx) {
    let resultContent = '';
    try {
      const parsed = JSON.parse(msg.content);
      resultContent = JSON.stringify(parsed, null, 2);
    } catch {
      resultContent = msg.content;
    }

    // 结构化判断：解析 JSON 看 error/blocked/非零 exitCode；解析失败才用文本兜底
    let isError = false;
    try {
      const parsed = JSON.parse(msg.content);
      isError = !!(parsed.error || parsed.blocked || (parsed.exitCode !== undefined && parsed.exitCode !== 0));
    } catch {
      isError = /error|failed|失败|exception/i.test(resultContent);
    }
    const idxAttr = idx !== undefined ? ` data-msg-index="${idx}"` : '';
    return `
      <div class="message ai"${idxAttr}>
        <div class="message-avatar tool-avatar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
        </div>
        <div class="message-content">
          <div class="message-role">工具返回</div>
          <div class="tool-call-result ${isError ? 'error' : ''}">
            <div class="output">${this.escapeHtml(resultContent)}</div>
          </div>
        </div>
      </div>
    `;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  },

  formatMarkdown(text) {
    // 先整体 HTML 转义（防 XSS：模型输出/代码块中的 <script> 等不会被当作标签执行），
    // 再处理 markdown 标记。调用方无需预先转义，否则会双重转义。
    let html = this.escapeHtml(text == null ? '' : String(text));

    // 代码块：带工具条 + 折叠/展开 + 状态标识 + 长按支持
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const langLabel = lang || 'text';
      const escapedCode = code.replace(/\n$/, '');
      const lineCount = escapedCode.split('\n').length;
      const collapsed = lineCount > 12;
      const stateIndicator = `<span class="code-block-state state-applyable" title="可应用">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </span>`;
      const collapseBtn = collapsed
        ? `<button class="code-action-btn collapse" title="展开/折叠">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>`
        : '';
      const longPressAttr = 'data-longpress="1"';
      return `<pre data-lang="${langLabel}" class="${collapsed ? 'collapsed' : ''}" data-lines="${lineCount}" ${longPressAttr}>
        <div class="code-block-header">
          <span class="code-block-lang">${langLabel}</span>
          ${stateIndicator}
          <span class="code-block-lines">${lineCount} 行</span>
          <div class="code-block-actions">
            ${collapseBtn}
            <button class="code-action-btn copy" title="复制代码">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="code-action-btn apply" title="应用到文件">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button class="code-action-btn download" title="下载文件">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button class="code-action-btn fullscreen" title="全屏查看">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
            </button>
          </div>
        </div>
        <code>${escapedCode}</code>
      </pre>`;
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';

    return html;
  },

  formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  },

  // 格式化耗时（毫秒 → 如 "3s" / "1m5s"）
  formatDuration(ms) {
    if (!ms || ms < 0) return '';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return rs > 0 ? `${m}m${rs}s` : `${m}m`;
  },

  // 思考完成时自动折叠 reasoning（除非用户手动操作过）
  collapseReasoning(index) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const reasoningEl = container.querySelector(`[data-msg-index="${index}"] .reasoning`);
    if (!reasoningEl) return;
    if (reasoningEl.dataset.userToggled) return; // 尊重用户操作
    reasoningEl.classList.remove('reasoning--open');
    reasoningEl.removeAttribute('data-running');
    // 更新标签为"思考过程" + 显示耗时
    const msg = this.messages[index];
    if (!msg) return;
    const labelEl = reasoningEl.querySelector('.reasoning__label');
    if (labelEl) labelEl.textContent = '思考过程';
    if (msg.reasoningEndTime) {
      const duration = this.formatDuration(msg.reasoningEndTime - (msg.reasoningStartTime || msg.timestamp));
      if (duration) {
        let metaEl = reasoningEl.querySelector('.reasoning__meta');
        if (!metaEl) {
          metaEl = document.createElement('span');
          metaEl.className = 'reasoning__meta';
          const chevron = reasoningEl.querySelector('.reasoning__chevron');
          if (chevron) chevron.before(metaEl);
          else reasoningEl.querySelector('.reasoning__head')?.appendChild(metaEl);
        }
        metaEl.textContent = duration;
      }
    }
  },

  // 绑定代码块工具条按钮事件
  bindCodeActions() {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    container.querySelectorAll('pre .code-action-btn').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pre = btn.closest('pre');
        if (!pre) return;
        const codeEl = pre.querySelector('code');
        const code = codeEl ? codeEl.innerText : '';
        const lang = pre.dataset.lang || 'text';

        if (btn.classList.contains('collapse')) {
          this.toggleCodeCollapse(pre);
        } else if (btn.classList.contains('copy')) {
          this.copyCode(code);
        } else if (btn.classList.contains('fullscreen')) {
          this.fullscreenCode(code, lang);
        } else if (btn.classList.contains('apply')) {
          this.applyCode(code, lang);
        } else if (btn.classList.contains('download')) {
          this.downloadCode(code, lang);
        }
      });
    });

    // 代码块折叠/展开切换（点击头部空白区域）
    container.querySelectorAll('pre.code-block').forEach(pre => {
      if (pre.dataset.boundCollapse) return;
      pre.dataset.boundCollapse = '1';
      const header = pre.querySelector('.code-block-header');
      if (header) {
        header.addEventListener('click', (e) => {
          if (e.target.closest('.code-action-btn')) return;
          this.toggleCodeCollapse(pre);
        });
      }

      // 长按支持（触发上下文操作）
      let longPressTimer = null;
      pre.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        longPressTimer = setTimeout(() => {
          pre.classList.add('long-press');
          const codeEl = pre.querySelector('code');
          const code = codeEl ? codeEl.innerText : '';
          // 长按 500ms 显示操作菜单
          window.Confirm && window.Confirm.show({
            title: '代码块操作',
            message: '对当前代码块执行什么操作？',
            level: 'warning',
            confirmText: '复制代码',
            cancelText: '关闭',
            onConfirm: () => this.copyCode(code)
          });
        }, 500);
      });
      const clearLongPress = () => {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        pre.classList.remove('long-press');
      };
      pre.addEventListener('mouseup', clearLongPress);
      pre.addEventListener('mouseleave', clearLongPress);
      pre.addEventListener('touchstart', () => {
        longPressTimer = setTimeout(() => {
          pre.classList.add('long-press');
        }, 500);
      });
      pre.addEventListener('touchend', clearLongPress);
      pre.addEventListener('touchmove', clearLongPress);
    });

    // 思考过程折叠/展开切换（Reasonix 风格）
    container.querySelectorAll('.reasoning__head').forEach(head => {
      if (head.dataset.bound) return;
      head.dataset.bound = '1';
      head.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const reasoning = head.closest('.reasoning');
        if (!reasoning) return;
        // 标记用户已手动操作，后续不再自动跟随
        reasoning.dataset.userToggled = '1';
        reasoning.classList.toggle('reasoning--open');
      });
    });
  },

  toggleCodeCollapse(pre) {
    pre.classList.toggle('collapsed');
    const codeEl = pre.querySelector('code');
    const collapseBtn = pre.querySelector('.code-action-btn.collapse svg');
    if (pre.classList.contains('collapsed')) {
      // 折叠状态
      if (collapseBtn) collapseBtn.style.transform = 'rotate(-90deg)';
    } else {
      if (collapseBtn) collapseBtn.style.transform = '';
    }
  },

  copyCode(code) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => {
        if (window.App && App.showToast) App.showToast('代码已复制', 'success');
      });
    }
  },

  fullscreenCode(code, lang) {
    const modal = document.getElementById('codeFullscreenModal');
    const titleEl = document.getElementById('codeFullscreenTitle');
    const contentEl = document.getElementById('codeFullscreenContent');
    if (!modal || !contentEl) return;
    if (titleEl) titleEl.textContent = `代码 - ${lang}`;
    contentEl.textContent = code;
    contentEl.className = `code-fullscreen-pre lang-${lang}`;
    modal.classList.remove('hidden');
  },

  async applyCode(code, lang) {
    // 尝试将代码应用到当前文件（若存在）
    if (window.RightPanel && this._lastFilePath) {
      window.RightPanel.showDiff(this._lastFileContent || '', code, this._lastFilePath);
      if (window.App && App.showToast) App.showToast('代码已载入对比视图', 'info');
    } else {
      // 写入新文件
      const fileName = `snippet-${Date.now()}.${lang === 'text' ? 'txt' : lang}`;
      try {
        await window.api.writeFile(fileName, code);
        if (window.App && App.showToast) App.showToast(`已写入: ${fileName}`, 'success');
      } catch (e) {
        if (window.App && App.showToast) App.showToast('应用失败: ' + e.message, 'error');
      }
    }
  },

  downloadCode(code, lang) {
    const ext = lang === 'text' ? 'txt' : lang;
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `code-${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // 检测 AI 消息中的任务计划 JSON 并触发 PlanPanel 渲染
  detectPlan() {
    if (!window.PlanPanel) return;
    const lastMsg = this.messages[this.messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') return;

    const content = lastMsg.content || '';
    // 匹配 ```json ... ``` 中含 plan/steps 字段的 JSON
    const planMatch = content.match(/```json\n([\s\S]*?)```/);
    if (!planMatch) return;

    try {
      const parsed = JSON.parse(planMatch[1]);
      if (parsed && (parsed.plan || parsed.steps) && Array.isArray(parsed.steps || parsed.plan?.steps)) {
        const plan = parsed.plan || parsed;
        if (plan.steps && plan.steps.length > 0) {
          PlanPanel.render(plan);
        }
      }
    } catch {
      // 非 JSON 或格式不符，忽略
    }
  },

  /* ---------- 上下文压缩（Reasonix compaction） ---------- */

  // 从后往前保留最近 maxUserRounds 轮用户对话（含其完整工具消息链），返回截断点
  findSafeCutoff(maxUserRounds = 2) {
    let userCount = 0;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        userCount++;
        if (userCount === maxUserRounds) return i;
      }
    }
    return 0;
  },

  // 历史 token 超阈值时触发压缩
  async maybeCompactHistory() {
    const config = await Storage.loadConfig();
    const threshold = config.compactionThreshold ?? 28000;
    let total = 0;
    for (const m of this.messages) {
      total += this.estimateTokens(String(m.content || ''));
      if (m.reasoning) total += this.estimateTokens(String(m.reasoning));
    }
    if (total <= threshold) return;
    await this.compactHistory();
  },

  // 把早期消息压缩为一条摘要消息（AI 摘要，失败回退文本截取）
  async compactHistory() {
    const cutoff = this.findSafeCutoff(2);
    if (cutoff <= 0) return; // 没有可压缩的历史
    const oldMsgs = this.messages.slice(0, cutoff);
    const keptMsgs = this.messages.slice(cutoff);

    let summary = '';
    const config = await Storage.loadConfig();
    if (config.apiEndpoint && config.apiKey) {
      try {
        const text = oldMsgs
          .filter(m => m.role !== 'tool')
          .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${String(m.content || '').slice(0, 1200)}`)
          .join('\n---\n')
          .slice(-20000);
        const result = await window.api.chat([
          { role: 'system', content: '你是对话压缩器。请把以下早期对话浓缩成简洁中文摘要（保留关键决策、涉及的文件路径、已执行的操作与结论），200-400 字。直接输出摘要文本，不要任何其他内容。' },
          { role: 'user', content: text }
        ], false, null);
        if (!result.error && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
          summary = result.choices[0].message.content.trim();
        }
      } catch { summary = ''; }
    }
    if (!summary) {
      // 回退：截取最近几轮的关键文本
      summary = oldMsgs
        .filter(m => m.role !== 'tool' && m.content)
        .slice(-6)
        .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${String(m.content).slice(0, 200)}`)
        .join('\n')
        .slice(0, 1500);
    }

    this.messages = [
      { role: 'system', content: `[早期对话摘要（系统自动压缩，${oldMsgs.length} 条消息）]\n${summary}`, timestamp: Date.now() },
      ...keptMsgs
    ];
    this.recalcHistoryTokens();
    this.syncTokenDisplay();
    if (window.App && App.showToast) App.showToast('历史对话已自动压缩（保留最近 2 轮）', 'info');
  },

  /* ---------- Token 计数 ---------- */

  // 粗略估算文本的 token 数（中文 1字≈1token，英文每 4 字符≈1token）
  estimateTokens(text) {
    if (!text) return 0;
    const str = String(text);
    // 匹配中文字符
    const cjkMatches = str.match(/[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\u1100-\u11FF\uAC00-\uD7AF]/g);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    // 去掉中文后剩余部分按字符估算
    const remaining = str.replace(/[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\u1100-\u11FF\uAC00-\uD7AF]/g, '');
    // 英文部分：单词数 × 1.3，再加上标点/空白微调，粗略用 ceil(len/4)
    const remainingTokens = Math.ceil(remaining.length / 4);
    return cjkCount + remainingTokens;
  },

  // 计算历史消息累计 token（加载会话时调用）
  recalcHistoryTokens() {
    let total = 0;
    for (const msg of this.messages) {
      if (msg.content) total += this.estimateTokens(msg.content);
      if (msg.reasoning) total += this.estimateTokens(msg.reasoning);
      if (msg.toolCalls && msg.toolCalls.length) {
        for (const tc of msg.toolCalls) {
          if (tc.function?.arguments) total += this.estimateTokens(tc.function.arguments);
        }
      }
    }
    this.tokenUsed = total;
  },

  // 累加 token 并同步到状态栏
  addTokens(text, chunk = false) {
    const n = this.estimateTokens(text);
    if (n <= 0) return;
    this.tokenUsed += n;
    // 流式增量时：每累计约 50 token 刷新一次显示，非流式立即更新
    if (!chunk) {
      this.syncTokenDisplay();
    } else {
      // 使用节流：记录上次显示的 token 数，增量达阈值才更新
      if (!this._lastDisplayToken) this._lastDisplayToken = 0;
      if (this.tokenUsed - this._lastDisplayToken >= 50) {
        this._lastDisplayToken = this.tokenUsed;
        this.syncTokenDisplay();
      }
    }
  },

  // 同步底部状态栏显示
  syncTokenDisplay() {
    if (window.StatusBar && typeof StatusBar.setToken === 'function') {
      StatusBar.setToken(this.tokenUsed);
    }
  }
};

window.Chat = Chat;
