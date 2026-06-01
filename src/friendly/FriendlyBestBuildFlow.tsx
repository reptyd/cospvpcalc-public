import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { BuildOptions, CreatureRuntime } from "../engine";
import { elderProfiles, getPlushieIcon, getTraitIcon, plushies, traits } from "../engine/buildData";
import { IconImg } from "../components/IconImg";
import { computeAscensionCounts } from "../shared/buildEncoding";
import { formatRoundedNumber, formatRoundedPercent, formatRoundedSeconds } from "../shared/displayFormat";
import { DEFAULT_FRIENDLY_AIR_RULE_COOLDOWN_SEC } from "./friendlyConfig";
import { ChoiceCard, FacetPicker, FriendlyTopBar, MetricCard, TagSelector } from "./FriendlyUiPrimitives";
import type {
  FriendlyBestBuildAnswers,
  FriendlyEnemyProfile,
  FriendlyOptimizationGoal,
} from "./friendlyTypes";

export type CreatureFilters = {
  query: string;
  selectedTiers: number[];
  selectedTypes: string[];
};

export function FriendlyBestBuildSelection({
  filters,
  setFilters,
  tierOptions,
  typeOptions,
  selectedCreatureName,
  selectedCreature,
  filteredCreatures,
  eligibleForAirRule,
  getCreatureIcon,
  onSelectCreature,
  onContinue,
  onBack,
}: {
  filters: CreatureFilters;
  setFilters: (value: CreatureFilters) => void;
  tierOptions: number[];
  typeOptions: string[];
  selectedCreatureName: string;
  selectedCreature?: CreatureRuntime;
  filteredCreatures: CreatureRuntime[];
  eligibleForAirRule: boolean;
  getCreatureIcon: (name: string) => string | null;
  onSelectCreature: (name: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const [visibleCreatureCount, setVisibleCreatureCount] = useState(24);

  useEffect(() => {
    setVisibleCreatureCount(24);
  }, [filters]);

  return (
    <section className="friendly-panel">
      <FriendlyTopBar
        title="Choose Your Creature"
        description="Filter the roster, browse icons, and lock onto the creature you want to build first."
        onBack={onBack}
      />
      <div className="creature-select-layout">
        <div className="friendly-card filter-card">
          <label className="friendly-field">
            <span>Search</span>
            <input
              value={filters.query}
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
              placeholder="Search creature"
            />
          </label>
          <button
            className="friendly-secondary filter-reset-btn"
            type="button"
            onClick={() =>
              setFilters({
                query: "",
                selectedTiers: [],
                selectedTypes: [],
              })
            }
          >
            Clear Filters
          </button>
          <FacetPicker
            title="Tiers"
            values={tierOptions.map(String)}
            selectedValues={filters.selectedTiers.map(String)}
            onToggle={(value) => {
              const tier = Number(value);
              setFilters({
                ...filters,
                selectedTiers: filters.selectedTiers.includes(tier)
                  ? filters.selectedTiers.filter((item) => item !== tier)
                  : [...filters.selectedTiers, tier].sort((a, b) => a - b),
              });
            }}
          />
          <FacetPicker
            title="Type"
            values={typeOptions}
            selectedValues={filters.selectedTypes}
            onToggle={(value) =>
              setFilters({
                ...filters,
                selectedTypes: filters.selectedTypes.includes(value)
                  ? filters.selectedTypes.filter((item) => item !== value)
                  : [...filters.selectedTypes, value],
              })
            }
          />
        </div>

        <div className="friendly-card friendly-card-hero">
          <div className="hero-card-header">
            <span className="friendly-kicker">Selected Creature</span>
            <button className="friendly-primary" type="button" onClick={onContinue} disabled={!selectedCreatureName}>
              Continue
            </button>
          </div>
          <div className="selected-creature-stage">
            <div className="selected-creature-portrait-shell">
              <IconImg src={getCreatureIcon(selectedCreatureName)} alt={selectedCreatureName} size={148} />
            </div>
            <div className="selected-creature-copy">
              <h2>{selectedCreatureName || "Pick a creature"}</h2>
              <p className="friendly-muted">
                {!selectedCreatureName
                  ? "Choose the creature you want to build first."
                  : eligibleForAirRule
                  ? "This creature opens the special air battle question in the PvP route."
                  : "Ready for the regular PvP and survivability build flow."}
              </p>
            </div>
            <div className="selected-creature-meta selected-creature-meta-premium">
              <div className="metric-chip metric-chip-large"><span>Tier</span><strong>{selectedCreature?.stats.tier ?? "?"}</strong></div>
              <div className="metric-chip metric-chip-large"><span>Type</span><strong>{selectedCreature?.stats.type ?? "Unknown"}</strong></div>
              <div className="metric-chip metric-chip-large"><span>Damage</span><strong>{selectedCreature?.stats.damage ?? "?"}</strong></div>
              <div className="metric-chip metric-chip-large"><span>Bite Cooldown</span><strong>{selectedCreature ? formatRoundedSeconds(selectedCreature.stats.biteCooldown) : "?"}</strong></div>
            </div>
          </div>
        </div>
      </div>

      <div className="creature-gallery">
        {filteredCreatures.slice(0, visibleCreatureCount).map((creature) => (
          <button
            key={creature.name}
            className={`creature-tile${creature.name === selectedCreatureName ? " selected" : ""}`}
            type="button"
            onClick={() => onSelectCreature(creature.name)}
          >
            <IconImg src={getCreatureIcon(creature.name)} alt={creature.name} size={88} />
            <strong>{creature.name}</strong>
            <span>Tier {creature.stats.tier}</span>
            <span>{creature.stats.type ?? "Unknown type"}</span>
          </button>
        ))}
        {filteredCreatures.length === 0 ? (
          <div className="friendly-card empty-gallery-card">
            <h2>No creatures match these filters</h2>
            <p className="friendly-muted">Clear one or more filters and try again.</p>
          </div>
        ) : null}
      </div>
      {filteredCreatures.length > visibleCreatureCount ? (
        <div className="friendly-load-more-row">
          <button className="friendly-secondary" type="button" onClick={() => setVisibleCreatureCount((count) => count + 24)}>
            Show More Creatures
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function FriendlyBestBuildWizard({
  selectedCreatureName,
  selectedCreature,
  getCreatureIcon,
  bestBuildStep,
  setBestBuildStep,
  wizardSteps,
  answers,
  onBack,
}: {
  selectedCreatureName: string;
  selectedCreature?: CreatureRuntime;
  getCreatureIcon: (name: string) => string | null;
  bestBuildStep: number;
  setBestBuildStep: (value: number) => void;
  wizardSteps: Array<{ id: string; label: string; description: string; content: ReactNode }>;
  answers: FriendlyBestBuildAnswers;
  onBack: () => void;
}) {
  const activeStep = wizardSteps[Math.min(bestBuildStep, wizardSteps.length - 1)];
  return (
    <section className="friendly-panel">
      <FriendlyTopBar
        title="Build Wizard"
        description="Answer a few big questions and let the build search handle the rest."
        onBack={onBack}
      />
      <div className="wizard-layout">
        <aside className="friendly-card wizard-sidebar">
          <span className="friendly-kicker">Build Target</span>
          <div className="wizard-creature">
            <IconImg src={getCreatureIcon(selectedCreatureName)} alt={selectedCreatureName} size={72} />
            <div>
              <strong>{selectedCreatureName}</strong>
              <div className="friendly-muted">{selectedCreature?.stats.type ?? "Unknown type"}</div>
            </div>
          </div>
          <div className="wizard-progress">
            {wizardSteps.map((step, index) => (
              <button
                key={step.id}
                className={`wizard-progress-item${index === bestBuildStep ? " active" : ""}${index < bestBuildStep ? " done" : ""}`}
                type="button"
                onClick={() => setBestBuildStep(index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{step.label}</strong>
              </button>
            ))}
          </div>
          <div className="wizard-live-summary">
            <span className="friendly-kicker">Live Summary</span>
            <div className="review-card">
              <span className="friendly-kicker">Focus</span>
              <strong>{answers.focus === "pvp" ? "PvP" : "Survivability"}</strong>
            </div>
            <div className="review-card">
              <span className="friendly-kicker">Enemy Pool</span>
              <strong>{getEnemyProfileLabel(answers.enemyProfile)}</strong>
            </div>
            <div className="review-card">
              <span className="friendly-kicker">Traits</span>
              <strong>{answers.preferredTraits.map(formatFriendlyLabel).join(", ") || "Auto pick"}</strong>
            </div>
            <div className="review-card">
              <span className="friendly-kicker">Plushies</span>
              <strong>{answers.preferredPlushies.join(", ") || "Auto pick"}</strong>
            </div>
            <div className="review-card">
              <span className="friendly-kicker">Elder</span>
              <strong>{answers.preferredElder === "None" ? "Auto pick" : answers.preferredElder}</strong>
            </div>
          </div>
        </aside>

        <div className="friendly-card wizard-stage-card">
          <div className="wizard-stage-header">
            <span className="friendly-kicker">Step {bestBuildStep + 1}</span>
            <h2>{activeStep.label}</h2>
            <p>{activeStep.description}</p>
          </div>
          <div className="wizard-stage-body">{activeStep.content}</div>
          <div className="wizard-actions">
            {bestBuildStep < wizardSteps.length - 1 ? (
              <button className="friendly-primary" type="button" onClick={() => setBestBuildStep(bestBuildStep + 1)}>
                Continue
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function FriendlyBestBuildResults({
  runInFlight,
  progress,
  topResults,
  runtimeRequirementError,
  answers,
  engineMode,
  selectedCreatureName,
  getCreatureIcon,
  onApplyToBattle,
  onOpenAdvanced,
  onBack,
}: {
  runInFlight: boolean;
  progress: number;
  topResults: Array<{ build: BuildOptions; aggregate: { winRate: number; avgSurvival: number; avgTtkWin: number; avgDps: number } }>;
  runtimeRequirementError: string | null;
  answers: FriendlyBestBuildAnswers;
  engineMode: "standard" | "survivability";
  selectedCreatureName: string;
  getCreatureIcon: (name: string) => string | null;
  onApplyToBattle: (build: BuildOptions) => void;
  onOpenAdvanced: (build: BuildOptions) => void;
  onBack: () => void;
}) {
  return (
    <section className="friendly-panel">
      <FriendlyTopBar
        title="Best Build Results"
        description="Top 3 builds for your selected creature, based on the setup you chose."
        onBack={onBack}
      />
      {runInFlight ? (
        <div className="friendly-loading-card">
          <div className="loading-orbit" />
          <h2>Calculating best builds</h2>
          <p>Running the existing optimizer pipeline with your selected enemy pool and preference locks.</p>
          <div className="loading-progress-bar">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span>{Math.round(progress * 100)}%</span>
        </div>
      ) : (
        <div className="result-stack">
          {runtimeRequirementError ? (
            <div className="friendly-note-card friendly-note-card-warning">{runtimeRequirementError}</div>
          ) : null}
          {topResults.length === 0 ? (
            <div className="friendly-card">
              <h2>No results yet</h2>
              <p className="friendly-muted">Start the build search to see the top 3 results for this creature.</p>
            </div>
          ) : null}
          <div className="friendly-card result-header-card">
            <div className="result-header-creature">
              <IconImg src={getCreatureIcon(selectedCreatureName)} alt={selectedCreatureName} size={84} />
              <div>
                <span className="friendly-kicker">Creature</span>
                <h2>{selectedCreatureName}</h2>
              </div>
            </div>
            <div className="result-header-runtime">
              <span className="friendly-kicker">Search Mode</span>
              <strong>{engineMode === "survivability" ? "Survivability" : "Standard PvP"}</strong>
            </div>
          </div>
          {topResults.map((item, index) => (
            <article className="result-card" key={`${item.build.traits.join("-")}-${index}`}>
              <div className="result-card-rank">#{index + 1}</div>
              <div className="result-card-main">
                <div>
                  <span className="friendly-kicker">Build Loadout</span>
                  {index === 0 ? <div className="result-recommended-badge">Recommended</div> : null}
                  <h2>{item.build.traits.map(formatFriendlyLabel).join(" + ") || "Auto-picked traits"}</h2>
                  <div className="build-icon-strip">
                    <div className="build-icon-chip build-icon-chip-elder">
                      <span className="friendly-kicker">Elder</span>
                      <strong>{item.build.elder ?? "None"}</strong>
                    </div>
                    {item.build.traits.map((trait) => (
                      <div className="build-icon-chip" key={`trait-${trait}`}>
                        <IconImg src={getTraitIcon(trait)} alt={trait} size={36} />
                        <span>{formatFriendlyLabel(trait)}</span>
                      </div>
                    ))}
                    {item.build.plushies.map((plushie) => (
                      <div className="build-icon-chip" key={`plushie-${plushie}`}>
                        <IconImg src={getPlushieIcon(plushie)} alt={plushie} size={36} />
                        <span>{plushie}</span>
                      </div>
                    ))}
                  </div>
                  <div className="ascension-strip">
                    <span className="friendly-kicker">Ascension Split</span>
                    <div className="ascension-chip-list">
                      {buildAscensionEntries(item.build).map((entry) => (
                        <div className="ascension-chip" key={`${item.build.traits.join("-")}-${entry.trait}`}>
                          <IconImg src={getTraitIcon(entry.trait)} alt={entry.trait} size={32} />
                          <div>
                            <span>{formatFriendlyLabel(entry.trait)}</span>
                            <strong>{entry.count}/5</strong>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p>Veneration {item.build.venerationStage} / Elder {item.build.elder ?? "None"}</p>
                </div>
                <div className="result-score-grid">
                  <MetricCard label="Win Rate" value={formatRoundedPercent(item.aggregate.winRate * 100)} />
                  <MetricCard label="Avg Survival" value={formatRoundedSeconds(item.aggregate.avgSurvival)} />
                  <MetricCard label="Avg TTK" value={formatRoundedSeconds(item.aggregate.avgTtkWin)} />
                  <MetricCard label="Avg DPS" value={formatRoundedNumber(item.aggregate.avgDps)} />
                </div>
              </div>
              <div className="result-card-actions">
                <button className="friendly-secondary" type="button" onClick={() => onApplyToBattle(item.build)}>
                  Use In Who Wins
                </button>
                <button className="friendly-primary" type="button" onClick={() => onOpenAdvanced(item.build)}>
                  Open In Advanced
                </button>
              </div>
            </article>
          ))}
          {answers.airRuleEnabled ? (
            <div className="friendly-note-card">
              Air battle mode is set to {formatRoundedSeconds(answers.airRuleCooldownSec)} between bites, with Bite kept out of the automatic build picks.
            </div>
          ) : null}
          {engineMode === "survivability" ? (
            <div className="friendly-note-card">
              Survivability mode keeps the search focused on staying alive longer against the enemy pool you selected.
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function buildWizardSteps({
  answers,
  eligibleForAirRule,
  creatureName,
  currentResultBuild,
  tierOptions,
  onAnswersChange,
  onRun,
}: {
  answers: FriendlyBestBuildAnswers;
  eligibleForAirRule: boolean;
  creatureName: string;
  currentResultBuild: BuildOptions | null;
  tierOptions: number[];
  onAnswersChange: (value: FriendlyBestBuildAnswers) => void;
  onRun: () => void;
}) {
  const enemyProfiles: Array<{ id: FriendlyEnemyProfile; title: string; body: string }> = [
    { id: "sameTier", title: "Equal Tier", body: "Build around fights against creatures in your own tier." },
    { id: "lowerTiers", title: "Lower Tiers", body: "Build for PvP against creatures below your tier." },
    { id: "higherTiers", title: "Higher Tiers", body: "Build for tougher fights against creatures above your tier." },
    { id: "aroundTier", title: "Around My Size", body: "Cover your tier plus the nearby range around it." },
    { id: "custom", title: "Custom Tiers", body: "Choose the exact enemy tiers you want this build to target." },
  ];
  const optimizationGoals: Array<{ id: FriendlyOptimizationGoal; title: string; body: string }> = [
    { id: "wins", title: "Win More Matchups", body: "Aim for the highest number of wins across the enemies you picked." },
    { id: "fastKills", title: "Finish Fights Faster", body: "Lean toward builds that bring opponents down more quickly." },
    { id: "maxDps", title: "Hit Harder Over Time", body: "Lean toward stronger sustained damage during the fight." },
  ];
  const steps: Array<{ id: string; label: string; description: string; content: ReactNode }> = [];
  const canRun =
    answers.enemyProfile !== "custom" || answers.customTiers.length > 0;

  steps.push({
    id: "focus",
    label: "Primary Goal",
    description: `Set the direction for ${creatureName}.`,
    content: (
      <div className="choice-grid">
        <ChoiceCard title="PvP Hunter" body="Win more stand-up fights and pressure the right matchup pool." active={answers.focus === "pvp"} onClick={() => onAnswersChange({ ...answers, focus: "pvp" })} />
        <ChoiceCard title="Survivability" body="Bias toward staying alive longer across the enemy set." active={answers.focus === "survivability"} onClick={() => onAnswersChange({ ...answers, focus: "survivability" })} />
      </div>
    ),
  });

  if (eligibleForAirRule && answers.focus === "pvp") {
    steps.push({
      id: "air-rule",
      label: "Air Rule",
      description: "Decide whether to use the special bite timing rule for air fights.",
      content: (
        <div className="air-rule-stage">
          <div className="choice-grid">
            <ChoiceCard title="Standard Combat" body="Keep the usual bite timing for this run." active={!answers.airRuleEnabled} onClick={() => onAnswersChange({ ...answers, airRuleEnabled: false })} />
            <ChoiceCard title="Air Battle Rule" body="Use a custom gap between bites for both sides and keep Bite out of the automatic trait picks." active={answers.airRuleEnabled} onClick={() => onAnswersChange({ ...answers, airRuleEnabled: true })} />
          </div>
          {answers.airRuleEnabled ? (
            <label className="friendly-field friendly-field-air-rule">
              <span>Override Bite Cooldown (sec)</span>
              <input
                type="number"
                min="0.1"
                step="0.05"
                value={answers.airRuleCooldownSec}
                onChange={(event) =>
                  onAnswersChange({
                    ...answers,
                    airRuleCooldownSec: Math.max(0.1, Number(event.target.value) || DEFAULT_FRIENDLY_AIR_RULE_COOLDOWN_SEC),
                  })
                }
              />
              <small className="friendly-muted">
                In this setup both creatures use a {formatRoundedSeconds(answers.airRuleCooldownSec)} gap between bites, and Bite will not be chosen automatically for this build.
              </small>
            </label>
          ) : null}
        </div>
      ),
    });
  }

  steps.push({
    id: "enemy-profile",
    label: "Enemy Pool",
    description: answers.focus === "pvp" ? "Choose the enemy tier profile you want to beat." : "Choose what kind of threats you want to survive.",
    content: (
      <div className="choice-grid">
        {enemyProfiles.map((profile) => (
          <ChoiceCard key={profile.id} title={profile.title} body={profile.body} active={answers.enemyProfile === profile.id} onClick={() => onAnswersChange({ ...answers, enemyProfile: profile.id })} />
        ))}
        {answers.enemyProfile === "custom" ? (
          <div className="tier-choice-grid">
            {tierOptions.map((tier) => (
              <button
                key={tier}
                className={`tier-choice-card${answers.customTiers.includes(tier) ? " active" : ""}`}
                type="button"
                onClick={() =>
                  onAnswersChange({
                    ...answers,
                    customTiers: answers.customTiers.includes(tier)
                      ? answers.customTiers.filter((item) => item !== tier)
                      : [...answers.customTiers, tier].sort((a, b) => a - b),
                  })
                }
              >
                <span className="friendly-kicker">Enemy Tier</span>
                <strong>{tier}</strong>
                <p>{answers.focus === "pvp" ? "Include this matchup in the hunting pool." : "Include this threat in the survival check."}</p>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    ),
  });

  steps.push({
    id: "traits",
    label: "Trait Preferences",
    description: "Leave this empty to let the system choose the best trait mix, or lock in up to 2 traits you definitely want.",
    content: <TagSelector items={traits.map((trait) => trait.id)} selected={answers.preferredTraits} maxSelected={2} formatLabel={formatFriendlyLabel} footerText={answers.preferredTraits.length === 0 ? "Nothing selected: best traits will be chosen automatically." : `Locked ${answers.preferredTraits.length} / 2. The remaining slots will be filled automatically.`} onToggle={(traitId) => onAnswersChange({ ...answers, preferredTraits: toggleLimitedSelection(answers.preferredTraits, traitId, 2) })} />,
  });

  steps.push({
    id: "elder",
    label: "Elder Preference",
    description: "Leave this on auto to let the system choose the best elder, or lock one in up front.",
    content: (
      <div className="choice-grid">
        <ChoiceCard
          title="Auto Pick"
          body="Test all elder options and keep the strongest result."
          active={answers.preferredElder === "None"}
          onClick={() => onAnswersChange({ ...answers, preferredElder: "None" })}
        />
        {elderProfiles.map((elder) => (
          <ChoiceCard
            key={elder.id}
            title={elder.name}
            body={elder.summary}
            active={answers.preferredElder === elder.id}
            onClick={() => onAnswersChange({ ...answers, preferredElder: elder.id })}
          />
        ))}
      </div>
    ),
  });

  steps.push({
    id: "plushies",
    label: "Plushie Preferences",
    description: "Leave this empty to let the system choose the best plushies, or lock in up to 2 that you want to keep.",
    content: <TagSelector items={plushies.map((plushie) => plushie.name)} selected={answers.preferredPlushies} maxSelected={2} footerText={answers.preferredPlushies.length === 0 ? "Nothing selected: best plushies will be chosen automatically." : `Locked ${answers.preferredPlushies.length} / 2. The remaining slots will be filled automatically.`} onToggle={(plushieName) => onAnswersChange({ ...answers, preferredPlushies: toggleLimitedSelection(answers.preferredPlushies, plushieName, 2) })} />,
  });

  if (answers.focus === "pvp") {
    steps.push({
      id: "optimization",
      label: "Optimization Target",
      description: "Choose how the final ranking should feel in practice.",
      content: (
        <div className="choice-grid">
          {optimizationGoals.map((goal) => (
            <ChoiceCard key={goal.id} title={goal.title} body={goal.body} active={answers.optimizationGoal === goal.id} onClick={() => onAnswersChange({ ...answers, optimizationGoal: goal.id })} />
          ))}
        </div>
      ),
    });
  }

  steps.push({
    id: "review",
    label: "Run Calculation",
    description: "Check your choices, then start the build search.",
    content: (
      <div className="review-stage-layout">
        <div className="review-grid">
          <div className="review-card"><span className="friendly-kicker">Focus</span><strong>{answers.focus === "pvp" ? "PvP" : "Survivability"}</strong></div>
          <div className="review-card"><span className="friendly-kicker">Enemy Pool</span><strong>{getEnemyProfileLabel(answers.enemyProfile)}</strong></div>
          <div className="review-card review-card-icons"><span className="friendly-kicker">Traits</span>{renderBuildIconList(answers.preferredTraits, getTraitIcon, "Auto pick", formatFriendlyLabel)}</div>
          <div className="review-card review-card-icons"><span className="friendly-kicker">Plushies</span>{renderBuildIconList(answers.preferredPlushies, getPlushieIcon, "Auto pick")}</div>
          <div className="review-card"><span className="friendly-kicker">Elder</span><strong>{answers.preferredElder === "None" ? "Auto pick" : answers.preferredElder}</strong></div>
          <div className="review-card"><span className="friendly-kicker">Result Slot</span><strong>{currentResultBuild ? "Replace current results" : "Start a fresh search"}</strong></div>
          <div className="review-card"><span className="friendly-kicker">Search Style</span><strong>{answers.focus === "pvp" ? "PvP ranking" : "Survival ranking"}</strong></div>
        </div>
        <div className="review-cta-card">
          <span className="friendly-kicker">Launch</span>
          <h3>Run Best Build Search</h3>
          <p>We will search for the strongest build based on the choices you made above.</p>
          <button className="friendly-primary run-review-button" type="button" onClick={onRun} disabled={!canRun}>Run Best Build Search</button>
        </div>
        {!canRun ? <p className="friendly-muted review-validation">Choose at least one tier for the custom enemy pool.</p> : null}
      </div>
    ),
  });

  return steps;
}

function toggleLimitedSelection(values: string[], value: string, maxSelected: number): string[] {
  if (values.includes(value)) return values.filter((item) => item !== value);
  if (values.length >= maxSelected) return [...values.slice(1), value];
  return [...values, value];
}

function renderBuildIconList(items: string[], getIcon: (value: string) => string | null, fallback: string, formatLabel: (value: string) => string = (value) => value) {
  if (items.length === 0) {
    return <strong>{fallback}</strong>;
  }
  return (
    <div className="review-icon-list">
      {items.map((item) => (
        <div className="build-icon-chip compact" key={item}>
          <IconImg src={getIcon(item)} alt={item} size={28} />
          <span>{formatLabel(item)}</span>
        </div>
      ))}
    </div>
  );
}

function formatFriendlyLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getEnemyProfileLabel(profile: FriendlyEnemyProfile): string {
  switch (profile) {
    case "sameTier":
      return "Equal Tier";
    case "lowerTiers":
      return "Lower Tiers";
    case "higherTiers":
      return "Higher Tiers";
    case "aroundTier":
      return "Around My Size";
    case "custom":
      return "Custom Tiers";
    default:
      return profile;
  }
}

function buildAscensionEntries(build: BuildOptions): Array<{ trait: string; count: number }> {
  const counts = computeAscensionCounts(build.traits, build.ascensionAssignments, build.venerationStage);
  return build.traits.map((trait, index) => ({
    trait,
    count: counts[index] ?? 0,
  }));
}
