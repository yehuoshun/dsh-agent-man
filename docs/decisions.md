# 决定记录

## 1. 先搭 Host-only bundle 骨架，入口先空着

**决定**

- `dsh-agent-man` 先作为 DSH 的 Host-only bundle 落地：`package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml` 插入自身，`index.mjs` 导出 `apply(ctx, config)`。
- `apply` 目前不注册工具、不读 session、不建存储、不注册监听器；插件装上后没有用户可见行为。
- 同步补齐 `locale/en.json`、`locale/zh.json`、`icon.svg` 和结构测试，保证 bundle 清单、入口、显示元数据、LF/UTF-8 约束可检查。

**来由**

- DSH 插件要先能被安装和激活，才谈得上选缝。先把 bundle 形状固定下来，避免又回到 agent-man 的 CLI/命令表。
- 当前仓库只有 `AGENTS.md`；没有清单和入口，连“这是不是一个 DSH 插件”都无法验证。

**代价**

- 这一版装上后是空插件，不提供记忆能力；显示标题会出现在插件列表里，但行为为空。
- 结构测试会锁住文件名和导出形状；以后改成 Client 插件或换入口时要同步改测试。
- 空 `apply` 只是骨架，不是设计结论；第一个能力（跨会话回忆或其他缝）仍需单独做证伪测试。
