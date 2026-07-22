# Independent verification pattern

This example separates artifact production from verification without adding a special reviewer node type.

- `produce` is an Agent action with a write effect.
- `verify` is a read-effect host action that requires the observed artifact digest.
- `verification.receipt` is the external fact that proves verification completed.
- a recorded success without that receipt becomes `unverified` and repeats verification.

The Provider declares the boundary; the host must enforce it. Bind `verifier.independent` to a read-only verifier whose identity and permissions are independent from the producing Agent. `effect: read` is inspectable intent, not an operating-system sandbox.
