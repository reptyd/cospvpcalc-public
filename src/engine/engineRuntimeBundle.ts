import {
  BREATH_TICK_SEC,
} from "./subsystems/timing";
import {
  DISABLE_BREATH,
  isAbilityDisabled,
} from "./subsystems/actives";
import { createExtendedDamageRuntime } from "./extendedDamageRuntime";
import { createFightLoopRuntime } from "./fightLoopRuntime";
import { createResultRuntime } from "./resultRuntime";
import { createEngineRuntimeCore } from "./engineRuntimeCore";
import {
  computeIncomingDamageMultiplier,
  computeOutgoingDamageMultiplier,
  currentBiteCooldown,
  resolveBadOmenOutcome,
} from "./combatMath";
import {
  isActivesDisabledByNecro,
} from "./runtimeHelpers";
import { markAbilityApplied } from "./specialEventsRuntime";

const {
  activesRuntime,
  breathRuntime,
  combatantFactory,
  debugRuntime,
  hitRuntime,
  regenRuntime,
  specialEventsRuntime,
  stateRuntime,
  stateTickRuntime,
  statusRuntime,
  timelineRuntime,
} = createEngineRuntimeCore();

const extendedDamageRuntime = createExtendedDamageRuntime({
  breathTickSec: BREATH_TICK_SEC,
  createCombatantState: combatantFactory.createCombatantState,
  nextEventAtSingle: timelineRuntime.nextEventAtSingle,
  updateStateAt: stateTickRuntime.updateStateAt,
  isActivesDisabledByNecro,
  handleMeleeHit: hitRuntime.handleMeleeHit,
  currentBiteCooldown,
  handleDotTicks: statusRuntime.handleDotTicks,
  handleChannelingPulse: specialEventsRuntime.handleChannelingPulse,
  handleSelfDestruct: specialEventsRuntime.handleSelfDestruct,
  handleTotemTick: specialEventsRuntime.handleTotemTick,
  applyBreathTick: breathRuntime.applyBreathTick,
});

const fightLoopRuntime = createFightLoopRuntime({
  disableBreath: DISABLE_BREATH,
  breathTickSec: BREATH_TICK_SEC,
  timelineRuntime,
  isAbilityDisabled,
  isActivesDisabledByNecro,
  updateStateAt: stateTickRuntime.updateStateAt,
  handleMeleeHit: hitRuntime.handleMeleeHit,
  handleShadowBarrageHit: hitRuntime.handleShadowBarrageHit,
  currentBiteCooldown,
  handleDotTicks: statusRuntime.handleDotTicks,
  handleChannelingPulse: specialEventsRuntime.handleChannelingPulse,
  handleSelfDestruct: specialEventsRuntime.handleSelfDestruct,
  handleTotemTick: specialEventsRuntime.handleTotemTick,
  applyBreathTick: breathRuntime.applyBreathTick,
});

const resultRuntime = createResultRuntime({
  estimateEhp: debugRuntime.estimateEhp,
  buildDebug: debugRuntime.buildDebug,
  computeExtendedDamagePotential: extendedDamageRuntime.computeExtendedDamagePotential,
});

export {
  activesRuntime,
  breathRuntime,
  combatantFactory,
  currentBiteCooldown,
  fightLoopRuntime,
  hitRuntime,
  markAbilityApplied,
  regenRuntime,
  resultRuntime,
  specialEventsRuntime,
  stateRuntime,
  statusRuntime,
  computeIncomingDamageMultiplier,
  computeOutgoingDamageMultiplier,
  resolveBadOmenOutcome,
};
