// Bespoke beta "Credits" - routed in place of CreditsPage when the beta design
// is active. An accent-bar intro + a responsive grid of credit cards (name,
// role badge, description, optional source link) with the beta hover-lift.
// Reuses CREDITS from the classic page (single source of truth). Root class
// `.inb` (shared with Donate / Contact) styled by infoBeta.css.

import { type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { CREDITS } from "./CreditsPage";
import "./compareBeta.css";
import "./infoBeta.css";

export default function CreditsPageBeta(): ReactNode {
  return (
    <section className="inb">
      <div className="inb-intro">
        <h2 className="inb-intro__title">Credits</h2>
        <p className="inb-intro__sub">People and sources that helped shape this site.</p>
      </div>

      <div className="inb-grid">
        {CREDITS.map((entry) => (
          <article key={entry.name} className="inb-credit">
            <div className="inb-credit__head">
              <h3 className="inb-credit__name">{entry.name}</h3>
              <span className="inb-credit__role">{entry.role}</span>
            </div>
            <p className="inb-credit__desc">{entry.description}</p>
            {entry.link ? (
              <a className="inb-credit__link" href={entry.link.href} target="_blank" rel="noreferrer">
                <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
                {entry.link.label}
              </a>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
