---
name: fact-driven-batch
description: Process a host-owned batch through a static Agent Graph.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: main
  agent-graph.entry: default
---

# Fact-driven batch

Evaluate the bound graph, resolve its primary route, read required resources, and
delegate host handlers to the integration host. The host owns target selection and
refreshes Facts after every action.
