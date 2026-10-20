const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, nativeImage, Tray, Menu, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, execSync, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

let mainWindow = null;
let tray = null;
let isQuiting = false;
let _closeHintShown = false; // 关闭提示是否已显示过
const childProcesses = []; // 追踪所有子进程

// 将数据目录重定向到项目根目录下的 data/，避免占用 C 盘
const projectDataDir = path.resolve(__dirname, '../data');
// 使用 app.setPath 覆盖 Electron 默认的 userData 路径
try {
  app.setPath('userData', projectDataDir);
} catch (e) {
  // 如果已经设置过则忽略
}
const userDataDir = projectDataDir;
const configPath = path.join(userDataDir, 'config.json');
const topicsDir = path.join(userDataDir, 'topics');
const attachmentsDir = path.join(userDataDir, 'attachments');

// 迁移旧版本 C 盘数据到项目目录
function migrateOldData() {
  const oldDir = path.join(os.homedir(), 'AppData', 'Roaming', 'mimo-assistant');
  if (!fs.existsSync(oldDir)) return;
  
  let migrated = false;
  try {
    // 迁移配置文件
    const oldConfig = path.join(oldDir, 'config.json');
    if (fs.existsSync(oldConfig) && !fs.existsSync(configPath)) {
      fs.copyFileSync(oldConfig, configPath);
      migrated = true;
      console.log('[Migration] 已迁移 config.json');
    }
    
    // 迁移话题数据
    const oldTopics = path.join(oldDir, 'topics');
    if (fs.existsSync(oldTopics)) {
      const files = fs.readdirSync(oldTopics);
      files.forEach(f => {
        const src = path.join(oldTopics, f);
        const dst = path.join(topicsDir, f);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
          migrated = true;
        }
      });
      if (migrated) console.log('[Migration] 已迁移话题数据');
    }
    
    // 迁移附件
    const oldAttachments = path.join(oldDir, 'attachments');
    if (fs.existsSync(oldAttachments)) {
      const files = fs.readdirSync(oldAttachments);
      files.forEach(f => {
        const src = path.join(oldAttachments, f);
        const dst = path.join(attachmentsDir, f);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
          migrated = true;
        }
      });
      if (migrated) console.log('[Migration] 已迁移附件数据');
    }
  } catch (e) {
    console.error('[Migration] 迁移失败:', e.message);
  }
}

migrateOldData();

// 立即清理 C 盘中的所有旧数据（在 app.whenReady 之前执行，避免文件被占用）
clearOldCaches();

function clearOldCaches() {
  const oldDir = path.join(os.homedir(), 'AppData', 'Roaming', 'mimo-assistant');
  if (!fs.existsSync(oldDir)) return;
  
  try {
    let cleaned = 0;
    // 递归删除所有子目录和文件（除了 config.json 和 topics 已迁移的）
    const allItems = fs.readdirSync(oldDir);
    for (const item of allItems) {
      const itemPath = path.join(oldDir, item);
      try {
        const stat = fs.statSync(itemPath);
        if (stat.isDirectory()) {
          // 跳过已迁移的 topics 目录（保留数据）
          if (item === 'topics') {
            // 复制新的 topics 到项目目录后再删除
            const files = fs.readdirSync(itemPath);
            for (const f of files) {
              const src = path.join(itemPath, f);
              const dst = path.join(topicsDir, f);
              if (fs.existsSync(src) && !fs.existsSync(dst)) {
                try { fs.copyFileSync(src, dst); } catch {}
              }
            }
          }
          // 删除目录
          fs.rmSync(itemPath, { recursive: true, force: true });
          cleaned++;
        } else {
          // 文件 - 跳过 config.json（已迁移）
          if (item === 'config.json') {
            const dst = path.join(projectDataDir, 'config.json');
            if (!fs.existsSync(dst)) {
              try { fs.copyFileSync(itemPath, dst); } catch {}
            }
          }
          fs.unlinkSync(itemPath);
          cleaned++;
        }
      } catch (e) {
        // 忽略占用的文件
        console.log(`[Cache] 无法删除 ${item}: ${e.message}`);
      }
    }
    
    // 如果目录为空，删除整个目录
    try {
      const remaining = fs.readdirSync(oldDir);
      if (remaining.length === 0) {
        fs.rmSync(oldDir, { recursive: true, force: true });
        console.log('[Cache] 已清理旧缓存并删除空目录');
      } else {
        console.log(`[Cache] 已清理 ${cleaned} 项，保留 ${remaining.length} 个文件/目录`);
      }
    } catch (e) {
      // 忽略
    }
  } catch (e) {
    console.error('[Cache] 清理失败:', e.message);
  }
}

// 项目级权限配置文件路径（位于工作区下的 .mimo/permissions.json）
function getProjectPermissionsPath(sandboxPath) {
  if (!sandboxPath) return null;
  return path.join(sandboxPath, '.mimo', 'permissions.json');
}

// 路径安全检查：确保 resolvedPath 在 basePath 内，防止路径穿越
function isPathSafe(resolvedPath, basePath) {
  const normalizedBase = path.resolve(basePath);
  const normalizedTarget = path.resolve(resolvedPath);
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(normalizedBase + path.sep);
}

function resolveSafePath(targetPath, basePath) {
  const resolved = path.resolve(basePath, targetPath);
  if (!isPathSafe(resolved, basePath)) {
    return null;
  }
  return resolved;
}

