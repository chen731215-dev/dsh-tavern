// dsh-tavern browser half: injects a sidebar entry and embeds DeepSeek 酒馆
// into the Harness web UI as an iframe panel. Plain DOM, no React build needed.
export const inject = ['runtime']

const TAVERN_URL = 'http://127.0.0.1:8080/DeepSeek%E9%85%92%E9%A6%86.html'
const ENTRY_SELECTOR = '[data-dsh-tavern-entry]'
const PANEL_SELECTOR = '[data-dsh-tavern-view]'
const ACTIVE_ATTR = 'data-dsh-tavern-active'

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

export function apply(ctx) {
  console.log('[dsh-tavern] plugin loaded')
  let entry, root, placed = false, container
  const disposers = []

  const tryPlace = () => {
    if (root && !root.isConnected) {
      root = undefined
      placed = false
    }
    if (placed) {
      if (document.body.contains(entry)) return
      placed = false
    }
    root = root || sidebarRoot()
    if (!root) {
      // 侧边栏未找到时不把入口按钮固定到右下角：悬浮按钮(floatEntry)
      // 已经常驻右下角，两个按钮叠在同一位置会导致文字重叠。
      return
    }
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

  const observer = new MutationObserver(() => { tryPlace(); sync() })
  observer.observe(document.body, { childList: true, subtree: true })

  tryPlace()
  sync()

  disposers.push(() => {
    observer.disconnect()
    entry?.remove()
    document.getElementById('dsh-tavern-style')?.remove()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    document.querySelector(PANEL_SELECTOR)?.remove()
  })

  if (typeof ctx !== 'undefined' && ctx && typeof ctx.effect === 'function') {
    ctx.effect(() => () => { for (const dispose of disposers) dispose() }, 'dsh-tavern: ui mounts')
  }
}
