// app.jsx — controller, phone frame, router, nav, tweaks
const { StatusBar, RATE: ARATE, usd: ausd, inrRaw: ainrRaw, inr: ainr, I: AI } = window.UI;
const { Home, Scan, Amount, Review, Success, Declined } = window.CORE;
const { AddMoney, Activity, Detail, Send, SendAmount, Request, Settings } = window.MORE;
const { Welcome, FaceID, Handle, FundFirst, Recovery, Verify, ORDER: ONB_ORDER } = window.ONB;

const RLC = { Columns: 'A', Stacked: 'B', Receipt: 'C' };
const FULL = ['detail', 'settings'];
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "homeCur": "INR",
  "rlc": "Columns",
  "accent": "#0E7A63"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [bal, setBal] = React.useState(420);
  const [tab, setTab] = React.useState('home');
  const [sheet, setSheet] = React.useState(null);
  const [closing, setClosing] = React.useState(false);
  const [merchant, setMerchant] = React.useState({ name: 'Anjuna Beach Cafe' });
  const [friend, setFriend] = React.useState({ name: 'Neha R.', handle: '@neha', ini: 'N' });
  const [payR, setPayR] = React.useState(500);
  const [detail, setDetail] = React.useState(null);
  const [onb, setOnb] = React.useState(null);
  const [kyc, setKyc] = React.useState(false);
  const [recovered, setRecovered] = React.useState(false);
  const [pendingPay, setPendingPay] = React.useState(false);
  const recoveryPromptedRef = React.useRef(false);
  const closingRef = React.useRef(null);
  const [lastSend, setLastSend] = React.useState({ u: 12, handle: '@neha' });
  const [txns, setTxns] = React.useState([
    { id: 1, type: 'pay', title: 'Anjuna Beach Cafe', time: 'Today · 09:24', usd: -5.71, rupees: 500 },
    { id: 2, type: 'send', title: 'To @neha', time: 'Yesterday', usd: -12.0 },
    { id: 3, type: 'add', title: 'Added money', time: '12 Jun', usd: 200.0 },
  ]);

  // apply accent token
  React.useEffect(() => { document.documentElement.style.setProperty('--accent', t.accent); }, [t.accent]);

  // phone scaling
  React.useEffect(() => {
    const fit = () => {
      const s = Math.min(1, (window.innerHeight - 36) / 844, (window.innerWidth - 36) / 390);
      const el = document.getElementById('scaler');
      if (el) el.style.transform = `scale(${s})`;
    };
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // first-run onboarding
  React.useEffect(() => { try { if (!localStorage.getItem('pay.onboarded')) setOnb(0); } catch (e) {} }, []);

  const open = (id) => {
    if (closingRef.current) { clearTimeout(closingRef.current); closingRef.current = null; }
    setClosing(false);
    setSheet(id);
  };
  const close = () => {
    setClosing(true);
    closingRef.current = setTimeout(() => {
      setSheet(null); setDetail(null); setClosing(false); closingRef.current = null;
    }, 300);
  };
  const goTab = (x) => {
    if (closingRef.current) { clearTimeout(closingRef.current); closingRef.current = null; }
    setSheet(null); setClosing(false); setTab(x);
  };

  const openDetail = (tx) => { setDetail(tx); open('detail'); };

  // onboarding + just-in-time identity
  const onbNext = () => setOnb((i) => Math.min((i ?? 0) + 1, ONB_ORDER.length - 1));
  const onbBack = () => setOnb((i) => (i > 0 ? i - 1 : i));
  const onbFinish = () => { try { localStorage.setItem('pay.onboarded', '1'); } catch (e) {} setOnb(null); setTab('home'); };
  const replayOnboarding = () => { setSheet(null); setClosing(false); setOnb(0); };
  const payMerchant = (m) => { setMerchant(m); if (kyc) { open('amount'); } else { setPendingPay(true); open('verify'); } };
  const verifyDone = () => { setKyc(true); if (pendingPay) { setPendingPay(false); open('amount'); } else { close(); } };
  const recoveryDone = () => { setRecovered(true); close(); };
  const finishPay = () => { if (!recovered && !recoveryPromptedRef.current) { recoveryPromptedRef.current = true; open('recovery'); } else { close(); } };

  const doPay = (ok) => {
    if (!ok) { open('declined'); return; }
    const u = payR / RATE_;
    setBal((b) => +(b - u).toFixed(2));
    setTxns((ts) => [{ id: Date.now(), type: 'pay', title: merchant.name, time: 'Just now', usd: -u, rupees: payR }, ...ts]);
    open('success');
  };
  const RATE_ = ARATE;
  const doSend = (u) => {
    setBal((b) => +(b - u).toFixed(2));
    setTxns((ts) => [{ id: Date.now(), type: 'send', title: 'To ' + friend.handle, time: 'Just now', usd: -u }, ...ts]);
    setLastSend({ u, handle: friend.handle });
    open('sent');
  };
  const doAdd = (amt) => {
    setBal((b) => +(b + amt).toFixed(2));
    setTxns((ts) => [{ id: Date.now(), type: 'add', title: 'Added money', time: 'Just now', usd: amt }, ...ts]);
    close();
  };

  const S = {
    bal, t: { ...t, rlc: RLC[t.rlc] || 'A', homeCur: t.homeCur },
    open, close, setTab: goTab,
    merchant, setMerchant, payR, setPayR,
    friend, setFriend, doPay, doSend, doAdd,
    openDetail, detail, txns, lastSend,
    payMerchant, pendingPay, verifyDone, recoveryDone, finishPay,
    onbNext, onbBack, onbFinish, replayOnboarding,
  };

  const isFull = FULL.includes(sheet);
  const isSheet = sheet && !isFull;
  const tall = ['scan', 'amount', 'review', 'success', 'declined', 'send', 'sendAmount', 'request', 'sent', 'verify', 'recovery'].includes(sheet);

  const sheetEl = () => {
    switch (sheet) {
      case 'scan': return <Scan S={S} />;
      case 'amount': return <Amount S={S} />;
      case 'review': return <Review S={S} />;
      case 'success': return <Success S={S} />;
      case 'declined': return <Declined S={S} />;
      case 'add': return <AddMoney S={S} />;
      case 'send': return <Send S={S} />;
      case 'sendAmount': return <SendAmount S={S} />;
      case 'request': return <Request S={S} />;
      case 'sent': return <Sent S={S} />;
      case 'verify': return <Verify S={S} />;
      case 'recovery': return <Recovery S={S} />;
      default: return null;
    }
  };

  return (
    <div id="stage">
      <div id="scaler">
        <div className="phone">
          <StatusBar />
          {tab === 'home' ? <div className="screen"><Home S={S} /></div> : <div className="screen"><Activity S={S} /></div>}

          <div className="nav">
            <button className={'it' + (tab === 'home' ? ' on' : '')} onClick={() => goTab('home')}>
              {AI.home({ size: 22, color: tab === 'home' ? 'var(--accent)' : 'var(--muted)' })}<span>Home</span>
            </button>
            <button className="pay" onClick={() => open('scan')}>
              <span className="btn">{AI.qrbig({ size: 26 })}</span><span>Pay</span>
            </button>
            <button className={'it' + (tab === 'activity' ? ' on' : '')} onClick={() => goTab('activity')}>
              {AI.activity({ size: 22, color: tab === 'activity' ? 'var(--accent)' : 'var(--muted)' })}<span>Activity</span>
            </button>
          </div>

          {/* sheet layer */}
          {isSheet && <div className={'scrim' + (closing ? ' exit' : '')} onClick={close} />}
          {isSheet && (
            <div className={'sheet' + (tall ? ' tall' : '') + (closing ? ' exit' : '')} onClick={(e) => e.stopPropagation()}>
              {sheetEl()}
            </div>
          )}

          {/* full overlay layer */}
          {isFull && (
            <div className={'overlayfull' + (closing ? ' exit' : '')}>
              <StatusBar />
              {sheet === 'detail' ? <Detail S={S} /> : <Settings S={S} />}
            </div>
          )}

          {/* onboarding overlay (top) */}
          {onb != null && (
            <div className="overlayfull onboverlay">
              <StatusBar />
              {ONB_ORDER[onb] === 'welcome' ? <Welcome S={S} />
                : ONB_ORDER[onb] === 'faceid' ? <FaceID S={S} />
                : ONB_ORDER[onb] === 'handle' ? <Handle S={S} />
                : <FundFirst S={S} />}
            </div>
          )}
        </div>
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Home hero" />
        <TweakRadio label="Currency leads" value={t.homeCur} options={['INR', 'USD', 'Flip']}
          onChange={(v) => setTweak('homeCur', v)} />
        <TweakSection label="Rate-lock card" />
        <TweakRadio label="Style" value={t.rlc} options={['Columns', 'Stacked', 'Receipt']}
          onChange={(v) => setTweak('rlc', v)} />
        <TweakSection label="Brand" />
        <TweakColor label="Accent" value={t.accent}
          options={['#0E7A63', '#4F46E5', '#0F766E', '#B45309']}
          onChange={(v) => setTweak('accent', v)} />
      </TweaksPanel>
    </div>
  );
}

// send confirmation
function Sent({ S }) {
  return (
    <React.Fragment>
      <div className="grab" />
      <div className="shead"><h2>Sent</h2><button className="x" onClick={S.close}>×</button></div>
      <div className="sbody">
        <div className="result">
          <div className="badge ok">{AI.check({ size: 30 })}</div>
          <h3>${S.lastSend.u} sent</h3>
          <div className="reassure" style={{ color: 'var(--muted)' }}>To {S.lastSend.handle} · ~ {ainr(S.lastSend.u)}</div>
        </div>
        <div className="spacer" />
        <div className="cta"><button className="btn btn-ink" onClick={S.close}>Done</button></div>
      </div>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
