// dsh-tavern host half: provides routes to read/save the native tavern preset,
// and injects the saved character card into the GLOBAL system prompt so every
// session in every workspace reads it (toggleable via /api/tavern/state).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'

export const name = 'tavern'
export const inject = ['webServer', 'systemPrompt']

const PRESET_DIR = path.join(os.homedir(), '.dsh', '.agent-presets', 'tavern-lite')
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
      if (s.mode !== 'global' && s.mode !== 'allowlist') s.mode = 'allowlist'
      return s
    }
  } catch {}
  return { cardEnabled: true, disabledCwds: [], allowCwds: [], mode: 'allowlist' }
}

function writeState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), 'utf8')
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

export function apply(ctx) {
  let active = null
  let lastCwd = ''
  const cardTextFor = () => {
    const state = readState()
    if (state.cardEnabled === false) return ''
    let text = ''
    try { text = extractCardText(fs.readFileSync(cardFilePath(), 'utf8')) } catch {}
    return text
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
      path: '/api/tavern/vision',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        readBody(req).then((body) => {
          const apiUrl = String(body.apiUrl || '').trim()
          const apiKey = String(body.apiKey || '').trim()
          const model = String(body.model || '').trim() || 'deepseek-v4-flash'
          const imageBase64 = String(body.imageBase64 || '')
          const prompt = String(body.prompt || '请描述这张图片的内容。')
          if (!apiUrl || !imageBase64) {
            json(res, 400, { ok: false, error: '缺少 apiUrl 或图片' })
            return
          }
          const payload = {
            model: model,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: imageBase64 } }
                ]
              }
            ]
          }
          const url = new URL(apiUrl)
          const transport = url.protocol === 'https:' ? https : http
          const reqData = JSON.stringify(payload)
          const headers = {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(reqData)
          }
          if (apiKey) headers.authorization = 'Bearer ' + apiKey
          const upstreamReq = transport.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers
          }, (upstreamRes) => {
            let data = ''
            upstreamRes.on('data', (chunk) => { data += chunk })
            upstreamRes.on('end', () => {
              try {
                const parsed = JSON.parse(data)
                const text = parsed.choices?.[0]?.message?.content || ''
                json(res, 200, { ok: true, text })
              } catch (e) {
                json(res, 200, { ok: false, raw: data.slice(0, 2000), error: '响应不是 JSON' })
              }
            })
          })
          upstreamReq.on('error', (e) => {
            json(res, 502, { ok: false, error: e.message })
          })
          upstreamReq.write(reqData)
          upstreamReq.end()
        }, (e) => {
          json(res, 400, { ok: false, error: e.message })
        })
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
  ]

  for (const route of routes) {
    ctx.webServer.register(route)
  }
}
