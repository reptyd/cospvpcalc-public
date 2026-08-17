// Bespoke beta "Get in touch" - routed in place of ContactPage when the beta
// design is active. A centered "spotlight card" with two large action tiles:
// Email (primary) and Discord. Root class `.inb` (shared with Donate / Credits)
// styled by infoBeta.css.

import { type ReactNode } from "react";
import { ExternalLink, Mail, MessageCircle } from "lucide-react";
import "./compareBeta.css";
import "./infoBeta.css";

export default function ContactPageBeta(): ReactNode {
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
          <a className="inb-tile inb-tile--primary" href="mailto:cos.pvp.contact@gmail.com">
            <span className="inb-tile__icon">
              <Mail size={20} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="inb-tile__text">
              <span className="inb-tile__label">Email</span>
              <span className="inb-tile__sub">cos.pvp.contact@gmail.com</span>
            </span>
          </a>

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
        </div>
      </div>
    </section>
  );
}
