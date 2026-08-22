# 贡献指南

感谢你对 dsh-tavern 的兴趣！本文档说明如何参与贡献。

## 开始之前

### 环境要求

- Node.js >= 18（推荐使用 DSH 自带的 Node.js v24）
- DeepSeek Harness EAC v2.0
- Git

### 本地开发

1. Fork 本仓库
2. 克隆到本地：
   ```bash
   git clone https://github.com/你的用户名/dsh-tavern.git
   cd dsh-tavern
   ```
3. 安装到 DSH：
   - 将项目目录软链接或复制到 DSH 插件目录
   - 或在 DSH 插件市场中添加本地插件路径

## 贡献流程

### 1. 开 Issue

在开始写代码之前，请先在 [GitHub Issues](https://github.com/chen731215-dev/dsh-tavern/issues) 中开一个 issue，说明：

- **Bug 报告**：问题是什么、怎么复现、期望结果是什么
- **功能需求**：要做什么、为什么需要、大概怎么实现

这样可以避免重复工作，也方便讨论方案。

### 2. 创建分支

从 `main` 分支创建新分支：

```bash
git checkout -b feat/你的功能名
# 或
git checkout -b fix/你修复的bug
```

分支命名规范：
- `feat/xxx` — 新功能
- `fix/xxx` — 修复 bug
- `refactor/xxx` — 重构
- `docs/xxx` — 文档

### 3. 写代码

#### 代码规范

请阅读 [AGENTS.md](./AGENTS.md) 了解完整的代码规范。要点：

- 使用 ES Modules（`import`/`export`）
- 函数名小驼峰，常量大写下划线
- 每个函数只做一件事
- 文件操作必须 `try/catch`
- Promise 必须有 `.catch()`

#### 模块划分

服务端逻辑全部集中在 `lib/index.js`（自包含设计）。文件结构：

| 文件 | 职责 |
|------|------|
| `lib/index.js` | 服务端入口：启动、API 路由、系统提示注入、记忆/关系网（自包含） |
| `lib/utils.js` | 纯函数工具（供单元测试） |
| `lib/client.manager.bundle.js` | 客户端 Web 面板 |

**新增纯函数**：可直接加入 `lib/index.js`，如需单测同时加入末尾 `_test` 导出；不要新建拆分子模块文件。

### 4. 测试验证

#### 语法检查（必须）

修改任何 `.js` 文件后，用 DSH 自带的 Node.js 检查语法：

```bash
& "$env:LOCALAPPDATA\Programs\Deepseek Harness EAC v2.0\resources\node\node.exe" --check lib/xxx.js
```

**所有模块都要检查**。

#### 重启验证（必须）

语法检查通过后，重启 DSH 验证：

```bash
taskkill /F /IM "Deepseek Harness EAC.exe"
Start-Sleep -Seconds 3
Start-Process "$env:LOCALAPPDATA\Programs\Deepseek Harness EAC v2.0\Deepseek Harness EAC.exe"
Start-Sleep -Seconds 12
Get-Process -Name "Deepseek Harness EAC"
```

**进程存在才算通过**。

#### 功能验证

重启后手动验证：
- 酒馆面板能正常打开
- 修改的功能正常工作
- 没有引入新的 bug

### 5. 提交代码

#### 提交信息规范

```
<type>: <简短描述>

<详细描述（可选）>
```

type 类型：

| type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `refactor` | 重构（不改变功能） |
| `docs` | 文档修改 |
| `style` | 代码格式 |
| `perf` | 性能优化 |
| `chore` | 构建/工具/依赖 |

例子：
```
feat: 新增会话级预设隔离

- 每个会话可以绑定不同的预设
- 切换会话自动加载对应预设
- 修复预设切换后角色卡串台的问题
```

#### 提交前检查清单

- [ ] 所有修改的文件语法检查通过
- [ ] DSH 重启后进程正常运行
- [ ] 核心功能手动验证通过
- [ ] 没有引入循环依赖
- [ ] 提交信息符合规范
- [ ] CHANGELOG.md 已更新（如果是用户可见的改动）

### 6. 发起 Pull Request

1. 推送分支到你的 Fork：
   ```bash
   git push origin feat/你的功能名
   ```
2. 在 GitHub 上发起 Pull Request
3. PR 描述中说明：
   - 做了什么
   - 为什么要做
   - 怎么测试的
   - 关联的 issue 编号（如 `Closes #12`）

### 7. 代码审查

- 维护者会审查你的代码
- 可能会要求修改，请配合调整
- 审查通过后会合并到 `main` 分支

## 报告 Bug

请使用 [Bug 报告模板](https://github.com/chen731215-dev/dsh-tavern/issues/new?template=bug_report.md)，包含：

- **DSH 版本**：设置 → 关于
- **插件版本**：package.json 中的 version
- **操作系统**：Windows / macOS / Linux
- **问题描述**：清楚说明遇到了什么问题
- **复现步骤**：一步步说明怎么复现
- **期望结果**：你觉得应该是什么样的
- **截图/日志**：如果有，附上截图或日志

## 功能需求

请使用 [功能需求模板](https://github.com/chen731215-dev/dsh-tavern/issues/new?template=feature_request.md)，包含：

- **功能描述**：你想要什么功能
- **为什么需要**：解决什么问题
- **大概方案**：你觉得可以怎么实现（可选）

## 常见问题

### Q: 我可以直接提交代码不开 issue 吗？

A: 小修复（比如错别字、明显的小 bug）可以直接提交 PR。但新功能或较大的改动建议先开 issue 讨论，避免做无用功。

### Q: 测试怎么写？

A: 目前项目还没有自动化测试框架，主要靠手动测试。如果你想加自动化测试，欢迎提 PR！

### Q: 可以修改客户端代码吗？

A: `lib/client.manager.bundle.js` 是打包后的文件，修改源码后需要重新打包。如果你不熟悉打包流程，可以只改服务端代码，客户端改动请在 issue 中讨论。

## 行为准则

参与本项目即表示你同意：
- 尊重他人，友好讨论
- 不发布违法、违规、攻击性内容
- 专注于技术讨论，不进行人身攻击

违反者可能会被禁止参与。

---

如有其他问题，欢迎在 [Discussions](https://github.com/chen731215-dev/dsh-tavern/discussions) 中提问。