// 读取项目级权限配置（不存在则返回 null，表示未配置=全部允许，向后兼容）
function loadProjectPermissions(sandboxPath) {
  const permPath = getProjectPermissionsPath(sandboxPath);
  if (!permPath || !fs.existsSync(permPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(permPath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveProjectPermissions(sandboxPath, permissions) {
  const permPath = getProjectPermissionsPath(sandboxPath);
  if (!permPath) return { error: '未配置工作区路径' };
  ensureDir(path.dirname(permPath));
  fs.writeFileSync(permPath, JSON.stringify(permissions, null, 2), 'utf-8');
  return { success: true };
}

// 检查 bash 命令是否被项目权限白名单允许
function isBashAllowed(command, projectPerms) {
  if (!projectPerms) return true; // 未配置项目权限 = 全部允许（向后兼容）
  if (projectPerms.bashAllowAll === true) return true;
  const whitelist = projectPerms.bashCommandWhitelist || [];
  if (whitelist.length === 0) return false;
  const trimmedCmd = command.trim();
  // 精确匹配 或 前缀匹配（支持白名单命令后跟参数/管道）
  return whitelist.some(allowed => {
    const a = allowed.trim();
    return trimmedCmd === a || trimmedCmd.startsWith(a + ' ');
  });
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

ensureDir(topicsDir);
ensureDir(attachmentsDir);

function loadConfig() {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      // ignore
    }
  }
  return {
    apiEndpoint: '',
    apiKey: '',
    model: 'mimo-v2.5',
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: '你是 MiMo 智能助手，专为代码开发和任务执行而设计。请使用中文回答。',
    allowedTools: ['bash', 'file_edit', 'file_read', 'file_write'],
    approvalMode: 'ask', // 'ask' | 'auto' | 'yolo'
    permissionRules: { deny: [], ask: [], allow: [] },
    sandboxPath: path.join(os.homedir(), 'mimo-workspace'),
    showReasoning: true,
    theme: 'dark',
    fontSize: 13,
    autoFetchModels: true
  };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error('保存配置失败:', err);
    return { success: false, error: err.message };
  }
}

// MiMo 专属图标（PNG 内嵌 Base64 - 由 generate-icon.js 生成）
// 回退 SVG 图标
const MIMO_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <path d="M128 368V144L256 256L384 144V368" stroke="white" stroke-width="36" stroke-linejoin="round" stroke-linecap="round" fill="none"/>
  <circle cx="256" cy="368" r="24" fill="white"/>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop stop-color="#667EEA"/>
      <stop offset="1" stop-color="#764BA2"/>
    </linearGradient>
  </defs>
</svg>
`;

// 创建 MiMo 图标（优先使用 PNG 文件，回退到 SVG）
function createMimoIcon() {
  // 优先使用 build/icon.png
  const pngPath = path.join(__dirname, '../build/icon.png');
  if (fs.existsSync(pngPath)) {
    try {
      const icon = nativeImage.createFromPath(pngPath);
      if (!icon.isEmpty()) {
        console.log('[Icon] 使用 PNG 图标:', pngPath);
        return icon;
      }
    } catch (e) {
      console.log('[Icon] PNG 加载失败:', e.message);
    }
  }
  
  // 回退到 SVG Data URL（Windows 上可能不支持，但作为兜底）
  try {
    const base64 = Buffer.from(MIMO_ICON_SVG).toString('base64');
    const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${base64}`);
    if (!icon.isEmpty()) {
      console.log('[Icon] 使用 SVG 回退图标');
      return icon;
    }
  } catch (e) {
    console.log('[Icon] SVG 加载失败:', e.message);
  }
  
  // 最后兜底：返回空图标
  console.log('[Icon] 使用空图标');
  return nativeImage.createEmpty();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'MiMo Assistant',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    },
    icon: createMimoIcon()
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 关闭时最小化到托盘（而非直接退出）
  mainWindow.on('close', (event) => {
    if (!isQuiting) {
      event.preventDefault();
      mainWindow.hide();
      // 显示提示用户如何真正退出
      if (!_closeHintShown) {
        _closeHintShown = true;
        setTimeout(() => {
          if (tray) {
            tray.displayToolTip('MiMo 已最小化到托盘 · 右键托盘图标可退出');
          }
        }, 500);
      }
    }
  });

  createTray();
  registerShortcuts();
}

// ===== 系统托盘 =====
function createTray() {
  // 使用 MiMo 专属图标
  let trayIcon = createMimoIcon();

  tray = new Tray(trayIcon);
  tray.setToolTip('MiMo Assistant');

  const contextMenu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: '新建会话', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.webContents.send('tray:newTopic'); } } },
    { label: '清空缓存', click: () => clearCacheData() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuiting = true; cleanupAndQuit(); } }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// ===== 全局快捷键 =====
function registerShortcuts() {
  // Ctrl+Enter 发送消息（由渲染进程处理）
  globalShortcut.register('CommandOrControl+Enter', () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.webContents.send('shortcut:send');
    }
  });

  // Ctrl+N 新建会话
  globalShortcut.register('CommandOrControl+N', () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.webContents.send('shortcut:newTopic');
    }
  });

  // Ctrl+S 保存当前对话
  globalShortcut.register('CommandOrControl+S', () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.webContents.send('shortcut:save');
    }
  });

  // Ctrl+W 关闭右侧面板预览
  globalShortcut.register('CommandOrControl+W', () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.webContents.send('shortcut:closePreview');
    }
  });

  // Alt+F4 或 Ctrl+Shift+Q 真正退出应用
  globalShortcut.register('CommandOrControl+Alt+Q', () => {
    isQuiting = true;
    cleanupAndQuit();
  });
}

app.whenReady().then(createWindow);

