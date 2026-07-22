---
name: consumer-b
description: Use the same host-resolved provider without copying graph definitions.
metadata:
  agent-graph: provider:shared.provider
---

# Consumer B

Ask the host to resolve `shared.provider`, then consume the selected route.
