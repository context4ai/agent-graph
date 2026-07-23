---
name: review-package-release
description: Review a package using the shared release provider.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: release
  agent-graph.entry: default
---

# Review package release

Use the same `release` graph but stop at any unresolved gate.
