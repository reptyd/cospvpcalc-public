import { useEffect, useMemo, useState } from "react";
import "./bestBuildsBattleSettings.css";
import type {
  AbilityTimingMode,
  BuildOptions,
  CompareBiteVariantMode,
  CreatureRuntime,
  ElderVariant,
  UserAbilityLevelOverrides,
  UserAbilityTimingOverrides,
} from "../../engine";
import type { CompareDayNightMode, CompareMoonMode } from "../../engine/compareBuffRuntime";
import { creatureByName } from "../../engine/creatureData";
import { elderOptions, plushies, traits } from "../../engine/buildData";
import type { PosturePolicyMode } from "../../optimizer/rustCompareMatchupRuntime";
import { AscensionSelectors } from "../BuildSelectors";
import { ToggleSwitch } from "../ToggleSwitch";
import { compareBuffOptions, compareDayNightOptions, compareMoonOptions } from "../compare/compareBuffConfig";
import { WEATHER_OPTIONS, type WeatherCondition } from "../../engine/weather";
import type { CompareBuffId, CompareBuffSelection } from "../../engine/compareBuffRuntime";
import {
  ABILITY_TIMING_MODE_LABELS,
  ABILITY_TIMING_MODE_OPTIONS,
} from "../compare/compareAbilityTimingPolicy";
import {
  listCustomAbilityRecords,
  subscribeCustomAbilityRegistry,
  type CustomAbilityRecord,
} from "../../shared/customAbilities";
import {
  listCustomTimingRecords,
  subscribeCustomTimingRegistry,
  type CustomTimingRecord,
} from "../../shared/customTimings";
import { useBestBuildsBattleSettings } from "./BestBuildsBattleSettingsContext";
import {
  BB_KNOWN_OVERRIDE_ABILITIES,
  DEFAULT_BB_BATTLE_SETTINGS,
  type BbAbilityTimingOverrideKey,
  type BbAbilityTimingOverrides,
  type BestBuildsBattleSettings,
  type BestBuildsOpponentBaseline,
  type BestBuildsSideAiPolicy,
  type BestBuildsSideHealingPulse,
  type BestBuildsSideSettings,
  type BestBuildsSideSpecific,
  type BestBuildsSideStartingState,
  type BestBuildsSideTrapsTrails,
  type FirstTickMode,
} from "./bestBuildsBattleSettingsTypes";

type SpecificFlagKey = keyof Pick<
  BestBuildsSideSpecific,
  | "volcanic"
  | "frosty"
  | "defiledGround"
  | "gourmandizer"
  | "broodwatcher"
  | "hungerRule"
  | "powerCharge"
  | "goreCharge"
  | "strengthInNumbers"
>;

const SPECIFIC_FLAGS: ReadonlyArray<{ id: SpecificFlagKey; label: string; title: string }> = [
  { id: "volcanic", label: "Volcanic", title: "Volcanic - +50% health regen (only the regen part is modeled here). Applies to creatures with Volcanic." },
  { id: "frosty", label: "Frosty", title: "Frosty - +25% health regen and +25% stamina regen. Applies to creatures with Frosty (innate or via Frosty plushie)." },
  { id: "defiledGround", label: "Defiled Ground", title: "Defiled Ground - choose level below for owner bonuses + opponent Weakness." },
  { id: "gourmandizer", label: "Gourmandizer", title: "Gourmandizer - applies starting weight bonus from appetite fill > 100% (and engine drain/overfill behavior when hunger rule is on)." },
  { id: "broodwatcher", label: "Broodwatcher", title: "Broodwatcher - starts the fight with 5 Defensive stacks that do not decay naturally." },
  { id: "hungerRule", label: "Use hunger rules", title: "Compare-only disputed rule. Appetite drains by 1 unit every 30s, Disease accelerates it, Gourmandizer overfill drains faster, Reflux spends 25 pp per cast." },
  { id: "powerCharge", label: "Power Charge", title: "First melee hit only gains +50% damage and applies 2 Shredded Wings." },
  { id: "goreCharge", label: "Gore Charge", title: "First melee hit only applies 2 Bleed and 10 Deep Wounds." },
  { id: "strengthInNumbers", label: "Strength In Numbers", title: "Each nearby ally adds +1.5% damage (up to 9)." },
];

/**
 * Entry point used by Best Builds + Optimizer control panels. Renders a
 * compact trigger button; clicking it opens the full Battle Settings
 * modal. Reads + writes the shared BestBuildsBattleSettingsContext so
 * both pages stay in sync.
 */
export type BestBuildsBattleSettingsPanelProps = {
  /** Source creature name (the one whose build is being optimized). Used
   *  to filter the Disabled-abilities cell to abilities the creature
   *  actually owns. Omit when unknown. */
  sourceName?: string;
  /** Opponent pool creature names. Used to build the union of abilities
   *  shown in the Opponent Disabled-abilities cell. Omit when unknown. */
  opponentNames?: string[];
};

export function BestBuildsBattleSettingsPanel({
  sourceName,
  opponentNames,
}: BestBuildsBattleSettingsPanelProps = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="bb-battle-settings-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        Battle Settings…
      </button>
      {open ? (
        <BattleSettingsModal
          onClose={() => setOpen(false)}
          sourceName={sourceName}
          opponentNames={opponentNames}
        />
      ) : null}
    </>
  );
}