// 杀死所有子进程（Windows 用 taskkill /T 杀进程树）
function killAllChildProcesses() {
  const isWin = process.platform === 'win32';
  let killed = 0;
  while (childProcesses.length > 0) {
    const child = childProcesses.pop();
    if (!child || child.killed) continue;
    try {
      if (isWin && child.pid) {
        // Windows: taskkill /F /T /PID <pid> 杀死进程及其所有子进程
        execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'pipe', timeout: 5000 });
      } else {
        // Unix: 发 SIGTERM 给进程组
        try { process.kill(-child.pid, 'SIGTERM'); } catch {
          try { child.kill('SIGTERM'); } catch {}
        }
      }
      killed++;
    } catch {
      // 兜底：强制杀死
      try { child.kill('SIGKILL'); } catch {}
      killed++;
    }
  }
  if (killed > 0) console.log(`[Cleanup] 已杀死 ${killed} 个子进程`);
}

// 退出前清理所有子进程
function cleanupAndQuit() {
  console.log('[Cleanup] 开始清理子进程...');
  killAllChildProcesses();
  try {
    globalShortcut.unregisterAll();
  } catch {}
  // 使用 app.quit() 触发 will-quit 事件（而不是直接 process.exit）
  app.quit();
}

app.on('before-quit', () => {
  isQuiting = true;
});

app.on('window-all-closed', () => {
  // 在 macOS 上，应用通常保持活动状态直到用户明确退出
  if (process.platform === 'darwin') {
    app.dock.hide();
  } else {
    isQuiting = true;
    cleanupAndQuit();
  }
});

app.on('will-quit', () => {
  killAllChildProcesses();
  try { globalShortcut.unregisterAll(); } catch {}
  // 退出时清理 C 盘旧缓存（此时文件已释放）
  try { clearOldCaches(); } catch {}
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ===== IPC: Config =====
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_event, config) => {
  return saveConfig(config);
});

// ===== IPC: Topics =====
ipcMain.handle('topic:list', () => {
  const files = fs.readdirSync(topicsDir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(topicsDir, f), 'utf-8'));
      return {
        id: data.id,
        title: data.title,
        type: data.type || 'chat',
        pinned: !!data.pinned,
        updatedAt: data.updatedAt,
        createdAt: data.createdAt,
        titleSource: data.titleSource || 'auto',
        autoTitleMeta: data.autoTitleMeta || null,
        messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
        // 最近一条消息预览（供搜索/展示）
        preview: (() => {
          const msgs = Array.isArray(data.messages) ? data.messages : [];
          const last = msgs[msgs.length - 1];
          return last && last.content ? String(last.content).slice(0, 120) : '';
        })()
      };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => {
    // 置顶优先，再按更新时间
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
});

ipcMain.handle('topic:load', (_event, topicId) => {
  // 防路径穿越：topicId 只允许普通文件名字符
  const safeName = String(topicId || '').replace(/[\\/]/g, '');
  const filePath = path.join(topicsDir, `${safeName}.json`);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      // 损坏的话题文件：返回 null，前端回退到新会话而不是崩溃
      return null;
    }
  }
  return null;
});

