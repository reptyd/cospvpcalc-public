import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import wasm from "vite-plugin-wasm";

function resolveBuildHash(): string {
  try {
    const fromEnv = process.env.VITE_BUILD_HASH?.trim();
    if (fromEnv) return fromEnv;
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

const FROZEN_BUILD_HASH = resolveBuildHash();

function resolveRustWasmVersion(): string {
  try {
    const rustWasmPath = resolve(process.cwd(), "src", "rust-pkg", "cos_calc_wasm_engine_bg.wasm");
    return String(Math.trunc(statSync(rustWasmPath).mtimeMs));
  } catch {
    return "unknown";
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    wasm(),
    // NB: do NOT add vite-plugin-top-level-await here. The WASM engine is loaded
    // via dynamic `import()` of the JS glue (rustMatchupLoader / sandboxBridge),
    // and the glue contains no top-level await, so the plugin has nothing to do.
    // What it DID do was wrap every chunk in the WASM import subtree in an async
    // IIFE, which de-synchronised cross-chunk module init: consumer chunks that
    // build lookup tables at module top level (e.g. `[...plushies]`,
    // `new Set([...].map(normalizeAbilityName))`) intermittently read `undefined`
    // before the owning chunk finished initialising -> non-deterministic prod
    // crash ("X is not iterable" / "Cannot access 'X' before initialization").
    {
      name: "remove-public-wasm-sidecar",
      closeBundle() {
        rmSync(resolve(process.cwd(), "dist", "wasm"), { recursive: true, force: true });
      },
    },
    {
      name: "emit-version-json",
      apply: "build",
      writeBundle(options) {
        const outDir = options.dir ?? resolve(process.cwd(), "dist");
        mkdirSync(outDir, { recursive: true });
        writeFileSync(
          resolve(outDir, "version.json"),
          `${JSON.stringify({ buildHash: FROZEN_BUILD_HASH })}\n`,
        );
      },
    },
  ],
  define: {
    "import.meta.env.VITE_BUILD_HASH": JSON.stringify(FROZEN_BUILD_HASH),
    "import.meta.env.VITE_RUST_WASM_VERSION": JSON.stringify(resolveRustWasmVersion()),
  },
  server: {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  },
  worker: {
    format: "es",
    plugins: () => [
      wasm(),
    ],
  },
  build: {
    sourcemap: false,
    minify: "esbuild",
    cssMinify: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1300,
    modulePreload: {
      resolveDependencies: (_url, deps) =>
        deps.filter((dep) => {
          const normalized = dep.replace(/\\/g, "/");
          if (normalized.includes("OptimizerPage-")) return false;
          if (normalized.includes("BestBuildsPage-")) return false;
          if (normalized.includes("optimizer-")) return false;
          if (normalized.includes("engineRuntime-")) return false;
          if (normalized.includes("engineEffectsData-")) return false;
          if (normalized.includes("engineStatusData-")) return false;
          if (normalized.includes("engineSpecialData-")) return false;
          if (normalized.includes("engineBreathData-")) return false;
          if (normalized.includes("engineData-")) return false;
          if (normalized.includes("engineStatusBlocksData-")) return false;
          if (normalized.includes("engineStatusAttacksData-")) return false;
          if (normalized.includes("engineDefensiveStatusData-")) return false;
          if (normalized.includes("creaturesRuntimeData-")) return false;
          if (normalized.includes("creaturesIconsData-")) return false;
          if (normalized.includes("engineTraitIconsData-")) return false;
          if (normalized.includes("enginePlushieIconsData-")) return false;
          if (normalized.includes("creatureData-")) return false;
          if (normalized.includes("abilityCoverage-")) return false;
          return true;
        }),
    },
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        manualChunks(id) {
          if (id.includes("node_modules")) return "vendor";
          // Pure, zero-import name-normalization helpers. MUST be its own leaf
          // chunk: `creatureData` re-exports it, and if it were lumped into the
          // engine catch-all that would form a creatureData↔engineRuntime chunk
          // cycle (TDZ at runtime). A leaf chunk has no back-edge.
          if (id.includes("/src/engine/creatureNameUtils")) return "creatureNameUtils";
          // Generated spec magnitudes, zero imports, read from both the
          // boot-light `engineCore` bucket and the heavy `engineRuntime`
          // catch-all. Without a home of its own the `/src/engine/` rule below
          // files it under engineRuntime, and the moment anything in engineCore
          // reads a constant the two chunks point at each other: engineRuntime
          // also reads DEFAULT_TWO_FACED_MODE out of engineCore. Rollup picks an
          // order for a cycle, and the losing side evaluates its namespace
          // object against a binding still in TDZ - a blank page with "Cannot
          // access 'X' before initialization". A leaf has no back-edge.
          if (id.includes("/src/engine/specConstants.generated")) return "specConstants";
          if (id.includes("/src/engine/creatureData")) return "creatureData";
          // The two creatures JSONs are huge and were sliding into the
          // auto-named `data-*.js` chunk (~1.28 MB)
          // because the previous rule only matched the .ts wrapper.
          if (id.includes("/data/creatures.runtime")) return "creaturesRuntimeData";
          if (id.includes("/data/creatures.icons")) return "creaturesIconsData";
          if (id.includes("/data/trait_icons")) return "engineTraitIconsData";
          if (id.includes("/data/plushies.icons")) return "enginePlushieIconsData";
          if (id.includes("/data/effects_catalog.runtime")) return "engineEffectsData";
          if (id.includes("/data/status_effects.runtime")) return "engineStatusData";
          if (id.includes("/data/special_abilities.runtime")) return "engineSpecialData";
          if (id.includes("/data/breath_specs.runtime")) return "engineBreathData";
          // The previous catch-all
          // `data-*.js` chunk was 1.27 MB. Bucket the four remaining
          // JSON runtime imports separately so the route-split
          // dependency graph can load only what each page needs.
          if (id.includes("/data/traits.runtime")) return "engineTraitsData";
          if (id.includes("/data/veneration.runtime")) return "engineVenerationData";
          if (id.includes("/data/plushies.runtime")) return "enginePlushiesData";
          if (id.includes("/data/rules.recode")) return "engineRulesData";
          // The previous auto-named `data-*.js`
          // chunk was 1.28 MB - the three remaining status-data JSONs
          // (`s1_blocks`, `s2_status_attacks`, `a1_defensive_status`)
          // weren't covered above and were being pulled in eagerly by
          // anything that hit the engineRuntime barrel. Buckets named
          // by the JSON role so a future reader can map chunk → source.
          if (id.includes("/data/s1_blocks.runtime")) return "engineStatusBlocksData";
          if (id.includes("/data/s2_status_attacks.runtime")) return "engineStatusAttacksData";
          if (id.includes("/data/a1_defensive_status.runtime")) return "engineDefensiveStatusData";
          // Boot-light modules the entry imports eagerly. They are catalog-free,
          // but the `engineRuntime`/`optimizer` catch-alls below statically depend
          // on the catalogs (via data.ts / buildRules), so without an explicit home
          // Rollup folds these shared leaves into those heavy chunks and the entry
          // re-pulls the ~1.2 MB creature/effects JSON onto the boot main thread.
          // `customCreatures.` (trailing dot) matches only the registry — NOT
          // customCreatureValidation / customCreatureCatalogBridge (heavy, lazy).
          if (
            id.includes("/src/engine/eventOrdering") ||
            id.includes("/src/engine/customCreatures.") ||
            // Catalog-free constants reached eagerly via matchSnapshot →
            // snapshotDefaults (share-link default page state).
            id.includes("/src/engine/compareBuffRuntime") ||
            id.includes("/src/engine/twoFacedMode") ||
            id.includes("/src/components/compare/compareSpecialAbilities") ||
            // Pure storage util used by App + every cross-tab registry; without
            // a home it gets absorbed into the optimizer chunk.
            id.includes("/src/shared/safeStorage")
          ) {
            return "engineCore";
          }
          if (id.includes("/src/engine/")) return "engineRuntime";
          // The WASM status/loader is catalog-free and imported eagerly by App;
          // keep it out of the `optimizer` catch-all (which pulls the catalogs).
          if (id.includes("/src/optimizer/rustMatchupLoader")) return "optimizerCore";
          // The ability registry (single source + pure derive fns) and its leaf
          // input lists import only leaf helpers - no engine/runtime. Carving them
          // out of the `optimizer` chunk removes the engine<->optimizer cross-chunk
          // cycle: `engine/data` -> `shared/modeledOtherAbilities` eagerly calls
          // `deriveModeledOtherAbilities` (engine->optimizer), while
          // `optimizer/buildAbilityConfig` -> `engine/data` (optimizer->engine). A
          // leaf chunk inits before its consumers, so the eager `export const X =
          // derive()` reads are deterministic (no cross-chunk init-order TDZ - the
          // "Cannot access 'X' before initialization" crash class). Same technique
          // as the creatureNameUtils carve-out above.
          if (
            id.includes("/src/optimizer/abilityRegistry") ||
            id.includes("/src/optimizer/abilityModelScope")
          ) {
            return "abilityRegistry";
          }
          if (id.includes("/src/optimizer/")) return "optimizer";
          return undefined;
        },
      },
    },
  },
});
