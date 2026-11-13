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

## 2. 第一版只做首条消息的字面回忆，不做全文搜索

**决定**

- 触发条件：只对 root agent 生效，要求 `parentSession === null`、`origin !== 'subagent'`、`delegationDepth === 0`、`isSeeded !== true`；在 `agent/pre-step` 中要求 `step === 1`，当前 `messages` 至少有一条 user 文本，且 `agent.session.snapshotEvents()` 里还没有 `user/message`。每个会话只尝试一次；没有 user 文本时不标记，等真正第一条用户消息再判断。
- 候选范围：用 `ctx.sessionQuery.filterSessions([{ kind: 'cwd', values: [cwd] }, { kind: 'parent', values: [null] }, { kind: 'availability', values: ['live', 'persisted'] }])`；排除当前会话；按 `createdAt` 新到旧；最多检查 12 个候选。
- 特征词：从当前用户消息的文本中提取最多 4 个字面特征词；优先代码标识符、路径、URL、英文词（至少 3 个字符）和较长的中文连续片段（至少 3 个字符）；去重；没有特征词就不注入。
- 命中方式：对每个候选调用 `filterEvents(sessionId, [{ kind: 'type', values: ['user/message', 'assistant/message'] }, { kind: 'text', text: needle }])`；单会话读取失败就跳过，不影响其他候选。不得调用 `searchSessions` / `searchEvents`：本 profile 的 `session-query-sqlite` 是 `openAt: never`，调用会抛 `SESSION_QUERY_SEARCH_DISABLED`。
- 取文本：每个有命中的会话取最后一条命中的 assistant 文本；没有 assistant 命中就取最后一条命中的 user 文本；单条截到 512 UTF-8 bytes，截断时保留完整 Unicode 码点。
- 注入内容：最多 3 条，总文本不超过 1536 UTF-8 bytes；合并成一条 `user/message`，放在当前步 `decision.messages` 的最前面；正文首行说明“来自旧会话的字面命中，不是当前会话内容”；每条附 `sessionId#seq`；`source` 为 `{ kind: 'dsh-agent-man', version: 1, items: [...] }`。
- 失败行为：无命中、没有特征词、`signal` 已中止、候选全部读取失败时，不改 `decision`，原样返回；单个候选失败只跳过该候选。
- 明确不做：不新增 session event 类型；不写第二份存储；不注册工具、命令或设置页；不做 FTS、向量或 LLM 摘要；不扫描全部历史；不跨 workspace 回忆。

**来由**

- 已确认 `agent/pre-step` 改 `decision.messages` 会被 loop append 成 `user/message`，能从 session log 重建；`agent.inject()` 只进下一步，不能用于当前步。
- 已确认 `ctx.sessionQuery` 的精确读可用，但 `searchSessions` / `searchEvents` 在当前 profile 被 `openAt: never` 关掉，不能把“全文搜索”当基础能力。
- 实测同 workspace 的 28 个 root 会话：只按最近会话取，会取到无关会话；字面词 `agent-man` 才能命中相关会话。因此第一版必须先提关键词，不能只按时间。
- 这是最小的可证伪能力：不引入第二份真源，不改变 DSH 的 event 模型；效果不好时可以删掉监听器，不留下迁移负担。

**代价**

- 只做字面命中，不是语义回忆；用户换一种说法、或消息里没有可提取的特征词时，不会回忆。
- `filterEvents` 每次加载整条 session log，且没有 `signal` 参数；12 个候选的上限只能控制启动数量，不能真正取消一次已经开始的读取，最坏情况会拖慢首条消息。
- 注入的是一条 user-role 消息，会永久进入 session log 并占用首步上下文；模型会看到它，UI 也可能把它显示成用户消息。
- 只覆盖同 cwd、root、非 seeded 的会话；子代理、fork、其他 workspace 都不在范围内。
- 这不是完整记忆系统：不主动记新事实，不提供 `remember` / `recall` 工具，不做摘要和去重之外的排序。
