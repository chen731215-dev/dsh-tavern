// dsh-tavern host half: provides routes to read/save the native tavern preset,
// and injects the saved character card into the GLOBAL system prompt so every
// session in every workspace reads it (toggleable via /api/tavern/state).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { zstdDecompressSync } from 'node:zlib'

export const name = 'tavern'
export const inject = ['webServer', 'systemPrompt']

const PRESET_DIR = path.join(os.homedir(), '.dsh', '.agent-presets', 'tavern-lite')
const EDITED_MESSAGES_FILE = path.join(PRESET_DIR, 'edited-messages.json')
const STATE_PATH = path.join(os.homedir(), '.dsh', '.agent-presets', 'tavern-state.json')
const CARD_MAX = 40000

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (e) {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    if (s && typeof s === 'object') {
      if (!Array.isArray(s.disabledCwds)) s.disabledCwds = []
      if (!Array.isArray(s.allowCwds)) s.allowCwds = []
        if (!s.cwdPresets || typeof s.cwdPresets !== 'object') s.cwdPresets = {}
      if (s.mode !== 'global' && s.mode !== 'allowlist') s.mode = 'allowlist'
      // 记忆/总结模块配置（自选 API + 自动总结）缺省补齐
      if (!s.mem || typeof s.mem !== 'object') s.mem = {}
      const m = s.mem
      if (typeof m.apiUrl !== 'string') m.apiUrl = ''
      if (typeof m.apiKey !== 'string') m.apiKey = ''
      if (typeof m.model !== 'string' || !m.model) m.model = 'deepseek-chat'
      if (typeof m.autoEnabled !== 'boolean') m.autoEnabled = false
      if (typeof m.autoEvery !== 'number' || !Number.isFinite(m.autoEvery) || m.autoEvery < 1) m.autoEvery = 20
      if (typeof m.lastSeq !== 'number' || !Number.isFinite(m.lastSeq)) m.lastSeq = 0
      return s
    }
  } catch {}
  return { cardEnabled: true, disabledCwds: [], allowCwds: [], cwdPresets: {}, mode: 'allowlist', mem: { apiUrl: '', apiKey: '', model: 'deepseek-chat', autoEnabled: false, autoEvery: 20, lastSeq: 0 } }
}

function writeState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), 'utf8')
}

/** 编辑过的 AI 回复存储：{ [sessionId]: { [index]: { text, editedAt } } } */
function readEditedMessages() {
  try {
    if (fs.existsSync(EDITED_MESSAGES_FILE)) {
      return JSON.parse(fs.readFileSync(EDITED_MESSAGES_FILE, 'utf8'))
    }
  } catch {}
  return {}
}
function writeEditedMessages(data) {
  try {
    fs.mkdirSync(path.dirname(EDITED_MESSAGES_FILE), { recursive: true })
    fs.writeFileSync(EDITED_MESSAGES_FILE, JSON.stringify(data, null, 2), 'utf8')
  } catch {}
}

