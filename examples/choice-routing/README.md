# Deterministic route ranking

This example demonstrates compact alternative routes, deterministic `priority` ranking, and `join: any`. It intentionally does not model semantic choice.

In a real workflow, use `requiresFacts` or an explicit discovery Action to make only the options supported by observable state legal. Priority then ranks those legal options; it must not stand in for missing selection evidence.
