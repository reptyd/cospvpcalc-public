import { useEffect, useRef, type ReactNode } from "react";
import {
  Swords,
  Trophy,
  Gauge,
  SlidersHorizontal,
  Blocks,
  Search,
  BookOpen,
  Users,
  Mail,
  Heart,
  Settings,
  Palette,
  type LucideIcon,
} from "lucide-react";
import { SandboxIcon } from "../components/beta/customIcons";
import type { AppPage } from "../AppPageRouter";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { ShareMatchButton } from "../components/ShareMatchButton";
import { CombatEventOrderControl } from "../AppShellSections";
import type { CombatEventPhase } from "../engine/eventOrdering";
import "./betaTokens.css";
import "./betaShell.css";
import "./betaSurfaces.css";

/* Beta design - the next-gen app shell.
 *
 * A complete replacement chrome (sidebar nav + topbar + framed content)
 * that wraps the SAME `AppPageRouter` output the default shell renders.
 * Reusing the router is what guarantees full feature parity: every page
 * keeps all of its functionality, it is only re-framed and re-skinned.
 * Gated behind the dev-unlock + the Settings "Beta design" toggle. */

// Verified open-source glyphs (Lucide, ISC) - one per page.
const NAV_ICON: Record<AppPage, LucideIcon> = {
  compare: Swords,
  bestBuilds: Trophy,
  speedBuilds: Gauge,
  optimizer: SlidersHorizontal,
  sandbox: SandboxIcon,
  custom: Blocks,
  search: Search,
  reference: BookOpen,
  credits: Users,
  contact: Mail,
  donate: Heart,
};

const PAGE_META: Record<AppPage, { label: string; sub: string }> = {
  compare: { label: "Compare", sub: "Head-to-head 1v1 battle simulation" },
  bestBuilds: { label: "Best Builds", sub: "Search the optimal build for a creature" },
  speedBuilds: { label: "Speed Builds", sub: "Rank movement builds, or read a loadout" },
  optimizer: { label: "Optimizer", sub: "Counter-build against a fixed opponent" },
  sandbox: { label: "Sandbox", sub: "Step through a fight manually" },
  custom: { label: "Custom", sub: "Build custom creatures, abilities & timings" },
  search: { label: "Search", sub: "Browse and inspect the creature roster" },
  reference: { label: "Reference", sub: "Mechanics & ability documentation" },
  credits: { label: "Credits", sub: "Contributors & acknowledgements" },
  contact: { label: "Contact", sub: "Reach the team" },
  donate: { label: "Donate", sub: "Support the project" },
};

const NAV_ORDER: AppPage[] = [
  "compare",
  "bestBuilds",
  "speedBuilds",
  "optimizer",
  "sandbox",
  "custom",
  "search",
  "reference",
  "credits",
  "contact",
  "donate",
];

export type BetaShellProps = {
  page: AppPage;
  setPage: (page: AppPage) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  developerMode: boolean;
  setDeveloperMode: (enabled: boolean) => void;
  trueRoundingMode: boolean;
  setTrueRoundingMode: (enabled: boolean) => void;
  combatEventOrder: CombatEventPhase[];
  setCombatEventOrder: (order: CombatEventPhase[]) => void;
  trueDeveloperMode: boolean;
  setSiteDesignBeta: (enabled: boolean) => void;
  buildHash: string;
  onBuildShareText: () => string;
  onBuildReportText: () => string;
  banners?: ReactNode;
  children: ReactNode;
};

