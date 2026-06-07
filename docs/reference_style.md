# Reference style

`src/pages/referenceContent.ts` is both the spec the Rust engine is tested
against and the player-facing mechanic documentation. Entries should read
naturally, and every `mechanics` / `policyDifferences` bullet should map to a
test.

The quickest way to match the house style is to open the file and copy a
nearby entry of the same kind. The points below are just what those entries
already do.

## Writing the bullets

- One atomic, testable claim per bullet. If you join two facts with "and",
  split them.
- Third person with fixed roles: *the user* owns the ability, *the target* is
  a specific recipient, *the opponent* is the generic other side, *the
  attacker* is whoever bit (in a defensive context). Not "you", not "the
  caster".
- Present tense and declarative. Spell words out - `does not`, not `doesn't`.
- Numbers: `X seconds`, `5%` (no space), `1.2x` multipliers; use `×` in inline
  formulas and define each variable next to it.
- Statuses: the in-game TitleCase display name (`Bleed`, `Bad Omen`), never
  the engine id (`Bleed_Status`). Write `N stacks of <Status>` (`stack of`
  for exactly one).

## mechanics vs notes

`mechanics` are testable claims; `notes` are non-testable context (combat-log
mentions, modeling caveats). If something in `notes` could be tested, move it
to `mechanics`.

Do not document a mechanic with no code behind it (stamina, movement,
positioning). Out-of-model abilities use the
`createOutOfModelAbilityEntry(name)` helper.

## Timing policies

An ability's `policyDifferences` describe the five timing modes - `really
fast`, `fast`, `semi-ideal`, `ideal`, `extreme` - grouping modes that behave
the same. If an ability has no policy-dependent behavior, say so in one line.

## Bookkeeping

- Entries are alphabetical by `name` within each array.
- `id` is stable: pick it once and never change it - tests bind to it.
- Reference, code, and observed game behavior must agree. When they diverge,
  raise it with the maintainer rather than guessing.
