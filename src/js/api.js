const MiMoAPI = {
  async chat(messages, { onChunk, onReasoning, onToolCall, onFinish, tools = null, requestId = null } = {}) {
    const config = await window.api.getConfig();

    if (!config.apiEndpoint || !config.apiKey) {
      throw new Error('请先在设置中配置 MiMo API 地址和密钥');
    }

    // 关键：在发起 IPC 调用之前注册监听器，否则流式事件会丢失
    // 事件携带 requestId，按 id 过滤防止并发/残留请求的事件串流
    const matches = (data) => !requestId || !data || data.requestId === undefined || data.requestId === requestId;
    const listeners = {};
    if (onChunk) {
      listeners.chunk = window.api.onChunk((data) => { if (matches(data)) onChunk(data.content); });
    }
    if (onReasoning) {
      listeners.reasoning = window.api.onReasoningChunk((data) => { if (matches(data)) onReasoning(data.content); });
    }
    if (onToolCall) {
      listeners.tool = window.api.onToolCall((data) => { if (matches(data)) onToolCall(data.toolCalls); });
    }
    if (onFinish) {
      listeners.finish = window.api.onFinish((data) => { if (matches(data)) onFinish(data.reason); });
    }

    const cleanup = () => {
      if (listeners.chunk) listeners.chunk();
      if (listeners.reasoning) listeners.reasoning();
      if (listeners.tool) listeners.tool();
      if (listeners.finish) listeners.finish();
    };

    try {
      const result = await window.api.chat(messages, true, tools, requestId);

      // 用户主动中止不属于错误：透出 aborted 标记让上层友好提示
      if (result.error && !result.aborted) {
        throw new Error(result.error);
      }

      return {
        content: result.content,
        reasoning: result.reasoning,
        toolCalls: result.toolCalls,
        aborted: result.aborted || false,
        cleanup
      };
    } catch (err) {
      cleanup();
      throw err;
    }
  },

  async testConnection() {
    const config = await window.api.getConfig();
    if (!config.apiEndpoint || !config.apiKey) {
      return { success: false, message: '请先配置 API 地址和密钥' };
    }

    try {
      const result = await window.api.chat(
        [{ role: 'user', content: 'ping' }],
        false,
        null
      );
      if (result.error) {
        return { success: false, message: result.error };
      }
      return { success: true, message: '连接成功' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  buildToolsList(allowedTools) {
    const tools = [];

    if (allowedTools.includes('bash')) {
      tools.push({
        type: 'function',
        function: {
          name: 'bash',
          description: '在沙箱中执行 Shell 命令。支持系统命令、脚本执行、包管理等。Windows 使用 cmd 命令，Linux/Mac 使用 bash。常用命令：dir/ls, cd, mkdir, start (打开文件/浏览器), echo (写文件), python, node, npm 等。',
          parameters: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: '要执行的命令。Windows 用 cmd 语法，如 "start index.html"、"dir"；Linux/Mac 用 bash 语法'
              },
              cwd: {
                type: 'string',
                description: '可选的工作目录（相对于工作区），默认为工作区根目录'
              }
            },
            required: ['command']
          }
        }
      });
    }

    if (allowedTools.includes('file_read')) {
      tools.push({
        type: 'function',
        function: {
          name: 'file_read',
          description: '读取工作区内的文件内容，返回 UTF-8 文本。参数 path 为文件路径（支持 path、file_path、filename 等字段名）。',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '相对于工作区的文件路径，如 "index.html" 或 "src/app.js"'
              }
            },
            required: ['path']
          }
        }
      });
    }

    if (allowedTools.includes('file_write')) {
      tools.push({
        type: 'function',
        function: {
          name: 'file_write',
          description: '创建新文件或覆写工作区内的现有文件。参数 path 为文件路径，content 为文件内容。',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '相对于工作区的文件路径，如 "index.html"'
              },
              content: {
                type: 'string',
                description: '文件内容（UTF-8 文本）'
              }
            },
            required: ['path', 'content']
          }
        }
      });
    }

    if (allowedTools.includes('file_edit')) {
      tools.push({
        type: 'function',
        function: {
          name: 'file_edit',
          description: '编辑工作区内的文件，精确替换指定字符串。先读取文件，再将 old_string 替换为 new_string。',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '相对于工作区的文件路径'
              },
              old_string: {
                type: 'string',
                description: '要替换的原字符串（必须与文件中完全匹配）'
              },
              new_string: {
                type: 'string',
                description: '替换后的新字符串'
              }
            },
            required: ['path', 'old_string', 'new_string']
          }
        }
      });

      // multi_edit：一次对同一文件做多个精确替换（原子提交）
      tools.push({
        type: 'function',
        function: {
          name: 'multi_edit',
          description: '对同一个文件执行多次精确字符串替换，一次性提交（任一替换失败则全部不生效）。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对于工作区的文件路径' },
              edits: {
                type: 'array',
                description: '有序替换列表，每项 { old_string, new_string }，old_string 必须在文件中唯一匹配',
                items: {
                  type: 'object',
                  properties: {
                    old_string: { type: 'string', description: '要替换的原字符串' },
                    new_string: { type: 'string', description: '替换后的新字符串' }
                  },
                  required: ['old_string', 'new_string']
                }
              }
            },
            required: ['path', 'edits']
          }
        }
      });

      // delete_range：按锚点删除文件中的一段
      tools.push({
        type: 'function',
        function: {
          name: 'delete_range',
          description: '从文件中删除 start_anchor 到 end_anchor 之间的文本范围（含锚点行，逐行匹配）。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对于工作区的文件路径' },
              start_anchor: { type: 'string', description: '删除范围的起始锚点（必须是文件中唯一的行文本）' },
              end_anchor: { type: 'string', description: '删除范围的结束锚点（必须是文件中唯一的行文本）' }
            },
            required: ['path', 'start_anchor', 'end_anchor']
          }
        }
      });

      // move_file：移动/重命名工作区内文件
      tools.push({
        type: 'function',
        function: {
          name: 'move_file',
          description: '移动或重命名工作区内的文件/目录。',
          parameters: {
            type: 'object',
            properties: {
              source: { type: 'string', description: '源路径（相对于工作区）' },
              destination: { type: 'string', description: '目标路径（相对于工作区）' }
            },
            required: ['source', 'destination']
          }
        }
      });
    }

    if (allowedTools.includes('file_read')) {
      // glob：按模式匹配文件
      tools.push({
        type: 'function',
        function: {
          name: 'glob',
          description: '在工作区中按 glob 模式查找文件（支持 * ? **，** 跨目录）。用于确认文件是否存在、列举匹配文件。',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'glob 模式，如 "**/*.js" 或 "src/**/*.test.ts"（使用正斜杠）' }
            },
            required: ['pattern']
          }
        }
      });

      // grep：正则搜索
      tools.push({
        type: 'function',
        function: {
          name: 'grep',
          description: '在工作区中按正则表达式搜索文件内容，返回匹配的文件路径、行号与文本。',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: '正则表达式（大小写不敏感）' },
              path: { type: 'string', description: '可选：限定搜索的子目录（相对于工作区），默认搜索整个工作区' },
              maxResults: { type: 'number', description: '可选：最大返回条数，默认 100' }
            },
            required: ['pattern']
          }
        }
      });

      // web_fetch：抓取网页
      tools.push({
        type: 'function',
        function: {
          name: 'web_fetch',
          description: '抓取一个 http/https 网页内容（自动拒绝内网地址，SSRF 防护）。用于查阅在线文档、API 说明等。',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '要抓取的完整 URL，如 "https://example.com/doc"' }
            },
            required: ['url']
          }
        }
      });
    }

    // ask：向用户提问（Reasonix 风格问答卡，最多 4 题，每题 2-4 个选项）
    tools.push({
      type: 'function',
      function: {
        name: 'ask',
        description: '当需要用户在多个方案中选择、或需要关键决策输入时使用。向用户展示问题与选项，用户选择后返回答案文本。',
        parameters: {
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              description: '1-4 个问题，每题 { header: 短标签, question: 问题文本, options: [2-4 个选项字符串] }',
              items: {
                type: 'object',
                properties: {
                  header: { type: 'string', description: '简短标签，如 "方案"' },
                  question: { type: 'string', description: '问题全文' },
                  options: { type: 'array', items: { type: 'string' }, description: '2-4 个选项' }
                },
                required: ['question', 'options']
              }
            }
          },
          required: ['questions']
        }
      }
    });

    return tools;
  },

  getSystemPrompt(config) {
    const basePrompt = config.systemPrompt || '你是 MiMo 智能助手，专为代码开发和任务执行而设计。请使用中文回答。';
    return basePrompt + `

## 工具使用总则（必须遵守）

1. **仅在用户明确要求**执行命令、读写/搜索文件、访问网页、创建项目等实际操作时，才调用对应工具。
2. **纯聊天、问候、问答、闲聊、解释概念**：绝不调用任何工具，直接给出文字回答。
3. 一次调用能完成的事不要拆成多次；能直接回答的问题不要调用工具。
4. 工具调用必须服务于用户当前请求，禁止出于"演示"或"习惯"调用工具。

## 工具使用规则

### 当工具调用失败时，你必须：
1. **分析错误信息**：仔细阅读返回的 error 字段和 suggestion 字段
2. **识别错误类型**：根据 errorType 判断失败原因
3. **尝试修复**：
   - 如果是 \`path_security\`（路径越界），改用相对路径
   - 如果是 \`file_not_found\`，先创建目录或检查路径拼写
   - 如果是 \`blocked_by_whitelist\`，使用项目允许的命令
   - 如果是 \`port_in_use\`，尝试换一个端口
   - 如果是 \`shell_error\`，在 Windows 上用 cmd 命令，在 Linux/Mac 上用 bash 命令
   - 如果是 \`api_unavailable\`，等待片刻后重试
4. **重试策略**：一个工具失败后，自动修改参数再次调用，最多重试 3 次
5. **降级方案**：如果原工具持续失败，尝试使用其他工具组合实现相同目标
   - 例如 bash 不可用时，用 file_write 创建脚本再执行
   - 例如 file_write 失败时，用 bash 的 echo 命令写文件

### 参数格式
- bash: { "command": "命令", "cwd": "可选工作目录" }
- file_read: { "path": "文件路径" }
- file_write: { "path": "文件路径", "content": "文件内容" }
- file_edit: { "path": "文件路径", "old_string": "原字符串", "new_string": "新字符串" }

### 常见问题处理
- 创建 HTML 文件并用浏览器打开：先用 file_write 创建文件，再用 bash 的 start 命令（Windows）或 open 命令（Mac）打开
- 路径使用正斜杠或操作系统原生格式
- Windows 命令用 cmd 语法，如 \`start http://localhost\`、\`dir\`、\`type file.txt\`

### 失败日志系统
当工具调用失败时，返回结果中可能包含 \`failureLog\` 字段，这是系统自动记录的失败日志：
1. **仔细阅读 failureLog**：包含历史失败记录、错误类型统计、自动模式分析
2. **根据模式分析调整策略**：如果某种错误类型频繁出现，优先解决该类问题
3. **避免重复犯错**：不要用和之前失败的记录相同的参数再次调用
4. **日志会在成功后自动清空**：所以如果 failureLog 不为空，说明之前的尝试都失败了，必须改变策略`;
  },

  // 调用 /v1/models 拉取可用模型列表
  async fetchModels() {
    if (!window.api.listModels) return { success: false, error: 'Electron 接口不可用', models: [] };
    return window.api.listModels();
  }
};

window.MiMoAPI = MiMoAPI;
