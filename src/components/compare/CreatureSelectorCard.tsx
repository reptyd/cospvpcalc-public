import { useEffect, useId, useState } from "react";
import { veneration } from "../../engine/buildData";
import type {
  BreathPolicySetting,
  BuildOptions,
  CompareBiteVariantMode,
  CreatureRuntime,
  UserAbilityLevelOverrides,
} from "../../engine";
import {
  BREATH_POLICY_MODE_LABELS,
  BREATH_POLICY_OPTIONS,
  breathPolicyUnavailableReason,
  describeBreathPolicyOption,
  getCreatureBreathPolicyKind,
  getDefaultBreathPolicy,
  resolveBreathPolicy,
} from "../../engine/breathPolicy";
import {
  listCustomAbilityRecords,
  subscribeCustomAbilityRegistry,
  type CustomAbilityRecord,
} from "../../shared/customAbilities";
import {
  getDefiledGroundAilmentRecoveryPct,
  getDefiledGroundConsumptionReductionPct,
  getDefiledGroundStatBonusPct,
} from "../../engine/compareDefiledGroundData";
import { COMPARE_MAX_STARTING_FILL_PCT } from "../../engine/compareHungerMath";
import { getCreatureMeters } from "../../engine/compareMeters";
import { hasCompareGoreCharge, hasComparePowerCharge } from "../../engine/compareChargeData";
import { IconImg } from "../IconImg";
import { SmartNumericInput } from "../SmartNumericInput";
import { AscensionSelectors, ElderSelector, PlushiePickerBeta, PlushieSelectors, TraitSelectors } from "../BuildSelectors";
import { CreatureNameInput } from "../CreatureNameInput";
import {
  creatureHasAbility,
  type CompareSpecialAbilityState,
} from "./compareSpecialAbilities";
import { plushiesGrantAbility } from "../../engine/plushieBuildMappings";
import { RADIATION_NEARBY_MAX, clampRadiationNearby } from "../../engine/radiationNearby";
import type { PosturePolicyMode } from "../../optimizer/rustCompareMatchupRuntime";

type CompareSpecialAbilityOption = {
  id: "volcanic" | "frosty" | "defiledGround" | "broodwatcher" | "powerCharge" | "goreCharge" | "startingSpiteCharged" | "wardenRageStartHp" | "headStart" | "strengthInNumbers" | "radiationNearby" | "traps" | "trails";
  label: string;
  description: string;
};

const STRENGTH_IN_NUMBERS_MAX_ALLIES = 9;
const STRENGTH_IN_NUMBERS_DAMAGE_PER_ALLY = 1.5;
const WARDEN_RAGE_START_HP_DEFAULT_PCT = 50;
const WARDEN_RAGE_START_HP_MIN_PCT = 1;
const WARDEN_RAGE_START_HP_MAX_PCT = 100;

function clampStrengthInNumbersAllies(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(STRENGTH_IN_NUMBERS_MAX_ALLIES, Math.floor(value)));
}


function clampWardenRageStartHpPct(value: number): number {
  if (!Number.isFinite(value)) return WARDEN_RAGE_START_HP_DEFAULT_PCT;
  return Math.max(WARDEN_RAGE_START_HP_MIN_PCT, Math.min(WARDEN_RAGE_START_HP_MAX_PCT, Math.floor(value)));
}

const HEAD_START_DEFAULT_SEC = 5;
const HEAD_START_MIN_SEC = 0.1;
const HEAD_START_MAX_SEC = 120;

function clampHeadStartSec(value: number): number {
  if (!Number.isFinite(value)) return HEAD_START_DEFAULT_SEC;
  return Math.max(HEAD_START_MIN_SEC, Math.min(HEAD_START_MAX_SEC, value));
}

