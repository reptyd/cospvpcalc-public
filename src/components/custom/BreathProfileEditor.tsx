import { type ReactNode } from "react";
import type { CustomBreathProfile } from "../../engine/types";

/**
 * Controlled form for a user-authored breath profile (Custom Abilities v2
 * Phase 7 / G7). Embedded in the custom-creature editor. Like StatusEditor
 * it is a plain parametric form (no DSL); special-kind-specific fields are
 * gated on the chosen `specialKind`. The six core fields are always shown.
 */

/** special_kind values the engine dispatches (empty = standard breath). */
const SPECIAL_KINDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "standard" },
  { value: "energy", label: "energy (Hunker-bypass)" },
  { value: "heal", label: "heal (self-heal + cleanse)" },
  { value: "miasma", label: "miasma (self-heal)" },
  { value: "cloud", label: "cloud (self-heal + Muddy)" },
  { value: "lance", label: "lance (charge attack)" },
  { value: "plasma_beam", label: "plasma_beam (discrete charges)" },
  { value: "solar_beam", label: "solar_beam (auto-fire)" },
  { value: "spirit_glare", label: "spirit_glare (auto-fire)" },
  { value: "heliolyth_judgement", label: "heliolyth_judgement (auto-fire)" },
];

const AUTO_FIRE_KINDS = new Set([
  "plasma_beam",
  "solar_beam",
  "spirit_glare",
  "heliolyth_judgement",
]);
const SELF_HEAL_KINDS = new Set(["heal", "miasma", "cloud"]);

/**
 * The `CustomBreathProfile` fields this form binds a control to. Pairs with
 * `ALL_BREATH_PROFILE_FIELDS` (engine/types.ts) through
 * `breathConstructorCoverage.test.ts` to lock the constructor at 100% of the
 * schema. Keep in sync with the <fieldset> controls below — the six core
 * fields + `specialKind` + `specialStatuses` are always present; the rest are
 * gated on the chosen `specialKind` but each is reachable under some kind.
 */
export const BREATH_EDITOR_FIELDS: ReadonlySet<keyof CustomBreathProfile> = new Set([
  // Core (always shown)
  "dpsPct",
  "capacity",
  "regenRate",
  "critChancePct",
  "chain",
  "chainMaxStacks",
  // Special kind selector + heal/miasma/cloud
  "specialKind",
  "selfHealPct",
  "cleanseStacks",
  // lance
  "lanceDamagePct",
  "lanceChargeSec",
  "lanceCooldownSec",
  "lanceStatusId",
  // auto-fire kinds
  "autoFireDelaySec",
  "autoFireCooldownSec",
  // plasma_beam
  "chargesMax",
  "chargeRegenSec",
  // on-tick status procs (always shown)
  "specialStatuses",
]);

export function makeBlankBreathProfile(): CustomBreathProfile {
  return {
    dpsPct: 5,
    capacity: 10,
    regenRate: 8,
    critChancePct: 0,
    chain: 0,
    chainMaxStacks: 0,
    specialStatuses: [],
  };
}

function numToInput(value: number | undefined): string {
  return value === undefined || Number.isNaN(value) ? "" : String(value);
}

