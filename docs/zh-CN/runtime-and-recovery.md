# 运行、循环与恢复

## 优先使用无状态 Evaluation

如果工作流可以从真实系统重算，应优先提供 Provider Facts：

```bash
agent-graph evaluate build \
  --manifest provider.yaml \
  --facts @observed-facts.json \
  --format json
```

Artifact digest、Source revision、测试 Receipt 或已部署版本等事实可以跨进程重启存在，并能使旧结果失效。Agent 会话中的文字陈述不是观测事实。

仅当需要执行历史、长任务检查点、无法从外部观测的显式 Outcome 或重复迭代时使用 Run。Run Start、Checkpoint 与 Resume 都拒绝覆盖已有目标路径；应选择新路径，或显式删除已废弃文件。

## Run 生命周期

```bash
agent-graph run start monitor \
  --manifest provider.yaml \
  --state .runtime/monitor.json \
  --workspace .

agent-graph run status --manifest provider.yaml --state .runtime/monitor.json
agent-graph route monitor --manifest provider.yaml --state .runtime/monitor.json --format json
```

Action 完成后，使用 `afterAction.recordNode` 返回的精确键：

```bash
agent-graph run record monitor/poll partial --state .runtime/monitor.json
agent-graph run status --manifest provider.yaml --state .runtime/monitor.json
```

Event 采用追加式记录；Outcome 只保留每个状态键的最新值。因此当前状态保持紧凑，同时仍能审计每次迭代。

## Repeat 循环

```yaml
nodes:
  - id: poll
    kind: action
    action: actions/poll.yaml
  - id: done
    kind: terminal
    terminalOutcome: completed
edges:
  - from: poll
    to: poll
    kind: repeat
    outcomes: [partial]
  - from: poll
    to: done
    outcomes: [completed]
```

记录 `partial` 会重新激活 `poll`；记录 `completed` 才到达终点。Repeat Edge 的目标必须是 Action 或 Gate。CLI 本身不会忙等、Sleep 或自动运行循环；Agent 或产品宿主决定何时执行每条 Route，也可以按自己的时间或预算策略停止。

模型重试、进程重试和工作流 Outcome 是不同层级。传输重试耗尽时不能记录 `completed`；通常应记录 `failed` 或 `unverified` 并进入恢复。

## 部分失败与恢复

使用显式 Outcome 和 Edge：

```yaml
edges:
  - from: verify
    to: done
    outcomes: [completed]
  - from: verify
    to: repair
    outcomes: [failed, unverified]
```

部分必需工作成功、部分失败时使用 `partial`。Counts 或详细 Receipt 可以写入 Run Event Detail 或 Provider Fact；Route 逻辑仍使用显式 Outcome 和 Fact Check。禁止过滤失败项后把剩余结果报告成完整成功。

必须由外部证据证明的结果应配置 `satisfiedBy`。缺失证明的已记录成功会变成 `unverified`，从而在崩溃或交接后确定性进入恢复。

## Checkpoint 与 Resume

```bash
agent-graph run checkpoint \
  --state .runtime/monitor.json \
  --to .runtime/checkpoints/before-handoff.json

agent-graph run resume .runtime/checkpoints/before-handoff.json \
  --state .runtime/resumed.json
```

创建 Checkpoint 时会移除会话 Authority。Resume 保留 Facts、Outcomes 和 Events，防御性地再次清空 Authority，然后用当前 Provider 定义重新评估。Authority 必须重新显式授予，避免 Checkpoint 变成永久无人值守配置。

暂停期间 Provider Facts 也可能变化；宿主应在 Evaluation 前刷新。Checkpoint 是执行记忆，不是不可变事实锚点。

## 会话 Authority

可只为一次 Evaluation 提供 Authority：

```bash
agent-graph route release \
  --manifest provider.yaml \
  --state .runtime/release.json \
  --authority release.approve
```

宿主也可在其定义的当前会话期间写入 Run：

```bash
agent-graph run authority --state .runtime/release.json --set release.approve
```

当用户明确的全托管会话结束时，宿主负责清除 Authority；`run resume` 会自动清除。Authority 只能解析 `delegatable` Gate，不能绕过 Fact Check、Schema、验证或不可委托 Gate。

## 存储所有权

CLI 接受精确路径，因此宿主可选择：

- 产品已有运行目录；
- 工作区内被忽略的目录；
- 持久任务 Store；
- 短任务临时位置。

Provider Bundle 是只读内容。Run 与 Checkpoint 只有在宿主选择持久位置时才持久；Materialized Resource 属于可删除并重建的 Cache。

完整示例见 [`examples/monitoring-loop`](../../examples/monitoring-loop)、[`examples/recovery`](../../examples/recovery) 和 [`examples/facts-recovery`](../../examples/facts-recovery)。
