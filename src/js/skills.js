/* ============================================================
   Skills - 技能库
   - 从工作区 skills 目录加载技能定义
   - 渲染为卡片列表
   - 点击卡片将技能内容注入到输入框
   ============================================================ */
const Skills = {
  skills: [],
  filtered: [],

  async init() {
    const searchInput = document.getElementById('skillSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.filter(searchInput.value);
      });
    }
    await this.loadSkills();
  },

  async loadSkills() {
    try {
      this.skills = await Storage.listSkills();
      this.filter('');
    } catch (e) {
      console.warn('加载技能失败:', e);
      this.skills = [];
      this.renderEmpty();
    }
  },

  filter(keyword) {
    const k = (keyword || '').trim().toLowerCase();
    if (!k) {
      this.filtered = this.skills;
    } else {
      this.filtered = this.skills.filter(s => {
        const name = (s.name || '').toLowerCase();
        const desc = (s.description || '').toLowerCase();
        const tags = (s.tags || []).join(' ').toLowerCase();
        return name.includes(k) || desc.includes(k) || tags.includes(k);
      });
    }
    this.renderSkills();
  },

  renderSkills() {
    const container = document.getElementById('skillsContainer');
    if (!container) return;

    if (this.filtered.length === 0) {
      this.renderEmpty();
      return;
    }

    container.innerHTML = this.filtered.map(skill => {
      const tags = (skill.tags || []).map(t => `<span class="skill-tag">${this.escapeHtml(t)}</span>`).join('');
      const icon = this.getIcon(skill.icon || skill.name);
      return `
        <div class="skill-card" data-id="${this.escapeHtml(skill.id || skill.name)}">
          <div class="skill-card-header">
            <span class="skill-card-icon">${icon}</span>
            <span class="skill-card-name">${this.escapeHtml(skill.name)}</span>
          </div>
          <div class="skill-card-desc">${this.escapeHtml(skill.description || '')}</div>
          ${tags ? `<div class="skill-card-tags">${tags}</div>` : ''}
        </div>
      `;
    }).join('');

    container.querySelectorAll('.skill-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        this.injectSkill(id);
      });
    });
  },

  renderEmpty() {
    const container = document.getElementById('skillsContainer');
    if (!container) return;
    container.innerHTML = `
      <div class="no-topics">
        <span class="no-topics-icon">⚡</span>
        暂无技能<br>
        <span class="hint">将技能放入工作区 <code>skills/</code> 目录</span>
      </div>
    `;
  },

  // 注入技能内容到输入框
  injectSkill(id) {
    const skill = this.skills.find(s => (s.id || s.name) === id);
    if (!skill) return;

    const input = document.getElementById('chatInput');
    if (!input) return;

    const prefix = skill.prefix || `【技能：${skill.name}】`;
    const content = skill.content || skill.template || '';
    const injectText = content ? `${prefix}\n${content}` : prefix;

    if (input.value.trim()) {
      input.value = input.value.trimEnd() + '\n\n' + injectText;
    } else {
      input.value = injectText;
    }

    input.focus();
    input.dispatchEvent(new Event('input'));

    if (window.App && App.showToast) {
      App.showToast(`已应用技能: ${skill.name}`, 'success');
    }
  },

  getIcon(name) {
    const icons = {
      code: '⚙',
      write: '✍',
      review: '👁',
      test: '🧪',
      debug: '🐛',
      deploy: '🚀',
      docs: '📄',
      translate: '🌐'
    };
    const key = (name || '').toLowerCase();
    for (const k of Object.keys(icons)) {
      if (key.includes(k)) return icons[k];
    }
    return '⚡';
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
};

window.Skills = Skills;
