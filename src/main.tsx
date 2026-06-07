import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted typography. Replaces the Google Fonts <link> tags in
// `index.html` so the page no longer fetches from `fonts.googleapis.com`
// / `fonts.gstatic.com` - lifts the CSP back to a strict same-origin
// posture and lets `Cross-Origin-Embedder-Policy: require-corp` come
// back in (it was previously disabled because Google Fonts don't ship CORP).
import '@fontsource/archivo/300.css'
import '@fontsource/archivo/400.css'
import '@fontsource/archivo/600.css'
import '@fontsource/archivo/700.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/700.css'
// Touch-DnD polyfill. Translates touch events to HTML5 drag events so
// the Custom-Abilities visual editor (which uses `draggable=true` /
// `onDragStart` / `onDrop`) works on phones and tablets. Without it,
// HTML5 DnD only fires from a mouse - the entire constructor was
// inert on touch devices. `forceApply: true` skips the desktop-DnD
// feature check (some browsers report support but still drop the
// touch path).
import { polyfill as mobileDragDropPolyfill } from 'mobile-drag-drop'
import 'mobile-drag-drop/default.css'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './AppErrorBoundary.tsx'
import { installStaleChunkReload } from './bootstrap/staleChunkReload'
import { startVersionPoll } from './bootstrap/versionPoll'
import { installWebVitalsCapture } from './observability/webVitals'
import {
  installCustomCreatureCrossTabSync,
  registerEphemeralCustomCreature,
  restoreCustomCreatureRecords,
} from './engine/customCreatures'
import {
  installCustomAbilityCrossTabSync,
  restoreCustomAbilityRecords,
} from './shared/customAbilities'
import {
  installCustomTimingCrossTabSync,
  restoreCustomTimingRecords,
} from './shared/customTimings'
import {
  installCustomStatusCrossTabSync,
  restoreCustomStatusRecords,
} from './shared/customStatuses'
import {
  listCustomLibraryBundleImportConflictsJson,
  tryImportFromUrlHash,
  type ImportConflictSummary,
} from './shared/customLibraryBundle'
import {
  decodeMatchSnapshot,
  readStashedImportedMatchCode,
  setInitialImportedMatch,
  stashImportedMatchCode,
  MATCH_SNAPSHOT_QUERY_PARAM,
} from './shared/matchSnapshot'

const root = document.getElementById('root')!

if (!hasRequiredBrowserFeatures()) {
  // Render a static fallback UI before React boots. The user sees
  // a clear "your browser is too old" message instead of a blank
  // page when WebAssembly / ES modules / fetch / Promise are
  // missing. Production browserslist (last-2 of major engines)
  // implies these are present everywhere we support; anything
  // older lands here.
  root.innerHTML = unsupportedBrowserMarkup()
} else {
  // Web vitals capture installs PerformanceObservers. Wire it before
  // any heavy work so the LCP observer sees the actual largest paint
  // (otherwise we miss the metric on slow networks). The observers
  // populate `window.__cosCalcVitals` for devtools inspection.
  installWebVitalsCapture()
  installStaleChunkReload()
  // Touch-DnD polyfill. Applies globally so every `draggable=true`
  // surface (Custom-Ability visual editor) accepts touch. The polyfill
  // listens for touchstart on document, then dispatches synthetic
  // `dragstart` / `dragover` / `drop` events native HTML5 DnD handlers
  // can read.
  //
  // - `forceApply: true` skips the desktop-DnD feature detect (some
  //   mobile browsers claim support but never fire dragstart from touch).
  // - No `holdToDrag` - earlier we used 150 ms but Android Chrome was
  //   eating the touchstart for scroll before the hold timer elapsed.
  //   Instead the touch-source on mobile is scoped to a small ⋮⋮ drag
  //   handle inside each draggable element (`touch-action: none` on
  //   the handle only - see `.scratch-drag-handle` in App.css). Tap on
  //   the rest of the tile/block scrolls or fires onClick.
  mobileDragDropPolyfill({ forceApply: true })
  // The polyfill calls `preventDefault` on `touchmove` so the browser
  // doesn't scroll during a drag. Modern browsers default touchmove
  // listeners to `passive: true`, which would silently drop the
  // preventDefault. Registering a no-op listener with `passive: false`
  // (per the polyfill README) ensures the polyfill's own preventDefault
  // is honored.
  window.addEventListener('touchmove', () => {}, { passive: false })
  restoreCustomCreatureRecords()
  installCustomCreatureCrossTabSync()
  // Custom abilities + timings restore is async (calls into the WASM
  // bridge once it loads). UI renders immediately and lists update
  // via the registries' subscriber pattern as the restore completes.
  // We capture the promises so a follow-up share-link import can
  // await the restores rather than racing them via a magic timeout.
  const customAbilitiesRestore = restoreCustomAbilityRecords()
  const customTimingsRestore = restoreCustomTimingRecords()
  const customStatusesRestore = restoreCustomStatusRecords()
  installCustomAbilityCrossTabSync()
  installCustomTimingCrossTabSync()
  installCustomStatusCrossTabSync()
  // Tier-D: detect a share link in location.hash and import AFTER
  // the local registries finish restoring. Otherwise the import's
  // clear-and-replace fights the restore - historically this was
  // worked around with a 250ms `setTimeout`.
  if (typeof window !== 'undefined' && window.location.hash) {
    void (async () => {
      // `allSettled` so a failing restore doesn't block import; the
      // restore's own logging surfaces the failure separately.
      await Promise.allSettled([customAbilitiesRestore, customTimingsRestore, customStatusesRestore])
      try {
        const replaceConflicts = confirmShareLinkReplacements(window.location.hash)
        const result = await tryImportFromUrlHash(window.location.hash, {
          replaceAbilityConflicts: replaceConflicts,
          replaceTimingConflicts: replaceConflicts,
          replaceCreatureConflicts: replaceConflicts,
        })
        if (result) {
          history.replaceState(null, '', window.location.pathname + window.location.search)
        }
      } catch (err) {
        console.warn('[main] share-link import failed', err)
      }
    })()
  }
  // Imported-match (share-link) decode: ?match=COSM1:... replays a
  // shared matchup without touching the viewer's localStorage or saved
  // creatures. Participant custom creatures are registered ephemerally
  // so the page can look them up by name; App enters imported-match
  // mode when it consumes the stashed snapshot. The param is stripped
  // from the URL so a reload returns the viewer to their own state.
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    const matchParam = params.get(MATCH_SNAPSHOT_QUERY_PARAM)
    // A fresh ?match= wins; otherwise resume a stash that survived a
    // reload. staleChunkReload (and error-boundary reloads) re-navigate
    // after the param has already been stripped, so without the
    // sessionStorage copy the import would be lost and the viewer would
    // see default creatures.
    let importCode: string | null = matchParam
    if (matchParam) {
      stashImportedMatchCode(matchParam)
      params.delete(MATCH_SNAPSHOT_QUERY_PARAM)
      const search = params.toString()
      history.replaceState(
        null,
        '',
        window.location.pathname + (search ? `?${search}` : '') + window.location.hash,
      )
    } else {
      importCode = readStashedImportedMatchCode()
    }
    if (importCode) {
      const snapshot = decodeMatchSnapshot(importCode)
      if (snapshot) {
        for (const record of snapshot.participantCustomCreatures) {
          try {
            registerEphemeralCustomCreature(record)
          } catch (err) {
            console.warn('[main] failed to register shared custom creature', err)
          }
        }
        setInitialImportedMatch(snapshot)
      }
    }
  }

  startVersionPoll()

  createRoot(root).render(
    <StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </StrictMode>,
  )
}

