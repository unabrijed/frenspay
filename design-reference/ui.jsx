// ui.jsx — shared icons, status bar, helpers (exported to window.UI)
const I = {};
const mk = (paths, vb = 24, opts = {}) => ({ size = 22, stroke = 1.7, fill = 'none', color = 'currentColor', style } = {}) => (
  <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} fill={fill} stroke={fill === 'none' ? color : 'none'}
    strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style} {...opts}>
    {paths}
  </svg>
);

I.plus    = mk(<path d="M12 4v16M4 12h16" />);
I.send    = mk(<path d="M12 20V5M5 12l7-7 7 7" />);
I.request = mk(<path d="M12 4v15M5 12l7 7 7-7" />);
I.chevron = mk(<path d="M9 5l7 7-7 7" />);
I.back    = mk(<path d="M15 5l-7 7 7 7" />);
I.close   = mk(<path d="M6 6l12 12M18 6L6 18" />);
I.home    = mk(<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />);
I.activity= mk(<path d="M4 7h16M4 12h16M4 17h10" />);
I.swap    = mk(<path d="M4 7h13l-3.5-3.5M20 17H7l3.5 3.5" />);
I.mail    = mk(<g><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M4 7l8 6 8-6" /></g>);
I.device  = mk(<g><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 18h2" /></g>);
I.search  = mk(<g><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></g>);
I.copy    = mk(<g><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></g>);
I.shield  = mk(<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />);
I.lockcheck = mk(<path d="M8.5 12.5l2.5 2.5 5-5" />);
I.face    = mk(<g><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><path d="M9 10v1M15 10v1M12 10v3l-1 0M9.5 15s1 1 2.5 1 2.5-1 2.5-1" /></g>);
I.qr = ({ size = 20, color = 'currentColor' } = {}) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke={color} strokeWidth="1.5">
    <rect x="1" y="1" width="6" height="6" rx="1" /><rect x="11" y="1" width="6" height="6" rx="1" />
    <rect x="1" y="11" width="6" height="6" rx="1" />
    <path d="M11 11h2v2M15 11v6M11 15h2v2" strokeLinecap="round" />
  </svg>
);
I.qrbig = ({ size = 26, color = '#fff' } = {}) => (
  <svg width={size} height={size} viewBox="0 0 26 26" fill="none" stroke={color} strokeWidth="1.9">
    <rect x="2.5" y="2.5" width="8" height="8" rx="1.5" /><rect x="15.5" y="2.5" width="8" height="8" rx="1.5" />
    <rect x="2.5" y="15.5" width="8" height="8" rx="1.5" />
    <path d="M15.5 15.5h3.5v3.5M23 15.5v8M15.5 23h3.5" strokeLinecap="round" />
  </svg>
);
I.check = ({ size = 30, color = 'var(--accent)' } = {}) => (
  <svg width={size} height={size} viewBox="0 0 30 30" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 15.5l4.5 4.5L22 10" />
  </svg>
);
I.xbig = ({ size = 28, color = 'var(--muted)' } = {}) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round">
    <path d="M9 9l10 10M19 9L9 19" />
  </svg>
);

function StatusBar() {
  return (
    <div className="status">
      <div className="t">9:41</div>
      <div className="sys">
        <svg width="18" height="11" viewBox="0 0 18 11" fill="none"><rect x="0" y="6" width="3" height="5" rx="1" fill="#16181C"/><rect x="5" y="4" width="3" height="7" rx="1" fill="#16181C"/><rect x="10" y="2" width="3" height="9" rx="1" fill="#16181C"/><rect x="15" y="0" width="3" height="11" rx="1" fill="#16181C"/></svg>
        <svg width="22" height="11" viewBox="0 0 22 11" fill="none"><rect x="1" y="1" width="18" height="9" rx="2.5" stroke="#16181C" strokeOpacity=".4"/><rect x="2.5" y="2.5" width="13" height="6" rx="1.2" fill="#16181C"/><rect x="20" y="3.5" width="1.6" height="4" rx="0.8" fill="#16181C" fillOpacity=".4"/></svg>
      </div>
    </div>
  );
}

// money formatting
const RATE = 87.55;
const inr = (usd) => '₹' + Math.round(usd * RATE).toLocaleString('en-IN');
const usd = (n) => '$' + n.toFixed(2);
const inrRaw = (rupees) => '₹' + Math.round(rupees).toLocaleString('en-IN');

window.UI = { I, StatusBar, RATE, inr, usd, inrRaw };
