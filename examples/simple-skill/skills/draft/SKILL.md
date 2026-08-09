---
name: draft-artifact
description: Draft an artifact using only the requirements selected by the current route.
metadata:
  agent-graph: path:../../provider.yaml
  agent-graph.graph: main
  agent-graph.entry: default
---

# Draft artifact

Read the required route resources marked `read-required`, produce the artifact, and report an explicit outcome.
