# dsh-agent-man

DSH 的跨会话记忆插件。当前是骨架：按 bundle 形状搭好，但还没装进 profile 验证，也没有记忆行为。

## 现在有什么

| 文件 | 作用 |
|---|---|
| `package.json` | DSH bundle 清单：`dsh.bundle.patch`、宿主入口、locale/icon 导出。 |
| `cordis.patch.yml` | 把 `dsh-agent-man` 自己插入当前 profile。 |
| `index.mjs` | Host 插件入口，导出 `apply(ctx, config)`；当前为空实现。 |
| `locale/en.json`、`locale/zh.json` | 插件管理器显示的标题和说明。 |
| `icon.svg` | 本地图标，不引用外部资源。 |
| `test/plugin.test.mjs` | 锁住清单、patch、入口、locale、icon 和 LF/UTF-8。 |
| `docs/decisions.md` | 决定记录。 |

## 不是什么

- 不读 session log。
- 不注册工具，不铺命令表。
- 不建第二份存储。
- 不注册监听器、定时器或后台循环。

第一个能力还没选；跨会话回忆只是待验证提议，不是既成设计。

## 跑测试

```powershell
node --test
```

## 安装

用 DSH 的 `plugin_manager`，`action: install_bundle`，`target` 指向本目录的绝对路径。当前没有装进任何 profile。
