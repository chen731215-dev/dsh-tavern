// dsh-tavern browser half (v2):
// - 侧边栏酒馆入口 + iframe 面板（保留）
// - 对话区顶部预设选择条：显示当前会话绑定的预设，点击切换，自动绑定
export const inject = ['runtime']

const TAVERN_URL = 'http://127.0.0.1:8080/DeepSeek%E9%85%92%E9%A6%86.html'
const ENTRY_SELECTOR = '[data-dsh-tavern-entry]'
const PANEL_SELECTOR = '[data-dsh-tavern-view]'
const ACTIVE_ATTR = 'data-dsh-tavern-active'
const PRESET_BAR_ID = 'dsh-tavern-preset-bar'
const PRESET_PANEL_ID = 'dsh-tavern-preset-panel'

// ── 自定义对话框（Electron 禁用了原生 prompt/confirm） ──
function showDialog({ title, message, defaultValue = '', type = 'prompt' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;'
    const box = document.createElement('div')
    box.style.cssText = 'background:#1e1e2e;color:#eee;border-radius:12px;padding:24px;min-width:320px;max-width:90vw;box-shadow:0 12px 40px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);'
    const titleEl = document.createElement('div')
    titleEl.style.cssText = 'font-size:16px;font-weight:600;margin-bottom:12px;color:#fff;'
    titleEl.textContent = title
    box.appendChild(titleEl)
    if (message) {
      const msgEl = document.createElement('div')
      msgEl.style.cssText = 'font-size:13px;color:#aaa;margin-bottom:16px;line-height:1.5;'
      msgEl.textContent = message
      box.appendChild(msgEl)
    }
    let input = null
    if (type === 'prompt') {
      input = document.createElement('input')
      input.type = 'text'
      input.value = defaultValue
      input.style.cssText = 'width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:#16162a;color:#fff;font-size:14px;box-sizing:border-box;margin-bottom:16px;'
      box.appendChild(input)
    }
    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;'
    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = '取消'
    cancelBtn.style.cssText = 'padding:8px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#ccc;font-size:13px;cursor:pointer;'
    const okBtn = document.createElement('button')
    okBtn.textContent = type === 'confirm' ? '确定' : '创建'
    okBtn.style.cssText = 'padding:8px 18px;border-radius:8px;border:none;background:#e94560;color:#fff;font-size:13px;cursor:pointer;font-weight:600;'
    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(okBtn)
    box.appendChild(btnRow)
    overlay.appendChild(box)
    document.body.appendChild(overlay)
    if (input) { setTimeout(() => input.focus(), 50) }
    const cleanup = () => overlay.remove()
    cancelBtn.addEventListener('click', () => { cleanup(); resolve(type === 'confirm' ? false : null) })
    okBtn.addEventListener('click', () => { cleanup(); resolve(type === 'confirm' ? true : (input ? input.value : '')) })
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') okBtn.click()
        if (e.key === 'Escape') cancelBtn.click()
      })
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cancelBtn.click() })
  })
}
async function showPrompt(title, defaultValue = '') {
  return showDialog({ title, defaultValue, type: 'prompt' })
}
async function showConfirm(message) {
  return showDialog({ title: '确认操作', message, type: 'confirm' })
}

// ── 原有侧边栏入口 ──────────────────────────────────────
function sidebarRoot() {
  const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (!column) return undefined
  const logoOwner = column.querySelector('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild || undefined)
}

function newSessionButton(root) {
  const nested = root.querySelector('button[class*="newSession"]')
  if (nested) return nested
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child
  }
  return undefined
}

function createEntry() {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.dataset.dshTavernEntry = ''
  const icon = document.createElement('span')
  icon.textContent = '🍺'
  icon.style.cssText = 'flex:0 0 auto;display:inline-block;line-height:1;font-size:15px;'
  const label = document.createElement('span')
  label.textContent = '酒馆'
  label.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;line-height:1.4;'
  entry.appendChild(icon)
  entry.appendChild(label)
  entry.style.cssText = 'display:inline-flex;align-items:center;justify-content:flex-start;gap:6px;width:100%;max-width:100%;padding:8px 12px;background:transparent;border:none;color:inherit;cursor:pointer;font-size:13px;line-height:1.4;text-align:left;border-radius:8px;box-sizing:border-box;white-space:nowrap;overflow:hidden;min-width:0;'
  return entry
}

function placeEntry(root, entry) {
  const button = newSessionButton(root)
  if (!button) {
    if (entry.parentElement !== root) root.appendChild(entry)
    return true
  }
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]')
    const base = row && row.parentElement === root ? row : button
    root.insertBefore(entry, base.nextElementSibling)
  }
  return true
}

