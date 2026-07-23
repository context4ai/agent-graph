# 接入场景

Agent Graph 只有成为 Skill 或 Agent 宿主的一部分后才会产生作用，并不会因为安装了 CLI 就自动出现一套工作流。

请先用本文确认接入边界，再选择具体命令和目录组织方式。

## 改进已有 Skill

适用于 Skill 已经能够工作，但指令文件越来越长、每轮重复加载大量上下文、跨会话后容易丢失进度，或者仅靠文案描述门禁与恢复流程的情况。

目标形态是：

- Skill 保留 `name`、`description` 和简短的 Route 消费契约；
- Provider 维护稳定 Action、Graph、Gate、原因码和测试；
- 阶段性手册、Schema 和诊断说明成为由 Route 选择的 Resource；
- 宿主提供当前 Facts，并保存需要持久化的 Run 状态；
- 使用 `satisfiedBy` 指定能够证明完成的事实，而不是信任对话中的完成声明。

不要把每个段落都转换成节点。Node 应表示可独立执行、受门禁、可恢复或可测试的状态转移；辅助说明继续保留为 Resource。

Importer 可以复制已有 Skill 并生成合法的 Provider 起点，但无法推断业务事实、安全 Effect、人工权限或恢复语义。替换原 Skill 前必须审阅生成的草案。

继续阅读：

- [迁移已有 Skill 与工作流](./migration.md)
- [Skill 与 Provider](./skills-and-providers.md)
- [`examples/facts-recovery`](../../examples/facts-recovery)

## 新建 Skill 或工作流

适用于能力尚未存在，并且可以让工作契约和 Skill 一起设计的情况。

先设计稳定工作模型，而不是先罗列命令：

1. 找出宿主真正能够观察的 Facts；
2. 定义合法 Action 及其 Effect；
3. 明确什么事实能够证明每个 Action 完成；
4. 在需要权限决策的位置加入用户 Gate；
5. 显式表达失败、部分完成、验证和恢复；
6. 只把长说明挂到真正需要它们的 Route；
7. 为重要状态与选择编写 Graph Case；
8. 用一份或多份薄 Skill 绑定对应 Graph 与 Entry。

当前模块名、文档 ID、日期、队列项等运行目标都属于 Facts。稳定 Host Action 解析当前目标；Provider 不应为每个目标重新生成 Graph。

继续阅读：

- [技术教程](./getting-started.md)
- [编写 Graph](./authoring.md)
- [测试与发布](./testing-and-publishing.md)
- [`examples/fact-driven-batch`](../../examples/fact-driven-batch)

## 集成到 Hosted CLI、Plugin 或产品

适用于产品已经负责 Agent 发现、命令执行、交互界面、工作区状态或 Plugin 安装的情况。Agent Graph 应嵌入这个产品边界之内，而不是再暴露成一个要求最终用户操作的 CLI。

各部分职责有意分离：

| 部分 | 职责 |
|---|---|
| Skill | 说明能力何时适用，并绑定 Provider、Graph 与 Entry |
| Provider Bundle | 定义静态合法工作、Resource、Gate、原因码和 Route 测试 |
| 宿主 | 解析 Bundle、采集 Facts、持久化状态、物化动态 Resource、执行 Host Action、落实 Gate 并刷新观察 |
| Agent | 消费选中的 Route、读取 Required Resource、完成被委托的工作并报告显式 Outcome |
| Agent Graph | 校验契约，并确定性地求值和解析 Route |

开发阶段，将 Provider 源文件放在拥有它的产品或 Plugin 附近。构建阶段生成可迁移 Bundle，并纳入该产品原有的资源打包流程。运行阶段，宿主通过 Skill Binding 或 Registry ID 定位已安装 Bundle。

宿主循环是：

1. 解析当前 Skill Binding；
2. 从产品事实源观察 Facts；
3. 对绑定的 Graph 与 Entry 求值；
4. 使用返回的 Route ID 和 Revision 解析一条 Route；
5. 向 Agent 暴露 Required 文件 Resource；
6. 执行返回的命令，或分发稳定 Host Handler；
7. 任何变更前先落实未解析的用户 Gate；
8. 刷新 Facts，在适用时记录 Outcome，然后再次求值。

Node.js 宿主可以进程内使用 SDK；其他运行时或需要进程边界的宿主可以使用 JSON CLI。两者消费相同文件协议，也都不应成为产品 Facts 的事实源。

长手册和生成上下文应继续使用文件。静态 Resource 解析为文件位置和 Digest；动态 Context View 显式物化到宿主选择的缓存位置。不要把正文复制到 Skill Metadata 或常规状态输出。

继续阅读：

- [Skill 与 Provider](./skills-and-providers.md)
- [协议规范](./specification.md)
- [运行与恢复](./runtime-and-recovery.md)
- [`examples/shared-provider`](../../examples/shared-provider)
- [`examples/provider-registry`](../../examples/provider-registry)

## 使用已有接入

适用于 CLI、Plugin 或产品已经发布了启用 Graph 的 Skills。

最终用户或 Agent 通常只需通过该宿主调用 Skill；宿主会解析 Provider 并提供当前 Route。不需要另行全局安装 Agent Graph、复制 Provider，或者维护共享 `.agent-graph` 目录。

消费 Route 的 Agent 只需遵循：

- 按机器 Code 分支，不依赖偶然文案；
- 完整读取每个 Required Resource；
- 将 Recommended Resource 视为可选内容；
- 在未解析用户 Gate 前停止；
- 只执行选中的 Action；
- 报告显式 Outcome，并再次求值。

参见 [Agent 消费契约](./README.md#agent-消费契约)。

## 仓库与安装形态

Agent Graph 不规定统一目录名。Binding 或宿主 Registry 会定位由所有者打包在任意位置的 Provider。

常见形态包括：

- 一份 Provider 与一份 Skill 同处一个仓库；
- Plugin 中多份 Skill 共享一份 Provider；
- Hosted CLI 内嵌构建后的 Provider；
- 产品 Registry 解析多份相互独立的 Provider Bundle。

可变 Run 和动态 Resource Cache 应进入宿主已有的运行区、数据库或临时存储，不应写入已发布的 Skill 或 Provider Bundle。
