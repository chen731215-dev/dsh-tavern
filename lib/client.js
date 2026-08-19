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
    item.dataset.presetId = p.id
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

  // 批量删除
  const batchBtn = document.createElement('div')
  batchBtn.style.cssText = 'margin-top:4px;padding:8px 10px;font-size:12px;color:#e74c3c;cursor:pointer;border-radius:6px;'
  batchBtn.textContent = '🗑️ 批量删除预设'
  batchBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    // 切换到批量选择模式
    if (panel.querySelector('.batch-mode')) {
      // 已经是批量模式，取消
      panel.querySelectorAll('.batch-item').forEach(el => el.remove())
      panel.querySelector('.batch-actions')?.remove()
      batchBtn.textContent = '🗑️ 批量删除预设'
      return
    }
    batchBtn.textContent = '❌ 取消批量删除'
    // 给每个预设项加复选框
    const items = panel.querySelectorAll('[data-preset-id]')
    items.forEach(item => {
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.className = 'batch-check'
      cb.style.cssText = 'margin-right:4px;cursor:pointer'
      cb.dataset.presetId = item.dataset.presetId
      item.insertBefore(cb, item.firstChild)
      item.classList.add('batch-item')
      // 阻止点击切换预设
      item.onclick = (ev) => { ev.stopPropagation(); cb.checked = !cb.checked }
    })
    // 全选按钮
    const selectAllDiv = document.createElement('div')
    selectAllDiv.className = 'batch-item'
    selectAllDiv.style.cssText = 'padding:6px 10px;font-size:12px;color:#7ab8ff;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.1)'
    selectAllDiv.innerHTML = '<label style="cursor:pointer"><input type="checkbox" id="batch-select-all" style="cursor:pointer;margin-right:4px"> 全选 / 取消全选</label>'
    panel.insertBefore(selectAllDiv, items[0])
    selectAllDiv.querySelector('#batch-select-all').addEventListener('change', (ev) => {
      panel.querySelectorAll('.batch-check').forEach(cb => { cb.checked = ev.target.checked })
    })
    // 批量删除操作按钮
    const actions = document.createElement('div')
    actions.className = 'batch-actions'
    actions.style.cssText = 'display:flex;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.1);'
    const delBtn = document.createElement('span')
    delBtn.style.cssText = 'flex:1;text-align:center;padding:6px;font-size:12px;background:#e74c3c;color:#fff;cursor:pointer;border-radius:4px;font-weight:600;'
    delBtn.textContent = '🗑️ 删除选中'
    delBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation()
      const checked = panel.querySelectorAll('.batch-check:checked')
      if (checked.length === 0) { alert('请先选择要删除的预设'); return }
      if (!confirm(`确定删除选中的 ${checked.length} 个预设？删除后无法恢复！`)) return
      for (const cb of checked) {
        await deletePreset(cb.dataset.presetId).catch(() => {})
      }
      panel.remove()
      refreshPresets()
    })
    actions.appendChild(delBtn)
    panel.appendChild(actions)
  })
  panel.appendChild(batchBtn)

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

// ── 剧情美化 + 交互选项 ─────────────────────────────────
const TAVERN_BEAUTIFY_ATTR = 'data-dsh-tavern-beautified'