function ensurePanel() {
  let container = document.querySelector(PANEL_SELECTOR)
  if (container && container.isConnected) return container
  const column = document.querySelector('[data-pane="conversation"], [class*="conversationColumn"]')
  if (!column) return undefined
  container = document.createElement('div')
  container.dataset.dshTavernView = ''
  container.style.cssText = 'position:absolute;inset:0;background:#fff;z-index:999;display:none;'
  const frame = document.createElement('iframe')
  frame.src = TAVERN_URL
  frame.style.cssText = 'width:100%;height:100%;border:none;'
  container.appendChild(frame)
  column.style.position = column.style.position || 'relative'
  column.appendChild(container)
  return container
}

function applyActive(container) {
  const active = document.documentElement.hasAttribute(ACTIVE_ATTR)
  if (container) container.style.display = active ? 'block' : 'none'
  if (active) {
    const style = document.getElementById('dsh-tavern-style')
    if (!style) {
      const el = document.createElement('style')
      el.id = 'dsh-tavern-style'
      el.textContent = `[${ACTIVE_ATTR}] [data-pane="conversation"] > :not(${PANEL_SELECTOR}) { display:none !important; }`
      document.head.appendChild(el)
    }
  } else {
    document.getElementById('dsh-tavern-style')?.remove()
  }
}

// ── 新增：预设选择条 ────────────────────────────────────
let currentSessionId = ''
let currentPresetId = ''
let currentPresetName = ''
let presetList = []
let pollTimer = null

function conversationColumn() {
  return document.querySelector('[data-pane="conversation"], [class*="conversationColumn"]')
}

function ensurePresetBar() {
  let bar = document.getElementById(PRESET_BAR_ID)
  if (bar && bar.isConnected) return bar
  bar = document.createElement('div')
  bar.id = PRESET_BAR_ID
  bar.innerHTML = `
    <span class="dsh-pb-icon">🎭</span>
    <span class="dsh-pb-name">预设</span>
    <span class="dsh-pb-arrow">▾</span>
  `
  bar.style.cssText = `
    position:fixed;top:10px;right:140px;z-index:2147483647;
    display:flex;align-items:center;gap:5px;
    padding:5px 12px;font-size:12px;font-weight:500;
    background:rgba(30,30,46,0.92);backdrop-filter:blur(8px);
    border:1px solid rgba(233,69,96,0.4);border-radius:16px;
    cursor:pointer;user-select:none;color:#eee;
    box-shadow:0 2px 12px rgba(0,0,0,0.4);
    transition:all 0.2s;
  `
  bar.addEventListener('mouseenter', () => { bar.style.borderColor = 'rgba(233,69,96,0.8)'; bar.style.background = 'rgba(40,40,60,0.95)'; })
  bar.addEventListener('mouseleave', () => { bar.style.borderColor = 'rgba(233,69,96,0.4)'; bar.style.background = 'rgba(30,30,46,0.92)'; })
  bar.addEventListener('click', (e) => {
    e.stopPropagation()
    togglePresetPanel(bar)
  })
  document.body.appendChild(bar)
  return bar
}

function togglePresetPanel(bar) {
  let panel = document.getElementById(PRESET_PANEL_ID)
  if (panel && panel.isConnected) {
    panel.remove()
    return
  }
  if (!presetList.length) {
    refreshPresets().then(() => showPresetPanel(bar))
  } else {
    showPresetPanel(bar)
  }
}

