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

`priority` 用于多个路线同时可用时排序。`join: all` 要求所有入边满足，`join: any` 接受任一匹配入边。

## Outcome 与 Edge

Edge 根据显式 Outcome 匹配；省略 `outcomes` 等价于 `[completed]`。

```yaml
- from: verify
  to: recover
  outcomes: [failed, unverified]
```

普通 `flow` 边推进工作流。同一转移还需要可检查的因果标记时，使用 `consumes`、`requires` 或 `gatedBy`。这些标记不能替代 Fact Check；`gatedBy` 必须从 Gate 开始。

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

## Gate 与全托管会话

```yaml
kind: gate
gate:
  id: result-review
  prompt: Review the prepared result.
  authority: review
  delegatable: true
```

没有 `review` Authority 时，Route 要求用户参与；当前 Evaluation 或 Run 携带该 Authority 时，Route 立即可执行，并标记由 `session-authority` 解析。Authority 属于宿主选择的会话状态，不会写回 Provider，也不能证明下游事实。

## Resource

长说明放在带 Frontmatter 的 Markdown Resource 中：

```yaml
---
id: procedure.prepare
kind: procedure
media-type: text/markdown
---
```

只在真正需要它的 Node 上声明 Resource。Required Resource 必须在 Action 前读取；Recommended Resource 可以按需读取。常规 CLI Envelope 只返回路径和摘要，不返回正文。

JSON Schema、原生 Template 或其他非 Markdown 文件通过描述文件引用内容：

```yaml
schema: agent-graph.resource.v1
id: schema.draft-output
kind: schema
mediaType: application/schema+json
path: schemas/draft-output.schema.json
```

Route 返回原生目标文件，同时 Provider 仍拥有类型化的 Resource 身份。

动态 Context View 使用 YAML/JSON 描述，其 Materializer 必须指向只读 Command 或 Script Action。只有显式运行 Materialize 命令才会执行，并写入宿主指定 Cache。

## Subgraph

Subgraph 用于一个 Provider 内的控制组合。父 Graph 声明子 Graph 和 Entry，子 Route 带调用路径返回，Terminal Outcome 再流回父图。静态和运行时递归检查会阻止子图调用祖先。v0.1 有意不支持跨 Provider Subgraph。
