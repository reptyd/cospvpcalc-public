// Bespoke beta "Support Development" - routed in place of DonatePage when the
// beta design is active. A centered "spotlight card": a glowing badge, a
// primary Boosty action tile, and the crypto presets as gold amount-pills.
// Reuses CRYPTO_AMOUNTS from the classic page (single source of truth). Root
// class `.inb` (shared with Contact / Credits) styled by infoBeta.css.

import { type ReactNode } from "react";
import { ExternalLink, Heart, Sparkles } from "lucide-react";
import { CRYPTO_AMOUNTS } from "./DonatePage";
import "./compareBeta.css";
import "./infoBeta.css";

export default function DonatePageBeta(): ReactNode {
  return (
    <section className="inb">
      <div className="inb-card inb-card--donate">
        <span className="inb-card__badge">
          <Heart size={26} strokeWidth={2} aria-hidden="true" />
        </span>
        <h2 className="inb-card__title">Support Development</h2>
        <p className="inb-card__lede">
          If you want to support me and the development of the site, you can use Boosty or crypto. Thank you — it
          genuinely keeps this project going.
        </p>

        <div className="inb-actions">
          <a className="inb-tile inb-tile--primary" href="https://boosty.to/cospvpcalc" target="_blank" rel="noreferrer">
            <span className="inb-tile__icon">
              <Sparkles size={20} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="inb-tile__text">
              <span className="inb-tile__label">Boosty</span>
              <span className="inb-tile__sub">Monthly or one-off support</span>
            </span>
            <ExternalLink size={15} strokeWidth={2} className="inb-tile__ext" aria-hidden="true" />
          </a>
        </div>

        <div className="inb-divider">
          <span>Crypto</span>
        </div>
        <div className="inb-amounts">
          {CRYPTO_AMOUNTS.map((amount) => (
            <a key={amount.label} className="inb-amount" href={amount.href} target="_blank" rel="noreferrer">
              {amount.label}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