function showPresetPanel(bar) {
  document.getElementById(PRESET_PANEL_ID)?.remove()
  const panel = document.createElement('div')
  panel.id = PRESET_PANEL_ID
  const rect = bar.getBoundingClientRect()
  panel.style.cssText = `
    position:fixed;top:${rect.bottom + 4}px;right:${window.innerWidth - rect.right}px;
    min-width:240px;max-width:360px;max-height:60vh;overflow-y:auto;
    background:#1e1e2e;border:1px solid rgba(233,69,96,0.3);border-radius:10px;
    box-shadow:0 8px 32px rgba(0,0,0,0.5);z-index:2147483647;
    padding:8px;color:#eee;
  `
  // 预设列表
  const header = document.createElement('div')
  header.style.cssText = 'padding:6px 8px;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;'
  header.textContent = '选择预设（绑定到当前会话）'
  panel.appendChild(header)

  for (const p of presetList) {
    const item = document.createElement('div')
    const isActive = p.id === currentPresetId
    item.style.cssText = `
      display:flex;align-items:center;gap:8px;padding:8px 10px;
      border-radius:6px;cursor:pointer;font-size:13px;
      ${isActive ? 'background:rgba(59,127,240,0.1);color:#3b7ff0;font-weight:600;' : ''}
    `
    item.innerHTML = `
      <span>${isActive ? '✓' : '&nbsp;'}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.name)}</span>
      <span style="font-size:11px;color:#999;">${p.cardChars || 0}字</span>
    `
    item.addEventListener('click', (e) => {
      e.stopPropagation()
      bindPreset(p.id, p.name)
      panel.remove()
    })
    item.addEventListener('mouseenter', () => { if (!isActive) item.style.background = 'rgba(255,255,255,0.08)' })
    item.addEventListener('mouseleave', () => { if (!isActive) item.style.background = '' })
    panel.appendChild(item)
  }

  // 新建预设
  const newBtn = document.createElement('div')
  newBtn.style.cssText = 'margin-top:6px;padding:8px 10px;border-top:1px solid rgba(255,255,255,0.1);font-size:12px;color:#7ab8ff;cursor:pointer;border-radius:6px;'
  newBtn.textContent = '＋ 新建预设（复制当前）'
  newBtn.addEventListener('click', async (e) => {
    e.stopPropagation()
    const name = await showPrompt('新预设名称：', '新预设')
    if (name && name.trim()) {
      createPreset(name.trim(), currentPresetId).then(() => {
        panel.remove()
        refreshPresets()
      })
    }
  })
  panel.appendChild(newBtn)

  // 模式切换
  const currentPreset = presetList.find(x => x.id === currentPresetId)
  const currentMode = currentPreset?.mode || 'roleplay'
  const modeRow = document.createElement('div')
  modeRow.style.cssText = 'display:flex;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);'
  const rpBtn = document.createElement('span')
  rpBtn.textContent = '🎭 角色扮演'
  rpBtn.style.cssText = `flex:1;text-align:center;padding:6px;font-size:12px;cursor:pointer;border-radius:4px;${currentMode === 'roleplay' ? 'background:rgba(122,184,255,0.2);color:#7ab8ff;font-weight:600;' : 'color:#888;'}`
  const crBtn = document.createElement('span')
  crBtn.textContent = '✍️ 小说创作'
  crBtn.style.cssText = `flex:1;text-align:center;padding:6px;font-size:12px;cursor:pointer;border-radius:4px;${currentMode === 'creative' ? 'background:rgba(122,184,255,0.2);color:#7ab8ff;font-weight:600;' : 'color:#888;'}`
  rpBtn.addEventListener('click', (e) => { e.stopPropagation(); setPresetMode(currentPresetId, 'roleplay').then(() => { panel.remove(); refreshPresets(); }) })
  crBtn.addEventListener('click', (e) => { e.stopPropagation(); setPresetMode(currentPresetId, 'creative').then(() => { panel.remove(); refreshPresets(); }) })
  modeRow.appendChild(rpBtn); modeRow.appendChild(crBtn)
  panel.appendChild(modeRow)

  // 重命名/删除（非默认预设）
  if (currentPresetId !== 'default') {
    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;gap:8px;margin-top:4px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);'
    const renameBtn = document.createElement('span')
    renameBtn.style.cssText = 'flex:1;text-align:center;padding:6px;font-size:12px;color:#aaa;cursor:pointer;border-radius:4px;'
    renameBtn.textContent = '✏️ 重命名'
    renameBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const p = presetList.find(x => x.id === currentPresetId)
      const name = await showPrompt('重命名预设：', p?.name || '')
      if (name && name.trim()) {
        renamePreset(currentPresetId, name.trim()).then(() => {
          panel.remove()
          refreshPresets()
        })
      }
    })
    const delBtn = document.createElement('span')
    delBtn.style.cssText = 'flex:1;text-align:center;padding:6px;font-size:12px;color:#e74c3c;cursor:pointer;border-radius:4px;'
    delBtn.textContent = '🗑️ 删除'
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (await showConfirm('确定删除当前预设？该会话将回退到默认预设。')) {
        deletePreset(currentPresetId).then(() => {
          panel.remove()
          refreshPresets()
          refreshCurrent()
        })
      }
    })
    actions.appendChild(renameBtn)
    actions.appendChild(delBtn)
    panel.appendChild(actions)
  }

  document.body.appendChild(panel)
  // 点击外部关闭
  const closeHandler = (e) => {
    if (!panel.contains(e.target) && e.target !== bar) {
      panel.remove()
      document.removeEventListener('click', closeHandler)
    }
  }
  setTimeout(() => document.addEventListener('click', closeHandler), 0)
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ── API 调用 ────────────────────────────────────────────
async function refreshPresets() {
  try {
    const r = await fetch('/api/tavern/presets')
    const data = await r.json()
    if (data.ok) {
      presetList = data.presets || []
    }
  } catch {}
}

