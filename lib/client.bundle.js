window.__ModuleLoader__.load({
  id: "dsh-tavern",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var TAVERN_URL = 'http://127.0.0.1:8080/DeepSeek%E9%85%92%E9%A6%86.html';
    var PANEL_SELECTOR = '[data-dsh-tavern-view]';
    var ACTIVE_ATTR = 'data-dsh-tavern-active';

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
        var child = root.children[i];
        if (child.tagName === 'BUTTON') return child;
      }
      return undefined;
    }

    function createEntry() {
      var entry = document.createElement('button');
      entry.type = 'button';
      entry.dataset.dshTavernEntry = '';
      var icon = document.createElement('span');
      icon.textContent = '🍺';
      icon.style.cssText = 'flex:0 0 auto;display:inline-block;line-height:1;font-size:15px;';
      var label = document.createElement('span');
      label.textContent = '酒馆管理';
      label.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;line-height:1.4;';
      entry.appendChild(icon);
      entry.appendChild(label);
      entry.style.cssText = 'display:inline-flex;align-items:center;justify-content:flex-start;gap:6px;width:100%;max-width:100%;padding:8px 12px;background:rgba(255,255,255,.06);border:none;color:#e8ecf4;cursor:pointer;font-size:13px;line-height:1.4;text-align:left;border-radius:8px;box-sizing:border-box;white-space:nowrap;overflow:hidden;min-width:0;';
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

    function ensurePanel() {
      var container = document.querySelector(PANEL_SELECTOR);
      if (container && container.isConnected) return container;
      var column = document.querySelector('[data-pane="conversation"], [class*="conversationColumn"]');
      if (!column) return undefined;
      container = document.createElement('div');
      container.dataset.dshTavernView = '';
      container.style.cssText = 'position:absolute;inset:0;background:#fff;z-index:999;display:none;';
      var frame = document.createElement('iframe');
      frame.src = TAVERN_URL;
      frame.style.cssText = 'width:100%;height:100%;border:none;';
      frame.addEventListener('load', function () { applyThemeToTavern(); });
      container.appendChild(frame);
      if (!column.style.position) column.style.position = 'relative';
      column.appendChild(container);
      return container;
    }

    function applyActive(container) {
      var active = document.documentElement.hasAttribute(ACTIVE_ATTR);
      if (container) container.style.display = active ? 'block' : 'none';
      if (active) {
        var style = document.getElementById('dsh-tavern-style');
        if (!style) {
          var el = document.createElement('style');
          el.id = 'dsh-tavern-style';
          el.textContent = '[' + ACTIVE_ATTR + '] [data-pane="conversation"] > :not(' + PANEL_SELECTOR + ') { display:none !important; }';
          document.head.appendChild(el);
        }
      } else {
        var old = document.getElementById('dsh-tavern-style');
        if (old) old.remove();
      }
    }

    function applyThemeToTavern() {
      var frame = document.querySelector(PANEL_SELECTOR + ' iframe');
      if (!frame || !frame.contentWindow) return;
      frame.contentWindow.postMessage({ type: 'dsh-theme', dark: document.body.hasAttribute('data-ds-dark-theme') }, '*');
    }

    function apply(ctx) {
      console.log('[dsh-tavern] plugin loaded');
      if (window.__dshTavernInstance && typeof window.__dshTavernInstance.dispose === 'function') {
          try { window.__dshTavernInstance.dispose(); } catch (e) {}
          window.__dshTavernInstance = null;
        }
      

        // 清理历史残留，防止旧版本重复实例叠加
        document.querySelectorAll('[data-dsh-tavern-view]').forEach(function (el) { el.remove(); });
        document.querySelectorAll('[data-dsh-tavern-entry]').forEach(function (el) { el.remove(); });
        document.querySelectorAll('[data-dsh-tavern-float]').forEach(function (el) { el.remove(); });
        var oldStyle = document.getElementById('dsh-tavern-style');
        if (oldStyle) oldStyle.remove();
        document.documentElement.removeAttribute(ACTIVE_ATTR);
      var entry, root, placed = false, container;
      var disposers = [];

      var tryPlace = function () {
        if (root && !root.isConnected) {
          root = undefined;
          placed = false;
        }
        if (placed) {
          if (document.body.contains(entry)) return;
          placed = false;
        }
        root = root || sidebarRoot();
        if (!root) {
          // 侧边栏未找到时不把入口按钮固定到右下角：悬浮按钮(floatEntry)
          // 已经常驻右下角，两个按钮叠在同一位置会导致文字重叠。
          return;
        }
        placed = placeEntry(root, entry);
      };

      var sync = function () {
        container = ensurePanel();
        applyActive(container);
      };

      entry = createEntry();
      entry.addEventListener('click', function () {
        // 「酒馆」已关联到「酒馆管理」面板：打开的就是用户保存卡片的那个管理面板。
        var mgr = window.__dshTavernManagerInstance;
        if (mgr && typeof mgr.toggle === 'function') { mgr.toggle(); return; }
        // 管理模块尚未挂载时，退回到原生入口按钮（右下角胶囊）触发，避免无响应。
        var cap = document.querySelector('[data-dsh-tavern-manager-entry]');
        if (cap) { cap.click(); return; }
        var active = document.documentElement.hasAttribute(ACTIVE_ATTR);
        if (active) document.documentElement.removeAttribute(ACTIVE_ATTR);
        else document.documentElement.setAttribute(ACTIVE_ATTR, '');
        sync();
      });

      // 点击侧边栏其他工作区/导航时自动关闭酒馆
      document.addEventListener('click', function (e) {
        if (!document.documentElement.hasAttribute(ACTIVE_ATTR)) return;
        var onEntry = e.target.closest('[data-dsh-tavern-entry], [data-dsh-tavern-float], [data-dsh-tavern-view]');
        if (onEntry) return;
        var sidebar = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
        if (sidebar && sidebar.contains(e.target)) {
          document.documentElement.removeAttribute(ACTIVE_ATTR);
          sync();
        }
      }, true);

      // 深浅色同步到酒馆 iframe
      var themeObserver = new MutationObserver(function () { applyThemeToTavern(); });
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
      applyThemeToTavern();

      // 兜底悬浮按钮：仅当侧边栏入口无法插入时才显示，且复用「酒馆管理」toggle（不再开 iframe）。
      // 侧边栏入口一旦插入成功，就把悬浮按钮移除，避免右下角出现重复的「酒馆管理」。
      var floatEntry = createEntry();
      floatEntry.dataset.dshTavernFloat = '';
      floatEntry.style.position = 'fixed';
      floatEntry.style.bottom = '20px';
      floatEntry.style.right = '20px';
      floatEntry.style.zIndex = '99999';
      floatEntry.style.width = 'auto';
      floatEntry.style.boxShadow = '0 2px 12px rgba(0,0,0,0.2)';
      floatEntry.style.background = '#4d6bfe';
      floatEntry.style.color = '#fff';
      floatEntry.style.borderRadius = '999px';
      floatEntry.style.padding = '8px 16px';
      floatEntry.addEventListener('click', function () {
        var mgr = window.__dshTavernManagerInstance;
        if (mgr && typeof mgr.toggle === 'function') { mgr.toggle(); return; }
        var cap = document.querySelector('[data-dsh-tavern-manager-entry]');
        if (cap) { cap.click(); return; }
        var active = document.documentElement.hasAttribute(ACTIVE_ATTR);
        if (active) document.documentElement.removeAttribute(ACTIVE_ATTR);
        else document.documentElement.setAttribute(ACTIVE_ATTR, '');
        sync();
      });
      document.body.appendChild(floatEntry);
      var syncFloat = function () {
        if (!document.body.contains(floatEntry)) return;
        if (entry && entry.isConnected && entry.parentElement) { floatEntry.parentNode && floatEntry.parentNode.removeChild(floatEntry); }
      };

      var observer = new MutationObserver(function () { tryPlace(); sync(); syncFloat(); });
      observer.observe(document.body, { childList: true, subtree: true });

      tryPlace();
      sync();
      setTimeout(syncFloat, 300);

      disposers.push(function () {
        observer.disconnect();
        if (typeof themeObserver !== 'undefined') themeObserver.disconnect();
        if (entry) entry.remove();
          if (typeof floatEntry !== 'undefined') floatEntry.remove();
        var old = document.getElementById('dsh-tavern-style');
        if (old) old.remove();
        document.documentElement.removeAttribute(ACTIVE_ATTR);
        var panel = document.querySelector(PANEL_SELECTOR);
        if (panel) panel.remove();
          window.__dshTavernInstalled = false;
      });

        window.__dshTavernInstance = {
          dispose: function () {
            for (var i = 0; i < disposers.length; i++) disposers[i]();
            window.__dshTavernInstance = null;
          }
        };

      if (typeof ctx !== 'undefined' && ctx && typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return function () {
            for (var i = 0; i < disposers.length; i++) disposers[i]();
          };
        }, 'dsh-tavern: ui mounts');
      }
    }

    exports.inject = [];
    exports.apply = apply;
    return module.exports;
  }
});