ipcMain.handle('topic:save', (_event, topic) => {
  const safeId = String(topic && topic.id || '').replace(/[\\/]/g, '');
  if (!safeId) return { error: '无效的话题 ID' };
  const filePath = path.join(topicsDir, `${safeId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(topic, null, 2), 'utf-8');
  return { success: true };
});

// 手动重命名话题（标记 titleSource='manual'，清空 autoTitleMeta 避免后续自动覆盖）
ipcMain.handle('topic:rename', (_event, { topicId, title }) => {
  const safeId = String(topicId || '').replace(/[\\/]/g, '');
  const filePath = path.join(topicsDir, `${safeId}.json`);
  if (!fs.existsSync(filePath)) return { error: '话题不存在' };
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    data.title = title;
    data.titleSource = 'manual';
    data.autoTitleMeta = null;
    data.updatedAt = Date.now();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true, title: data.title, titleSource: data.titleSource };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('topic:delete', (_event, topicId) => {
  const safeId = String(topicId || '').replace(/[\\/]/g, '');
  const filePath = path.join(topicsDir, `${safeId}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  return { success: true };
});

// ===== IPC: Attachments =====
// 生成 reasonix 风格剪贴板附件文件名：clipboard-yyyyMMdd-HHmmss.ffffff-NNNNNN.ext
function generateClipboardFilename(ext) {
  const now = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const yyyy = now.getFullYear();
  const MM = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const HH = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  // 微秒（process.hrtime 提供纳秒，取前 6 位作为微秒近似）
  const hr = process.hrtime();
  const ffffff = pad(hr[1] % 1000000, 6);
  // 扫描目录中已有 clipboard- 文件的最大序号
  let maxSeq = 0;
  try {
    const files = fs.readdirSync(attachmentsDir);
    for (const f of files) {
      const m = f.match(/^clipboard-\d{8}-\d{6}\.\d{6}-(\d{6})\./);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    }
  } catch { /* ignore */ }
  const seq = pad(maxSeq + 1, 6);
  return `clipboard-${yyyy}${MM}${dd}-${HH}${mm}${ss}.${ffffff}-${seq}.${ext}`;
}

ipcMain.handle('attachment:save', (_event, { name, dataUrl }) => {
  // 校验 dataUrl 必须是合法的图片 base64（防任意内容写出垃圾文件）
  const m = String(dataUrl || '').match(/^data:image\/([\w+.-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { error: '无效的图片数据（dataUrl 格式不正确）' };
  // ext 清洗：只保留字母数字，防路径穿越
  const ext = String(name.split('.').pop() || m[1] || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const id = uuidv4();
  const filename = `${id}.${ext}`;
  const filePath = path.join(attachmentsDir, filename);
  fs.writeFileSync(filePath, Buffer.from(m[2], 'base64'));
  return { id, name: filename, path: filePath };
});

// 剪贴板粘贴附件（reasonix 风格命名：clipboard-yyyyMMdd-HHmmss.ffffff-NNNNNN）
ipcMain.handle('attachment:saveClipboard', (_event, { dataUrl }) => {
  const m = String(dataUrl || '').match(/^data:image\/([\w+.-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { error: '无效的图片数据（dataUrl 格式不正确）' };
  let ext = m[1] === 'jpeg' ? 'jpg' : m[1].replace(/[^a-z0-9]/g, '') || 'png';
  const filename = generateClipboardFilename(ext);
  const filePath = path.join(attachmentsDir, filename);
  fs.writeFileSync(filePath, Buffer.from(m[2], 'base64'));
  return { id: filename, name: filename, path: filePath };
});

// 从系统剪贴板直接读取图片（用于跨进程粘贴）
ipcMain.handle('attachment:readClipboardImage', () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return { empty: true };
  const dataUrl = img.toDataURL();
  return { dataUrl };
});

ipcMain.handle('attachment:path', (_event, filename) => {
  // 防路径穿越：只接受纯文件名
  const safeName = String(filename || '').replace(/[\\/]/g, '');
  return path.join(attachmentsDir, safeName);
});

// ===== Checkpoint：文件写入/删除前自动备份（Reasonix Checkpoints） =====
function checkpointDir(basePath) {
  return path.join(basePath, '.mimo', 'checkpoints');
}
function loadCheckpointManifest(basePath) {
  const mf = path.join(checkpointDir(basePath), 'index.json');
  try {
    if (fs.existsSync(mf)) return JSON.parse(fs.readFileSync(mf, 'utf-8'));
  } catch { /* 损坏则重建 */ }
  return [];
}
function saveCheckpointManifest(basePath, list) {
  const dir = checkpointDir(basePath);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(list, null, 2), 'utf-8');
  // 裁剪：仅保留最近 200 条，删除最旧备份文件
  while (list.length > 200) {
    const old = list.shift();
    try { fs.unlinkSync(path.join(dir, old.file)); } catch {}
  }
}
// 备份指定文件到 .mimo/checkpoints，返回时间戳（失败返回 null）
function backupForCheckpoint(basePath, resolved) {
  try {
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
    const rel = path.relative(basePath, resolved).replace(/\\/g, '/');
    if (!rel || rel.startsWith('.mimo')) return null;
    const list = loadCheckpointManifest(basePath);
    const dir = checkpointDir(basePath);
    ensureDir(dir);
    const ts = Date.now();
    const file = `cp-${ts}-${list.length}.bak`;
    fs.copyFileSync(resolved, path.join(dir, file));
    list.push({ ts, file, path: rel });
    saveCheckpointManifest(basePath, list);
    return ts;
  } catch { return null; }
}

ipcMain.handle('fs:listCheckpoints', (_event, targetPath) => {
  const config = loadConfig();
  const base = config.sandboxPath || os.homedir();
  const rel = targetPath
    ? path.relative(base, path.resolve(base, targetPath)).replace(/\\/g, '/')
    : null;
  const list = loadCheckpointManifest(base);
  return list
    .filter(c => !rel || c.path === rel)
    .slice(-20)
    .reverse()
    .map(c => ({ ts: c.ts, path: c.path, time: new Date(c.ts).toLocaleString('zh-CN') }));
});

ipcMain.handle('fs:restoreCheckpoint', (_event, ts) => {
  const config = loadConfig();
  const base = config.sandboxPath || os.homedir();
  const list = loadCheckpointManifest(base);
  const item = list.find(c => c.ts === ts);
  if (!item) return { error: '备份不存在' };
  const filePath = path.join(checkpointDir(base), item.file);
  if (!fs.existsSync(filePath)) return { error: '备份文件已丢失' };
  const resolved = resolveSafePath(item.path, base);
  if (!resolved) return { error: '备份路径越界' };
  ensureDir(path.dirname(resolved));
  fs.copyFileSync(filePath, resolved);
  return { success: true, path: item.path };
});

// ===== IPC: Filesystem =====
ipcMain.handle('fs:list', (_event, targetPath) => {
  try {
    const config = loadConfig();
    const basePath = config.sandboxPath || os.homedir();
    const resolved = targetPath ? path.resolve(basePath, targetPath) : basePath;
    // 路径安全：禁止越出工作区（防 ../ 和绝对路径跳转）
    if (!isPathSafe(resolved, basePath)) return { error: '路径越界：不允许访问工作区外的目录' };
    const items = fs.readdirSync(resolved, { withFileTypes: true });
    return {
      path: resolved,
      items: items.map(item => {
        let size = 0;
        if (item.isFile()) {
          try { size = fs.statSync(path.join(resolved, item.name)).size; } catch { /* 忽略损坏的条目 */ }
        }
        return {
          name: item.name,
          isDir: item.isDirectory(),
          isFile: item.isFile(),
          size
        };
      })
    };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:read', (_event, targetPath) => {
  try {
    const config = loadConfig();
    const basePath = config.sandboxPath || os.homedir();
    const resolved = resolveSafePath(targetPath, basePath);
    if (!resolved) return { error: '路径越界：不允许访问工作区外的文件' };
    const content = fs.readFileSync(resolved, 'utf-8');
    return { content, path: resolved };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:write', (_event, { targetPath, content }) => {
  try {
    const config = loadConfig();
    const basePath = config.sandboxPath || os.homedir();
    const resolved = resolveSafePath(targetPath, basePath);
    if (!resolved) return { error: '路径越界：不允许访问工作区外的文件' };
    // checkpoint：写入前备份旧内容（仅当内容确实变化）
    if (fs.existsSync(resolved)) {
      try {
        if (fs.readFileSync(resolved, 'utf-8') !== String(content)) backupForCheckpoint(basePath, resolved);
      } catch { /* 二进制或不可读则跳过备份 */ }
    }
    ensureDir(path.dirname(resolved));
    fs.writeFileSync(resolved, content, 'utf-8');
    return { success: true, path: resolved };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:mkdir', (_event, targetPath) => {
  try {
    const config = loadConfig();
    const basePath = config.sandboxPath || os.homedir();
    const resolved = resolveSafePath(targetPath, basePath);
    if (!resolved) return { error: '路径越界：不允许在工作区外创建目录' };
    ensureDir(resolved);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:delete', (_event, targetPath) => {
  try {
    const config = loadConfig();
    const basePath = config.sandboxPath || os.homedir();
    const resolved = resolveSafePath(targetPath, basePath);
    if (!resolved) return { error: '路径越界：不允许访问工作区外的文件' };
    const stat = fs.statSync(resolved);
    // checkpoint：删除文件前备份，支持一键恢复
    if (stat.isFile()) backupForCheckpoint(basePath, resolved);
    if (stat.isDirectory()) {
      fs.rmSync(resolved, { recursive: true, force: true });
    } else {
      fs.unlinkSync(resolved);
    }
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:resolve', (_event, targetPath) => {
  const config = loadConfig();
  const basePath = config.sandboxPath || os.homedir();
  const resolved = targetPath ? path.resolve(basePath, targetPath) : basePath;
  if (!isPathSafe(resolved, basePath)) return null; // 越界不返回路径
  return resolved;
});

ipcMain.handle('fs:selectDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// ===== IPC: 扩展工具（Reasonix 风格 glob / grep / web_fetch / move） =====
// glob 分段匹配（支持 * ? **，** 跨目录）
function matchGlobSegment(pat, seg) {
  let re = '';
  for (const ch of pat) {
    if (ch === '*') re += '[^/\\\\]*';
    else if (ch === '?') re += '[^/\\\\]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  try { return new RegExp('^' + re + '$').test(seg); } catch { return false; }
}

function matchGlobPattern(pattern, relPath) {
  const p = String(pattern || '').replace(/\\/g, '/');
  const s = String(relPath || '').replace(/\\/g, '/');
  if (!p) return false;
  const pSegs = p.split('/');
  const sSegs = s.split('/');
  const memo = new Map();
  const match = (i, j) => {
    const key = i * 4096 + j;
    if (memo.has(key)) return memo.get(key);
    let res;
    if (i === pSegs.length) res = j === sSegs.length;
    else if (pSegs[i] === '**') res = match(i + 1, j) || (j < sSegs.length && match(i, j + 1));
    else res = j < sSegs.length && matchGlobSegment(pSegs[i], sSegs[j]) && match(i + 1, j + 1);
    memo.set(key, res);
    return res;
  };
  return match(0, 0);
}

// 递归遍历工作区（限制深度/数量/忽略常见大目录）
function walkWorkspace(base, maxDepth, maxFiles) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === '.mimo' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else {
        out.push(path.relative(base, full).replace(/\\/g, '/'));
        if (out.length >= maxFiles) return;
      }
    }
  };
  walk(base, 0);
  return out;
}

ipcMain.handle('tool:glob', (_event, pattern) => {
  try {
    const config = loadConfig();
    const base = config.sandboxPath || os.homedir();
    if (!fs.existsSync(base)) return { error: '工作区不存在', matches: [] };
    const all = walkWorkspace(base, 8, 5000);
    const matches = all.filter(f => matchGlobPattern(pattern, f)).slice(0, 500);
    return { matches };
  } catch (e) {
    return { error: e.message, matches: [] };
  }
});

ipcMain.handle('tool:grep', (_event, { pattern, targetPath, maxResults = 100 }) => {
  return new Promise((resolve) => {
    try {
      const config = loadConfig();
      const base = config.sandboxPath || os.homedir();
      let re;
      try { re = new RegExp(pattern, 'i'); } catch { return resolve({ error: `无效正则: ${pattern}`, results: [] }); }
      const root = targetPath ? resolveSafePath(targetPath, base) : base;
      if (!root || !isPathSafe(root, base)) return resolve({ error: '路径越界', results: [] });
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return resolve({ error: '目录不存在', results: [] });

      const results = [];
      const MAX_FILE_SIZE = 1024 * 1024; // 跳过 >1MB 文件
      const walk = (dir, depth) => {
        if (depth > 6 || results.length >= maxResults) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (e.name === '.git' || e.name === 'node_modules' || e.name === '.mimo' || e.name.startsWith('.')) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            walk(full, depth + 1);
          } else {
            try {
              const stat = fs.statSync(full);
              if (stat.size > MAX_FILE_SIZE) continue;
              const content = fs.readFileSync(full, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (re.test(lines[i])) {
                  results.push({ path: path.relative(base, full).replace(/\\/g, '/'), line: i + 1, content: lines[i].slice(0, 300) });
                  if (results.length >= maxResults) return;
                }
              }
            } catch { /* 跳过不可读/二进制文件 */ }
          }
        }
      };
      walk(root, 0);
      resolve({ results });
    } catch (e) {
      resolve({ error: e.message, results: [] });
    }
  });
});

// SSRF 防护：拒绝内网/环回/链路本地地址
const dns = require('dns');
function isPrivateAddress(hostname) {
  // IPv6 环回与链路本地
  if (hostname === '::1' || hostname === 'localhost' || hostname === '0.0.0.0') return true;
  const ipv6 = hostname.includes(':');
  if (ipv6) return true; // 简化为拒绝一切 IPv6 字面量（稳妥）
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

async function lookupIsPrivate(hostname) {
  try {
    const { address } = await dns.promises.lookup(hostname, { all: false });
    return isPrivateAddress(address);
  } catch {
    return true; // 解析失败按不安全处理
  }
}

ipcMain.handle('tool:webFetch', async (_event, url) => {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: '仅支持 http/https 协议' };
    }
    // SSRF：域名/IP 内网检查
    const hostname = parsed.hostname;
    if (isPrivateAddress(hostname)) return { error: `拒绝访问内网地址: ${hostname}` };
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      if (await lookupIsPrivate(hostname)) return { error: `拒绝访问内网地址: ${hostname}` };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    const text = await res.text();
    return { status: res.status, url: res.url, content: text.slice(0, 100000) };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:move', (_event, { source, destination }) => {
  try {
    const config = loadConfig();
    const base = config.sandboxPath || os.homedir();
    const src = resolveSafePath(source, base);
    const dst = resolveSafePath(destination, base);
    if (!src || !dst) return { error: '路径越界：不允许在工作区外移动文件' };
    if (!fs.existsSync(src)) return { error: '源文件不存在' };
    ensureDir(path.dirname(dst));
    fs.renameSync(src, dst);
    return { success: true, path: dst };
  } catch (e) {
    return { error: e.message };
  }
});

// ===== IPC: Bash =====
ipcMain.handle('bash:execute', async (_event, { command, cwd }) => {
  return new Promise((resolve) => {
    const config = loadConfig();
    const basePath = config.sandboxPath || os.homedir();
    const workDir = cwd ? path.resolve(basePath, cwd) : basePath;

    // 确保 workDir 在 sandbox 内
    if (!isPathSafe(workDir, basePath)) {
      resolve({
        exitCode: -1,
        stdout: '',
        stderr: '工作目录越界：不允许在工作区外执行命令',
        cwd: workDir,
        blocked: true
      });
      return;
    }

    // 项目级命令白名单检查（reasonix 式精细授权）
    const projectPerms = loadProjectPermissions(basePath);
    if (!isBashAllowed(command, projectPerms)) {
      resolve({
        exitCode: -1,
        stdout: '',
        stderr: `命令不在项目权限白名单中: ${command}\n(白名单位于 ${path.join(basePath, '.mimo', 'permissions.json')})`,
        cwd: workDir,
        blocked: true
      });
      return;
    }

    const isWin = process.platform === 'win32';
    const shell = isWin ? 'cmd.exe' : '/bin/bash';
    const args = isWin ? ['/c', command] : ['-c', command];

    let output = '';
    let errorOutput = '';
    let outputTruncated = false;
    let timedOut = false;
    const MAX_OUTPUT = 8 * 1024 * 1024; // 输出上限，防止内存泄漏（spawn 的 maxBuffer 不生效）

    const child = spawn(shell, args, {
      cwd: workDir,
      env: { ...process.env }
    });
    childProcesses.push(child);
    const onChildGone = () => {
      const idx = childProcesses.indexOf(child);
      if (idx >= 0) childProcesses.splice(idx, 1);
    };
    child.on('close', onChildGone);
    child.on('error', onChildGone);

    // 手动超时：120s 后杀整个进程树（spawn 的 timeout 只杀直接子进程，Windows 上会留孤儿孙进程）
    const killTimer = setTimeout(() => {
      timedOut = true;
      try {
        if (isWin && child.pid) {
          execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'pipe', timeout: 3000 });
        } else {
          try { process.kill(-child.pid, 'SIGTERM'); } catch {
            try { child.kill('SIGKILL'); } catch {}
          }
        }
      } catch { /* 进程可能已退出 */ }
    }, 120000);

    child.stdout.on('data', (data) => {
      const text = data.toString();
      if (output.length + text.length <= MAX_OUTPUT) {
        output += text;
      } else {
        outputTruncated = true;
      }
      // 实时推送输出到前端
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bash:output', { type: 'stdout', content: text });
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bash:output', { type: 'stderr', content: text });
      }
    });

    child.on('close', (code) => {
      clearTimeout(killTimer);
      resolve({
        exitCode: code,
        stdout: output,
        stderr: errorOutput,
        cwd: workDir,
        timedOut,
        outputTruncated
      });
    });

    child.on('error', (err) => {
      clearTimeout(killTimer);
      resolve({
        exitCode: -1,
        stdout: output,
        stderr: `Failed to start: ${err.message}`,
        cwd: workDir,
        timedOut
      });
    });
  });
});

// ===== IPC: 项目级权限配置（.mimo/permissions.json，对应 reasonix.toml）=====
ipcMain.handle('permissions:loadProject', () => {
  const config = loadConfig();
  const basePath = config.sandboxPath || os.homedir();
  const perms = loadProjectPermissions(basePath);
  return perms || {
    bashAllowAll: true,
    bashCommandWhitelist: [],
    editAllowed: true,
    fileWriteAllowed: true
  };
});

ipcMain.handle('permissions:saveProject', (_event, permissions) => {
  const config = loadConfig();
  const basePath = config.sandboxPath || os.homedir();
  return saveProjectPermissions(basePath, permissions);
});

ipcMain.handle('permissions:getPath', () => {
  const config = loadConfig();
  const basePath = config.sandboxPath || os.homedir();
  return getProjectPermissionsPath(basePath);
});

// ===== IPC: MiMo API =====
// 进行中的流式请求注册表：requestId -> AbortController（支持"停止生成"）
const activeChatRequests = new Map();

// fetch 封装：网络级错误（TypeError: fetch failed）自动重试，abort/HTTP 错误不重试
async function fetchWithRetry(url, options, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      if (attempt >= retries || options.signal?.aborted || e.name === 'AbortError') throw e;
      console.warn(`[MiMo] fetch 失败，第 ${attempt + 1} 次重试: ${e.message}`);
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

ipcMain.handle('mimo:chat', async (_event, { messages, stream = true, tools = null, requestId = null }) => {
  const config = loadConfig();
  if (!config.apiEndpoint || !config.apiKey) {
    return { error: '请先在设置中配置 MiMo API 地址和密钥' };
  }

  const controller = new AbortController();
  if (requestId) activeChatRequests.set(requestId, controller);

  // 统一事件推送：窗口销毁时静默跳过 + 携带 requestId 供前端过滤（防事件串流）
  const sendToRenderer = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, { ...payload, requestId });
    }
  };

  const endpoint = config.apiEndpoint.replace(/\/$/, '');
  const url = `${endpoint}/chat/completions`;

  // 将前端消息格式转换为 API 格式
  const apiMessages = messages.map(msg => {
    const apiMsg = { role: msg.role, content: msg.content };
    // tool 消息需要 tool_call_id 字段
    if (msg.role === 'tool' && msg.toolCallId) {
      apiMsg.tool_call_id = msg.toolCallId;
    }
    // assistant 消息的 tool_calls（前端用 toolCalls，API 用 tool_calls）
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      apiMsg.tool_calls = msg.toolCalls;
    }
    return apiMsg;
  });

  const body = {
    model: config.model || 'mimo-v2.5',
    messages: apiMessages,
    temperature: config.temperature ?? 0.7,
    max_tokens: config.maxTokens ?? 4096,
    stream
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  if (!stream) {
    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        return { error: `API 错误 ${response.status}: ${text}` };
      }

      const data = await response.json();
      return { choices: data.choices, usage: data.usage };
    } catch (e) {
      if (controller.signal.aborted || e.name === 'AbortError') {
        return { aborted: true };
      }
      return { error: e.message };
    } finally {
      if (requestId) activeChatRequests.delete(requestId);
    }
  }

  // Streaming mode
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body),
    signal: controller.signal
  });

  if (!response.ok) {
    if (requestId) activeChatRequests.delete(requestId);
    const text = await response.text();
    return { error: `API 错误 ${response.status}: ${text}` };
  }

  let idleTimer = null;
  try {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let fullReasoning = '';
  let toolCallsMap = {};  // 使用对象而不是数组来存储 tool calls

  // 空闲超时：长时间无新数据自动中止，防止生成永久挂起导致前端 isGenerating 卡死
  // （Reasonix mcp_call_timeout 语义；此处 120s 无数据视为异常）
  let lastActivity = Date.now();
  idleTimer = setInterval(() => {
    if (Date.now() - lastActivity > 120000) {
      clearInterval(idleTimer);
      console.warn('[MiMo] 流式响应空闲超时（120s 无数据），中止请求');
      try { controller.abort(); } catch {}
    }
  }, 30000);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lastActivity = Date.now();

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') {
        const toolCalls = Object.values(toolCallsMap);
        return { content: fullContent, reasoning: fullReasoning, toolCalls, done: true };
      }

      try {
        const chunk = JSON.parse(data);
        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) {
          fullContent += choice.delta.content;
          sendToRenderer('mimo:chunk', { content: choice.delta.content });
        }
        if (choice?.delta?.reasoning_content) {
          fullReasoning += choice.delta.reasoning_content;
          sendToRenderer('mimo:reasoningChunk', { content: choice.delta.reasoning_content });
        }
        if (choice?.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallsMap[idx]) {
              toolCallsMap[idx] = { id: tc.id || tc.call_id, type: 'function', function: { name: tc.function?.name || '', arguments: '' } };
            }
            if (tc.id && !toolCallsMap[idx].id) {
              toolCallsMap[idx].id = tc.id;
            }
            if (tc.function?.name) {
              toolCallsMap[idx].function.name = tc.function.name;
            }
            if (tc.function?.arguments) {
              toolCallsMap[idx].function.arguments += tc.function.arguments;
            }
          }
          const toolCalls = Object.values(toolCallsMap);
          sendToRenderer('mimo:toolCall', { toolCalls });
        }
        if (choice?.finish_reason) {
          sendToRenderer('mimo:finish', { reason: choice.finish_reason });
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  const toolCalls = Object.values(toolCallsMap);
  if (idleTimer) clearInterval(idleTimer);
  return { content: fullContent, reasoning: fullReasoning, toolCalls, done: true };
  } catch (e) {
    if (idleTimer) clearInterval(idleTimer);
    // 用户中止或网络中断：返回已收集的部分内容，而不是报错
    if (controller.signal.aborted || e.name === 'AbortError') {
      return { content: fullContent, reasoning: fullReasoning, toolCalls: Object.values(toolCallsMap), done: true, aborted: true };
    }
    return { error: e.message };
  } finally {
    if (idleTimer) clearInterval(idleTimer);
    if (requestId) activeChatRequests.delete(requestId);
  }
});