async function refreshCurrent() {
  try {
    const r = await fetch('/api/tavern/read')
    const data = await r.json()
    if (data.ok) {
      currentSessionId = data.currentSessionId || ''
      currentPresetId = data.presetId || 'default'
      currentPresetName = data.presetName || '默认预设'
      updatePresetBar()
    }
  } catch {}
}

async function bindPreset(presetId, presetName) {
  try {
    const r = await fetch('/api/tavern/bind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ presetId })
    })
    const data = await r.json()
    if (data.ok) {
      currentPresetId = data.presetId
      currentPresetName = data.presetName
      updatePresetBar()
    }
  } catch {}
}

async function createPreset(name, copyFrom) {
  try {
    const r = await fetch('/api/tavern/presets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, copyFrom })
    })
    return await r.json()
  } catch { return { ok: false } }
}

async function renamePreset(id, name) {
  try {
    const r = await fetch('/api/tavern/preset/rename', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, name })
    })
    return await r.json()
  } catch { return { ok: false } }
}

async function setPresetMode(id, mode) {
  try {
    const r = await fetch('/api/tavern/preset/mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, mode })
    })
    return await r.json()
  } catch { return { ok: false } }
}

async function deletePreset(id) {
  try {
    const r = await fetch('/api/tavern/preset/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id })
    })
    return await r.json()
  } catch { return { ok: false } }
}

function updatePresetBar() {
  const bar = document.getElementById(PRESET_BAR_ID)
  if (!bar) return
  const nameEl = bar.querySelector('.dsh-pb-name')
  const iconEl = bar.querySelector('.dsh-pb-icon')
  const currentPreset = presetList.find(x => x.id === currentPresetId)
  const mode = currentPreset?.mode || 'roleplay'
  if (iconEl) iconEl.textContent = mode === 'creative' ? '✍️' : '🎭'
  if (nameEl) {
    nameEl.textContent = currentPresetName || '默认预设'
    nameEl.style.cssText = 'font-weight:600;color:#7ab8ff;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
  }
  bar.title = `当前预设：${currentPresetName || '默认预设'}（${mode === 'creative' ? '小说创作模式' : '角色扮演模式'}，点击切换）`
}

// ── 主入口 ──────────────────────────────────────────────
export function apply(ctx) {
  console.log('[dsh-tavern v2] plugin loaded (multi-preset + session binding)')
  let entry, root, placed = false, container
  const disposers = []

  const tryPlace = () => {
    if (root && !root.isConnected) { root = undefined; placed = false }
    if (placed) { if (document.body.contains(entry)) return; placed = false }
    root = root || sidebarRoot()
    if (!root) return
    placed = placeEntry(root, entry)
  }

  const sync = () => {
    container = ensurePanel()
    applyActive(container)
  }

  entry = createEntry()
  entry.addEventListener('click', () => {
    const active = document.documentElement.hasAttribute(ACTIVE_ATTR)
    if (active) document.documentElement.removeAttribute(ACTIVE_ATTR)
    else document.documentElement.setAttribute(ACTIVE_ATTR, '')
    sync()
  })

  // 预设选择条
  const initPresetBar = () => {
    const bar = ensurePresetBar()
    if (bar) {
      refreshPresets()
      refreshCurrent()
    }
  }

  const observer = new MutationObserver(() => {
    tryPlace()
    sync()
    initPresetBar()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  tryPlace()
  sync()
  initPresetBar()

  // 轮询当前会话（检测会话切换）
  let lastSession = ''
  pollTimer = setInterval(async () => {
    try {
      const r = await fetch('/api/tavern/read')
      const data = await r.json()
      if (data.ok && data.currentSessionId && data.currentSessionId !== lastSession) {
        lastSession = data.currentSessionId
        currentSessionId = data.currentSessionId
        currentPresetId = data.presetId || 'default'
        currentPresetName = data.presetName || '默认预设'
        updatePresetBar()
      }
    } catch {}
  }, 2000)

  disposers.push(() => {
    observer.disconnect()
    entry?.remove()
    document.getElementById('dsh-tavern-style')?.remove()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    document.querySelector(PANEL_SELECTOR)?.remove()
    document.getElementById(PRESET_BAR_ID)?.remove()
    document.getElementById(PRESET_PANEL_ID)?.remove()
    if (pollTimer) clearInterval(pollTimer)
  })

  if (typeof ctx !== 'undefined' && ctx && typeof ctx.effect === 'function') {
    ctx.effect(() => () => { for (const dispose of disposers) dispose() }, 'dsh-tavern: ui mounts')
  }
}
