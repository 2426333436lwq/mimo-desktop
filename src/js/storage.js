const Storage = {
  config: null,

  async loadConfig() {
    if (!this.config) {
      this.config = await window.api.getConfig();
    }
    return this.config;
  },

  async saveConfig(config) {
    const result = await window.api.setConfig(config);
    if (result.success) {
      this.config = config;
    }
    return result;
  },

  async listTopics() {
    return window.api.listTopics();
  },

  async loadTopic(id) {
    return window.api.loadTopic(id);
  },

  async saveTopic(topic) {
    return window.api.saveTopic(topic);
  },

  async deleteTopic(id) {
    return window.api.deleteTopic(id);
  },

  async renameTopic(id, title) {
    return window.api.renameTopic(id, title);
  },

  async saveAttachment(name, dataUrl) {
    return window.api.saveAttachment(name, dataUrl);
  },

  async saveClipboardAttachment(dataUrl) {
    return window.api.saveClipboardAttachment(dataUrl);
  },

  async readClipboardImage() {
    return window.api.readClipboardImage();
  },

  async loadProjectPermissions() {
    return window.api.loadProjectPermissions();
  },

  async saveProjectPermissions(permissions) {
    return window.api.saveProjectPermissions(permissions);
  },

  async getPermissionsPath() {
    return window.api.getPermissionsPath();
  },

  // 技能库（扫描工作区 skills 目录）
  async listSkills() {
    if (window.api.listSkills) {
      return window.api.listSkills();
    }
    return [];
  },

  // 获取当前 API Key 可用的模型列表
  async listModels() {
    if (window.api.listModels) {
      return window.api.listModels();
    }
    return { success: false, error: '接口不可用', models: [] };
  },

  // 缓存管理
  async getCacheSize() {
    if (window.api.getCacheSize) {
      return window.api.getCacheSize();
    }
    return { topics: 0, attachments: 0, config: 0, total: 0 };
  },

  async clearCache() {
    if (window.api.clearCache) {
      return window.api.clearCache();
    }
    return { success: false, error: '清空缓存接口不可用' };
  }
};

window.Storage = Storage;