// 中止指定流式请求（"停止生成"）
ipcMain.handle('mimo:abort', (_event, requestId) => {
  const controller = requestId && activeChatRequests.get(requestId);
  if (controller) controller.abort();
  return { success: true };
});

// ===== IPC: Open external =====
ipcMain.handle('shell:openPath', (_event, targetPath) => {
  shell.openPath(targetPath);
});

ipcMain.handle('shell:showItemInFolder', (_event, targetPath) => {
  shell.showItemInFolder(targetPath);
});

// ===== IPC: 窗口控制 =====
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
  return { success: true };
});

ipcMain.handle('window:close', () => {
  isQuiting = true;
  cleanupAndQuit();
  return { success: true };
});

ipcMain.handle('window:pin', (_event, shouldPin) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(!!shouldPin);
    return { success: true, pinned: !!shouldPin };
  }
  return { success: false };
});

// ===== IPC: 技能库 =====
ipcMain.handle('skills:list', async () => {
  const config = loadConfig();
  const basePath = config.sandboxPath || os.homedir();
  // 扫描 sandboxPath/skills/ 或 .mimo/skills/（递归 + 两个目录结果合并）
  const candidates = [
    path.join(basePath, 'skills'),
    path.join(basePath, '.mimo', 'skills')
  ];
  const all = [];
  const seen = new Set();

  const parseSkill = (filePath, fileName) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (fileName.endsWith('.json')) {
        const data = JSON.parse(content);
        const id = data.id || fileName;
        if (seen.has(id)) return;
        seen.add(id);
        all.push({
          id,
          name: data.name || fileName.replace(/\.json$/, ''),
          description: data.description || '',
          tags: data.tags || [],
          content: data.content || data.template || '',
          prefix: data.prefix || '',
          icon: data.icon || ''
        });
      } else if (fileName.endsWith('.md')) {
        if (seen.has(fileName)) return;
        seen.add(fileName);
        // Markdown 技能：首行 # 作为名称，其余作为内容
        const lines = content.split('\n');
        const titleMatch = lines[0].match(/^#\s+(.+)/);
        all.push({
          id: fileName,
          name: titleMatch ? titleMatch[1] : fileName.replace(/\.md$/, ''),
          description: lines.slice(1, 3).join(' ').trim(),
          tags: [],
          content: content,
          prefix: '',
          icon: ''
        });
      }
    } catch { /* skip invalid file */ }
  };

  // 递归扫描（深度 ≤ 3，防失控）
  const scanDir = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full, depth + 1);
      } else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.md'))) {
        parseSkill(full, entry.name);
      }
    }
  };

  for (const skillsDir of candidates) {
    if (fs.existsSync(skillsDir)) scanDir(skillsDir, 0);
  }
  return all;
});

