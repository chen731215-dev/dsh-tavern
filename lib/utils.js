// dsh-tavern 纯函数工具模块（无外部依赖，可单独测试）

const CARD_MAX = 40000

// ── 世界书关键词匹配 ───────────────────────────────────
export function matchWorldbookEntries(worldbook, recentText) {
  const hits = []
  const haystack = String(recentText || '').toLowerCase()
  const isFull = worldbook.injectMode === 'full'
  for (const entry of worldbook.entries) {
    if (entry.enabled === false) continue
    // full 模式：所有启用条目都注入
    if (isFull) { hits.push(entry); continue }
    // keyword 模式：无关键词不注入，有关键词匹配才注入
    if (!entry.keywords || !entry.keywords.length) continue
    const matched = entry.keywords.some(kw => kw && haystack.includes(String(kw).toLowerCase()))
    if (matched) hits.push(entry)
  }
  return hits
}

export function buildWorldbookText(entries) {
  if (!entries.length) return ''
  const parts = ['【世界书 — 关键词触发条目】']
  for (const e of entries) {
    parts.push(`\n## ${e.name || '未命名条目'}`)
    if (e.keywords && e.keywords.length) parts.push(`触发词：${e.keywords.join(', ')}`)
    parts.push(e.content || '')
  }
  return parts.join('\n')
}

// ── 角色卡文本提取 ─────────────────────────────────────
export function extractCardText(agentYml) {
  if (typeof agentYml !== 'string') return ''
  const lines = agentYml.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*text:\s*\|-/.test(lines[i])) { start = i + 1; break }
  }
  if (start < 0) return ''
  const out = []
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') { out.push(''); continue }
    if (/^\S/.test(line)) break
    const m = line.match(/^( {2,})/)
    out.push(m ? line.slice(m[1].length) : line)
  }
  let text = out.join('\n').trim()
  if (text.length > CARD_MAX) text = text.slice(0, CARD_MAX) + '\n\n（卡片过长，已截断至前 ' + CARD_MAX + ' 字）'
  return text
}

// ── 消息内容转文本 ─────────────────────────────────────
export function contentToText(content) {
  if (!content || !Array.isArray(content)) return ''
  const parts = []
  for (const part of content) {
    if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
      parts.push(part.text)
    }
  }
  return parts.join('\n')
}