function BattleSettingsModal({
  onClose,
  sourceName,
  opponentNames,
}: {
  onClose: () => void;
  sourceName?: string;
  opponentNames?: string[];
}) {
  const { settings, setSettings } = useBestBuildsBattleSettings();
  return (
    <div
      className="bb-settings-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Battle Settings"
      onClick={onClose}
    >
      <div className="bb-settings-modal" onClick={(e) => e.stopPropagation()}>
        <header className="bb-settings-modal__header">
          <h3 className="bb-settings-modal__title">Battle Settings</h3>
          <button
            type="button"
            className="bb-settings-modal__close"
            aria-label="Close Battle Settings"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="bb-settings-modal__body">
          <GlobalRulesSection settings={settings} setSettings={setSettings} />
          <OpponentBaselineSection settings={settings} setSettings={setSettings} />
          <PerSideSection
            settings={settings}
            setSettings={setSettings}
            sourceName={sourceName}
            opponentNames={opponentNames}
          />
        </div>
        <footer className="bb-settings-modal__footer">
          <button
            type="button"
            className="bb-settings-modal__reset"
            onClick={() => setSettings(DEFAULT_BB_BATTLE_SETTINGS)}
          >
            Reset to defaults
          </button>
          <button
            type="button"
            className="bb-settings-modal__done"
            onClick={onClose}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Global rules (applied to both sides for every matchup)
// ---------------------------------------------------------------------------

function GlobalRulesSection({
  settings,
  setSettings,
}: {
  settings: BestBuildsBattleSettings;
  setSettings: (next: BestBuildsBattleSettings) => void;
}) {
  const updateGlobal = (patch: Partial<BestBuildsBattleSettings["global"]>) => {
    setSettings({ ...settings, global: { ...settings.global, ...patch } });
  };
  return (
    <section className="bb-settings-section" aria-labelledby="bb-settings-global-title">
      <h4 id="bb-settings-global-title" className="bb-settings-section__title">
        Global rules
      </h4>
      <p className="bb-settings-section__hint">
        Applied to both sides for every matchup in the run.
      </p>
      <div className="bb-settings-global-grid">
        <div className="field">
          <label htmlFor="bb-ability-timing-mode">Ability timing mode</label>
          <select
            id="bb-ability-timing-mode"
            value={settings.global.abilityTimingMode}
            onChange={(e) => updateGlobal({ abilityTimingMode: e.target.value as AbilityTimingMode })}
          >
            <option value="reallyFast">Really fast</option>
            <option value="fast">Fast</option>
            <option value="semiIdeal">Semi-ideal</option>
            <option value="ideal">Ideal</option>
            <option value="extreme">Extreme</option>
          </select>
          <span className="note">
            Drives the refinement-stage ability policy. Quick &amp; stage-2 funnel
            stages keep their hardcoded fast / ideal cadence.
          </span>
        </div>
        <div className="field">
          <label htmlFor="bb-day-night">Day / Night</label>
          <select
            id="bb-day-night"
            value={settings.global.dayNight}
            onChange={(e) => updateGlobal({ dayNight: e.target.value as CompareDayNightMode })}
          >
            {compareDayNightOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="note">
            Photovore / Photocarnivore diets gain or lose the day/night buff.
          </span>
        </div>
        <div className="field">
          <label htmlFor="bb-moon">Moon</label>
          <select
            id="bb-moon"
            value={settings.global.moon}
            onChange={(e) => updateGlobal({ moon: e.target.value as CompareMoonMode })}
          >
            {compareMoonOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="note">Drives moon-gated abilities and stat buffs.</span>
        </div>
        <div className="field">
          <label htmlFor="bb-weather">Weather</label>
          <select
            id="bb-weather"
            value={settings.global.weather}
            onChange={(e) => updateGlobal({ weather: e.target.value as WeatherCondition })}
          >
            {WEATHER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="note">
            Applied to both sides every 3s. Heat Wave: 1% HP + Burn (Volcanic
            immune). Blizzard: 0.75% HP (Frosty immune). Acid Rain: 3% HP +
            Poison (no immunity).
          </span>
        </div>
        <div className="field">
          <label htmlFor="bb-first-tick">First Tick Rule</label>
          <select
            id="bb-first-tick"
            value={settings.global.firstTickMode}
            onChange={(e) => updateGlobal({ firstTickMode: e.target.value as FirstTickMode })}
          >
            <option value="off">Off</option>
            <option value="ailments">Ailments only</option>
            <option value="regen">Regen only</option>
            <option value="both">Ailments + Regen</option>
          </select>
          {settings.global.firstTickMode !== "off" ? (
            <SmartNumericInput
              id="bb-first-tick-delay"
              ariaLabel="First Tick delay (sec)"
              value={settings.global.firstTickDelaySec}
              clamp={(raw) => Math.max(0.1, raw)}
              onCommit={(next) => updateGlobal({ firstTickDelaySec: next })}
              allowDecimal
            />
          ) : null}
          <span className="note">
            Regen / ailments first-tick override. Delay shown when mode ≠ Off.
          </span>
        </div>
        <div className="bb-settings-global-grid__full">
          <ToggleSwitch
            checked={settings.global.noMoveFacetank}
            onChange={(v) => updateGlobal({ noMoveFacetank: v })}
            label="No Move Facetank"
            description={
              settings.global.noMoveFacetank
                ? "Persistent stand-and-fight statuses decay naturally."
                : "Keep persistent stand-and-fight statuses from decaying naturally."
            }
          />
        </div>
        <div className="bb-settings-global-grid__full">
          <ToggleSwitch
            checked={settings.global.airRuleEnabled}
            onChange={(v) => updateGlobal({ airRuleEnabled: v })}
            label="Special Air PvP Rule"
            description={
              settings.global.airRuleEnabled
                ? `Both creatures use a shared ${settings.global.airRuleCooldownSec.toFixed(2)}s bite cooldown. Bite-cooldown buffs / berserk ignored.`
                : "Each creature uses its own bite cooldown."
            }
          />
          {settings.global.airRuleEnabled ? (
            <div className="field" style={{ marginTop: 8 }}>
              <label htmlFor="bb-air-rule-cooldown">Shared Bite Cooldown (sec)</label>
              <SmartNumericInput
                id="bb-air-rule-cooldown"
                value={settings.global.airRuleCooldownSec}
                clamp={(raw) => Math.max(0.1, raw)}
                onCommit={(next) => updateGlobal({ airRuleCooldownSec: next })}
                allowDecimal
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Opponent pool baseline build (Damage/Bite Void/Void Powerful-stage5 by
// default; toggle to override every opponent's build in the active pool)
// ---------------------------------------------------------------------------

function OpponentBaselineSection({
  settings,
  setSettings,
}: {
  settings: BestBuildsBattleSettings;
  setSettings: (next: BestBuildsBattleSettings) => void;
}) {
  const baseline = settings.opponentBaseline;
  const updateBaseline = (patch: Partial<BestBuildsOpponentBaseline>) => {
    setSettings({ ...settings, opponentBaseline: { ...baseline, ...patch } });
  };
  const updateBuild = (patch: Partial<BuildOptions>) => {
    updateBaseline({ build: { ...baseline.build, ...patch } });
  };
  const traitChoices = useMemo(
    () => traits.map((t) => ({ id: t.id, name: t.name })),
    [],
  );
  const plushieNames = useMemo(() => plushies.map((p) => p.name), []);
  return (
    <section
      className="bb-settings-section"
      aria-labelledby="bb-settings-opponent-baseline-title"
    >
      <h4
        id="bb-settings-opponent-baseline-title"
        className="bb-settings-section__title"
      >
        Opponent pool baseline build
      </h4>
      <p className="bb-settings-section__hint">
        The build BB applies to every opponent in the active pool. Defaults
        to the historical baseline (Void/Void · Damage/Bite · Damage×5 ·
        Powerful · stage 5). Enable the override to pick a different
        baseline.
      </p>
      <ToggleSwitch
        checked={baseline.enabled}
        onChange={(v) => updateBaseline({ enabled: v })}
        label="Customize opponent pool baseline"
        description={
          baseline.enabled
            ? "Active - applied to every opponent in the active pool."
            : "Disabled - opponents use the legacy hardcoded baseline."
        }
      />
      {baseline.enabled ? (
        <div className="bb-settings-baseline-grid">
          <div className="field">
            <label htmlFor="bb-baseline-stage">Veneration stage</label>
            <select
              id="bb-baseline-stage"
              value={baseline.build.venerationStage}
              onChange={(e) =>
                updateBuild({ venerationStage: Number(e.target.value) })
              }
            >
              {[1, 2, 3, 4, 5].map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bb-baseline-elder">Elder</label>
            <select
              id="bb-baseline-elder"
              value={baseline.build.elder ?? "None"}
              onChange={(e) =>
                updateBuild({ elder: e.target.value as ElderVariant })
              }
            >
              {elderOptions.map((elder) => (
                <option key={elder} value={elder}>
                  {elder}
                </option>
              ))}
            </select>
          </div>
          {[0, 1].map((idx) => (
            <div className="field" key={`trait-${idx}`}>
              <label htmlFor={`bb-baseline-trait-${idx}`}>
                Trait {idx + 1}
              </label>
              <select
                id={`bb-baseline-trait-${idx}`}
                value={baseline.build.traits[idx] ?? ""}
                onChange={(e) => {
                  const next = [...baseline.build.traits];
                  next[idx] = e.target.value;
                  updateBuild({ traits: next });
                }}
              >
                {traitChoices.map((trait) => (
                  <option key={trait.id} value={trait.id}>
                    {trait.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {[0, 1].map((idx) => (
            <div className="field" key={`plushie-${idx}`}>
              <label htmlFor={`bb-baseline-plushie-${idx}`}>
                Plushie {idx + 1}
              </label>
              <select
                id={`bb-baseline-plushie-${idx}`}
                value={baseline.build.plushies[idx] ?? ""}
                onChange={(e) => {
                  const next = [...baseline.build.plushies];
                  next[idx] = e.target.value;
                  updateBuild({ plushies: next });
                }}
              >
                {plushieNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="bb-settings-baseline-grid__ascensions">
            <span className="bb-settings-baseline-grid__ascensions-label">
              Ascension
            </span>
            <AscensionSelectors
              build={baseline.build}
              onBuildChange={(nextBuild) => updateBaseline({ build: nextBuild })}
            />
            <span className="bb-settings-baseline-grid__ascensions-hint">
              Total points = veneration stage. Single trait gets all points
              automatically; two traits split per the numbers above.
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Per-side configuration - symmetric two-column grid
// ---------------------------------------------------------------------------

function PerSideSection({
  settings,
  setSettings,
  sourceName,
  opponentNames,
}: {
  settings: BestBuildsBattleSettings;
  setSettings: (next: BestBuildsBattleSettings) => void;
  sourceName?: string;
  opponentNames?: string[];
}) {
  const updateSide = (side: "source" | "opponent", patch: Partial<BestBuildsSideSettings>) => {
    setSettings({ ...settings, [side]: { ...settings[side], ...patch } });
  };
  const sourceAbilityNames = useMemo(
    () => collectCreatureAbilityNames(sourceName ? [sourceName] : []),
    [sourceName],
  );
  const opponentAbilityNames = useMemo(
    () => collectCreatureAbilityNames(opponentNames ?? []),
    [opponentNames],
  );
  const sourceUserAbilityIds = useMemo(
    () => collectCreatureUserAbilityIds(sourceName ? [sourceName] : []),
    [sourceName],
  );
  const opponentUserAbilityIds = useMemo(
    () => collectCreatureUserAbilityIds(opponentNames ?? []),
    [opponentNames],
  );
  const [abilityRecords, setAbilityRecords] = useState<CustomAbilityRecord[]>(
    () => listCustomAbilityRecords(),
  );
  const [timingRecords, setTimingRecords] = useState<CustomTimingRecord[]>(
    () => listCustomTimingRecords(),
  );
  useEffect(
    () =>
      subscribeCustomAbilityRegistry(() =>
        setAbilityRecords(listCustomAbilityRecords()),
      ),
    [],
  );
  useEffect(
    () =>
      subscribeCustomTimingRegistry(() =>
        setTimingRecords(listCustomTimingRecords()),
      ),
    [],
  );
  return (
    <section className="bb-settings-section" aria-labelledby="bb-settings-perside-title">
      <h4 id="bb-settings-perside-title" className="bb-settings-section__title">
        Per-side configuration
      </h4>
      <p className="bb-settings-section__hint">
        <strong>Source</strong> = the creature whose build is being optimized.{" "}
        <strong>Opponent</strong> = every creature in the active pool collectively.
        Toggles that target an ability a particular creature doesn't own are
        silently ignored by the engine.
      </p>
      <div className="bb-settings-grid">
        <div className="bb-settings-grid__head bb-settings-grid__head--label" aria-hidden="true" />
        <div className="bb-settings-grid__head">Source</div>
        <div className="bb-settings-grid__head">Opponent</div>

        <CategoryLabel
          title="AI policy"
          hint="Sit/Lay/Stand decision + which bite variant to use per swing."
        />
        <AiPolicyCell
          idPrefix="bb-source"
          policy={settings.source.aiPolicy}
          onChange={(next) => updateSide("source", { aiPolicy: next })}
        />
        <AiPolicyCell
          idPrefix="bb-opponent"
          policy={settings.opponent.aiPolicy}
          onChange={(next) => updateSide("opponent", { aiPolicy: next })}
        />

        <CategoryLabel
          title="Starting state"
          hint="Fight-init conditions; applied per-side where the ability is owned."
        />
        <StartingStateCell
          idPrefix="bb-source"
          state={settings.source.startingState}
          onChange={(next) => updateSide("source", { startingState: next })}
        />
        <StartingStateCell
          idPrefix="bb-opponent"
          state={settings.opponent.startingState}
          onChange={(next) => updateSide("opponent", { startingState: next })}
        />

        <CategoryLabel
          title="Healing Pulse"
          hint="Compare-only modeled ability; applies only where the creature owns Healing Pulse."
        />
        <HealingPulseCell
          idPrefix="bb-source"
          state={settings.source.healingPulse}
          onChange={(next) => updateSide("source", { healingPulse: next })}
        />
        <HealingPulseCell
          idPrefix="bb-opponent"
          state={settings.opponent.healingPulse}
          onChange={(next) => updateSide("opponent", { healingPulse: next })}
        />

        <CategoryLabel
          title="Traps & Trails"
          hint="Master toggles for trap (Thorn / Toxic / Frost Snare) and trail (Healing Step / Flame / Frost / Plague / Toxic) abilities. Traps default ON to preserve BB's pre-toggle behavior; trails default OFF (forwards numeric values from the spec only when on)."
        />
        <TrapsTrailsCell
          idPrefix="bb-source"
          state={settings.source.trapsTrails}
          onChange={(next) => updateSide("source", { trapsTrails: next })}
        />
        <TrapsTrailsCell
          idPrefix="bb-opponent"
          state={settings.opponent.trapsTrails}
          onChange={(next) => updateSide("opponent", { trapsTrails: next })}
        />

        <CategoryLabel
          title="Specific / Disputed"
          hint="Compare-only modeled abilities. Each toggle is silently ignored by the engine for creatures that don't own it."
        />
        <SpecificCell
          idPrefix="bb-source"
          spec={settings.source.specific}
          onChange={(next) => updateSide("source", { specific: next })}
        />
        <SpecificCell
          idPrefix="bb-opponent"
          spec={settings.opponent.specific}
          onChange={(next) => updateSide("opponent", { specific: next })}
        />

        <CategoryLabel
          title="Disabled abilities"
          hint="Skip these abilities in combat. Source cell lists the source creature's abilities; Opponent cell lists the union of every ability across the active pool."
        />
        <DisabledAbilitiesCell
          idPrefix="bb-source"
          abilityNames={sourceAbilityNames}
          disabled={settings.source.disabledAbilities}
          emptyHint={sourceName ? "Source creature has no abilities." : "No source creature selected."}
          onChange={(next) => updateSide("source", { disabledAbilities: next })}
        />
        <DisabledAbilitiesCell
          idPrefix="bb-opponent"
          abilityNames={opponentAbilityNames}
          disabled={settings.opponent.disabledAbilities}
          emptyHint={
            opponentNames && opponentNames.length > 0
              ? "Opponent pool has no abilities."
              : "Opponent pool is empty."
          }
          onChange={(next) => updateSide("opponent", { disabledAbilities: next })}
        />

        <CategoryLabel
          title="Buffs"
          hint="Compare-style buffs applied via the same applyCompareBuffRuntime function (mutates FinalStats + starting statuses + active-cooldown multiplier). Plushie variants (Bear / Land / Eclipse) aren't wired yet - those need per-matchup build plumbing."
        />
        <BuffsCell
          idPrefix="bb-source"
          buffs={settings.source.buffs}
          onChange={(next) => updateSide("source", { buffs: next })}
        />
        <BuffsCell
          idPrefix="bb-opponent"
          buffs={settings.opponent.buffs}
          onChange={(next) => updateSide("opponent", { buffs: next })}
        />

        <CategoryLabel
          title="Ability timing overrides"
          hint="Pin a per-ability timing mode instead of using the Global Ability timing setting. Only abilities owned by the source (or any pool opponent) are listed."
        />
        <AbilityTimingOverridesCell
          idPrefix="bb-source"
          allAbilityNames={sourceAbilityNames}
          overrides={settings.source.abilityTimingOverrides}
          emptyHint={
            sourceName
              ? "Source creature has no abilities with timing-override support."
              : "No source creature selected."
          }
          onChange={(next) => updateSide("source", { abilityTimingOverrides: next })}
        />
        <AbilityTimingOverridesCell
          idPrefix="bb-opponent"
          allAbilityNames={opponentAbilityNames}
          overrides={settings.opponent.abilityTimingOverrides}
          emptyHint={
            opponentNames && opponentNames.length > 0
              ? "Opponent pool has no abilities with timing-override support."
              : "Opponent pool is empty."
          }
          onChange={(next) => updateSide("opponent", { abilityTimingOverrides: next })}
        />

        <CategoryLabel
          title="Custom-ability timing"
          hint="Per-matchup timing for user-authored abilities attached to a creature (via Custom > Creatures). Picks a built-in timing mode OR a registered custom timing. Empty = use the spec's own default."
        />
        <CustomAbilityTimingCell
          idPrefix="bb-source"
          attachedIds={sourceUserAbilityIds}
          abilityRecords={abilityRecords}
          timingRecords={timingRecords}
          overrides={settings.source.userAbilityOverrides}
          emptyHint={
            sourceName
              ? "Source creature has no custom abilities attached. Attach one under Custom > Creatures."
              : "No source creature selected."
          }
          onChange={(next) => updateSide("source", { userAbilityOverrides: next })}
        />
        <CustomAbilityTimingCell
          idPrefix="bb-opponent"
          attachedIds={opponentUserAbilityIds}
          abilityRecords={abilityRecords}
          timingRecords={timingRecords}
          overrides={settings.opponent.userAbilityOverrides}
          emptyHint={
            opponentNames && opponentNames.length > 0
              ? "Opponent pool has no custom abilities attached."
              : "Opponent pool is empty."
          }
          onChange={(next) => updateSide("opponent", { userAbilityOverrides: next })}
        />

        <CategoryLabel
          title="Custom-ability level"
          hint="Pick Lv 1/2/… for user abilities that declare levels > 1. Empty = use the spec's default_level. Abilities without leveling don't appear here."
        />
        <CustomAbilityLevelCell
          idPrefix="bb-source"
          attachedIds={sourceUserAbilityIds}
          abilityRecords={abilityRecords}
          levels={settings.source.userAbilityLevels}
          emptyHint={
            sourceName
              ? "Source creature has no leveled custom abilities."
              : "No source creature selected."
          }
          onChange={(next) => updateSide("source", { userAbilityLevels: next })}
        />
        <CustomAbilityLevelCell
          idPrefix="bb-opponent"
          attachedIds={opponentUserAbilityIds}
          abilityRecords={abilityRecords}
          levels={settings.opponent.userAbilityLevels}
          emptyHint={
            opponentNames && opponentNames.length > 0
              ? "Opponent pool has no leveled custom abilities."
              : "Opponent pool is empty."
          }
          onChange={(next) => updateSide("opponent", { userAbilityLevels: next })}
        />
      </div>
    </section>
  );
}

/**
 * Returns a sorted, deduplicated list of ability names from every passive
 * / activated / breath ability across the given creature names. Names
 * unknown to the creature registry are silently skipped.
 */
function collectCreatureAbilityNames(creatureNames: string[]): string[] {
  const set = new Set<string>();
  for (const name of creatureNames) {
    const creature: CreatureRuntime | undefined = creatureByName[name];
    if (!creature) continue;
    for (const ability of creature.passiveAbilities ?? []) set.add(ability.name);
    for (const ability of creature.activatedAbilities ?? []) set.add(ability.name);
    for (const ability of creature.breathAbilities ?? []) set.add(ability.name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Returns a sorted, deduplicated list of user-ability ids attached to any
 * of the given creatures (via `creature.userAbilityIds`). Stale ids that
 * no longer exist in the custom-ability registry stay in the list so the
 * UI can render them with a "Stale id" caption.
 */
function collectCreatureUserAbilityIds(creatureNames: string[]): string[] {
  const set = new Set<string>();
  for (const name of creatureNames) {
    const creature: CreatureRuntime | undefined = creatureByName[name];
    if (!creature) continue;
    for (const id of creature.userAbilityIds ?? []) set.add(id);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function CategoryLabel({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="bb-settings-grid__label">
      <span className="bb-settings-grid__label-title">{title}</span>
      <span className="bb-settings-grid__label-hint">{hint}</span>
    </div>
  );
}

/**
 * Compare-style numeric input. Mirrors the pattern used by
 * `CreatureSelectorCard.tsx` for gourmandizer-hunger, nearby-allies,
 * and Warden's-Rage start HP: text input with numeric inputMode +
 * local text state, so the user can clear the field while typing
 * without the value snapping back. Edits commit on change (clamped)
 * and re-normalize on blur. Restores the last canonical value if
 * the user blurs an empty field.
 *
 *  - `allowDecimal=true` keeps a single optional dot in the local
 *    text (for sec-grain fields like airRuleCooldownSec).
 *  - `allowDecimal=false` (default) strips to digits only for
 *    integer fields like Nearby allies / gourmandizer fill %.
 *  - `clamp` normalizes parsed numbers (range + min/max + floor).
 *    The function is the source of truth for the field's valid
 *    range; the caller doesn't need to handle invalid input.
 */
function SmartNumericInput({
  id,
  ariaLabel,
  value,
  clamp,
  onCommit,
  allowDecimal = false,
}: {
  id: string;
  ariaLabel?: string;
  value: number;
  clamp: (raw: number) => number;
  onCommit: (next: number) => void;
  allowDecimal?: boolean;
}) {
  const [text, setText] = useState(() => String(value));
  // Re-sync the local text whenever the canonical value changes from
  // the outside (e.g. Reset to defaults, or a sibling field reflowing
  // it). Skip the resync while the input is focused so we don't
  // clobber an in-flight edit.
  useEffect(() => {
    if (document.activeElement?.id === id) return;
    setText(String(value));
  }, [value, id]);
  const stripper = allowDecimal
    ? (raw: string) => {
        let cleaned = raw.replace(/[^\d.]/g, "");
        const firstDot = cleaned.indexOf(".");
        if (firstDot >= 0) {
          cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
        }
        return cleaned;
      }
    : (raw: string) => raw.replace(/[^\d]/g, "");
  return (
    <input
      id={id}
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => {
        const next = stripper(e.target.value);
        setText(next);
        if (next === "" || next === ".") return;
        const parsed = Number(next);
        if (!Number.isFinite(parsed)) return;
        onCommit(clamp(parsed));
      }}
      onBlur={() => {
        const trimmed = text.trim();
        const normalized =
          trimmed === "" || trimmed === "." ? clamp(value) : clamp(Number(trimmed) || 0);
        setText(String(normalized));
        onCommit(normalized);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Per-side cells (one row's worth of controls for a single side)
// ---------------------------------------------------------------------------

function AiPolicyCell({
  idPrefix,
  policy,
  onChange,
}: {
  idPrefix: string;
  policy: BestBuildsSideAiPolicy;
  onChange: (next: BestBuildsSideAiPolicy) => void;
}) {
  return (
    <div className="bb-settings-grid__cell">
      <div className="field">
        <label htmlFor={`${idPrefix}-posture`}>Sit/Lay/Stand Policy</label>
        <select
          id={`${idPrefix}-posture`}
          value={policy.posturePolicy}
          onChange={(e) => onChange({ ...policy, posturePolicy: e.target.value as PosturePolicyMode })}
        >
          <option value="off">Off (always Standing)</option>
          <option value="regenAware">Regen-aware</option>
          <option value="regenUnaware">Regen-unaware</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-bite-variant`}>Bite attack</label>
        <select
          id={`${idPrefix}-bite-variant`}
          value={policy.biteVariantMode}
          onChange={(e) =>
            onChange({ ...policy, biteVariantMode: e.target.value as CompareBiteVariantMode })
          }
        >
          <option value="primaryOnly">Primary</option>
          <option value="dynamic">Dynamic</option>
          <option value="secondaryOnly">Secondary</option>
        </select>
      </div>
    </div>
  );
}

function StartingStateCell({
  idPrefix,
  state,
  onChange,
}: {
  idPrefix: string;
  state: BestBuildsSideStartingState;
  onChange: (next: BestBuildsSideStartingState) => void;
}) {
  return (
    <div className="bb-settings-grid__cell">
      <ToggleSwitch
        checked={state.spiteReadyAtStart}
        onChange={(value) => onChange({ ...state, spiteReadyAtStart: value })}
        label="Spite ready at start"
        description="Opening bite immediately consumes a fully-charged Spite."
      />
      <ToggleSwitch
        checked={state.wardenRageStartHpEnabled}
        onChange={(value) => onChange({ ...state, wardenRageStartHpEnabled: value })}
        label="Override Warden's-Rage Start HP"
        description="Sets current HP at t=0 (max HP unchanged)."
      />
      {state.wardenRageStartHpEnabled ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-warden-hp`}>Start HP % (1-100)</label>
          <SmartNumericInput
            id={`${idPrefix}-warden-hp`}
            value={state.wardenRageStartHpPct}
            clamp={(raw) => {
              if (!Number.isFinite(raw)) return 50;
              return Math.max(1, Math.min(100, Math.floor(raw)));
            }}
            onCommit={(next) => onChange({ ...state, wardenRageStartHpPct: next })}
          />
        </div>
      ) : null}
    </div>
  );
}

function BuffsCell({
  idPrefix,
  buffs,
  onChange,
}: {
  idPrefix: string;
  buffs: CompareBuffSelection;
  onChange: (next: CompareBuffSelection) => void;
}) {
  const toggle = (id: CompareBuffId) => onChange({ ...buffs, [id]: !buffs[id] });
  return (
    <div className="bb-settings-grid__cell">
      <div className="bb-spec-chips" role="group" aria-label={`Buffs for ${idPrefix}`}>
        {compareBuffOptions.map((buff) => (
          <label
            key={buff.id}
            className={`compare-buff-chip${buffs[buff.id] ? " selected" : ""}`}
            title={buff.description}
          >
            <input
              type="checkbox"
              checked={buffs[buff.id]}
              onChange={() => toggle(buff.id)}
            />
            <span>{buff.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function AbilityTimingOverridesCell({
  idPrefix,
  allAbilityNames,
  overrides,
  emptyHint,
  onChange,
}: {
  idPrefix: string;
  allAbilityNames: string[];
  overrides: BbAbilityTimingOverrides;
  emptyHint: string;
  onChange: (next: BbAbilityTimingOverrides) => void;
}) {
  const applicable = useMemo(() => {
    const present = new Set(allAbilityNames);
    return BB_KNOWN_OVERRIDE_ABILITIES.filter((ability) => present.has(ability));
  }, [allAbilityNames]);
  if (applicable.length === 0) {
    return (
      <div className="bb-settings-grid__cell">
        <span className="bb-settings-grid__label-hint">{emptyHint}</span>
      </div>
    );
  }
  const setOverride = (ability: BbAbilityTimingOverrideKey, value: string) => {
    const next: BbAbilityTimingOverrides = { ...overrides };
    if (value === "") {
      delete next[ability];
    } else {
      next[ability] = value as AbilityTimingMode;
    }
    onChange(next);
  };
  return (
    <div className="bb-settings-grid__cell">
      {applicable.map((ability) => (
        <div className="field" key={ability}>
          <label htmlFor={`${idPrefix}-tov-${ability.replace(/\W+/g, "-").toLowerCase()}`}>
            {ability}
          </label>
          <select
            id={`${idPrefix}-tov-${ability.replace(/\W+/g, "-").toLowerCase()}`}
            value={overrides[ability] ?? ""}
            onChange={(e) => setOverride(ability, e.target.value)}
          >
            <option value="">Session default</option>
            <option value="reallyFast">Really fast</option>
            <option value="fast">Fast</option>
            <option value="semiIdeal">Semi-ideal</option>
            <option value="ideal">Ideal</option>
            <option value="extreme">Extreme</option>
          </select>
        </div>
      ))}
    </div>
  );
}

function DisabledAbilitiesCell({
  idPrefix,
  abilityNames,
  disabled,
  emptyHint,
  onChange,
}: {
  idPrefix: string;
  abilityNames: string[];
  disabled: string[];
  emptyHint: string;
  onChange: (next: string[]) => void;
}) {
  if (abilityNames.length === 0) {
    return (
      <div className="bb-settings-grid__cell">
        <span className="bb-settings-grid__label-hint">{emptyHint}</span>
      </div>
    );
  }
  const disabledSet = new Set(disabled);
  const toggle = (ability: string) => {
    onChange(
      disabledSet.has(ability)
        ? disabled.filter((value) => value !== ability)
        : [...disabled, ability],
    );
  };
  return (
    <div className="bb-settings-grid__cell">
      <div className="bb-spec-chips" role="group" aria-label={`Disabled abilities for ${idPrefix}`}>
        {abilityNames.map((ability) => (
          <label
            key={ability}
            className={`compare-buff-chip${disabledSet.has(ability) ? " selected" : ""}`}
            title={
              disabledSet.has(ability)
                ? `${ability} - currently DISABLED for matching creatures.`
                : `Click to disable ${ability} for matching creatures.`
            }
          >
            <input
              type="checkbox"
              checked={disabledSet.has(ability)}
              onChange={() => toggle(ability)}
            />
            <span>{ability}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SpecificCell({
  idPrefix,
  spec,
  onChange,
}: {
  idPrefix: string;
  spec: BestBuildsSideSpecific;
  onChange: (next: BestBuildsSideSpecific) => void;
}) {
  const toggle = (id: SpecificFlagKey) => onChange({ ...spec, [id]: !spec[id] });
  return (
    <div className="bb-settings-grid__cell">
      <div className="bb-spec-chips">
        {SPECIFIC_FLAGS.map((flag) => (
          <label
            key={flag.id}
            className={`compare-buff-chip${spec[flag.id] ? " selected" : ""}`}
            title={flag.title}
          >
            <input
              type="checkbox"
              checked={spec[flag.id]}
              onChange={() => toggle(flag.id)}
            />
            <span>{flag.label}</span>
          </label>
        ))}
      </div>
      {spec.defiledGround ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-defiled-level`}>Defiled Ground level</label>
          <select
            id={`${idPrefix}-defiled-level`}
            value={spec.defiledGroundLevel}
            onChange={(e) => {
              const lvl = Math.max(1, Math.min(3, Number(e.target.value) || 1)) as 1 | 2 | 3;
              onChange({ ...spec, defiledGroundLevel: lvl });
            }}
          >
            <option value={1}>Level 1</option>
            <option value={2}>Level 2</option>
            <option value={3}>Level 3</option>
          </select>
        </div>
      ) : null}
      {spec.gourmandizer ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-gourmandizer-fill`}>Starting appetite fill %</label>
          <SmartNumericInput
            id={`${idPrefix}-gourmandizer-fill`}
            value={spec.gourmandizerStartingHunger}
            clamp={(raw) => {
              if (!Number.isFinite(raw)) return 100;
              return Math.max(0, Math.floor(raw));
            }}
            onCommit={(next) => onChange({ ...spec, gourmandizerStartingHunger: next })}
          />
        </div>
      ) : null}
      {spec.strengthInNumbers ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-sin-allies`}>Nearby allies (0-9)</label>
          <SmartNumericInput
            id={`${idPrefix}-sin-allies`}
            value={spec.strengthInNumbersAllies}
            clamp={(raw) => {
              if (!Number.isFinite(raw)) return 0;
              return Math.max(0, Math.min(9, Math.floor(raw)));
            }}
            onCommit={(next) => onChange({ ...spec, strengthInNumbersAllies: next })}
          />
        </div>
      ) : null}
    </div>
  );
}

function TrapsTrailsCell({
  idPrefix,
  state,
  onChange,
}: {
  idPrefix: string;
  state: BestBuildsSideTrapsTrails;
  onChange: (next: BestBuildsSideTrapsTrails) => void;
}) {
  return (
    <div className="bb-settings-grid__cell">
      <div className="bb-spec-chips" role="group" aria-label={`Traps & Trails (${idPrefix})`}>
        <label
          className={`compare-buff-chip${state.traps ? " selected" : ""}`}
          title="Traps - when ON, creatures with Thorn Trap / Toxic Trap / Frost Snare fire them (BB's historical default). When OFF, all three trap booleans are forced to false in the engine config."
        >
          <input
            type="checkbox"
            checked={state.traps}
            onChange={() => onChange({ ...state, traps: !state.traps })}
          />
          <span>Traps</span>
        </label>
        <label
          className={`compare-buff-chip${state.trails ? " selected" : ""}`}
          title="Trails - when ON, BB forwards per-creature numeric values for Healing Step / Flame / Frost / Plague / Toxic Trail to the engine. When OFF (BB's historical default), trail damage values stay at 0."
        >
          <input
            type="checkbox"
            checked={state.trails}
            onChange={() => onChange({ ...state, trails: !state.trails })}
          />
          <span>Trails</span>
        </label>
      </div>
    </div>
  );
}

function CustomAbilityTimingCell({
  idPrefix,
  attachedIds,
  abilityRecords,
  timingRecords,
  overrides,
  emptyHint,
  onChange,
}: {
  idPrefix: string;
  attachedIds: string[];
  abilityRecords: CustomAbilityRecord[];
  timingRecords: CustomTimingRecord[];
  overrides: UserAbilityTimingOverrides;
  emptyHint: string;
  onChange: (next: UserAbilityTimingOverrides) => void;
}) {
  if (attachedIds.length === 0) {
    return (
      <div className="bb-settings-grid__cell">
        <span className="bb-settings-grid__label-hint">{emptyHint}</span>
      </div>
    );
  }
  const setChoice = (id: string, raw: string) => {
    const next = { ...overrides };
    if (raw === "default") {
      delete next[id];
    } else if (raw.startsWith("user:")) {
      next[id] = { kind: "user", timingId: raw.slice("user:".length) };
    } else {
      next[id] = { kind: "builtIn", mode: raw as AbilityTimingMode };
    }
    onChange(next);
  };
  return (
    <div className="bb-settings-grid__cell">
      {attachedIds.map((id) => {
        const record = abilityRecords.find((r) => r.spec.id === id);
        const displayName = record?.spec.display_name ?? id;
        const choice = overrides[id];
        const selectValue = choice
          ? choice.kind === "user"
            ? `user:${choice.timingId}`
            : choice.mode
          : "default";
        const stale = !record;
        return (
          <div className="field" key={id}>
            <label htmlFor={`${idPrefix}-uta-${id.replace(/\W+/g, "-").toLowerCase()}`}>
              {displayName}
              {stale ? <span className="bb-settings-grid__label-hint"> · stale id</span> : null}
            </label>
            <select
              id={`${idPrefix}-uta-${id.replace(/\W+/g, "-").toLowerCase()}`}
              value={selectValue}
              onChange={(e) => setChoice(id, e.target.value)}
            >
              <option value="default">Spec default (no override)</option>
              <optgroup label="Built-in modes">
                {ABILITY_TIMING_MODE_OPTIONS.map((mode) => (
                  <option key={mode} value={mode}>
                    {ABILITY_TIMING_MODE_LABELS[mode]}
                  </option>
                ))}
              </optgroup>
              {timingRecords.length > 0 ? (
                <optgroup label="Your custom timings">
                  {timingRecords.map((tr) => (
                    <option key={tr.spec.id} value={`user:${tr.spec.id}`}>
                      {tr.spec.display_name || tr.spec.id}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function CustomAbilityLevelCell({
  idPrefix,
  attachedIds,
  abilityRecords,
  levels,
  emptyHint,
  onChange,
}: {
  idPrefix: string;
  attachedIds: string[];
  abilityRecords: CustomAbilityRecord[];
  levels: UserAbilityLevelOverrides;
  emptyHint: string;
  onChange: (next: UserAbilityLevelOverrides) => void;
}) {
  // Filter attached ids down to those whose spec has levels > 1.
  // Single-level (or stale) entries have nothing to pick.
  const leveled = attachedIds
    .map((id) => ({ id, record: abilityRecords.find((r) => r.spec.id === id) }))
    .filter((row) => row.record !== undefined && (row.record.spec.levels ?? 1) > 1);

  if (leveled.length === 0) {
    return (
      <div className="bb-settings-grid__cell">
        <span className="bb-settings-grid__label-hint">{emptyHint}</span>
      </div>
    );
  }
  const setLevel = (id: string, raw: string) => {
    const next = { ...levels };
    if (raw === "default") {
      delete next[id];
    } else {
      const parsed = Number(raw);
      if (Number.isInteger(parsed) && parsed >= 1) {
        next[id] = parsed;
      }
    }
    onChange(next);
  };
  return (
    <div className="bb-settings-grid__cell">
      {leveled.map(({ id, record }) => {
        if (!record) return null;
        const displayName = record.spec.display_name ?? id;
        const totalLevels = record.spec.levels ?? 1;
        const defaultLevel = record.spec.default_level ?? 1;
        const choice = levels[id];
        const selectValue = choice === undefined ? "default" : String(choice);
        return (
          <div className="field" key={id}>
            <label htmlFor={`${idPrefix}-ual-${id.replace(/\W+/g, "-").toLowerCase()}`}>
              {displayName}
            </label>
            <select
              id={`${idPrefix}-ual-${id.replace(/\W+/g, "-").toLowerCase()}`}
              value={selectValue}
              onChange={(e) => setLevel(id, e.target.value)}
            >
              <option value="default">Spec default (Lv {defaultLevel})</option>
              {Array.from({ length: totalLevels }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Lv {n}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function HealingPulseCell({
  idPrefix,
  state,
  onChange,
}: {
  idPrefix: string;
  state: BestBuildsSideHealingPulse;
  onChange: (next: BestBuildsSideHealingPulse) => void;
}) {
  return (
    <div className="bb-settings-grid__cell">
      <ToggleSwitch
        checked={state.enabled}
        onChange={(value) => onChange({ ...state, enabled: value })}
        label="Enable Healing Pulse"
        description="Compare-only modeled ability."
      />
      {state.enabled ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-healing-pulse-mode`}>Mode</label>
          <select
            id={`${idPrefix}-healing-pulse-mode`}
            value={state.mode}
            onChange={(e) =>
              onChange({ ...state, mode: e.target.value as "normal" | "onceAtStart" })
            }
          >
            <option value="normal">Normal (recurring t=0 + every 90s)</option>
            <option value="onceAtStart">Once at start (single self-only cast)</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}
