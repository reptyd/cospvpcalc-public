// Print every active "Manual check" override as what-changed-to-what, grouped by
// creature. This is the record of what a Discord post would announce.
import fs from 'node:fs';

const entries = JSON.parse(fs.readFileSync('data/manual_overrides.json', 'utf-8'));
const mine = entries.filter(e => e.source === 'Manual check' && !e.retiredAt);

const byCreature = new Map();
for (const e of mine) byCreature.set(e.creature, [...(byCreature.get(e.creature) ?? []), e]);

const describe = e => {
  if (e.kind === 'stat') return `${e.field}: ${e.expectedWikiValue ?? '(none)'} -> ${e.value}`;
  const name = e.matchAbilityName ?? e.ability?.name ?? '(unnamed)';
  const list = e.abilities ?? (e.ability ? [e.ability] : []);
  if (list.length === 0) return `${name}: removed`;
  const value = list[0].value;
  if (e.expectedWikiValue === undefined || e.expectedWikiValue === null) {
    return `${name}: added${value == null ? '' : ` = ${value}`}`;
  }
  return `${name}: ${e.expectedWikiValue} -> ${value}`;
};

console.log(`${mine.length} active "Manual check" overrides across ${byCreature.size} creatures\n`);
for (const [creature, list] of [...byCreature].sort()) {
  console.log(creature);
  for (const e of list) console.log(`    ${describe(e)}`);
}