export function CreatureSelectorCard({
  label,
  name,
  creature,
  creatureNames,
  getIcon,
  onNameChange,
  build,
  onBuildChange,
  specialAbilities = undefined,
  onSpecialAbilitiesChange = undefined,
  compareBiteVariantMode = "primaryOnly",
  onCompareBiteVariantModeChange = undefined,
  userAbilityLevels = undefined,
  onUserAbilityLevelsChange = undefined,
  posturePolicy = "off",
  onPosturePolicyChange = undefined,
  breathPolicy = "auto",
  onBreathPolicyChange = undefined,
  hideIdentity = false,
  elderDeltaChips = false,
  betaPlushiePicker = false,
}: {
  label: string;
  name: string;
  creature?: CreatureRuntime;
  creatureNames: string[];
  getIcon: (name: string) => string | null;
  onNameChange: (value: string) => void;
  build: BuildOptions;
  onBuildChange: (value: BuildOptions) => void;
  specialAbilities?: CompareSpecialAbilityState;
  onSpecialAbilitiesChange?: (value: CompareSpecialAbilityState) => void;
  compareBiteVariantMode?: CompareBiteVariantMode;
  onCompareBiteVariantModeChange?: (value: CompareBiteVariantMode) => void;
  userAbilityLevels?: UserAbilityLevelOverrides;
  onUserAbilityLevelsChange?: (next: UserAbilityLevelOverrides) => void;
  posturePolicy?: PosturePolicyMode;
  onPosturePolicyChange?: (next: PosturePolicyMode) => void;
  breathPolicy?: BreathPolicySetting;
  onBreathPolicyChange?: (next: BreathPolicySetting) => void;
  /** Skip the card's own title + Creature name field. The beta Setup
   * overlay renders its own hero identity block (icon + name input) and
   * composes the rest of this card below it. */
  hideIdentity?: boolean;
  /** Render elders as color-coded +/- chips (beta) instead of plain text. */
  elderDeltaChips?: boolean;
  /** Render plushies as the beta searchable dropdown instead of datalist inputs. */
  betaPlushiePicker?: boolean;
}) {
  const [customAbilityRecords, setCustomAbilityRecords] = useState<CustomAbilityRecord[]>(() =>
    listCustomAbilityRecords(),
  );
  useEffect(
    () =>
      subscribeCustomAbilityRegistry(() => setCustomAbilityRecords(listCustomAbilityRecords())),
    [],
  );
  const creatureInputId = useId();
  const venerationStageId = useId();
  const iconUrl = getIcon(name);
  // Wiki-sourced secondary-attack damage. `stats.damage2` is the canonical
  // field populated by `tools/wiki-sync.ts` for every creature that has a
  // secondary attack in-game. Replaces a hand-maintained 57-entry table that
  // used to live in `compareSecondaryAttackData.ts` and drifted from the
  // wiki (was missing Follugila, had the wrong damage for Yggdragstyx).
  const secondaryAttackDamageRaw = creature?.stats?.damage2;
  const secondaryAttackDamage =
    typeof secondaryAttackDamageRaw === "number" && secondaryAttackDamageRaw > 0
      ? secondaryAttackDamageRaw
      : null;
  const hasSecondaryAttackOption = secondaryAttackDamage !== null && !!onCompareBiteVariantModeChange;
  const [startingHungerInput, setStartingHungerInput] = useState(String(specialAbilities?.startingHungerPct ?? 100));
  const [startingThirstInput, setStartingThirstInput] = useState(String(specialAbilities?.startingThirstPct ?? 100));
  const [strengthInNumbersAlliesInput, setStrengthInNumbersAlliesInput] = useState(
    String(specialAbilities?.strengthInNumbersAllies ?? 0),
  );
  const [radiationNearbyCountInput, setRadiationNearbyCountInput] = useState(
    String(specialAbilities?.radiationNearbyCount ?? 0),
  );
  const [wardenRageStartHpInput, setWardenRageStartHpInput] = useState(
    String(specialAbilities?.wardenRageStartHpPct ?? WARDEN_RAGE_START_HP_DEFAULT_PCT),
  );
  const hasGourmandizer = creatureHasAbility(creature, "Gourmandizer");
  const meters = getCreatureMeters(creature);
  // Only a Gourmandizer owner can overfill; everyone else stops at a full bar.
  const maxStartingFillPct = hasGourmandizer ? COMPARE_MAX_STARTING_FILL_PCT : 100;
  const hasBroodwatcher = creatureHasAbility(creature, "Broodwatcher");
  const hasDefiledGround = creatureHasAbility(creature, "Defiled Ground");
  const hasTwoFaced = creatureHasAbility(creature, "Two-Faced");
  const hasHealingPulse = creatureHasAbility(creature, "Healing Pulse");
  const hasWardenRage = creatureHasAbility(creature, "Warden's Rage");
  const defiledGroundLevel = specialAbilities?.defiledGroundLevel ?? 1;
  const defiledGroundConsumptionReductionPct = getDefiledGroundConsumptionReductionPct(defiledGroundLevel).toFixed(1);
  const defiledGroundStatBonusPct = getDefiledGroundStatBonusPct(defiledGroundLevel);
  const defiledGroundAilmentRecoveryPct = getDefiledGroundAilmentRecoveryPct(defiledGroundLevel);
  const availableSpecialAbilities: CompareSpecialAbilityOption[] = [
    creatureHasAbility(creature, "Volcanic")
      ? {
          id: "volcanic" as const,
          label: "Volcanic",
          description: "Only the +50% health regen part is modeled here.",
        }
      : null,
    (creatureHasAbility(creature, "Frosty") || plushiesGrantAbility(build.plushies ?? [], "Frosty"))
      ? {
          id: "frosty" as const,
          label: "Frosty",
          description: "Only the +25% health regen part is modeled here.",
        }
      : null,
    hasDefiledGround
      ? {
          id: "defiledGround" as const,
          label: "Defiled Ground",
          description: "Disputed effect. Choose the contaminated land level below to apply the owner bonuses and the opponent Weakness appetite penalty.",
        }
      : null,
    hasBroodwatcher
      ? {
          id: "broodwatcher" as const,
          label: "Broodwatcher",
          description: "Disputed effect. Starts the fight with 5 Defensive stacks that do not decay naturally.",
        }
      : null,
    hasComparePowerCharge(creature)
      ? {
          id: "powerCharge" as const,
          label: "Power Charge",
          description: "Disputed effect. The first melee hit only gains +50% damage and applies 2 Shredded Wings.",
        }
      : null,
    hasCompareGoreCharge(creature)
      ? {
          id: "goreCharge" as const,
          label: "Gore Charge",
          description: "Disputed effect. The first melee hit only applies 2 Bleed and 10 Deep Wounds.",
        }
      : null,
    creatureHasAbility(creature, "Spite")
      ? {
          id: "startingSpiteCharged" as const,
          label: "Spite ready at start",
          description: "Disputed effect. Starts with a fully charged Spite already armed, so the opening bite consumes it immediately.",
        }
      : null,
    hasWardenRage
      ? {
          id: "wardenRageStartHp" as const,
          label: "Start HP",
          description: "Disputed setup. Starts the fight at the selected percent of max HP without changing max HP.",
        }
      : null,
    creatureHasAbility(creature, "Strength In Numbers")
      ? {
          id: "strengthInNumbers" as const,
          label: "Strength In Numbers",
          description: `Disputed effect. Each nearby ally with this ability adds +${STRENGTH_IN_NUMBERS_DAMAGE_PER_ALLY}% damage, up to ${STRENGTH_IN_NUMBERS_MAX_ALLIES}.`,
        }
      : null,
    creatureHasAbility(creature, "Thorn Trap") || creatureHasAbility(creature, "Toxic Trap")
      ? {
          id: "traps" as const,
          label: "Traps",
          description: "Disputed effect. Enables the creature's trap abilities (Thorn Trap and Toxic Trap) so they activate on cooldown. When disabled, neither trap fires.",
        }
      : null,
    creatureHasAbility(creature, "Toxic Trail")
      || creatureHasAbility(creature, "Plague Trail")
      || creatureHasAbility(creature, "Flame Trail")
      || creatureHasAbility(creature, "Frost Trail")
      || creatureHasAbility(creature, "Healing Step")
      ? {
          id: "trails" as const,
          label: "Trails",
          description: "Disputed effect. Enables this creature's trail/step abilities (Toxic/Plague/Flame/Frost Trail and Healing Step). While any trail is active, No Move Facetank is overridden off for the owner, which holds its persistent statuses at their stack count instead of letting them decay.",
        }
      : null,
    {
      // Always available (not ability-gated): the nearby-radiated rule applies
      // to any battle. The count is linked across both sides.
      id: "radiationNearby" as const,
      label: "Nearby radiated creatures",
      description:
        "Radiation's 0.5% max HP per tick is additive across nearby radiated creatures. Set how many extra creatures (besides the two fighters) are radiated nearby; the two fighters also cross-scale each other when both are radiated. The count is shared by both sides.",
    },
    {
      // Always available (not ability-gated): any creature can be granted a
      // head start. Per-side and independent.
      id: "headStart" as const,
      label: "Head Start",
      description:
        "This creature gets an opening of the chosen number of seconds during which the opponent stands inert - it does not attack, breathe, change posture, or use abilities, but it still takes this creature's bites and its defensive on-hit reactions still fire. After the chosen seconds, the opponent acts normally.",
    },
  ].filter((ability): ability is CompareSpecialAbilityOption => ability !== null);

  useEffect(() => {
    if (!specialAbilities) return;
    setStartingHungerInput(String(specialAbilities.startingHungerPct));
    setStartingThirstInput(String(specialAbilities.startingThirstPct));
    setStrengthInNumbersAlliesInput(String(specialAbilities.strengthInNumbersAllies));
    setRadiationNearbyCountInput(String(specialAbilities.radiationNearbyCount ?? 0));
    setWardenRageStartHpInput(String(specialAbilities.wardenRageStartHpPct ?? WARDEN_RAGE_START_HP_DEFAULT_PCT));
  }, [specialAbilities]);

  return (
    <div className="panel-block">
      {!hideIdentity ? (
        <>
          <h3>{label}</h3>
          <div className="field">
            <label htmlFor={creatureInputId}>Creature</label>
            <div className="icon-input">
              <IconImg src={iconUrl} alt={name} size={36} responsive />
              <CreatureNameInput
                id={creatureInputId}
                value={name}
                onChange={onNameChange}
                creatureNames={creatureNames}
              />
            </div>
          </div>
        </>
      ) : null}
      <div className="field">
        <label htmlFor={venerationStageId}>Veneration Stage</label>
        <select id={venerationStageId} value={build.venerationStage} onChange={(e) => onBuildChange({ ...build, venerationStage: Number(e.target.value) })}>
          {Array.from({ length: veneration.stages + 1 }, (_, idx) => idx).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Traits</label>
        <TraitSelectors build={build} onBuildChange={onBuildChange} />
      </div>
      <div className="field">
        <label>Ascension</label>
        <AscensionSelectors build={build} onBuildChange={onBuildChange} />
      </div>
      <div className="field">
        <label>Plushies</label>
        {betaPlushiePicker ? (
          <PlushiePickerBeta build={build} onBuildChange={onBuildChange} />
        ) : (
          <PlushieSelectors build={build} onBuildChange={onBuildChange} />
        )}
      </div>
      <div className="field">
        <label>Elder</label>
        <ElderSelector build={build} onBuildChange={onBuildChange} showDeltaChips={elderDeltaChips} />
      </div>
      {specialAbilities && onSpecialAbilitiesChange && (availableSpecialAbilities.length > 0 || hasSecondaryAttackOption || hasHealingPulse || hasTwoFaced || (creature?.userAbilityIds?.length ?? 0) > 0 || !!onPosturePolicyChange || !!onBreathPolicyChange) ? (() => {
        // Categorize availableSpecialAbilities into UI buckets. Each
        // ability id appears in exactly one bucket.
        const startingStateAbilities = availableSpecialAbilities.filter(
          (a) => a.id === "startingSpiteCharged" || a.id === "wardenRageStartHp",
        );
        const trapsTrailsAbilities = availableSpecialAbilities.filter(
          (a) => a.id === "traps" || a.id === "trails",
        );
        const mainSpecialAbilities = availableSpecialAbilities.filter(
          (a) =>
            a.id !== "startingSpiteCharged" &&
            a.id !== "wardenRageStartHp" &&
            a.id !== "traps" &&
            a.id !== "trails",
        );
        const breathPolicyKind = getCreatureBreathPolicyKind(creature);
        const breathPolicyDefault = getDefaultBreathPolicy(breathPolicyKind);
        const resolvedBreathPolicy = resolveBreathPolicy(breathPolicy, breathPolicyKind);
        const breathPolicyUnavailable = breathPolicyUnavailableReason(breathPolicyKind);
        const hasBreathPolicyOption = !!onBreathPolicyChange && !breathPolicyUnavailable;
        const aiPolicyCount =
          (onPosturePolicyChange ? 1 : 0) +
          (hasSecondaryAttackOption ? 1 : 0) +
          (hasBreathPolicyOption ? 1 : 0) +
          1;
        const abilityModesCount = (hasHealingPulse ? 1 : 0) + (hasTwoFaced ? 1 : 0);
        const renderAbilityChip = (ability: CompareSpecialAbilityOption) => (
          <label
            key={ability.id}
            className={`compare-buff-chip${specialAbilities[ability.id] ? " selected" : ""}`}
            title={ability.description}
          >
            <input
              type="checkbox"
              checked={specialAbilities[ability.id]}
              onChange={() =>
                onSpecialAbilitiesChange({
                  ...specialAbilities,
                  [ability.id]: !specialAbilities[ability.id],
                })
              }
            />
            <span>{ability.label}</span>
          </label>
        );
        return (
        <div className="compare-buff-section">
          {/* 1. Per-side AI policy - Sit/Lay/Stand, Bite attack and Breath
              firing each get their own single-row block so the 3-button
              segmented selector inside a chip never overflows when the panel
              narrows. */}
          {aiPolicyCount > 0 ? (
            <>
              <div className="compare-buff-heading">
                <span>Per-side AI policy</span>
                <span>{aiPolicyCount}</span>
              </div>
              <div className="compare-policy-grid">
              {onPosturePolicyChange ? (
                  <div className="compare-buff-chip compare-bite-variant-chip">
                    <span className="compare-bite-variant-label">Sit/Lay/Stand Policy</span>
                    <div className="compare-bite-variant-options">
                      {(
                        [
                          { id: "off", label: "Off" },
                          { id: "regenAware", label: "Regen-aware" },
                          { id: "regenUnaware", label: "Regen-unaware" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          aria-pressed={posturePolicy === opt.id}
                          className={
                            posturePolicy === opt.id
                              ? "compare-bite-variant-button active"
                              : "compare-bite-variant-button"
                          }
                          onClick={() => onPosturePolicyChange(opt.id)}
                          title={
                            opt.id === "off"
                              ? "No posture changes. Creature stays Standing the entire fight."
                              : opt.id === "regenAware"
                                ? "Engine evaluates sit/lay decisions and times lay-downs around regen ticks for ×2 regen. Guaranteed never worse than Off."
                                : "Engine evaluates sit/lay decisions but ignores regen-tick timing. Only lays for ailment clearing / tactical reasons. Guaranteed never worse than Off."
                          }
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
              ) : null}
              {/* Unconditional: every creature can meet a Reflect carrier, so
                  the setting is always there to be set. */}
              <div className="compare-buff-chip compare-bite-variant-chip">
                    <span className="compare-bite-variant-label">Reflect response</span>
                    <div className="compare-bite-variant-options">
                      {(
                        [
                          { id: "ignore" as const, label: "Ignore" },
                          { id: "hold" as const, label: "Hold" },
                        ]
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          aria-pressed={specialAbilities.reflectResponse === opt.id}
                          className={
                            specialAbilities.reflectResponse === opt.id
                              ? "compare-bite-variant-button active"
                              : "compare-bite-variant-button"
                          }
                          onClick={() => onSpecialAbilitiesChange({ ...specialAbilities, reflectResponse: opt.id })}
                          title={
                            opt.id === "ignore"
                              ? "Keeps biting and breathing into an active Reflect, taking the damage back."
                              : "Stops biting and breathing while Reflect is up, and resumes the moment it drops. Abilities are unaffected - Reflect does not turn those back."
                          }
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
              </div>
              {hasSecondaryAttackOption ? (
                  <div className="compare-buff-chip compare-bite-variant-chip">
                    <span className="compare-bite-variant-label">Bite attack</span>
                    <div className="compare-bite-variant-options">
                      {(
                        [
                          { id: "primaryOnly", label: "Primary" },
                          { id: "dynamic", label: "Dynamic" },
                          { id: "secondaryOnly", label: "Secondary" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          aria-pressed={compareBiteVariantMode === opt.id}
                          className={
                            compareBiteVariantMode === opt.id
                              ? "compare-bite-variant-button active"
                              : "compare-bite-variant-button"
                          }
                          onClick={() => onCompareBiteVariantModeChange(opt.id)}
                          title={
                            opt.id === "primaryOnly"
                              ? "Every bite uses the primary attack with on-hit offensive ailments."
                              : opt.id === "dynamic"
                                ? `Engine picks primary vs. secondary (${secondaryAttackDamage} dmg) per bite to maximise damage delivered.`
                                : `Every bite uses the secondary attack (${secondaryAttackDamage} dmg). Skips on-hit offensive ailments.`
                          }
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
              ) : null}
              {/* Dropped entirely for a creature with no modelled breath -
                  that is most of the roster, and a "no breath" line on every
                  melee card is noise. Auto-fire breaths keep the line, since
                  there the missing control does need explaining. */}
              {onBreathPolicyChange && breathPolicyKind !== "none" ? (
                  <div className="compare-buff-chip compare-bite-variant-chip">
                    <span className="compare-bite-variant-label">Breath firing</span>
                    {breathPolicyUnavailable ? (
                      <span className="note">{breathPolicyUnavailable}</span>
                    ) : (
                      <>
                        <div className="compare-bite-variant-options">
                          {BREATH_POLICY_OPTIONS.map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              aria-pressed={resolvedBreathPolicy === opt.id}
                              className={
                                resolvedBreathPolicy === opt.id
                                  ? "compare-bite-variant-button active"
                                  : "compare-bite-variant-button"
                              }
                              onClick={() => onBreathPolicyChange(opt.id)}
                              title={describeBreathPolicyOption(opt.id, breathPolicyKind)}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <span className="note">
                          {resolvedBreathPolicy === breathPolicyDefault
                            ? `This creature's default (${BREATH_POLICY_MODE_LABELS[breathPolicyDefault]}).`
                            : `Overriding the default (${BREATH_POLICY_MODE_LABELS[breathPolicyDefault]}).`}
                        </span>
                      </>
                    )}
                  </div>
              ) : null}
              </div>
            </>
          ) : null}

          {/* 2. Starting state - Spite ready at start, Warden Rage Start HP */}
          {startingStateAbilities.length > 0 ? (
            <>
              <div className="compare-buff-heading">
                <span>Starting state</span>
                <span>{startingStateAbilities.length}</span>
              </div>
              <div className="compare-buff-grid">{startingStateAbilities.map(renderAbilityChip)}</div>
            </>
          ) : null}

          {/* 3. Specific / disputed abilities - main category */}
          {mainSpecialAbilities.length > 0 ? (
            <>
              <div className="compare-buff-heading">
                <span>Specific / disputed abilities</span>
                <span>{mainSpecialAbilities.length}</span>
              </div>
              <div className="compare-buff-grid">{mainSpecialAbilities.map(renderAbilityChip)}</div>
            </>
          ) : null}

          {/* 4. Ability modes - Healing Pulse + Two-Faced merged. Both
              are per-ability mode pickers; merging avoids two single-
              chip categories. */}
          {abilityModesCount > 0 ? (
            <>
              <div className="compare-buff-heading">
                <span>Ability modes</span>
                <span>{abilityModesCount}</span>
              </div>
              {hasHealingPulse ? (
                <>
                  <div className="compare-buff-grid">
                    <label
                      className={`compare-buff-chip${specialAbilities.healingPulseEnabled ? " selected" : ""}`}
                      title="Disputed ability. When enabled, choose Normal (recurring radius cast on cooldown) or Once at start (single self-only cast at t=0)."
                    >
                      <input
                        type="checkbox"
                        checked={specialAbilities.healingPulseEnabled}
                        onChange={() =>
                          onSpecialAbilitiesChange({
                            ...specialAbilities,
                            healingPulseEnabled: !specialAbilities.healingPulseEnabled,
                          })
                        }
                      />
                      <span>Healing Pulse</span>
                    </label>
                  </div>
                  {specialAbilities.healingPulseEnabled ? (
                    <>
                      <div
                        className="compare-special-level-grid"
                        style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 6 }}
                      >
                        {[
                          { id: "normal" as const, label: "Normal" },
                          { id: "onceAtStart" as const, label: "Once at start" },
                        ].map((mode) => (
                          <button
                            key={mode.id}
                            type="button"
                            aria-pressed={specialAbilities.healingPulseMode === mode.id}
                            className={specialAbilities.healingPulseMode === mode.id ? "compare-special-level-button active" : "compare-special-level-button"}
                            onClick={() => onSpecialAbilitiesChange({ ...specialAbilities, healingPulseMode: mode.id })}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                      <span className="note">
                        {specialAbilities.healingPulseMode === "normal"
                          ? "Normal: owner casts at t=0 and every 90s. Each cast applies 10 stacks of Healing Ailment to both sides (30s duration, ticks every 15s, +7% maxHP heal per tick)."
                          : "Once at start: owner casts once at t=0, applies 10 stacks to self only (no opponent application, no repeat)."}
                      </span>
                    </>
                  ) : null}
                </>
              ) : null}
              {hasTwoFaced ? (
                <div style={{ marginTop: hasHealingPulse ? 12 : 0 }}>
                  <span className="label">Two-Faced</span>
                  <div className="compare-special-level-grid compare-special-level-grid--pair">
                    {[
                      { id: "madness" as const, label: "Madness" },
                      { id: "tranquility" as const, label: "Tranquility" },
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        aria-pressed={specialAbilities.twoFacedMode === mode.id}
                        className={specialAbilities.twoFacedMode === mode.id ? "compare-special-level-button active" : "compare-special-level-button"}
                        onClick={() => onSpecialAbilitiesChange({ ...specialAbilities, twoFacedMode: mode.id })}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                  <span className="note">
                    {specialAbilities.twoFacedMode === "madness"
                      ? "Madness: ×0.625 damage, ×0.625 bite cooldown (faster, weaker hits)."
                      : "Tranquility: ×1.6 damage, ×1.6 bite cooldown (slower, stronger hits)."}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}

          {/* 4b. Survival meters. Hunger and thirst always run, so there is no
              rule to switch on - the only input is how full each bar starts.
              A creature without Gourmandizer cannot be sent past a full bar,
              and one without a given meter is not offered it. */}
          {meters.hunger || meters.thirst ? (
            <>
              <div className="compare-buff-heading">
                <span>Starting meters</span>
                <span>{(meters.hunger ? 1 : 0) + (meters.thirst ? 1 : 0)}</span>
              </div>
              {/* Beta styles a section as an unboxed body, so the two meters are
                  plain labelled fields side by side rather than sharing a panel
                  of their own. */}
              <div className="compare-meter-fields">
                {meters.hunger ? (
                  <div className="field">
                    <label htmlFor="compare-starting-hunger">Hunger fill %</label>
                    <input
                      id="compare-starting-hunger"
                      type="text"
                      inputMode="numeric"
                      value={startingHungerInput}
                      onChange={(e) => setStartingHungerInput(e.target.value.replace(/[^\d]/g, ""))}
                      onBlur={() => {
                        const normalized = clampStartingFillPct(startingHungerInput, specialAbilities.startingHungerPct, maxStartingFillPct);
                        setStartingHungerInput(String(normalized));
                        onSpecialAbilitiesChange({ ...specialAbilities, startingHungerPct: normalized });
                      }}
                    />
                  </div>
                ) : null}
                {meters.thirst ? (
                  <div className="field">
                    <label htmlFor="compare-starting-thirst">Thirst fill %</label>
                    <input
                      id="compare-starting-thirst"
                      type="text"
                      inputMode="numeric"
                      value={startingThirstInput}
                      onChange={(e) => setStartingThirstInput(e.target.value.replace(/[^\d]/g, ""))}
                      onBlur={() => {
                        const normalized = clampStartingFillPct(startingThirstInput, specialAbilities.startingThirstPct, maxStartingFillPct);
                        setStartingThirstInput(String(normalized));
                        onSpecialAbilitiesChange({ ...specialAbilities, startingThirstPct: normalized });
                      }}
                    />
                  </div>
                ) : null}
              </div>
              <span className="note">
                A bar drains one appetite unit every 36 seconds. Every 36 seconds after it reaches
                zero the creature gains another stack of Hungry or Thirsty. Each stack deals 0.5%
                max health in damage every 3 seconds, and health regeneration stops entirely.
                {hasGourmandizer
                  ? ` Gourmandizer fills its primary bar to ${COMPARE_MAX_STARTING_FILL_PCT}%; above 100% that bar drains twice as fast and adds up to +15% weight, maxed at 125%.`
                  : ""}
              </span>
            </>
          ) : null}

          {/* 5. Traps & Trails - both are setting-gated trap/trail
              effects (placed/zone abilities, not true area-of-effect). */}
          {trapsTrailsAbilities.length > 0 ? (
            <>
              <div className="compare-buff-heading">
                <span>Traps & Trails</span>
                <span>{trapsTrailsAbilities.length}</span>
              </div>
              <div className="compare-buff-grid">{trapsTrailsAbilities.map(renderAbilityChip)}</div>
            </>
          ) : null}

          {hasSecondaryAttackOption && compareBiteVariantMode !== "primaryOnly" ? (
            <div className="build-details">
              <strong>Bite attack - {compareBiteVariantMode === "dynamic" ? "Dynamic" : "Secondary only"}</strong>
              <span>
                {compareBiteVariantMode === "secondaryOnly"
                  ? `Every bite uses the secondary attack (${secondaryAttackDamage} damage). It keeps normal damage buffs but does not apply offensive status effects.`
                  : `Engine picks primary vs. secondary (${secondaryAttackDamage} damage) per bite. Cadence is unchanged - same bite cooldown either way; only the flavor of the bite swaps. Use Primary for guaranteed on-hit ailments or Secondary to fully lock damage2 in.`}
              </span>
            </div>
          ) : null}
          {availableSpecialAbilities.map(
            (ability) =>
              specialAbilities[ability.id] && (
                <div key={`${ability.id}-details`} className="build-details">
                  <strong>{ability.label}</strong>
                  <span>{ability.description}</span>
                  {ability.id === "strengthInNumbers" ? (
                    <div className="field">
                      <label htmlFor="compare-strength-in-numbers-allies">Nearby allies (0-{STRENGTH_IN_NUMBERS_MAX_ALLIES})</label>
                      <input
                        id="compare-strength-in-numbers-allies"
                        type="text"
                        inputMode="numeric"
                        value={strengthInNumbersAlliesInput}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/[^\d]/g, "");
                          setStrengthInNumbersAlliesInput(rawValue);
                          if (rawValue === "") return;
                          const nextAllies = Number(rawValue);
                          if (!Number.isFinite(nextAllies)) return;
                          onSpecialAbilitiesChange({
                            ...specialAbilities,
                            strengthInNumbersAllies: clampStrengthInNumbersAllies(nextAllies),
                          });
                        }}
                        onBlur={() => {
                          const rawValue = strengthInNumbersAlliesInput.trim();
                          const normalized = rawValue === ""
                            ? clampStrengthInNumbersAllies(specialAbilities.strengthInNumbersAllies)
                            : clampStrengthInNumbersAllies(Number(rawValue) || 0);
                          setStrengthInNumbersAlliesInput(String(normalized));
                          onSpecialAbilitiesChange({
                            ...specialAbilities,
                            strengthInNumbersAllies: normalized,
                          });
                        }}
                      />
                      <span className="note">
                        Each nearby ally with Strength In Numbers adds +{STRENGTH_IN_NUMBERS_DAMAGE_PER_ALLY}% damage.
                      </span>
                    </div>
                  ) : null}
                  {ability.id === "radiationNearby" ? (
                    <div className="field">
                      <label htmlFor="compare-radiation-nearby">Nearby radiated creatures (0-{RADIATION_NEARBY_MAX})</label>
                      <input
                        id="compare-radiation-nearby"
                        type="text"
                        inputMode="numeric"
                        value={radiationNearbyCountInput}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/[^\d]/g, "");
                          setRadiationNearbyCountInput(rawValue);
                          if (rawValue === "") return;
                          const next = Number(rawValue);
                          if (!Number.isFinite(next)) return;
                          onSpecialAbilitiesChange({
                            ...specialAbilities,
                            radiationNearbyCount: clampRadiationNearby(next),
                          });
                        }}
                        onBlur={() => {
                          const rawValue = radiationNearbyCountInput.trim();
                          const normalized = rawValue === ""
                            ? clampRadiationNearby(specialAbilities.radiationNearbyCount)
                            : clampRadiationNearby(Number(rawValue) || 0);
                          setRadiationNearbyCountInput(String(normalized));
                          onSpecialAbilitiesChange({
                            ...specialAbilities,
                            radiationNearbyCount: normalized,
                          });
                        }}
                      />
                      <span className="note">
                        Each radiated fighter's 0.5% max HP tick scales by (1 + this count, plus the other fighter when it is also radiated). 0 = a single source.
                      </span>
                    </div>
                  ) : null}
                  {ability.id === "wardenRageStartHp" ? (
                    <div className="field">
                      <label htmlFor="compare-warden-rage-start-hp">Start HP % ({WARDEN_RAGE_START_HP_MIN_PCT}-{WARDEN_RAGE_START_HP_MAX_PCT})</label>
                      <input
                        id="compare-warden-rage-start-hp"
                        type="text"
                        inputMode="numeric"
                        value={wardenRageStartHpInput}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/[^\d]/g, "");
                          setWardenRageStartHpInput(rawValue);
                          if (rawValue === "") return;
                          const nextPct = Number(rawValue);
                          if (!Number.isFinite(nextPct)) return;
                          onSpecialAbilitiesChange({
                            ...specialAbilities,
                            wardenRageStartHpPct: clampWardenRageStartHpPct(nextPct),
                          });
                        }}
                        onBlur={() => {
                          const rawValue = wardenRageStartHpInput.trim();
                          const normalized = rawValue === ""
                            ? clampWardenRageStartHpPct(specialAbilities.wardenRageStartHpPct ?? WARDEN_RAGE_START_HP_DEFAULT_PCT)
                            : clampWardenRageStartHpPct(Number(rawValue) || 0);
                          setWardenRageStartHpInput(String(normalized));
                          onSpecialAbilitiesChange({
                            ...specialAbilities,
                            wardenRageStartHpPct: normalized,
                          });
                        }}
                      />
                      <span className="note">
                        Max HP stays unchanged; only current HP at t=0 is set to this percentage.
                      </span>
                    </div>
                  ) : null}
                  {ability.id === "headStart" ? (
                    <div className="field">
                      <label htmlFor="compare-head-start-sec">Head Start seconds ({HEAD_START_MIN_SEC}-{HEAD_START_MAX_SEC})</label>
                      <SmartNumericInput
                        id="compare-head-start-sec"
                        allowDecimal
                        value={specialAbilities.headStartSec ?? 0}
                        clamp={clampHeadStartSec}
                        onCommit={(next) =>
                          onSpecialAbilitiesChange({ ...specialAbilities, headStartSec: next })
                        }
                      />
                      <span className="note">
                        The opponent stands inert for this many seconds. It still takes your bites and its defensive on-hit reactions still fire.
                      </span>
                    </div>
                  ) : null}
                  {ability.id === "defiledGround" ? (
                    <div className="field">
                      <span className="label" id="compare-defiled-ground-level-label">Contaminated land level</span>
                      <div
                        className="compare-special-level-grid"
                        role="group"
                        aria-labelledby="compare-defiled-ground-level-label"
                      >
                        {[1, 2, 3].map((level) => (
                          <button
                            key={level}
                            type="button"
                            aria-pressed={specialAbilities.defiledGroundLevel === level}
                            className={specialAbilities.defiledGroundLevel === level ? "compare-special-level-button active" : "compare-special-level-button"}
                            onClick={() =>
                              onSpecialAbilitiesChange({
                                ...specialAbilities,
                                defiledGroundLevel: level as 1 | 2 | 3,
                              })
                            }
                          >
                            Level {level}
                          </button>
                        ))}
                      </div>
                      <span className="note">
                        Owner: +{defiledGroundStatBonusPct}% max health, +{defiledGroundStatBonusPct}% weight, and {defiledGroundAilmentRecoveryPct}% faster ailment recovery.
                      </span>
                      <span className="note">
                        Owner uses {defiledGroundConsumptionReductionPct}% less hunger and thirst; the opponent uses 25% more.
                      </span>
                    </div>
                  ) : null}
                </div>
              ),
          )}
          {/* 6. Custom abilities - user-authored abilities attached to
              this creature, with a per-fight level picker when the
              ability has levels > 1. */}
          {(() => {
            const userIds = creature?.userAbilityIds ?? [];
            const attached = userIds
              .map((id) => ({ id, record: customAbilityRecords.find((r) => r.spec.id === id) }))
              .filter((entry): entry is { id: string; record: CustomAbilityRecord } => entry.record !== undefined);
            if (attached.length === 0) return null;
            return (
              <>
                <div className="compare-buff-heading">
                  <span>Custom abilities</span>
                  <span>{attached.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {attached.map(({ id, record }) => {
                    const spec = record.spec;
                    const levels = spec.levels ?? 1;
                    const defaultLevel = spec.default_level ?? 1;
                    const current = userAbilityLevels?.[id];
                    const isOverride = current !== undefined && Number.isInteger(current) && current >= 1 && current <= levels;
                    const displayLevel = isOverride ? (current as number) : defaultLevel;
                    return (
                      <div key={`user-${id}`} className="build-details">
                        <strong>{spec.display_name || id}</strong>
                        <span className="note" style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11 }}>
                          {id}
                        </span>
                        {levels > 1 ? (
                          <>
                            <span className="label">Active level</span>
                            <div className="compare-special-level-grid" role="group" aria-label={`Active level for ${spec.display_name || id}`}>
                              {Array.from({ length: levels }, (_, i) => i + 1).map((level) => (
                                <button
                                  key={level}
                                  type="button"
                                  aria-pressed={displayLevel === level}
                                  className={displayLevel === level ? "compare-special-level-button active" : "compare-special-level-button"}
                                  onClick={() => {
                                    if (!onUserAbilityLevelsChange) return;
                                    const next = { ...(userAbilityLevels ?? {}) };
                                    if (level === defaultLevel) {
                                      delete next[id];
                                    } else {
                                      next[id] = level;
                                    }
                                    onUserAbilityLevelsChange(next);
                                  }}
                                >
                                  Lv {level}
                                  {level === defaultLevel ? " (default)" : ""}
                                </button>
                              ))}
                            </div>
                            <span className="note">
                              {isOverride
                                ? `Per-fight override: Lv ${current}. Click the default button to clear.`
                                : `Using spec default (Lv ${defaultLevel}). Pick a different level to override for this matchup only.`}
                            </span>
                          </>
                        ) : (
                          <span className="note">Single-level ability - no per-fight level pick.</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
        );
      })() : null}
    </div>
  );
}

/** Reads a typed fill percent, falling back to the committed value when the
 *  field was left blank, and clamps it to what the creature can actually hold. */
function clampStartingFillPct(raw: string, committed: number, maxPct: number): number {
  const trimmed = raw.trim();
  const parsed = trimmed === "" ? committed : Number(trimmed);
  if (!Number.isFinite(parsed)) return committed;
  return Math.max(0, Math.min(maxPct, Math.round(parsed)));
}
