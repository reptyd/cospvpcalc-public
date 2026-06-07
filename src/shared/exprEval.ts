/**
 * TypeScript port of the Rust `Expr::eval` walk for inline preview
 * in the editor. Mirrors `wasm-engine/src/policy/user_ability.rs`
 * exactly - same operators, same div-by-zero handling, same
 * unknown-var = 0.0 fallback. Used to show "= X at typical state"
 * annotations on Expr fields.
 *
 * **Important**: this is a UI affordance, not a source of truth.
 * The engine does the real evaluation at simulation time. If the
 * UI eval and engine eval ever disagree, the engine wins - fix
 * this file to match.
 */

import type { BinOp, Expr, UnaryOp } from "./customAbilityTypes";

/**
 * Representative state used for the inline-preview readout. Both
 * sides at 50% HP, baseline stats, a sample Bleed status, no
 * cooldowns. Picked so most expressions evaluate to plausible,
 * non-zero values at "fight in progress" moment.
 */
export type MockPolicyState = {
  time: number;
  state_extras: Record<string, number>;
  self: MockSide;
  opponent: MockSide;
};

type MockSide = {
  hp: number;
  max_hp: number;
  hp_ratio: number;
  bite_dps: number;
  breath_capacity: number;
  statuses_total_stacks: number;
  statuses_count: number;
  next_hit: number;
  next_breath: number;
  is_alive: number;
  time_to_max_hp: number;
  cooldowns: Record<string, number>;
  active_until: Record<string, number>;
  statuses: Record<string, number>;
  stats: Record<string, number>;
  extras: Record<string, number>;
};

const SAMPLE_SIDE: MockSide = {
  hp: 5000,
  max_hp: 10000,
  hp_ratio: 0.5,
  bite_dps: 50,
  breath_capacity: 30,
  statuses_total_stacks: 3,
  statuses_count: 1,
  next_hit: 30,
  next_breath: 30,
  is_alive: 1,
  time_to_max_hp: 100,
  cooldowns: {},
  active_until: {},
  statuses: { Bleed_Status: 3 },
  stats: {
    health: 10000,
    weight: 100,
    damage: 100,
    bite_cooldown: 2,
    health_regen: 50,
    first_strike_pct: 0,
    has_reflect: 0,
    has_warden_resistance: 0,
  },
  extras: {},
};

/** The default "typical fight" state. Cloned per eval so a write
 *  to extras doesn't pollute future previews. */
export function defaultMockState(): MockPolicyState {
  return {
    time: 30,
    state_extras: { "combat.iteration_count": 100 },
    self: structuredClone(SAMPLE_SIDE),
    opponent: structuredClone(SAMPLE_SIDE),
  };
}

/** Evaluate an Expr against the given state. Mirrors Rust eval
 *  semantics: bool ops return 0/1, div-by-zero ⇒ 0, unknown var ⇒ 0,
 *  non-finite results from pow/exp ⇒ 0. */
export function evalExpr(expr: Expr, state: MockPolicyState): number {
  switch (expr.kind) {
    case "const":
      return Number.isFinite(expr.value) ? expr.value : 0;
    case "var":
      return lookupVar(expr.path, state);
    case "bin": {
      const l = evalExpr(expr.left, state);
      const r = evalExpr(expr.right, state);
      return applyBin(expr.op, l, r);
    }
    case "una": {
      const v = evalExpr(expr.operand, state);
      return applyUna(expr.op, v);
    }
    case "if":
      return evalExpr(expr.cond, state) !== 0
        ? evalExpr(expr.then, state)
        : evalExpr(expr.otherwise, state);
    case "clamp": {
      const v = evalExpr(expr.value, state);
      let lo = evalExpr(expr.lo, state);
      let hi = evalExpr(expr.hi, state);
      if (lo > hi) [lo, hi] = [hi, lo];
      return Math.min(hi, Math.max(lo, v));
    }
    case "rand": {
      // Deterministic-pseudo-random roll in [0, 1).
      // Mirrors Rust `Expr::Rand` - seeds from (time, self.extras-size).
      // Same LCG constants as the Rust side; TS uses BigInt for the
      // 64-bit math.
      const extrasCount = Object.keys(state.self.extras).length;
      const seedA = BigInt(Math.round(state.time * 1_000_000));
      const seedB = BigInt(extrasCount) * 0x9E3779B9n;
      const seed = BigInt.asUintN(64, seedA + seedB);
      const mul = 6_364_136_223_846_793_005n;
      const add = 1_442_695_040_888_963_407n;
      const next = BigInt.asUintN(64, seed * mul + add);
      return Number(next >> 11n) / 2 ** 53;
    }
  }
}

function applyBin(op: BinOp, l: number, r: number): number {
  switch (op) {
    case "add":
      return l + r;
    case "sub":
      return l - r;
    case "mul":
      return l * r;
    case "div":
      return r === 0 ? 0 : l / r;
    case "lt":
      return l < r ? 1 : 0;
    case "lte":
      return l <= r ? 1 : 0;
    case "gt":
      return l > r ? 1 : 0;
    case "gte":
      return l >= r ? 1 : 0;
    case "eq":
      return Math.abs(l - r) < 1e-9 ? 1 : 0;
    case "ne":
      return Math.abs(l - r) >= 1e-9 ? 1 : 0;
    case "and":
      return l !== 0 && r !== 0 ? 1 : 0;
    case "or":
      return l !== 0 || r !== 0 ? 1 : 0;
    case "min":
      return Math.min(l, r);
    case "max":
      return Math.max(l, r);
    case "pow": {
      const p = Math.pow(l, r);
      return Number.isFinite(p) ? p : 0;
    }
    case "mod":
      return r === 0 ? 0 : l % r;
  }
}