export default function BetaShell({
  page,
  setPage,
  settingsOpen,
  setSettingsOpen,
  developerMode,
  setDeveloperMode,
  trueRoundingMode,
  setTrueRoundingMode,
  combatEventOrder,
  setCombatEventOrder,
  trueDeveloperMode,
  setSiteDesignBeta,
  buildHash,
  onBuildShareText,
  onBuildReportText,
  banners,
  children,
}: BetaShellProps) {
  const meta = PAGE_META[page];

  // Scroll affordance for the mobile nav (the sidebar collapses into a
  // horizontal scroll row). Toggle edge-fade classes from the live scroll
  // position so a fade only shows on the side that still has hidden tabs -
  // otherwise users can't tell the row scrolls until they try.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () => {
      const atStart = el.scrollLeft <= 1;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      el.classList.toggle("has-start-fade", !atStart);
      el.classList.toggle("has-end-fade", !atEnd);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, []);

  return (
    <div className="beta-shell">
      <aside className="beta-sidebar">
        <div className="beta-brand">
          <span className="beta-brand-mark">
            <img src="/site-icon.png" alt="" className="beta-brand-logo" width={36} height={36} />
          </span>
          <span className="beta-brand-text">
            <span className="beta-brand-title">Sonaria Stat Lab</span>
          </span>
        </div>

        <div className="beta-nav-wrap">
          <nav className="beta-nav" aria-label="Primary" ref={navRef}>
          {NAV_ORDER.map((id) => {
            const NavIcon = NAV_ICON[id];
            return (
              <button
                key={id}
                type="button"
                className={`beta-nav-item${page === id ? " active" : ""}`}
                aria-current={page === id ? "page" : undefined}
                onClick={() => setPage(id)}
              >
                <NavIcon size={19} strokeWidth={1.8} aria-hidden="true" />
                <span>{PAGE_META[id].label}</span>
              </button>
            );
          })}
          </nav>
        </div>

        <div className="beta-sidebar-footer">
          <button
            type="button"
            className="beta-design-switch"
            onClick={() => setSiteDesignBeta(false)}
            title="Switch to the classic layout"
          >
            <Palette size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>Classic design</span>
          </button>
          {trueDeveloperMode ? <span className="beta-hash">#{buildHash}</span> : null}
        </div>
      </aside>

      <div className="beta-main-col">
        <header className="beta-topbar">
          <div className="beta-topbar-titles">
            <h1 className="beta-page-title">{meta.label}</h1>
            <span className="beta-page-sub">{meta.sub}</span>
          </div>
          <div className="beta-topbar-actions">
            <ShareMatchButton onBuildShareText={onBuildShareText} onBuildReportText={onBuildReportText} />
            <button
              type="button"
              className={`beta-icon-btn${settingsOpen ? " active" : ""}`}
              onClick={() => setSettingsOpen((prev) => !prev)}
              aria-expanded={settingsOpen}
            >
              <Settings size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>Settings</span>
            </button>

            {settingsOpen ? (
              <div className="beta-settings" role="dialog" aria-label="Settings">
                <h2 className="beta-settings-title">Settings</h2>
                <ToggleSwitch
                  checked={developerMode}
                  onChange={setDeveloperMode}
                  label="Developer Mode"
                  description="Shows advanced controls for optimizer and compare."
                />
                <ToggleSwitch
                  checked={trueRoundingMode}
                  onChange={setTrueRoundingMode}
                  label="True Rounding Mode"
                  description="Rounds final damage and final weight before compare simulation."
                />
                <CombatEventOrderControl value={combatEventOrder} onChange={setCombatEventOrder} />
                <p className="beta-settings-hint">
                  Tap two phases to swap the order simultaneous combat events resolve in. The first is fixed.
                </p>
                <div className="note">Internal mode: {trueDeveloperMode ? "active" : "locked"}.</div>
              </div>
            ) : null}
          </div>
        </header>

        <main id="main-content" className="beta-content">
          {banners ? <div className="beta-banners">{banners}</div> : null}
          <div key={page} className="beta-content-enter">
            {children}
          </div>
        </main>

        <footer className="beta-footer">
          <span>© {new Date().getFullYear()} Sonaria Stat Lab</span>
          <a href="/privacy.html" target="_blank" rel="noreferrer">
            Privacy
          </a>
        </footer>
      </div>
      {/* Mobile fallback: the sidebar footer that holds the Classic-design
          switch is hidden <=900px (the sidebar collapses to a top nav row), so
          float the switch bottom-left instead - otherwise phones have no way
          back to the classic layout. Mirrors the classic shell's "New design"
          floating pill. Desktop hides this (the footer button shows there). */}
      <button
        type="button"
        className="beta-mobile-classic-btn"
        onClick={() => setSiteDesignBeta(false)}
        title="Switch to the classic layout"
        aria-label="Switch to the classic layout"
      >
        <Palette size={15} strokeWidth={1.8} aria-hidden="true" />
        <span>Classic design</span>
      </button>
    </div>
  );
}
