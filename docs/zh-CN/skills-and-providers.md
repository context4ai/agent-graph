# Skill 与 Provider

## Agent Skills 仍是入口契约

Agent Graph 扩展 Agent Skills，不替代它。启用 Graph 的 Skill 在宿主发现阶段仍应独立有用：`name` 和 `description` 说明何时调用；一个 metadata 值告诉集成层 Graph 行为位于何处。

```yaml
---
name: release-package
description: Inspect, review, and release a package through the installed workflow.
metadata:
  agent-graph: path:../../release-graph/provider.yaml
---
```

Skill 正文只保留 Bootstrap 契约：

1. 指明使用的 Graph 与 Entry；
2. 任何生命周期动作前先 evaluate；
3. 解析选中的 Route；
4. 完整读取 Route 的 required 资源；
5. 将 recommended 资源作为可选上下文；
6. 遇到未解析用户门禁时停止；
7. 记录显式 Outcome 并再次 evaluate。

不要把所有阶段、诊断、Schema 或生成的工作区上下文复制进 Skill。

## Locator 语法

### `path:`

`path:<relative-path>` 始终相对于当前 `SKILL.md` 所在目录解析，不相对于进程 cwd。目标直接指向源码 Provider Manifest 或构建后的 `manifest.json`。

```text
plugin/
├── skills/
│   ├── init/SKILL.md       ───┐
│   └── continue/SKILL.md   ───┼── path:../../product-workflow/provider.yaml
└── product-workflow/          │
    ├── provider.yaml       <──┘
    ├── graphs/
    ├── actions/
    └── resources/
```

Provider 目录可以使用任意名称。开始加载后，其中的相对引用不得逃逸 Provider 根目录。

### `provider:`

`provider:<id>` 将定位交给宿主 Registry 或 BundleResolver：

```yaml
metadata:
  agent-graph: provider:company/release
```

CLI Registry 示例：

```yaml
providers:
  company/release: ../installed/release/manifest.json
```

```bash
agent-graph inspect skill ./skills/release/SKILL.md --registry ./providers.yaml
```

Registry 文件属于宿主，不应复制到每个消费者项目。Skill 也不能硬编码 npm prefix、Plugin cache 版本目录或开发机路径。

## 一个 Provider，多份 Skill 与 Graph

多份 Skill 可以共享同一 Provider，并在正文中选择不同 Graph 或 Entry；Graph、Procedure 与 Schema 只维护一份。一个 Provider 也可包含多张 Graph，共享 Action 或 Resource 定义。

共享 Action 或 Resource 不会自动产生执行依赖；只有显式 Edge、Fact Requirement 和 Subgraph Node 才建立关系。

## 同一宿主安装多个 Provider

当两个 Skill 指向不同 Provider 时：

- 身份与可变状态按 Provider ID 隔离；
- Manifest 和 Graph 不合并；
- 当前 Skill 选择自己的 Provider；
- 脱离 Skill 上下文时，宿主必须要求显式选择；
- v1 不能调用其他 Provider 的 Subgraph。

因此无需由每个插件共同修改一个中央 `.agent-graph` Manifest。每个插件发布自己的 Bundle；宿主 Registry 只解析身份。

## 宿主决定物理位置

三类位置有意保持分离：

| 关注点 | 参考实现 | 宿主决策 |
|---|---|---|
| Bundle 定位 | `path:` 或 Registry 支持的 `provider:` | npm 包、Plugin cache、仓库或内嵌资源 |
| Run 存储 | 显式 `--state` 与 checkpoint 路径 | 项目运行区、数据库、内存或已有产品 Store |
| 动态资源 Cache | 显式 `--cache` | 临时目录、内容存储或已有产品 Cache |

Agent Graph 不要求 `~/.agent-graph`、`.agent-graph`、`.claude/agent-graph` 或 `.codex/agent-graph`。

## 薄宿主集成伪代码

```ts
import {
  evaluateGraph,
  loadProvider,
  resolveRoute,
  resolveSkillManifest,
} from "agent-graph";

const { manifestPath } = await resolveSkillManifest(skillPath, { registry });
const provider = await loadProvider(manifestPath);
const { evaluation } = evaluateGraph(provider, graphId, entry, currentState);

if (evaluation.primaryRoute) {
  const route = await resolveRoute(
    provider,
    graphId,
    entry,
    evaluation.primaryRoute.routeId,
    currentState,
    evaluation.revision,
  );
  // 将 Route 资源和 Action 交给 Agent，不做隐式执行。
}
```

完整示例见 [`examples/shared-provider`](../../examples/shared-provider) 和 [`examples/provider-registry`](../../examples/provider-registry)。

## 按职责划分的 SDK 接口

| 职责 | API |
|---|---|
| Provider 发现 | `readSkillLocator`、`resolveSkillManifest`、`readProviderRegistry`、`loadProvider` |
| 路由 | `evaluateGraph`、`computeRevision`、`resolveRoute`、`nodeStateKey` |
| Resource | `locateResource`、`materializeResource` |
| 可选 Run 文件 | `createRun`、`loadRun`、`recordOutcome`、`updateRunFacts`、`updateRunAuthorities`、`checkpointRun`、`resumeRun` |
| 开发 | `initProvider`、`importSkill`、`importScripts`、`importWorkflow` |
| 质量与发布 | `validateSchema`、`runGraphTests`、`buildProviderBundle`、`inspectProvider` |

SDK 返回的文件系统路径都是当前安装中的解析路径；Provider 内定义仍保持相对引用。Evaluation 和 Route 解析无副作用；只有显式命名的开发、Run 修改、Build 与 Materialization API 会写文件。

`materializeResource` 接受 `timeoutMs`、`maxOutputBytes` 与 `maxErrorBytes` 护栏。Materializer 默认继承最小环境；可信宿主可通过 `env` 显式传入其他变量，Agent Graph 自身变量会覆盖同名注入值。
