// dsh-tavern host half (v2 — multi-preset + session binding):
// - 每个预设独立保存 agent.cordis.yml / preset.yml / memory.md / relations.json
// - 每个会话可绑定不同预设，注入时按当前 sessionId 自动选择
// - 完全兼容旧版 API（旧接口操作"当前活动预设"）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { zstdDecompressSync } from 'node:zlib'

export const name = 'tavern'
export const inject = ['webServer', 'systemPrompt']

// ── 路径常量 ──────────────────────────────────────────────
const ROOT = path.join(os.homedir(), '.dsh', '.agent-presets')
const DEFAULT_PRESET_ID = 'default'
const DEFAULT_PRESET_DIR = 'tavern-lite'           // 兼容旧版目录名
const PRESETS_META = path.join(ROOT, 'presets.json')
const SESSION_BINDINGS = path.join(ROOT, 'session-bindings.json')
const STATE_PATH = path.join(ROOT, 'tavern-state.json')
const EDITED_MESSAGES_FILE = path.join(ROOT, 'edited-messages.json')
const CARD_MAX = 40000

// ── 工具函数 ──────────────────────────────────────────────
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
      if (size > 1024 * 1024) { reject(new Error('body-too-large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (e) { reject(new Error('invalid-json')) }
    })
    req.on('error', reject)
  })
}

function ensureRoot() {
  fs.mkdirSync(ROOT, { recursive: true })
}

function genId() {
  return 'preset-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

// ── 预设元数据管理 ────────────────────────────────────────
function readPresetsMeta() {
  try {
    const raw = fs.readFileSync(PRESETS_META, 'utf8')
    const data = JSON.parse(raw)
    if (!Array.isArray(data.presets)) data.presets = []
    return data
  } catch {
    return { presets: [] }
  }
}

function writePresetsMeta(data) {
  ensureRoot()
  fs.writeFileSync(PRESETS_META, JSON.stringify(data, null, 2), 'utf8')
}

function getPresetDir(presetId) {
  const meta = readPresetsMeta()
  const p = meta.presets.find(x => x.id === presetId)
  if (p && p.dir) return path.join(ROOT, p.dir)
  // 默认预设用旧目录名
  if (presetId === DEFAULT_PRESET_ID) return path.join(ROOT, DEFAULT_PRESET_DIR)
  return null
}

function ensureDefaultPreset() {
  const meta = readPresetsMeta()
  if (!meta.presets.some(p => p.id === DEFAULT_PRESET_ID)) {
    meta.presets.unshift({
      id: DEFAULT_PRESET_ID,
      name: '默认预设',
      dir: DEFAULT_PRESET_DIR,
      createdAt: Date.now()
    })
    writePresetsMeta(meta)
  }
  // 确保默认预设目录存在
  const dir = path.join(ROOT, DEFAULT_PRESET_DIR)
  fs.mkdirSync(dir, { recursive: true })
  return meta
}

function listPresets() {
  ensureDefaultPreset()
  const meta = readPresetsMeta()
  return meta.presets.map(p => {
    const dir = path.join(ROOT, p.dir || DEFAULT_PRESET_DIR)
    const ymlPath = path.join(dir, 'agent.cordis.yml')
    let cardChars = 0
    try {
      if (fs.existsSync(ymlPath)) cardChars = extractCardText(fs.readFileSync(ymlPath, 'utf8')).length
    } catch {}
    return { ...p, dir, cardChars }
  })
}

function createPreset(name, copyFromId) {
  ensureDefaultPreset()
  const meta = readPresetsMeta()
  const id = genId()
  const dirName = id
  const newDir = path.join(ROOT, dirName)
  fs.mkdirSync(newDir, { recursive: true })

  // 如果指定了复制源，复制文件
  if (copyFromId) {
    const srcDir = getPresetDir(copyFromId)
    if (srcDir && fs.existsSync(srcDir)) {
      for (const f of ['agent.cordis.yml', 'preset.yml', 'memory.md', 'relations.json']) {
        const src = path.join(srcDir, f)
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(newDir, f))
        }
      }
    }
  }

  meta.presets.push({ id, name: name || '新预设', dir: dirName, createdAt: Date.now() })
  writePresetsMeta(meta)
  return { id, name, dir: newDir }
}

