# dsh-tavern · DeepSeek 酒馆

把「酒馆」嵌入 DeepSeek Harness (dsh) Web UI 的**原生管理面板插件**。侧边栏多一个 **「🍺 酒馆管理」** 入口，点开即在会话区打开一个原生面板（非 iframe），可以：

- 导入**多份角色卡**（PNG / JSON，含内嵌"角色世界书"联动导入）
- 导入**多份世界书**（每本可折叠，每条目可独立开关，显示内容预览）
- 导入**多份预设**（可相互切换，每个模块可独立开关）
- 然后一键把「启用中的角色 + 启用中的世界书条目 + 当前预设的启用模块」**合并生成** `agent.cordis.yml` 保存到 Harness 预设。

其它特性：面板跟随 DSH **深色/浅色**主题自动换肤；点侧边栏其它工作区时**自动关闭**面板。

## 安装

```sh
# 从 npm 发布后安装（也可从 GitHub 仓库 / Release 的 tgz 直接装）
dsh plugin --profile web add dsh-tavern
```

## 使用

1. 侧边栏点 **「🍺 酒馆管理」** 打开面板。
2. 导入角色卡 / 世界书 / 预设（可各导入多份）。
3. 勾选要启用的角色与世界书条目，切换到想用的预设。
4. 点 **「💾 保存到 Harness」**，生成的 `agent.cordis.yml` 会写入 `~/.dsh/.agent-presets/tavern-lite/`。
5. 回到 Harness 选用对应预设即可。

## 说明

- 管理面板是原生 DOM 面板，随 DSH 深浅色联动，风格统一。
- 当前启用的是 `client.manager.bundle.js`（原生版）；web 页面版的 `DeepSeek酒馆.html` 已不再使用。
- 本包基于用户自用的酒馆管理插件整理发布。

## License

MIT
