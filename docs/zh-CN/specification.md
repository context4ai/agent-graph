# Agent Graph v1 协议规范

本文定义 `@c4a/agent-graph@0.2.2` 实现的 `agent-graph.*.v1` 对象。[`schemas/`](../../schemas) 中的 JSON Schema 是文件形状的规范来源；本文定义其行为与不变量。

## 1. Provider

```yaml
schema: agent-graph.provider.v1
id: company/release
version: 0.1.0
graphs:
  - graphs/release.yaml
catalogs:
  codes: codes.yaml
compatibility:
  agentGraph: ^0.2.0
  node: ">=20"
```

Provider 是独立版本、信任和发布边界。它的 `version` 描述 Provider 自身，不是已安装的 `@c4a/agent-graph` 包版本；`compatibility.agentGraph` 用于声明支持的工具链范围。

- `id` 标识 Provider；宿主运行时使用 Provider、Graph 与 node ID 形成完全限定身份。
- `version` 使用语义化版本格式。
- `graphs` 是相对于 Provider 根目录的路径；Loader 不通过扫描目录发现 Graph。
- 所有引用必须留在 Provider 根目录内，不能使用绝对路径，也不能通过符号链接逃逸。
- 多个 Provider 默认隔离；v1 不合并 Provider，也不允许跨 Provider Subgraph。

源码 Manifest 可以使用任意文件名；构建后的 Bundle 使用 `provider.yaml` 和生成的 `manifest.json`。

### 1.1 Skill 绑定

启用 Graph 的 Skill 把 Provider、Graph 与 Entry 作为一个机器契约绑定：

```yaml
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: release
  agent-graph.entry: default
```

`agent-graph` 可以是相对当前 `SKILL.md` 的 `path:` Locator，也可以是交给宿主解析的 `provider:` Locator。Loader 一次校验三个字段。这些协议键有意使用项目中立的 `agent-graph` 命名空间；npm scope 只是包分发身份。集成不能让 Agent 从正文猜测 Graph 或 Entry。

## 2. Graph

```yaml
schema: agent-graph.graph.v1
id: release
entrypoints:
  default: done
nodes:
  - id: done
    kind: terminal
    terminalOutcome: completed
edges: []
```

Graph 是确定性路线定义。`entrypoints` 将公开入口名映射到一个节点；节点 ID 在当前 Graph 内唯一。

Graph 拓扑是静态的。运行时目标名、日期、phase ID、collection 和队列项属于 Facts，稳定 Host Action 负责解析具体目标；Provider 不能因为这些参数变化就改写或生成 Graph 节点。

每张 Graph 都必须声明至少一个 Terminal；Terminal 不能拥有出边。一次 Evaluation 同时到达多个相同 Outcome 的 Terminal 时，以该 Outcome 完成；如果到达的 Terminal Outcome 冲突，则返回 `terminal-outcome-ambiguous` 与 `error`，不会按声明顺序选择一个。

### 2.1 节点类型

| Kind | 必填字段 | 含义 |
|---|---|---|
| `action` | `action` | 可以选择一个 Provider 相对路径的 Action |
| `gate` | `gate` | 必须由用户或会话授权解析策略边界 |
| `subgraph` | `graph`、`entry` | 进入同一 Provider 内另一张 Graph |
| `terminal` | `terminalOutcome` | 以显式 Outcome 结束当前 Frame |

通用节点字段：

- `description`：简短展示名，不参与机器判断；
- `reasonCode`：Action 和 Gate 节点必填，以 `route.` 开头，稳定解释为何选择该 Route；
- `priority`：同一可用性等级内的确定性路线排序，不负责语义选择；
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

`path` 是点分查找；数字段用于索引 JSON 数组，例如 `items.0.digest` 指向第一项的 `digest`，其他字段用于对象属性。每项只能使用 `exists` 或 `equals` 之一，比较值只能是 JSON 标量。协议不执行 JavaScript、模板、Shell 或自由条件 DSL。

Action 配置 `satisfiedBy` 后：

- 事实匹配会直接得到 `completed`，无需 Run 结果；
- 已记录 `completed` 但事实不匹配时得到 `unverified`；
- 可通过显式 `unverified` 边进入恢复；
- 会话中声称“已完成”不会自动产生事实。

