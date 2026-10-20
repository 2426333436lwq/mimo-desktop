# MiMo Assistant

为 MiMo 大模型深度优化的桌面智能助手，基于 Electron 构建。

## 功能特性

- 🤖 **MiMo AI 对话** - 通过 MiMo API 进行流式对话
- 🔧 **工具调用** - 支持 Bash 命令执行、文件读写、文件编辑
- 🔒 **权限沙箱** - 所有工具调用需用户确认
- 📁 **文件管理** - 内置文件浏览器和编辑器
- 💬 **话题管理** - 多轮对话历史保存与切换
- 📎 **附件支持** - 支持图片等附件上传
- 🖥️ **内置终端** - 快速执行命令

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式
npm run dev

# 启动生产模式
npm start
```

## 配置

首次启动后，在「设置」中配置：

1. **API 地址** - MiMo API 端点
2. **API 密钥** - 你的 MiMo API Key
3. **模型名称** - 默认 `mimo-3`
4. **工作区路径** - 文件操作的根目录

## 项目结构

```
mimo/
├── electron/
│   ├── main.js          # 主进程
│   └── preload.js       # 预加载脚本
├── src/
│   ├── index.html       # 主界面
│   ├── styles/          # 样式文件
│   └── js/              # 前端脚本
│       ├── api.js       # MiMo API 客户端
│       ├── storage.js   # 配置与话题存储
│       ├── filesystem.js # 文件系统操作
│       ├── chat.js      # 对话管理
│       ├── terminal.js  # 终端管理
│       └── app.js       # 主应用入口
└── package.json
```

## 技术栈

- **Electron** - 桌面应用框架
- **原生 JavaScript** - 无框架依赖
- **MiMo API** - AI 模型后端

## License

MIT
