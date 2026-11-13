# dsh-agent-man 约定

## 目标

给 DSH 提供跨会话的持久层，不是 DSH 的平行实现。

## 硬约束

- 默认零依赖、Node ≥ 20、ESM（`.mjs`）、无构建/TS；要加依赖先在 `docs/decisions.md` 说明。
- LF、UTF-8 无 BOM。
- 一改一提交一 push；提交信息中文。
- 新决定写 `docs/decisions.md`，三段：决定 / 来由 / 代价。
- `node --test` 必须全绿，用例只增不减。
- 先证明比 DSH 自带能力多出什么，再加功能。

## 边界

- 不常驻、不轮询、不监听；由宿主叫醒。
- 数据是平文件，换宿主还能读。
