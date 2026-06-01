export default function DonatePage() {
  const onOtherDonateClick = () => {
    window.alert("Other donation options are not available yet. Only Boosty is active for now, more options are coming soon.");
  };
  return (
    <section className="panel">
      <div className="panel-grid">
        <div className="panel-block donate-card">
          <h3>Support Development</h3>
          <p>
            If you want to support me and the website development, you can use Boosty.
          </p>
          <div className="donate-actions">
            <a className="primary" href="https://boosty.to/cospvpcalc" target="_blank" rel="noreferrer">
              Boosty
            </a>
            <button className="secondary" type="button" onClick={onOtherDonateClick}>
              Other Donate Options
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
