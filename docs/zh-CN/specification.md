# Agent Graph v1 协议规范

本文定义 `agent-graph@0.1.0` 实现的 `agent-graph.*.v1` 对象。[`schemas/`](../../schemas) 中的 JSON Schema 是文件形状的规范来源；本文定义其行为与不变量。

## 1. Provider

```yaml
schema: agent-graph.provider.v1
id: company/release
version: 0.1.0
graphs:
  - graphs/release.yaml
compatibility:
  agentGraph: ^0.1.0
  node: ">=20"
```

Provider 是独立版本、信任和发布边界。

- `id` 标识 Provider；宿主运行时使用 Provider、Graph 与 node ID 形成完全限定身份。
- `version` 使用语义化版本格式。
- `graphs` 是相对于 Provider 根目录的路径；Loader 不通过扫描目录发现 Graph。
- 所有引用必须留在 Provider 根目录内，不能使用绝对路径，也不能通过符号链接逃逸。
- 多个 Provider 默认隔离；v1 不合并 Provider，也不允许跨 Provider Subgraph。

源码 Manifest 可以使用任意文件名；构建后的 Bundle 使用 `provider.yaml` 和生成的 `manifest.json`。

## 2. Graph

```yaml
schema: agent-graph.graph.v1
id: release
entrypoints:
  default: inspect
nodes: []
edges: []
```

Graph 是确定性路线定义。`entrypoints` 将公开入口名映射到一个节点；节点 ID 在当前 Graph 内唯一。

### 2.1 节点类型

| Kind | 必填字段 | 含义 |
|---|---|---|
| `action` | `action` | 可以选择一个 Provider 相对路径的 Action |
| `gate` | `gate` | 必须由用户或会话授权解析策略边界 |
| `subgraph` | `graph`、`entry` | 进入同一 Provider 内另一张 Graph |
| `terminal` | `terminalOutcome` | 以显式 Outcome 结束当前 Frame |

通用节点字段：

- `description`：简短展示名，不参与机器判断；
- `priority`：同一可用性等级内的确定性路线排序；
- `join`：`all` 要求所有入边匹配，`any` 只要求一条；
- `requiresFacts`：全部满足后节点才合法；
- `satisfiedBy`：无需重放即可证明 Action 或 Gate 完成的可观察事实；
- `resources.required` 与 `resources.recommended`：随 Action 或 Gate 选择的 Provider 相对资源引用。

Runner/Node 判别字段互斥。Subgraph 与 Terminal 不能静默携带其执行路径会忽略的 Action/Gate Resource 或 Satisfaction 规则。

### 2.2 事实检查

事实检查使用受限数据模型，不执行表达式：

```yaml
satisfiedBy:
  - path: artifact.digest
    exists: true
  - path: verification.state
    equals: passed
```

`path` 是点分字段查找；每项只能使用 `exists` 或 `equals` 之一，比较值只能是 JSON 标量。协议不执行 JavaScript、模板、Shell 或自由条件 DSL。

Action 配置 `satisfiedBy` 后：

- 事实匹配会直接得到 `completed`，无需 Run 结果；
- 已记录 `completed` 但事实不匹配时得到 `unverified`；
- 可通过显式 `unverified` 边进入恢复；
- 会话中声称“已完成”不会自动产生事实。

Provider 集成负责观测和提供可信事实。通用 Run facts 是宿主管理的输入，不自动等同于外部证据。

### 2.3 门禁与授权

```yaml
kind: gate
gate:
  id: release-approval
  prompt: Approve this release?
  authority: release.approve
  delegatable: true
```

没有匹配授权时，Route 状态为 `waiting-user`，且不包含可执行命令。只有 `delegatable` 为 true 且当前 Evaluation 显式提供对应 authority 时，门禁才变为 actionable，并标记 `resolution: session-authority`。

Authority 属于当前输入或 Run。Provider 定义不能永久开启全托管或无人值守；授权也不能满足事实或绕过校验。

### 2.4 边

```yaml
- from: inspect
  to: approval
  kind: flow
  outcomes: [completed]
```

每条边都定义显式 Outcome 转移；省略 `outcomes` 时默认为 `completed`。

