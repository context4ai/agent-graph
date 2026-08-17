# Context 实践案例

[English](./README.md)

本目录包含 [English](../../docs/en/case-studies/context.md) 和[中文](../../docs/zh-CN/case-studies/context.md)案例所介绍的 Context 公开回放。

回放使用一份经过字段白名单处理的真实 Context 调试记录。它保留路由顺序、重复求值、状态、原因码与相对时间，同时排除来源正文、本机路径、凭证、不透明标识和组织相关名称。

每一步都会链接到 Context 已发布的 [Action 与 Resource 文件](https://github.com/context4ai/context/tree/main/packages/context-cli/context-workflow)；“工作图”弹层则把路由变化背后的静态 [`workspace.yaml`](https://github.com/context4ai/context/blob/main/packages/context-cli/context-workflow/graphs/workspace.yaml) 契约可视化。

请通过静态 HTTP 服务打开 `index.html`。GitHub Pages 发布地址为：

<https://context4ai.github.io/agent-graph/case-studies/context/?lang=zh>

本页面有意不进入 npm 包。它用于说明一项实际接入，不属于 Agent Graph 运行时代码。

## 视频素材

解说视频完成后，放入稳定路径 `assets/context-replay.mp4`，再从项目 README 链接或嵌入。视频负责解释案例，交互式回放继续作为可检查的路由行为记录，两者互不替代。
