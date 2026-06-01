# Security policy

## Supported versions

Only the `main` branch is actively maintained. Prior tags are not patched; if you need a fix on an older tag, open an issue and we'll help you rebase onto `main`.

## Reporting a vulnerability

This is a single-maintainer hobby project. There is no formal disclosure timeline, but vulnerabilities are taken seriously.

**Do NOT open a public issue for a vulnerability.** Instead, contact the maintainer privately:

- Email: `cos.pvp.contact@gmail.com` (preferred — see `package.json` `author`)
- GitHub: open a private security advisory at <https://github.com/reptyd/cospvpcalc-public/security/advisories/new>

Include in your report:

1. Affected version / commit hash.
2. A minimal reproduction (URL, steps, expected vs observed).
3. Impact assessment — what an attacker could do.
4. Suggested fix if you have one.

You'll get an acknowledgement within 7 days. A fix timeline depends on severity and scope; high-severity issues (RCE, persistent XSS, data leakage) are prioritized over self-DoS or theoretical issues.

## Scope

In scope:

- The website at `cospvpcalc.ru` and any `*.cospvpcalc.ru` subdomain.
- The published `wasm-engine` Rust crate when used as documented.
- The TypeScript frontend in `src/`.

Out of scope:

- Self-XSS that requires a user to paste arbitrary code into devtools.
- Issues that only affect a forked/modified version of the code.
- Reports requiring access to a user's local machine (e.g. malicious browser extensions).
- Lack of rate limiting on the static site (it serves cached HTML / JS / WASM only — no backend to rate-limit).

## Defensive posture

- The site is fully static — no backend, no user accounts, no PII storage. Local-storage usage is documented in `CONTRIBUTING.md`.
- Combat math runs in WebAssembly (Rust); the WASM module is content-hashed and integrity-verifiable.
- Dependencies are auto-updated via Dependabot (`.github/dependabot.yml`); high-severity advisories block CI before merge.
- React's default JSX escaping is the XSS baseline — no `dangerouslySetInnerHTML` is used.
- Content-Security-Policy is served via `dist/_headers`; modifications require security review.

## Acknowledgements

Reporters who follow this policy and act in good faith will be credited (with permission) in the release notes for the fix.