function injectBeautifyStyles() {
  if (document.getElementById('dsh-tavern-beautify-style')) return
  const style = document.createElement('style')
  style.id = 'dsh-tavern-beautify-style'
  style.textContent = `
    .tavern-world-card {
      background: linear-gradient(135deg, rgba(122,184,255,0.08), rgba(157,124,255,0.08));
      border: 1px solid rgba(122,184,255,0.2);
      border-radius: 10px;
      padding: 10px 14px;
      margin: 8px 0;
      font-size: 13px;
      color: var(--dsw-alias-label-secondary, #aaa);
    }
    .tavern-world-card .tw-row { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
    .tavern-world-card .tw-label { color: var(--dsw-alias-brand-primary, #7ab8ff); font-weight: 600; min-width: 50px; }
    .tavern-status-card {
      background: rgba(233,69,96,0.06);
      border: 1px solid rgba(233,69,96,0.2);
      border-radius: 10px;
      padding: 10px 14px;
      margin: 8px 0;
      font-size: 13px;
    }
    .tavern-status-card .ts-char { margin: 6px 0; padding: 6px 0; border-bottom: 1px dashed rgba(255,255,255,0.08); }
    .tavern-status-card .ts-char:last-child { border-bottom: none; }
    .tavern-status-card .ts-name { font-weight: 700; color: #e94560; font-size: 14px; }
    .tavern-status-card .ts-field { color: var(--dsw-alias-label-secondary, #bbb); margin: 2px 0; padding-left: 8px; }
    .tavern-status-card .ts-field b { color: var(--dsw-alias-label-primary, #eee); font-weight: 500; }
    .tavern-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 12px 0;
    }
    .tavern-option-btn {
      background: var(--dsw-alias-bg-layer-2, #2a2a3e);
      border: 1px solid var(--dsw-alias-border-l2, #444);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      color: var(--dsw-alias-label-primary, #eee);
      cursor: pointer;
      text-align: left;
      transition: all 0.15s;
      font-family: inherit;
    }
    .tavern-option-btn:hover {
      background: var(--dsw-alias-interactive-bg-hover, #3a3a5e);
      border-color: var(--dsw-alias-brand-primary, #7ab8ff);
      transform: translateX(2px);
    }
    .tavern-option-btn .opt-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--dsw-alias-brand-primary, #7ab8ff);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      margin-right: 8px;
    }
    .tavern-custom-input {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }
    .tavern-custom-input input {
      flex: 1;
      background: var(--dsw-alias-bg-layer-1, #1e1e2e);
      border: 1px solid var(--dsw-alias-border-l2, #444);
      border-radius: 8px;
      padding: 8px 12px;
      color: var(--dsw-alias-label-primary, #eee);
      font-size: 13px;
      font-family: inherit;
      outline: none;
    }
    .tavern-custom-input input:focus { border-color: var(--dsw-alias-brand-primary, #7ab8ff); }
    .tavern-custom-input button {
      background: var(--dsw-alias-brand-primary, #7ab8ff);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
    }
    .tavern-custom-input button:hover { opacity: 0.9; }
  `
  document.head.appendChild(style)
}

function parseWorldBlock(text) {
  // 匹配 <世界>...</世界> 或 <world>...</world>
  const m = text.match(/<(?:世界|world)>([\s\S]*?)<\/(?:世界|world)>/i)
  if (!m) return null
  const content = m[1]
  const time = content.match(/<(?:时间|time)>([\s\S]*?)<\/(?:时间|time)>/i)?.[1]?.trim()
  const location = content.match(/<(?:地点|location|place)>([\s\S]*?)<\/(?:地点|location|place)>/i)?.[1]?.trim()
  const weather = content.match(/<(?:天气|weather)>([\s\S]*?)<\/(?:天气|weather)>/i)?.[1]?.trim()
  return { time, location, weather, raw: m[0] }
}

function parseStatusBlock(text) {
  const m = text.match(/<(?:Status_block|status)>([\s\S]*?)<\/(?:Status_block|status)>/i)
  if (!m) return null
  const content = m[1]
  const chars = []
  // 匹配每个角色：名字: "..." 身份: "..." ...
  const charPattern = /名字:\s*"([^"]*)"\s*身份:\s*"([^"]*)"\s*状态:\s*"([^"]*)"\s*穿搭:\s*"([^"]*)"\s*动作:\s*"([^"]*)"/g
  let match
  while ((match = charPattern.exec(content)) !== null) {
    chars.push({
      name: match[1],
      identity: match[2],
      status: match[3],
      outfit: match[4],
      action: match[5]
    })
  }
  return { chars, raw: m[0] }
}

function parseOptions(text) {
  // 匹配各种选项提示后面的数字选项
  const lines = text.split('\n')
  const optionLines = []
  let inOptions = false
  for (const line of lines) {
    if (/接下来.*怎么|你想怎么做|你想怎么继续|选择.*选项|请选择|.*选项[:：]?/.test(line) && !/^\s*\d+[\.、)]/.test(line)) {
      inOptions = true
      continue
    }
    if (inOptions && /^\s*\d+[\.、)]\s*\S/.test(line)) {
      optionLines.push(line.trim())
    } else if (inOptions && line.trim() === '') {
      // 空行，可能是选项结束
    } else if (inOptions && optionLines.length > 0) {
      break
    }
  }
  if (optionLines.length === 0) return null
  return optionLines.map(line => {
    const m = line.match(/^\s*\d+[\.、)]\s*(.*)/)
    return m ? m[1].trim() : line
  })
}

