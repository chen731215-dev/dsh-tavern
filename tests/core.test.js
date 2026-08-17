import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchWorldbookEntries, buildWorldbookText, extractCardText, contentToText } from '../lib/utils.js'

// ── matchWorldbookEntries ──────────────────────────────
test('matchWorldbookEntries: keyword 模式命中关键词', () => {
  const wb = {
    injectMode: 'keyword',
    entries: [
      { id: '1', name: '角色A', keywords: ['张三', 'zhangsan'], content: '张三的设定', enabled: true },
      { id: '2', name: '角色B', keywords: ['李四'], content: '李四的设定', enabled: true },
    ]
  }
  const hits = matchWorldbookEntries(wb, '今天张三去了公园')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, '1')
})

test('matchWorldbookEntries: 关键词不区分大小写', () => {
  const wb = {
    injectMode: 'keyword',
    entries: [
      { id: '1', name: '测试', keywords: ['Hello'], content: '内容', enabled: true },
    ]
  }
  const hits = matchWorldbookEntries(wb, '你好 hello world')
  assert.equal(hits.length, 1)
})

test('matchWorldbookEntries: 未命中关键词不注入', () => {
  const wb = {
    injectMode: 'keyword',
    entries: [
      { id: '1', name: '测试', keywords: ['不存在的词'], content: '内容', enabled: true },
    ]
  }
  const hits = matchWorldbookEntries(wb, '这是一段普通对话')
  assert.equal(hits.length, 0)
})

test('matchWorldbookEntries: 禁用的条目不注入', () => {
  const wb = {
    injectMode: 'keyword',
    entries: [
      { id: '1', name: '测试', keywords: ['张三'], content: '内容', enabled: false },
    ]
  }
  const hits = matchWorldbookEntries(wb, '张三来了')
  assert.equal(hits.length, 0)
})

test('matchWorldbookEntries: full 模式注入所有启用条目', () => {
  const wb = {
    injectMode: 'full',
    entries: [
      { id: '1', name: 'A', keywords: ['a'], content: 'A内容', enabled: true },
      { id: '2', name: 'B', keywords: ['b'], content: 'B内容', enabled: true },
      { id: '3', name: 'C', keywords: ['c'], content: 'C内容', enabled: false },
    ]
  }
  const hits = matchWorldbookEntries(wb, '任意文本')
  assert.equal(hits.length, 2)
})

test('matchWorldbookEntries: keyword 模式下无关键词的条目不注入', () => {
  const wb = {
    injectMode: 'keyword',
    entries: [
      { id: '1', name: '无关键词', keywords: [], content: '内容', enabled: true },
    ]
  }
  const hits = matchWorldbookEntries(wb, '任意文本')
  assert.equal(hits.length, 0)
})

test('matchWorldbookEntries: 空世界书返回空', () => {
  const wb = { injectMode: 'keyword', entries: [] }
  const hits = matchWorldbookEntries(wb, '文本')
  assert.equal(hits.length, 0)
})

// ── buildWorldbookText ─────────────────────────────────
test('buildWorldbookText: 空条目返回空字符串', () => {
  assert.equal(buildWorldbookText([]), '')
})

test('buildWorldbookText: 正确构建注入文本', () => {
  const entries = [
    { name: '角色A', keywords: ['a'], content: 'A的设定内容' },
  ]
  const text = buildWorldbookText(entries)
  assert.ok(text.includes('【世界书 — 关键词触发条目】'))
  assert.ok(text.includes('角色A'))
  assert.ok(text.includes('触发词：a'))
  assert.ok(text.includes('A的设定内容'))
})

test('buildWorldbookText: 多个条目都包含', () => {
  const entries = [
    { name: 'A', keywords: ['a'], content: 'A内容' },
    { name: 'B', keywords: ['b'], content: 'B内容' },
  ]
  const text = buildWorldbookText(entries)
  assert.ok(text.includes('A内容'))
  assert.ok(text.includes('B内容'))
})

// ── extractCardText ────────────────────────────────────
test('extractCardText: 从 yml 提取 text 字段', () => {
  const yml = `
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |-
      这是角色卡内容
      第二行
`
  const text = extractCardText(yml)
  assert.ok(text.includes('这是角色卡内容'))
  assert.ok(text.includes('第二行'))
})

test('extractCardText: 非字符串返回空', () => {
  assert.equal(extractCardText(null), '')
  assert.equal(extractCardText(123), '')
})

test('extractCardText: 无 text 字段返回空', () => {
  const yml = `- id: persona\n  name: test\n`
  assert.equal(extractCardText(yml), '')
})

test('extractCardText: 超长内容截断', () => {
  const longContent = 'a'.repeat(50000)
  const yml = `- id: persona\n  config:\n    text: |-\n      ${longContent}\n`
  const text = extractCardText(yml)
  assert.ok(text.length <= 40000 + 50) // CARD_MAX + 提示文字
  assert.ok(text.includes('已截断'))
})

// ── contentToText ──────────────────────────────────────
test('contentToText: 提取文本内容', () => {
  const content = [{ type: 'text', text: '你好世界' }]
  assert.equal(contentToText(content), '你好世界')
})

test('contentToText: 非数组返回空', () => {
  assert.equal(contentToText(null), '')
  assert.equal(contentToText('字符串'), '')
})

test('contentToText: 多段文本拼接', () => {
  const content = [
    { type: 'text', text: '第一段' },
    { type: 'text', text: '第二段' },
  ]
  const text = contentToText(content)
  assert.ok(text.includes('第一段'))
  assert.ok(text.includes('第二段'))
})

console.log('\n✅ 所有测试通过！')
