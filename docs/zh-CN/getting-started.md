# 快速开始

本文是面向已选定[接入场景](./adoption-paths.md)作者的技术教程。执行这些命令只会创建 Provider 开发工程，并不会自动完成 Skill 或宿主接入。

## 1. 创建 Provider

```bash
npx @c4a/agent-graph@0.2.1 init ./example-provider --id example-provider
cd example-provider
```

生成目录包含 Provider Manifest、一张 Graph、一个 Action、一个薄 Skill、一个 Procedure Resource、一个 Code Catalog 和一个图测试，不会生成运行目录。宿主可以选择 `.agent-graph-runtime/` 之类的忽略目录，但协议不保留这个名字。

## 2. 校验和测试

```bash
npx @c4a/agent-graph@0.2.1 validate --format json
npx @c4a/agent-graph@0.2.1 test tests --format json
```

校验范围包括 JSON Schema、相对路径边界、ID、引用、Graph Entry、显式 Terminal、Edge 端点、Subgraph 调用、跨 Graph 递归、动态 Resource Materializer 和重复身份。校验不会执行 Action。

## 3. 发现当前路线

```bash
npx @c4a/agent-graph@0.2.1 evaluate main --format json
```

结果包含稳定状态码、Revision 摘要、主路线、备选路线和简洁诊断。每个 Route Summary 都有稳定 `reasonCode`；可选 Code Catalog 可以补充短提示和文件化解释。结果不会内联 Skill 或 Procedure 正文。

解析选中的路线：

```bash
npx @c4a/agent-graph@0.2.1 route main <route-id> --revision <revision> --format json
```

两个值都应取自同一次 Evaluation。若求值和解析之间的 Graph 输入或相关 Provider 文件发生变化，CLI 会拒绝过期 Revision，而不是返回不匹配的执行计划。

Route 包含：

- 一个选中的 Node 及其调用路径；
- 适用时的 Command 或 Host Handler 计划；
- Required 和 Recommended Resource Location；
- 可选 Gate；
- 执行后应记录的 State Key。

静态资源以带内容摘要的文件返回。动态 Context View 返回物化描述，必须显式执行 Materialize。

生成的 Skill 已完整绑定 Provider、Graph 与 Entry，因此同一次求值可以省略 Graph：

```bash
npx @c4a/agent-graph@0.2.1 \
  --skill ./skills/getting-started/SKILL.md \
  evaluate --format json
```

## 4. 用 Run 承载长任务

```bash
npx @c4a/agent-graph@0.2.1 run start main \
  --state ./runtime/run.json \
  --workspace "$PWD"

npx @c4a/agent-graph@0.2.1 run status \
  --manifest ./provider.yaml \
  --state ./runtime/run.json \
  --format json
```

完成路线后，使用 `afterAction.recordNode` 返回的准确 State Key：

```bash
npx @c4a/agent-graph@0.2.1 run record main/work completed \
  --state ./runtime/run.json
```

随后重新求值。历史 `completed` 不会覆盖缺失的事实校验；Graph 可以转入 Verify 或 Recovery。

## 5. 构建可迁移 Bundle

```bash
npx @c4a/agent-graph@0.2.1 build ./dist/provider --format json
node ./path/to/agent-graph.mjs --manifest ./dist/provider/manifest.json validate
```

Bundle 只复制可达 Provider 文件，写入规范化 Provider 元数据，记录内容摘要，生成 Graph 依赖索引，并且不包含来源机器绝对路径。