function confirmShareLinkReplacements(hash: string): boolean {
  const json = decodeShareLinkHashJson(hash)
  if (!json) return false
  const conflicts = listCustomLibraryBundleImportConflictsJson(json)
  if (countImportConflicts(conflicts) === 0) return false
  return window.confirm(formatImportConflictPrompt(conflicts))
}

function countImportConflicts(conflicts: ImportConflictSummary): number {
  return conflicts.abilities.length + conflicts.timings.length + conflicts.creatures.length
}

function formatImportConflictPrompt(conflicts: ImportConflictSummary): string {
  return [
    'This share link contains records already in your custom library:',
    ...formatConflictGroup('Abilities', conflicts.abilities),
    ...formatConflictGroup('Timings', conflicts.timings),
    ...formatConflictGroup('Creatures', conflicts.creatures),
    '',
    'Replace matching records?',
    'OK = replace matching records. Cancel = keep yours and skip matching records.',
  ].join('\n')
}

function formatConflictGroup(label: string, conflicts: string[]): string[] {
  if (conflicts.length === 0) return []
  const visible = conflicts.slice(0, 8)
  const extra = conflicts.length - visible.length
  return [
    `${label}: ${visible.join(', ')}${extra > 0 ? `, and ${extra} more` : ''}`,
  ]
}

function decodeShareLinkHashJson(hash: string): string | null {
  const trimmed = hash.replace(/^#/, '')
  if (!trimmed.startsWith('cosab1:')) return null
  const payload = trimmed.slice('cosab1:'.length)
  try {
    if (typeof atob === 'function') {
      return decodeURIComponent(escape(atob(payload)))
    }
    return null
  } catch {
    return null
  }
}

function hasRequiredBrowserFeatures(): boolean {
  return (
    typeof WebAssembly === 'object' &&
    typeof WebAssembly.instantiate === 'function' &&
    typeof Promise !== 'undefined' &&
    typeof fetch === 'function' &&
    typeof globalThis !== 'undefined'
  )
}

function unsupportedBrowserMarkup(): string {
  return `
    <div role="alert" style="
      max-width: 640px;
      margin: 12vh auto;
      padding: 1.5rem;
      font-family: system-ui, sans-serif;
      color: #eee;
      background: #1d1f24;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      line-height: 1.5;
    ">
      <h1 style="margin-top: 0; font-size: 1.4rem;">This browser is too old.</h1>
      <p>
        The simulator needs WebAssembly and ES2022 modules to run. Please
        update your browser to a recent version of Chrome, Firefox, Safari,
        or Edge - the last two stable releases of any of those will work.
      </p>
      <p style="margin-bottom: 0; font-size: 0.9rem; color: #aaa;">
        If you believe this is shown in error, please report it with your
        browser version and OS so the supported browsers list can be
        adjusted.
      </p>
    </div>
  `
}
