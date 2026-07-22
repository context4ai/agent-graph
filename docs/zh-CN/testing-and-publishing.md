# 测试与发布

## 测试行为，而不是文案

Graph Case 提供 Facts、Outcomes 与 Authorities，并断言 Evaluation 契约：

```yaml
schema: agent-graph.test.v1
name: missing proof routes to verification
graph: build
entry: default
state:
  outcomes:
    build/package: completed
expect:
  statusCode: actionable
  primaryNode: verify-artifact
```

可断言 `statusCode`、`primaryNode`、终态 `outcome` 和必须存在的诊断码。测试不会执行命令或调用 Agent，因此快速且确定。
测试路径不存在或不含 Case 时会报错，不会把空集合当成通过。

## 推荐 Case 矩阵

每张生产 Graph 至少覆盖：

- 初始路线；
- 确定性 Primary/Alternative 排序与紧凑路线截断；
- 每种分支 Outcome；
- 用户 Gate 和显式委托后的 Gate；
- 缺失必需 Fact；
- Fact 支持的完成；
- 已声称完成但缺少证明的 `unverified`；
- `partial` 与 `failed` 批次恢复；
- 实际使用的 `join: all` 与 `join: any`；
- Repeat 继续与终态停止；
- Subgraph 子路线和父 Graph 继续；
- 所有预期阻塞执行的诊断。

静态 Validation 另行覆盖缺失文件、重复 ID、非法路径、缺失 Subgraph Entry、非法 Repeat Target 和递归。

## 命令

```bash
agent-graph validate --manifest provider.yaml
agent-graph test tests --manifest provider.yaml
agent-graph build dist/provider --manifest provider.yaml
agent-graph validate --manifest dist/provider/manifest.json
```

在携带 Provider 的产品打包前，于 CI 中执行这些命令。

## 确定性 Bundle 内容

`build` 只复制运行时可达文件：

- Provider Graph；
- 被引用 Action；
- Action entry、输入/输出 Schema 与声明的 `files`；
- 被引用 Agent Skill 的独立目录，或根目录 Skill 及其显式声明文件；
- 静态 Resource 定义及其原生内容文件；
- 动态 Resource 定义；
- 动态 Materializer Action 与文件。

测试与无关开发文件不进入 Bundle。生成的 `manifest.json` 记录目录、每个复制文件的 digest、同 Provider Graph 依赖和整体 digest。Manifest 不包含时间戳，因此相同输入产生相同结果。

通过构建后的 `manifest.json` 加载时，会在 Graph Evaluation 前校验整体 Manifest Digest、每个登记文件 Digest、Provider 身份、Catalog 与文件集完整性、Graph 依赖索引，以及登记的 Provider Manifest。

## npm 发布

本仓库发布工具链自身：

```bash
bun run verify
npm pack --dry-run
npm publish
```

Provider 项目可以依赖 `agent-graph`，并在自己的包里发布 Provider Bundle；也可把 `dist/agent-graph.mjs` 复制到 Bundle 旁边，提供无需安装的 CLI 入口。该单文件在 Node.js 20+ 下完成校验和路由，不是另一套实现。

自动化临时执行时应固定版本：

```bash
npx @c4a/agent-graph@0.1.1 --manifest ./provider.yaml validate
```

## 包审计清单

发布前检查：

1. `package.json` 的 name、version、license、repository、exports 和 bin 正确；
2. Tarball 包含 LICENSE、README、手册、公共 Schema、Template、SDK 与可执行 CLI；
3. `node dist/agent-graph.mjs --version` 成功；
4. 单独复制 CLI 后仍能校验 Provider；
5. 安装后的 SDK 能导入 `loadProvider`、`evaluateGraph` 和 `resolveRoute`；
6. Tarball 和 Bundle 元数据不含源码机器绝对路径；
7. Provider Digest 与安装文件匹配；
8. `path:` Skill 绑定迁移位置后仍能解析；
9. `provider:` 绑定可通过干净 Registry 解析；
10. 动态物化只写显式 Cache；
11. 测试不包含凭证、业务数据或机器路径。

## Source、Link、Pack 与 Registry 一致性

同一 Provider 在不同安装方式下应返回相同 Graph/Action/Resource 身份。绝对 `filePath` 会因 BundleResolver 选择的安装位置而不同。Route ID 绑定 Revision；相关定义或路由输入变化时会同时产生新 Revision 和新 Route ID。

## 安全边界

Validation 证明结构完整性，不证明任意命令安全。Provider 作者与安装宿主必须把 Action command、effect、script 和 resource 作为可执行供应链内容审查。`external` Effect 通常应置于显式 Gate 或产品策略之后。
