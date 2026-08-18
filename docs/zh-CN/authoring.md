# 编写 Graph

## 源码布局

目录名称只是约定，不是协议要求。所有引用都相对 Provider Manifest 所在目录解析。

```text
provider.yaml
graphs/
actions/
skills/
resources/
schemas/
tests/
```

Provider Manifest 列出 Graph 文件；Graph 引用 Action 和 Resource；Action 还可以引用 Script、Skill 以及输入输出 Schema。Loader 沿引用加载文件，并拒绝逃逸 Provider Root 的路径。

## Node

四类 Node 明确区分控制语义：

- `action`：由 Command、Script、Agent Skill 或 Host Handler 完成的工作；
- `gate`：用户决定，可选择是否允许会话权限代为处理；
- `subgraph`：调用同一 Provider 中另一张 Graph 的指定 Entry；
- `terminal`：显式 Graph 结果。

`priority` 只对同时合法的路线排序，不判断语义适配度。应使用 `requiresFacts` 或显式前置 Action，让可观察状态决定哪些选项合法。`join: all` 要求所有入边满足，`join: any` 接受任一匹配入边。

Action 和 Gate Node 必须声明以 `route.` 开头的稳定 `reasonCode`，解释为何当前 Route 可用，但不参与条件判断。Code Catalog 是可选能力；声明后，Route Reason 会成为带文档的闭集。Graph 拓扑保持静态；当前目标和其他运行参数放入 Facts，Host Action 可以解析这些 Facts，不需要为每个目标生成节点。

Skill 在使用它的 Action 阶段按需加载。Primary Agent Action 的 Skill 随当前 Route Resource 暴露；Gate Inspection 或 Resolution Agent Action 的 Skill 则保留在对应的嵌套 Action 上，直到该阶段被选中。这样不会提前加载所有可能用到的指令集。

## Outcome 与 Edge

Edge 根据显式 Outcome 匹配；省略 `outcomes` 等价于 `[completed]`。

```yaml
- from: verify
  to: recover
  outcomes: [failed, unverified]
```

普通 `flow` 边推进工作流。同一转移还需要可检查的因果标记时，使用 `consumes`、`requires` 或 `gatedBy`。这些标记不能替代 Fact Check；`gatedBy` 必须从 Gate 开始。

Edge 不携带 Artifact 或共享状态。输出应由宿主持久化，再把稳定引用、Digest 或 Receipt 作为 Facts 提供。Fan-out 与 fan-in 描述合法可达性，不会让 CLI 并发执行分支。

`repeat` 边在来源返回匹配结果时，显式重新激活 Action 或 Gate：

```yaml
- from: poll
  to: poll
  kind: repeat
  outcomes: [partial]
```

这可以表达 Agent 主导的循环，而不让 CLI 变成自动调度器：Agent 每次只完成一条路线，记录 `partial` 后重新求值，直到记录其他结果。Repeat 目标只允许 Action 或 Gate；跨 Graph 递归会被拒绝。

## 事实与历史

当 Node 的合法性依赖当前外部状态时使用 `requiresFacts`；当可观测事实能够直接证明 Node 已完成时使用 `satisfiedBy`。

```yaml
satisfiedBy:
  - path: artifact.digest
    exists: true
```

如果 Run 记录 Action 已完成，但 `satisfiedBy` 事实不存在，Evaluator 返回 `unverified`，不会把历史当作证明。Fact 应由真正能够检查系统边界的机制提供。

数字路径段用于读取数组项，例如 `artifacts.0.digest` 读取第一个已观测 Artifact 的 Digest。

### 具有生命周期的证据

Fact 可以携带产生该观测的来源身份与健康状态。这些信息应作为普通嵌套 Facts 提供，不需要据此动态创建 Graph Node：

```json
{
  "artifact": {
    "digest": "sha256:...",
    "sourceRevision": "provider-instance-2",
    "available": true,
    "fresh": true
  }
}
```

只检查当前 Action 判断证据可信度所需的字段。完整 Facts 对象参与 Evaluation Revision，因此即使 Artifact Digest 未变，`sourceRevision` 变化也会让此前解析的 Route 失效。