/** Pull the persona `text: |-` literal block out of the generated agent.cordis.yml. */
function extractCardText(agentYml) {
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

function cardFilePath() {
  return path.join(PRESET_DIR, 'agent.cordis.yml')
}

// ---- 记忆/自动总结（关联关系网） ----
const MEMORY_FILE = () => path.join(PRESET_DIR, 'memory.md')
const RELATIONS_FILE = () => path.join(PRESET_DIR, 'relations.json')

/** 读取 memory.md（带默认值） */
function readMemory() {
  try {
    fs.mkdirSync(PRESET_DIR, { recursive: true })
    if (fs.existsSync(MEMORY_FILE())) return fs.readFileSync(MEMORY_FILE(), 'utf8') || ''
  } catch {}
  return ''
}

/** 读取 relations.json（带默认值） */
function readRelations() {
  try {
    fs.mkdirSync(PRESET_DIR, { recursive: true })
    if (fs.existsSync(RELATIONS_FILE())) {
      const r = JSON.parse(fs.readFileSync(RELATIONS_FILE(), 'utf8'))
      if (r && Array.isArray(r.nodes)) {
        if (!Array.isArray(r.edges)) r.edges = []
        return r
      }
    }
  } catch {}
  return { nodes: [], edges: [] }
}

function writeRelations(r) {
  fs.mkdirSync(PRESET_DIR, { recursive: true })
  fs.writeFileSync(RELATIONS_FILE(), JSON.stringify(r || { nodes: [], edges: [] }, null, 2), 'utf8')
}

function appendMemory(text) {
  const prev = readMemory()
  const stamp = '> [' + new Date().toLocaleString('sv-SE') + ']'
  const combined = prev.trim() + '\n\n' + stamp + '\n' + String(text || '').trim()
  fs.mkdirSync(PRESET_DIR, { recursive: true })
  fs.writeFileSync(MEMORY_FILE(), combined.trim() + '\n', 'utf8')
}

/** 调 OpenAI 兼容 /chat/completions，返回文本。 */
function callLLM(apiUrl, apiKey, model, messages, maxTokens) {
  return new Promise((resolve, reject) => {
    if (!apiUrl) return reject(new Error('未配置 API 地址'))
    const payload = { model: model || 'deepseek-chat', messages, ...(maxTokens ? { max_tokens: maxTokens } : {}) }
    const url = new URL(apiUrl)
    const transport = url.protocol === 'https:' ? https : http
    const data = JSON.stringify(payload)
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
    if (apiKey) headers.authorization = 'Bearer ' + apiKey
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers
    }, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw)
          const text = parsed.choices?.[0]?.message?.content
          if (typeof text === 'string') return resolve(text)
          reject(new Error('未从模型获得文本：' + raw.slice(0, 300)))
        } catch (e) {
          reject(new Error('响应不是 JSON：' + raw.slice(0, 300)))
        }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

/** 取 sessionQuery 服务（get 或直接属性兜底）。 */
function getSessionQuery(ctx) {
  try {
    if (ctx.get && typeof ctx.get === 'function') {
      const s = ctx.get('sessionQuery')
      if (s) return s
    }
  } catch {}
  try { if (ctx.sessionQuery && typeof ctx.sessionQuery.load === 'function') return ctx.sessionQuery } catch {}
  return undefined
}

/** 取 sessionPersistence 服务（用于列出所有会话）。 */
function getSessionPersistence(ctx) {
  try {
    if (ctx.get && typeof ctx.get === 'function') {
      const s = ctx.get('sessionPersistence')
      if (s) return s
    }
  } catch {}
  try { if (ctx.sessionPersistence && typeof ctx.sessionPersistence.list === 'function') return ctx.sessionPersistence } catch {}
  return undefined
}

/** 取 sessionTitle 服务（用于获取会话标题）。 */
function getSessionTitleService(ctx) {
  try {
    if (ctx.get && typeof ctx.get === 'function') {
      const s = ctx.get('sessionTitle')
      if (s) return s
    }
  } catch {}
  return undefined
}

/** 从 sessionQuery 事件日志里提取最近 N 条 user/assistant 消息文本（async: load 是异步的）。 */
async function readRecentMessages(ctx, sessionId, n) {
  const list = []
  const sq = getSessionQuery(ctx)
  if (sq && sessionId) {
    try {
      const snap = await sq.load(sessionId, undefined)
      const events = (snap && snap.events) || []
      for (const ev of events) {
        let text = ''
        if (ev.type === 'user/message') text = contentToText(ev.data && ev.data.content)
        else if (ev.type === 'assistant/message') text = contentToText(ev.data && ev.data.message && ev.data.message.content)
        if (text) list.push((ev.type === 'user/message' ? '用户' : '助手') + '：' + text)
      }
    } catch {}
  }
  return list.slice(-(n || 20))
}

/** 从 sessionPersistence 读取任意历史会话的消息（用于故事背景导入）。 */
/** 多帧 zstd 解压：DSH 会话文件是多帧 zstd，zstdDecompressSync 只读第一帧。 */
function zstdDecompressMultiFrame(buf) {
  const magic = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])
  const frames = []
  let pos = 0
  while (pos < buf.length) {
    const idx = buf.indexOf(magic, pos)
    if (idx === -1) break
    if (frames.length > 0) frames[frames.length - 1].end = idx
    frames.push({ start: idx, end: buf.length })
    pos = idx + 4
  }
  const chunks = []
  for (const f of frames) {
    try {
      chunks.push(zstdDecompressSync(buf.subarray(f.start, f.end)))
    } catch {}
  }
  return Buffer.concat(chunks)
}

