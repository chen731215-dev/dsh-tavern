# dsh-tavern 项目规范（给 AI 助手看）

> 本文件是给 AI 编程助手（Doubao、Cursor、Copilot 等）看的项目规范。
> 修改代码前请先读完本文件，确保符合项目规范。

## 项目概述

dsh-tavern 是 DeepSeek Harness（DSH）的酒馆管理插件，提供角色扮演、角色卡/世界书/预设管理、多会话隔离、记忆总结、关系网、剧情选项等功能。

- **包名**：`@local/dsh-tavern`
- **版本**：1.7.1
- **模块系统**：ES Modules（`import`/`export`，不用 `require`）
- **入口文件**：`lib/index.js`
- **客户端入口**：`lib/client.manager.bundle.js`

## 项目结构

```
dsh-tavern/
├── lib/
│   ├── index.js              # 服务端入口（全部逻辑自包含：启动、API 路由、注入、记忆/关系网）
│   ├── utils.js              # 纯函数工具（供单元测试使用）
│   └── client.manager.bundle.js  # 客户端代码（Web 面板，平台注入）
├── tests/
│   └── core.test.js          # 单元测试（npm test）
├── .github/
│   └── ISSUE_TEMPLATE/       # Issue 模板
│   └── workflows/check.yml   # CI：语法检查（npm run check / check:client）
├── README.md
├── CHANGELOG.md
├── TUTORIAL.md
├── CONTRIBUTING.md
├── AGENTS.md                 # 项目规范（给 AI 助手）
├── LICENSE
└── package.json
```

## 模块依赖关系（服务端自包含，无循环依赖）

```
index.js ──→ (仅 Node 内置模块：fs/os/path/http/https/node:zlib)
client.manager.bundle.js ──→ (经 HTTP API 与 index.js 通信)
tests/core.test.js ──→ lib/index.js（_test 导出） + lib/utils.js
```

> ⚠️ 注意：服务端逻辑全部集中在 `lib/index.js`（自包含设计）。
> 修改服务端功能时直接改 `lib/index.js`，不要新建拆分子模块文件。
> 纯函数如需单测，可加入 `lib/index.js` 末尾的 `_test` 导出。

## 代码规范

### 1. 模块系统
- 全部使用 ES Modules：`import` / `export`
- 禁止使用 `require()` / `module.exports`
- 导入路径使用相对路径：`./utils.js`

### 2. 命名规范
- 函数名：小驼峰 `camelCase`（如 `readPresetFiles`）
- 常量：大写下划线 `UPPER_SNAKE_CASE`（如 `DEFAULT_PRESET_ID`）
- 变量：小驼峰 `camelCase`
- 文件名：小写下划线或短横线（如 `preset-manager.js`）

### 3. 函数设计
- 优先使用纯函数（输入确定输出，无副作用）
- 有副作用的函数（写文件、改状态）要明确命名
- 每个函数只做一件事，超过50行考虑拆分

### 4. 错误处理
- 文件操作必须 `try/catch`
- Promise 必须有 `.catch()`
- 禁止在 Promise 回调中 `throw`（会导致进程崩溃）
- 错误信息要清晰，包含上下文

### 5. 注释规范
- 复杂逻辑必须加注释
- 模块顶部加 JSDoc 说明用途
- 公共导出函数加 JSDoc 参数说明

## 测试与验证

### 1. 语法检查（必须）

修改任何 `.js` 文件后，必须用 DSH 自带的 Node.js 检查语法：

```bash
# Windows PowerShell
& "$env:LOCALAPPDATA\Programs\Deepseek Harness EAC v2.0\resources\node\node.exe" --check lib/xxx.js
```

**所有模块都要检查**，不能只检查修改的那个。

### 2. 重启验证（必须）

语法检查通过后，必须重启 DSH 验证：

```bash
# 1. 杀掉进程
taskkill /F /IM "Deepseek Harness EAC.exe"

# 2. 等待3秒
Start-Sleep -Seconds 3

# 3. 启动
Start-Process "$env:LOCALAPPDATA\Programs\Deepseek Harness EAC v2.0\Deepseek Harness EAC.exe"

# 4. 等待12秒后检查进程是否存在
Start-Sleep -Seconds 12
Get-Process -Name "Deepseek Harness EAC"
```

**进程存在才算通过**，如果进程退出说明有运行时错误。

### 3. 功能验证

重启后手动验证：
- 酒馆面板能正常打开
- 预设列表能正常显示
- 切换预设角色卡不串台
- 记忆和关系网能正常注入

## 提交规范

### 提交信息格式

```
<type>: <简短描述>

<详细描述（可选）>
```

### type 类型

| type | 说明 | 例子 |
|------|------|------|
| `feat` | 新功能 | `feat: 新增会话级预设隔离` |
| `fix` | 修复 bug | `fix: 修复预设切换后角色卡串台` |
| `refactor` | 重构（不改变功能） | `refactor: 拆分 preset-manager 模块` |
| `docs` | 文档修改 | `docs: 更新 README 安装说明` |
| `style` | 代码格式（不影响功能） | `style: 统一缩进` |
| `perf` | 性能优化 | `perf: 优化世界书匹配算法` |
| `chore` | 构建/工具/依赖 | `chore: 升级依赖版本` |

### 提交前检查清单

- [ ] 所有修改的文件语法检查通过
- [ ] DSH 重启后进程正常运行
- [ ] 核心功能手动验证通过
- [ ] 没有引入循环依赖
- [ ] 提交信息符合规范

## 重要注意事项

### 1. 不要修改的文件

- `lib/client.manager.bundle.js` — 客户端打包文件，修改源码后需要重新打包
- `package.json` 的 `exports` 字段 — 必须是对象形式 `{ "default": "..." }`，不能是字符串
- `LICENSE` — 许可证文件

### 2. 数据存储路径

- 预设根目录：`~/.dsh/.agent-presets/`
- 会话级存储：`~/.dsh/.agent-presets/sessions\<sessionId>\`
- 全局异常日志：`~/.dsh/.agent-presets/unhandled-error.log`

### 3. DSH 插件加载机制

- DSH 使用 cordis 框架，插件通过 `apply(ctx)` 函数注册
- 系统提示通过 `ctx.systemPrompt.section()` 注册
- HTTP 路由通过 `ctx.webServer.register()` 注册
- 生命周期管理通过 `ctx.effect()` 注册

### 4. 常见坑

- **Promise 中 throw 会导致进程崩溃**：必须用 `.catch()` 或返回错误响应
- **exports 字段用字符串会报 "Cannot find package"**：必须用对象形式
- **角色卡含 `{{user}}` 会报 "unknown prompt variable"**：需要转义为 `\{\{user\}\}`
- **删除预设后要清理会话绑定**：否则会指向不存在的预设

## 新增功能流程

1. **先写需求**：在 GitHub 开 issue 或写 spec 文档，明确要做什么
2. **再写代码**：按模块划分，新功能优先放新模块，不要全堆到 index.js
3. **语法检查**：所有修改的文件都要检查
4. **重启验证**：DSH 重启后进程正常、功能正常
5. **提交代码**：按提交规范写 commit message
6. **更新文档**：README、CHANGELOG 同步更新

---

**最后更新**：2026-08-21
**维护者**：chen731215-dev
