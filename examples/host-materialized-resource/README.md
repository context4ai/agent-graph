# Host-materialized Resource

This example exposes a versioned `resource-location.v2` envelope for a
Context View that only an integrating host can materialize. Agent Graph
validates the Provider-owned input and schema references, preserves the
handler, structured input, and output schema in the Route, and never executes
the host action. The Host result chooses an inline or managed-resource output.
The graph cases also show fact-backed completion and an `unverified` recovery
route after a claimed completion loses its persisted Host output.
