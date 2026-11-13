# dsh-agent-man 约定

## 目标

给 DSH 补上它没有的那一层：跨会话的持久记忆与连续性。

这是 DSH 插件，不是第二个 agent 运行时；不复制 `agent-man` 的 CLI、命令表和独立 JSONL 存储。先证明比 DSH 自带能力多出什么，再加功能。

## 硬约束

- 零依赖、Node ≥ 20、ESM（`.mjs`）、无构建/TS；要加依赖先在 `docs/decisions.md` 说明。
- LF、UTF-8 无 BOM。
- 一改一提交一 push；提交信息中文。
- 新决定写 `docs/decisions.md`，三段：决定 / 来由 / 代价。
- `node --test` 必须全绿，用例只增不减。
- 新能力先有证伪测试；证伪不了就不写。

## DSH 边界

- **session log 是唯一真源**。模型看到的东西必须能从已提交的 session events 重建；插件内存和缓存只是派生。
- 不新增 session event 类型；不用 `appendPluginRecord()` 存业务记忆。
- 优先用 DSH 的缝：`ctx.sessionProjections`、`agent/pre-step` / `agent.inject()`、`ctx.tools.register()`、`ctx.storageDomain`。不要自己造调度器、压缩器、笔记系统。
- 不常驻、不轮询、不监听外部；由 DSH 的 agent 生命周期和 scheduler 叫醒。
- 不拥有第二份真源。数据留在 DSH 的平文件 JSONL 里，不建不透明二进制库；缓存必须能从 log 重建。
- 默认只对 root agent 生效；子代理不共享记忆，除非有决定记录。
- 一个能力先做成一个缝；不要先铺命令表。

## 目录

- `AGENTS.md`：本文件，约束。
- `docs/decisions.md`：决定记录。
- 代码和测试在仓库根下按 DSH bundle 组织。