| Kind | 语义 |
|---|---|
| `flow` | 通用控制转移 |
| `consumes` | 目标消费来源产生的制品 |
| `requires` | 来源是目标的合法性前置条件 |
| `gatedBy` | 来源 Gate 解析目标的策略边界 |
| `repeat` | 匹配结果重新激活一个 Action 或 Gate |

所有非 Repeat Kind 都通过显式 Outcome 决定可达性；Kind 为检查、测试和宿主策略保留因果含义，但不会凭空产生制品新鲜度或外部证明，这些约束必须使用 `requiresFacts` 与 `satisfiedBy` 建模。`gatedBy` Edge 必须从 Gate 开始。

非 Repeat 图必须无环，循环必须显式声明，不能由普通流转意外形成。`repeat` 目标只能是 Action 或 Gate，并会把目标重新置为 pending 以进入下一次迭代。Run 事件保留历史迭代，但节点当前 Outcome 会被后续记录替换。

多条替代成功路径汇聚到一个节点时使用 `join: any`；默认 `all` 适用于所有前驱都必须成功的 fan-in。

### 2.5 Subgraph

Subgraph 只能静态解析到同一 Provider。子路线保持子 Graph/node 身份和父调用路径；完整的子 Outcome 会返回给父 Graph，未完成状态不会被折叠。静态或运行时递归调用祖先 Graph 都会被拒绝。

v1 不支持跨 Provider Subgraph、隐式 Graph Import 或 Graph 合并。

## 3. Action

```yaml
schema: agent-graph.action.v1
id: inspect-package
runner: command
effect: read
command: npm pack --dry-run
cwd: workspace
```

`effect` 必填：

- `read`：预期不修改 Provider 或工作区生命周期事实；
- `write`：预期修改本地状态；
- `external`：可能修改外部状态。

Runner 契约：

| Runner | 字段 | Route 结果 |
|---|---|---|
| `command` | `command` | 精确 Shell 命令元信息 |
| `script` | `entry`、`runtime`、可选 `args` | Runtime 加安装后的绝对入口路径 |
| `agent` | `skill` | Skill 自动成为 required 文件资源 |
| `host` | `handler` | 宿主定义的 Handler 身份 |

不同 Runner 的执行字段互斥；例如 Command 不能同时声明 Skill 或 Script Entry，以免不同宿主对同一 Action 产生不同解释。

`cwd` 默认为 `workspace`，也可设为 `provider`。`inputSchema`、`outputSchema` 会将 Schema 纳入 Bundle；`files` 声明 Action 使用的其他运行文件。脚本和 Skill 引用会被校验并打包。独立目录内的 Skill 会携带该目录；Provider 根目录的 `SKILL.md` 只携带自身，因此支持文件必须显式声明。

Agent Graph 只解析 Action，不自动执行；产品宿主可以基于相同 Route 契约实现执行器。

## 4. Resource

### 4.1 静态文件

Markdown 资源使用 frontmatter：

```markdown
---
id: release.checklist
kind: procedure
media-type: text/markdown
---
```

静态 Kind 包括 `procedure`、`diagnostic`、`template`、`schema` 和 `skill`。解析后的 Location 包含安装位置绝对路径、媒体类型和内容 digest；CLI 返回元信息，不返回正文。

Markdown 可以通过 Frontmatter 携带身份；其他文件格式使用一个很小的描述文件，使目标文件保持原生格式：

```yaml
schema: agent-graph.resource.v1
id: schema.draft-output
kind: schema
mediaType: application/schema+json
path: schemas/draft-output.schema.json
```

描述文件和目标文件都必须位于 Provider Root 内。构建 Bundle 时二者都会被收录；解析后的 Resource Location 指向目标文件，并使用目标内容的 Digest。非 Markdown Template 和 Diagnostic 也可使用这种形式。

规范性指令应放在 Procedure；生成内容或工作区证据不能伪装成 Procedure。

### 4.2 动态 Context View

```yaml
schema: agent-graph.resource.v1
id: workspace.status
kind: context-view
mediaType: application/json
materializer: actions/read-status.yaml
```

Context View 是数据。Materializer 必须是 `read` effect 的 command 或 script Action。Evaluation 和 Route 解析不会隐式执行；由 Route 选择的动态 Location 携带 Route Revision。`resource materialize` 必须接收该 Revision，显式运行后将 stdout 写入宿主指定的内容寻址 Cache，并返回位置、Digest 与 Revision。

