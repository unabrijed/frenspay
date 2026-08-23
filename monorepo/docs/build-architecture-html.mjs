// build-architecture-html.mjs — assemble the docs/*.md into one self-contained, print-ready HTML.
// No npm installs: marked + mermaid are loaded from a CDN at view time; this script only concatenates.
// Run:  node docs/build-architecture-html.mjs
// Then: open docs/architecture.html and Print → Save as PDF  (diagrams render in the browser),
//   or: render headlessly with an already-installed Chrome (see docs/README / the build command).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Order matters — README is the cover/index, then the numbered docs.
const FILES = [
  'README.md',
  '01-architecture.md',
  '02-identity-and-onboarding.md',
  '03-custody-money-in-and-confirmation.md',
  '04-p2p-and-contacts.md',
  '05-fees-fx-and-display.md',
  '06-offramp-and-settlement.md',
  '07-admin-and-moderation.md',
  '08-compliance-and-legalities.md',
  '09-data-model.md',
  '10-ops-and-roadmap.md',
  '11-lp-console.md',
  '12-mobile-app.md',
];

const docs = FILES.map((f) => readFileSync(join(here, f), 'utf8'));
// Safe to embed in an inline <script>: JSON-encode, then neutralize any literal </script>.
const payload = JSON.stringify(docs).replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FrensPay — Architecture &amp; Flows</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  const docs = ${payload};
  const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Render fenced \`\`\`mermaid blocks into <div class="mermaid"> (raw text; mermaid reads textContent).
  const renderer = new marked.Renderer();
  const origCode = renderer.code.bind(renderer);
  renderer.code = (code, lang) => {
    const text = typeof code === 'object' ? code.text : code;
    const language = typeof code === 'object' ? code.lang : lang;
    if ((language || '').trim() === 'mermaid') return '<div class="mermaid">' + esc(text) + '</div>';
    return origCode(code, lang);
  };
  marked.setOptions({ renderer, gfm: true });
  const root = document.getElementById('root');
  root.innerHTML = docs
    .map((md) => '<section class="doc">' + marked.parse(md) + '</section>')
    .join('');
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'loose',
    themeVariables: { fontSize: '16px' },                 // flowchart/er label font
    sequence: { actorFontSize: 15, messageFontSize: 14, noteFontSize: 13 },
  });
  // Render each diagram one at a time with mermaid.render (fully awaited per diagram). mermaid.run
  // resolves before all diagrams in this long doc finish rendering, leaving later svgs unsized; the
  // sequential render avoids that. For each, pin an explicit width+height from the rendered viewBox
  // (capped to the text column) so the svg box reserves its true height. Otherwise height:auto lets
  // the browser size svgs lazily, below-the-fold diagrams collapse to the 150px svg default, and
  // their drawing overflows and overlaps the next diagram in the print pass (the "pile").
  const nodes = [...document.querySelectorAll('.mermaid')];
  const COL = 680; // px — fits the on-screen column and the print page width
  const diag = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    try {
      const { svg } = await mermaid.render('mmd-' + i, el.textContent);
      el.innerHTML = svg;
      const s = el.querySelector('svg');
      const vb = ((s && s.getAttribute('viewBox')) || '').split(/\\s+/).map(Number);
      if (s && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        const w = Math.min(vb[2], COL);
        s.style.maxWidth = 'none';
        s.style.width = w + 'px';
        s.style.height = (w * vb[3] / vb[2]) + 'px';
      }
    } catch (e) {
      diag.push('Diagram ' + i + ': ' + String((e && e.message) || e).replace(/\\n/g, ' | '));
    }
  }
  document.body.setAttribute('data-rendered', diag.length === 0 ? 'true' : 'errors:' + diag.length);
  if (diag.length) {
    const pre = document.createElement('pre');
    pre.id = 'diag';
    pre.textContent = diag.join('\\n');
    document.body.appendChild(pre);
  }
</script>
<style>
  :root { --ink:#1a1a1a; --muted:#666; --line:#e2e2e2; --accent:#a6341f; --bg:#fff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font: 15px/1.6 'Hanken Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  #root { max-width: 860px; margin: 0 auto; padding: 48px 32px; }
  section.doc { page-break-before: always; }
  section.doc:first-child { page-break-before: avoid; }
  h1 { font-size: 1.9rem; line-height:1.2; margin: .2em 0 .4em; border-bottom:2px solid var(--accent); padding-bottom:.2em; }
  h2 { font-size: 1.35rem; margin: 1.6em 0 .5em; color:var(--accent); }
  h3 { font-size: 1.08rem; margin: 1.3em 0 .4em; }
  p, li { color: var(--ink); }
  blockquote { margin:1em 0; padding:.4em 1em; border-left:3px solid var(--accent); background:#faf5f3; color:#4a4a4a; }
  code { background:#f4f4f4; padding:.1em .35em; border-radius:4px; font-size:.88em;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { background:#f7f7f7; padding:14px 16px; border-radius:8px; overflow:auto; border:1px solid var(--line); }
  pre code { background:none; padding:0; }
  table { border-collapse:collapse; width:100%; margin:1em 0; font-size:.92em; }
  th, td { border:1px solid var(--line); padding:7px 10px; text-align:left; vertical-align:top; }
  th { background:#f6f1ef; }
  a { color:var(--accent); text-decoration:none; }
  hr { border:none; border-top:1px solid var(--line); margin:2em 0; }
  .mermaid { margin:1.2em 0; text-align:center; }
  .mermaid svg { max-width:100%; height:auto; }
  @media print {
    #root { max-width:none; padding:0 8mm; }
    a { color: var(--ink); }
    pre, table, .mermaid, blockquote { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div id="root">Rendering… (open in a browser; diagrams render client-side)</div>
</body>
</html>
`;

writeFileSync(join(here, 'architecture.html'), html);
console.log('Wrote docs/architecture.html (' + (html.length / 1024).toFixed(0) + ' KB, ' + FILES.length + ' docs).');