function deletePreset(presetId) {
  if (presetId === DEFAULT_PRESET_ID) throw new Error('不能删除默认预设')
  const meta = readPresetsMeta()
  const idx = meta.presets.findIndex(p => p.id === presetId)
  if (idx < 0) throw new Error('预设不存在')
  const p = meta.presets[idx]
  // 删除目录
  const dir = path.join(ROOT, p.dir)
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  meta.presets.splice(idx, 1)
  writePresetsMeta(meta)
  // 清理会话绑定中指向该预设的条目
  const bindings = readBindings()
  for (const sid of Object.keys(bindings)) {
    if (bindings[sid] === presetId) delete bindings[sid]
  }
  writeBindings(bindings)
  return true
}

function renamePreset(presetId, name) {
  const meta = readPresetsMeta()
  const p = meta.presets.find(x => x.id === presetId)
  if (!p) throw new Error('预设不存在')
  p.name = String(name || '').trim() || p.name
  writePresetsMeta(meta)
  return p
}

// ── 会话绑定管理 ──────────────────────────────────────────
function readBindings() {
  try {
    const raw = fs.readFileSync(SESSION_BINDINGS, 'utf8')
    const data = JSON.parse(raw)
    return (data && typeof data === 'object') ? data : {}
  } catch { return {} }
}

function writeBindings(data) {
  ensureRoot()
  fs.writeFileSync(SESSION_BINDINGS, JSON.stringify(data, null, 2), 'utf8')
}

function getSessionPresetId(sessionId) {
  if (!sessionId) return DEFAULT_PRESET_ID
  const bindings = readBindings()
  return bindings[sessionId] || DEFAULT_PRESET_ID
}

function setSessionPreset(sessionId, presetId) {
  if (!sessionId) throw new Error('缺少 sessionId')
  // 验证预设存在
  const meta = readPresetsMeta()
  if (!meta.presets.some(p => p.id === presetId)) throw new Error('预设不存在')
  const bindings = readBindings()
  bindings[sessionId] = presetId
  writeBindings(bindings)
  return bindings[sessionId]
}

// ── 预设内容读写 ──────────────────────────────────────────
function readPresetFiles(presetId) {
  const dir = getPresetDir(presetId)
  if (!dir) return { agentYml: '', presetYml: '', dir: '' }
  fs.mkdirSync(dir, { recursive: true })
  const agentYml = fs.existsSync(path.join(dir, 'agent.cordis.yml'))
    ? fs.readFileSync(path.join(dir, 'agent.cordis.yml'), 'utf8') : ''
  const presetYml = fs.existsSync(path.join(dir, 'preset.yml'))
    ? fs.readFileSync(path.join(dir, 'preset.yml'), 'utf8') : ''
  return { agentYml, presetYml, dir }
}

function writePresetFiles(presetId, agentYml, presetYml) {
  const dir = getPresetDir(presetId)
  if (!dir) throw new Error('预设不存在')
  fs.mkdirSync(dir, { recursive: true })
  if (typeof agentYml === 'string') {
    fs.writeFileSync(path.join(dir, 'agent.cordis.yml'), agentYml, 'utf8')
  }
  if (typeof presetYml === 'string') {
    fs.writeFileSync(path.join(dir, 'preset.yml'), presetYml, 'utf8')
  }
  return dir
}

function cardTextFor(presetId) {
  const state = readState()
  if (state.cardEnabled === false) return ''
  const dir = getPresetDir(presetId)
  if (!dir) return ''
  try {
    const ymlPath = path.join(dir, 'agent.cordis.yml')
    if (!fs.existsSync(ymlPath)) return ''
    return extractCardText(fs.readFileSync(ymlPath, 'utf8'))
  } catch { return '' }
}

// ── 角色卡文本提取 ────────────────────────────────────────
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

// ── 全局状态 ──────────────────────────────────────────────
function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    if (s && typeof s === 'object') {
      if (!Array.isArray(s.disabledCwds)) s.disabledCwds = []
      if (!Array.isArray(s.allowCwds)) s.allowCwds = []
      if (!s.cwdPresets || typeof s.cwdPresets !== 'object') s.cwdPresets = {}
      if (s.mode !== 'global' && s.mode !== 'allowlist') s.mode = 'allowlist'
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
  ensureRoot()
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), 'utf8')
}

