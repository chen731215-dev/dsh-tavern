# dsh-tavern · DSh 酒馆插件

DeepSeek Harness 的**原生酒馆管理面板**。侧边栏多一个「🍺 酒馆管理」入口，不用 iframe、随 DSH 深浅色换肤，点别的工作区自动关闭。

支持：**多角色卡**（PNG/JSON，含内嵌"角色世界书"联动导入）、**多世界书**（可折叠、每条目独立开关）、**多预设**（可切换、每模块独立开关），一键合并生成 `agent.cordis.yml` 保存到 Harness。

## 安装（二选一）

```sh
# 从 npm（推荐，免 build 授权）
dsh plugin --profile web add dsh-tavern

# 或从 GitHub Release 安装包
dsh plugin --profile web add https://github.com/chen731215-dev/dsh-tavern/releases/download/v1.1.0/dsh-tavern-1.1.0.tgz
```

装完**重启 dsh web**。

## 如何使用

1. 侧边栏点击 **「🍺 酒馆管理」** 打开面板。
2. **导入角色卡**：点「角色卡」的文件选择，选 PNG 或 JSON 角色卡（可多份，角色卡自带的"角色世界书"会自动一起导入）。
3. **导入世界书 / 预设**：同理可各导入多份。
4. **勾选启用**：在世界书里勾选要启用的条目；在预设里点「切换到此预设」并勾选要用的模块。
5. 点 **「💾 保存到 Harness」**，面板会把「启用中的角色 + 启用中的世界书条目 + 当前预设的模块」合并成 `agent.cordis.yml` 写入 `~/.dsh/.agent-presets/tavern-lite/`。
6. 回到 Harness，在模型/预设里选用这个预设即可开始角色扮演。

> 深色/浅色会自动跟随；点侧边栏其它工作区会收起酒馆面板。

## License

MIT