Materializer 进程可读取 `AGENT_GRAPH_PROVIDER_ROOT`、`AGENT_GRAPH_WORKSPACE`、`AGENT_GRAPH_REVISION` 和 JSON 格式的 `AGENT_GRAPH_INPUT`。其输出不能包含用于覆盖当前 Route 的指令。

## 5. Outcome 与 Evaluation

Outcome 包括：

```text
completed partial failed unverified skipped pending blocked waiting-user
```

这些状态不能互相替代，尤其不能把 `partial`、`unverified` 或 `skipped` 静默归约成 `completed`。

`agent-graph.evaluation.v1` 包含：

- Provider、Graph 和 Entry 身份；
- `revision`：由所选 Graph 在同一 Provider 内的依赖闭包、路由事实、标准化 Outcome 与 Authority 计算；
- `statusCode`：`actionable`、`waiting-user`、`blocked`、`complete` 或 `error`；
- 可选的终态 Outcome；
- 一个 primary 与最多三个确定性排序的 alternative route；
- 紧凑诊断。

Evaluation 是只读操作。相同定义与路由输入必须得到相同 Revision 和排序；Outcome 记录时间不影响 Revision，只被无关 Graph 使用的文件也不会使当前 Graph 的 Route 失效。存在更多备选时，Info Diagnostic 会报告可用数和返回数；SDK 的内部 Candidate 列表仍可供实现专门选择器的宿主使用。

## 6. Route

`agent-graph.route.v1` 只描述一条当前合法路线：

- 当前 `revision` 和绑定该 Revision 的 `routeId`；
- 目标 Graph、node 和 Subgraph call path；
- Availability 与可选 Gate Resolution；
- Action 身份和 effect；
- Command Plan 或 Host Handler；
- 解析后的工作目录，以及其 `workspace` 或 `provider` 语义来源；
- required 与 recommended Resource Location；
- `afterAction.recordNode` 和重新 evaluate 的要求。

只有在当前输入下仍可用的 route ID 才能解析。调用方还可绑定 Evaluation revision；不匹配时会在返回 Command Plan 前被拒绝。长文档正文不会内联；动态资源返回绑定 Revision 的物化引用，不会自动执行。

## 7. Run

`agent-graph.run.v1` 是可选的宿主执行记忆，保存：

- Provider、Graph、Entry 和可选 Workspace；
- 路由使用的 Facts；
- 每个完全限定状态键的最新 Outcome Record；
- 当前会话 Authority；
- 追加式编号 Event；
- 创建与更新时间。

Checkpoint 是经过校验且已移除会话 Authority 的 Run 副本；Resume 会复制到另一个显式路径、再次清空 Authority 并追加 Event。Checkpoint 不能替代事实观测，恢复后仍会重新计算 `satisfiedBy`。

协议不规定全局或项目内的可变状态默认目录。

## 8. Graph 测试

`agent-graph.test.v1` 声明输入状态，以及预期状态码、primary node、终态 Outcome 或诊断码。它不执行 Action、不调用模型，是适合 CI 的确定性路由 Fixture。

## 9. 构建 Bundle

确定性 Builder 会：

1. 加载并校验所有可达定义；
2. 复制可达 Graph、Action、Skill、Resource、Schema、Script 和显式文件；
3. 写入规范化 `provider.yaml`；
4. 在 `manifest.json` 中生成目录、文件 digest 和同 Provider Graph 依赖索引；
5. 排除测试与无关文件；
6. 拒绝覆盖任何引用源码的输出目录；
7. 拒绝任何包含来源 Provider 绝对路径的可达文件或生成 Manifest。

Bundle 可迁移，并可直接通过 `manifest.json` 重新加载。加载时不仅拒绝 Digest 不匹配，也拒绝遗漏或多出的可达文件、不完整 Catalog、Provider 身份不一致，以及与 Subgraph 引用不一致的依赖索引。

## 10. 兼容与扩展策略

v1 对象会拒绝未知字段，避免拼错安全字段却被静默忽略。新增语义需要新的 Schema 版本或明确的兼容扩展点。Agent Host 应按 Schema 和状态码分支，不能按人类描述文本分支。
