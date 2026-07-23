---
name: "{{providerId}}-operator"
description: Execute the current Agent Graph route using only its declared resources and action contract.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: main
  agent-graph.entry: default
---

# Operator

Evaluate the graph, resolve one current route, read its required resources, execute only that route, record an explicit outcome, and evaluate again.