// ===== IPC: 缓存管理 =====
function getDirSize(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSize(fullPath);
      } else {
        try {
          total += fs.statSync(fullPath).size;
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return total;
}

ipcMain.handle('cache:size', () => {
  const topicsSize = getDirSize(topicsDir);
  const attachmentsSize = getDirSize(attachmentsDir);
  const configSize = fs.existsSync(configPath) ? fs.statSync(configPath).size : 0;
  return {
    topics: topicsSize,
    attachments: attachmentsSize,
    config: configSize,
    total: topicsSize + attachmentsSize + configSize
  };
});

ipcMain.handle('cache:clear', () => {
  return clearCacheData();
});

function clearCacheData() {
  try {
    let cleared = 0;
    if (fs.existsSync(topicsDir)) {
      fs.rmSync(topicsDir, { recursive: true, force: true });
      ensureDir(topicsDir);
      cleared++;
    }
    if (fs.existsSync(attachmentsDir)) {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
      ensureDir(attachmentsDir);
      cleared++;
    }
    return { success: true, cleared };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ===== IPC: 获取可用模型列表（调 /v1/models） =====
ipcMain.handle('models:list', async () => {
  const config = loadConfig();
  if (!config.apiEndpoint || !config.apiKey) {
    return { success: false, error: '请先配置 API Endpoint 和 API Key', models: [] };
  }
  try {
    const url = `${config.apiEndpoint.replace(/\/$/, '')}/models`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { success: false, error: `API ${res.status}: ${text.slice(0, 200)}`, models: [] };
    }
    const json = await res.json();
    // OpenAI 兼容格式：{ data: [{ id, owned_by, ... }] }
    const list = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    const models = list.map(m => {
      const id = typeof m === 'string' ? m : (m.id || m.model || m.name || '');
      const name = (typeof m === 'object' && (m.name || m.display_name || m.displayName)) ? (m.name || m.display_name || m.displayName) : id;
      return { id: String(id), name: String(name) };
    }).filter(m => m.id);
    // 去重（按 id）
    const seen = new Set();
    const deduped = models.filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)));
    // 按 id 字母序排序，常用前缀排前
    deduped.sort((a, b) => {
      const score = s => (s.startsWith('gpt') ? 0 : s.startsWith('claude') ? 1 : s.startsWith('qwen') ? 2 : s.startsWith('mimo') ? 3 : 9);
      const sa = score(a.id); const sb = score(b.id);
      if (sa !== sb) return sa - sb;
      return a.id.localeCompare(b.id);
    });
    return { success: true, models: deduped };
  } catch (e) {
    return { success: false, error: `请求失败: ${e.message}`, models: [] };
  }
});

