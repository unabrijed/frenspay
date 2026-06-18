// screens-onboarding.jsx — onboarding + just-in-time identity (exported to window.ONB)
const { I: OI, RATE: ORATE, usd: ousd, inr: oinr } = window.UI;

// ---- A1 Welcome (full screen) ----
function Welcome({ S }) {
  return (
    <div className="onb center" style={{ justifyContent: 'space-between', paddingTop: 30, paddingBottom: 30 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <div className="logo-xl">P</div>
        <h1 style={{ fontSize: 32, maxWidth: 260 }}>Pay like a local, anywhere you travel.</h1>
        <div className="lead" style={{ maxWidth: 250 }}>One balance in dollars. Spend in rupees, instantly.</div>
      </div>
      <div className="cta" style={{ width: '100%' }}>
        <button className="btn btn-primary" onClick={S.onbNext}>Get started</button>
        <button className="textlink" onClick={S.onbFinish}>I already have an account</button>
      </div>
    </div>
  );
}

// ---- A2 Face ID ----
function FaceID({ S }) {
  return (
    <div className="onb">
      <div className="fhead"><button className="bk" onClick={S.onbBack}>{OI.back({ size: 18 })}</button></div>
      <div className="grow" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 18 }}>
        <div className="glyphc">{OI.face({ size: 44, color: 'var(--muted)', stroke: 1.6 })}</div>
        <h1>Set up with Face ID</h1>
        <div className="lead" style={{ maxWidth: 250 }}>No passwords, no seed phrases. Your account is secured on this device.</div>
      </div>
      <div className="cta"><button className="btn btn-primary" onClick={S.onbNext}>Continue with Face ID</button></div>
    </div>
  );
}

// ---- A3 Handle ----
function Handle({ S }) {
  return (
    <div className="onb">
      <div className="fhead"><button className="bk" onClick={S.onbBack}>{OI.back({ size: 18 })}</button></div>
      <h1>Choose your handle</h1>
      <div className="lead">Friends use this to pay you.</div>
      <div className="field" style={{ marginTop: 8 }}>
        <span className="ph">@</span>
        <span style={{ color: 'var(--ink)' }}>bridge</span>
        <div style={{ flex: 1 }} />
        <div className="availbadge">{OI.lockcheck({ size: 16, color: 'var(--accent)', stroke: 2 })}</div>
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--accent)', marginTop: 2 }}>@bridge is available</div>
      <div className="grow" />
      <div className="cta"><button className="btn btn-primary" onClick={S.onbNext}>Continue</button></div>
    </div>
  );
}

// ---- A4 Fund first ----
function FundFirst({ S }) {
  const [amt, setAmt] = React.useState(100);
  return (
    <div className="onb">
      <div className="fhead"><button className="bk" onClick={S.onbBack}>{OI.back({ size: 18 })}</button></div>
      <h1>Add your first dollars</h1>
      <div className="lead">Load once, then spend in rupees anywhere.</div>
      <div className="chips" style={{ marginTop: 10 }}>
        {[50, 100, 250].map((v) => <button key={v} className={'chip' + (amt === v ? ' on' : '')} onClick={() => setAmt(v)}>${v}</button>)}
      </div>
      <div className="field" style={{ marginTop: 12 }}><span className="ph">$</span><span style={{ color: 'var(--ink)' }}>{amt}</span></div>
      <div className="lead" style={{ fontSize: 13, marginTop: 10 }}>Pay with Apple Pay or card.</div>
      <div className="grow" />
      <div className="cta"><button className="btn btn-primary" onClick={S.onbFinish}>Add ${amt}</button></div>
    </div>
  );
}

// ---- Recovery (sheet) — deferred, prompted after the first payment ----
function Recovery({ S }) {
  return (
    <React.Fragment>
      <div className="grab" />
      <div className="shead"><h2>Add a backup</h2><button className="x" onClick={S.recoveryDone}>×</button></div>
      <div className="sbody">
        <div className="lead">So you never lose access if you lose this phone.</div>
        <div className="list" style={{ marginTop: 16 }}>
          <button className="row">
            <span className="ric">{OI.mail({ size: 18, color: 'var(--muted)', stroke: 1.6 })}</span>
            <div className="meta"><div className="nm">Recover by email</div></div>
            <span className="chev">{OI.chevron({ size: 18, color: 'var(--muted)' })}</span>
          </button>
          <button className="row">
            <span className="ric">{OI.device({ size: 18, color: 'var(--muted)', stroke: 1.6 })}</span>
            <div className="meta"><div className="nm">Add a second device</div></div>
            <span className="chev">{OI.chevron({ size: 18, color: 'var(--muted)' })}</span>
          </button>
        </div>
        <div className="spacer" />
        <div className="cta">
          <button className="btn btn-primary" onClick={S.recoveryDone}>Done</button>
          <button className="textlink" onClick={S.recoveryDone}>Set up later</button>
        </div>
      </div>
    </React.Fragment>
  );
}

// ---- Verify (sheet) — KYC tiers, surfaced just-in-time before first merchant pay ----
function Verify({ S }) {
  const payCtx = S.pendingPay;
  return (
    <React.Fragment>
      <div className="grab" />
      <div className="shead"><h2>{payCtx ? 'Verify to pay merchants' : 'Verification'}</h2><button className="x" onClick={S.close}>×</button></div>
      <div className="sbody">
        {payCtx && <div className="lead" style={{ marginBottom: 14 }}>A one-time check to pay shops across India. Your balance stays safe and untouched.</div>}
        <div className="tier on">
          <div className="th">
            <div className="badge-sm ok">{OI.lockcheck({ size: 14, color: '#fff', stroke: 2.2 })}</div>
            <div className="tt">Tier 1</div>
            <div style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>Active</div>
          </div>
          <div className="desc">Send and receive with friends. Up to <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)' }}>$100</span> per transfer.</div>
        </div>
        <div className="tier" style={{ marginTop: 12 }}>
          <div className="th">
            <div className="badge-sm off" />
            <div className="tt">Tier 2</div>
            <div style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>Verify to unlock</div>
          </div>
          <div className="desc">Pay merchants across India. Passport + visa, about 2 minutes.</div>
          <div style={{ marginTop: 14 }}><button className="btn btn-primary" onClick={S.verifyDone}>Verify identity</button></div>
        </div>
        {payCtx && <div className="spacer" />}
        {payCtx && <div className="cta"><button className="textlink" onClick={S.close}>Not now</button></div>}
      </div>
    </React.Fragment>
  );
}

window.ONB = { Welcome, FaceID, Handle, FundFirst, Recovery, Verify, ORDER: ['welcome', 'faceid', 'handle', 'fund'] };
