/**
 * ToolLogger - 工具调用日志管理器
 *
 * 设计理念：
 * - 只记录失败的工具调用，成功后自动清空（不占内存）
 * - 每条日志包含：工具名、参数、错误信息、失败原因分析、时间戳
 * - 提供 getFailureSummary() 让 AI 能看到历史失败模式并改进调用策略
 * - 提供 getPatternAnalysis() 自动分析常见失败模式，给出改进建议
 */
const ToolLogger = {
  // 日志数组（仅保留失败记录，成功后清空）
  _logs: [],

  // 最大保留条数（防止异常情况下无限增长）
  _maxLogs: 50,

  // 成功计数器
  _successCount: 0,

  /**
   * 记录一次工具调用
   * @param {string} toolName - 工具名称
   * @param {object} args - 调用参数
   * @param {object} result - 执行结果
   * @param {number} attempt - 第几次尝试
   */
  log(toolName, args, result, attempt = 1) {
    // 修正：exitCode 非 0 即失败（原实现 && 优先于 || 导致 grep 无匹配等非零退出被误判为成功）
    const isError = !!(result.error || result.blocked || (result.exitCode !== undefined && result.exitCode !== 0));

    if (isError) {
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tool: toolName,
        args: this._sanitizeArgs(toolName, args),
        error: result.error || result.stderr || `exitCode: ${result.exitCode}`,
        errorType: result.errorType || this._classifyError(result.error || result.stderr || ''),
        attempt,
        timestamp: Date.now(),
        timeStr: new Date().toISOString(),
        suggestion: result.suggestion || ''
      };

      this._logs.push(entry);

      // 超出上限时移除最旧的
      if (this._logs.length > this._maxLogs) {
        this._logs.shift();
      }

      console.warn(`[ToolLogger] 失败记录 #${this._logs.length}:`, entry.tool, entry.error);
    } else {
      // 成功：清空该工具的历史失败日志
      this.clearByTool(toolName);
      this._successCount++;
      console.log(`[ToolLogger] ${toolName} 调用成功，已清空该工具的失败日志`);
    }
  },

  /**
   * 清空指定工具的失败日志
   */
  clearByTool(toolName) {
    const before = this._logs.length;
    this._logs = this._logs.filter(l => l.tool !== toolName);
    const removed = before - this._logs.length;
    if (removed > 0) {
      console.log(`[ToolLogger] 清空 ${toolName} 的 ${removed} 条失败日志`);
    }
  },

  /**
   * 清空所有日志
   */
  clearAll() {
    const count = this._logs.length;
    this._logs = [];
    if (count > 0) {
      console.log(`[ToolLogger] 清空全部 ${count} 条日志`);
    }
  },

  /**
   * 获取失败摘要（供 AI 分析用）
   * 返回简洁的文本摘要，包含失败模式和改进建议
   */
  getFailureSummary() {
    if (this._logs.length === 0) {
      return null; // 无失败记录
    }

    // 按工具分组统计
    const byTool = {};
    for (const log of this._logs) {
      if (!byTool[log.tool]) {
        byTool[log.tool] = { count: 0, errors: [], lastError: null };
      }
      byTool[log.tool].count++;
      byTool[log.tool].errors.push({
        error: log.error.slice(0, 200),
        errorType: log.errorType,
        args: log.args,
        attempt: log.attempt,
        time: log.timeStr
      });
      byTool[log.tool].lastError = log;
    }

    // 生成摘要文本
    const lines = ['### 工具调用失败日志（系统自动记录）\n'];
    lines.push(`共 ${this._logs.length} 条失败记录，涉及 ${Object.keys(byTool).length} 个工具\n`);

    for (const [tool, info] of Object.entries(byTool)) {
      lines.push(`#### ${tool}（失败 ${info.count} 次）`);
      const lastErr = info.lastError;
      lines.push(`- 最近一次错误: ${lastErr.error.slice(0, 150)}`);
      lines.push(`- 错误类型: ${lastErr.errorType}`);
      if (lastErr.suggestion) {
        lines.push(`- 系统建议: ${lastErr.suggestion}`);
      }
      // 列出最近 3 次的参数和错误
      const recent = info.errors.slice(-3);
      for (const e of recent) {
        const argStr = typeof e.args === 'string' ? e.args.slice(0, 100) : JSON.stringify(e.args).slice(0, 100);
        lines.push(`  - [尝试${e.attempt}] 参数: ${argStr} → 错误: ${e.error.slice(0, 80)}`);
      }
      lines.push('');
    }

    // 附加模式分析
    const analysis = this.getPatternAnalysis();
    if (analysis) {
      lines.push('### 自动模式分析');
      lines.push(analysis);
    }

    return lines.join('\n');
  },

  /**
   * 分析失败模式，给出改进建议
   */
  getPatternAnalysis() {
    if (this._logs.length === 0) return null;

    const patterns = [];
    const errorTypes = {};
    const toolFailCounts = {};

    for (const log of this._logs) {
      errorTypes[log.errorType] = (errorTypes[log.errorType] || 0) + 1;
      toolFailCounts[log.tool] = (toolFailCounts[log.tool] || 0) + 1;
    }

    // 分析最频繁的错误类型
    const topErrorType = Object.entries(errorTypes).sort((a, b) => b[1] - a[1])[0];
    if (topErrorType) {
      const [type, count] = topErrorType;
      const suggestions = {
        api_unavailable: '工具 API 频繁不可用，建议：1) 检查 Electron preload 是否正确加载 2) 尝试用 bash 的 echo 命令作为替代方案写文件',
        file_not_found: '频繁出现文件不存在错误，建议：1) 先用 bash 的 mkdir 创建目录 2) 检查路径是否使用了正确的分隔符',
        path_security: '频繁出现路径越界错误，建议：所有路径使用相对于工作区根目录的相对路径，不要使用绝对路径或 ../',
        shell_error: 'Shell 执行频繁失败，建议：1) Windows 系统使用 cmd 命令（如 dir、type、start）2) 确认命令存在',
        permission_denied: '频繁权限不足，建议：1) 检查工作区目录权限 2) 尝试在其他子目录操作',
        port_in_use: '端口频繁被占用，建议：使用动态端口号或先查找并关闭占用进程',
        timeout: '命令频繁超时，建议：1) 避免需要交互的命令 2) 使用后台执行 3) 拆分为多个小命令',
        blocked_by_whitelist: '命令被安全策略拦截，建议：使用 .mimo/permissions.json 中已授权的命令',
        unknown: '出现未知错误，建议：检查参数格式是否正确，确保 JSON 参数完整'
      };
      const tip = suggestions[type] || suggestions.unknown;
      patterns.push(`- 最常见错误类型: **${type}**（${count}次）→ ${tip}`);
    }

    // 分析重复失败的工具
    const topFailingTool = Object.entries(toolFailCounts).sort((a, b) => b[1] - a[1])[0];
    if (topFailingTool && topFailingTool[1] >= 3) {
      const [tool, count] = topFailingTool;
      patterns.push(`- 工具 **${tool}** 已连续失败 ${count} 次，建议：尝试使用其他工具组合实现相同目标`);
    }

    // 分析参数模式
    const pathErrors = this._logs.filter(l => l.tool !== 'bash' && (l.errorType === 'file_not_found' || l.errorType === 'path_security'));
    if (pathErrors.length >= 2) {
      const paths = pathErrors.map(l => l.args.path || l.args).filter(Boolean);
      if (paths.length >= 2) {
        const hasAbs = paths.some(p => typeof p === 'string' && (p.startsWith('/') || p.match(/^[A-Z]:/)));
        if (hasAbs) {
          patterns.push('- 检测到使用了绝对路径导致失败，建议：改用相对路径（如 "src/index.js" 而非 "C:\\\\project\\\\src\\\\index.js"）');
        }
      }
    }

    return patterns.length > 0 ? patterns.join('\n') : null;
  },

  /**
   * 获取日志条数
   */
  getCount() {
    return this._logs.length;
  },

  /**
   * 获取原始日志（调试用）
   */
  getRawLogs() {
    return [...this._logs];
  },

  // ===== 内部方法 =====

  /**
   * 清理敏感参数，避免日志过大
   */
  _sanitizeArgs(toolName, args) {
    if (toolName === 'bash') {
      return { command: (args.command || '').slice(0, 200), cwd: args.cwd };
    }
    if (toolName === 'file_write') {
      return { path: args.path, contentLength: (args.content || '').length };
    }
    if (toolName === 'file_edit') {
      return {
        path: args.path,
        old_string_length: (args.old_string || '').length,
        new_string_length: (args.new_string || '').length
      };
    }
    if (toolName === 'file_read') {
      return { path: args.path };
    }
    return args;
  },

  /**
   * 简易错误分类（当 result 中没有 errorType 时使用）
   */
  _classifyError(errorMsg) {
    const msg = (errorMsg || '').toLowerCase();
    if (msg.includes('is not a function') || msg.includes('not available')) return 'api_unavailable';
    if (msg.includes('enoent') || msg.includes('not found') || msg.includes('no such file')) return 'file_not_found';
    if (msg.includes('eacces') || msg.includes('permission')) return 'permission_denied';
    if (msg.includes('eaddrinuse') || msg.includes('port')) return 'port_in_use';
    if (msg.includes('timeout') || msg.includes('etimedout')) return 'timeout';
    if (msg.includes('shell') || msg.includes('spawn') || msg.includes('enoent')) return 'shell_error';
    if (msg.includes('路径越界') || msg.includes('outside')) return 'path_security';
    if (msg.includes('blocked') || msg.includes('白名单')) return 'blocked_by_whitelist';
    return 'unknown';
  }
};

window.ToolLogger = ToolLogger;
