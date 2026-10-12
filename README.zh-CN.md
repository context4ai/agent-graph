# Agent Graph

[![CI](https://github.com/context4ai/agent-graph/actions/workflows/ci.yml/badge.svg)](https://github.com/context4ai/agent-graph/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@c4a/agent-graph.svg)](https://www.npmjs.com/package/@c4a/agent-graph)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Agent Graph 是面向 Agent Skills 的工作契约层。你把一套流程写成一张步骤图，运行时它根据当前事实告诉 Agent 下一步该做什么、要读哪几个文件、怎样才算做完。它自己从不调用模型。

Agent Graph 只协调工作本身：它不调用模型，不分配 Agent 身份，不传输共享可变状态，也不调度并行 Worker。这些由已有的 Agent 和宿主完成——它们消费 Agent Graph 基于事实给出的 Route，并守住执行边界。

Agent 很多时候并不缺知识。更难的是判断：现在该读哪一部分、下一步允许做什么、什么事实能证明动作已经完成，以及会话中断后从哪里继续。把内容不断塞进更长的 Prompt，并不能可靠地解决这些问题。

> 上下文应按需发现，而不是不断堆积。计划是显式的，路径由当前现实状态决定。

> **什么时候该用：** 不是每个 Skill 都需要 Graph；单轮、短流程，靠一份 `SKILL.md` 就能完成时，保持简单。只有当宿主能提供可信的外部事实，并且任务确实需要可验证完成、跨会话恢复，或可测试的路由与人工门禁时，再引入 Agent Graph。

[文档](https://context4ai.org/context/pages/91e2679fb8eb437a1a32a70050351382.html) · [English](./README.md) · [用户手册](./docs/zh-CN/README.md) · [Graph Engineering](./docs/zh-CN/graph-engineering.md) · [贡献指南](./CONTRIBUTING.md) · [开发指南](./DEVELOPMENT.md)

## 先看一个最简单的例子

假设 Agent 只需要完成一件事：写一份草稿，检查草稿，然后结束。

流程只有三步：

```text
写草稿  →  检查草稿  →  完成
```

现在，宿主能够观察到两个事实：

```text
draft.saved   = true
review.passed = false
```

草稿已经保存，但还没有检查通过，所以 Agent Graph 直接把 **检查草稿** 作为当前 Route。

![示例 Graph](./docs/zh-CN/assets/example-graph.svg)

这里没有从对话中猜测进度。之后如果 `review.passed` 变成 `true`，下一轮求值就会到达 **完成**；如果它仍是 `false`，当前 Route 仍然是 **检查草稿**。

理解这个例子只需要四个概念：

- **Graph**：规定合法的步骤顺序。
- **Facts**：描述当前真实状态。
- **Route**：根据 Facts 选出的下一步。
- **Action**：告诉 Agent 或宿主如何执行这一步。

真实工作流可以继续加入所需文件、人工 Gate、显式 Outcome、分支和恢复路径，但基本循环不变。想查看可运行示例背后的实际文件，再进入[技术教程](./docs/zh-CN/getting-started.md)。

## 它能解决什么

- **承载大量知识而不撑大 Prompt。** Procedure、Schema、手册和动态上下文都是文件资源，选中的路线需要时才加载。
- **让长任务跨越会话。** Facts 和显式 Outcome 能重建任务进度；可选的 Run 再记录事件、Checkpoint 和可恢复状态。
- **计划随现实响应，又不至于漂移。** Graph 规定合法选择和停止条件，当前证据决定实际经过的路径。
- **运行模型之前就能测试。** 作者可以校验引用、循环、资源边界和预期路线，不必先让模型跑一遍整个流程。

## 它如何持续推进

Graph 记录既定计划的边界——动作、依赖、选择、门禁、证据和恢复路线——但不强迫每次运行都走同一条静态流水线。每一轮求值都基于可观察事实和已有 Outcome 选出一条路线，并只暴露该路线所需的资源：

![Agent Graph 路由生命周期](./docs/zh-CN/assets/route-lifecycle.svg)

- **运行反馈**改变下一条路线：成功推进目标，缺证据进入验证，失败进入恢复或另作选择；
- **工程反馈**让工作流可被改进：事件、诊断和路由测试能暴露说明、事实定义或图结构中的问题。

Agent Graph 不会在后台擅自重写自己的计划。运行时路由随证据变化，Graph 本身由人和工程流程依据可观察结果优化。

> 进展应由事实证明，而不是依赖对话记忆。

## 真实实践：Context

[Context](https://github.com/context4ai/context) 的整个知识工作流都运行在 Agent Graph 上，对外只有一个薄的生产入口 [`/c4a:context`](https://github.com/context4ai/context/blob/main/plugins/context/skills/context/SKILL.md)。该入口既能创建新工作区，也能继续已有工作区；每次求值只把当前 Route 需要的规程与资源交给 Agent，并要求 Agent 证明已经读取。Facts 不变时重新进入仍选中同一条 Route，绑定 revision 的命令会拒绝过期写入，因此重试与新会话都是安全的。调试记录可以回放每一条 Route、循环、门禁与结果。集成细节见 [Context 中的 Agent Graph](https://context4ai.org/context/pages/e0028d6618a071cc8e8f14135d034285.html)。

[观看交互式回放](https://context4ai.github.io/context/case-studies/workflow/?lang=zh) · [阅读完整案例](https://github.com/context4ai/context/blob/main/docs/zh-CN/case-studies/agent-graph-workflow.md)

![运行在 Agent Graph 上的 Context](https://raw.githubusercontent.com/context4ai/context/main/docs/zh-CN/assets/context-agent-graph.svg)

## 项目提供什么

Agent Graph 是一套 Skills 原生的文件规范，并附带参考 SDK 与 CLI：

- Provider、Graph、Action、Resource、Run 和测试用例的版本化规范；
- 兼容 Node.js、用于加载和求值这些文件的 SDK；
- 用于创建、检查、测试、构建和恢复工作流的 CLI；
- 命名空间 Skill 绑定与 Provider Code Catalog，用于稳定表达路由原因；
- 版本化 Host Materialization ABI，用于结构化 Resource Input、Inline/Managed Output、过期关联与恢复；
- 模板与导入器，用于起新项目，或把已有 Skill、脚本和依赖工作流转成草案。

它不会主动调用模型。CLI 只暴露当前合法路线、所需文件、命令计划、Gate、可选的确认后 Resolution Action 和结果记录契约，由 Agent 或宿主决定如何完成。

## 我该怎么接入

Agent Graph 是基础设施，只装 CLI 不会让现有 Agent 自动照做。一次接入涉及三方：Provider 定义流程契约，Skill 负责被发现，宿主（你的 Agent 或产品）提供事实、展示路线、执行门禁并记录结果。

按处境对号入座：

| 你的处境 | 从这里开始 |
|---|---|
| 改进一个已有 Skill | [迁移指南](./docs/zh-CN/migration.md) |
| 从零建一个 Skill 或工作流 | [编写 Graph](./docs/zh-CN/authoring.md) |
| 把路由能力嵌进自己的 CLI、插件或产品 | [Skill 与 Provider](./docs/zh-CN/skills-and-providers.md) |
| 只是使用别人接好的能力 | 照常调用那个 Skill，通常无需自己安装或配置 |

多份 Skill 可以共享一个 Provider，一个宿主也可以安装多个互相隔离的 Provider，不需要全局目录，也不会合并无关流程。

安装（作者用前者，内嵌宿主用后者）：

```bash
npm install --save-dev @c4a/agent-graph   # 编写与 CI
npm install @c4a/agent-graph              # 内嵌 SDK 的宿主
```

需要精确命令时看 [CLI 参考](./docs/zh-CN/cli.md)，想跟着跑一遍看[快速开始](./docs/zh-CN/getting-started.md)。支持 Node.js 20 及以上版本。

## Skill 如何连接工作图

宿主先根据 `name` 和 `description` 判断一个 Skill 是否符合用户需求；Skill 被选中后，三个 metadata 字段再精确定位它使用的工作图：

```markdown
---
name: draft-workflow
description: 当用户需要撰写、检查并完成一份草稿时使用。
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: draft
  agent-graph.entry: default
---

# Draft workflow

1. 解析以上绑定，并对选中的 Graph 和 Entry 求值。
2. 解析当前 Route，完整读取其中标记为 `read-required` 的必需资源。
3. 遇到尚未解决的人工 Gate 时停止。
4. 只执行当前 Route 选择的 Action，记录显式 Outcome，再次求值。
```

| 字段 | 作用 |
|---|---|
| `agent-graph` | 定位包含工作流的 Provider |
| `agent-graph.graph` | 选择 Provider 中的一张 Graph |
| `agent-graph.entry` | 选择这张 Graph 的公开入口 |

三个字段缺一不可，并由 Loader 一次校验。`path:` 始终相对当前 `SKILL.md` 解析，而不是相对进程工作目录；宿主也可以注册共享 Provider，改用 `provider:<id>`。

Skill 正文只保留这段启动与消费规则。各阶段的操作说明、Schema 和上下文继续作为 Route 资源按需加载，不复制进 Skill。绑定只选择稳定工作流；当前模块、批次或日期属于运行时 Facts。完整规则参见 [Skill 与 Provider](./docs/zh-CN/skills-and-providers.md)。

宿主还可以附带资源读取收据以减少重复读取，并通过自身 Handler 提供 Host-action Resource；两类契约见[协议规范](./docs/zh-CN/specification.md)。

## 文档

Context 文档站的 [Agent Graph 文档](https://context4ai.org/context/pages/91e2679fb8eb437a1a32a70050351382.html)讲解模型并结合真实用法逐步演示（与英文共用地址，按语言偏好显示中文）：

| 分类 | 页面 |
|---|---|
| 原理 | [为什么是 Graph Engineering](https://context4ai.org/context/pages/91e2679fb8eb437a1a32a70050351382.html) · [核心模型](https://context4ai.org/context/pages/ad65c836debb540be355e741aabf3dcf.html) · [运行与恢复](https://context4ai.org/context/pages/708a22de19d0b807fd512451f1269434.html) · [Skills 与 Providers](https://context4ai.org/context/pages/b3558e7c73749da60cf1b9634061fdd8.html) · [Context 中的 Agent Graph](https://context4ai.org/context/pages/e0028d6618a071cc8e8f14135d034285.html) |
| 指南 | [快速开始](https://context4ai.org/context/pages/05958f2aaec0c5605023f05e067c37bf.html) · [编写 Graph](https://context4ai.org/context/pages/b218404303adf13ace7561657d45483b.html) · [测试与发布](https://context4ai.org/context/pages/2a26bc3e8f39cad36b9354cb975ec644.html) |
| 参考 | [规范](https://context4ai.org/context/pages/098719903f2a7dcec5c1a6edb7b8ead3.html) · [CLI 与 SDK](https://context4ai.org/context/pages/7e7db2502a06c2f284c1701cc591c32b.html) · [迁移](https://context4ai.org/context/pages/516592ea7ac3e03cb284d8283bf349fc.html) |

带版本的用户手册随本仓库发布，是各版本的规范性参考：

- [快速开始](./docs/zh-CN/getting-started.md)
- [编写 Graph](./docs/zh-CN/authoring.md)
- [CLI 参考](./docs/zh-CN/cli.md)
- [协议规范](./docs/zh-CN/specification.md)
- [Skills 与 Providers](./docs/zh-CN/skills-and-providers.md)
- [运行、循环与恢复](./docs/zh-CN/runtime-and-recovery.md)
- [测试与发布](./docs/zh-CN/testing-and-publishing.md)
- [迁移已有工作流](./docs/zh-CN/migration.md)
- [接入场景详解](./docs/zh-CN/adoption-paths.md)
- [Graph Engineering：概念与实现](./docs/zh-CN/graph-engineering.md)
- [实践案例：Context 知识工作流](https://github.com/context4ai/context/blob/main/docs/zh-CN/case-studies/agent-graph-workflow.md)

想直接查看仓库内容：

- [`examples/`](./examples)：可运行的完整场景，第一次阅读可以从 [`getting-started`](./examples/getting-started) 开始；
- [`schemas/`](./schemas)：供工具和集成使用的机器可读协议契约。

## 生态

| 项目 | 角色 |
|---|---|
| [Context](https://github.com/context4ai/context) | 面向研发团队与 Agent 的知识工作流，也是规模最大的 Agent Graph 集成 |
| [Source Graph](https://github.com/context4ai/sourcegraph) | 固定 Git 版本的代码搜索与阅读 |
| [Portal](https://github.com/context4ai/portal) | [context4ai.org](https://context4ai.org)，包括文档站 |

## 参与贡献

```bash
git clone https://github.com/context4ai/agent-graph.git
cd agent-graph
bun install
bun run verify
```

提交 Pull Request 前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)；源码结构、协议规则与发布审计见 [DEVELOPMENT.md](./DEVELOPMENT.md)。使用问题请到 [GitHub Discussions](https://github.com/context4ai/agent-graph/discussions)（见 [SUPPORT.md](./SUPPORT.md)），安全漏洞按 [SECURITY.md](./SECURITY.md) 报告。参与本项目须遵守[行为准则](./CODE_OF_CONDUCT.md)。版本历史见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

[MIT](./LICENSE)
