# 迁移已有 Skill 与工作流

Import 只生成草案，不能仅根据文件顺序推断业务或安全语义。

## 已有 Agent Skill

```bash
agent-graph init ./provider --id product-workflow
agent-graph import skill ../legacy-skill/SKILL.md \
  --into ./provider \
  --graph legacy-capability
agent-graph validate --manifest ./provider/provider.yaml
```

Importer 会复制完整 Skill 目录，为副本 `SKILL.md` 加入相对 Locator，并生成一个 Agent Action 与 Graph。它保留原始指令，但不会把正文猜测拆成多个阶段。

导入后检查：

- 哪些操作应成为独立 Action；
- 哪些 Resource 只在某条 Route 中 required；
- Effect（`read`、`write`、`external`）；
- 人工 Gate 及其是否允许委托；
- 哪些 Facts 真正证明成功；
- `failed`、`partial`、`unverified` 与恢复转移；
- 重复任务的停止条件。

## 顺序脚本

```bash
agent-graph import scripts ./inspect.sh ./package.sh \
  --into ./provider \
  --graph package-flow
```

脚本会形成顺序 Graph，文件扩展名用于选择 Node、Bun、Python 或 Shell。Importer 无法知道脚本是否真的只读或会影响外部状态，因此必须检查生成的 Effect。

## 依赖工作流

```bash
agent-graph import workflow ./workflow.yaml --into ./provider
```

紧凑 Importer 会在写入前校验 Step 形状、缺失依赖、标准化 ID 冲突和依赖环，并保留 Command 与 `dependsOn` 关系，包括 fan-out 和 fan-in 可达性。多个根节点前会加入确定性 Start Action，所有叶节点后加入 Terminal。这种拓扑不表示并行执行：Agent Graph 每次选择一条 Primary Route。Importer 不执行模板、自由表达式、Secrets、Matrix 展开或供应商特定重试策略。

## `IMPORT_REPORT.md`

每次 Import 都会向 `provider.yaml` 旁的报告追加独立章节。已有同名 Graph、Action、Script 目录或 Skill 副本时，Import 会拒绝覆盖。报告是开发检查单，不是运行资源；其中有意列出禁止猜测的语义。应在 Graph、Action、Resource 和测试中补全这些缺口，然后按 Provider 仓库策略删除或归档报告。

## 安全迁移大型 Skill

1. 在不改源 Skill 的前提下导入。
2. 校验生成的 Provider。
3. 先加入一条覆盖当前主路径的 Graph Case。
4. 将确定性命令提取到 Action 文件。
5. 将长篇阶段规则移动到 Route Resource。
6. 在信任已记录成功前补充 Facts 与 `satisfiedBy`。
7. 加入显式 Gate 和失败/恢复 Outcome。
8. 可重复工作加入 Loop 测试。
9. 构建并测试可迁移 Bundle。
10. 最后才用更薄的已绑定入口替换原 Skill。

不要把每个段落都变成节点。节点表示可独立执行、受门禁、可恢复或可测试的状态转移；辅助解释应继续作为文件资源。