观测时间与可用性由宿主负责。宿主应用自己的时钟、租约或健康策略后，应发布 `fresh: false` 这类稳定语义状态。不要仅为证明“执行过轮询”而把不断变化的时间戳放进 Facts；这会在没有实质状态变化时制造新 Revision。当工作流需要不同恢复路线时，`missing`、`unavailable`、`stale` 与显式 false 观测不应被合并为同一种状态。

## 独立验证模式

当产出者不应自证结果时，使用独立的 read-effect Action。为其声明 Host Handler，要求已观测的 Artifact 引用或 Digest，并把验证 Receipt 配置到 `satisfiedBy`。只有验证声明却没有 Receipt 时，节点会变成 `unverified`，可以重复验证或进入恢复。

这是一种编写模式，不是新的 Node Kind：Provider 能声明边界，但宿主必须把 Handler 绑定到具有独立权限的只读 Verifier。`effect: read` 用于表达意图和执行策略检查，不负责隔离进程身份或文件系统。示例见 [`examples/independent-verification`](../../examples/independent-verification) 和 [`examples/facts-recovery`](../../examples/facts-recovery) 中具有生命周期的证据。

## Gate 与全托管会话

```yaml
kind: gate
reasonCode: route.review.required
gate:
  id: result-review
  prompt: Review the prepared result.
  authority: review
  delegatable: true
inspectionAction: actions/inspect-review.yaml
resolutionAction: actions/apply-review.yaml
```

没有 `review` Authority 时，Route 要求用户参与；当前 Evaluation 或 Run 携带该 Authority 时，Route 立即可执行，并标记由 `session-authority` 解析。Authority 属于宿主选择的会话状态，不会写回 Provider，也不能证明下游事实。

如果宿主需要在提问前准备报告、打开审核页面或读取决策证据，可声明只读 `inspectionAction`。它与 Gate 默认的空 `commandPlan` 分开暴露，用户确认前即可安全执行。

如果仅确认还不够，宿主还需要保存决定或应用结构化用户输入，可声明 `resolutionAction`。Gate Prompt 保持简短，输入契约通过 Action 的 `inputSchema` 提供。等待中的 Route 会单独暴露这份 Action，但用户确认前它仍是条件计划。示例见 [`examples/review-gate`](../../examples/review-gate)。

## Resource

长说明放在带 Frontmatter 的 Markdown Resource 中：

```yaml
---
id: procedure.prepare
kind: procedure
media-type: text/markdown
---
```

只在真正需要它的 Node 上声明 Resource。`readState: read-required` 的 Required Resource 必须在 Action 前读取；`current` 表示宿主确认该精确资源在当前会话中仍可供 Agent 使用。Recommended Resource 可以按需读取。常规 CLI Envelope 只返回路径和摘要，不返回正文。

资源读取收据是宿主输入，不属于 Provider 编写状态；不要把它建模为 Fact 或持久化进 Graph。静态收据匹配资源的精确 Digest，动态 Context View 收据还要匹配选择它的 Route Revision。

JSON Schema、原生 Template 或其他非 Markdown 文件通过描述文件引用内容：

```yaml
schema: agent-graph.resource.v1
id: schema.draft-output
kind: schema
mediaType: application/schema+json
path: schemas/draft-output.schema.json
```

Route 返回原生目标文件，同时 Provider 仍拥有类型化的 Resource 身份。

动态 Context View 使用 YAML/JSON 描述，其 Materializer 必须指向只读 Command 或 Script Action。只有显式运行 Materialize 命令才会执行，并写入宿主指定 Cache。参考 Runtime 提供可配置的时间和输出上限，且默认不继承任意宿主环境变量；Read Effect 仍不是沙箱。

## Subgraph

Subgraph 用于一个 Provider 内的控制组合。父 Graph 声明子 Graph 和 Entry，子 Route 带调用路径返回，Terminal Outcome 再流回父图。静态和运行时递归检查会阻止子图调用祖先。v1 有意不支持跨 Provider Subgraph。