function applyUna(op: UnaryOp, v: number): number {
  switch (op) {
    case "neg":
      return -v;
    case "not":
      return v === 0 ? 1 : 0;
    case "abs":
      return Math.abs(v);
    case "sign":
      if (Number.isNaN(v)) return 0;
      if (v > 0) return 1;
      if (v < 0) return -1;
      return 0;
    case "floor":
      return Math.floor(v);
    case "ceil":
      return Math.ceil(v);
    case "round":
      return Math.round(v);
    case "sqrt":
      return v < 0 ? 0 : Math.sqrt(v);
    case "ln":
      return v <= 0 ? 0 : Math.log(v);
    case "exp": {
      const e = Math.exp(v);
      return Number.isFinite(e) ? e : 0;
    }
  }
}

function lookupVar(path: string, state: MockPolicyState): number {
  if (path === "time") return state.time;
  if (path === "combat.iteration_count") {
    return state.self.extras["combat.iteration_count"] ?? state.state_extras["combat.iteration_count"] ?? 0;
  }
  if (path.startsWith("extras.") || path.startsWith("event.")) {
    const key = path.startsWith("extras.")
      ? path.slice("extras.".length)
      : path.slice("event.".length);
    return state.state_extras[key] ?? 0;
  }
  const dot = path.indexOf(".");
  if (dot < 0) return 0;
  const sideKw = path.slice(0, dot);
  const rest = path.slice(dot + 1);
  let side: MockSide;
  if (sideKw === "self") side = state.self;
  else if (sideKw === "opponent") side = state.opponent;
  else return 0;
  return lookupSidePath(rest, side, state.time);
}

function lookupSidePath(rest: string, side: MockSide, time: number): number {
  switch (rest) {
    case "hp":
      return side.hp;
    case "max_hp":
      return Math.max(side.max_hp, 1);
    case "hp_ratio":
      return side.hp_ratio;
    case "bite_dps":
      return side.bite_dps;
    case "breath_capacity":
      return side.breath_capacity;
    case "next_hit":
      return side.next_hit;
    case "next_breath":
      return side.next_breath;
    case "is_alive":
      return side.is_alive;
    case "time_to_max_hp":
      return side.time_to_max_hp;
    case "statuses_total_stacks":
      return side.statuses_total_stacks;
    case "statuses_count":
      return side.statuses_count;
  }
  // Sub-namespaces.
  for (const [prefix, map] of [
    ["cooldown_until.", side.cooldowns],
    ["active_until.", side.active_until],
  ] as const) {
    if (rest.startsWith(prefix)) {
      return map[rest.slice(prefix.length)] ?? 0;
    }
  }
  if (rest.startsWith("cooldown_remaining.")) {
    const id = rest.slice("cooldown_remaining.".length);
    return Math.max(0, (side.cooldowns[id] ?? 0) - time);
  }
  if (rest.startsWith("active_remaining.")) {
    const id = rest.slice("active_remaining.".length);
    return Math.max(0, (side.active_until[id] ?? 0) - time);
  }
  if (rest.startsWith("is_idle.")) {
    const id = rest.slice("is_idle.".length);
    const cd = side.cooldowns[id] ?? 0;
    const au = side.active_until[id] ?? 0;
    return time + 1e-9 >= cd && time + 1e-9 >= au ? 1 : 0;
  }
  if (rest.startsWith("status.")) {
    const after = rest.slice("status.".length);
    const lastDot = after.lastIndexOf(".");
    if (lastDot > 0 && after.slice(lastDot + 1) === "stacks") {
      return side.statuses[after.slice(0, lastDot)] ?? 0;
    }
    return 0;
  }
  if (rest.startsWith("stats.")) {
    return side.stats[rest.slice("stats.".length)] ?? 0;
  }
  if (rest.startsWith("extra.") || rest.startsWith("extras.")) {
    const key = rest.startsWith("extra.")
      ? rest.slice("extra.".length)
      : rest.slice("extras.".length);
    return side.extras[key] ?? 0;
  }
  if (rest.startsWith("fired_count.")) {
    return side.extras["fire_count." + rest.slice("fired_count.".length)] ?? 0;
  }
  if (rest.startsWith("last_fire_time.")) {
    return side.extras["last_fire." + rest.slice("last_fire_time.".length)] ?? Number.NEGATIVE_INFINITY;
  }
  if (rest.startsWith("time_since_fire.")) {
    const last =
      side.extras["last_fire." + rest.slice("time_since_fire.".length)];
    return last !== undefined && Number.isFinite(last)
      ? time - last
      : Number.POSITIVE_INFINITY;
  }
  return 0;
}

/** Compact format for the preview annotation. Uses 4-significant-digit
 *  rounding for non-integer floats; passes integers through. */
export function formatEvalResult(value: number): string {
  if (!Number.isFinite(value)) {
    return value > 0 ? "+∞" : value < 0 ? "−∞" : "NaN";
  }
  if (Number.isInteger(value)) return String(value);
  const abs = Math.abs(value);
  if (abs < 0.001 || abs >= 100000) {
    return value.toExponential(2);
  }
  return value.toPrecision(4).replace(/\.?0+$/, "");
}
