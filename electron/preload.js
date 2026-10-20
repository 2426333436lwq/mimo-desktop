const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),

  // Topics
  listTopics: () => ipcRenderer.invoke('topic:list'),
  loadTopic: (id) => ipcRenderer.invoke('topic:load', id),
  saveTopic: (topic) => ipcRenderer.invoke('topic:save', topic),
  deleteTopic: (id) => ipcRenderer.invoke('topic:delete', id),
  renameTopic: (topicId, title) => ipcRenderer.invoke('topic:rename', { topicId, title }),

  // Attachments
  saveAttachment: (name, dataUrl) => ipcRenderer.invoke('attachment:save', { name, dataUrl }),
  saveClipboardAttachment: (dataUrl) => ipcRenderer.invoke('attachment:saveClipboard', { dataUrl }),
  readClipboardImage: () => ipcRenderer.invoke('attachment:readClipboardImage'),
  getAttachmentPath: (filename) => ipcRenderer.invoke('attachment:path', filename),

  // 项目级权限配置（.mimo/permissions.json）
  loadProjectPermissions: () => ipcRenderer.invoke('permissions:loadProject'),
  saveProjectPermissions: (permissions) => ipcRenderer.invoke('permissions:saveProject', permissions),
  getPermissionsPath: () => ipcRenderer.invoke('permissions:getPath'),

  // Filesystem
  listFiles: (targetPath) => ipcRenderer.invoke('fs:list', targetPath),
  readFile: (targetPath) => ipcRenderer.invoke('fs:read', targetPath),
  writeFile: (targetPath, content) => ipcRenderer.invoke('fs:write', { targetPath, content }),
  mkdir: (targetPath) => ipcRenderer.invoke('fs:mkdir', targetPath),
  deletePath: (targetPath) => ipcRenderer.invoke('fs:delete', targetPath),
  resolvePath: (targetPath) => ipcRenderer.invoke('fs:resolve', targetPath),
  selectDirectory: () => ipcRenderer.invoke('fs:selectDirectory'),

  // 扩展工具（Reasonix 风格）
  glob: (pattern) => ipcRenderer.invoke('tool:glob', pattern),
  grep: (pattern, targetPath, maxResults) => ipcRenderer.invoke('tool:grep', { pattern, targetPath, maxResults }),
  webFetch: (url) => ipcRenderer.invoke('tool:webFetch', url),
  movePath: (source, destination) => ipcRenderer.invoke('fs:move', { source, destination }),

  // Checkpoint（文件写入/删除前自动备份 + 一键恢复）
  listCheckpoints: (targetPath) => ipcRenderer.invoke('fs:listCheckpoints', targetPath),
  restoreCheckpoint: (ts) => ipcRenderer.invoke('fs:restoreCheckpoint', ts),

  // Bash
  executeBash: (command, cwd) => ipcRenderer.invoke('bash:execute', { command, cwd }),
  onBashOutput: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('bash:output', handler);
    return () => ipcRenderer.removeListener('bash:output', handler);
  },

  // MiMo API
  chat: (messages, stream, tools, requestId) => ipcRenderer.invoke('mimo:chat', { messages, stream, tools, requestId }),
  abortChat: (requestId) => ipcRenderer.invoke('mimo:abort', requestId),
  onChunk: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('mimo:chunk', handler);
    return () => ipcRenderer.removeListener('mimo:chunk', handler);
  },
  onReasoningChunk: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('mimo:reasoningChunk', handler);
    return () => ipcRenderer.removeListener('mimo:reasoningChunk', handler);
  },
  onToolCall: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('mimo:toolCall', handler);
    return () => ipcRenderer.removeListener('mimo:toolCall', handler);
  },
  onFinish: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('mimo:finish', handler);
    return () => ipcRenderer.removeListener('mimo:finish', handler);
  },

  // Shell
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('shell:showItemInFolder', targetPath),

  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  pinWindow: (shouldPin) => ipcRenderer.invoke('window:pin', shouldPin),

  // 技能库
  listSkills: () => ipcRenderer.invoke('skills:list'),

  // 缓存管理
  getCacheSize: () => ipcRenderer.invoke('cache:size'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),

  // 模型列表
  listModels: () => ipcRenderer.invoke('models:list'),

  // 托盘/快捷键事件监听
  onTrayNewTopic: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('tray:newTopic', handler);
    return () => ipcRenderer.removeListener('tray:newTopic', handler);
  },
  onShortcutSend: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('shortcut:send', handler);
    return () => ipcRenderer.removeListener('shortcut:send', handler);
  },
  onShortcutNewTopic: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('shortcut:newTopic', handler);
    return () => ipcRenderer.removeListener('shortcut:newTopic', handler);
  },
  onShortcutSave: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('shortcut:save', handler);
    return () => ipcRenderer.removeListener('shortcut:save', handler);
  },
  onShortcutClosePreview: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('shortcut:closePreview', handler);
    return () => ipcRenderer.removeListener('shortcut:closePreview', handler);
  }
});
