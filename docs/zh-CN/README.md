# Agent Graph 用户手册

[English](../en/README.md) · [项目 README](../../README.zh-CN.md)

本手册面向 Provider 作者、Skill 作者、Agent Host 集成方以及实际消费 Route 的 Agent。Agent Graph 是基础设施：请先确认它应接入 Skill 还是宿主，再阅读该边界对应的技术资料。

## 按目标阅读

- 判断你是在改进 Skill、新建工作流、嵌入宿主，还是消费已有接入：[接入场景](./adoption-paths.md)
- 选定接入场景后创建第一份 Provider：[快速开始](./getting-started.md)
- 设计节点、边、事实、门禁和资源：[编写 Graph](./authoring.md)
- 理解所有协议对象：[协议规范](./specification.md)
- 接入 Skill、Plugin 和多个 Provider：[Skill 与 Provider](./skills-and-providers.md)
- 查询全部命令：[CLI 参考](./cli.md)
- 持久化长任务或循环任务：[运行与恢复](./runtime-and-recovery.md)
- 测试并发布 Bundle：[测试与发布](./testing-and-publishing.md)
- 转换已有 Skill 或脚本工作流：[迁移指南](./migration.md)
- 理解设计理念：[Graph Engineering](./graph-engineering.md)

## Agent 消费契约

Agent 消费已经完成接入的 Agent Graph 能力时，只需遵循以下循环：

1. 从当前 Skill 完整绑定解析 Provider、Graph 与 Entry，或使用显式 Manifest 选择。
2. 执行 `evaluate`，按 `statusCode` 与 `reasonCode` 而不是文案分支。
3. 默认选择 primary route；仅当用户或任务需要时选择 alternative。
4. 使用精确 route ID 和 Evaluation revision 执行 `route`。
5. 完整读取所有 required 资源；recommended 资源按需读取。
6. 用户确认前，不执行 Gate 单独返回的 Resolution Action。
7. 只执行 Route 返回的命令或 Host Action。
8. 记录显式 Outcome，并在适用时更新可观察事实。
9. 再次 evaluate；不得仅凭会话记忆继续。

Provider 目录不要求命名为 `agent-graph`。Skill Locator 直接指向 Manifest；可变 Run 和 Cache 的位置由宿主自行选择。
