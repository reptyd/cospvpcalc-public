// Bespoke beta "Get in touch" - routed in place of ContactPage when the beta
// design is active. A centered "spotlight card" with three large action tiles:
// Email (primary, copies the address), Discord and GitHub. Root class `.inb`
// (shared with Donate / Credits) styled by infoBeta.css.

import { useState, type ReactNode } from "react";
import { ExternalLink, GitBranch, Mail, MessageCircle } from "lucide-react";
import "./compareBeta.css";
import "./infoBeta.css";

const EMAIL = "cos.pvp.contact@gmail.com";
const REPO_URL = "https://github.com/reptyd/cospvpcalc-public";

export default function ContactPageBeta(): ReactNode {
  const [copied, setCopied] = useState(false);

  // A mailto tile opens whatever the browser has registered as a mail client,
  // which on a desktop without one does nothing visible. Copying the address is
  // the action that always lands; the address stays on screen either way.
  const copyEmail = async (): Promise<void> => {
    const flash = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    };
    try {
      await navigator.clipboard.writeText(EMAIL);
      flash();
    } catch {
      // The Clipboard API is unavailable on http: and in restricted contexts -
      // fall back to a hidden textarea and the legacy copy command.
      const ta = document.createElement("textarea");
      ta.value = EMAIL;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        flash();
      } catch {
        // Nothing copied; the address is on screen to select by hand.
      }
      document.body.removeChild(ta);
    }
  };

  return (
    <section className="inb">
      <div className="inb-card inb-card--contact">
        <span className="inb-card__badge">
          <Mail size={26} strokeWidth={2} aria-hidden="true" />
        </span>
        <h2 className="inb-card__title">Get in touch</h2>
        <p className="inb-card__lede">
          For partnerships, ad placement, collaboration questions, bug reports, and feature suggestions — reach out by
          email or on Discord.
        </p>

        <div className="inb-actions">
          <button
            className="inb-tile inb-tile--primary"
            type="button"
            onClick={() => void copyEmail()}
            title="Copy the address to the clipboard"
          >
            <span className="inb-tile__icon">
              <Mail size={20} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="inb-tile__text">
              <span className="inb-tile__label">{copied ? "Copied" : "Email"}</span>
              <span className="inb-tile__sub">{EMAIL}</span>
            </span>
          </button>

          <a className="inb-tile inb-tile--discord" href="https://discord.gg/WgYSkw6rag" target="_blank" rel="noreferrer">
            <span className="inb-tile__icon">
              <MessageCircle size={20} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="inb-tile__text">
              <span className="inb-tile__label">Discord</span>
              <span className="inb-tile__sub">Join the community server</span>
            </span>
            <ExternalLink size={15} strokeWidth={2} className="inb-tile__ext" aria-hidden="true" />
          </a>

          <a className="inb-tile" href={REPO_URL} target="_blank" rel="noreferrer">
            <span className="inb-tile__icon">
              <GitBranch size={20} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="inb-tile__text">
              <span className="inb-tile__label">GitHub</span>
              <span className="inb-tile__sub">Read the source</span>
            </span>
            <ExternalLink size={15} strokeWidth={2} className="inb-tile__ext" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
