import { useEffect, useId, useState } from "react";
import { veneration } from "../../engine/buildData";
import type {
  BuildOptions,
  CompareBiteVariantMode,
  CreatureRuntime,
  UserAbilityLevelOverrides,
} from "../../engine";
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
import { normalizeCompareFillPct } from "../../engine/compareHungerMath";
import { hasCompareGoreCharge, hasComparePowerCharge } from "../../engine/compareChargeData";
import { IconImg } from "../IconImg";
import { AscensionSelectors, ElderSelector, PlushieSelectors, TraitSelectors } from "../BuildSelectors";
import { CreatureNameInput } from "../CreatureNameInput";
import {
  creatureHasAbility,
  type CompareSpecialAbilityState,
} from "./compareSpecialAbilities";
import { plushiesGrantAbility } from "../../engine/plushieBuildMappings";
import type { PosturePolicyMode } from "../../optimizer/rustCompareMatchupRuntime";

type CompareSpecialAbilityOption = {
  id: "volcanic" | "frosty" | "defiledGround" | "gourmandizer" | "broodwatcher" | "hungerRule" | "powerCharge" | "goreCharge" | "startingSpiteCharged" | "wardenRageStartHp" | "strengthInNumbers" | "traps" | "trails";
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
  const [gourmandizerHungerInput, setGourmandizerHungerInput] = useState(String(specialAbilities?.gourmandizerStartingHunger ?? 100));
  const [strengthInNumbersAlliesInput, setStrengthInNumbersAlliesInput] = useState(
    String(specialAbilities?.strengthInNumbersAllies ?? 0),
  );
  const [wardenRageStartHpInput, setWardenRageStartHpInput] = useState(
    String(specialAbilities?.wardenRageStartHpPct ?? WARDEN_RAGE_START_HP_DEFAULT_PCT),
  );
  const hasGourmandizer = creatureHasAbility(creature, "Gourmandizer");
  const hasReflux = creatureHasAbility(creature, "Reflux");
  const hasBroodwatcher = creatureHasAbility(creature, "Broodwatcher");
  const hasDefiledGround = creatureHasAbility(creature, "Defiled Ground");
  const hasTwoFaced = creatureHasAbility(creature, "Two-Faced");
  const hasHealingPulse = creatureHasAbility(creature, "Healing Pulse");
  const hasWardenRage = creatureHasAbility(creature, "Warden's Rage");
  const defiledGroundLevel = specialAbilities?.defiledGroundLevel ?? 1;
  const defiledGroundConsumptionReductionPct = getDefiledGroundConsumptionReductionPct(defiledGroundLevel);
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
          description: "Only the +25% health regen and +25% stamina regen parts are modeled here.",
        }
      : null,
    hasDefiledGround
      ? {
          id: "defiledGround" as const,
          label: "Defiled Ground",
          description: "Compare-only disputed effect. Choose the contaminated land level below to apply the owner bonuses and the opponent Weakness appetite penalty.",
        }
      : null,
    hasGourmandizer
      ? {
          id: "gourmandizer" as const,
          label: "Gourmandizer",
          description: specialAbilities?.hungerRule
            ? "Compare-only disputed effect. Weight bonus is based on current appetite fill above 100%, and overfilled appetite above 100% drains 1.5x faster."
            : "Compare-only disputed effect. Only the starting weight bonus from total appetite fill above 100% is modeled here.",
        }
      : null,
    hasBroodwatcher
      ? {
          id: "broodwatcher" as const,
          label: "Broodwatcher",
          description: "Compare-only disputed effect. Starts the fight with 5 Defensive stacks that do not decay naturally.",
        }
      : null,
    hasGourmandizer || hasReflux
      ? {
          id: "hungerRule" as const,
          label: "Use hunger rules",
          description: "Compare-only disputed rule. Appetite drains by 1 unit every 30s, Disease accelerates it, Gourmandizer overfill drains faster, and Reflux spends 25 percentage points of the full appetite meter per cast.",
        }
      : null,
    hasComparePowerCharge(creature)
      ? {
          id: "powerCharge" as const,
          label: "Power Charge",
          description: "Compare-only disputed effect. The first melee hit only gains +50% damage and applies 2 Shredded Wings.",
        }
      : null,
    hasCompareGoreCharge(creature)
      ? {
          id: "goreCharge" as const,
          label: "Gore Charge",
          description: "Compare-only disputed effect. The first melee hit only applies 2 Bleed and 10 Deep Wounds.",
        }
      : null,
    creatureHasAbility(creature, "Spite")
      ? {
          id: "startingSpiteCharged" as const,
          label: "Spite ready at start",
          description: "Compare-only disputed effect. Starts with a fully charged Spite already armed, so the opening bite consumes it immediately.",
        }
      : null,
    hasWardenRage
      ? {
          id: "wardenRageStartHp" as const,
          label: "Start HP",
          description: "Compare-only disputed setup. Starts the fight at the selected percent of max HP without changing max HP.",
        }
      : null,
    creatureHasAbility(creature, "Strength In Numbers")
      ? {
          id: "strengthInNumbers" as const,
          label: "Strength In Numbers",
          description: `Compare-only disputed effect. Each nearby ally with this ability adds +${STRENGTH_IN_NUMBERS_DAMAGE_PER_ALLY}% damage, up to ${STRENGTH_IN_NUMBERS_MAX_ALLIES}. The stamina regen bonus is not modeled.`,
        }
      : null,
    creatureHasAbility(creature, "Thorn Trap") || creatureHasAbility(creature, "Toxic Trap")
      ? {
          id: "traps" as const,
          label: "Traps",
          description: "Compare-only disputed effect. Enables the creature's trap abilities (Thorn Trap and Toxic Trap) so they activate on cooldown. When disabled, neither trap fires.",
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
          description: "Compare-only disputed effect. Enables this creature's trail/step abilities (Toxic/Plague/Flame/Frost Trail and Healing Step). While any trail is active, No Move Facetank is overridden off for the owner so persistent statuses decay naturally.",
        }
      : null,
  ].filter((ability): ability is CompareSpecialAbilityOption => ability !== null);

  useEffect(() => {
    if (!specialAbilities) return;
    setGourmandizerHungerInput(String(specialAbilities.gourmandizerStartingHunger));
    setStrengthInNumbersAlliesInput(String(specialAbilities.strengthInNumbersAllies));
    setWardenRageStartHpInput(String(specialAbilities.wardenRageStartHpPct ?? WARDEN_RAGE_START_HP_DEFAULT_PCT));
  }, [specialAbilities]);

  return (
    <div className="panel-block">
      <h3>{label}</h3>
      <div className="field">
        <label htmlFor={creatureInputId}>Creature</label>
        <div className="icon-input">
          <IconImg src={iconUrl} alt={name} size={36} />
          <CreatureNameInput
            id={creatureInputId}
            value={name}
            onChange={onNameChange}
            creatureNames={creatureNames}
          />
        </div>
      </div>
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
        <PlushieSelectors build={build} onBuildChange={onBuildChange} />
      </div>
      <div className="field">
        <label>Elder</label>
        <ElderSelector build={build} onBuildChange={onBuildChange} />
      </div>
      {specialAbilities && onSpecialAbilitiesChange && (availableSpecialAbilities.length > 0 || hasSecondaryAttackOption || hasHealingPulse || hasTwoFaced || (creature?.userAbilityIds?.length ?? 0) > 0 || !!onPosturePolicyChange) ? (() => {
        // Categorize availableSpecialAbilities into UI buckets. Each
        // ability id appears in exactly one bucket.
        const startingStateAbilities = availableSpecialAbilities.filter(
          (a) => a.id === "startingSpiteCharged" || a.id === "wardenRageStartHp",
        );
        const aoeAbilities = availableSpecialAbilities.filter(
          (a) => a.id === "traps" || a.id === "trails",
        );
        const mainSpecialAbilities = availableSpecialAbilities.filter(
          (a) =>
            a.id !== "startingSpiteCharged" &&
            a.id !== "wardenRageStartHp" &&
            a.id !== "traps" &&
            a.id !== "trails",
        );
        const aiPolicyCount = (onPosturePolicyChange ? 1 : 0) + (hasSecondaryAttackOption ? 1 : 0);
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
          {/* 1. Per-side AI policy — Sit/Lay/Stand + Bite attack get their
              own single-row blocks so the 3-button segmented selector
              inside each chip never overflows when the panel narrows. */}
          {aiPolicyCount > 0 ? (
            <>
              <div className="compare-buff-heading">
                <span>Per-side AI policy</span>
                <span>{aiPolicyCount}</span>
              </div>
              {onPosturePolicyChange ? (
                <div className="compare-buff-single-row">
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
                </div>
              ) : null}
              {hasSecondaryAttackOption ? (
                <div className="compare-buff-single-row">
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
                </div>
              ) : null}
            </>
          ) : null}

          {/* 2. Starting state — Spite ready at start, Warden Rage Start HP */}
          {startingStateAbilities.length > 0 ? (
            <>
              <div className="compare-buff-heading">
                <span>Starting state</span>
                <span>{startingStateAbilities.length}</span>
              </div>
              <div className="compare-buff-grid">{startingStateAbilities.map(renderAbilityChip)}</div>
            </>
          ) : null}

          {/* 3. Specific / disputed abilities — main category */}
          {mainSpecialAbilities.length > 0 ? (
            <>
              <div className="compare-buff-heading">
                <span>Specific / disputed abilities</span>
                <span>{mainSpecialAbilities.length}</span>
              </div>
              <div className="compare-buff-grid">{mainSpecialAbilities.map(renderAbilityChip)}</div>
            </>
          ) : null}

          {/* 4. Ability modes — Healing Pulse + Two-Faced merged. Both
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
                      title="Compare-only disputed ability. When enabled, choose Normal (recurring radius cast on cooldown) or Once at start (single self-only cast at t=0)."
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
                  <div className="compare-special-level-grid">
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

          {/* 5. Compare-only AOE — Traps + Trails merged. Both are
              compare-only gated AOE/trail effects. */}
          {aoeAbilities.length > 0 ? (
            <>
              <div className="compare-buff-heading">
                <span>Compare-only AOE</span>
                <span>{aoeAbilities.length}</span>
              </div>
              <div className="compare-buff-grid">{aoeAbilities.map(renderAbilityChip)}</div>
            </>
          ) : null}

          {hasSecondaryAttackOption && compareBiteVariantMode !== "primaryOnly" ? (
            <div className="build-details">
              <strong>Bite attack — {compareBiteVariantMode === "dynamic" ? "Dynamic" : "Secondary only"}</strong>
              <span>
                {compareBiteVariantMode === "secondaryOnly"
                  ? `Every bite uses the secondary attack (${secondaryAttackDamage} damage). It keeps normal damage buffs but does not apply offensive status effects.`
                  : `Engine picks primary vs. secondary (${secondaryAttackDamage} damage) per bite. Cadence is unchanged — same bite cooldown either way; only the flavor of the bite swaps. Use Primary for guaranteed on-hit ailments or Secondary to fully lock damage2 in.`}
              </span>
            </div>
          ) : null}
          {availableSpecialAbilities.map(
            (ability) =>
              specialAbilities[ability.id] && (
                <div key={`${ability.id}-details`} className="build-details">
                  <strong>{ability.label}</strong>
                  <span>{ability.description}</span>
                  {ability.id === "gourmandizer" ? (
                    <div className="field">
                      <label htmlFor="compare-gourmandizer-hunger">Starting appetite fill %</label>
                      <input
                        id="compare-gourmandizer-hunger"
                        type="text"
                        inputMode="numeric"
                        value={gourmandizerHungerInput}
                        onChange={(e) => {
                          const rawValue = e.target.value.replace(/[^\d]/g, "");
                          setGourmandizerHungerInput(rawValue);
                          if (rawValue === "") return;
                          const nextHunger = Number(rawValue);
                          if (!Number.isFinite(nextHunger)) return;
                          onSpecialAbilitiesChange({
                            ...specialAbilities,
                            gourmandizerStartingHunger: normalizeCompareFillPct(nextHunger),
                          });
                        }}
                        onBlur={() => {
                          const rawValue = gourmandizerHungerInput.trim();
                          const normalized = rawValue === ""
                            ? normalizeCompareFillPct(specialAbilities.gourmandizerStartingHunger)
                            : normalizeCompareFillPct(Number(rawValue) || 0);
                          setGourmandizerHungerInput(String(normalized));
                          onSpecialAbilitiesChange({
                            ...specialAbilities,
                            gourmandizerStartingHunger: normalized,
                          });
                        }}
                      />
                      <span className="note">
                        {specialAbilities.hungerRule
                          ? `Weight changes dynamically from the current meter, and overfilled appetite above 100% drains faster.`
                          : `Only the starting weight bonus from total appetite fill above 100% is modeled here.`}
                      </span>
                    </div>
                  ) : null}
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
                        Each nearby ally with Strength In Numbers adds +{STRENGTH_IN_NUMBERS_DAMAGE_PER_ALLY}% damage. The stamina regen bonus is not modeled here.
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
                        {specialAbilities.hungerRule
                          ? `With hunger rules enabled, the owner uses ${defiledGroundConsumptionReductionPct}% less hunger or thirst and the opponent uses 20% more.`
                          : `Hunger and thirst consumption changes stay inactive until Use hunger rules is enabled.`}
                      </span>
                    </div>
                  ) : null}
                </div>
              ),
          )}
          {/* 6. Custom abilities — user-authored abilities attached to
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
                          <span className="note">Single-level ability — no per-fight level pick.</span>
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
