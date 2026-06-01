import json
import pathlib
import re

STATUS_MAP = {
    "burn": "burnStacks",
    "poison": "poisonStacks",
    "bleed": "bleedStacks",
    "frostbite": "frostbiteStacks",
    "necropoison": "necropoisonStacks",
}

BLOCK_MAP = {
    "burn": "blockBurnPct",
    "poison": "blockPoisonPct",
    "bleed": "blockBleedPct",
    "frostbite": "blockFrostbitePct",
    "necropoison": "blockNecropoisonPct",
    "injury": "blockInjuryPct",
}

STAT_PATTERNS = [
    # Health regeneration
    (r"([+-]?\d+(?:\.\d+)?)%\s*(?:to\s+)?health\s+regen(?:eration)?", "hpRegenPct", "addPct"),
    (r"adds?\s+([+-]?\d+(?:\.\d+)?)%\s+health\s+regen(?:eration)?", "hpRegenPct", "addPct"),
    
    # Stamina regeneration
    (r"([+-]?\d+(?:\.\d+)?)%\s*(?:to\s+)?stamina\s+regen(?:eration)?", "stamRegenPct", "addPct"),
    (r"increases?\s+stamina\s+regen(?:eration)?\s+by\s+([+-]?\d+(?:\.\d+)?)%", "stamRegenPct", "addPct"),
    
    # Max stamina
    (r"([+-]?\d+(?:\.\d+)?)%\s*(?:to\s+)?(?:creature\s+)?max\s+stamina", "maxStaminaPct", "addPct"),
    (r"increases?\s+(?:creature\s+)?max\s+stamina\s+by\s+([+-]?\d+(?:\.\d+)?)%", "maxStaminaPct", "addPct"),
    
    # Weight
    (r"([+-]?\d+(?:\.\d+)?)%\s+weight", "weightPct", "addPct"),
    
    # Damage
    (r"([+-]?\d+(?:\.\d+)?)%\s+damage", "damagePct", "addPct"),
    (r"(?:increases?|decreases?)\s+damage\s+by\s+([+-]?\d+(?:\.\d+)?)%", "damagePct", "addPct"),
    
    # Movement speed
    (r"([+-]?\d+(?:\.\d+)?)%\s+(?:to\s+)?(?:all\s+)?movement\s+speeds?", "movementSpeedPct", "addPct"),
    
    # Bite cooldown
    (r"([+-]?\d+(?:\.\d+)?)%\s+bite\s+cooldown", "biteCooldownPct", "addPct"),
    
    # Takeoff stamina cost
    (r"lowers?\s+take-?off\s+stamina\s+cost\s+by\s+([+-]?\d+(?:\.\d+)?)%", "takeoffStaminaCostPct", "addPct"),
]


def main() -> None:
    path = pathlib.Path("data/plushies.runtime.json")
    data = json.loads(path.read_text(encoding="utf-8"))

    for plushie in data.get("plushies", []):
        raw = plushie.get("rawDescription") or ""
        mods = plushie.get("modifiersParsed") or []
        # Use stat+op+value as key, ignore note for deduplication
        existing = {(m.get("stat"), m.get("op"), float(m.get("value"))) for m in mods}

        def add_mod(stat: str, op: str, value: float, note: str | None) -> None:
            key = (stat, op, float(value))
            if key in existing:
                return
            mods.append({"stat": stat, "op": op, "value": value, "note": note})
            existing.add(key)

        # Defensive status stacks
        for match in re.finditer(
            r"Adds\s*([+-]?\d+(?:\.\d+)?)\s*defensive\s*(burn|poison|bleed|frostbite|necropoison)\b",
            raw,
            re.IGNORECASE,
        ):
            value = float(match.group(1))
            status = match.group(2).lower()
            stat = STATUS_MAP.get(status)
            if stat:
                add_mod(stat, "addFlat", value, f"+{value} defensive {status}")

        # Offensive status stacks
        for match in re.finditer(
            r"Adds\s*([+-]?\d+(?:\.\d+)?)\s*(?:offensive\s*)?(burn|poison|bleed|frostbite|necropoison)\s*(?:attack|stacks)?\b",
            raw,
            re.IGNORECASE,
        ):
            text = match.group(0).lower()
            if "defensive" in text:
                continue
            value = float(match.group(1))
            status = match.group(2).lower()
            stat = STATUS_MAP.get(status)
            if stat:
                add_mod(stat, "addFlat", value, f"+{value} offensive {status}")

        # Direct block like -5% Burn Block
        for match in re.finditer(
            r"([+-]?\d+(?:\.\d+)?)%\s*(burn|poison|bleed|frostbite|necropoison)\s*block\b",
            raw,
            re.IGNORECASE,
        ):
            value = float(match.group(1))
            status = match.group(2).lower()
            stat = BLOCK_MAP.get(status)
            if stat:
                add_mod(stat, "addPct", value, f"{value}% {status} block")

        # Increases/Decreases Poison, Frostbite, and Burn block by 15%
        for match in re.finditer(
            r"(increases|decreases)\s+([a-z,\sand]+?)\s+block\s+by\s+([0-9.]+)%",
            raw,
            re.IGNORECASE,
        ):
            sign = 1 if match.group(1).lower().startswith("increase") else -1
            value = float(match.group(3)) * sign
            segment = match.group(2).lower()
            parts = re.split(r"\s*(?:,|and)\s*", segment)
            for part in parts:
                status = part.strip()
                if status not in BLOCK_MAP:
                    continue
                stat = BLOCK_MAP[status]
                add_mod(stat, "addPct", value, f"{value}% {status} block")

        # Injury block
        for match in re.finditer(
            r"([+-]?\d+(?:\.\d+)?)%\s*injury\s+block",
            raw,
            re.IGNORECASE,
        ):
            value = float(match.group(1))
            add_mod("blockInjuryPct", "addPct", value, f"{value}% injury block")

        # Generic stat patterns
        for pattern, stat, op in STAT_PATTERNS:
            for match in re.finditer(pattern, raw, re.IGNORECASE):
                value_str = match.group(1)
                value = float(value_str)
                
                # Handle "decreases" or "reduces" context
                context_start = max(0, match.start() - 20)
                context = raw[context_start:match.start()].lower()
                if any(word in context for word in ["decrease", "reduce", "lower"]):
                    value = -abs(value)
                
                add_mod(stat, op, value, None)

        plushie["modifiersParsed"] = mods

    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
