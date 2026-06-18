// screens-core.jsx — Home + pay flow (exported to window.CORE)
const { I, StatusBar, RATE, inr, usd, inrRaw } = window.UI;

// ---- the signature element: rate-lock card, 3 variants ----
function RateLock({ variant = 'A', payUsd, getR }) {
  const rate = '1 USD = 87.55 INR';
  const Lock = ({ center }) => (
    <React.Fragment>
      <div className="divider" />
      <div className="lock" style={center ? { justifyContent: 'center', gap: 12 } : null}>
        <div className="l"><span className="dot" />Rate locked</div>
        <div className="rate">{rate}</div>
      </div>
    </React.Fragment>
  );
  if (variant === 'B') {
    return (
      <div className="rlc B">
        <div className="lab">You pay</div>
        <div className="fig">{usd(payUsd)}</div>
        <div className="arrow"><div>{I.request({ size: 16, color: 'var(--muted)', stroke: 1.6 })}</div></div>
        <div className="lab g">Merchant gets</div>
        <div className="fig g">{inrRaw(getR)}</div>
        <Lock />
      </div>
    );
  }
  if (variant === 'C') {
    return (
      <div className="rlc C">
        <div className="lab">Merchant gets</div>
        <div className="fig">{inrRaw(getR)}</div>
        <div className="eq">= {usd(payUsd)} from your balance</div>
        <Lock center />
      </div>
    );
  }
  return (
    <div className="rlc A">
      <div className="cols">
        <div className="c"><div className="lab">You pay</div><div className="fig">{usd(payUsd)}</div></div>
        <div className="swap">{I.swap({ size: 16, color: 'var(--muted)', stroke: 1.5 })}</div>
        <div className="c r"><div className="lab">Merchant gets</div><div className="fig">{inrRaw(getR)}</div></div>
      </div>
      <Lock />
    </div>
  );
}

// ---- Home ----
function Home({ S }) {
  const lead0 = S.t.homeCur === 'USD' ? 'USD' : 'INR';
  const [lead, setLead] = React.useState(lead0);
  React.useEffect(() => { setLead(S.t.homeCur === 'USD' ? 'USD' : 'INR'); }, [S.t.homeCur]);
  const flip = S.t.homeCur === 'Flip';

  const Hero = () => {
    if (flip) {
      return (
        <div className="hero">
          <div className="toggle"><div className="eyebrow">Balance</div></div>
          <div className="flipcard">
            <div className="side"><div className="n" style={{ color: 'var(--ink)' }}>{usd(S.bal)}</div><div className="l">your balance</div></div>
            <div className="swap">{I.swap({ size: 17, color: 'var(--muted)', stroke: 1.5 })}</div>
            <div className="side r"><div className="n">{inr(S.bal)}</div><div className="l">to spend</div></div>
          </div>
          <div className="note">Tap to flip which currency leads. 1 USD = 87.55 INR.</div>
        </div>
      );
    }
    const leadINR = lead === 'INR';
    return (
      <div className="hero">
        <div className="toggle">
          <div className="eyebrow">{leadINR ? 'Spendable in India' : 'Balance'}</div>
          <div className="seg" onClick={() => setLead(leadINR ? 'USD' : 'INR')}>
            <b className={leadINR ? 'on' : ''}>INR</b><b className={!leadINR ? 'on' : ''}>USD</b>
          </div>
        </div>
        <div className={'bignum ' + (leadINR ? 'inr' : 'usd')}>{leadINR ? inr(S.bal) : usd(S.bal)}</div>
        <div className="sub">{leadINR ? <span><b>{usd(S.bal)}</b> balance · 1 USD = 87.55 INR</span> : <span>~ {inr(S.bal)} · 1 USD = 87.55 INR</span>}</div>
        <div className="note">Your dollars, spent in rupees at a rate locked the moment you pay.</div>
      </div>
    );
  };

  return (
    <div className="scroll">
      <div className="top">
        <div className="brand"><div className="logo">P</div><div className="w">Pay</div></div>
        <button className="avatar" onClick={() => S.open('settings')}>B</button>
      </div>
      <Hero />
      <div className="tiles">
        <button className="tile" onClick={() => S.open('add')}><span className="ic">{I.plus({ size: 17, color: 'var(--ink)' })}</span><span>Add</span></button>
        <button className="tile" onClick={() => S.open('send')}><span className="ic">{I.send({ size: 17, color: 'var(--ink)' })}</span><span>Send</span></button>
        <button className="tile" onClick={() => S.open('request')}><span className="ic">{I.request({ size: 17, color: 'var(--ink)' })}</span><span>Request</span></button>
      </div>
      <div className="recent">
        <div className="rh"><div className="eyebrow">Recent</div><button className="see" onClick={() => S.setTab('activity')}>See all</button></div>
        <div className="list">
          {S.txns.slice(0, 2).map((tx) => <TxRow key={tx.id} tx={tx} onClick={() => S.openDetail(tx)} />)}
        </div>
      </div>
      <div className="spacer" />
    </div>
  );
}

