# 决定记录

## 1. 新开 dsh-agent-man，静置 agent-man

**决定**：`agent-man` 停在 0.4.0，不再加功能；新项目 `dsh-agent-man` 只做 DSH 的持久记忆层。

**来由**：`agent-man` 的命令表和 DSH 的能力一一对应（log/会话记录、remember/ctx_notes、digest/压缩、cue/定时任务、timeline/ctx_history）。唯一的结构差异是「数据在模型进程外」，但宿主固定为 DSH 时，这条差异没有产生可感的价值。继续加零件只会加深平行实现。

**代价**：`agent-man` 已有的零件和 148 条测试不直接搬过来；`wake` / `settle` 也要重新证明必要性，可能发现连它们也不需要。
