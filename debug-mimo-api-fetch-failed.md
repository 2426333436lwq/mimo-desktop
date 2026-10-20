# Debug Session: mimo-api-fetch-failed

## Status: [CLOSED]

## Symptom
- **现象**: MiMo Assistant 桌面应用界面正常，但发送消息时显示 `Error invoking remote method 'mimo:chat': TypeError: fetch failed`

## 假设验证结果

| # | 假设 | 结果 | 证据 |
|---|------|------|------|
| H1 | 未配置 API | ❌ 排除 | config.json 中有 apiEndpoint 和 apiKey |
| H2 | API 地址格式错误 | ✅ **确证** | `api.mimo.com` 域名不存在（DNS 解析失败） |
| H3 | 网络连接问题 | ❌ 排除 | `api.xiaomimimo.com` 可达 |
| H4 | API 请求格式不兼容 | ⚠️ 部分确证 | 模型名 `mimo-3` 不支持，正确模型为 `mimo-v2.5` |
| H5 | Electron fetch 兼容性 | ❌ 排除 | 修正地址后 API 调用正常 |

## 证据

1. DNS 测试：`nslookup api.mimo.com` → `Non-existent domain`
2. 连通性测试：`curl api.xiaomimimo.com/v1/models` → HTTP 200
3. 模型列表：`mimo-v2.5`, `mimo-v2.5-pro`, `mimo-v2.5-tts` 等
4. 对话测试：`mimo-v2.5` 正常返回，含 `reasoning_content` 字段

## 修复

1. **修正 API 地址**：`api.mimo.com` → `api.xiaomimimo.com`
2. **修正模型名**：`mimo-3` → `mimo-v2.5`
3. **修正 maxTokens**：`1000000000000000000` → `4096`
4. **添加 reasoning_content 支持**：
   - main.js: 流式处理中收集 `reasoning_content`，通过 `mimo:reasoningChunk` 事件发送
   - preload.js: 添加 `onReasoningChunk` 监听
   - api.js: 添加 `onReasoning` 回调支持
   - chat.js: 消息对象添加 `reasoning` 字段，渲染为可折叠的思考过程区域
   - chat.css: 添加 `.reasoning-block` 样式

## 验证
- API 调用成功，返回正确响应
- 思考过程可折叠显示
