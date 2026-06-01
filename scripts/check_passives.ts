import { creatureByName } from "../src/engine/creatureData";
for (const name of ["Valkurse", "Velcacao"]) {
  const c = creatureByName[name]!;
  const pas = (c.passiveAbilities ?? []).filter((a: any) => a.name === "Adrenaline" || a.name === "Block");
  console.log(`${name}:`, JSON.stringify(pas));
}