// ── 编辑过的消息（已是会话级，保留） ──────────────────────
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
    ensureRoot()
    fs.writeFileSync(EDITED_MESSAGES_FILE, JSON.stringify(data, null, 2), 'utf8')
  } catch {}
}

// ── 记忆/关系网（基于当前预设） ───────────────────────────
function memoryFile(presetId) { return path.join(getPresetDir(presetId) || path.join(ROOT, DEFAULT_PRESET_DIR), 'memory.md') }
function relationsFile(presetId) { return path.join(getPresetDir(presetId) || path.join(ROOT, DEFAULT_PRESET_DIR), 'relations.json') }

function readMemory(presetId) {
  try {
    const f = memoryFile(presetId)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8') || ''
  } catch {}
  return ''
}

function readRelations(presetId) {
  try {
    const f = relationsFile(presetId)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    if (fs.existsSync(f)) {
      const r = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (r && Array.isArray(r.nodes)) {
        if (!Array.isArray(r.edges)) r.edges = []
        return r
      }
    }
  } catch {}
  return { nodes: [], edges: [] }
}

function writeRelations(presetId, r) {
  const f = relationsFile(presetId)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify(r || { nodes: [], edges: [] }, null, 2), 'utf8')
}

function appendMemory(presetId, text) {
  const prev = readMemory(presetId)
  const stamp = '> [' + new Date().toLocaleString('sv-SE') + ']'
  const combined = prev.trim() + '\n\n' + stamp + '\n' + String(text || '').trim()
  const f = memoryFile(presetId)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, combined.trim() + '\n', 'utf8')
}

