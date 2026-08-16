// dsh-tavern host half: provides routes to read/save the native tavern preset.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'

export const name = 'tavern'
export const inject = ['webServer']

const PRESET_DIR = path.join(os.homedir(), '.dsh', '.agent-presets', 'tavern-lite')

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

export function apply(ctx) {
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
          json(res, 200, { ok: true, agentYml, presetYml, dir: PRESET_DIR })
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
            json(res, 200, { ok: true, dir: PRESET_DIR })
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
  ]

  for (const route of routes) {
    ctx.webServer.register(route)
  }
}
