/* ============================================================
   PermissionEngine - 审批姿态与规则引擎（对标 Reasonix）
   - 三种姿态：ask（默认，逐个询问） / auto（自动放行） / yolo（全自动）
   - 规则语法（deny/ask/allow 三列表）：
       ToolName            匹配该工具所有调用
       ToolName(glob)      glob 匹配主体（* 任意、? 单字符）
       Bash(前缀:*)        命令前缀规则（按命令词边界匹配）
       Edit(...)          归一化覆盖 file_write/file_edit/move_file/delete_range
   - 判定优先级：deny > 会话授权 > ask 规则 > allow 规则 > 模式兜底
   - 只读工具（file_read/glob/grep/web_fetch）在 ask 模式下兜底放行
   ============================================================ */
const PermissionEngine = {
  mode: 'ask', // 'ask' | 'auto' | 'yolo'
  rules: { deny: [], ask: [], allow: [] },
  sessionGrants: [], // [{ tool, kind, pattern }] 仅本次会话有效

  init(config) {
    this.mode = (config && config.approvalMode) || 'ask';
    this.rules = (config && config.permissionRules) || { deny: [], ask: [], allow: [] };
    if (!Array.isArray(this.rules.deny)) this.rules.deny = [];
    if (!Array.isArray(this.rules.ask)) this.rules.ask = [];
    if (!Array.isArray(this.rules.allow)) this.rules.allow = [];
    this.sessionGrants = [];
  },

  // 工具归一化：多个文件写入工具统一为 Edit
  canonical(tool) {
    if (['file_write', 'file_edit', 'multi_edit', 'delete_range', 'move_file'].includes(tool)) return 'Edit';
    if (tool === 'file_read') return 'Read';
    if (tool === 'bash') return 'Bash';
    return tool;
  },

  // 提取权限判定主体
  subjectFor(tool, args) {
    if (tool === 'bash') return String(args.command || '');
    return String(args.path || args.file_path || args.filePath || args.source || args.destination || '');
  },

  parseRule(rule) {
    rule = String(rule || '').trim();
    if (!rule) return null;
    const m = rule.match(/^([A-Za-z_]+)\((.*)\)$/);
    if (m) {
      const tool = m[1];
      const subject = m[2];
      if (tool === 'Bash' && subject.endsWith(':*')) {
        return { tool, kind: 'bashPrefix', pattern: subject.slice(0, -2) };
      }
      return { tool, kind: 'glob', pattern: subject };
    }
    return { tool: rule, kind: 'all', pattern: undefined };
  },

  globMatch(pattern, text) {
    if (pattern === '*') return true;
    let re = '';
    for (const ch of pattern) {
      if (ch === '*') re += '[\\s\\S]*';
      else if (ch === '?') re += '[\\s\\S]';
      else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    try {
      return new RegExp('^' + re + '$').test(text);
    } catch {
      return false;
    }
  },

  // 命令前缀匹配：要求命令词边界（prefix 后为空格/结尾）
  bashPrefixMatch(prefix, cmd) {
    const t = String(cmd || '').trim();
    if (!t) return false;
    return t === prefix || t.startsWith(prefix + ' ') || t.startsWith(prefix + '\t');
  },

  matchRule(ruleObj, tool, subject) {
    const ctool = this.canonical(tool);
    if (ruleObj.tool !== ctool && ruleObj.tool !== tool) return false;
    if (ruleObj.kind === 'all') return true;
    if (ruleObj.kind === 'bashPrefix') return this.bashPrefixMatch(ruleObj.pattern, subject);
    return this.globMatch(ruleObj.pattern, subject);
  },

  isReadOnlyTool(tool) {
    return ['file_read', 'glob', 'grep', 'ls', 'web_fetch'].includes(tool);
  },

  // 返回命中的规则字符串（用于 UI 提示）
  findMatchingRule(listName, tool, args) {
    const subject = this.subjectFor(tool, args);
    const list = this.rules[listName] || [];
    for (const r of list) {
      const o = this.parseRule(r);
      if (o && this.matchRule(o, tool, subject)) return r;
    }
    return null;
  },

  // 核心决策：返回 'allow' | 'ask' | 'deny'
  decide(tool, args) {
    const subject = this.subjectFor(tool, args);

    // 1. deny 规则（任何模式都不可绕过）
    for (const r of this.rules.deny) {
      const o = this.parseRule(r);
      if (o && this.matchRule(o, tool, subject)) return 'deny';
    }

    // 2. 本会话授权（高于 ask/allow 规则，低于 deny）
    for (const g of this.sessionGrants) {
      if (g.tool === this.canonical(tool) || g.tool === tool) {
        if (g.kind === 'all' || this.matchRule(g, tool, subject)) return 'allow';
      }
    }

    // YOLO：除 deny 外全部放行（ask 工具提问与计划确认仍单独处理）
    if (this.mode === 'yolo') return 'allow';

    // 3. ask 规则
    for (const r of this.rules.ask) {
      const o = this.parseRule(r);
      if (o && this.matchRule(o, tool, subject)) return 'ask';
    }

    // 4. allow 规则
    for (const r of this.rules.allow) {
      const o = this.parseRule(r);
      if (o && this.matchRule(o, tool, subject)) return 'allow';
    }

    // 5. 模式兜底：ask 模式只读放行、写入询问；auto 全放行
    if (this.mode === 'ask') return this.isReadOnlyTool(tool) ? 'allow' : 'ask';
    return 'allow';
  },

  // 授权本会话：优先前缀化 bash / Edit，与 reasonix 的 SessionGrantRuleForScope 对齐
  grantSession(tool, subject) {
    const ctool = this.canonical(tool);
    if (ctool === 'Bash' && subject) {
      // 取命令的第一个词作为前缀授权（如 "npm test" -> Bash(npm:*)）
      const firstWord = String(subject).trim().split(/\s+/)[0];
      if (firstWord) {
        this.sessionGrants.push({ tool: 'Bash', kind: 'bashPrefix', pattern: firstWord });
        return `Bash(${firstWord}:*)`;
      }
    }
    if (ctool === 'Edit') {
      this.sessionGrants.push({ tool: 'Edit', kind: 'all' });
      return 'Edit';
    }
    this.sessionGrants.push({ tool, kind: 'all' });
    return tool;
  },

  // 持久化"总是允许"（写入配置，重启仍生效）
  addPersistentAllow(tool, subject) {
    const ctool = this.canonical(tool);
    let rule;
    if (ctool === 'Bash' && subject) {
      const firstWord = String(subject).trim().split(/\s+/)[0];
      rule = firstWord ? `Bash(${firstWord}:*)` : null;
    } else if (ctool === 'Edit') {
      rule = 'Edit';
    } else {
      rule = tool;
    }
    if (rule && !this.rules.allow.includes(rule)) {
      this.rules.allow.push(rule);
    }
    return rule;
  },

  clearSessionGrants() {
    this.sessionGrants = [];
  }
};

window.PermissionEngine = PermissionEngine;