function sendMessage(text) {
  // 找到输入框并发送消息
  const input = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea') || document.querySelector('[class*="composer"] textarea')
  if (!input) return
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
  } else {
    input.textContent = text
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }
  // 触发发送（按 Enter）
  setTimeout(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  }, 50)
}

function beautifyMessage(el) {
  if (el.getAttribute(TAVERN_BEAUTIFY_ATTR)) return
  const text = el.textContent || ''
  if (!text.includes('<世界>') && !text.includes('Status_block') && !/接下来.*怎么/.test(text)) return

  let html = el.innerHTML
  let modified = false

  // 美化世界卡
  const world = parseWorldBlock(text)
  if (world) {
    const worldHtml = `<div class="tavern-world-card">
      ${world.time ? `<div class="tw-row"><span class="tw-label">🕐 时间</span><span>${escapeHtml(world.time)}</span></div>` : ''}
      ${world.location ? `<div class="tw-row"><span class="tw-label">📍 地点</span><span>${escapeHtml(world.location)}</span></div>` : ''}
      ${world.weather ? `<div class="tw-row"><span class="tw-label">🌤️ 天气</span><span>${escapeHtml(world.weather)}</span></div>` : ''}
    </div>`
    html = html.replace(world.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), worldHtml)
    modified = true
  }

  // 美化状态卡
  const status = parseStatusBlock(text)
  if (status && status.chars.length > 0) {
    let statusHtml = '<div class="tavern-status-card">'
    for (const c of status.chars) {
      statusHtml += `<div class="ts-char">
        <div class="ts-name">${escapeHtml(c.name)}</div>
        <div class="ts-field"><b>身份：</b>${escapeHtml(c.identity)}</div>
        <div class="ts-field"><b>状态：</b>${escapeHtml(c.status)}</div>
        <div class="ts-field"><b>穿搭：</b>${escapeHtml(c.outfit)}</div>
        <div class="ts-field"><b>动作：</b>${escapeHtml(c.action)}</div>
      </div>`
    }
    statusHtml += '</div>'
    html = html.replace(status.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), statusHtml)
    modified = true
  }

  // 美化选项
  const options = parseOptions(text)
  if (options && options.length > 0) {
    let optionsHtml = '<div class="tavern-options">'
    options.forEach((opt, i) => {
      optionsHtml += `<button class="tavern-option-btn" data-opt="${i}"><span class="opt-num">${i + 1}</span>${escapeHtml(opt)}</button>`
    })
    optionsHtml += `<div class="tavern-custom-input">
      <input type="text" placeholder="或者自己输入接下来的行动..." />
      <button class="tavern-send-custom">发送</button>
    </div></div>`
    // 找到选项部分并替换（从提示语开始到消息结束）
    const optionPattern = /(接下来.*怎么|你想怎么做|你想怎么继续|选择.*选项|请选择)[\s\S]*$/
    if (optionPattern.test(html)) {
      html = html.replace(optionPattern, optionsHtml)
      modified = true
    }
  }

  if (modified) {
    el.innerHTML = html
    el.setAttribute(TAVERN_BEAUTIFY_ATTR, 'true')
    // 绑定选项按钮点击事件
    el.querySelectorAll('.tavern-option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const optText = btn.textContent.replace(/^\d+/, '').trim()
        sendMessage(optText)
      })
    })
    // 绑定自定义输入发送
    const customInput = el.querySelector('.tavern-custom-input input')
    const customBtn = el.querySelector('.tavern-send-custom')
    if (customInput && customBtn) {
      customBtn.addEventListener('click', () => {
        if (customInput.value.trim()) sendMessage(customInput.value.trim())
      })
      customInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && customInput.value.trim()) {
          sendMessage(customInput.value.trim())
        }
      })
    }
  }
}