Provider 集成负责观测和提供可信事实。通用 Run facts 是宿主管理的输入，不自动等同于外部证据。

### 2.3 门禁与授权

```yaml
kind: gate
reasonCode: route.release.approval-required
gate:
  id: release-approval
  prompt: Approve this release?
  authority: release.approve
  delegatable: true
inspectionAction: actions/inspect-release.yaml
resolutionAction: actions/apply-approval.yaml
```

没有匹配授权时，Route 状态为 `waiting-user`，其普通 `commandPlan` 保持为空。只有 `delegatable` 为 true 且当前 Evaluation 显式提供对应 authority 时，门禁才变为 actionable，并标记 `resolution: session-authority`。

`inspectionAction` 是可选字段，引用一个只读 Provider Action，用于在决定前准备或打开所需证据。解析后的 Route 会把它单独暴露为 `gate.inspectionAction`；Gate 等待用户时即可执行，但它不会授予 Authority，也不会解析 Gate。Inspection Action 必须使用 `effect: read`。如果它使用 `agent` runner，对应 Skill 会出现在 `gate.inspectionAction.action.skill`，不会被提前混入 Gate 的普通 `resources.required`。

`resolutionAction` 是可选字段，引用一个普通 Provider Action，用于在用户确认后记录或应用决定。解析后的 Route 会把它单独暴露为 `gate.resolutionAction`，其中包含 Command、Host Handler 或 Agent Skill，以及输入/输出 Schema 的安装位置。Route 为 `requires-user` 时宿主不得执行或加载这份条件工作；用户明确确认后，宿主校验本次输入、按需加载 Action Skill、执行 Action、刷新可观察 Facts，再重新求值。动态决定数据属于 Action Input，不能通过生成 Graph Node 表达。

Resolution Action 必须使用 `effect: write` 或 `external`，因为只读 Action 无法改变 Gate 的可观察状态。没有 `resolutionAction` 的 Gate 仍然合法，此时由宿主直接记录其 Outcome。这个 Action 本身不会授予 Authority，也不能把不可委托 Gate 变成自动门禁。

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

Edge 不传输运行时值、Artifact 或共享可变状态；`consumes` 只记录因果意图。宿主必须把 Artifact 持久化到自己的文件或对象 Store，再把可观察的引用、Digest 或 Receipt 作为 Facts 提供给依赖它的下游节点。

非 Repeat 图必须无环，循环必须显式声明，不能由普通流转意外形成。`repeat` 目标只能是 Action 或 Gate，并会把目标重新置为 pending 以进入下一次迭代。Run 事件保留历史迭代，但节点当前 Outcome 会被后续记录替换。

多条替代成功路径汇聚到一个节点时使用 `join: any`；默认 `all` 适用于所有前驱都必须成功的 fan-in。

Fan-out 与 fan-in 只表达可达性拓扑，不表示并发执行。Evaluation 返回一条 Primary Route 与紧凑备选；Agent Graph 不启动并行 Worker，也不合并它们的内存。

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

`cwd` 默认为 `workspace`，也可设为 `provider`。`inputSchema`、`outputSchema` 会将 Schema 纳入 Bundle，并在解析后的 Route Action 上暴露安装位置；`files` 声明 Action 使用的其他运行文件。脚本和 Skill 引用会被校验并打包。独立目录内的 Skill 会携带该目录；Provider 根目录的 `SKILL.md` 只携带自身，因此支持文件必须显式声明。

Agent Graph 只解析 Action，不自动执行；产品宿主可以基于相同 Route 契约实现执行器。对于 Host Action，集成使用产生当前 Evaluation 的同一份 Facts 解析本次参数，调用稳定 Handler，刷新 Facts 后再次 evaluate。

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

未物化 Location 只暴露不透明 `{ resourceId }` 请求和 Route Revision，不暴露 Provider 内部描述文件路径或 Materializer 命令。产品宿主可以自行渲染 Context View；Agent Graph 不把正文打印进 Route。

