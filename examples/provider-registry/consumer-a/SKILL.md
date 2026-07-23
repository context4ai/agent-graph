---
name: consumer-a
description: Resolve a shared Agent Graph provider through the host registry.
metadata:
  agent-graph: provider:shared.provider
  agent-graph.graph: main
  agent-graph.entry: default
---

# Consumer A

Ask the host to resolve `shared.provider`, then consume the selected route.
