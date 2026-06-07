// Preset crypto donation amounts. Each links to a dedicated BlockBee
// hosted-checkout page for that fixed USD amount.
const CRYPTO_AMOUNTS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "$5", href: "https://pay.blockbee.io/payment/CrPunYGTJShKrx983KhLVjCEwGjIXJ85/" },
  { label: "$10", href: "https://pay.blockbee.io/payment/aYboS2ciUI4gtGcd87HdrWj3ndcLqPKC/" },
  { label: "$25", href: "https://pay.blockbee.io/payment/turSJ4KMtixm9XxcfbPQhDWsqqZtAMhV/" },
  { label: "$100", href: "https://pay.blockbee.io/payment/jfdYR6ZRkcRGgDpWNK0nYI6TiNiM6mW3/" },
];

export default function DonatePage() {
  return (
    <section className="panel">
      <div className="panel-grid">
        <div className="panel-block donate-card">
          <h3>Support Development</h3>
          <p>
            If you want to support me and the website development, you can use
            Boosty or crypto.
          </p>
          <div className="donate-actions">
            <a className="primary" href="https://boosty.to/cospvpcalc" target="_blank" rel="noreferrer">
              Boosty
            </a>
          </div>
          <div className="donate-crypto">
            <span className="donate-crypto__label">Crypto</span>
            <div className="donate-crypto__amounts">
              {CRYPTO_AMOUNTS.map((amount) => (
                <a
                  key={amount.label}
                  className="donate-amount"
                  href={amount.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {amount.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