function beautifyAllMessages() {
  // 直接查找所有包含剧情标签的文本元素
  const all = document.querySelectorAll('div, p, span, article, section')
  const targets = []
  for (const el of all) {
    // 只处理直接包含文本的元素（子元素少）
    if (el.children.length > 3) continue
    const text = el.textContent || ''
    if (text.length < 50) continue
    if (text.includes('<世界>') || text.includes('Status_block') || /接下来你想怎么/.test(text)) {
      // 确保是最内层的包含元素
      const hasChildWithTag = Array.from(el.children).some(c => {
        const ct = c.textContent || ''
        return ct.includes('<世界>') || ct.includes('Status_block')
      })
      if (!hasChildWithTag) {
        targets.push(el)
      }
    }
  }
  targets.forEach(el => beautifyMessage(el))
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

  // 剧情美化 + 交互选项
  injectBeautifyStyles()
  let beautifyTimer = null
  const scheduleBeautify = () => {
    if (beautifyTimer) clearTimeout(beautifyTimer)
    beautifyTimer = setTimeout(() => beautifyAllMessages(), 500)
  }
  // 定时轮询确保美化（防止 MutationObserver 漏触发）
  const beautifyInterval = setInterval(() => beautifyAllMessages(), 2000)

  const observer = new MutationObserver(() => {
    tryPlace()
    sync()
    initPresetBar()
    scheduleBeautify()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  tryPlace()
  sync()
  initPresetBar()
  scheduleBeautify()

  // 定时轮询确保预设按钮存在（防止 SPA 路由切换后丢失）
  const ensureTimer = setInterval(() => {
    const bar = document.getElementById(PRESET_BAR_ID)
    if (!bar || !bar.isConnected) {
      initPresetBar()
    }
  }, 3000)

  // 轮询当前会话（检测会话切换）
  let lastSession = ''
  // 获取当前会话ID（从 DOM）
  const getSessionIdFromDOM = () => {
    try {
      const selectors = [
        '[data-session-id]', '.session-item.active', '[class*="active"][data-id]',
        '[class*="conversation-item"][class*="active"]', '[class*="chat-item"][class*="active"]',
        '[data-testid*="session"][class*="active"]', '.conversation-item.selected',
        '[class*="sidebar"] [class*="item"][class*="active"]'
      ]
      for (const sel of selectors) {
        const el = document.querySelector(sel)
        if (el) {
          const sid = el.getAttribute('data-session-id') || el.getAttribute('data-id') || el.id || ''
          if (sid) return sid
        }
      }
    } catch {}
    return ''
  }

  // 获取当前会话标题（从 DOM）
  const getSessionTitleFromDOM = () => {
    try {
      // 尝试从活动会话项获取标题
      const selectors = [
        '.session-item.active [class*="title"]', '.session-item.active [class*="name"]',
        '[class*="conversation-item"][class*="active"] [class*="title"]',
        '[class*="chat-item"][class*="active"] [class*="title"]',
        '[class*="sidebar"] [class*="item"][class*="active"] [class*="title"]',
        '[class*="sidebar"] [class*="item"][class*="active"] [class*="name"]'
      ]
      for (const sel of selectors) {
        const el = document.querySelector(sel)
        if (el && el.textContent.trim()) {
          return el.textContent.trim().slice(0, 20)
        }
      }
      // 尝试从页面标题获取
      const pageTitle = document.title || ''
      if (pageTitle && pageTitle !== 'DeepSeek Harness') {
        return pageTitle.slice(0, 20)
      }
    } catch {}
    return ''
  }

  pollTimer = setInterval(async () => {
    try {
      // 优先从 DOM 获取会话ID
      const domSid = getSessionIdFromDOM()
      if (domSid) {
        document.documentElement.setAttribute('data-dsh-current-session', domSid)
        currentSessionId = domSid
      }
      // 调用 API 时传入 sessionId，让后端更新 lastSessionId
      const url = domSid ? '/api/tavern/read?sessionId=' + encodeURIComponent(domSid) : '/api/tavern/read'
      const r = await fetch(url)
      const data = await r.json()
      if (data.ok && data.currentSessionId && data.currentSessionId !== lastSession) {
        lastSession = data.currentSessionId
        currentSessionId = data.currentSessionId
        currentPresetId = data.presetId || 'default'
        currentPresetName = data.presetName || '默认预设'
        updatePresetBar()
        // 自动重命名：如果预设名是"会话N"格式，用会话标题重命名
        if (/^会话\d+$/.test(currentPresetName)) {
          const title = getSessionTitleFromDOM()
          if (title && title !== currentPresetName) {
            renamePreset(currentPresetId, title).then(() => {
              currentPresetName = title
              updatePresetBar()
              refreshPresets()
            }).catch(() => {})
          }
        }
      }
    } catch {}
  }, 2000)

  disposers.push(() => {
    observer.disconnect()
    if (ensureTimer) clearInterval(ensureTimer)
    if (beautifyTimer) clearTimeout(beautifyTimer)
    if (beautifyInterval) clearInterval(beautifyInterval)
    entry?.remove()
    document.getElementById('dsh-tavern-style')?.remove()
    document.getElementById('dsh-tavern-beautify-style')?.remove()
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
