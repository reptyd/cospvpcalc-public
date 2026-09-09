// Screenshots of the Speed Builds page in both shells and both modes, plus the
// phone width and Squitico, the one creature in the roster that carries all
// nine readout channels at once.
// Run against a dev server: `npm run dev` in one terminal, then
// `node scripts/capture_speed_shots.mjs`. Set SPEED_SHOTS_URL to point it
// somewhere else.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.SPEED_SHOTS_URL ?? "http://localhost:5199/";
const OUT = "artifacts";

const SETUP = {
  target: "sprint",
  active: ["posture_cower"],
  fillPct: 100,
  manualBuild: {
    venerationStage: 5,
    traits: ["Speed"],
    ascensionAssignments: ["Speed", "Speed", "Speed", "Speed", "Speed"],
    plushies: ["Chick", "Bear"],
    elder: "Devious",
  },
};

const SHOTS = [
  { file: "classic-optimize.png", design: "classic", mode: "optimize", creature: "Abyssal Geortharoc" },
  { file: "classic-manual.png", design: "classic", mode: "manual", creature: "Abyssal Geortharoc" },
  { file: "beta-optimize.png", design: "beta", mode: "optimize", creature: "Abyssal Geortharoc" },
  { file: "beta-manual.png", design: "beta", mode: "manual", creature: "Abyssal Geortharoc" },
  { file: "classic-flier.png", design: "classic", mode: "optimize", creature: "Squitico" },
  { file: "beta-flier.png", design: "beta", mode: "optimize", creature: "Squitico" },
  // Ambush ranked rather than read off a tile, which is the one ranking Bunny
  // can win.
  { file: "beta-ambush.png", design: "beta", mode: "optimize", creature: "Squitico", target: "ambush" },
  { file: "classic-optimize-360.png", design: "classic", mode: "optimize", creature: "Abyssal Geortharoc", width: 360, height: 800 },
  { file: "beta-optimize-360.png", design: "beta", mode: "optimize", creature: "Abyssal Geortharoc", width: 360, height: 800 },
  // Manual's two panes fold into one column below 920, answer first - the one
  // layout on this page that changes shape rather than just reflowing.
  { file: "beta-manual-360.png", design: "beta", mode: "manual", creature: "Abyssal Geortharoc", width: 360, height: 800 },
  // The constraint group, open, over a ranking already narrowed by it - the
  // default shots have nothing set, so the strip has nothing extra to say.
  {
    file: "beta-constraints.png",
    design: "beta",
    mode: "optimize",
    creature: "Abyssal Geortharoc",
    constraints: { elder: "Powerful", traits: null, venerationStage: 3, requiredPlushie: "Bear", excludedPlushies: ["Chick"] },
    openPanel: true,
    fullPage: false,
  },
];

/** Type into whichever creature picker the shell exposes and dismiss the
 * suggestion menu, so it never lands in the frame. In beta the picker lives in
 * the Setup overlay, which has to be opened and closed around it. */
async function pickCreature(page, design, creature) {
  if (design === "beta") await page.locator(".spb-creature").click();
  const scope = design === "beta" ? ".cb-modal" : ".speed-builds-page";
  await page.locator(`${scope} .creature-name-input input`).fill(creature);
  await page.locator(".creature-name-input-option", { hasText: creature }).first().click();
  if (design === "beta") await page.locator(".cb-modal .cb-icon").click();
}

async function shot(browser, { design, mode, creature, file, constraints, target, openPanel, fullPage = true, width = 1440, height = 1000 }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await context.addInitScript(
    ([uiDesign, state]) => {
      localStorage.setItem("cos.uiDesign", uiDesign);
      localStorage.setItem("cos.speedBuildsState", state);
    },
    [design, JSON.stringify({ ...SETUP, mode, ...(target ? { target } : {}), ...(constraints ? { constraints } : {}) })],
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  const nav = design === "classic" ? ".tabs button" : ".beta-nav-item";
  await page.locator(nav, { hasText: /^Speed Builds$/ }).first().click();
  const root = design === "classic" ? ".speed-builds-page" : ".spb";
  await page.waitForSelector(root);
  await pickCreature(page, design, creature);
  if (openPanel) await page.locator(".spb-bar__actions button", { hasText: "Configure" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage });
  await context.close();
  console.log(`${file} written`);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const spec of SHOTS) await shot(browser, spec);
await browser.close();
