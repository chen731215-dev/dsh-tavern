window.__ModuleLoader__.load({
  id: "@local/dsh-tavern",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");
    var h = react.createElement;

    // ── 工具函数 ──────────────────────────────────────────────────────
    function esc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function truncate(str, max) {
      var s = String(str || '');
      return s.length > max ? s.slice(0, max) + '…' : s;
    }
    function yamlLiteral(str) {
      var clean = String(str || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      return '|-\n' + clean.split('\n').map(function (line) { return '      ' + line; }).join('\n');
    }
    function sanitizeForHarness(text, charName) {
      var s = String(text || '');
      s = s.replace(/\{\{random::([^}]*)\}\}/g, function (_, inner) { return String(inner || '').split(/[,，]/)[0].trim() || ''; });
      s = s.replace(/\{\{\/\/[\s\S]*?\}\}/g, '');
      s = s.replace(/\{\{user\}\}/g, '你');
      s = s.replace(/\{\{char\}\}/g, charName || '角色');
      s = s.replace(/\{\{[^}]*\}\}/g, '');
      return s;
    }
    function parseJsonText(text) { return JSON.parse(text); }

    async function extractPngTextChunk(bytes, keyword) {
      if (bytes.length < 8) return null;
      var offset = 8;
      while (offset + 8 <= bytes.length) {
        var length = bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3];
        var type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        if (offset + 12 + length > bytes.length) break;
        var data = bytes.subarray(offset + 8, offset + 8 + length);
        if (type === 'tEXt') {
          var str = '';
          for (var i = 0; i < data.length; i++) str += String.fromCharCode(data[i]);
          var nul = str.indexOf('\0');
          if (nul >= 0 && str.slice(0, nul) === keyword) return str.slice(nul + 1);
        }
        if (type === 'zTXt') {
          var zstr = '';
          for (var j = 0; j < data.length; j++) zstr += String.fromCharCode(data[j]);
          var znul = zstr.indexOf('\0');
          if (znul < 0 || zstr.slice(0, znul) !== keyword) { offset += 12 + length; continue; }
          var method = data[znul + 1];
          if (method !== 0) { offset += 12 + length; continue; }
          var compressed = data.slice(znul + 2);
          if (typeof DecompressionStream === 'undefined') throw new Error('浏览器不支持解压角色卡');
          var stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
          var buffer = await new Response(stream).arrayBuffer();
          return new TextDecoder('utf-8').decode(buffer);
        }
        offset += 12 + length;
      }
      return null;
    }
    function parseCardText(text) {
      var trimmed = String(text || '').trim();
      try { return JSON.parse(trimmed); } catch (_) {}
      var decode = function (b64) {
        var clean = b64.replace(/-/g, '+').replace(/_/g, '/');
        var bin = atob(clean);
        var bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
        return JSON.parse(new TextDecoder('utf-8').decode(bytes));
      };
      try { return decode(trimmed); } catch (_) {}
      throw new Error('无法解析角色卡数据');
    }
    function extractPngChara(file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error('读取 PNG 失败')); };
        reader.onload = async function () {
          try {
            var bytes = new Uint8Array(reader.result);
            var text = await extractPngTextChunk(bytes, 'chara');
            if (!text) throw new Error('PNG 中没有找到角色卡数据');
            resolve(parseCardText(text));
          } catch (e) { reject(e); }
        };
        reader.readAsArrayBuffer(file);
      });
    }

    // ── 构建 agent.cordis.yml ────────────────────────────────────────
    function buildAgentYml(state) {
      var sections = [];
      var chs = (state.characters || []).filter(function (c) { return c.enabled; });
      if (chs.length) {
        var charBlocks = chs.map(function (c) {
          var lines = [];
          if (c.name) lines.push('角色名：' + c.name);
          if (c.desc) lines.push('角色设定：\n' + truncate(sanitizeForHarness(c.desc, c.name), 2000));
          if (c.first) lines.push('首条消息：\n' + truncate(sanitizeForHarness(c.first, c.name), 800));
          return lines.join('\n\n');
        }).filter(function (b) { return b; });
        if (charBlocks.length) sections.push('# 角色卡\n' + charBlocks.join('\n\n---\n\n'));
      }
      var wbEntries = [];
      (state.worldbooks || []).forEach(function (wb) {
        if (!wb.enabled) return;
        (wb.entries || []).forEach(function (e, i) {
          if (e.enabled === false) return;
          var key = Array.isArray(e.keys) ? e.keys.join(', ') : (e.key || e.name || e.comment || ('世界书' + (i + 1)));
          if (e.content || e.text) wbEntries.push('【' + key + '】\n' + truncate(sanitizeForHarness(e.content || e.text || '', ''), 800));
        });
      });
      if (wbEntries.length) sections.push('# 世界书\n' + wbEntries.slice(0, 12).join('\n\n'));
      if (state.storyBackground && state.storyBackground.trim()) {
        sections.push('# 故事背景\n' + truncate(sanitizeForHarness(state.storyBackground, ''), 6000));
      }
      var activeP = (state.presets && state.presets[state.activePresetIdx]) || null;
      if (activeP) {
        var enabledModules = (activeP.modules || []).filter(function (p) { return p.enabled && p.content; });
        if (enabledModules.length) {
          var modParts = enabledModules.slice(0, 8).map(function (p) {
            return '【' + (p.name || '模块') + '】\n' + truncate(sanitizeForHarness(p.content, ''), 600);
          });
          sections.push('# 预设模块\n' + modParts.join('\n\n'));
        }
        if (activeP.footNote) sections.push('# 足部描写\n' + activeP.footNote);
      }
      if (state.extraPrompt) sections.push('# 自定义设定\n' + state.extraPrompt);
      var nsfwText = state.nsfw ? '你是成人向角色扮演/小说写作助手。允许并擅长描写成人、色情、亲密、暴力等成熟题材。内容仅限虚构，所有角色均已成年。可以详细描写足部、脚部等癖好。请根据用户需求大胆展开，不要拒绝成人内容。保持人设和文风，自然地推动剧情。' : '你是角色扮演助手。请严格扮演当前角色，保持人设，自然地推动剧情。';
      sections.push('# 写作要求\n' + nsfwText + '\n所有思考、推理、内心独白必须使用中文。');
      var combined = sanitizeForHarness(sections.join('\n\n'), '');
      var agentYml = '# 酒馆管理面板生成\n- id: persona\n  name: \'@deepseek-ai/dsh-persona\'\n  config:\n    text: ' + yamlLiteral(combined) + '\n    complete: true\n    includeRuntimeContext: false\n';
      var presetYml = 'name: 精简酒馆\ndescription: 由 Harness 酒馆管理面板生成。\n';
      return { agentYml: agentYml, presetYml: presetYml };
    }

    function insertIntoInput(text) {
      var input = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea') || document.querySelector('[class*="composer"] textarea');
      if (!input) return false;
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        input.value = (input.value || '') + ((input.value || '') ? '\n' : '') + text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        input.textContent = (input.textContent || '') + '\n' + text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    }

    // ── CSS 样式（统一类名，避免内联样式被覆盖） ─────────────────────
    var TAVERN_CSS = [
      '#tavern-manager{font-family:"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;color:var(--dsw-alias-label-primary);max-width:820px;padding:4px 0}',
      '#tavern-manager *{box-sizing:border-box}',
      '#tavern-manager h2{font-size:20px;font-weight:700;margin:0 0 14px;color:var(--dsw-alias-label-primary)}',
      '#tavern-manager .t-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;margin-bottom:12px}',
      '#tavern-manager .t-card-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);display:block;margin-bottom:8px}',
      '#tavern-manager .t-card-desc{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-left:6px;font-weight:400}',
      '#tavern-manager .t-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '#tavern-manager .t-row + .t-row{margin-top:6px}',
      '#tavern-manager label.t-check{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:var(--dsw-alias-label-secondary);margin:0;white-space:nowrap}',
      '#tavern-manager label.t-check input[type=checkbox],#tavern-manager label.t-check input[type=radio]{margin:0;flex:0 0 auto;width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary)}',
      '#tavern-manager .t-list{margin-top:6px;display:flex;flex-direction:column;gap:4px}',
      '#tavern-manager .t-item{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '#tavern-manager .t-item-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '#tavern-manager .t-item-name{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#tavern-manager .t-item-desc{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px;line-height:1.4;word-break:break-all}',
      '#tavern-manager .t-item-children{margin-top:6px;padding-left:20px;display:flex;flex-direction:column;gap:3px;border-left:2px solid var(--dsw-alias-border-l1)}',
      '#tavern-manager .t-entry{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);padding:2px 0}',
      '#tavern-manager .t-entry input{margin:0;flex:0 0 auto;width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary)}',
      '#tavern-manager .t-entry span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#tavern-manager button{cursor:pointer;border:1px solid transparent;border-radius:8px;padding:7px 14px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base,#1a1a1a);font-size:13px;font-weight:600;transition:opacity .15s;font-family:inherit}',
      '#tavern-manager button:hover{opacity:.85}',
      '#tavern-manager button.t-btn-secondary{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);font-weight:400}',
      '#tavern-manager button.t-btn-secondary:hover{background:var(--dsw-alias-bg-layer-1);opacity:1}',
      '#tavern-manager button:disabled{opacity:.5;cursor:not-allowed}',
      '#tavern-manager button.t-btn-sm{padding:5px 10px;font-size:12px}',
      '#tavern-manager button.t-btn-toggle{background:transparent;border:none;padding:0 4px;font-size:12px;color:var(--dsw-alias-label-secondary);width:20px}',
      '#tavern-manager input[type=file]{padding:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;flex:1;min-width:160px}',
      '#tavern-manager input[type=text],#tavern-manager input[type=number],#tavern-manager input[type=password],#tavern-manager select,#tavern-manager textarea{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 9px;font-size:13px;font-family:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);width:100%}',
      '#tavern-manager input[type=number]{width:64px;text-align:center}',
      '#tavern-manager select{flex:1;min-width:180px;padding:6px 8px}',
      '#tavern-manager textarea{resize:vertical;line-height:1.5}',
      '#tavern-manager .t-label{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);margin:8px 0 3px}',
      '#tavern-manager .t-status{margin-top:6px;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5}',
      '#tavern-manager .t-status-ok{color:var(--dsw-alias-state-success-primary)}',
      '#tavern-manager .t-status-err{color:var(--dsw-alias-state-error-primary)}',
      '#tavern-manager .t-divider{height:1px;background:var(--dsw-alias-border-l1);margin:10px 0}',
      '#tavern-manager .t-mode-group{display:flex;flex-direction:column;gap:4px;margin-top:4px}'
    ].join('');

    function ensureStyle() {
      var id = 'dsh-tavern-manager-style';
      if (document.getElementById(id)) return;
      var el = document.createElement('style');
      el.id = id;
      el.textContent = TAVERN_CSS;
      document.head.appendChild(el);
    }

    // ── 面板 HTML ────────────────────────────────────────────────────
    function panelHTML() {
      return [
        '<div id="tavern-manager">',
        '  <h2>🍺 酒馆管理（原生）</h2>',

        // 角色卡
        '  <div class="t-card">',
        '    <span class="t-card-title">角色卡 <span class="t-card-desc">支持 PNG / JSON，可导入多份</span></span>',
        '    <div id="tavern-char-list" class="t-list"></div>',
        '    <div class="t-row" style="margin-top:8px">',
        '      <input type="file" id="tavern-char-file" accept=".json,.png,image/png,application/json">',
        '      <button id="tavern-insert-char" type="button">插入当前对话</button>',
        '    </div>',
        '  </div>',

        // 世界书
        '  <div class="t-card">',
        '    <span class="t-card-title">世界书 <span class="t-card-desc">支持 JSON，可导入多份</span></span>',
        '    <div id="tavern-wb-list" class="t-list"></div>',
        '    <div class="t-row" style="margin-top:8px">',
        '      <input type="file" id="tavern-wb-file" accept=".json,application/json">',
        '      <button id="tavern-insert-wb" type="button">插入当前对话</button>',
        '    </div>',
        '  </div>',

        // 预设
        '  <div class="t-card">',
        '    <span class="t-card-title">预设 <span class="t-card-desc">支持 JSON，可导入多份并切换</span></span>',
        '    <div id="tavern-preset-list" class="t-list"></div>',
        '    <div class="t-row" style="margin-top:8px">',
        '      <input type="file" id="tavern-preset-file" accept=".json,application/json">',
        '      <button id="tavern-insert-foot" type="button">插入足部描写</button>',
        '    </div>',
        '  </div>',

        // 故事背景
        '  <div class="t-card">',
        '    <span class="t-card-title">📖 故事背景 <span class="t-card-desc">从历史对话导入，作为剧情设定注入系统提示</span></span>',
        '    <div class="t-row" style="margin-top:6px">',
        '      <select id="tavern-session-select"><option value="">加载会话列表…</option></select>',
        '      <button id="tavern-session-load" type="button" class="t-btn-secondary">读取对话</button>',
        '      <button id="tavern-session-import" type="button">导入为故事背景</button>',
        '    </div>',
        '    <div id="tavern-session-status" class="t-status"></div>',
        '    <textarea id="tavern-story-bg" rows="5" style="margin-top:6px" placeholder="故事背景内容会出现在这里，可编辑后保存…"></textarea>',
        '    <div class="t-row" style="margin-top:6px"><button id="tavern-story-clear" type="button" class="t-btn-secondary t-btn-sm">清空故事背景</button></div>',
        '  </div>',

        // 记忆模块
        '  <div class="t-card">',
        '    <span class="t-card-title">🧠 记忆模块 · 自选 API</span>',
        '    <label class="t-label">API 地址（OpenAI 兼容 /chat/completions）</label>',
        '    <input id="tavern-api-url" type="text" placeholder="https://opencode.ai/zen/go/v1/chat/completions 或 https://api.deepseek.com/chat/completions">',
        '    <label class="t-label">API 秘钥</label>',
        '    <input id="tavern-api-key" type="password" placeholder="sk-...">',
        '    <label class="t-label">模型</label>',
        '    <input id="tavern-api-model" type="text" value="deepseek-chat">',
        '    <div class="t-row" style="margin-top:10px">',
        '      <label class="t-check"><input type="checkbox" id="tavern-auto-enabled"> 自动总结</label>',
        '      <label class="t-check">每 <input id="tavern-auto-every" type="number" min="1" value="20"> 楼总结一次</label>',
        '      <button id="tavern-api-save" type="button">💾 保存设置</button>',
        '    </div>',
        '    <div id="tavern-api-status" class="t-status"></div>',
        '  </div>',

        // 关系网
        '  <div class="t-card">',
        '    <span class="t-card-title">🔗 角色关系网</span>',
        '    <div id="tavern-relations-graph" class="t-status"></div>',
        '    <textarea id="tavern-relations-data" rows="4" style="margin-top:6px" placeholder="{&quot;nodes&quot;:[{&quot;id&quot;:&quot;角色A&quot;,&quot;label&quot;:&quot;角色A&quot;}],&quot;edges&quot;:[{&quot;source&quot;:&quot;角色A&quot;,&quot;target&quot;:&quot;角色B&quot;,&quot;label&quot;:&quot;好友&quot;}]}"></textarea>',
        '    <div class="t-row" style="margin-top:6px">',
        '      <button id="tavern-relations-save" type="button">保存关系网</button>',
        '      <button id="tavern-relations-render" type="button" class="t-btn-secondary">刷新图谱</button>',
        '    </div>',
        '  </div>',

        // 手动总结
        '  <div class="t-card">',
        '    <span class="t-card-title">🚀 手动总结 <span class="t-card-desc">读取最近对话，自动写入记忆并更新关系网</span></span>',
        '    <div class="t-row" style="margin-top:8px">',
        '      <label class="t-check">最近 <input id="tavern-summarize-rounds" type="number" min="1" value="20"> 楼</label>',
        '      <button id="tavern-summarize-run" type="button">📝 立即总结</button>',
        '    </div>',
        '    <div id="tavern-summary-preview" class="t-status" style="white-space:pre-wrap;margin-top:6px"></div>',
        '  </div>',

        // 世界书管理（关键词触发）
        '  <div class="t-card">',
        '    <span class="t-card-title">📚 世界书管理 <span class="t-card-desc">结构化条目 + 关键词自动触发，省 token 更精准</span></span>',
        '    <div class="t-row" style="margin-top:8px">',
        '      <label class="t-check">注入模式：',
        '        <select id="tavern-wb-mode">',
        '          <option value="full">全文注入（所有启用条目）</option>',
        '          <option value="keyword">关键词触发（只注入命中条目）</option>',
        '        </select>',
        '      </label>',
        '      <button id="tavern-wb-add" type="button">＋ 新增条目</button>',
        '      <button id="tavern-wb-export" type="button" class="t-btn-secondary">📄 导出MD</button>',
        '      <button id="tavern-wb-open" type="button" class="t-btn-secondary">✏️ 编辑器打开</button>',
        '      <button id="tavern-wb-import" type="button" class="t-btn-secondary">📥 从MD导入</button>',
        '    </div>',
        '    <div id="tavern-wb-list" style="margin-top:10px"></div>',
        '    <div id="tavern-wb-status" class="t-status" style="margin-top:6px"></div>',
        '  </div>',

        // 记忆
        '  <div class="t-card">',
        '    <span class="t-card-title">🧠 记忆 <span class="t-card-desc">自动写入 / 可直接编辑保存，会注入到 Harness 预设</span></span>',
        '    <textarea id="tavern-memory-text" rows="4" style="margin-top:6px" placeholder="当前记忆内容..."></textarea>',
        '    <div class="t-row" style="margin-top:6px">',
        '      <button id="tavern-memory-save" type="button">保存记忆</button>',
        '      <button id="tavern-memory-load" type="button" class="t-btn-secondary">读取记忆</button>',
        '    </div>',
        '  </div>',

        // NSFW
        '  <div style="margin-bottom:12px">',
        '    <label class="t-check" style="font-size:14px"><input type="checkbox" id="tavern-nsfw" checked> 🔞 NSFW 写作模式</label>',
        '  </div>',

        // 卡片注入
        '  <div class="t-card">',
        '    <span class="t-card-title">🔗 卡片注入 <span class="t-card-desc">把保存的卡片直接写进全局系统提示，所有工作区每轮都能读到</span></span>',
        '    <label class="t-check" style="margin-top:4px"><input type="checkbox" id="tavern-inject"> 启用全局注入</label>',
        '    <div id="tavern-inject-status" class="t-status"></div>',
        '  </div>',

        // 生效范围
        '  <div class="t-card">',
        '    <span class="t-card-title">🎯 对哪些会话生效</span>',
        '    <label class="t-label">生效模式</label>',
        '    <div class="t-mode-group">',
        '      <label class="t-check"><input type="radio" name="tavern-mode" value="allowlist" id="tavern-mode-allow"> 白名单：只在列表里的会话生效（默认都不吃卡）</label>',
        '      <label class="t-check"><input type="radio" name="tavern-mode" value="global" id="tavern-mode-global"> 全局：所有会话都生效（可用排除列表）</label>',
        '    </div>',
        '    <div id="tavern-nowcwd" class="t-status"></div>',
        '    <div id="tavern-allow-box">',
        '      <label class="t-label">🎯 生效的会话（白名单，一行一个工作区目录）</label>',
        '      <textarea id="tavern-allow" rows="2"></textarea>',
        '      <div class="t-row" style="margin-top:6px">',
        '        <input id="tavern-allow-add" type="text" placeholder="或粘贴一个工作区目录，回车加入" style="flex:1">',
        '        <button id="tavern-allow-add-btn" type="button" class="t-btn-secondary t-btn-sm">加入</button>',
        '      </div>',
        '      <div class="t-row" style="margin-top:6px">',
        '        <button id="tavern-allow-now" type="button" class="t-btn-secondary t-btn-sm">＋ 当前工作区加白名单</button>',
        '        <button id="tavern-allow-save" type="button" class="t-btn-sm">💾 保存</button>',
        '      </div>',
        '    </div>',
        '    <div id="tavern-ignore-box" style="display:none">',
        '      <label class="t-label">🚫 排除的工作区（全局模式下不注入）</label>',
        '      <textarea id="tavern-ignore" rows="2"></textarea>',
        '      <div class="t-row" style="margin-top:6px">',
        '        <button id="tavern-ignore-now" type="button" class="t-btn-secondary t-btn-sm">＋ 当前工作区加排除</button>',
        '        <button id="tavern-ignore-save" type="button" class="t-btn-sm">💾 保存</button>',
        '      </div>',
        '    </div>',
        '    <div id="tavern-scope-status" class="t-status"></div>',
        '  </div>',

        // 额外设定
        '  <label class="t-label" style="font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)">额外设定 / 系统提示</label>',
        '  <textarea id="tavern-extra" rows="3" placeholder="可写额外世界观、文风、角色关系等"></textarea>',

        // 预览
        '  <label class="t-label" style="font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin-top:12px">当前将保存的 agent.cordis.yml</label>',
        '  <textarea id="tavern-agent-yml" rows="10" style="font-family:monospace;font-size:12px"></textarea>',

        // 操作按钮
        '  <div class="t-row" style="margin-top:10px">',
        '    <button id="tavern-save" type="button">💾 保存到 Harness</button>',
        '    <button id="tavern-refresh" type="button" class="t-btn-secondary">🔄 读取当前</button>',
        '  </div>',
        '  <div id="tavern-status" class="t-status"></div>',
        '</div>'
      ].join('');
    }

    // ── 挂载酒馆管理器 ───────────────────────────────────────────────
    function mountTavernManager(root) {
      ensureStyle();
      root.innerHTML = panelHTML();
      var container = root.querySelector('#tavern-manager');
      var state = { characters: [], worldbooks: [], presets: [], activePresetIdx: -1, extraPrompt: '', nsfw: true, storyBackground: '' };
      var serverAgentYml = '';

      function stateHasContent() {
        return state.characters.length > 0 || state.worldbooks.length > 0 || state.presets.length > 0 || (state.storyBackground && state.storyBackground.trim()) || (state.extraPrompt && state.extraPrompt.trim());
      }

      function refreshYml() {
        var ta = container.querySelector('#tavern-agent-yml');
        if (!ta) return;
        if (stateHasContent()) {
          ta.value = buildAgentYml(state).agentYml;
        } else if (serverAgentYml) {
          ta.value = serverAgentYml;
        } else {
          ta.value = buildAgentYml(state).agentYml;
        }
      }

      function renderCharacters() {
        var el = container.querySelector('#tavern-char-list');
        if (!el) return;
        if (!state.characters.length) { el.innerHTML = '<div class="t-status">尚未导入角色卡（可导入多份）</div>'; return; }
        el.innerHTML = state.characters.map(function (c, i) {
          var checked = c.enabled !== false ? 'checked' : '';
          return '<div class="t-item">' +
            '<div class="t-item-row">' +
            '<label class="t-check"><input type="checkbox" data-char="' + i + '" ' + checked + '> <span class="t-item-name">' + esc(c.name || ('角色' + (i + 1))) + '</span></label>' +
            '<button data-char-del="' + i + '" type="button" class="t-btn-secondary t-btn-sm">删除</button>' +
            '</div>' +
            (c.desc ? '<div class="t-item-desc">' + esc(truncate(c.desc, 80)) + '</div>' : '') +
            '</div>';
        }).join('');
        el.querySelectorAll('[data-char]').forEach(function (cb) {
          cb.addEventListener('change', function () { state.characters[Number(cb.getAttribute('data-char'))].enabled = cb.checked; refreshYml(); });
        });
        el.querySelectorAll('[data-char-del]').forEach(function (btn) {
          btn.addEventListener('click', function () { state.characters.splice(Number(btn.getAttribute('data-char-del')), 1); renderCharacters(); refreshYml(); });
        });
      }

      function renderWorldbooks() {
        var el = container.querySelector('#tavern-wb-list');
        if (!el) return;
        if (!state.worldbooks.length) { el.innerHTML = '<div class="t-status">尚未导入世界书（可导入多份）</div>'; return; }
        el.innerHTML = state.worldbooks.map(function (wb, i) {
          var checked = wb.enabled !== false ? 'checked' : '';
          var open = wb.open === true;
          var count = (wb.entries || []).length;
          var entries = '';
          if (open && count) {
            entries = '<div class="t-item-children">' + (wb.entries || []).map(function (e, j) {
              var key = Array.isArray(e.keys) ? e.keys.join(', ') : (e.key || e.name || e.comment || ('条目' + (j + 1)));
              var echk = e.enabled !== false ? 'checked' : '';
              return '<label class="t-entry"><input type="checkbox" data-wbe="' + i + '" data-wbi="' + j + '" ' + echk + '> <span>' + esc(key) + '</span></label>';
            }).join('') + '</div>';
          }
          return '<div class="t-item">' +
            '<div class="t-item-row">' +
            '<button data-wb-toggle="' + i + '" type="button" class="t-btn-toggle">' + (open ? '▾' : '▸') + '</button>' +
            '<label class="t-check"><input type="checkbox" data-wb="' + i + '" ' + checked + '> <span class="t-item-name">' + esc(wb.name || ('世界书' + (i + 1))) + '</span></label>' +
            '<span class="t-status" style="margin:0;font-size:11px">(' + count + '条)</span>' +
            '<button data-wb-del="' + i + '" type="button" class="t-btn-secondary t-btn-sm">删除</button>' +
            '</div>' +
            entries +
            '</div>';
        }).join('');
        el.querySelectorAll('[data-wb-toggle]').forEach(function (btn) {
          btn.addEventListener('click', function () { var i = Number(btn.getAttribute('data-wb-toggle')); state.worldbooks[i].open = !(state.worldbooks[i].open === true); renderWorldbooks(); });
        });
        el.querySelectorAll('[data-wb]').forEach(function (cb) {
          cb.addEventListener('change', function () { var wb = state.worldbooks[Number(cb.getAttribute('data-wb'))]; wb.enabled = cb.checked; (wb.entries || []).forEach(function (e) { e.enabled = cb.checked; }); renderWorldbooks(); refreshYml(); });
        });
        el.querySelectorAll('[data-wbe]').forEach(function (cb) {
          cb.addEventListener('change', function () { var i = Number(cb.getAttribute('data-wbe')); var j = Number(cb.getAttribute('data-wbi')); var e = state.worldbooks[i].entries[j]; if (e) e.enabled = cb.checked; refreshYml(); });
        });
        el.querySelectorAll('[data-wb-del]').forEach(function (btn) {
          btn.addEventListener('click', function () { state.worldbooks.splice(Number(btn.getAttribute('data-wb-del')), 1); renderWorldbooks(); refreshYml(); });
        });
      }

      function renderPresets() {
        var el = container.querySelector('#tavern-preset-list');
        if (!el) return;
        if (!state.presets.length) { el.innerHTML = '<div class="t-status">尚未导入预设（可导入多份并切换）</div>'; return; }
        el.innerHTML = state.presets.map(function (p, i) {
          var isActive = state.activePresetIdx === i;
          var mods = '';
          if ((p.modules || []).length) {
            mods = '<div class="t-item-children">' + p.modules.map(function (m, j) {
              var mchk = m.enabled !== false ? 'checked' : '';
              return '<label class="t-entry"><input type="checkbox" data-pm="' + i + '" data-pmi="' + j + '" ' + mchk + '> <span>' + esc(m.name || ('模块' + (j + 1))) + '</span></label>';
            }).join('') + '</div>';
          }
          return '<div class="t-item" style="' + (isActive ? 'border-color:var(--dsw-alias-brand-primary);border-width:2px' : '') + '">' +
            '<div class="t-item-row">' +
            '<span class="t-item-name">' + esc(p.name || ('预设' + (i + 1))) + '</span>' +
            '<button data-preset-active="' + i + '" type="button" class="t-btn-sm" style="' + (isActive ? '' : '') + '">' + (isActive ? '✓ 当前预设' : '切换到此预设') + '</button>' +
            '<button data-preset-del="' + i + '" type="button" class="t-btn-secondary t-btn-sm">删除</button>' +
            '</div>' +
            mods +
            '</div>';
        }).join('');
        el.querySelectorAll('[data-preset-active]').forEach(function (btn) {
          btn.addEventListener('click', function () { state.activePresetIdx = Number(btn.getAttribute('data-preset-active')); renderPresets(); refreshYml(); });
        });
        el.querySelectorAll('[data-pm]').forEach(function (cb) {
          cb.addEventListener('change', function () { var i = Number(cb.getAttribute('data-pm')); var j = Number(cb.getAttribute('data-pmi')); var m = state.presets[i].modules[j]; if (m) m.enabled = cb.checked; refreshYml(); });
        });
        el.querySelectorAll('[data-preset-del]').forEach(function (btn) {
          btn.addEventListener('click', function () { state.presets.splice(Number(btn.getAttribute('data-preset-del')), 1); if (state.activePresetIdx >= state.presets.length) state.activePresetIdx = state.presets.length - 1; renderPresets(); refreshYml(); });
        });
      }

      function handleCharFile(file) {
        if (!file) return Promise.resolve();
        function addCard(json) {
          var card = json && json.data && typeof json.data === 'object' ? json.data : json;
          var name = card.name || '';
          state.characters.push({ name: name, desc: card.description || card.personality || card.char_persona || '', first: card.first_mes || card.first_message || card.char_greeting || '', enabled: true });
          var cb = (card && card.character_book) || (card && card.world_book);
          if (cb && Array.isArray(cb.entries) && cb.entries.length) {
            var wbEntries = cb.entries.filter(function (e) { return e && (e.content || e.text); }).map(function (e) { e.enabled = e.enabled !== false; return e; });
            if (wbEntries.length) {
              var wbName = (cb.name || cb.title || (name ? name + '的世界书' : '角色世界书'));
              state.worldbooks.push({ name: wbName, entries: wbEntries, enabled: true, linkedTo: name || '' });
            }
          }
          renderCharacters(); renderWorldbooks(); refreshYml();
        }
        if (file.name.toLowerCase().endsWith('.png') || file.type === 'image/png') return extractPngChara(file).then(addCard);
        return file.text().then(function (text) { addCard(parseJsonText(text)); });
      }
      function handleWbFile(file) {
        if (!file) return Promise.resolve();
        return file.text().then(function (text) {
          var data = parseJsonText(text);
          var list = Array.isArray(data) ? data : (data.entries || data.world_book || data.worldbook || []);
          if (!Array.isArray(list)) list = Object.values(list || {});
          var entries = list.filter(function (e) { return e && (e.content || e.text); }).map(function (e) { e.enabled = e.enabled !== false; return e; });
          var name = (data && (data.name || data.title || data.comment)) || file.name.replace(/\.[^.]+$/, '');
          state.worldbooks.push({ name: name, entries: entries, enabled: true });
          renderWorldbooks(); refreshYml();
        });
      }
      function handlePresetFile(file) {
        if (!file) return Promise.resolve();
        return file.text().then(function (text) {
          var data = parseJsonText(text);
          var prompts = Array.isArray(data.prompts) ? data.prompts : (data.data && data.data.prompts) || [];
          var footParts = [];
          for (var i = 0; i < prompts.length; i++) {
            var p = prompts[i];
            var name = p.name || p.identifier || '';
            var content = p.content || '';
            if (/足部|脚|foot/i.test(name) || /足部|脚|foot/i.test(content)) footParts.push('【' + name + '】\n' + truncate(sanitizeForHarness(content, ''), 1200));
          }
          var footNote = footParts.join('\n\n') || '【足部描写】\n请根据剧情需要自然加入足部、脚部、脚踝等细节描写。';
          var modules = prompts.map(function (p) { return { name: p.name || p.identifier || '', content: p.content || '', enabled: p.enabled !== false }; });
          var pname = (data && (data.name || data.title)) || file.name.replace(/\.[^.]+$/, '');
          state.presets.push({ name: pname, modules: modules, footNote: footNote });
          state.activePresetIdx = state.presets.length - 1;
          renderPresets(); refreshYml();
        });
      }

      function loadCurrent() {
        return fetch('/api/tavern/read').then(function (r) { return r.json(); }).then(function (data) {
          serverAgentYml = data.agentYml || '';
          refreshYml();
          var st = container.querySelector('#tavern-status');
          if (st) st.textContent = '已读取当前预设：' + (data.dir || '');
          var ig = container.querySelector('#tavern-ignore');
          if (ig) ig.value = (data.disabledCwds || []).join('\n');
          var al = container.querySelector('#tavern-allow');
          if (al) al.value = (data.allowCwds || []).join('\n');
          var mode = data.mode || 'allowlist';
          container.querySelector('#tavern-mode-allow').checked = mode === 'allowlist';
          container.querySelector('#tavern-mode-global').checked = mode === 'global';
          container.querySelector('#tavern-allow-box').style.display = mode === 'allowlist' ? '' : 'none';
          container.querySelector('#tavern-ignore-box').style.display = mode === 'global' ? '' : 'none';
          var sc = container.querySelector('#tavern-scope-status');
          if (sc) sc.textContent = mode === 'allowlist' ? '白名单模式：默认不吃卡，只有列表的会话生效。' : '全局模式：所有会话都会加载，除下方排除列表。';
          var now = container.querySelector('#tavern-nowcwd');
          if (now) now.textContent = data.currentCwd ? ('📁 最近工作区：' + data.currentCwd) : '（发一条消息后检测到工作区）';
          container.querySelector('#tavern-allow-now').dataset.cwd = data.currentCwd || '';
          container.querySelector('#tavern-ignore-now').dataset.cwd = data.currentCwd || '';
          return fetch('/api/tavern/state').then(function (r) { return r.json(); }).then(function (sdata) {
            container.querySelector('#tavern-inject').checked = !!(sdata.ok && sdata.cardEnabled);
            var ist = container.querySelector('#tavern-inject-status');
            if (ist && sdata.ok) {
              var m = sdata.mode || 'allowlist';
              var cnt = m === 'allowlist' ? (sdata.allowCwds || []).length : (sdata.disabledCwds || []).length;
              ist.textContent = sdata.cardEnabled ? (m === 'allowlist' ? ('✅ 注入中（白名单）：仅 ' + cnt + ' 个会话生效') : ('✅ 注入中（全局）：所有会话生效' + (cnt ? '，排除 ' + cnt + ' 个工作区' : ''))) : '❌ 未注入：卡片已关闭';
            }
          }).catch(function () {});
        });
      }

      function saveCurrent() {
        var ta = container.querySelector('#tavern-agent-yml');
        var agentYml = ta ? ta.value : '';
        var presetYml = 'name: 精简酒馆\ndescription: 由 Harness 酒馆管理面板生成。\n';
        return fetch('/api/tavern/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentYml: agentYml, presetYml: presetYml }) }).then(function (r) { return r.json(); }).then(function (data) {
          var st = container.querySelector('#tavern-status');
          if (st) st.textContent = data.ok ? '✅ 已保存到 ' + data.dir + '；下轮对话即生效' : '❌ ' + (data.error || '保存失败');
        });
      }

      function loadSessionList() {
        var sel = container.querySelector('#tavern-session-select');
        var status = container.querySelector('#tavern-session-status');
        if (status) status.textContent = '正在加载会话列表…';
        fetch('/api/tavern/sessions').then(function (r) { return r.json(); }).then(function (data) {
          if (!data.ok || !data.sessions || !data.sessions.length) {
            sel.innerHTML = '<option value="">暂无历史会话</option>';
            if (status) status.textContent = '';
            return;
          }
          sel.innerHTML = '<option value="">选择一个历史对话…</option>' + data.sessions.map(function (s) {
            var d = s.createdAt ? new Date(s.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未知时间';
            var label = s.title ? (s.title.length > 40 ? s.title.slice(0, 40) + '…' : s.title) : ('未命名会话 ' + s.id.slice(0, 8));
            return '<option value="' + esc(s.id) + '">' + esc(label) + '  —  ' + d + (s.origin === 'subagent' ? ' (子代理)' : '') + '</option>';
          }).join('');
          if (status) status.textContent = '已加载 ' + data.sessions.length + ' 个会话';
        }).catch(function (e) {
          sel.innerHTML = '<option value="">加载失败</option>';
          if (status) status.textContent = '加载会话列表失败：' + e.message;
        });
      }

      // ── 事件绑定 ──
      container.querySelector('#tavern-char-file').addEventListener('change', function (e) { handleCharFile(e.target.files[0]).catch(function (err) { alert('导入角色卡失败：' + err.message); }); });
      container.querySelector('#tavern-wb-file').addEventListener('change', function (e) { handleWbFile(e.target.files[0]).catch(function (err) { alert('导入世界书失败：' + err.message); }); });
      container.querySelector('#tavern-preset-file').addEventListener('change', function (e) { handlePresetFile(e.target.files[0]).catch(function (err) { alert('导入预设失败：' + err.message); }); });

      container.querySelector('#tavern-insert-char').addEventListener('click', function () {
        var chs = state.characters.filter(function (c) { return c.enabled; });
        if (!chs.length) { alert('请先导入并启用至少一个角色卡'); return; }
        var text = chs.map(function (c) { return (c.name ? '角色：' + c.name + '\n' : '') + (c.desc ? c.desc : '') + (c.first ? '\n首条：' + c.first : ''); }).join('\n\n---\n\n');
        insertIntoInput(text) ? (container.querySelector('#tavern-status').textContent = '✅ 角色卡已插入当前对话输入框') : alert('没找到输入框');
      });
      container.querySelector('#tavern-insert-wb').addEventListener('click', function () {
        var entries = [];
        state.worldbooks.forEach(function (wb) { if (wb.enabled) (wb.entries || []).forEach(function (e) { if (e.enabled !== false && (e.content || e.text)) entries.push((e.key || e.name || '条目') + '：' + (e.content || e.text)); }); });
        if (!entries.length) { alert('请先导入并启用世界书'); return; }
        insertIntoInput(entries.join('\n\n')) ? (container.querySelector('#tavern-status').textContent = '✅ 世界书已插入当前对话') : alert('没找到输入框');
      });
      container.querySelector('#tavern-insert-foot').addEventListener('click', function () {
        var p = state.presets[state.activePresetIdx];
        if (!p || !p.footNote) { alert('请先导入预设（含足部描写模块）'); return; }
        insertIntoInput(p.footNote) ? (container.querySelector('#tavern-status').textContent = '✅ 足部描写已插入') : alert('没找到输入框');
      });

      // 故事背景
      var sessionLoading = false;
      container.querySelector('#tavern-session-load').addEventListener('click', function () {
        if (sessionLoading) return;
        var sel = container.querySelector('#tavern-session-select');
        var id = sel.value;
        var btn = container.querySelector('#tavern-session-load');
        var status = container.querySelector('#tavern-session-status');
        if (!id) { alert('请先选择一个会话'); return; }
        sessionLoading = true;
        btn.disabled = true;
        btn.textContent = '读取中…';
        status.textContent = '正在读取对话内容（最多 50 条）…';
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, 20000);
        fetch('/api/tavern/session-content?id=' + encodeURIComponent(id) + '&limit=50', { signal: ctrl.signal }).then(function (r) { return r.json(); }).then(function (data) {
          clearTimeout(timer);
          if (!data.ok) { status.textContent = '❌ 读取失败：' + (data.error || '未知错误'); return; }
          container.querySelector('#tavern-story-bg').value = data.text || '';
          status.textContent = '✅ 已读取 ' + data.count + ' 条消息（可编辑后点「导入为故事背景」）';
        }).catch(function (e) {
          clearTimeout(timer);
          status.textContent = '❌ 读取失败：' + (e.name === 'AbortError' ? '超时（会话可能太大或损坏）' : e.message);
        }).finally(function () {
          sessionLoading = false;
          btn.disabled = false;
          btn.textContent = '读取对话';
        });
      });
      container.querySelector('#tavern-session-import').addEventListener('click', function () {
        var text = container.querySelector('#tavern-story-bg').value;
        if (!text.trim()) { alert('故事背景为空，请先读取或输入内容'); return; }
        state.storyBackground = text;
        refreshYml();
        container.querySelector('#tavern-session-status').textContent = '✅ 已设为故事背景（' + text.length + ' 字），保存后生效';
      });
      container.querySelector('#tavern-story-clear').addEventListener('click', function () {
        state.storyBackground = '';
        container.querySelector('#tavern-story-bg').value = '';
        refreshYml();
        container.querySelector('#tavern-session-status').textContent = '已清空故事背景';
      });
      container.querySelector('#tavern-story-bg').addEventListener('input', function (e) {
        state.storyBackground = e.target.value;
        refreshYml();
      });

      // 记忆模块
      container.querySelector('#tavern-api-save').addEventListener('click', function () {
        var body = {
          apiUrl: container.querySelector('#tavern-api-url').value.trim(),
          apiKey: container.querySelector('#tavern-api-key').value.trim(),
          model: container.querySelector('#tavern-api-model').value.trim() || 'deepseek-chat',
          autoEnabled: container.querySelector('#tavern-auto-enabled').checked,
          autoEvery: Math.max(1, Math.floor(Number(container.querySelector('#tavern-auto-every').value) || 20))
        };
        fetch('/api/tavern/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }).then(function (data) {
          container.querySelector('#tavern-api-status').textContent = data.ok ? '✅ 记忆模块设置已保存' : '❌ ' + (data.error || '');
        });
      });
      container.querySelector('#tavern-summarize-run').addEventListener('click', function () {
        var rounds = Math.max(1, Math.floor(Number(container.querySelector('#tavern-summarize-rounds').value) || 20));
        // 内联获取 sessionId（不依赖外部函数）
        var sid = '';
        try {
          var m = location.pathname.match(/session[\/=]([a-zA-Z0-9_-]+)/);
          if (m) sid = m[1];
          else { var m2 = location.hash.match(/session[\/=]([a-zA-Z0-9_-]+)/); if (m2) sid = m2[1]; }
        } catch (e) {}
        if (!sid) {
          // 尝试从 DOM 中获取
          var activeEl = document.querySelector('[data-session-id], .session-item.active, [class*="active"][data-id]');
          if (activeEl) sid = activeEl.getAttribute('data-session-id') || activeEl.getAttribute('data-id') || '';
        }
        container.querySelector('#tavern-summary-preview').textContent = '正在总结…（会话: ' + (sid || '自动检测') + '）';
        fetch('/api/tavern/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rounds: rounds, sessionId: sid }) }).then(function (r) { return r.json(); }).then(function (data) {
          container.querySelector('#tavern-summary-preview').textContent = data.ok ? ('✅ 总结完成：\n' + (data.summary || '')) : ('❌ ' + (data.error || '未知错误') + '\n会话ID: ' + sid);
        }).catch(function (e) { container.querySelector('#tavern-summary-preview').textContent = '❌ 请求失败: ' + e.message; });
      });

      // 世界书管理
      var wbEntries = [];
      var wbMode = 'full';
      function renderWbList() {
        var list = container.querySelector('#tavern-wb-list');
        if (!wbEntries.length) { list.innerHTML = '<span class="t-status">暂无世界书条目，点「＋ 新增条目」创建，或导入 SillyTavern 世界书 JSON</span>'; return; }
        var html = '';
        wbEntries.forEach(function (entry, idx) {
          html += '<div style="border:1px solid var(--dsw-alias-border-default);border-radius:8px;padding:10px;margin-bottom:8px;background:var(--dsw-alias-bg-elevated,#1a1a2e)">';
          html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">';
          html += '<input type="checkbox" data-wb-idx="' + idx + '" data-wb-field="enabled" ' + (entry.enabled !== false ? 'checked' : '') + '>';
          html += '<input type="text" data-wb-idx="' + idx + '" data-wb-field="name" value="' + (entry.name || '').replace(/"/g, '&quot;') + '" placeholder="条目名称" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--dsw-alias-border-default);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)">';
          html += '<button data-wb-idx="' + idx + '" data-wb-action="delete" style="padding:4px 10px;border-radius:4px;border:none;background:#e74c3c;color:#fff;cursor:pointer;font-size:12px">删除</button>';
          html += '</div>';
          html += '<div style="margin-bottom:6px"><label style="font-size:11px;color:var(--dsw-alias-label-secondary)">关键词（逗号分隔，命中时注入）：</label>';
          html += '<input type="text" data-wb-idx="' + idx + '" data-wb-field="keywords" value="' + ((entry.keywords || []).join(', ')).replace(/"/g, '&quot;') + '" style="width:100%;padding:4px 8px;border-radius:4px;border:1px solid var(--dsw-alias-border-default);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);margin-top:2px"></div>';
          html += '<textarea data-wb-idx="' + idx + '" data-wb-field="content" rows="3" placeholder="条目内容（设定/剧情/人物信息等）" style="width:100%;padding:6px 8px;border-radius:4px;border:1px solid var(--dsw-alias-border-default);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);resize:vertical">' + (entry.content || '') + '</textarea>';
          html += '</div>';
        });
        list.innerHTML = html;
        // 绑定事件
        list.querySelectorAll('[data-wb-field]').forEach(function (el) {
          el.addEventListener('change', function () {
            var idx = parseInt(el.dataset.wbIdx);
            var field = el.dataset.wbField;
            if (field === 'enabled') wbEntries[idx].enabled = el.checked;
            else if (field === 'keywords') wbEntries[idx].keywords = el.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
            else wbEntries[idx][field] = el.value;
          });
        });
        list.querySelectorAll('[data-wb-action="delete"]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var idx = parseInt(btn.dataset.wbIdx);
            wbEntries.splice(idx, 1);
            saveWb();
          });
        });
      }
      function loadWb() {
        fetch('/api/tavern/worldbook').then(function (r) { return r.json(); }).then(function (data) {
          if (data.ok) { wbEntries = data.entries || []; wbMode = data.injectMode || 'full'; container.querySelector('#tavern-wb-mode').value = wbMode; renderWbList(); }
        });
      }
      function saveWb() {
        fetch('/api/tavern/worldbook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries: wbEntries, injectMode: wbMode }) }).then(function (r) { return r.json(); }).then(function (data) {
          container.querySelector('#tavern-wb-status').textContent = data.ok ? '✅ 世界书已保存（' + wbEntries.length + ' 条）' : '❌ ' + data.error;
        });
      }
      loadWb();
      container.querySelector('#tavern-wb-mode').addEventListener('change', function () { wbMode = this.value; saveWb(); });
      container.querySelector('#tavern-wb-add').addEventListener('click', function () {
        wbEntries.push({ id: 'wb_' + Date.now(), name: '新条目', keywords: [], content: '', enabled: true, position: 'before_char' });
        renderWbList(); saveWb();
      });
      container.querySelector('#tavern-wb-export').addEventListener('click', function () {
        fetch('/api/tavern/worldbook/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }).then(function (r) { return r.json(); }).then(function (data) {
          container.querySelector('#tavern-wb-status').textContent = data.ok ? '✅ 已导出到: ' + data.path : '❌ ' + data.error;
        });
      });
      container.querySelector('#tavern-wb-open').addEventListener('click', function () {
        fetch('/api/tavern/worldbook/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }).then(function (r) { return r.json(); }).then(function (data) {
          container.querySelector('#tavern-wb-status').textContent = data.ok ? '✅ 已用编辑器打开: ' + data.path : '❌ ' + data.error;
        });
      });
      container.querySelector('#tavern-wb-import').addEventListener('click', function () {
        if (!confirm('从 worldbook.md 导入会覆盖当前所有条目，确定？')) return;
        fetch('/api/tavern/worldbook/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }).then(function (r) { return r.json(); }).then(function (data) {
          container.querySelector('#tavern-wb-status').textContent = data.ok ? '✅ 已导入 ' + data.entryCount + ' 条' : '❌ ' + data.error;
          if (data.ok) loadWb();
        });
      });

      // 记忆
      container.querySelector('#tavern-memory-save').addEventListener('click', function () {
        fetch('/api/tavern/memory', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memory: container.querySelector('#tavern-memory-text').value }) }).then(function (r) { return r.json(); }).then(function (data) { container.querySelector('#tavern-status').textContent = data.ok ? '✅ 记忆已保存' : '❌ ' + data.error; });
      });
      container.querySelector('#tavern-memory-load').addEventListener('click', function () {
        fetch('/api/tavern/memory').then(function (r) { return r.json(); }).then(function (data) { if (data.ok) container.querySelector('#tavern-memory-text').value = data.memory || ''; });
      });

      // 关系网
      function renderRelationsGraph(relations) {
        var g = container.querySelector('#tavern-relations-graph');
        if (!g) return;
        var nodes = relations && relations.nodes ? relations.nodes : [];
        var edges = relations && relations.edges ? relations.edges : [];
        if (!nodes.length && !edges.length) {
          g.innerHTML = '<span class="t-status">暂无关系节点（可在下方编辑 JSON 后保存，或用「手动总结」自动生成）</span>';
          return;
        }
        var nodeMap = {};
        nodes.forEach(function (n) { nodeMap[n.id] = n.label || n.id; });
        var html = '<div style="margin-bottom:6px"><strong>' + nodes.length + '</strong> 个角色，<strong>' + edges.length + '</strong> 条关系</div>';
        if (nodes.length) {
          html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">';
          nodes.forEach(function (n) {
            html += '<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base,#1a1a1a);font-size:11px;font-weight:600">' + esc(n.label || n.id) + '</span>';
          });
          html += '</div>';
        }
        if (edges.length) {
          html += '<div style="font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.8">';
          edges.forEach(function (e) {
            var s = nodeMap[e.source] || e.source || '?';
            var t = nodeMap[e.target] || e.target || '?';
            var l = e.label || e.relation || '相关';
            html += '<div>• ' + esc(s) + ' <span style="color:var(--dsw-alias-brand-primary)">—' + esc(l) + '→</span> ' + esc(t) + '</div>';
          });
          html += '</div>';
        }
        g.innerHTML = html;
      }

      container.querySelector('#tavern-relations-save').addEventListener('click', function () {
        try { var r = JSON.parse(container.querySelector('#tavern-relations-data').value || '{"nodes":[],"edges":[]}'); } catch (e) { alert('关系网 JSON 格式错误'); return; }
        fetch('/api/tavern/relations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ relations: r }) }).then(function (r2) { return r2.json(); }).then(function (data) {
          container.querySelector('#tavern-status').textContent = data.ok ? '✅ 关系网已保存' : '❌ ' + data.error;
          if (data.ok) renderRelationsGraph(r);
        });
      });
      container.querySelector('#tavern-relations-render').addEventListener('click', function () {
        fetch('/api/tavern/relations').then(function (r) { return r.json(); }).then(function (data) {
          if (data.ok && data.relations) {
            container.querySelector('#tavern-relations-data').value = JSON.stringify(data.relations, null, 2);
            renderRelationsGraph(data.relations);
          }
        });
      });

      // NSFW / 额外设定
      container.querySelector('#tavern-nsfw').addEventListener('change', function (e) { state.nsfw = e.target.checked; refreshYml(); });
      container.querySelector('#tavern-extra').addEventListener('input', function (e) { state.extraPrompt = e.target.value; refreshYml(); });

      // 全局注入
      container.querySelector('#tavern-inject').addEventListener('change', function (e) {
        fetch('/api/tavern/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardEnabled: e.target.checked }) }).then(function (r) { return r.json(); }).then(function (data) {
          var ist = container.querySelector('#tavern-inject-status');
          if (ist) ist.textContent = data.cardEnabled ? '✅ 注入中' : '❌ 未注入';
        });
      });

      // 生效模式
      container.querySelector('#tavern-mode-allow').addEventListener('change', function () {
        container.querySelector('#tavern-allow-box').style.display = '';
        container.querySelector('#tavern-ignore-box').style.display = 'none';
        fetch('/api/tavern/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'allowlist' }) });
      });
      container.querySelector('#tavern-mode-global').addEventListener('change', function () {
        container.querySelector('#tavern-allow-box').style.display = 'none';
        container.querySelector('#tavern-ignore-box').style.display = '';
        fetch('/api/tavern/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'global' }) });
      });
      container.querySelector('#tavern-allow-now').addEventListener('click', function () {
        var cwd = container.querySelector('#tavern-allow-now').dataset.cwd;
        if (cwd) { var ta = container.querySelector('#tavern-allow'); ta.value = (ta.value ? ta.value + '\n' : '') + cwd; }
      });
      container.querySelector('#tavern-ignore-now').addEventListener('click', function () {
        var cwd = container.querySelector('#tavern-ignore-now').dataset.cwd;
        if (cwd) { var ta = container.querySelector('#tavern-ignore'); ta.value = (ta.value ? ta.value + '\n' : '') + cwd; }
      });
      container.querySelector('#tavern-allow-add-btn').addEventListener('click', function () {
        var input = container.querySelector('#tavern-allow-add');
        var v = input.value.trim();
        if (v) { var ta = container.querySelector('#tavern-allow'); ta.value = (ta.value ? ta.value + '\n' : '') + v; input.value = ''; }
      });
      container.querySelector('#tavern-allow-save').addEventListener('click', function () {
        var list = container.querySelector('#tavern-allow').value.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        fetch('/api/tavern/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowCwds: list }) }).then(function (r) { return r.json(); }).then(function (data) { container.querySelector('#tavern-scope-status').textContent = '✅ 白名单已保存（' + (data.allowCwds || []).length + ' 条）'; });
      });
      container.querySelector('#tavern-ignore-save').addEventListener('click', function () {
        var list = container.querySelector('#tavern-ignore').value.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        fetch('/api/tavern/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disabledCwds: list }) }).then(function (r) { return r.json(); }).then(function (data) { container.querySelector('#tavern-scope-status').textContent = '✅ 排除列表已保存（' + (data.disabledCwds || []).length + ' 条）'; });
      });

      // 保存 / 读取
      container.querySelector('#tavern-save').addEventListener('click', saveCurrent);
      container.querySelector('#tavern-refresh').addEventListener('click', function () { loadCurrent(); });

      // 初始化
      renderCharacters();
      renderWorldbooks();
      renderPresets();
      refreshYml();
      loadCurrent();
      loadSessionList();
      fetch('/api/tavern/config').then(function (r) { return r.json(); }).then(function (data) {
        if (data.ok && data.mem) {
          container.querySelector('#tavern-api-url').value = data.mem.apiUrl || '';
          container.querySelector('#tavern-api-key').value = data.mem.apiKey || '';
          container.querySelector('#tavern-api-model').value = data.mem.model || 'deepseek-chat';
          container.querySelector('#tavern-auto-enabled').checked = !!data.mem.autoEnabled;
          container.querySelector('#tavern-auto-every').value = data.mem.autoEvery || 20;
        }
      }).catch(function () {});
      fetch('/api/tavern/memory').then(function (r) { return r.json(); }).then(function (data) { if (data.ok) container.querySelector('#tavern-memory-text').value = data.memory || ''; }).catch(function () {});
      fetch('/api/tavern/relations').then(function (r) { return r.json(); }).then(function (data) { if (data.ok && data.relations) { container.querySelector('#tavern-relations-data').value = JSON.stringify(data.relations, null, 2); renderRelationsGraph(data.relations); } }).catch(function () {});

      return { state: state, refreshYml: refreshYml };
    }

    // ── 设置页组件 ───────────────────────────────────────────────────
    function TavernSettingsSection(props) {
      var ref = react.useRef(null);
      react.useEffect(function () {
        if (ref.current) {
          mountTavernManager(ref.current);
          return function () { if (ref.current) ref.current.innerHTML = ''; };
        }
      }, []);
      return h("div", { ref: ref, style: { width: "100%" } });
    }

    // ── 插件入口 ─────────────────────────────────────────────────────
    var inject = ["slots", "locale"];
    var NS = "tavernManager";
    var zh = { nav: "🍺 酒馆管理", intro: "角色卡 / 世界书 / 预设 / 故事背景 / 记忆模块管理" };
    var en = { nav: "🍺 Tavern Manager", intro: "Character cards / world books / presets / story background / memory module" };

    // ── AI 回复编辑功能 ──────────────────────────────────────────────
    function initMessageEditor() {
      var editedCache = {};
      var currentSessionId = '';
      var observer = null;

      function getSessionId() {
        // 从 URL 路径提取 session ID
        var m = location.pathname.match(/session[\/=]([a-zA-Z0-9_-]+)/);
        if (m) return m[1];
        // 尝试从 hash
        var m2 = location.hash.match(/session[\/=]([a-zA-Z0-9_-]+)/);
        if (m2) return m2[1];
        return '';
      }

      async function loadEditions(sid) {
        if (!sid) { editedCache = {}; return; }
        try {
          var r = await fetch('/api/tavern/edited-messages?sessionId=' + encodeURIComponent(sid));
          var d = await r.json();
          editedCache = d.edited || {};
        } catch (e) { editedCache = {}; }
      }

      async function saveEdition(sid, key, text) {
        try {
          await fetch('/api/tavern/edited-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sid, key: key, text: text })
          });
        } catch (e) { console.error('[tavern] save edit failed', e); }
      }

      function findAiMessages() {
        // DSH 真实 AI 消息容器：.Sxvs8a_root（AssistantMarkdown）
        var selectors = [
          '.Sxvs8a_root',
          '[class*="Sxvs8a_root"]',
          '[data-role="assistant"]',
          '.assistant-message',
          '.chat-message.assistant'
        ];
        var seen = new Set();
        var result = [];
        for (var i = 0; i < selectors.length; i++) {
          var els = document.querySelectorAll(selectors[i]);
          for (var j = 0; j < els.length; j++) {
            // 跳过正在流式输出的消息
            if (els[j].getAttribute('data-streaming') !== null) continue;
            if (!seen.has(els[j])) { seen.add(els[j]); result.push(els[j]); }
          }
        }
        return result;
      }

      function getMessageContentEl(msgEl) {
        // DSH AI 消息内容在 .Sxvs8a_body 里
        var selectors = ['.Sxvs8a_body', '[class*="Sxvs8a_body"]', '.markdown', '.prose', '.message-content'];
        for (var i = 0; i < selectors.length; i++) {
          var el = msgEl.querySelector(selectors[i]);
          if (el) return el;
        }
        return msgEl;
      }

      function startEdit(msgEl, contentEl, index) {
        var originalText = contentEl.innerText || contentEl.textContent || '';
        // 创建编辑层
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
        var box = document.createElement('div');
        box.style.cssText = 'background:var(--dsw-alias-bg-base,#1e1e1e);padding:20px;border-radius:12px;width:90%;max-width:800px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,0.1));';
        var title = document.createElement('div');
        title.textContent = '✏️ 编辑 AI 回复（第 ' + (index + 1) + ' 条）';
        title.style.cssText = 'font-size:16px;font-weight:600;margin-bottom:4px;color:var(--dsw-alias-text-primary,#e0e0e0);';
        var hint = document.createElement('div');
        hint.textContent = '保存后会注入系统提示词，影响后续 AI 生成走向。';
        hint.style.cssText = 'font-size:12px;color:var(--dsw-alias-text-secondary,#999);margin-bottom:12px;';
        var ta = document.createElement('textarea');
        ta.value = originalText;
        ta.style.cssText = 'flex:1;width:100%;min-height:200px;padding:12px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,0.15));border-radius:8px;resize:vertical;font-family:inherit;font-size:14px;background:var(--dsw-alias-bg-raised,#2a2a2a);color:var(--dsw-alias-text-primary,#e0e0e0);box-sizing:border-box;line-height:1.6;';
        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;align-items:center;margin-top:12px;';
        var saveBtn = document.createElement('button');
        saveBtn.textContent = '保存';
        saveBtn.style.cssText = 'padding:8px 20px;background:var(--dsw-alias-brand-primary,#4f46e5);color:var(--dsw-alias-bg-base,#1a1a1a);border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;';
        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.style.cssText = 'padding:8px 20px;background:var(--dsw-alias-bg-raised,#333);color:var(--dsw-alias-text-primary,#e0e0e0);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,0.15));border-radius:6px;cursor:pointer;font-size:14px;';
        var resetBtn = document.createElement('button');
        resetBtn.textContent = '恢复原文';
        resetBtn.style.cssText = 'padding:8px 16px;background:transparent;color:var(--dsw-alias-text-secondary,#999);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,0.15));border-radius:6px;cursor:pointer;font-size:13px;margin-right:auto;';

        btnRow.appendChild(resetBtn);
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        box.appendChild(title);
        box.appendChild(hint);
        box.appendChild(ta);
        box.appendChild(btnRow);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        ta.focus();

        function close() { overlay.remove(); }
        cancelBtn.onclick = close;
        overlay.onclick = function (e) { if (e.target === overlay) close(); };
        resetBtn.onclick = function () { ta.value = originalText; };
        saveBtn.onclick = async function () {
          var newText = ta.value;
          // 更新 DOM 显示
          if (contentEl.tagName === 'P' || contentEl.classList.contains('markdown') || contentEl.classList.contains('prose')) {
            contentEl.innerHTML = '';
            contentEl.textContent = newText;
          } else {
            contentEl.textContent = newText;
          }
          msgEl.dataset.tavernEdited = '1';
          msgEl.dataset.tavernEditIndex = String(index);
          await saveEdition(currentSessionId, index, newText);
          editedCache[String(index)] = { text: newText };
          close();
        };
      }

      function decorateMessages() {
        var msgs = findAiMessages();
        for (var i = 0; i < msgs.length; i++) {
          (function (msgEl, index) {
            if (msgEl.dataset.tavernDecorated) {
              // 已装饰过，检查是否需要应用编辑覆盖
              var key = String(index);
              if (editedCache[key] && !msgEl.dataset.tavernEditApplied) {
                var contentEl = getMessageContentEl(msgEl);
                if (contentEl) {
                  contentEl.textContent = editedCache[key].text;
                  msgEl.dataset.tavernEditApplied = '1';
                }
              }
              return;
            }
            msgEl.dataset.tavernDecorated = '1';
            msgEl.dataset.tavernEditIndex = String(index);

            // 应用编辑覆盖
            var key2 = String(index);
            var contentEl2 = getMessageContentEl(msgEl);
            if (editedCache[key2] && contentEl2) {
              contentEl2.textContent = editedCache[key2].text;
              msgEl.dataset.tavernEditApplied = '1';
              // 加已修正标记
              var badge = document.createElement('span');
              badge.textContent = '✏️ 已修正（影响后续生成）';
              badge.style.cssText = 'position:absolute;top:6px;left:6px;background:var(--dsw-alias-brand-primary,#4f46e5);color:#fff;font-size:11px;padding:2px 8px;border-radius:4px;z-index:11;opacity:0.85;';
              msgEl.appendChild(badge);
            }

            // 加编辑按钮 - 放右下角，默认完全隐藏，悬停消息才出现
            var btn = document.createElement('button');
            btn.textContent = '✏️';
            btn.title = '编辑这条 AI 回复';
            btn.style.cssText = 'position:absolute;bottom:6px;right:8px;opacity:0;transition:opacity 0.15s;background:var(--dsw-alias-bg-raised,rgba(255,255,255,0.08));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,0.1));border-radius:5px;width:20px;height:20px;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;z-index:20;line-height:1;pointer-events:none;';
            btn.onmouseenter = function () { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; };
            btn.onmouseleave = function () { btn.style.opacity = '0'; btn.style.pointerEvents = 'none'; };
            btn.onclick = function (e) {
              e.stopPropagation();
              e.preventDefault();
              startEdit(msgEl, getMessageContentEl(msgEl), index);
            };
            // 确保消息容器是 relative
            var pos = getComputedStyle(msgEl).position;
            if (pos === 'static') msgEl.style.position = 'relative';
            msgEl.appendChild(btn);
            // 容器 hover 时按钮出现
            msgEl.onmouseenter = function () { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; };
            msgEl.onmouseleave = function () { btn.style.opacity = '0'; btn.style.pointerEvents = 'none'; };
          })(msgs[i], i);
        }
      }

      function checkSessionChange() {
        var sid = getSessionId();
        if (sid !== currentSessionId) {
          currentSessionId = sid;
          loadEditions(sid).then(function () { decorateMessages(); });
        }
      }

      // 启动监听
      if (observer) observer.disconnect();
      observer = new MutationObserver(function () {
        checkSessionChange();
        decorateMessages();
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // 初始
      currentSessionId = getSessionId();
      loadEditions(currentSessionId).then(function () { decorateMessages(); });

      // 定时检查会话切换（有些 SPA 不触发 body mutation）
      setInterval(checkSessionChange, 2000);
    }

    function apply(ctx) {
      console.log('[dsh-tavern] settings-section plugin loaded (v2 fixed)');
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "dsh-tavern: dictionaries");
      var t = ctx.locale.bind(NS);
      var slots = ctx.slots;
      slots.inject("settings.section", function () {
        return slots.register({
          name: "settings.section",
          id: "tavern-manager",
          order: 25,
          label: function () { return t("nav"); },
          locale: NS
        }, function (props) {
          return h(TavernSettingsSection, props);
        });
      });
      // 启动 AI 回复编辑功能
      try { initMessageEditor(); } catch (e) { console.error('[tavern] message editor init failed', e); }
      // 会话级预设选择条 + 隐藏 yml 板块
      try { (function () {
        // 自定义对话框（Electron 禁用原生 prompt/confirm）
        function showDlg(opts) {
          return new Promise(function (resolve) {
            var ov = document.createElement('div');
            ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif';
            var box = document.createElement('div');
            box.style.cssText = 'background:#1e1e2e;color:#eee;border-radius:12px;padding:24px;min-width:320px;max-width:90vw;box-shadow:0 12px 40px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.1)';
            var t = document.createElement('div');
            t.style.cssText = 'font-size:16px;font-weight:600;margin-bottom:12px;color:#fff';
            t.textContent = opts.title;
            box.appendChild(t);
            if (opts.message) {
              var m = document.createElement('div');
              m.style.cssText = 'font-size:13px;color:#aaa;margin-bottom:16px;line-height:1.5';
              m.textContent = opts.message;
              box.appendChild(m);
            }
            var input = null;
            if (opts.type === 'prompt') {
              input = document.createElement('input');
              input.type = 'text';
              input.value = opts.defaultValue || '';
              input.style.cssText = 'width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:#16162a;color:#fff;font-size:14px;box-sizing:border-box;margin-bottom:16px';
              box.appendChild(input);
            }
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end';
            var cancel = document.createElement('button');
            cancel.textContent = '取消';
            cancel.style.cssText = 'padding:8px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#ccc;font-size:13px;cursor:pointer';
            var ok = document.createElement('button');
            ok.textContent = opts.type === 'confirm' ? '确定' : '创建';
            ok.style.cssText = 'padding:8px 18px;border-radius:8px;border:none;background:#e94560;color:#fff;font-size:13px;cursor:pointer;font-weight:600';
            row.appendChild(cancel); row.appendChild(ok); box.appendChild(row); ov.appendChild(box);
            document.body.appendChild(ov);
            if (input) setTimeout(function () { input.focus(); }, 50);
            function done() { ov.remove(); }
            cancel.addEventListener('click', function () { done(); resolve(opts.type === 'confirm' ? false : null); });
            ok.addEventListener('click', function () { done(); resolve(opts.type === 'confirm' ? true : (input ? input.value : '')); });
            if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') cancel.click(); });
            ov.addEventListener('click', function (e) { if (e.target === ov) cancel.click(); });
          });
        }
        function showPrompt(title, def) { return showDlg({ title: title, defaultValue: def, type: 'prompt' }); }
        function showConfirm(msg) { return showDlg({ title: '确认操作', message: msg, type: 'confirm' }); }
        var BAR_ID = 'dsh-tavern-preset-bar';
        var PANEL_ID = 'dsh-tavern-preset-panel';
        var currentPresetId = 'default', currentPresetName = '默认预设', presetList = [];
        function ensureBar() {
          var bar = document.getElementById(BAR_ID);
          if (bar && bar.isConnected) return bar;
          bar = document.createElement('div');
          bar.id = BAR_ID;
          bar.innerHTML = '<span>🎭</span><span class="pb-name" style="font-weight:600;color:#7ab8ff;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">预设</span><span>▾</span>';
          bar.style.cssText = 'position:fixed;top:10px;right:140px;z-index:2147483647;display:flex;align-items:center;gap:5px;padding:5px 12px;font-size:12px;background:rgba(30,30,46,.92);backdrop-filter:blur(8px);border:1px solid rgba(233,69,96,.4);border-radius:16px;cursor:pointer;user-select:none;color:#eee;box-shadow:0 2px 12px rgba(0,0,0,.4)';
          bar.addEventListener('mouseenter', function () { bar.style.borderColor = 'rgba(233,69,96,.8)'; bar.style.background = 'rgba(40,40,60,.95)'; });
          bar.addEventListener('mouseleave', function () { bar.style.borderColor = 'rgba(233,69,96,.4)'; bar.style.background = 'rgba(30,30,46,.92)'; });
          bar.addEventListener('click', function (e) { e.stopPropagation(); togglePanel(bar); });
          document.body.appendChild(bar);
          return bar;
        }
        function togglePanel(bar) {
          var p = document.getElementById(PANEL_ID);
          if (p && p.isConnected) { p.remove(); return; }
          if (!presetList.length) { loadPresets().then(function () { showPanel(bar); }); }
          else showPanel(bar);
        }
        function showPanel(bar) {
          document.getElementById(PANEL_ID)?.remove();
          var panel = document.createElement('div');
          panel.id = PANEL_ID;
          var r = bar.getBoundingClientRect();
          panel.style.cssText = 'position:fixed;top:' + (r.bottom + 4) + 'px;left:' + r.left + 'px;min-width:240px;max-height:60vh;overflow-y:auto;background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:99999;padding:8px';
          var h = document.createElement('div');
          h.style.cssText = 'padding:6px 8px;font-size:11px;color:#888;font-weight:600;text-transform:uppercase';
          h.textContent = '选择预设（绑定到当前会话）';
          panel.appendChild(h);
          presetList.forEach(function (p) {
            var item = document.createElement('div');
            var active = p.id === currentPresetId;
            item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:13px;' + (active ? 'background:rgba(59,127,240,.1);color:#3b7ff0;font-weight:600' : '');
            item.innerHTML = '<span>' + (active ? '✓' : '&nbsp;') + '</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (p.name || '') + '</span><span style="font-size:11px;color:#999">' + (p.cardChars || 0) + '字</span>';
            item.addEventListener('click', function (e) { e.stopPropagation(); bindPreset(p.id, p.name); panel.remove(); });
            item.addEventListener('mouseenter', function () { if (!active) item.style.background = 'rgba(0,0,0,.04)'; });
            item.addEventListener('mouseleave', function () { if (!active) item.style.background = ''; });
            panel.appendChild(item);
          });
          var nb = document.createElement('div');
          nb.style.cssText = 'margin-top:6px;padding:8px 10px;border-top:1px solid rgba(0,0,0,.06);font-size:12px;color:#3b7ff0;cursor:pointer;border-radius:6px';
          nb.textContent = '＋ 新建预设（复制当前）';
          nb.addEventListener('click', async function (e) {
            e.stopPropagation();
            var name = await showPrompt('新预设名称：', '新预设');
            if (name && name.trim()) createPreset(name.trim(), currentPresetId).then(function () { panel.remove(); loadPresets(); });
          });
          panel.appendChild(nb);
          if (currentPresetId !== 'default') {
            var acts = document.createElement('div');
            acts.style.cssText = 'display:flex;gap:8px;margin-top:4px;padding-top:6px;border-top:1px solid rgba(0,0,0,.06)';
            var rb = document.createElement('span');
            rb.style.cssText = 'flex:1;text-align:center;padding:6px;font-size:12px;color:#666;cursor:pointer;border-radius:4px';
            rb.textContent = '✏️ 重命名';
            rb.addEventListener('click', async function (e) {
              e.stopPropagation();
              var p = presetList.find(function (x) { return x.id === currentPresetId; });
              var name = await showPrompt('重命名预设：', p ? p.name : '');
              if (name && name.trim()) renamePreset(currentPresetId, name.trim()).then(function () { panel.remove(); loadPresets(); });
            });
            var db = document.createElement('span');
            db.style.cssText = 'flex:1;text-align:center;padding:6px;font-size:12px;color:#e74c3c;cursor:pointer;border-radius:4px';
            db.textContent = '🗑️ 删除';
            db.addEventListener('click', async function (e) {
              e.stopPropagation();
              if (await showConfirm('确定删除当前预设？该会话将回退到默认预设。')) {
                deletePreset(currentPresetId).then(function () { panel.remove(); loadPresets(); refreshCurrent(); });
              }
            });
            acts.appendChild(rb); acts.appendChild(db); panel.appendChild(acts);
          }
          document.body.appendChild(panel);
          var close = function (e) { if (!panel.contains(e.target) && e.target !== bar) { panel.remove(); document.removeEventListener('click', close); } };
          setTimeout(function () { document.addEventListener('click', close); }, 0);
        }
        function updBar() {
          var bar = document.getElementById(BAR_ID); if (!bar) return;
          var n = bar.querySelector('.pb-name'); if (n) { n.textContent = currentPresetName || '默认预设'; }
          bar.title = '当前预设：' + (currentPresetName || '默认预设') + '（点击切换）';
        }
        function loadPresets() { return fetch('/api/tavern/presets').then(function (r) { return r.json(); }).then(function (d) { if (d.ok) presetList = d.presets || []; }); }
        function refreshCurrent() { return fetch('/api/tavern/read').then(function (r) { return r.json(); }).then(function (d) { if (d.ok) { currentPresetId = d.presetId || 'default'; currentPresetName = d.presetName || '默认预设'; updBar(); } }); }
        function bindPreset(id, name) { return fetch('/api/tavern/bind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ presetId: id }) }).then(function (r) { return r.json(); }).then(function (d) { if (d.ok) { currentPresetId = d.presetId; currentPresetName = d.presetName; updBar(); } }); }
        function createPreset(name, copyFrom) { return fetch('/api/tavern/presets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name, copyFrom: copyFrom }) }).then(function (r) { return r.json(); }); }
        function renamePreset(id, name) { return fetch('/api/tavern/preset/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id, name: name }) }).then(function (r) { return r.json(); }); }
        function deletePreset(id) { return fetch('/api/tavern/preset/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id }) }).then(function (r) { return r.json(); }); }
        function hideYml() {
          var ta = document.getElementById('tavern-agent-yml');
          if (ta) {
            ta.style.display = 'none';
            var lbl = ta.previousElementSibling;
            if (lbl && lbl.textContent && lbl.textContent.indexOf('agent.cordis.yml') >= 0) lbl.style.display = 'none';
          }
        }
        var obs = new MutationObserver(function () { ensureBar(); hideYml(); });
        obs.observe(document.body, { childList: true, subtree: true });
        ensureBar(); hideYml();
        loadPresets(); refreshCurrent();
        setInterval(refreshCurrent, 2000);
      })(); } catch (e) { console.error('[tavern] preset bar init failed', e); }
      // 隐藏 yml 板块
      try {
        var hideYml = function () {
          var ta = document.getElementById('tavern-agent-yml');
          if (ta) {
            ta.style.display = 'none';
            var lbl = ta.previousElementSibling;
            if (lbl && lbl.textContent && lbl.textContent.indexOf('agent.cordis.yml') >= 0) lbl.style.display = 'none';
          }
        };
        var ymlObs = new MutationObserver(function () { hideYml(); });
        ymlObs.observe(document.body, { childList: true, subtree: true });
        hideYml();
      } catch (e) { console.error('[tavern] hide yml failed', e); }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
