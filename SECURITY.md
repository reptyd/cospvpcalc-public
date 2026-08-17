# Security policy

## Supported versions

Only the `main` branch is maintained. The repository carries no release tags, so report against a commit hash.

## Reporting a vulnerability

One maintainer works on this project. There is no formal disclosure timeline.

**Do NOT open a public issue for a vulnerability.** Instead, contact the maintainer privately:

- Email: `cos.pvp.contact@gmail.com` (preferred - see `package.json` `author`)
- GitHub: open a private security advisory at <https://github.com/reptyd/cospvpcalc-public/security/advisories/new>

Include in your report:

1. Affected version / commit hash.
2. A minimal reproduction (URL, steps, expected vs observed).
3. Impact assessment - what an attacker could do.
4. Suggested fix if you have one.

You will get an acknowledgement within 7 days. A fix timeline depends on severity and scope; high-severity issues (RCE, persistent XSS, data leakage) are prioritized over self-DoS or theoretical issues.

## Scope

In scope:

- The website at `cospvpcalc.ru` and any `*.cospvpcalc.ru` subdomain.
- The Rust engine in `wasm-engine/`, and the WASM bundle built from it in `src/rust-pkg/`.
- The TypeScript frontend in `src/`.

Out of scope:

- Self-XSS that requires a user to paste arbitrary code into devtools.
- Issues that only affect a forked/modified version of the code.
- Reports requiring access to a user's local machine (e.g. malicious browser extensions).
- Lack of rate limiting on the static site (it serves cached HTML / JS / WASM only - no backend to rate-limit).

## Defensive posture

- The site is fully static - no backend, no user accounts, no PII storage. Local-storage usage is documented in `docs/architecture.md`.
- Combat math runs in WebAssembly (Rust). The bundled `.wasm` filename carries a content hash (`vite.config.ts` `assetFileNames`).
- Dependabot (`.github/dependabot.yml`) opens update pull requests monthly for npm, cargo and GitHub Actions. The `audit` workflow (`.github/workflows/audit.yml`) blocks on high-severity npm advisories in production dependencies (`npm audit --omit=dev --audit-level=high`) and on any `cargo audit` advisory.
- React's default JSX escaping is the XSS baseline - no `dangerouslySetInnerHTML` is used.
- Content-Security-Policy is served via `public/_headers`.

## Acknowledgements

Reporters who follow this policy and act in good faith will be credited (with permission) in the release notes for the fix.