function TxRow({ tx, onClick }) {
  const merchant = tx.type === 'pay';
  return (
    <button className="row" onClick={onClick}>
      <span className={'ric' + (merchant ? ' qr' : '')}>
        {merchant ? I.qr({ size: 18, color: 'var(--accent)' })
          : tx.type === 'add' ? I.plus({ size: 17, color: 'var(--muted)' })
          : I.send({ size: 17, color: 'var(--muted)' })}
      </span>
      <div className="meta">
        <div className="nm">{tx.title}</div>
        <div className="tm">{tx.time}</div>
      </div>
      <div className="amt">
        <div className={'d' + (tx.type === 'add' ? ' pos' : '')}>{tx.type === 'add' ? '+' : '−'}{usd(Math.abs(tx.usd))}</div>
        {merchant && <div className="r">{inrRaw(tx.rupees)}</div>}
      </div>
    </button>
  );
}

// ---- Scan ----
function Scan({ S }) {
  const merchants = [{ name: 'Anjuna Beach Cafe' }, { name: 'Auto rickshaw' }, { name: 'Mango Tree Restaurant' }];
  return (
    <React.Fragment>
      <div className="grab" />
      <div className="shead"><h2>Scan &amp; pay</h2><button className="x" onClick={S.close}>×</button></div>
      <div className="sbody">
        <div style={{ flex: '0 0 auto', height: 250, background: '#101316', borderRadius: 18, position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 14 }}>
          {[['t', 'l'], ['t', 'r'], ['b', 'l'], ['b', 'r']].map(([v, h], i) => (
            <div key={i} style={{ position: 'absolute', width: 30, height: 30,
              [v === 't' ? 'top' : 'bottom']: 26, [h === 'l' ? 'left' : 'right']: 26,
              [`border${v === 't' ? 'Top' : 'Bottom'}`]: '3px solid var(--accent)',
              [`border${h === 'l' ? 'Left' : 'Right'}`]: '3px solid var(--accent)',
              borderRadius: h === 'l' ? (v === 't' ? '8px 0 0 0' : '0 0 0 8px') : (v === 't' ? '0 8px 0 0' : '0 0 8px 0') }} />
          ))}
          <div style={{ opacity: .5 }}>{I.qrbig({ size: 54, color: 'rgba(255,255,255,.55)' })}</div>
        </div>
        <div className="lead" style={{ textAlign: 'center', marginBottom: 14 }}>Point at any UPI QR.</div>
        <div className="list">
          {merchants.map((m) => (
            <button className="row" key={m.name} onClick={() => S.payMerchant(m)}>
              <span className="ric qr">{I.qr({ size: 18, color: 'var(--accent)' })}</span>
              <div className="meta"><div className="nm">{m.name}</div></div>
              <span className="chev">{I.chevron({ size: 18, color: 'var(--muted)' })}</span>
            </button>
          ))}
        </div>
      </div>
    </React.Fragment>
  );
}