/** 直接读 zstd 会话文件并解压，返回事件数组。逐帧解压，够数就停，省内存。 */
function readSessionEventsDirect(sessionId, maxEvents) {
  const events = []
  if (!sessionId) return events
  const sessionsRoot = path.join(os.homedir(), '.dsh', 'sessions')
  let filePath = null
  try {
    const dirs = fs.readdirSync(sessionsRoot, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      const candidate = path.join(sessionsRoot, d.name, 'session-' + sessionId.replace(/^session-/, ''), 'session.jsonl.zstd')
      if (fs.existsSync(candidate)) { filePath = candidate; break }
      const candidate2 = path.join(sessionsRoot, d.name, sessionId, 'session.jsonl.zstd')
      if (fs.existsSync(candidate2)) { filePath = candidate2; break }
    }
  } catch {}
  if (!filePath) return events
  try {
    const buf = fs.readFileSync(filePath)
    const magic = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])
    // 找所有帧起始位置
    const frameStarts = []
    let pos = 0
    while (pos < buf.length) {
      const idx = buf.indexOf(magic, pos)
      if (idx === -1) break
      frameStarts.push(idx)
      pos = idx + 4
    }
    // 逐帧解压，够数就停
    for (let i = 0; i < frameStarts.length; i++) {
      const start = frameStarts[i]
      const end = i + 1 < frameStarts.length ? frameStarts[i + 1] : buf.length
      let decompressed
      try {
        decompressed = zstdDecompressSync(buf.subarray(start, end)).toString('utf8')
      } catch { continue }
      const lines = decompressed.split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line)
          events.push(ev)
          if (maxEvents && maxEvents > 0 && events.length >= maxEvents) return events
        } catch {}
      }
    }
  } catch {}
  return events
}

/** 直接读 zstd 会话文件，只提取消息文本，逐帧处理省内存。 */
function readSessionMessagesDirect(sessionId, maxMsgs) {
  const list = []
  if (!sessionId) return list
  const sessionsRoot = path.join(os.homedir(), '.dsh', 'sessions')
  let filePath = null
  try {
    const dirs = fs.readdirSync(sessionsRoot, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      const candidate = path.join(sessionsRoot, d.name, 'session-' + sessionId.replace(/^session-/, ''), 'session.jsonl.zstd')
      if (fs.existsSync(candidate)) { filePath = candidate; break }
      const candidate2 = path.join(sessionsRoot, d.name, sessionId, 'session.jsonl.zstd')
      if (fs.existsSync(candidate2)) { filePath = candidate2; break }
    }
  } catch {}
  if (!filePath) return list
  try {
    const buf = fs.readFileSync(filePath)
    const magic = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])
    const frameStarts = []
    let pos = 0
    while (pos < buf.length) {
      const idx = buf.indexOf(magic, pos)
      if (idx === -1) break
      frameStarts.push(idx)
      pos = idx + 4
    }
    for (let i = 0; i < frameStarts.length; i++) {
      const start = frameStarts[i]
      const end = i + 1 < frameStarts.length ? frameStarts[i + 1] : buf.length
      let decompressed
      try {
        decompressed = zstdDecompressSync(buf.subarray(start, end)).toString('utf8')
      } catch { continue }
      const lines = decompressed.split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line)
          let text = ''
          if (ev.type === 'user/message') text = contentToText(ev.data && ev.data.content)
          else if (ev.type === 'assistant/message') text = contentToText(ev.data && ev.data.message && ev.data.message.content)
          if (text) list.push((ev.type === 'user/message' ? '用户' : '助手') + '：' + text)
        } catch {}
      }
    }
  } catch {}
  return maxMsgs ? list.slice(-maxMsgs) : list
}

async function readSessionMessages(ctx, sessionId, limit) {
  const maxMsgs = Math.min(limit || 50, 100)
  // 方式1: 直接读 zstd 文件（最稳，省内存）
  try {
    const list = readSessionMessagesDirect(sessionId, maxMsgs)
    if (list.length) return list
  } catch {}
  // 方式2: sessionQuery（兜底）
  try {
    const sq = getSessionQuery(ctx)
    if (sq && typeof sq.load === 'function') {
      const snap = await sq.load(sessionId, undefined)
      const events = (snap && (snap.events || (snap.session && snap.session.events))) || []
      const list = []
      for (const ev of events) {
        let text = ''
        if (ev.type === 'user/message') text = contentToText(ev.data && ev.data.content)
        else if (ev.type === 'assistant/message') text = contentToText(ev.data && ev.data.message && ev.data.message.content)
        if (text) list.push((ev.type === 'user/message' ? '用户' : '助手') + '：' + text)
      }
      if (list.length) return list.slice(-maxMsgs)
    }
  } catch {}
  return []
}

