import type { CreatureRuntime } from "../engine";
import { plushies } from "../engine/data";
import { isPlushiePurelyHarmful } from "../shared/buildDomain";
import type { OptimizerContext } from "./optimizerContextTypes";
import { createPlushieBaselineContext } from "./optimizerContextPlushieBaseline";
import { plushieHasImpact } from "./optimizerContextPlushieImpact";

export async function computeRelevantPlushies(
  creatureA: CreatureRuntime,
  creatureB: CreatureRuntime,
  context: OptimizerContext,
): Promise<Set<string>> {
  const relevant = new Set<string>();
  const baseline = await createPlushieBaselineContext(creatureA, creatureB);
  // Rust may decline (unsupported abilities); skip plushie filtering and let
  // the search space include all plushies — better to evaluate a few extra
  // candidates than to skip the build entirely.
  if (!baseline) return relevant;
  const { baselineA, baselineB, baselineSummary, baselineDebugA, baselineDebugB } = baseline;

  for (const plushie of plushies) {
    if (!plushie.modifiersParsed?.length || isPlushiePurelyHarmful(plushie)) continue;
    if (plushie.modifiersParsed.every((mod) => mod.stat.startsWith("block"))) continue;

    const impactOnA = await plushieHasImpact({
      holder: creatureA,
      plushieName: plushie.name,
      baselineHolder: baselineA,
      baselineOpponent: baselineB,
      baselineOpponentDebug: baselineDebugB,
      context,
      baselineSummary,
      perspective: "A",
    });
    const impactOnB = await plushieHasImpact({
      holder: creatureB,
      plushieName: plushie.name,
      baselineHolder: baselineB,
      baselineOpponent: baselineA,
      baselineOpponentDebug: baselineDebugA,
      context,
      baselineSummary,
      perspective: "B",
    });
    if (impactOnA || impactOnB) relevant.add(plushie.name);
  }

  return relevant;
}
