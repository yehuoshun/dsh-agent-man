# dsh-agent-man

DSH 的跨会话记忆插件。第一版能力：新会话的第一条用户消息进来时，从同 workspace 的旧 root 会话里找字面命中，注入一条带来源的回忆消息。已在 desktop profile 实测。

## 现在有什么

| 文件 | 作用 |
|---|---|
| `package.json` | DSH bundle 清单：`dsh.bundle.patch`、宿主入口、locale/icon 导出。 |
| `cordis.patch.yml` | 把 `dsh-agent-man` 自己插入当前 profile。 |
| `index.mjs` | Host 插件入口：在 `agent/created` 里监听 `agent/pre-step`，首步注入回忆。 |
| `src/recall.mjs` | 特征词提取、UTF-8 截断、正文/来源格式、候选读取与去重。 |
| `locale/en.json`、`locale/zh.json` | 插件管理器显示的标题和说明。 |
| `icon.svg` | 本地图标，不引用外部资源。 |
| `test/plugin.test.mjs` | 锁住清单、patch、入口、locale、icon 和 LF/UTF-8。 |
| `test/recall.test.mjs` | 锁住触发边界、候选过滤、命中选择、截断、去重和失败降级。 |
| `docs/decisions.md` | 决定记录；第一版合同在 §2。 |

## 第一版边界

- 只对 root、非 seeded、`step === 1`、且 session log 里还没有 `user/message` 的会话生效。
- 只查同 `cwd`、`parent: [null]` 的旧会话，最多 12 个候选；排除当前会话。
- 只做字面命中：从当前用户消息提最多 4 个特征词，用 `ctx.sessionQuery.filterEvents()` 扫描；不调用全文搜索。
- 每个会话取最后一条命中的 assistant 文本，没有就取最后一条 user 文本。
- 最多 3 条，单条 512 UTF-8 bytes，总片段 1536 UTF-8 bytes；合并成一条带 `sessionId#seq` 和 `source.kind = 'dsh-agent-man'` 的 user 消息，放在当前步最前。
- 无命中、无特征词、中止或候选全部失败时不改 decision。

## 不是什么

- 不注册工具、命令、设置页，不铺命令表。
- 不建第二份存储，不新增 session event 类型。
- 不做 FTS、向量或 LLM 摘要，不扫描全部历史，不跨 workspace。
- 不覆盖子代理、fork 或 seeded 会话。

`filterEvents()` 每次会加载整条 session log，且没有 `signal` 参数；12 个候选只能限制启动数量，不能取消已经开始的读取。这是第一版已知代价。

## 实测

2026-11-13 在 desktop profile 新开 root 会话，第一句发 `agent-man 到哪一步了`。首步开始前，session log 里出现一条注入的 `user/message`，带 3 条 `sessionId#seq` 来源；模型回答里明确引用了这条回忆。

headless profile 也跑通了 `agent/created` → `agent/pre-step` 和 `sessionQuery` 读取；headless 没有模型 key，所以只验证到查询和注入 decision 层，没有完成模型回合。

## 跑测试

```powershell
node --test
```

## 安装

用 DSH 的 `plugin_manager`，`action: install_bundle`，`target` 指向本目录的绝对路径。已在 desktop profile 安装并验证；headless 的测试安装已移除。
