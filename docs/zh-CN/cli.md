# CLI 参考

## 运行方式

所有方式运行同一份打包 CLI：

```bash
agent-graph ...                    # 已安装命令
npx @c4a/agent-graph@0.2.0 ...    # npm 临时运行
bunx @c4a/agent-graph@0.2.0 ...   # Bun 临时运行
node ./agent-graph.mjs ...         # Provider 随包携带的单文件
```

单文件以 Node.js 20+ 为运行目标。仓库源码开发使用 Bun；Provider Action 可声明 Node、Bun、Python 或 Shell Runtime。

## 全局选项

| 选项 | 含义 |
|---|---|
| `--manifest <path>` | 源码 Provider Manifest 或构建后的 Bundle Manifest，默认 `provider.yaml` |
| `--skill <path>` | 通过 Skill 的 `agent-graph*` metadata 解析 Provider、Graph 与 Entry |
| `--registry <path>` | 解析 `provider:` Skill Locator 的 Registry |
| `--format human|json` | 简洁终端输出或结构化 JSON |

存在 `--skill` 时，其完整绑定选择 Provider、Graph 与 Entry；显式传入冲突的 Graph 或 Entry 会被拒绝。Agent 与自动化应使用紧凑单行 JSON；人工检查可使用 `human`，或把 JSON 交给格式化工具。

## 开发命令

### `init [directory] --id <id>`

创建最小 Provider、Agent Action、已绑定 Skill、Procedure 示例、Code Catalog 和 Route 测试。即使 `provider.yaml` 尚不存在，也拒绝覆盖任何将要生成的路径。

### `import skill <SKILL.md> --into <provider-root> [--graph <id>]`

复制完整 Skill 目录，为副本加入相对 Agent Graph 绑定，创建 Agent Action 与 Graph，追加到 Provider，并写入 `IMPORT_REPORT.md`。

### `import scripts <files...> --into <provider-root> [--graph <id>]`

复制脚本并创建顺序 Graph。Runtime 根据扩展名推断；Effect 默认 `write`，应人工检查生成的 Action。

### `import workflow <yaml-or-json> --into <provider-root> [--graph <id>]`

接受以下紧凑旧工作流：

```yaml
id: release
steps:
  - id: test
    command: npm test
    effect: read
  - id: publish
    command: npm publish
    dependsOn: [test]
    effect: external
```

Dependency 转为 Edge，fan-in 使用默认 `all`。Importer 不会编造门禁、事实、恢复语义或成功证明；这些待确认项会写入 `IMPORT_REPORT.md`。

## 校验与发现

### `validate`

加载完整可达 Provider，返回 `valid` 或结构化错误，不产生 Action 副作用。

### `inspect provider`

列出 Graph、Entry、节点数、依赖、Action、Resource 和路径。

### `inspect skill <SKILL.md>`

显示完整绑定与解析后的 Provider；`provider:` Locator 需要提供 `--registry`。

### `schema list`、`schema path <name>` 与 `schema extract <name> --output <path>`

发现 npm 安装中的 JSON Schema 文件。单文件 CLI 已内嵌校验 Schema；旁边没有公共 Schema 目录时，仍可用 `schema extract` 写到显式路径。

## Agent 路由

### `evaluate [graph]`

选项：

- `--entry <name>`，默认为 `default`；
- `--state <run.json>`；
- `--facts '<json>'` 或 `--facts @facts.json`；
- `--outcomes '<json>'` 或 `--outcomes @outcomes.json`；
- `--authority <id...>`。

提供 `--state` 时从 Run 读取 facts、outcomes 与 authorities；直接参数会在当前调用中覆盖 Run。无 Run 时可提供字符串 Outcome，例如 `--outcomes '{"release/inspect":"completed"}'`。

使用 `--skill` 时省略 `graph`，完整 Skill 绑定是权威选择。

### `route <graph> [route-id]` 或 `--skill <SKILL.md> route [route-id]`

使用同样的 Evaluation 选项。省略 route ID 时解析当前 primary route。Agent 应传入上一次 Evaluation 的 `--revision <digest>`；Revision 已变化时会返回 `route-revision-stale`。不可用 ID 返回 `route-stale`。Route 解析只定位文件，不执行命令或 Materializer。

## 显式 Run 管理

```text
run start <graph> --state <path>
run status --state <path>
run record <node-key> <outcome> --state <path> [--detail <json>]
run facts --state <path> --set <json> [--replace]
run authority --state <path> [--set <id...>]
run checkpoint --state <path> --to <path>
run resume <checkpoint> --state <path>
run events --state <path>
```

`run status` 会重新评估 Graph，因此也需要 Provider 选项；纯修改命令只操作显式且通过 Schema 校验的 Run 文件。`run record` 应使用 `route.afterAction.recordNode` 返回的完全限定键。

## Resource

### `resource locate <id-or-path>`

返回已安装静态文件与 digest；动态资源返回物化引用。

### `resource materialize <id-or-path> --cache <directory> --revision <digest>`

附加选项：

- `--workspace <directory>`，默认当前目录；
- `--input '<json>'` 或 `--input @input.json`；
- `--timeout-ms <milliseconds>`，默认 `30000`；
- `--max-output-bytes <bytes>`，默认 `10485760`；
- `--max-error-bytes <bytes>`，默认 `1048576`。

`revision` 应使用选择该 Context View 的 Route Revision。只接受 read effect 的 command 或 script Materializer。进程只继承最小环境，不会继承宿主全部变量；超限时在写入 Cache Receipt 前终止。生成文件使用内容寻址名称，Location 与 Receipt 都保留选择它的 Revision，宿主据此拒绝过期上下文。Read Effect 是契约，不是沙箱。

## 稳定 Code

### `code list`

列出 Provider 的可选 Code Catalog。Route 推荐原因使用 `kind: route-reason`，产品诊断使用 `kind: diagnostic`。

### `code locate <code>`

返回稳定 code、短摘要与可选静态文档位置，不把文档正文打印到 stdout。Agent 使用 code 做机器分支，只在需要解释时读取返回的文件。

## 测试与构建

### `test [file-or-directory]`

递归执行全部 YAML/JSON Graph Case；任一断言失败会设置非零退出码。

### `build [output]`

生成确定性 Provider Bundle，默认 `dist/provider`。输出可以位于源码树内，但不能替换任何已引用源码。

## 错误 Envelope

使用 `--format json` 时，错误写入 stderr：

```json
{
  "schema": "agent-graph.error.v1",
  "state": "error",
  "error": {
    "code": "route-stale",
    "message": "...",
    "diagnostics": []
  }
}
```

自动化应按 `error.code` 与诊断码分支，而不是解析 message 文本。
