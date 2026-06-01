type CreditEntry = {
  name: string;
  role: string;
  description: string;
  link?: { href: string; label: string };
};

const CREDITS: CreditEntry[] = [
  {
    name: "Creatures of Sonaria Official Wiki",
    role: "Data Source",
    description:
      "Gratitude for providing the main public source used for creature stats, many in-game ability and effect descriptions, and the creature and plushie icons used throughout the site.",
    link: {
      href: "https://creatures-of-sonaria-official.fandom.com/",
      label: "creatures-of-sonaria-official.fandom.com",
    },
  },
  {
    name: "Broklya / Brok1ya",
    role: "Testing & Logo",
    description: "Tester during early site builds and designer of the site logo.",
  },
  {
    name: "Senku / cs_senku",
    role: "Testing",
    description:
      "Major contributor to testing — helped surface model inaccuracies that shaped the engine.",
  },
  {
    name: "Yaysito",
    role: "Content Creator",
    description:
      "Gratitude for the public gameplay videos on his channel, which served as a source of in-game testing used to find bugs and identify calculation inaccuracies.",
    link: { href: "https://www.youtube.com/@Yaysito", label: "youtube.com/@Yaysito" },
  },
  {
    name: "Torgido",
    role: "Testing",
    description:
      "Caught a handful of site bugs during testing and brought up several game-mechanic details that had slipped past me.",
  },
  {
    name: "Some random person / dragon648",
    role: "Testing & Mechanics",
    description:
      "Wide-ranging contributor — surfaced model inaccuracies, uncovered previously undocumented game mechanics, and reported site bugs.",
  },
];

export default function CreditsPage() {
  return (
    <section className="panel">
      <div className="panel-block credits-intro">
        <h3>Credits</h3>
        <p className="muted">People and sources that helped shape this site.</p>
      </div>
      <div className="credits-grid">
        {CREDITS.map((entry) => (
          <article key={entry.name} className="panel-block credit-card">
            <header className="credit-card-header">
              <h4>{entry.name}</h4>
              <span className="credit-role">{entry.role}</span>
            </header>
            <p>{entry.description}</p>
            {entry.link ? (
              <p className="credit-link">
                <a href={entry.link.href} target="_blank" rel="noreferrer">
                  {entry.link.label}
                </a>
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
