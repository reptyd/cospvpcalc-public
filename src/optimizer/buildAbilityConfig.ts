import type { CreatureRuntime } from "../engine";
import { effectsCatalog } from "../engine/data";
import { BAD_OMEN_DEFAULT_OUTCOME } from "../engine/subsystems/statuses";
import { hasAbilityName, normalizeAbilityName, resolveStatusId } from "../engine/runtimeHelpers";
import {
  resolveAuraSubtype,
  resolveGenericTrail,
  resolveRuntimeAbilityValue,
  resolveTotemStatusId,
} from "./runtimeAbilityValue";
import type { RustComposableAbilityConfig } from "./rustMatchupBridge";

// ---------------------------------------------------------------------------
// Unified ability-config builder.
//
// Best Builds and Compare both feed a `RustComposableAbilityConfig` to the
// composable engine. They used to build the overlapping ability fields by two
// unrelated mechanisms - BB through a flat object literal, Compare through a
// `base + addAbilityPresenceFields + addTrailValues` chain - so a gated ability
// had to be wired into both. This builder is the one place the registry-gated
// ability fields are produced; each path calls it with the inputs that capture
// its own context (disabled sets, trail toggles, Hunker reduction), and the two
// paths produce byte-identical output for the shared surface.
//
// Compare-only runtime flags (charges, hunger, posture, first-tick, ...) and
// the per-fight environment knobs are layered on by the Compare caller after
// this builder; they never overlap with what BB sets, so they stay out here.
// ---------------------------------------------------------------------------

function hasActivatedAbilityNamed(creature: CreatureRuntime, abilityName: string): boolean {
  const normalized = normalizeAbilityName(abilityName);
  return (
    (creature.activatedAbilities ?? []).some((ability) => normalizeAbilityName(ability.name) === normalized) ||
    hasAbilityName(effectsCatalog[creature.name] ?? {}, abilityName)
  );
}

function numericAbilityValue(creature: CreatureRuntime, name: string): number {
  const raw = resolveRuntimeAbilityValue(creature, name);
  return typeof raw === "number" ? raw : 0;
}

function stringAbilityValue(creature: CreatureRuntime, name: string): string | null {
  const raw = resolveRuntimeAbilityValue(creature, name);
  return typeof raw === "string" ? raw : null;
}

function lichMarkPayloadStatusId(creature: CreatureRuntime): string | null {
  const raw = resolveRuntimeAbilityValue(creature, "Lich Mark");
  if (typeof raw !== "string") return null;
  return resolveStatusId(raw) ?? `${raw.replace(/[^A-Za-z0-9]+/g, "_")}_Status`;
}

/** Per-side trail magnitudes (the four flavor trails + Healing Step + the
 *  generic non-flavor channel). Resolved only when the side's trail toggle is
 *  on; every value is 0 / null otherwise. */
function trailFieldsForSide(
  creature: CreatureRuntime,
  enabled: boolean,
): {
  healingStepValue: number;
  flameTrailValue: number;
  frostTrailValue: number;
  plagueTrailValue: number;
  toxicTrailValue: number;
  trailStatusId: string | null;
  trailValue: number;
} {
  const generic = enabled ? resolveGenericTrail(creature) : null;
  return {
    healingStepValue: enabled ? numericAbilityValue(creature, "Healing Step") : 0,
    flameTrailValue: enabled ? numericAbilityValue(creature, "Flame Trail") : 0,
    frostTrailValue: enabled ? numericAbilityValue(creature, "Frost Trail") : 0,
    plagueTrailValue: enabled ? numericAbilityValue(creature, "Plague Trail") : 0,
    toxicTrailValue: enabled ? numericAbilityValue(creature, "Toxic Trail") : 0,
    trailStatusId: generic?.statusId ?? null,
    trailValue: generic?.value ?? 0,
  };
}

