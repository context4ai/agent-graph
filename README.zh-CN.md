# Agent Graph

Agent Graph 将 Graph Engineering 引入 Agent Skills，是一层上下文与工作编排机制。它把知识、操作说明、脚本、可观察状态和人工门禁连接成一张可导航的工作图，让 Agent 发现当前真正相关的内容，执行下一条合法动作，并持续推进目标。

Agent 很多时候并不缺知识。更难的问题是：现在该读哪一部分、下一步允许做什么、什么事实能够证明动作已经完成，以及会话中断后从哪里继续。把所有内容塞进一个更长的 Prompt，并不能可靠地解决这些问题。

> 上下文应按需发现，而不是不断堆积。计划是显式的，路径则由当前现实状态决定。

[English](./README.md) · [用户手册](./docs/zh-CN/README.md) · [Graph Engineering](./docs/zh-CN/graph-engineering.md) · [开发指南](./DEVELOPMENT.md)

## 从知识走向可验证的进展

Graph 记录既定计划的边界，包括动作、依赖、选择、门禁、证据和恢复路线，但不强迫每次运行都经过同一条静态流水线。每一轮，Agent Graph 都根据可观察事实和已有 Outcome 求值，选择一条合法 Route，再只暴露该 Route 所需的资源：

![Agent Graph 路由生命周期](./docs/zh-CN/assets/route-lifecycle.svg)

由此形成两个反馈循环：

- **运行反馈**改变下一条 Route：成功可以推进目标，缺少证据会进入验证，失败则可以进入恢复或其他选择；
- **工程反馈**让工作流持续改进：事件、诊断和路由测试可以暴露说明、事实定义或图结构中的问题。

Agent Graph 不会在后台擅自重写自己的计划。运行时路由根据证据动态变化；Graph 本身由人和工程流程依据可观察结果持续优化。

> 进展应由事实证明，而不是依赖对话记忆。

## 这套机制能带来什么

- **承载大量知识，但不制造巨型 Prompt。** Procedure、Schema、手册和动态上下文都保留为文件资源，只有选中的 Route 需要时才会加载。
- **让长任务跨越会话边界。** Facts 和显式 Outcomes 可以重建任务位置；可选 Run 进一步记录事件、Checkpoint 和可恢复的运行状态。
- **让计划动态响应现实，但不会随意漂移。** Graph 规定合法选择和停止条件，当前证据决定实际经过的路径。
- **让人工与 Agent 在明确权限下协作。** Gate 说明谁必须决策，以及用户是否只在当前会话委托了决定权。
- **在运行模型前检查和测试流程。** 作者可以验证引用、循环、资源边界和预期 Route，而不必先让模型实际执行整个工作流。
- **根据证据改进系统。** 团队可以检查为何选中某条 Route、它暴露了哪些上下文、记录了什么 Outcome，以及恢复从哪里开始。

## 项目提供什么

Agent Graph 是一套 Skills 原生的文件规范，并提供参考 SDK 与 CLI。项目包含：

- Provider、Graph、Action、Resource、Run 和测试用例的版本化规范；
- 用于加载和求值这些文件、兼容 Node.js 的 SDK；
- 用于创建、检查、测试、构建和恢复工作流的 CLI；
- 用于新项目，以及将既有 Skills、脚本和依赖工作流转成草案的模板与导入器。

它不是 Agent 框架、模型运行时或隐藏任务执行器，也不会主动调用模型。CLI 只暴露当前合法路线、所需文件资源、命令计划、门禁和结果记录契约，由 Agent 或宿主决定如何完成这条路线。

## 安装与运行

无需长期安装即可直接运行：

```bash
npx agent-graph@0.1.0 --version
npx agent-graph@0.1.0 init ./my-provider --id my-provider
# Bun 用户也可以直接临时运行同一个包：
bunx agent-graph@0.1.0 --version
```

也可以全局安装 CLI：

```bash
npm install --global agent-graph@0.1.0
agent-graph --version
```

npm 包还包含自包含的 `dist/agent-graph.mjs`。只复制这一个文件，即可用 Node.js 或 Bun 运行：

```bash
node agent-graph.mjs --version
bun agent-graph.mjs --version
```

用户运行时要求 Node.js 20 或更高版本。Bun 用于项目开发，普通用户并不必须安装 Bun。

## 快速开始

```bash
npx agent-graph@0.1.0 init ./my-provider --id my-provider
cd my-provider

npx agent-graph@0.1.0 validate --format json
npx agent-graph@0.1.0 test tests --format json
npx agent-graph@0.1.0 evaluate main --format json
```

`evaluate` 返回 `agent-graph.evaluation.v1`。使用其中的 `primaryRoute.routeId` 解析路线，只会拿到当前状态所选中的动作和资源：

```bash
npx agent-graph@0.1.0 route main <route-id> --revision <revision> --format json
```

长任务可以把运行状态放到宿主自己选择的位置：

```bash
npx agent-graph@0.1.0 run start main --state .runtime/run.json
npx agent-graph@0.1.0 run status --state .runtime/run.json --format json
npx agent-graph@0.1.0 run record main/work completed --state .runtime/run.json
```

Agent Graph 不规定 `.agent-graph`、用户主目录缓存或任何宿主专属目录。Bundle、Run、Checkpoint 和 Cache 的路径都由调用方显式提供。

## Skill 绑定

Skill 保持为发现与消费协议的薄入口：

```yaml
---
name: example-operator
description: Execute the current route exposed by Agent Graph.
metadata:
  agent-graph: path:../../provider.yaml
---
```

`path:` 相对 `SKILL.md` 解析。宿主也可以注册共享 Provider，再使用 `provider:<id>`；因此多个 Skills 可以复用同一张图而不复制图资源。

## 文档

- [快速开始](./docs/zh-CN/getting-started.md)
- [编写 Graph](./docs/zh-CN/authoring.md)
- [CLI 参考](./docs/zh-CN/cli.md)
- [协议规范](./docs/zh-CN/specification.md)
- [Skills 与 Providers](./docs/zh-CN/skills-and-providers.md)
- [运行、循环与恢复](./docs/zh-CN/runtime-and-recovery.md)
- [测试与发布](./docs/zh-CN/testing-and-publishing.md)
- [迁移已有工作流](./docs/zh-CN/migration.md)
- [Graph Engineering：概念与实现](./docs/zh-CN/graph-engineering.md)

可运行场景位于 [`examples/`](./examples)，机器可读契约位于 [`schemas/`](./schemas)。