// ── LLM 调用 ──────────────────────────────────────────────
function callLLM(apiUrl, apiKey, model, messages, maxTokens) {
  return new Promise((resolve, reject) => {
    if (!apiUrl) return reject(new Error('未配置 API 地址'))
    // 兼容：如果用户只填了域名，自动补全 /v1/chat/completions
    let fullUrl = apiUrl
    try {
      const u = new URL(apiUrl)
      if (!u.pathname || u.pathname === '/' || !u.pathname.includes('completions')) {
        fullUrl = apiUrl.replace(/\/+$/, '') + '/v1/chat/completions'
      }
    } catch {}
    const payload = { model: model || 'deepseek-chat', messages, ...(maxTokens ? { max_tokens: maxTokens } : {}) }
    const url = new URL(fullUrl)
    const transport = url.protocol === 'https:' ? https : http
    const data = JSON.stringify(payload)
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
    if (apiKey) headers.authorization = 'Bearer ' + apiKey
    const req = transport.request({
      hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search, method: 'POST', headers
    }, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw)
          const text = parsed.choices?.[0]?.message?.content
          if (typeof text === 'string') return resolve(text)
          reject(new Error('未从模型获得文本：' + raw.slice(0, 300)))
        } catch (e) { reject(new Error('响应不是 JSON：' + raw.slice(0, 300))) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

// ── 会话服务获取 ──────────────────────────────────────────
function getSessionQuery(ctx) {
  try { if (ctx.get && typeof ctx.get === 'function') { const s = ctx.get('sessionQuery'); if (s) return s } } catch {}
  try { if (ctx.sessionQuery && typeof ctx.sessionQuery.load === 'function') return ctx.sessionQuery } catch {}
  return undefined
}
function getSessionPersistence(ctx) {
  try { if (ctx.get && typeof ctx.get === 'function') { const s = ctx.get('sessionPersistence'); if (s) return s } } catch {}
  try { if (ctx.sessionPersistence && typeof ctx.sessionPersistence.list === 'function') return ctx.sessionPersistence } catch {}
  return undefined
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

// ── zstd 多帧解压（会话文件） ─────────────────────────────
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
      try { decompressed = zstdDecompressSync(buf.subarray(start, end)).toString('utf8') }
      catch { continue }
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

function readSessionMessagesDirect(sessionId, maxMsgs) {
  const list = []
  const events = readSessionEventsDirect(sessionId, 0)
  for (const ev of events) {
    let text = ''
    if (ev.type === 'user/message') text = contentToText(ev.data && ev.data.content)
    else if (ev.type === 'assistant/message') text = contentToText(ev.data && ev.data.message && ev.data.message.content)
    if (text) list.push((ev.type === 'user/message' ? '用户' : '助手') + '：' + text)
  }
  return maxMsgs ? list.slice(-maxMsgs) : list
}

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
  if (!list.length) {
    try { return readSessionMessagesDirect(sessionId, n || 20) } catch {}
  }
  return list.slice(-(n || 20))
}

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

async function countUserMessages(ctx, sessionId) {
  const sq = getSessionQuery(ctx)
  if (!sq || !sessionId) return 0
  try {
    const snap = await sq.load(sessionId, undefined)
    const events = (snap && snap.events) || []
    return events.filter((e) => e && e.type === 'user/message').length
  } catch { return 0 }
}

// ── 总结/关系网 ───────────────────────────────────────────
function buildSummaryPrompt(messages) {
  const body = messages.slice(-40).join('\n')
  return [
    { role: 'system', content: '你是角色扮演酒馆的记忆管家。请只输出一个 JSON 对象，不要任何多余文字，格式为：' +
      '{"summary":"对刚才这段对话的简要记忆总结（中文，100字左右，第二人称概括当前剧情/状态/重要信息）",' +
      '"relations":[{"source":"人物A","target":"人物B","label":"关系/事件"}]}。' +
      'relations 只列出这段对话里新出现或明确改变的人物关系；没有就空数组。' },
    { role: 'user', content: '以下是最近的对话：\n\n' + body }
  ]
}

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

function mergeRelations(presetId, rels, existing) {
  const r = existing || readRelations(presetId)
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
  writeRelations(presetId, r)
  return r
}

async function runSummary(ctx, state, sessionId, presetId) {
  const m = (state && state.mem) || {}
  if (!m.apiUrl) throw new Error('未配置记忆模块 API 地址，请先在酒馆管理→记忆模块中填写 API URL')
  if (!sessionId) throw new Error('无法获取当前会话 ID，请先在对话中发一条消息后再总结')
  const msgs = await readRecentMessages(ctx, sessionId, m.autoEvery || 20)
  if (!msgs.length) throw new Error('当前会话没有可总结的消息（会话ID=' + sessionId + '），请先进行对话')
  const prompt = buildSummaryPrompt(msgs)
  const out = await callLLM(m.apiUrl, m.apiKey, m.model, prompt, 600)
  const { summary, rels, source } = parseSummaryOutput(out, sessionId)
  if (summary) appendMemory(presetId, '# 记忆总结\n' + summary)
  const relations = mergeRelations(presetId, rels, null)
  return { summary, rels, relations, memory: readMemory(presetId), source }
}

// ── 主应用 ────────────────────────────────────────────────
export function apply(ctx) {
  let active = null
  let lastCwd = ''
  let lastSessionId = ''
  let autoBusy = false

  ensureDefaultPreset()

  // 自动总结
  const maybeAutoSummary = () => {
    const state = readState()
    const m = state.mem || {}
    if (!m.autoEnabled || !m.apiUrl || autoBusy || !lastSessionId) return
    const presetId = getSessionPresetId(lastSessionId)
    countUserMessages(ctx, lastSessionId)
      .then(function (seq) {
        if (!seq) return
        const st2 = readState()
        const m2 = st2.mem || {}
        if (m2.lastSeq && seq >= m2.lastSeq && seq - m2.lastSeq >= (m2.autoEvery || 20)) {
          autoBusy = true
          m2.lastSeq = seq
          writeState(st2)
          runSummary(ctx, st2, lastSessionId, presetId)
            .catch((e) => { try { fs.writeFileSync(path.join(ROOT, 'memory.log'), '[' + new Date().toISOString() + '] 自动总结失败：' + e.message + '\n', { flag: 'a' }) } catch {} })
            .finally(() => { autoBusy = false })
        } else if (!m2.lastSeq || seq < m2.lastSeq) {
          m2.lastSeq = seq
          writeState(st2)
        }
      })
      .catch(() => {})
  }

  // ★ 核心：按会话绑定的预设注入角色卡 ★
  const refresh = () => {
    if (active) { active(); active = null }
    active = ctx.systemPrompt.section({
      name: 'tavern:card',
      order: 1,
      text: (context) => {
        const state = readState()
        // 获取当前会话 ID
        const sid = context?.agent?.session?.id || context?.agent?.session?.header?.id
        if (sid) lastSessionId = sid
        maybeAutoSummary()
        if (state.cardEnabled === false) return ''

        // ★ 根据会话 ID 查找绑定的预设 ★
        const presetId = getSessionPresetId(sid)
        const presetMeta = readPresetsMeta().presets.find(p => p.id === presetId)
        const presetName = presetMeta?.name || '默认预设'

        // cwd 范围控制（保留兼容）
        const cwd = context?.agent?.session?.header?.cwd
        const cwdKey = (str => str ? String(str).replace(/[\\/]+$/, '') : '')(cwd)
        if (cwdKey) lastCwd = cwdKey
        const norm = (d) => String(d || '').trim().replace(/[\\/]+$/, '')
        const inList = (arr) => cwdKey ? (arr || []).some(d => norm(d) === cwdKey) : false
        if (state.mode === 'global') {
          if (inList(state.disabledCwds)) return ''
        } else {
          if (!inList(state.allowCwds)) return ''
        }

        const text = cardTextFor(presetId)
        if (!text) return ''
        return `【当前角色卡（预设：${presetName}，会话绑定注入）】\n\n` + text
      }
    })
  }

  ctx.effect(() => {
    refresh()
    return () => { if (active) { active(); active = null } }
  }, 'tavern.card.section()')

  // 编辑过的消息注入（已是会话级）
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

  // ── API 路由 ────────────────────────────────────────────
  const routes = [
    // ★ 新增：预设管理 ★
    {
      kind: 'exact',
      path: '/api/tavern/presets',
      handler: (req, res) => {
        if (req.method === 'GET') {
          try {
            const presets = listPresets()
            const bindings = readBindings()
            json(res, 200, { ok: true, presets, bindings, defaultPresetId: DEFAULT_PRESET_ID })
          } catch (e) { json(res, 500, { ok: false, error: e.message }) }
          return
        }
        if (req.method === 'POST') {
          readBody(req).then((body) => {
            try {
              const p = createPreset(body.name, body.copyFrom)
              json(res, 200, { ok: true, preset: p, presets: listPresets() })
            } catch (e) { json(res, 500, { ok: false, error: e.message }) }
          }, (e) => json(res, 400, { ok: false, error: e.message }))
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      }
    },
    // 读取单个预设：GET /api/tavern/preset?id=xxx
    {
      kind: 'exact',
      path: '/api/tavern/preset',
      handler: (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        if (req.method === 'GET') {
          try {
            const presetId = url.searchParams.get('id') || getSessionPresetId(lastSessionId)
            const files = readPresetFiles(presetId)
            const meta = readPresetsMeta().presets.find(p => p.id === presetId)
            json(res, 200, { ok: true, presetId, name: meta?.name || '', ...files, cardChars: extractCardText(files.agentYml).length })
          } catch (e) { json(res, 500, { ok: false, error: e.message }) }
          return
        }
        if (req.method === 'POST') {
          readBody(req).then((body) => {
            try {
              const presetId = body.id || body.presetId || getSessionPresetId(lastSessionId)
              const dir = writePresetFiles(presetId, body.agentYml, body.presetYml)
              refresh()
              json(res, 200, { ok: true, dir, presetId })
            } catch (e) { json(res, 500, { ok: false, error: e.message }) }
          }, (e) => json(res, 400, { ok: false, error: e.message }))
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      }
    },
    // 删除预设：POST /api/tavern/preset/delete {id}
    {
      kind: 'exact',
      path: '/api/tavern/preset/delete',
      handler: (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
        readBody(req).then((body) => {
          try {
            deletePreset(body.id)
            json(res, 200, { ok: true, presets: listPresets() })
          } catch (e) { json(res, 500, { ok: false, error: e.message }) }
        }, (e) => json(res, 400, { ok: false, error: e.message }))
      }
    },
    // 重命名预设：POST /api/tavern/preset/rename {id,name}
    {
      kind: 'exact',
      path: '/api/tavern/preset/rename',
      handler: (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
        readBody(req).then((body) => {
          try {
            const p = renamePreset(body.id, body.name)
            json(res, 200, { ok: true, preset: p })
          } catch (e) { json(res, 500, { ok: false, error: e.message }) }
        }, (e) => json(res, 400, { ok: false, error: e.message }))
      }
    },
    // ★ 新增：会话绑定 ★
    {
      kind: 'exact',
      path: '/api/tavern/bind',
      handler: (req, res) => {
        if (req.method === 'GET') {
          try {
            const url = new URL(req.url, 'http://localhost')
            const sessionId = url.searchParams.get('sessionId') || lastSessionId || ''
            const presetId = getSessionPresetId(sessionId)
            const presetMeta = readPresetsMeta().presets.find(p => p.id === presetId)
            json(res, 200, { ok: true, sessionId, presetId, presetName: presetMeta?.name || '默认预设' })
          } catch (e) { json(res, 500, { ok: false, error: e.message }) }
          return
        }
        if (req.method === 'POST') {
          readBody(req).then((body) => {
            try {
              const sid = body.sessionId || lastSessionId
              const pid = setSessionPreset(sid, body.presetId)
              refresh()
              const presetMeta = readPresetsMeta().presets.find(p => p.id === pid)
              json(res, 200, { ok: true, sessionId: sid, presetId: pid, presetName: presetMeta?.name || '默认预设' })
            } catch (e) { json(res, 500, { ok: false, error: e.message }) }
          }, (e) => json(res, 400, { ok: false, error: e.message }))
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      }
    },
    // ★ 兼容旧版：读取（操作当前会话绑定的预设） ★
    {
      kind: 'exact',
      path: '/api/tavern/read',
      handler: (req, res) => {
        if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
        try {
          const url = new URL(req.url, 'http://localhost')
          const presetId = url.searchParams.get('presetId') || getSessionPresetId(lastSessionId)
          const files = readPresetFiles(presetId)
          const state = readState()
          const presetMeta = readPresetsMeta().presets.find(p => p.id === presetId)
          json(res, 200, {
            ok: true,
            ...files,
            presetId,
            presetName: presetMeta?.name || '默认预设',
            cardEnabled: state.cardEnabled !== false,
            injected: active !== null,
            cardChars: extractCardText(files.agentYml).length,
            disabledCwds: state.disabledCwds || [],
            allowCwds: state.allowCwds || [],
            mode: state.mode || 'allowlist',
            currentCwd: lastCwd,
            currentSessionId: lastSessionId,
          })
        } catch (e) { json(res, 500, { ok: false, error: e.message }) }
      }
    },
    // ★ 兼容旧版：保存（操作当前会话绑定的预设，或指定 presetId） ★
    {
      kind: 'exact',
      path: '/api/tavern/save',
      handler: (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
        readBody(req).then((body) => {
          try {
            const presetId = body.presetId || getSessionPresetId(lastSessionId)
            const dir = writePresetFiles(presetId, body.agentYml, body.presetYml)
            refresh()
            const state = readState()
            json(res, 200, { ok: true, dir, presetId, cardEnabled: state.cardEnabled !== false, injected: active !== null })
          } catch (e) { json(res, 500, { ok: false, error: e.message }) }
        }, (e) => json(res, 400, { ok: false, error: e.message }))
      }
    },
    // 状态（全局，保留）
    {
      kind: 'exact',
      path: '/api/tavern/state',
      handler: (req, res) => {
        if (req.method === 'GET') {
          const state = readState()
          json(res, 200, { ok: true, cardEnabled: state.cardEnabled !== false, injected: active !== null, disabledCwds: state.disabledCwds || [], allowCwds: state.allowCwds || [], mode: state.mode || 'allowlist', currentCwd: lastCwd, currentSessionId: lastSessionId })
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
      }
    },
    // 记忆配置（全局，保留）
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
      }
    },
    // 总结
    {
      kind: 'exact',
      path: '/api/tavern/summarize',
      handler: (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
        readBody(req).then((body) => {
          const st = readState()
          const want = Number.isFinite(body.rounds) ? Math.max(1, Math.floor(body.rounds)) : (st.mem?.autoEvery || 20)
          const sid = String(body.sessionId || lastSessionId || '')
          const presetId = getSessionPresetId(sid)
          const before = st.mem?.lastSeq || 0
          runSummary(ctx, st, sid, presetId)
            .then((out) => {
              const st2 = readState()
              st2.mem = st2.mem || {}
              st2.mem.lastSeq = Math.max(before || 0, (st2.mem.lastSeq || 0))
              writeState(st2)
              json(res, 200, { ok: true, ...out, rounds: want, sessionId: sid, presetId })
            })
            .catch((e) => json(res, 500, { ok: false, error: e.message }))
        }, (e) => json(res, 400, { ok: false, error: e.message }))
      }
    },
    // 关系网（基于当前会话预设）
    {
      kind: 'exact',
      path: '/api/tavern/relations',
      handler: (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const presetId = url.searchParams.get('presetId') || getSessionPresetId(lastSessionId)
        if (req.method === 'GET') {
          try {
            const data = readRelations(presetId)
            json(res, 200, { ok: true, relations: data, presetId })
          } catch (e) { json(res, 500, { ok: false, error: e.message }) }
          return
        }
        if (req.method === 'POST') {
          readBody(req).then((body) => {
            try {
              const pid = body.presetId || presetId
              writeRelations(pid, body.relations || { nodes: [], edges: [] })
              json(res, 200, { ok: true, presetId: pid })
            } catch (e) { json(res, 500, { ok: false, error: e.message }) }
          }, (e) => json(res, 400, { ok: false, error: e.message }))
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      }
    },
    // 记忆（基于当前会话预设）
    {
      kind: 'exact',
      path: '/api/tavern/memory',
      handler: (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const presetId = url.searchParams.get('presetId') || getSessionPresetId(lastSessionId)
        if (req.method === 'GET') {
          try {
            const text = readMemory(presetId)
            json(res, 200, { ok: true, memory: text, presetId })
          } catch (e) { json(res, 500, { ok: false, error: e.message }) }
          return
        }
        if (req.method === 'POST') {
          readBody(req).then((body) => {
            try {
              const pid = body.presetId || presetId
              const f = memoryFile(pid)
              fs.mkdirSync(path.dirname(f), { recursive: true })
              fs.writeFileSync(f, String(body.memory || ''), 'utf8')
              json(res, 200, { ok: true, presetId: pid })
            } catch (e) { json(res, 500, { ok: false, error: e.message }) }
          }, (e) => json(res, 400, { ok: false, error: e.message }))
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      }
    },
    // 会话列表
    {
      kind: 'exact',
      path: '/api/tavern/sessions',
      handler: (req, res) => {
        if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
        try {
          const persistence = getSessionPersistence(ctx)
          if (!persistence || typeof persistence.list !== 'function') {
            json(res, 200, { ok: true, sessions: [] })
            return
          }
          persistence.list().then(async (headers) => {
            let sessions = (headers || []).map((h) => ({ id: h.id, createdAt: h.createdAt || 0, origin: h.origin || '', title: '' }))
            sessions.sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
            sessions = sessions.slice(0, 20)
            const bindings = readBindings()
            for (const s of sessions) {
              try {
                const title = await Promise.race([
                  getSessionTitle(ctx, s.id),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
                ])
                s.title = title || ''
              } catch { s.title = '' }
              s.boundPreset = bindings[s.id] || DEFAULT_PRESET_ID
            }
            json(res, 200, { ok: true, sessions })
          }).catch((e) => json(res, 500, { ok: false, error: e.message }))
        } catch (e) { json(res, 500, { ok: false, error: e.message }) }
      }
    },
    // 会话内容
    {
      kind: 'exact',
      path: '/api/tavern/session-content',
      handler: (req, res) => {
        if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
        try {
          const url = new URL(req.url, 'http://localhost')
          const id = url.searchParams.get('id') || ''
          const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)))
          if (!id) { json(res, 400, { ok: false, error: 'missing-session-id' }); return }
          readRecentMessages(ctx, id, limit).then((messages) => {
            json(res, 200, { ok: true, id, count: messages.length, text: messages.join('\n') })
          }).catch((e) => json(res, 500, { ok: false, error: e.message }))
        } catch (e) { json(res, 500, { ok: false, error: e.message }) }
      }
    },
    // 编辑过的消息（会话级，保留）
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
          } catch (e) { json(res, 500, { ok: false, error: e.message }) }
          return
        }
        if (req.method === 'POST') {
          readBody(req).then((body) => {
            const { sessionId, key, text } = body || {}
            if (!sessionId || key === undefined || key === null) {
              json(res, 400, { ok: false, error: 'sessionId and key required' }); return
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
              json(res, 400, { ok: false, error: 'sessionId and key required' }); return
            }
            const all = readEditedMessages()
            if (all[sessionId]) delete all[sessionId][String(key)]
            writeEditedMessages(all)
            json(res, 200, { ok: true })
          }).catch((e) => json(res, 400, { ok: false, error: e.message }))
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      }
    },
  ]

  for (const route of routes) {
    ctx.webServer.register(route)
  }
}