/** 取会话标题：读会话文件，取第一条用户消息。 */
async function getSessionTitle(ctx, sessionId) {
  try {
    const events = readSessionEventsDirect(sessionId, 50)
    for (const ev of events) {
      if (ev.type === 'user/message') {
        const text = contentToText(ev.data && ev.data.content).trim()
        if (text) return text.slice(0, 60)
      }
    }
  } catch {}
  return ''
}

/** 统计当前会话已产生的 user 消息条数（async）。 */
async function countUserMessages(ctx, sessionId) {
  const sq = getSessionQuery(ctx)
  if (!sq || !sessionId) return 0
  try {
    const snap = await sq.load(sessionId, undefined)
    const events = (snap && snap.events) || []
    return events.filter((e) => e && e.type === 'user/message').length
  } catch { return 0 }
}

function contentToText(content) {
  if (!content || !Array.isArray(content)) return ''
  const parts = []
  const walk = (blocks) => {
    if (!Array.isArray(blocks)) return
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
      else if (b.type === 'tool-result' && b.content) walk(b.content)
      else if (b.type === 'reasoning') { /* 忽略推理 */ }
      else if (b.type === 'tool-call') { if (b.name) parts.push('[工具' + b.name + ']') }
    }
  }
  walk(content)
  return parts.map((s) => s.trim()).filter(Boolean).join('\n')
}

/** 让模型产出「总结 + 关系」两个 JSON 字段（尽量结构化）。 */
function buildSummaryPrompt(messages) {
  const body = messages.slice(-40).join('\n')
  return [
    {
      role: 'system',
      content: '你是角色扮演酒馆的记忆管家。请只输出一个 JSON 对象，不要任何多余文字，格式为：' +
        '{"summary":"对刚才这段对话的简要记忆总结（中文，100字左右，第二人称概括当前剧情/状态/重要信息）",' +
        '"relations":[{"source":"人物A","target":"人物B","label":"关系/事件"}]}。' +
        'relations 只列出这段对话里新出现或明确改变的人物关系；没有就空数组。'
    },
    { role: 'user', content: '以下是最近的对话：\n\n' + body }
  ]
}

/** 把模型输出解析成总结文本 + 关系数组（宽容解析：优先 JSON，失败则整段当总结）。 */
function parseSummaryOutput(text, sessionId) {
  let summary = '', rels = []
  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const obj = JSON.parse(text.slice(start, end + 1))
      summary = String(obj.summary || '').trim()
      if (Array.isArray(obj.relations)) rels = obj.relations
    }
  } catch {}
  if (!summary) summary = String(text || '').trim()
  return { summary, rels, source: sessionId || '' }
}

/** 把解析出的人物关系合并进 relations.json（人名为 node，关系为 edge，端点在 node 里）。 */
function mergeRelations(rels, existing) {
  const r = existing || readRelations()
  const nodeId = (name) => String(name || '').trim()
  const addNode = (name) => {
    const id = nodeId(name)
    if (!id) return null
    if (!r.nodes.some((x) => x.id === id)) r.nodes.push({ id, label: id })
    return id
  }
  const hasEdge = (s, t) => r.edges.some((e) => e.source === s && e.target === t)
  for (const rel of rels || []) {
    const s = addNode(rel.source)
    const t = addNode(rel.target)
    if (!s || !t || s === t) continue
    if (!hasEdge(s, t)) r.edges.push({ source: s, target: t, label: nodeId(rel.label) || '有关' })
  }
  writeRelations(r)
  return r
}

/** 自动/手动总结主流程。 */
async function runSummary(ctx, state, sessionId) {
  const m = (state && state.mem) || {}
  const msgs = await readRecentMessages(ctx, sessionId, m.autoEvery || 20)
  if (!msgs.length) throw new Error('这个会话还没有可总结的消息')
  const prompt = buildSummaryPrompt(msgs)
  const out = await callLLM(m.apiUrl, m.apiKey, m.model, prompt, 600)
  const { summary, rels, source } = parseSummaryOutput(out, sessionId)
  if (summary) appendMemory('# 记忆总结\n' + summary)
  const relations = mergeRelations(rels, null)
  return { summary, rels, relations, memory: readMemory(), source }
}

