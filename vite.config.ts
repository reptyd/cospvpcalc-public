import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

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
    topLevelAwait(),
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
      topLevelAwait(),
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
          if (id.includes("/src/engine/")) return "engineRuntime";
          if (id.includes("/src/optimizer/")) return "optimizer";
          return undefined;
        },
      },
    },
  },
});
