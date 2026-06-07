# Friendly UI (parked - not dead code)

This directory holds the **"Friendly" alternative UI/UX** for the site: a
second, simpler front-end skin over the same Rust + WASM combat engine.

**Status: intentionally parked.** It was cut from the app's router as
outdated and is deliberately kept for possible future revival - it is
**not** orphaned/dead code to be deleted.

By design, nothing outside `src/friendly/` imports this subtree. A dead-code
scan will flag the whole directory as "unreachable" - that is expected, not
a problem. **Skip this directory when auditing for dead code.**

To revive it, wire `FriendlyExperiencePage` back into
[`src/AppPageRouter.tsx`](../AppPageRouter.tsx).
