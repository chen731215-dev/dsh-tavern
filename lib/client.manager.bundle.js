window.__ModuleLoader__.load({
  id: "@local/dsh-tavern",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var ENTRY_SELECTOR = '[data-dsh-tavern-manager-entry]';
    var PANEL_SELECTOR = '[data-dsh-tavern-manager-view]';
    var ACTIVE_ATTR = 'data-dsh-tavern-manager-active';

    function sidebarRoot() {
      var column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
      if (!column) return undefined;
      var logoOwner = column.querySelector('[class*="logoRow"]') ? column.querySelector('[class*="logoRow"]').parentElement : undefined;
      return logoOwner || (column.firstElementChild || undefined);
    }

    function newSessionButton(root) {
      var nested = root.querySelector('button[class*="newSession"]');
      if (nested) return nested;
      for (var i = 0; i < root.children.length; i++) {
        if (root.children[i].tagName === 'BUTTON') return root.children[i];
      }
      return undefined;
    }

    function createEntry() {
      var entry = document.createElement('button');
      entry.type = 'button';
      entry.dataset.dshTavernManagerEntry = '';
      entry.textContent = '🍺 酒馆管理';
      entry.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%;padding:8px 12px;background:transparent;border:none;color:inherit;cursor:pointer;font-size:13px;text-align:left;border-radius:8px;';
      return entry;
    }

    function placeEntry(root, entry) {
      var button = newSessionButton(root);
      if (!button) {
        if (entry.parentElement !== root) root.appendChild(entry);
        return true;
      }
      if (entry.parentElement !== root) {
        var row = button.closest('[class*="logoRow"]');
        var base = (row && row.parentElement === root) ? row : button;
        root.insertBefore(entry, base.nextElementSibling);
      }
      return true;
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

    function truncate(str, max) {
      var s = String(str || '');
      return s.length > max ? s.slice(0, max) + '…' : s;
    }

    function esc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function parseJsonText(text) {
      return JSON.parse(text);
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
          if (znul < 0 || zstr.slice(0, znul) !== keyword) continue;
          var method = data[znul + 1];
          if (method !== 0) continue;
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

    function buildAgentYml(state) {
      var sections = [];
      // 多个角色卡（启用中的全部合并）
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
      // 多个世界书（启用中的全部条目）
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
      // 当前选中的预设 -> 启用模块 + 足部
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
      var value = '';
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        value = input.value || '';
        input.value = value + (value ? '\n' : '') + text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        input.textContent = (input.textContent || '') + '\n' + text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    }

    function createPanel() {
      var container = document.createElement('div');
      container.dataset.dshTavernManagerView = '';
      container.id = 'tavern-manager';
        container.style.cssText = 'position:absolute;inset:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);z-index:999;display:none;overflow:auto;padding:24px;box-sizing:border-box;';
      container.innerHTML = [
        '<style>#tavern-manager{font-family:"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;color:var(--dsw-alias-label-primary)}#tavern-manager h2{font-size:20px;font-weight:700;color:var(--dsw-alias-label-primary)}#tavern-manager button{cursor:pointer;border:none;border-radius:8px;padding:8px 14px;background:var(--dsw-alias-brand-primary);color:#fff;font-size:13px;transition:filter .15s}#tavern-manager button:hover{filter:brightness(.92)}#tavern-manager input[type="file"]{padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px}#tavern-manager textarea,#tavern-manager input:not([type="file"]){border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;font-size:13px;font-family:inherit;resize:vertical;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}#tavern-manager label{font-size:13px;color:var(--dsw-alias-label-secondary)}#tavern-manager .card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,.04)}#tavern-manager .card strong{font-size:14px;color:var(--dsw-alias-label-primary)}#tavern-manager .item{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;margin-bottom:6px;font-size:13px;color:var(--dsw-alias-label-primary)}#tavern-manager #tavern-close,#tavern-manager #tavern-refresh{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2)}#tavern-manager #tavern-save{background:var(--dsw-alias-brand-primary)}#tavern-manager #tavern-status{margin-top:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}</style>',
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2 style="margin:0">🍺 酒馆管理（原生）</h2><button id="tavern-close" type="button">✕ 关闭</button></div>',
        '<div style="display:flex;flex-direction:column;gap:10px;max-width:800px">',
        '  <div class="card"><strong>角色卡</strong>（支持 PNG / JSON，可导入多份）<div id="tavern-char-list" style="margin-top:6px"></div><div style="margin-top:4px"><input type="file" id="tavern-char-file" accept=".json,.png,image/png,application/json"> <button id="tavern-insert-char" type="button">插入当前对话</button></div></div>',
        '  <div class="card"><strong>世界书</strong>（支持 JSON，可导入多份）<div id="tavern-wb-list" style="margin-top:6px"></div><div style="margin-top:4px"><input type="file" id="tavern-wb-file" accept=".json,application/json"> <button id="tavern-insert-wb" type="button">插入当前对话</button></div></div>',
        '  <div class="card"><strong>预设</strong>（支持 JSON，可导入多份并切换）<div id="tavern-preset-list" style="margin-top:6px"></div><div style="margin-top:4px"><input type="file" id="tavern-preset-file" accept=".json,application/json"> <button id="tavern-insert-foot" type="button">插入足部描写</button></div></div>',
          '  <div class="card"><strong>👁️ 视觉识别</strong>（上传图片，发送给 AI 识别）<br>API 地址 <input id="tavern-vision-url" style="width:100%;margin-top:4px" placeholder="https://opencode.ai/zen/go/v1/chat/completions"><br>API Key <input id="tavern-vision-key" type="password" style="width:100%;margin-top:4px" placeholder="sk-..."><br>模型 <input id="tavern-vision-model" style="width:100%;margin-top:4px" value="deepseek-v4-flash"><br><input type="file" id="tavern-vision-file" accept="image/*" style="margin-top:6px"> <button id="tavern-vision-run" type="button">识别图片</button><div id="tavern-vision-result" style="margin-top:6px;color:var(--dsw-alias-label-primary);font-size:13px;white-space:pre-wrap"></div></div>',
        '  <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="tavern-nsfw" checked> 🔞 NSFW 写作模式</label>',
        '  <label>额外设定 / 系统提示</label><textarea id="tavern-extra" rows="4" style="width:100%;box-sizing:border-box" placeholder="可写额外世界观、文风、角色关系等"></textarea>',
        '  <label>当前将保存的 agent.cordis.yml</label><textarea id="tavern-agent-yml" rows="12" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:12px"></textarea>',
        '  <div style="display:flex;gap:8px"><button id="tavern-save" style="padding:8px 16px">💾 保存到 Harness</button><button id="tavern-refresh" style="padding:8px 16px">🔄 读取当前</button></div>',
        '  <div id="tavern-status" style="color:var(--dsw-alias-label-secondary);font-size:13px"></div>',
        '</div>'
      ].join('');
      return container;
    }

    function apply(ctx) {
      console.log('[dsh-tavern] manager plugin loaded');
      if (window.__dshTavernManagerInstance && typeof window.__dshTavernManagerInstance.dispose === 'function') {
        try { window.__dshTavernManagerInstance.dispose(); } catch (e) {}
        window.__dshTavernManagerInstance = null;
      }
      document.querySelectorAll(PANEL_SELECTOR).forEach(function (el) { el.remove(); });
      document.querySelectorAll(ENTRY_SELECTOR).forEach(function (el) { el.remove(); });
      document.documentElement.removeAttribute(ACTIVE_ATTR);

      var entry, root, placed = false, container;
      var disposers = [];
      var state = { characters: [], worldbooks: [], presets: [], activePresetIdx: -1, extraPrompt: '', nsfw: true };

      function loadCurrent() {
        return fetch('/api/tavern/read').then(function (r) { return r.json(); }).then(function (data) {
          var ta = container.querySelector('#tavern-agent-yml');
          if (ta && data.agentYml) ta.value = data.agentYml;
          var st = container.querySelector('#tavern-status');
          if (st) st.textContent = '已读取当前预设：' + (data.dir || '');
        });
      }

      function saveCurrent() {
        var ta = container.querySelector('#tavern-agent-yml');
        var agentYml = ta ? ta.value : '';
        var presetYml = 'name: 精简酒馆\ndescription: 由 Harness 酒馆管理面板生成。\n';
        return fetch('/api/tavern/save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agentYml: agentYml, presetYml: presetYml })
        }).then(function (r) { return r.json(); }).then(function (data) {
          var st = container.querySelector('#tavern-status');
          if (st) st.textContent = data.ok ? '✅ 已保存到 ' + data.dir : '❌ ' + (data.error || '保存失败');
        });
      }

      function refreshYml() {
        var built = buildAgentYml(state);
        var ta = container.querySelector('#tavern-agent-yml');
        if (ta) ta.value = built.agentYml;
      }

        function renderCharacters() {
          var el = container.querySelector('#tavern-char-list');
          if (!el) return;
          if (!state.characters.length) {
            el.innerHTML = '<div style="color:var(--dsw-alias-label-tertiary)">尚未导入角色卡（可导入多份）</div>';
            return;
          }
          el.innerHTML = state.characters.map(function (c, i) {
            var checked = c.enabled !== false ? 'checked' : '';
            return '<div class="item" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px">' +
              '<label style="display:flex;align-items:center;gap:6px;flex:1;min-width:120px"><input type="checkbox" data-char="' + i + '" ' + checked + '> <strong>' + esc(c.name || ('角色' + (i + 1))) + '</strong></label>' +
              '<button data-char-del="' + i + '" type="button">删除</button>' +
              '<div style="width:100%;color:var(--dsw-alias-label-secondary);font-size:12px">' + esc(truncate(c.desc || '', 60)) + '</div></div>';
          }).join('');
          el.querySelectorAll('[data-char]').forEach(function (cb) {
            cb.addEventListener('change', function () {
              state.characters[Number(cb.getAttribute('data-char'))].enabled = cb.checked;
              refreshYml();
            });
          });
          el.querySelectorAll('[data-char-del]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              state.characters.splice(Number(btn.getAttribute('data-char-del')), 1);
              renderCharacters();
              refreshYml();
            });
          });
        }

        function renderWorldbooks() {
          var el = container.querySelector('#tavern-wb-list');
          if (!el) return;
          if (!state.worldbooks.length) {
            el.innerHTML = '<div style="color:var(--dsw-alias-label-tertiary)">尚未导入世界书（可导入多份）</div>';
            return;
          }
          el.innerHTML = state.worldbooks.map(function (wb, i) {
            var checked = wb.enabled !== false ? 'checked' : '';
            var open = wb.open === true;
            var entries = (wb.entries || []).map(function (e, j) {
              var key = Array.isArray(e.keys) ? e.keys.join(', ') : (e.key || e.name || e.comment || ('条目' + (j + 1)));
              var echk = e.enabled !== false ? 'checked' : '';
              return '<div style="padding-left:18px;margin-top:2px"><div style="display:flex;align-items:center;gap:5px"><input type="checkbox" data-wbe="' + i + '" data-wbi="' + j + '" ' + echk + '> <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1"><strong>' + esc(key) + '</strong></span></div><div style="font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:22px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(truncate(e.content || e.text || '', 60)) + '</div></div>';
            }).join('');
            var count = (wb.entries || []).length;
            return '<div class="item" style="padding:6px 10px">' +
              '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px">' +
              '<button data-wb-toggle="' + i + '" type="button" style="background:transparent;border:none;padding:0 4px;font-size:12px;color:var(--dsw-alias-label-secondary)">' + (open ? '▾' : '▸') + '</button>' +
              '<label style="display:flex;align-items:center;gap:6px;flex:1;min-width:120px;cursor:pointer"><input type="checkbox" data-wb="' + i + '" ' + checked + '> <strong>' + esc(wb.name || ('世界书' + (i + 1))) + '</strong> <span style="color:var(--dsw-alias-label-tertiary);font-size:11px">(' + count + '条)</span>' + (wb.linkedTo ? '<span style="font-size:11px;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:0 6px">🔗 联动自：' + esc(wb.linkedTo) + '</span>' : '') + '</label>' +
              '<button data-wb-del="' + i + '" type="button">删除</button></div>' +
              (open ? '<div style="margin-top:4px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:4px">' + entries + '</div>' : '') +
              '</div>';
          }).join('');
          el.querySelectorAll('[data-wb-toggle]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var i = Number(btn.getAttribute('data-wb-toggle'));
              state.worldbooks[i].open = !(state.worldbooks[i].open === true);
              renderWorldbooks();
            });
          });
          el.querySelectorAll('[data-wb]').forEach(function (cb) {
            cb.addEventListener('change', function () {
              var wb = state.worldbooks[Number(cb.getAttribute('data-wb'))];
              wb.enabled = cb.checked;
              (wb.entries || []).forEach(function (e) { e.enabled = cb.checked; });
              renderWorldbooks();
              refreshYml();
            });
          });
          el.querySelectorAll('[data-wbe]').forEach(function (cb) {
            cb.addEventListener('change', function () {
              var i = Number(cb.getAttribute('data-wbe')); var j = Number(cb.getAttribute('data-wbi'));
              var e = state.worldbooks[i].entries[j];
              if (e) e.enabled = cb.checked;
              refreshYml();
            });
          });
          el.querySelectorAll('[data-wb-del]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              state.worldbooks.splice(Number(btn.getAttribute('data-wb-del')), 1);
              renderWorldbooks();
              refreshYml();
            });
          });
        }

        function renderPresets() {
          var el = container.querySelector('#tavern-preset-list');
          if (!el) return;
          if (!state.presets.length) {
            el.innerHTML = '<div style="color:var(--dsw-alias-label-tertiary)">尚未导入预设（可导入多份并切换）</div>';
            return;
          }
          el.innerHTML = state.presets.map(function (p, i) {
            var isActive = state.activePresetIdx === i;
            var mods = (p.modules || []).map(function (m, j) {
              var mchk = m.enabled !== false ? 'checked' : '';
              return '<div style="padding-left:18px;display:flex;align-items:center;gap:5px;margin-top:2px"><input type="checkbox" data-pm="' + i + '" data-pmi="' + j + '" ' + mchk + '> <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(m.name || ('模块' + (j + 1))) + '</span></div>';
            }).join('');
            return '<div class="item">' +
              '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;' + (isActive ? 'outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px;margin:-2px;padding:2px;border-radius:6px;' : '') + '">' +
              '<strong>' + esc(p.name || ('预设' + (i + 1))) + '</strong>' +
              '<button data-preset-active="' + i + '" type="button" style="' + (isActive ? 'background:var(--dsw-alias-brand-primary);color:#fff;' : '') + '">' + (isActive ? '✓ 当前预设' : '切换到此预设') + '</button>' +
              '<button data-preset-del="' + i + '" type="button">删除</button></div>' +
              (mods ? '<div style="margin-top:4px">' + mods + '</div>' : '') + '</div>';
          }).join('');
          el.querySelectorAll('[data-preset-active]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              state.activePresetIdx = Number(btn.getAttribute('data-preset-active'));
              renderPresets();
              refreshYml();
            });
          });
          el.querySelectorAll('[data-pm]').forEach(function (cb) {
            cb.addEventListener('change', function () {
              var i = Number(cb.getAttribute('data-pm')); var j = Number(cb.getAttribute('data-pmi'));
              var m = state.presets[i].modules[j];
              if (m) m.enabled = cb.checked;
              refreshYml();
            });
          });
          el.querySelectorAll('[data-preset-del]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              state.presets.splice(Number(btn.getAttribute('data-preset-del')), 1);
              if (state.activePresetIdx >= state.presets.length) state.activePresetIdx = state.presets.length - 1;
              renderPresets();
              refreshYml();
            });
          });
        }

      function handleCharFile(file) {
        if (!file) return Promise.resolve();
        function addCard(json) {
          var card = json && json.data && typeof json.data === 'object' ? json.data : json;
          var name = card.name || '';
          state.characters.push({
            name: name,
            desc: card.description || card.personality || card.char_persona || '',
            first: card.first_mes || card.first_message || card.char_greeting || '',
            enabled: true
          });
          // 联动：角色卡内嵌的"角色世界书(character_book)"一起导入
          var cb = (card && card.character_book) || (card && card.world_book);
          if (cb && Array.isArray(cb.entries) && cb.entries.length) {
            var wbEntries = cb.entries.filter(function (e) { return e && (e.content || e.text); }).map(function (e) { e.enabled = e.enabled !== false; return e; });
            if (wbEntries.length) {
              var wbName = (cb.name || cb.title || (name ? name + '的世界书' : '角色世界书'));
              state.worldbooks.push({ name: wbName, entries: wbEntries, enabled: true, linkedTo: name || '' });
            }
          }
          renderCharacters();
          renderWorldbooks();
          refreshYml();
        }
        if (file.name.toLowerCase().endsWith('.png') || file.type === 'image/png') {
          return extractPngChara(file).then(addCard);
        }
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
          renderWorldbooks();
          refreshYml();
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
            if (/足部|脚|foot/i.test(name) || /足部|脚|foot/i.test(content)) {
              footParts.push('【' + name + '】\n' + truncate(sanitizeForHarness(content, ''), 1200));
            }
          }
          var footNote = footParts.join('\n\n') || '【足部描写】\n请根据剧情需要自然加入足部、脚部、脚踝等细节描写。';
          var modules = prompts.map(function (p) { return { name: p.name || p.identifier || '', content: p.content || '', enabled: p.enabled !== false }; });
          var pname = (data && (data.name || data.title)) || file.name.replace(/\.[^.]+$/, '');
          state.presets.push({ name: pname, modules: modules, footNote: footNote });
          state.activePresetIdx = state.presets.length - 1;
          renderPresets();
          refreshYml();
        });
      }

      function ensurePanel() {
        var existing = document.querySelector(PANEL_SELECTOR);
        if (existing && existing.isConnected) return existing;
        var column = document.querySelector('[data-pane="conversation"], [class*="conversationColumn"]');
        if (!column) return undefined;
        container = createPanel();
        column.style.position = column.style.position || 'relative';
        column.appendChild(container);
        renderCharacters();
        renderWorldbooks();
        renderPresets();
        container.querySelector('#tavern-char-file').addEventListener('change', function (e) {
          handleCharFile(e.target.files && e.target.files[0]).catch(function (err) {
            var st = container.querySelector('#tavern-status'); if (st) st.textContent = '角色卡导入失败：' + err.message;
          });
        });
        container.querySelector('#tavern-wb-file').addEventListener('change', function (e) {
          handleWbFile(e.target.files && e.target.files[0]).catch(function (err) {
            var st = container.querySelector('#tavern-status'); if (st) st.textContent = '世界书导入失败：' + err.message;
          });
        });
        container.querySelector('#tavern-preset-file').addEventListener('change', function (e) {
          handlePresetFile(e.target.files && e.target.files[0]).catch(function (err) {
            var st = container.querySelector('#tavern-status'); if (st) st.textContent = '预设导入失败：' + err.message;
          });
        });
          container.querySelector('#tavern-insert-char').addEventListener('click', function () {
            var chs = (state.characters || []).filter(function (c) { return c.enabled; });
            var text = '# 角色卡\n' + chs.map(function (c) {
              return '角色名：' + c.name + '\n' + (c.desc || '');
            }).join('\n\n---\n\n');
            var ok = insertIntoInput(text);
            var st = container.querySelector('#tavern-status'); if (st) st.textContent = ok ? '已插入角色卡到当前对话输入框' : '没找到当前对话输入框';
          });
          container.querySelector('#tavern-insert-wb').addEventListener('click', function () {
            var parts = [];
            (state.worldbooks || []).forEach(function (wb) {
              if (!wb.enabled) return;
              (wb.entries || []).slice(0, 6).forEach(function (e, i) {
                var key = Array.isArray(e.keys) ? e.keys.join(', ') : (e.key || e.name || e.comment || ('世界书' + (i + 1)));
                parts.push('【' + key + '】\n' + (e.content || e.text || ''));
              });
            });
            var ok = insertIntoInput('# 世界书\n' + parts.join('\n\n'));
            var st = container.querySelector('#tavern-status'); if (st) st.textContent = ok ? '已插入世界书到当前对话输入框' : '没找到当前对话输入框';
          });
          container.querySelector('#tavern-insert-foot').addEventListener('click', function () {
            var activeP = (state.presets && state.presets[state.activePresetIdx]) || null;
            var fn = activeP ? (activeP.footNote || '') : '';
            var ok = insertIntoInput(fn || '请加入足部描写');
            var st = container.querySelector('#tavern-status'); if (st) st.textContent = ok ? '已插入足部描写到当前对话输入框' : '没找到当前对话输入框';
          });
        container.querySelector('#tavern-nsfw').addEventListener('change', function (e) {
          state.nsfw = e.target.checked;
          refreshYml();
        });
        container.querySelector('#tavern-extra').addEventListener('input', function (e) {
          state.extraPrompt = e.target.value;
          refreshYml();
        });
        container.querySelector('#tavern-save').addEventListener('click', function () {
          saveCurrent().catch(function (err) {
            var st = container.querySelector('#tavern-status'); if (st) st.textContent = '保存失败：' + err.message;
          });
        });
        container.querySelector('#tavern-refresh').addEventListener('click', function () {
          loadCurrent().catch(function (err) {
            var st = container.querySelector('#tavern-status'); if (st) st.textContent = '读取失败：' + err.message;
          });
        });
          container.querySelector('#tavern-close').addEventListener('click', function () {
            document.documentElement.removeAttribute(ACTIVE_ATTR);
            applyActive();
          });
          container.querySelector('#tavern-vision-run').addEventListener('click', function () {
            var fileInput = container.querySelector('#tavern-vision-file');
            var file = fileInput.files && fileInput.files[0];
            if (!file) {
              var st = container.querySelector('#tavern-vision-result');
              if (st) st.textContent = '请先选择图片';
              return;
            }
            var reader = new FileReader();
            reader.onload = function () {
              var apiUrl = container.querySelector('#tavern-vision-url').value.trim();
              var apiKey = container.querySelector('#tavern-vision-key').value.trim();
              var model = container.querySelector('#tavern-vision-model').value.trim();
              var result = container.querySelector('#tavern-vision-result');
              if (result) result.textContent = '识别中...';
              fetch('/api/tavern/vision', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  apiUrl: apiUrl,
                  apiKey: apiKey,
                  model: model,
                  imageBase64: reader.result,
                  prompt: '请详细描述这张图片的内容。'
                })
              }).then(function (r) { return r.json(); }).then(function (data) {
                if (result) result.textContent = data.ok ? data.text : ('识别失败：' + (data.error || data.raw || '未知错误'));
              }).catch(function (err) {
                if (result) result.textContent = '请求失败：' + err.message;
              });
            };
            reader.readAsDataURL(file);
          });
        loadCurrent().catch(function () {});
        return container;
      }

      function applyActive() {
        var active = document.documentElement.hasAttribute(ACTIVE_ATTR);
        if (container) container.style.display = active ? 'block' : 'none';
        if (active) {
          var style = document.getElementById('dsh-tavern-manager-style');
          if (!style) {
            var el = document.createElement('style');
            el.id = 'dsh-tavern-manager-style';
            el.textContent = '[' + ACTIVE_ATTR + '] [data-pane="conversation"] > :not(' + PANEL_SELECTOR + ') { display:none !important; }';
            document.head.appendChild(el);
          }
        } else {
          var old = document.getElementById('dsh-tavern-manager-style');
          if (old) old.remove();
        }
      }

      var tryPlace = function () {
        if (root && !root.isConnected) { root = undefined; placed = false; }
        if (placed) { if (document.body.contains(entry)) return; placed = false; }
        root = root || sidebarRoot();
        if (!root) {
          if (entry.parentElement !== document.body) {
            entry.style.position = 'fixed';
            entry.style.bottom = '20px';
            entry.style.right = '20px';
            entry.style.zIndex = '99999';
            entry.style.width = 'auto';
            document.body.appendChild(entry);
            placed = true;
          }
          return;
        }
        placed = placeEntry(root, entry);
      };

      var sync = function () {
        container = ensurePanel();
        applyActive();
      };

      entry = createEntry();
      entry.addEventListener('click', function () {
        var active = document.documentElement.hasAttribute(ACTIVE_ATTR);
        if (active) document.documentElement.removeAttribute(ACTIVE_ATTR);
        else document.documentElement.setAttribute(ACTIVE_ATTR, '');
        sync();
      });

      // 点侧边栏其他工作区/导航时，自动退出酒馆管理面板
      document.addEventListener('click', function (e) {
        if (!document.documentElement.hasAttribute(ACTIVE_ATTR)) return;
        var onEntry = e.target.closest(ENTRY_SELECTOR + ', ' + PANEL_SELECTOR);
        if (onEntry) return;
        var sidebar = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
        if (sidebar && sidebar.contains(e.target)) {
          document.documentElement.removeAttribute(ACTIVE_ATTR);
          applyActive();
        }
      }, true);

      var observer = new MutationObserver(function () { tryPlace(); sync(); });
      observer.observe(document.body, { childList: true, subtree: true });

      tryPlace();
      sync();

      disposers.push(function () {
        observer.disconnect();
        if (entry) entry.remove();
        var old = document.getElementById('dsh-tavern-manager-style');
        if (old) old.remove();
        document.documentElement.removeAttribute(ACTIVE_ATTR);
        var panel = document.querySelector(PANEL_SELECTOR);
        if (panel) panel.remove();
      });

      window.__dshTavernManagerInstance = {
        dispose: function () {
          for (var i = 0; i < disposers.length; i++) disposers[i]();
          window.__dshTavernManagerInstance = null;
        }
      };

      if (typeof ctx !== 'undefined' && ctx && typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return function () {
            if (window.__dshTavernManagerInstance) window.__dshTavernManagerInstance.dispose();
          };
        }, 'dsh-tavern: manager mounts');
      }
    }

    exports.inject = [];
    exports.apply = apply;
    return module.exports;
  }
});