export function apply(ctx) {
  let active = null
  let lastCwd = ''
  let lastSessionId = ''
  let autoBusy = false
  const cardTextFor = () => {
    const state = readState()
    if (state.cardEnabled === false) return ''
    let text = ''
    try { text = extractCardText(fs.readFileSync(cardFilePath(), 'utf8')) } catch {}
    return text
  }
  // 自动总结：统计当前会话 user/message 事件条数，若 autoEnabled 且（现条数-上次条数）>= autoEvery 就触发一次。
  const maybeAutoSummary = () => {
    const state = readState()
    const m = state.mem || {}
    if (!m.autoEnabled || !m.apiUrl || autoBusy || !lastSessionId) return
    countUserMessages(ctx, lastSessionId)
      .then(function (seq) {
        if (!seq) return
        const st2 = readState()
        const m2 = st2.mem || {}
        if (m2.lastSeq && seq >= m2.lastSeq && seq - m2.lastSeq >= (m2.autoEvery || 20)) {
          autoBusy = true
          m2.lastSeq = seq
          writeState(st2)
          runSummary(ctx, st2, lastSessionId)
            .catch((e) => { try { fs.writeFileSync(path.join(PRESET_DIR, 'memory.log'), '[' + new Date().toISOString() + '] 自动总结失败：' + e.message + '\n', { flag: 'a' }) } catch {} })
            .finally(() => { autoBusy = false })
        } else if (!m2.lastSeq || seq < m2.lastSeq) {
          m2.lastSeq = seq
          writeState(st2)
        }
      })
      .catch(() => {})
  }
  // 卡片以「函数段」注册：每次组装时根据当前会话的工作目录(cwd) + 生效模式判断是否注入。
  //  mode='global'   -> 默认所有会话注入，除非 cwd 在 disabledCwds(黑名单)
  //  mode='allowlist'-> 默认不注入，只有 cwd 在 allowCwds(白名单) 才注入
  const refresh = () => {
    if (active) { active(); active = null }
    active = ctx.systemPrompt.section({
      name: 'tavern:card',
      order: 1,
      text: (context) => {
        const state = readState()
        // 记录当前会话 id，供自动总结用
        const sid = context?.agent?.session?.id || context?.agent?.session?.header?.id
        if (sid) lastSessionId = sid
        maybeAutoSummary()
        if (state.cardEnabled === false) return ''
        const cwd = context?.agent?.session?.header?.cwd
        const cwdKey = (str => str ? String(str).replace(/[\\/]+$/, '') : '')(cwd)
        if (cwdKey) lastCwd = cwdKey
        const norm = (d) => String(d || '').trim().replace(/[\\/]+$/, '')
        const inList = (arr) => cwdKey ? (arr || []).some(d => norm(d) === cwdKey) : false
        if (state.mode === 'global') {
          if (inList(state.disabledCwds)) return ''          // 黑名单：排除的工作区不注入
        } else {
          if (!inList(state.allowCwds)) return ''            // 白名单：要在列表里才注入
        }
        const text = cardTextFor()
        if (!text) return ''
        const scopeNote = state.mode === 'allowlist'
          ? '【当前角色卡（酒馆管理保存，白名单注入：仅对本会话/已加入工作区生效）】'
          : '【当前角色卡（酒馆管理已保存，全局注入，所有工作区每轮可见）】'
        return scopeNote + '\n\n' + text
      }
    })
  }
  ctx.effect(() => {
    refresh()
    return () => { if (active) { active(); active = null } }
  }, 'tavern.card.section()')

  // ── 编辑过的 AI 回复注入到系统提示词，影响后续生成 ──
  let activeEdits = null
  activeEdits = ctx.systemPrompt.section({
    name: 'tavern:edits',
    order: 2,
    text: (context) => {
      const sid = context?.agent?.session?.id || context?.agent?.session?.header?.id
      if (!sid) return ''
      const all = readEditedMessages()
      const edits = all[sid]
      if (!edits || Object.keys(edits).length === 0) return ''
      const lines = ['【用户已修正的历史回复 — 请以修正后的内容为准，忽略原始回复】']
      const keys = Object.keys(edits).sort((a, b) => Number(a) - Number(b))
      for (const key of keys) {
        const item = edits[key]
        if (item && item.text) {
          lines.push(`第 ${Number(key) + 1} 条 AI 回复（修正后）：${item.text}`)
        }
      }
      lines.push('以上修正内容已替代原始回复，请在后续回答中严格遵循。')
      return lines.join('\n\n')
    }
  })
  ctx.effect(() => {
    return () => { if (activeEdits) { activeEdits(); activeEdits = null } }
  }, 'tavern.edits.section()')

  const routes = [
    {
      kind: 'exact',
      path: '/api/tavern/read',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          json(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        try {
          fs.mkdirSync(PRESET_DIR, { recursive: true })
          const agentYml = fs.existsSync(path.join(PRESET_DIR, 'agent.cordis.yml'))
            ? fs.readFileSync(path.join(PRESET_DIR, 'agent.cordis.yml'), 'utf8')
            : ''
          const presetYml = fs.existsSync(path.join(PRESET_DIR, 'preset.yml'))
            ? fs.readFileSync(path.join(PRESET_DIR, 'preset.yml'), 'utf8')
            : ''
          const state = readState()
          json(res, 200, {
            ok: true,
            agentYml,
            presetYml,
            dir: PRESET_DIR,
            cardEnabled: state.cardEnabled !== false,
            injected: active !== null,
            cardChars: extractCardText(agentYml).length,
            disabledCwds: state.disabledCwds || [],
            allowCwds: state.allowCwds || [],
            mode: state.mode || 'allowlist',
            currentCwd: lastCwd,
          })
        } catch (e) {
          json(res, 500, { ok: false, error: e.message })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/tavern/save',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        readBody(req).then((body) => {
          try {
            fs.mkdirSync(PRESET_DIR, { recursive: true })
            if (typeof body.agentYml === 'string') {
              fs.writeFileSync(path.join(PRESET_DIR, 'agent.cordis.yml'), body.agentYml, 'utf8')
            }
            if (typeof body.presetYml === 'string') {
              fs.writeFileSync(path.join(PRESET_DIR, 'preset.yml'), body.presetYml, 'utf8')
            }
            refresh()
            const state = readState()
            json(res, 200, { ok: true, dir: PRESET_DIR, cardEnabled: state.cardEnabled !== false, injected: active !== null })
          } catch (e) {
            json(res, 500, { ok: false, error: e.message })
          }
        }, (e) => {
          json(res, 400, { ok: false, error: e.message })
        })
      },
    },
    {
      kind: 'exact',
      path: '/api/tavern/state',
      handler: (req, res) => {
        if (req.method === 'GET') {
          const state = readState()
          json(res, 200, { ok: true, cardEnabled: state.cardEnabled !== false, injected: active !== null, disabledCwds: state.disabledCwds || [], allowCwds: state.allowCwds || [], mode: state.mode || 'allowlist', currentCwd: lastCwd })
          return
        }
        if (req.method === 'POST') {
          readBody(req).then((body) => {
            const state = readState()
            if (typeof body.cardEnabled === 'boolean') state.cardEnabled = body.cardEnabled
            if (body.mode === 'global' || body.mode === 'allowlist') state.mode = body.mode
            if (body.disabledCwds !== undefined) state.disabledCwds = (Array.isArray(body.disabledCwds) ? body.disabledCwds : []).map(s => String(s).trim()).filter(Boolean)
            if (body.allowCwds !== undefined) state.allowCwds = (Array.isArray(body.allowCwds) ? body.allowCwds : []).map(s => String(s).trim()).filter(Boolean)
            writeState(state)
            refresh()
            json(res, 200, { ok: true, cardEnabled: state.cardEnabled !== false, injected: active !== null, disabledCwds: state.disabledCwds || [], allowCwds: state.allowCwds || [], mode: state.mode || 'allowlist', currentCwd: lastCwd })
          }, (e) => json(res, 400, { ok: false, error: e.message }))
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      },
    },
    {
      kind: 'exact',
      path: '/api/tavern/ignore',
      handler: (req, res) => {
        if (req.method === 'GET') {
          const state = readState()
          json(res, 200, { ok: true, disabledCwds: state.disabledCwds || [] })
          return
        }
        if (req.method === 'POST') {
          readBody(req).then((body) => {
            const state = readState()
            let list = Array.isArray(body.disabledCwds) ? body.disabledCwds : state.disabledCwds || []
            if (typeof body.disabledCwds === 'string') list = body.disabledCwds.split(/\n/).map(s => s.trim()).filter(Boolean)
            state.disabledCwds = list.map(s => String(s).trim()).filter(Boolean)
            writeState(state)
            refresh()
            json(res, 200, { ok: true, disabledCwds: state.disabledCwds })
          }, (e) => json(res, 400, { ok: false, error: e.message }))
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      },
    },
    {
      kind: 'exact',
      path: '/api/tavern/config',
      handler: (req, res) => {
        if (req.method === 'GET') {
          const st = readState()
          json(res, 200, { ok: true, mem: st.mem || {}, currentCwd: lastCwd, currentSessionId: lastSessionId })
          return
        }
        if (req.method === 'POST') {
          readBody(req).then((body) => {
            const st = readState()
            const m = st.mem || {}
            if (typeof body.apiUrl === 'string') m.apiUrl = body.apiUrl.trim()
            if (typeof body.apiKey === 'string') m.apiKey = body.apiKey.trim()
            if (typeof body.model === 'string') m.model = body.model.trim() || 'deepseek-chat'
            if (typeof body.autoEnabled === 'boolean') m.autoEnabled = body.autoEnabled
            if (typeof body.autoEvery === 'number' && Number.isFinite(body.autoEvery) && body.autoEvery >= 1) m.autoEvery = Math.floor(body.autoEvery)
            st.mem = m
            writeState(st)
            json(res, 200, { ok: true, mem: m })
          }, (e) => json(res, 400, { ok: false, error: e.message }))
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      },
    },
    {
      kind: 'exact',
      path: '/api/tavern/summarize',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        readBody(req).then((body) => {
          const st = readState()
          // 允许手动选择想要总结的条数，缺省用配置的 autoEvery
          const want = Number.isFinite(body.rounds) ? Math.max(1, Math.floor(body.rounds)) : (st.mem?.autoEvery || 20)
          const sid = String(body.sessionId || lastSessionId || '')
          const before = st.mem?.lastSeq || 0
          // 手动总结：临时用「手动条数」范围，但读的是最近 want 条
          runSummary(ctx, st, sid)
            .then((out) => {
              // 更新已总结游标（手动总结后避免又自动触发一遍刚才这些）
              const st2 = readState()
              st2.mem = st2.mem || {}
              st2.mem.lastSeq = Math.max(before || 0, (st2.mem.lastSeq || 0))
              writeState(st2)
              json(res, 200, { ok: true, ...out, rounds: want, sessionId: sid })
            })
            .catch((e) => json(res, 500, { ok: false, error: e.message }))
        }, (e) => json(res, 400, { ok: false, error: e.message }))
      },
    },
      {
        kind: 'exact',
        path: '/api/tavern/relations',
        handler: (req, res) => {
          const file = path.join(PRESET_DIR, 'relations.json')
          if (req.method === 'GET') {
            try {
              fs.mkdirSync(PRESET_DIR, { recursive: true })
              const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { nodes: [], edges: [] }
              json(res, 200, { ok: true, relations: data })
            } catch (e) {
              json(res, 500, { ok: false, error: e.message })
            }
            return
          }
          if (req.method === 'POST') {
            readBody(req).then((body) => {
              try {
                fs.mkdirSync(PRESET_DIR, { recursive: true })
                const relations = body.relations || { nodes: [], edges: [] }
                fs.writeFileSync(file, JSON.stringify(relations, null, 2), 'utf8')
                json(res, 200, { ok: true })
              } catch (e) {
                json(res, 500, { ok: false, error: e.message })
              }
            }, (e) => json(res, 400, { ok: false, error: e.message }))
            return
          }
          json(res, 405, { ok: false, error: 'method-not-allowed' })
        },
      },
      {
        kind: 'exact',
        path: '/api/tavern/memory',
        handler: (req, res) => {
          const file = path.join(PRESET_DIR, 'memory.md')
          if (req.method === 'GET') {
            try {
              fs.mkdirSync(PRESET_DIR, { recursive: true })
              const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
              json(res, 200, { ok: true, memory: text })
            } catch (e) {
              json(res, 500, { ok: false, error: e.message })
            }
            return
          }
          if (req.method === 'POST') {
            readBody(req).then((body) => {
              try {
                fs.mkdirSync(PRESET_DIR, { recursive: true })
                fs.writeFileSync(file, String(body.memory || ''), 'utf8')
                json(res, 200, { ok: true })
              } catch (e) {
                json(res, 500, { ok: false, error: e.message })
              }
            }, (e) => json(res, 400, { ok: false, error: e.message }))
            return
          }
          json(res, 405, { ok: false, error: 'method-not-allowed' })
        },
      },
      {
        kind: 'exact',
        path: '/api/tavern/sessions',
        handler: (req, res) => {
          if (req.method !== 'GET') {
            json(res, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          try {
            const persistence = getSessionPersistence(ctx)
            if (!persistence || typeof persistence.list !== 'function') {
              json(res, 200, { ok: true, sessions: [] })
              return
            }
            persistence.list().then(async (headers) => {
              let sessions = (headers || []).map((h) => ({
                id: h.id,
                createdAt: h.createdAt || 0,
                origin: h.origin || '',
                title: '',
              }))
              sessions.sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
              sessions = sessions.slice(0, 20)
              // 串行取标题，避免同时解压多个大 zstd 文件导致内存爆
              for (const s of sessions) {
                try {
                  const title = await Promise.race([
                    getSessionTitle(ctx, s.id),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
                  ])
                  s.title = title || ''
                } catch { s.title = '' }
              }
              json(res, 200, { ok: true, sessions })
            }).catch((e) => json(res, 500, { ok: false, error: e.message }))
          } catch (e) {
            json(res, 500, { ok: false, error: e.message })
          }
        },
      },
      {
        kind: 'exact',
        path: '/api/tavern/session-content',
        handler: (req, res) => {
          if (req.method !== 'GET') {
            json(res, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          try {
            const url = new URL(req.url, 'http://localhost')
            const id = url.searchParams.get('id') || ''
            const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)))
            if (!id) {
              json(res, 400, { ok: false, error: 'missing-session-id' })
              return
            }
            readSessionMessages(ctx, id, limit).then((messages) => {
              const text = messages.join('\n')
              json(res, 200, { ok: true, id, count: messages.length, text })
            }).catch((e) => json(res, 500, { ok: false, error: e.message }))
          } catch (e) {
            json(res, 500, { ok: false, error: e.message })
          }
        },
      },
      {
        kind: 'exact',
        path: '/api/tavern/edited-messages',
        handler: (req, res) => {
          if (req.method === 'GET') {
            try {
              const url = new URL(req.url, 'http://localhost')
              const sessionId = url.searchParams.get('sessionId') || ''
              const all = readEditedMessages()
              json(res, 200, { ok: true, edited: sessionId ? (all[sessionId] || {}) : all })
            } catch (e) {
              json(res, 500, { ok: false, error: e.message })
            }
            return
          }
          if (req.method === 'POST') {
            readBody(req).then((body) => {
              const { sessionId, key, text } = body || {}
              if (!sessionId || key === undefined || key === null) {
                json(res, 400, { ok: false, error: 'sessionId and key required' })
                return
              }
              const all = readEditedMessages()
              if (!all[sessionId]) all[sessionId] = {}
              all[sessionId][String(key)] = { text: String(text || ''), editedAt: Date.now() }
              writeEditedMessages(all)
              json(res, 200, { ok: true })
            }).catch((e) => json(res, 400, { ok: false, error: e.message }))
            return
          }
          if (req.method === 'DELETE') {
            readBody(req).then((body) => {
              const { sessionId, key } = body || {}
              if (!sessionId || key === undefined || key === null) {
                json(res, 400, { ok: false, error: 'sessionId and key required' })
                return
              }
              const all = readEditedMessages()
              if (all[sessionId]) delete all[sessionId][String(key)]
              writeEditedMessages(all)
              json(res, 200, { ok: true })
            }).catch((e) => json(res, 400, { ok: false, error: e.message }))
            return
          }
          json(res, 405, { ok: false, error: 'method-not-allowed' })
        },
      },
  ]

  for (const route of routes) {
    ctx.webServer.register(route)
  }
}