export function BreathProfileEditor({
  value,
  onChange,
}: {
  value: CustomBreathProfile;
  onChange: (next: CustomBreathProfile) => void;
}): ReactNode {
  const set = <K extends keyof CustomBreathProfile>(
    key: K,
    v: CustomBreathProfile[K],
  ) => onChange({ ...value, [key]: v });

  const numField = (key: keyof CustomBreathProfile) => ({
    value: numToInput(value[key] as number | undefined),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      set(key, (e.target.value === "" ? undefined : Number(e.target.value)) as never),
  });

  const kind = value.specialKind ?? "";
  const statuses = value.specialStatuses ?? [];

  const setStatus = (i: number, patch: Partial<{ statusId: string; stacks: number }>) => {
    const next = statuses.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    set("specialStatuses", next);
  };

  return (
    <div className="breath-profile-editor">
      <fieldset className="status-editor-group">
        <legend>Core</legend>
        <label>
          <span>DPS % (per tick)</span>
          <input type="number" step="0.1" {...numField("dpsPct")} />
        </label>
        <label>
          <span>Capacity (s)</span>
          <input type="number" step="0.5" min="0" {...numField("capacity")} />
        </label>
        <label>
          <span>Regen rate (s/charge)</span>
          <input type="number" step="0.5" min="0" {...numField("regenRate")} />
        </label>
        <label>
          <span>Crit chance %</span>
          <input type="number" step="1" min="0" {...numField("critChancePct")} />
        </label>
        <label>
          <span>Chain</span>
          <input type="number" step="1" min="0" {...numField("chain")} />
        </label>
        <label>
          <span>Chain max stacks</span>
          <input type="number" step="1" min="0" {...numField("chainMaxStacks")} />
        </label>
      </fieldset>

      <fieldset className="status-editor-group">
        <legend>Special kind</legend>
        <label>
          <span>Kind</span>
          <select
            value={kind}
            onChange={(e) =>
              set("specialKind", e.target.value === "" ? null : e.target.value)
            }
          >
            {SPECIAL_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>

        {SELF_HEAL_KINDS.has(kind) ? (
          <>
            <label>
              <span>Self-heal % (per tick)</span>
              <input type="number" step="0.1" min="0" {...numField("selfHealPct")} />
            </label>
            {kind === "heal" ? (
              <label>
                <span>Cleanse stacks (per tick)</span>
                <input type="number" step="0.1" min="0" {...numField("cleanseStacks")} />
              </label>
            ) : null}
          </>
        ) : null}

        {kind === "lance" ? (
          <>
            <label>
              <span>Lance damage % (per hit)</span>
              <input type="number" step="0.1" min="0" {...numField("lanceDamagePct")} />
            </label>
            <label>
              <span>Lance charge (s)</span>
              <input type="number" step="0.5" min="0" {...numField("lanceChargeSec")} />
            </label>
            <label>
              <span>Lance cooldown (s)</span>
              <input type="number" step="1" min="0" {...numField("lanceCooldownSec")} />
            </label>
            <label>
              <span>Lance status id (on hit)</span>
              <input
                type="text"
                placeholder="e.g. Burn_Status"
                value={value.lanceStatusId ?? ""}
                onChange={(e) =>
                  set("lanceStatusId", e.target.value.trim() === "" ? null : e.target.value)
                }
              />
            </label>
          </>
        ) : null}

        {AUTO_FIRE_KINDS.has(kind) ? (
          <>
            <label>
              <span>Auto-fire delay (s)</span>
              <input type="number" step="0.5" min="0" {...numField("autoFireDelaySec")} />
            </label>
            <label>
              <span>Auto-fire cooldown (s)</span>
              <input type="number" step="1" min="0" {...numField("autoFireCooldownSec")} />
            </label>
          </>
        ) : null}

        {kind === "plasma_beam" ? (
          <>
            <label>
              <span>Charges max</span>
              <input type="number" step="1" min="0" {...numField("chargesMax")} />
            </label>
            <label>
              <span>Charge regen (s)</span>
              <input type="number" step="1" min="0" {...numField("chargeRegenSec")} />
            </label>
          </>
        ) : null}
      </fieldset>

      <fieldset className="status-editor-group">
        <legend>On-tick statuses (procs)</legend>
        {statuses.length === 0 ? (
          <p className="muted">No status procs.</p>
        ) : (
          statuses.map((s, i) => (
            <div key={i} className="breath-status-row">
              <input
                type="text"
                placeholder="status id (built-in or user.X)"
                value={s.statusId}
                onChange={(e) => setStatus(i, { statusId: e.target.value })}
              />
              <input
                type="number"
                step="1"
                min="0"
                placeholder="stacks"
                value={numToInput(s.stacks)}
                onChange={(e) => setStatus(i, { stacks: Number(e.target.value) })}
              />
              <button
                type="button"
                onClick={() => set("specialStatuses", statuses.filter((_, idx) => idx !== i))}
                aria-label="Remove status proc"
              >
                ✕
              </button>
            </div>
          ))
        )}
        <button
          type="button"
          onClick={() => set("specialStatuses", [...statuses, { statusId: "", stacks: 1 }])}
        >
          + Add status proc
        </button>
      </fieldset>
    </div>
  );
}