Materializer 进程可读取 `AGENT_GRAPH_PROVIDER_ROOT`、`AGENT_GRAPH_WORKSPACE`、`AGENT_GRAPH_REVISION` 和 JSON 格式的 `AGENT_GRAPH_INPUT`。默认只继承启动常见 Runtime 所需的最小进程环境；SDK 宿主可以显式补充变量。其输出不能包含用于覆盖当前 Route 的指令。

参考实现默认限制为 30 秒、10 MiB stdout 与 1 MiB stderr；SDK 选项和 CLI 参数可以收紧或放宽。超限时终止进程，返回结构化错误，并且不写 Cache Receipt。`effect: read` 是供检查和宿主策略使用的声明契约，不是操作系统沙箱；宿主仍负责信任或隔离 Materializer 代码。

### 4.3 Code Catalog

Provider 可以声明一个 `agent-graph.code-catalog.v1` 文件：

```yaml
schema: agent-graph.code-catalog.v1
codes:
  - code: route.release.inspect
    kind: route-reason
    summary: The release artifact still needs inspection.
    document: resources/release-checklist.md
```

`route-reason` 解释为何选择某条 Route；`diagnostic` 标识产品状态，并可声明 `severity`。`summary` 只是短提示，不参与机器判断；`document` 是可选静态 Resource，仅在需要完整解释时读取。

即使没有 Catalog，每个 `reasonCode` 也必须通过 `route.<id>` 形状的 Schema 校验。在这种最小模式下，Code 仍是机器稳定的 Route 原因，但没有闭集拼写校验、Hint 或解释文档。Provider 声明 Catalog 后，每个 Action 和 Gate 的 `reasonCode` 都必须解析到 `route-reason` 条目；需要闭集校验或可发现解释时应声明 Catalog。Catalog 是可选能力，因此缺少 Catalog 本身不产生 Warning。

不增加独立 `infoCode`：非阻塞信息使用 `severity: info` 的 Diagnostic code。

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
- 每个 Route Summary 必填的 `reasonCode` 和可选 Catalog `hint`；
- 紧凑诊断。

Evaluation 是只读操作。相同定义与路由输入必须得到相同 Revision 和排序；Outcome 记录时间不影响 Revision，只被无关 Graph 使用的文件也不会使当前 Graph 的 Route 失效。存在更多备选时，Info Diagnostic 会报告可用数和返回数；SDK 的内部 Candidate 列表仍可供实现专门选择器的宿主使用。

## 6. Route

`agent-graph.route.v1` 只描述一条当前合法路线：

- 当前 `revision` 和绑定该 Revision 的 `routeId`；
- 目标 Graph、node 和 Subgraph call path；
- 通用 `statusCode`、稳定 `reasonCode` 和可选短 `hint`；
- Availability、可选 Gate Resolution 与可选 Gate Resolution Action；
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

`agent-graph.test.v1` 声明输入状态，以及预期状态码、primary/alternative node、reason code、availability、command 或 handler、选中 Resource、Gate resolution、Gate resolution command/handler/input Schema、记录键、终态 Outcome 或诊断码。它不执行 Action、不调用模型，是适合 CI 的确定性路由 Fixture。

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

v1 对象会拒绝未知字段，避免拼错安全字段却被静默忽略。

在 npm 包到达 `1.0.0` 前，`agent-graph.*.v1` 协议族仍处于公开草案定稿期。按照语义化版本规则，`0.x` 版本可以收紧必填字段或不变量，但必须记录破坏性变化，并同步全部随包模板、示例与测试。`0.2.0` 将 Action 和 Gate 的 `reasonCode` 设为必填，并用显式 Graph 和 Entry 字段补全 Skill Binding。

到达 `1.0.0` 稳定边界后，不兼容的新语义必须使用新的 Schema 版本；兼容扩展必须使用明确声明的扩展点。Agent Host 应按 Schema、状态码、reason code 和 diagnostic code 分支，不能按人类描述文本分支。

CLI JSON 错误使用 `agent-graph.error.v1`；自动化按 `error.code` 分支。错误与诊断 message 保持简短，完整解释应放在 Provider Catalog 文档或包手册中，而不是不断扩张错误字符串。