// ---- Amount (pay) ----
function Amount({ S }) {
  const [d, setD] = React.useState('500');
  const press = (k) => {
    if (k === '⌫') setD((s) => s.slice(0, -1));
    else if (d.length < 6) setD((s) => (s === '0' ? '' : s) + k);
  };
  const rupees = parseInt(d || '0', 10);
  const u = rupees / RATE;
  return (
    <React.Fragment>
      <div className="grab" />
      <div className="shead"><div><div className="eyebrow" style={{ marginBottom: 4 }}>Paying</div><h2 style={{ fontSize: 19 }}>{S.merchant.name}</h2></div><button className="x" onClick={S.close}>×</button></div>
      <div className="sbody">
        <div className="amountbig">
          <div className="big">{inrRaw(rupees)}</div>
          <div className="conv">{usd(u)} from your balance</div>
        </div>
        <Keypad onPress={press} />
        <button className="btn btn-ink" disabled={rupees <= 0} onClick={() => { S.setPayR(rupees); S.open('review'); }}>Review</button>
      </div>
    </React.Fragment>
  );
}

function Keypad({ onPress }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'];
  return (
    <div className="keypad">
      {keys.map((k) => <button key={k} className={k === '⌫' || k === '00' ? 'fn' : ''} onClick={() => onPress(k)}>{k}</button>)}
    </div>
  );
}

// ---- Review ----
function Review({ S }) {
  const u = S.payR / RATE;
  const after = S.bal - u;
  const ok = after >= 0;
  return (
    <React.Fragment>
      <div className="grab" />
      <div className="shead"><h2>Review payment</h2><button className="x" onClick={S.close}>×</button></div>
      <div className="sbody">
        <div className="lead" style={{ marginBottom: 4 }}>Paying {S.merchant.name}. The rate is locked for this payment.</div>
        <div className="mt22"><RateLock variant={S.t.rlc} payUsd={u} getR={S.payR} /></div>
        <div className="kv mt12"><div className="k">Balance after</div><div className="v">{ok ? usd(after) : usd(S.bal)}</div></div>
        <div className="spacer" />
        <div className="cta">
          <button className="btn btn-primary" onClick={() => S.doPay(ok)}>Pay {inrRaw(S.payR)}</button>
          <button className="textlink" onClick={() => S.open('amount')}>Back</button>
        </div>
      </div>
    </React.Fragment>
  );
}

// ---- Success ----
function Success({ S }) {
  const u = S.payR / RATE;
  return (
    <React.Fragment>
      <div className="grab" />
      <div className="shead"><h2>Paid</h2><button className="x" onClick={S.close}>×</button></div>
      <div className="sbody">
        <div className="result">
          <div className="badge ok">{I.check({ size: 30 })}</div>
          <h3>{inrRaw(S.payR)} paid</h3>
          <div className="inst"><span className="dot" />Paid instantly, from your dollars</div>
        </div>
        <div className="mt22"><RateLock variant={S.t.rlc} payUsd={u} getR={S.payR} /></div>
        <div className="spacer" />
        <div className="cta"><button className="btn btn-ink" onClick={S.finishPay}>Done</button></div>
      </div>
    </React.Fragment>
  );
}

// ---- Declined ----
function Declined({ S }) {
  const need = S.payR / RATE;
  return (
    <React.Fragment>
      <div className="grab" />
      <div className="shead"><h2>Payment not sent</h2><button className="x" onClick={S.close}>×</button></div>
      <div className="sbody">
        <div className="result">
          <div className="badge no">{I.xbig({ size: 28 })}</div>
          <h3>{inrRaw(S.payR)} not paid</h3>
        </div>
        <div className="reassure mt22">Your balance did not change.<br />You need <b>{usd(need)}</b> but have <b>{usd(S.bal)}</b>.</div>
        <div className="spacer" />
        <div className="cta">
          <button className="btn btn-primary" onClick={() => S.open('add')}>Add money</button>
          <button className="textlink" onClick={S.close}>Cancel</button>
        </div>
      </div>
    </React.Fragment>
  );
}

window.CORE = { Home, Scan, Amount, Review, Success, Declined, RateLock, TxRow, Keypad };
