// screens-more.jsx — money, friends, settings (exported to window.MORE)
const { I: MI, RATE: MRATE, inr: minr, usd: musd, inrRaw: minrRaw } = window.UI;
const { TxRow: MTxRow, Keypad: MKeypad, RateLock: MRateLock } = window.CORE;

// ---- Add money ----
function AddMoney({ S }) {
  const [amt, setAmt] = React.useState(100);
  const chips = [50, 100, 250];
  return (
    <React.Fragment>
      <div className="grab" />
      <div className="shead"><h2>Add money</h2><button className="x" onClick={S.close}>×</button></div>
      <div className="sbody">
        <div className="lead">Top up your dollar balance.</div>
        <div className="chips mt16">
          {chips.map((v) => <button key={v} className={'chip' + (amt === v ? ' on' : '')} onClick={() => setAmt(v)}>${v}</button>)}
        </div>
        <div className="field mt12"><span className="ph">$</span><span style={{ color: 'var(--ink)' }}>{amt}</span></div>
        <button className="btn btn-primary mt16" onClick={() => S.doAdd(amt)}>Add ${amt}</button>
        <div className="eyebrow mt22" style={{ marginBottom: 10 }}>Or deposit USDC</div>
        <div className="list">
          <div className="row" style={{ cursor: 'default' }}>
            <span className="ric qr">{MI.qr({ size: 18, color: 'var(--accent)' })}</span>
            <div className="meta"><div className="nm" style={{ fontFamily: 'var(--mono)', fontSize: 14 }}>7xBn…mK4q</div></div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontWeight: 500, fontSize: 14 }}>
              {MI.copy({ size: 16, color: 'var(--accent)', stroke: 1.6 })} Copy</span>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}

// ---- Activity (full tab) ----
function Activity({ S }) {
  const [f, setF] = React.useState('All');
  const filters = ['All', 'Payments', 'Friends'];
  const shown = S.txns.filter((t) => f === 'All' ? true : f === 'Payments' ? t.type === 'pay' : t.type !== 'pay');
  return (
    <div className="scroll">
      <div className="fhead" style={{ paddingTop: 4 }}><div className="h2">Activity</div></div>
      <div className="filters">
        {filters.map((x) => <button key={x} className={'f' + (f === x ? ' on' : '')} onClick={() => setF(x)}>{x}</button>)}
      </div>
      <div className="daylabel" style={{ marginTop: 4 }}>Today</div>
      <div className="list">
        {shown.map((tx) => <MTxRow key={tx.id} tx={tx} onClick={() => S.openDetail(tx)} />)}
      </div>
      <div className="spacer" />
    </div>
  );
}

// ---- Transaction detail (full screen) ----
function Detail({ S }) {
  const tx = S.detail || S.txns[0];
  const merchant = tx.type === 'pay';
  return (
    <div className="screen" style={{ background: 'var(--canvas)' }}>
      <div className="scroll">
        <div className="fhead"><button className="bk" onClick={S.close}>{MI.back({ size: 18 })}</button></div>
        <div className="result" style={{ paddingTop: 2 }}>
          <div className={'badge ' + (tx.type === 'add' ? 'ok' : merchant ? 'ok' : 'no')}>
            {tx.type === 'add' ? MI.plus({ size: 26, color: 'var(--accent)' }) : merchant ? MI.check({ size: 30 }) : MI.send({ size: 24, color: 'var(--muted)' })}
          </div>
          <h3>{merchant ? minrRaw(tx.rupees) : musd(Math.abs(tx.usd))}</h3>
          <div className="reassure" style={{ color: 'var(--muted)' }}>{tx.title}</div>
        </div>
        {merchant && <div className="mt22"><MRateLock variant={S.t.rlc} payUsd={Math.abs(tx.usd)} getR={tx.rupees} /></div>}
        <div className="list mt16">
          <div className="row" style={{ cursor: 'default' }}><div className="meta"><div className="nm" style={{ color: 'var(--muted)', fontWeight: 400 }}>Status</div></div><div className="amt"><div className="d" style={{ color: 'var(--accent)' }}>{tx.type === 'add' ? 'Added' : 'Paid'}</div></div></div>
          <div className="row" style={{ cursor: 'default' }}><div className="meta"><div className="nm" style={{ color: 'var(--muted)', fontWeight: 400 }}>{tx.type === 'add' ? 'Method' : 'Paid from'}</div></div><div className="amt"><div className="d">{tx.type === 'add' ? 'Apple Pay' : musd(Math.abs(tx.usd))}</div></div></div>
          <div className="row" style={{ cursor: 'default' }}><div className="meta"><div className="nm" style={{ color: 'var(--muted)', fontWeight: 400 }}>Date</div></div><div className="amt"><div className="d">14 Jun, 09:24</div></div></div>
          <div className="row" style={{ cursor: 'default' }}><div className="meta"><div className="nm" style={{ color: 'var(--muted)', fontWeight: 400 }}>Reference</div></div><div className="amt"><div className="d">#577665</div></div></div>
        </div>
        <div className="spacer" />
        <div className="cta" style={{ paddingBottom: 20 }}><button className="btn btn-secondary" onClick={S.close}>Share receipt</button></div>
      </div>
    </div>
  );
}

