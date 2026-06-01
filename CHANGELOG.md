# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-01

Initial public release.

### Added

- **Compare** — head-to-head matchup between two creature builds with full build
  customization (traits, veneration, plushies, breath, actives, and the effect
  catalog), rendering a turn-by-turn combat log and a result summary.
- **Best Builds** — exhaustive build search for a chosen creature against an
  opponent pool, ranked by win rate, time-to-kill, and damage delta.
- **Optimizer** — counter-mode build search: fix one creature's build and
  optimize the other against it.
- **Sandbox** — step-through matchup debugger: advance by time or by event,
  force-fire bite / breath / abilities, and inspect per-side internal state.
- **Custom** — author new abilities and timing policies in a text DSL or with a
  visual constructor, live-test them against the roster, and share them.
- **Search** — filter creatures by numeric stats with multi-field predicates.
- **Reference** — renders the mechanic spec describing what each status, ability,
  and plushie does.
- Deterministic combat engine written in Rust and compiled to WebAssembly, used
  as the single source of truth for all combat math across every page.

[1.0.0]: https://github.com/reptyd/cospvpcalc-public/releases/tag/v1.0.0
