# Ability Model Scope

One vocabulary for ability scope, used by this file, the coverage label and the coloured
ability list in Compare.

## Coverage categories

The vocabulary is the `AbilityScopeStatus` union in `src/pages/referenceContent.ts`:

- `modeled`: covered by the current stand-and-fight engine.
- `partial`: covered only for a verified subset of creatures or variants.
- `speed-builds-only`: nothing in a fight reads it, but Speed Builds carries one of its
  movement multipliers.
- `out-of-model`: intentionally excluded from the stand-and-fight model.
- `not-modeled`: outside the model and not decided - either deliberately shelved, or nothing
  has ruled on it yet.

## Where membership is decided

On the ability's own Reference entry, and nowhere else. `REFERENCE_ABILITY_SCOPE` maps each
entry's `status` field through `abilityScopeForStatus`, and every predicate downstream reads
that map. To see which abilities sit in a category, filter the entries on `status` rather
than consulting a list.

Do not add a list of names to this file or to `src/optimizer/abilityModelScope.ts`. Both
carried one, and both drifted from the entries: Compare-only abilities stayed listed as out of
model, Plasma Beam stayed listed as unmodelled while carrying a full entry and a reference
test, and three out-of-model abilities appeared in no list at all. A second source that can
disagree with the first is the bug. `src/optimizer/abilityModelScope.ts` still exists and its
header records the incident.

The nine `status` values an entry can carry collapse onto the five categories above: `Modeled`,
`Battle setting` and `Sandbox-only` all count as `modeled`, and `Not planned`, `Not modeled yet`
and `Disputed` all count as `not-modeled`. Three of the nine are unused today - no entry carries
`Sandbox-only`, `Not modeled yet`, or `Disputed`.

An ability is `Out of model` when its effect depends on positioning, movement, traversal,
escape or engage control, pack context, world utility, or arena context. The stand-and-fight
model simulates none of those. All 35 share one wording, from the
`createOutOfModelAbilityEntry` helper.

`Not planned` is the narrower bucket, for the few where a reader would expect the mechanic and
wonder at its absence; those entries carry `whyItsNotModeledHere` with the reason. Four
abilities hold it today: Damage Link, Heal Aura, Silly Beam, Snow Shield.

## Partial coverage

`Charge` and `Injury` are the only entries marked `Partial`. Each names the part it covers in
its own mechanics bullets.

## Stand-and-fight model decisions

These are the places where the model resolves an ambiguity rather than reading a number off
the game. Each ability's Reference entry states the resulting behavior in full.

- `Harden` and `Hunker` are combat stat modifiers whose movement penalties the fight ignores.
  The penalties are not out of scope for the project: both entries state them (Harden ×0.8 on
  walk, swim, sprint and flight; Hunker ×0.75 on walk, swim and sprint) and Speed Builds reads
  them. It is the fight that has no movement to apply them to.
- `Hunker` is driven by a policy rather than a fixed schedule, because the game leaves the
  choice to a player. Its outgoing ×0.5 and its incoming reduction are both kept.
- `Radiation` is modeled as an always-in-range, point-blank aura: it applies its own
  `Radiation` status, which ticks every 3 seconds for 0.5% max HP and lowers the target's
  positive ailment blocks for every ailment except itself.
- `Sticky Fur` applies 2 stacks of `Sticky Teeth` to whoever lands a direct attack on the user.
  Breath does not trigger it.
- `Spite` arms itself as soon as its cooldown elapses rather than waiting for a player, charges
  linearly over 5 seconds up to the user's Spite value, applies to the next direct melee hit
  only, and doubles the offensive ailments that hit inflicts.
- `Reflux` always lands: a 5 second charge, then direct damage of 5% of the target's max HP
  and 2 stacks of Slowed, then a puddle for 10 seconds that ticks once per second for 1.5% of
  the target's max HP and 0.5 stacks of Corrosion.
- `Frost Snare` is a guaranteed hit carrying only its combat payload, 5 stacks of Frostbite.
  The tether zone is out of scope.
- `Rewind` restores HP toward the user's value from 9 seconds earlier, capped at 25% max HP.
  It restores HP only - statuses are not rewound.
- `Shadow Barrage` repeats the user's last melee hit from the previous 10 seconds, for a count
  equal to its value, each hit scaled by 0.9^i. All hits land as one burst at activation rather
  than over a cadence, and each reapplies the user's on-hit offensive effects.