// ---- Send: pick a friend ----
const FRIENDS = [
  { name: 'Neha R.', handle: '@neha', ini: 'N' },
  { name: 'Arjun M.', handle: '@arjun', ini: 'A' },
  { name: 'Sam K.', handle: '@sam', ini: 'S' },
  { name: 'Priya V.', handle: '@priya', ini: 'P' },
];
function Send({ S }) {
  return (
    <React.Fragment>
      <div className="grab" />
      <div className="shead"><h2>Send to a friend</h2><button className="x" onClick={S.close}>×</button></div>
      <div className="sbody">
        <div className="search">{MI.search({ size: 18, color: 'var(--muted)', stroke: 1.6 })}<span>Search a name or @handle</span></div>
        <div className="list">
          {FRIENDS.map((fr) => (
            <button className="row" key={fr.handle} onClick={() => { S.setFriend(fr); S.open('sendAmount'); }}>
              <span className="fav">{fr.ini}</span>
              <div className="meta"><div className="nm">{fr.name}</div><div className="hd">{fr.handle}</div></div>
              <span className="chev">{MI.chevron({ size: 18, color: 'var(--muted)' })}</span>
            </button>
          ))}
        </div>
      </div>
    </React.Fragment>
  );
}

// ---- Send amount ----
function SendAmount({ S }) {
  const [d, setD] = React.useState('12');
  const press = (k) => {
    if (k === '⌫') setD((s) => s.slice(0, -1));
    else if (k === '00') setD((s) => (s === '0' || s === '' ? s : s + '00'));
    else if (d.length < 5) setD((s) => (s === '0' ? '' : s) + k);
  };
  const u = parseInt(d || '0', 10);
  const ok = u > 0 && u <= S.bal;
  return (
    <React.Fragment>
      <div className="grab" />
      <div className="shead"><div><div className="eyebrow" style={{ marginBottom: 4 }}>Sending to</div><h2 style={{ fontSize: 19 }}>{S.friend.handle}</h2></div><button className="x" onClick={S.close}>×</button></div>
      <div className="sbody">
        <div className="amountbig">
          <div className="big">${u}</div>
          <div className="conv">~ {minr(u)}</div>
        </div>
        <MKeypad onPress={press} />
        <button className="btn btn-primary" disabled={!ok} onClick={() => S.doSend(u)}>Send ${u}</button>
      </div>
    </React.Fragment>
  );
}

// ---- Request money ----
function Request({ S }) {
  const [d, setD] = React.useState('20');
  const press = (k) => {
    if (k === '⌫') setD((s) => s.slice(0, -1));
    else if (k === '00') setD((s) => (s === '0' || s === '' ? s : s + '00'));
    else if (d.length < 5) setD((s) => (s === '0' ? '' : s) + k);
  };
  const u = parseInt(d || '0', 10);
  return (
    <React.Fragment>
      <div className="grab" />
      <div className="shead"><h2>Request money</h2><button className="x" onClick={S.close}>×</button></div>
      <div className="sbody">
        <div className="amountbig" style={{ flex: '0 0 auto', padding: '18px 0 10px' }}>
          <div className="big">${u}</div>
          <div className="conv">~ {minr(u)}</div>
        </div>
        <MKeypad onPress={press} />
        <div className="cta">
          <button className="btn btn-primary" disabled={u <= 0} onClick={() => S.open('send')}>Request from a friend</button>
          <button className="btn btn-secondary" onClick={S.close}>Share a payment link</button>
        </div>
      </div>
    </React.Fragment>
  );
}

// ---- Settings ----
function Settings({ S }) {
  const item = (k, v, accent, onClick) => (
    <button className="row" style={{ cursor: 'pointer' }} onClick={onClick}>
      <div className="meta"><div className="nm">{k}</div></div>
      <div className="amt" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="d" style={{ color: accent ? 'var(--accent)' : 'var(--muted)', fontWeight: 400 }}>{v}</span>
        {MI.chevron({ size: 16, color: 'var(--muted)' })}
      </div>
    </button>
  );
  return (
    <div className="screen" style={{ background: 'var(--canvas)' }}>
      <div className="scroll">
        <div className="fhead"><button className="bk" onClick={S.close}>{MI.back({ size: 18 })}</button></div>
        <div className="profile">
          <div className="pa">B</div>
          <div><div className="h">@bridge</div><div className="sub2">Bridge</div></div>
        </div>
        <div className="list">
          {item('Verification', 'Tier 1', false, () => S.open('verify'))}
          {item('Recovery', 'Email set', false, () => S.open('recovery'))}
          {item('Display currency', 'INR', true)}
          {item('Help and support', '')}
        </div>
        <div className="spacer" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', paddingBottom: 20 }}>
          <button className="textlink" onClick={S.replayOnboarding}>Replay onboarding</button>
          <button className="textlink">Log out</button>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>v0.1</div>
        </div>
      </div>
    </div>
  );
}

window.MORE = { AddMoney, Activity, Detail, Send, SendAmount, Request, Settings, FRIENDS };
