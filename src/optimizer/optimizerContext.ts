import type { CreatureRuntime } from "../engine";
import { DEFAULT_BUILD } from "../shared/buildDomain";
import { simulateBuildMatchupViaRust } from "../shared/buildSimulationRust";
import { computeRelevantPlushies } from "./optimizerContextPlushies";
import { collectOpponentStatusIds } from "./optimizerContextStatuses";
import type { OptimizerContext } from "./optimizerContextTypes";

export type { OptimizerContext } from "./optimizerContextTypes";

const DEFAULT_TTK_FALLBACK = 30;

export async function buildOptimizerContext(
  creatureA: CreatureRuntime,
  creatureB: CreatureRuntime,
  mode: "vs" | "solo" | "counter",
): Promise<OptimizerContext> {
  const sim = await simulateBuildMatchupViaRust({
    creatureA,
    buildA: DEFAULT_BUILD,
    creatureB,
    buildB: DEFAULT_BUILD,
    options: { activesOn: true, breathOn: true },
  });
  // Rust may decline (unsupported abilities); fall through to a neutral TTK
  // estimate so context construction doesn't block the BB pipeline.
  const expectedTtk = sim
    ? Math.min(sim.summary.ttkAtoB, sim.summary.ttkBtoA)
    : DEFAULT_TTK_FALLBACK;

  const statusesFromB = collectOpponentStatusIds(creatureB);
  const statusesFromA = collectOpponentStatusIds(creatureA);
  const opponentHasBleedA = statusesFromB.has("Bleed_Status");
  const opponentHasBleedB = statusesFromA.has("Bleed_Status");
  const regenRelevantA = expectedTtk >= 15 && !opponentHasBleedA;
  const regenRelevantB = expectedTtk >= 15 && !opponentHasBleedB;

  const context: OptimizerContext =
    mode === "counter"
      ? {
          healthRelevant: regenRelevantB,
          opponentStatusIds: statusesFromA,
          opponentHasBleed: opponentHasBleedB,
          expectedTtk,
          mode: "counter",
        }
      : mode === "solo"
        ? {
            healthRelevant: regenRelevantA,
            opponentStatusIds: new Set<string>(),
            opponentHasBleed: false,
            expectedTtk,
            mode: "solo",
          }
        : {
            healthRelevant: regenRelevantA && regenRelevantB,
            opponentStatusIds: new Set([...statusesFromA, ...statusesFromB]),
            opponentHasBleed: opponentHasBleedA || opponentHasBleedB,
            expectedTtk,
            mode: "counter",
          };

  context.relevantPlushies = await computeRelevantPlushies(creatureA, creatureB, context);
  return context;
}
