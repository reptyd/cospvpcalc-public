# Ability Model Scope

Purpose: keep the same ability-scope language in docs, debug UI, and coverage reports.

Coverage categories used by the project:
- `modeled`: covered by the current stand-and-fight engine.
- `partial`: covered only for a verified subset of creatures or variants.
- `deferred`: intentionally postponed because reliable combat behavior data is still missing.
- `out-of-model`: intentionally excluded from the stand-and-fight model.
- `not-modeled`: still unresolved inside the model scope; neither implemented nor explicitly excluded.

Current practical disclaimer:
- Within the current stand-and-fight model, almost all relevant combat abilities are already implemented.
- The main remaining planned exceptions are `Snow Shield`, `Cocoon`, `Lich Mark`, and `Gourmandizer`.
- `Snow Shield` and `Cocoon` stay deferred because they still need in-game verification and a confirmed combat interpretation before they can be modeled safely.
- `Lich Mark` stays partial because full cross-creature behavior is still not documented well enough.
- `Gourmandizer` is expected to be added soon.
- Like any large combat model, there may still be unknown bugs or edge cases that have not been discovered yet.

## Explicitly out of model for stand-and-fight
- `Agile Swimmer`
- `Area Food Restore`
- `Area Water Restore`
- `Broodwatcher`
- `Burrower`
- `Change Weather`
- `Charge`
- `Climber`
- `Diver`
- `Egg Stealer`
- `Escape Area`
- `Grab`
- `Iron Stomach`
- `Latch`
- `Lure`
- `Mud Pile`
- `Pack Healer`
- `Raider`
- `Soft Landing`
- `Strength In Numbers`
- `Stamina Puddle`
- `Tail Drop`
- `Glittering Trail`
- `Vanish`
- `Will To Live`
- `Healing Pulse`
- `Heal Aura`
- `Dazzling Flash`
- `Speed Steal`
- `Healing Hunter`
- `Poison Area`
- `Shock Area`

Reason: these abilities depend on positioning, movement pressure, traversal, escape/engage control, pack/social context, world utility, or arena context that the current model intentionally does not simulate.

## Deferred due to insufficient reliable combat info
- `Cocoon`
- `Snow Shield`

Reason: these abilities may matter in PvP, but they still need in-game testing plus a confirmed interpretation of how they actually behave in combat. Until then, modeling them would require inventing mechanics.

## Partial coverage
- `Lich Mark`

Current scope: only the confirmed `Kaminaru` and `Kamigami` variants are modeled. Other cases remain intentionally partial because the remaining behavior details are still too incomplete to add with confidence.

## Stand-and-fight model decisions
- `Harden` is treated as an exact combat stat modifier in this model. Its movement penalty is out of scope and ignored.
- `Hunker` is modeled as a policy-driven combat stance. The speed penalty is out of scope, but the outgoing damage penalty and incoming damage reduction are kept.
- `Radiation` is modeled as an always-in-range, point-blank stand-and-fight aura that applies `Corrosion_Status` every 1 second at close-range severity.
- `Sticky Fur` is modeled as applying `Sticky_Teeth_Status` to melee attackers on bite.
- `Spite` is modeled as a next-bite modifier: it arms after use, charges linearly for 5s up to its listed value, applies to the next bite only, and doubles attacker-applied on-hit effects.
- `Reflux` is modeled as a guaranteed-hit stand-and-fight charge attack: 5s charge, 5% max HP direct hit, `Slow x2`, then a 10s puddle dealing 1.5% max HP and 0.5 `Corrosion_Status` per second.
- `Frost Snare` is modeled as a guaranteed stand-and-fight hit that applies only its relevant combat payload: `Frostbite +5`. The tether zone itself is out of scope.
- `Rewind` is modeled as restoring the user's HP and status state from 9s ago, with healing capped at 25% max HP. If the earlier HP was lower, the ability can still reduce current HP.
- `Shadow Barrage` is modeled as repeating the user's last melee hit damage from the last 10s, using its listed repeat count, 10% dropoff per hit, the user's attacker-applied bite payload on each barrage hit, and a 1s barrage cadence.
