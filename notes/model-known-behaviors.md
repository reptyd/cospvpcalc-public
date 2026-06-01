## Model Known Behaviors

Purpose: one place to record what the combat model currently does, especially where the behavior is approximate, intentionally limited, or surprising.

Rules for this file:
- Record confirmed current behavior, not guesses.
- Prefer linking the behavior to a test or a code location.
- Do not silently "fix" any item here without either a source-based reason or an explicit design decision.

### Core assumptions
- Simulation is 1v1, standing, point-blank, pack off, environment off.
- Plushies apply after other stat modifiers.
- Some passive and active abilities in data are still not modeled.
- Harden uses its combat stat changes directly; movement penalty is ignored as out-of-model.
- Hunker is treated as a stand-and-fight stance decision; speed penalty is ignored, damage tradeoff is preserved.
- Rewind restores HP and statuses from 9s ago; position is out of scope.

### Structured approximations already represented in code
Source: [approximationNotes.ts](C:/Users/Tuma/Desktop/My_Project/COS_calc/src/engine/approximationNotes.ts)

- `TWO_FACED_TRANQUILITY_ONLY`: Two-Faced is modeled as Tranquility-only.
- `ADRENALINE_COOLDOWN_APPROX`: Adrenaline uses an approximate cooldown.
- `REFLUX_HUNGER_UNMODELED`: Reflux uses a one-cast-at-a-time approximation because hunger gating is out of model.
- `SHADOW_BARRAGE_CADENCE_ASSUMED`: Shadow Barrage cadence is modeled as 1 hit per second.
- `HP_REGEN_ORDERING_TODO`: HP regen plushie ordering is not fully resolved.
- `BREATH_TYPE_MISSING`: missing breath type falls back to an approximate DPS estimate.
- `BREATH_RECOIL_SELF_TICK`: breath recoil is modeled as self-tick damage.
- `HEAL_BEAM_SELF_NO_EFFECT`: Heal Beam has no direct 1v1 self effect.
- `BREATH_DPS_MISSING`: missing breath DPS data results in no breath damage.
- `BREATH_TICK_RESOLUTION`: breath tick resolution is approximated as 1 second.
- `FIRST_STRIKE_VALUE_MISSING`: missing First Strike value is ignored.
- `UNBRIDLED_RAGE_STAMINA_UNMODELED`: stamina pool effects are not modeled.
- `FROST_NOVA_VALUE_MISSING`: missing Frost Nova value uses an approximate default.
- `LICH_MARK_UNMODELED`: some Lich Mark cases are not modeled.
- `REFLECT_STATUS_UNQUANTIFIED`: reflect-status damage amount is not quantified.
- `SELF_DESTRUCT_DELAY_DEFAULTED`: Self-Destruct defaults to a 1s delay when unspecified.

### README-level limitations that should stay visible
Source: [README.md](C:/Users/Tuma/Desktop/My_Project/COS_calc/README.md)

- Plushies with empty `modifiersParsed` are ignored.
- Plushie takeoff stamina cost is not modeled.
- Healing trait is not mapped to a combat stat.
- Ability coverage is incomplete; many abilities in data are still not modeled.
- Breath recoil and ailment parsing are best-effort.
- Warden's Rage uses a simple heuristic policy, not a full decision search.
- Necropoison, Sticky Teeth, and similar threshold interactions are approximated.
- Explicit ability scope decisions live in [ability-model-scope.md](C:/Users/Tuma/Desktop/My_Project/COS_calc/notes/ability-model-scope.md).

### Confirmed current quirks

#### Spirit Glare auto-fire gating
- Confirmed by test: [engine.breath.test.ts](C:/Users/Tuma/Desktop/My_Project/COS_calc/src/engine/engine.breath.test.ts)
- Relevant code: [breathResourceRuntime.ts](C:/Users/Tuma/Desktop/My_Project/COS_calc/src/engine/breathResourceRuntime.ts), [breathSpecialRuntime.ts](C:/Users/Tuma/Desktop/My_Project/COS_calc/src/engine/breathSpecialRuntime.ts)
- Current behavior:
  - when `Spirit Glare` starts from empty breath capacity, the runtime arms an auto-fire delay and also sets a cooldown gate;
  - status application does not happen during the short delay window;
  - `Burn` and `Fear` are only observed after the cooldown gate is passed in the current implementation.
- Status: recorded as current behavior, not corrected.
- Reason for caution: this may or may not match intended gameplay timing, so it should not be changed without an explicit source-based decision.

### Regression tests that currently protect model behavior
- Status runtime: [engine.statuses.test.ts](C:/Users/Tuma/Desktop/My_Project/COS_calc/src/engine/engine.statuses.test.ts)
- Active ability regressions: [engine.specials.test.ts](C:/Users/Tuma/Desktop/My_Project/COS_calc/src/engine/engine.specials.test.ts)
- Breath regressions: [engine.breath.test.ts](C:/Users/Tuma/Desktop/My_Project/COS_calc/src/engine/engine.breath.test.ts)
- Golden scenarios: [engine.golden.test.ts](C:/Users/Tuma/Desktop/My_Project/COS_calc/src/engine/engine.golden.test.ts)
- Optimizer flow regressions: [optimizerPageFlow.test.ts](C:/Users/Tuma/Desktop/My_Project/COS_calc/src/optimizer/optimizerPageFlow.test.ts), [optimizer.test.ts](C:/Users/Tuma/Desktop/My_Project/COS_calc/src/optimizer/optimizer.test.ts)

### Next behaviors worth locking down
- Special-event timing order for `Self-Destruct`, `Totem`, and `Channeling Pulse`.
- Fight-loop sequencing around simultaneous hits and death snapshots.
- Breath cases with auto-fire plus cooldown plus resource refill.
- Additional golden scenarios for more representative real matchups, especially breath-heavy and reflect-heavy cases.