export type BuildAbilityConfigInput = {
  sourceCreature: CreatureRuntime;
  opponentCreature: CreatureRuntime;
  /**
   * Per-side passive-Hunker reduction percent, OR'd into the Hunker flag so a
   * carrier whose Hunker sits in `passiveAbilities` (no activated entry) still
   * flips the flag. BB resolves this from `getHunkerReductionPct`; Compare
   * reuses the same value through its shared base. Default 0 leaves the flag
   * driven purely by the activated-ability presence check.
   */
  hunkerReductionPctA?: number;
  hunkerReductionPctB?: number;
  /**
   * Whether to emit the damage-trail fields, gated per side. BB omits the
   * trail surface entirely (the flags are absent from its config); Compare
   * emits it, gated by the per-side "Trails" toggle. When false, the trail
   * fields are left off so BB's config stays byte-identical to the old literal.
   */
  includeTrails?: boolean;
  trailsA?: boolean;
  trailsB?: boolean;
};

/**
 * Build the registry-gated ability fields of a `RustComposableAbilityConfig`
 * shared by Best Builds and Compare. Field order follows the historical BB
 * literal so a serialized config stays stable for both callers.
 */
export function buildAbilityConfig(input: BuildAbilityConfigInput): RustComposableAbilityConfig {
  const { sourceCreature: a, opponentCreature: b } = input;
  const hunkerA = input.hunkerReductionPctA ?? 0;
  const hunkerB = input.hunkerReductionPctB ?? 0;

  const config: RustComposableAbilityConfig = {
    // Deterministic Bad Omen follow-up for the search paths (Best Builds /
    // Optimizer): a single fixed outcome (Burn +8). Compare and Sandbox replace
    // this with a freshly-rolled random batch - Bad Omen is a random ability.
    badOmenOutcomes: [BAD_OMEN_DEFAULT_OUTCOME],
    attackerThornTrap: hasActivatedAbilityNamed(a, "Thorn Trap"),
    defenderThornTrap: hasActivatedAbilityNamed(b, "Thorn Trap"),
    attackerToxicTrap: hasActivatedAbilityNamed(a, "Toxic Trap"),
    defenderToxicTrap: hasActivatedAbilityNamed(b, "Toxic Trap"),
    attackerFrostSnare: hasActivatedAbilityNamed(a, "Frost Snare"),
    defenderFrostSnare: hasActivatedAbilityNamed(b, "Frost Snare"),
    attackerPoisonArea: hasActivatedAbilityNamed(a, "Poison Area"),
    defenderPoisonArea: hasActivatedAbilityNamed(b, "Poison Area"),
    attackerYolkBomb: hasActivatedAbilityNamed(a, "Yolk Bomb"),
    defenderYolkBomb: hasActivatedAbilityNamed(b, "Yolk Bomb"),
    attackerYolkBombValue: stringAbilityValue(a, "Yolk Bomb"),
    defenderYolkBombValue: stringAbilityValue(b, "Yolk Bomb"),
    attackerAuraSubtype: resolveAuraSubtype(a),
    defenderAuraSubtype: resolveAuraSubtype(b),
    attackerCursedSigilStacks: numericAbilityValue(a, "Cursed Sigil"),
    defenderCursedSigilStacks: numericAbilityValue(b, "Cursed Sigil"),
    attackerFortify: hasActivatedAbilityNamed(a, "Fortify"),
    defenderFortify: hasActivatedAbilityNamed(b, "Fortify"),
    attackerDrowsyArea: hasActivatedAbilityNamed(a, "Drowsy Area"),
    defenderDrowsyArea: hasActivatedAbilityNamed(b, "Drowsy Area"),
    attackerUnbridledRage: hasActivatedAbilityNamed(a, "Unbridled Rage"),
    defenderUnbridledRage: hasActivatedAbilityNamed(b, "Unbridled Rage"),
    attackerHuntersCurse: hasActivatedAbilityNamed(a, "Hunters Curse"),
    defenderHuntersCurse: hasActivatedAbilityNamed(b, "Hunters Curse"),
    attackerLifeLeechValue: numericAbilityValue(a, "Life Leech"),
    defenderLifeLeechValue: numericAbilityValue(b, "Life Leech"),
    attackerRewind: hasActivatedAbilityNamed(a, "Rewind"),
    defenderRewind: hasActivatedAbilityNamed(b, "Rewind"),
    attackerWardenRage: hasActivatedAbilityNamed(a, "Warden's Rage"),
    defenderWardenRage: hasActivatedAbilityNamed(b, "Warden's Rage"),
    attackerAdrenaline: hasActivatedAbilityNamed(a, "Adrenaline"),
    defenderAdrenaline: hasActivatedAbilityNamed(b, "Adrenaline"),
    attackerLichMark: hasActivatedAbilityNamed(a, "Lich Mark"),
    defenderLichMark: hasActivatedAbilityNamed(b, "Lich Mark"),
    attackerLichMarkPayloadStatusId: lichMarkPayloadStatusId(a),
    defenderLichMarkPayloadStatusId: lichMarkPayloadStatusId(b),
    attackerSpiteValue: numericAbilityValue(a, "Spite"),
    defenderSpiteValue: numericAbilityValue(b, "Spite"),
    attackerFrostNova: hasActivatedAbilityNamed(a, "Frost Nova"),
    defenderFrostNova: hasActivatedAbilityNamed(b, "Frost Nova"),
    attackerReflux: hasActivatedAbilityNamed(a, "Reflux"),
    defenderReflux: hasActivatedAbilityNamed(b, "Reflux"),
    attackerTotem: hasActivatedAbilityNamed(a, "Totem"),
    defenderTotem: hasActivatedAbilityNamed(b, "Totem"),
    attackerTotemStatusId: resolveTotemStatusId(a),
    defenderTotemStatusId: resolveTotemStatusId(b),
    attackerGuardiansPassage: hasActivatedAbilityNamed(a, "Guardians Passage"),
    defenderGuardiansPassage: hasActivatedAbilityNamed(b, "Guardians Passage"),
    attackerReflect: hasActivatedAbilityNamed(a, "Reflect"),
    defenderReflect: hasActivatedAbilityNamed(b, "Reflect"),
    attackerCauseFear: hasActivatedAbilityNamed(a, "Cause Fear"),
    defenderCauseFear: hasActivatedAbilityNamed(b, "Cause Fear"),
    attackerGrimLariat: hasActivatedAbilityNamed(a, "Grim Lariat"),
    defenderGrimLariat: hasActivatedAbilityNamed(b, "Grim Lariat"),
    attackerShadowBarrageValue: numericAbilityValue(a, "Shadow Barrage"),
    defenderShadowBarrageValue: numericAbilityValue(b, "Shadow Barrage"),
    attackerHunker: hasActivatedAbilityNamed(a, "Hunker") || hunkerA > 0,
    defenderHunker: hasActivatedAbilityNamed(b, "Hunker") || hunkerB > 0,
    attackerHarden: hasActivatedAbilityNamed(a, "Harden"),
    defenderHarden: hasActivatedAbilityNamed(b, "Harden"),
    attackerDivination: hasActivatedAbilityNamed(a, "Divination"),
    defenderDivination: hasActivatedAbilityNamed(b, "Divination"),
    attackerCocoon: hasActivatedAbilityNamed(a, "Cocoon"),
    defenderCocoon: hasActivatedAbilityNamed(b, "Cocoon"),
    attackerExpunge: hasActivatedAbilityNamed(a, "Expunge"),
    defenderExpunge: hasActivatedAbilityNamed(b, "Expunge"),
  };

  if (input.includeTrails) {
    const aTrails = trailFieldsForSide(a, input.trailsA ?? false);
    const bTrails = trailFieldsForSide(b, input.trailsB ?? false);
    config.attackerHealingStepValue = aTrails.healingStepValue;
    config.defenderHealingStepValue = bTrails.healingStepValue;
    config.attackerFlameTrailValue = aTrails.flameTrailValue;
    config.defenderFlameTrailValue = bTrails.flameTrailValue;
    config.attackerFrostTrailValue = aTrails.frostTrailValue;
    config.defenderFrostTrailValue = bTrails.frostTrailValue;
    config.attackerPlagueTrailValue = aTrails.plagueTrailValue;
    config.defenderPlagueTrailValue = bTrails.plagueTrailValue;
    config.attackerToxicTrailValue = aTrails.toxicTrailValue;
    config.defenderToxicTrailValue = bTrails.toxicTrailValue;
    config.attackerTrailStatusId = aTrails.trailStatusId;
    config.attackerTrailValue = aTrails.trailValue;
    config.defenderTrailStatusId = bTrails.trailStatusId;
    config.defenderTrailValue = bTrails.trailValue;
  }

  return config;
}
