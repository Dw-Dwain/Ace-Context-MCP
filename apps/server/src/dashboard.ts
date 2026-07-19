/** Self-contained dashboard page — no build step, no external assets.
 *  ponytail: replace with the Next.js + shadcn app when richer views are needed. */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ACE — Context Engine</title>
<style>
  :root { color-scheme: light dark; --bg:#0b0d12; --panel:#151922; --fg:#e6e9ef; --muted:#8b93a7; --accent:#6ea8fe; --ok:#4ade80; --err:#f87171; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg); color:var(--fg); }
  header { padding:16px 24px; border-bottom:1px solid #222836; display:flex; align-items:baseline; gap:12px; }
  h1 { font-size:16px; margin:0; letter-spacing:.5px; }
  .sub { color:var(--muted); font-size:12px; }
  main { padding:24px; display:grid; gap:24px; max-width:1100px; margin:0 auto; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; }
  .card { background:var(--panel); border:1px solid #222836; border-radius:10px; padding:14px 16px; }
  .card .k { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.6px; }
  .card .v { font-size:24px; margin-top:4px; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid #222836; border-radius:10px; overflow:hidden; }
  th,td { text-align:left; padding:8px 12px; border-bottom:1px solid #1c2230; font-size:12px; }
  th { color:var(--muted); font-weight:500; }
  tr:last-child td { border-bottom:none; }
  .op { color:var(--accent); }
  .hit { color:var(--ok); } .err { color:var(--err); }
  details summary { cursor:pointer; color:var(--muted); }
  pre { margin:6px 0 0; white-space:pre-wrap; word-break:break-word; color:var(--muted); font-size:11px; }
</style>
</head>
<body>
<header><h1>AI CONTEXT ENGINE</h1><span class="sub">live observability · localhost</span></header>
<main>
  <section class="cards" id="cards"></section>
  <section>
    <h2 style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px">Recent requests</h2>
    <table><thead><tr><th>op</th><th>stages</th><th>ms</th><th>cache</th><th>id</th><th>decisions</th></tr></thead>
    <tbody id="rows"></tbody></table>
  </section>
</main>
<script>
async function refresh() {
  try {
    const [traces, metricsText] = await Promise.all([
      fetch('/v1/traces?limit=40').then(r => r.json()),
      fetch('/metrics').then(r => r.text()),
    ]);
    const m = Object.fromEntries(metricsText.split('\\n').filter(l => l && !l.startsWith('#')).map(l => { const i=l.lastIndexOf(' '); return [l.slice(0,i), Number(l.slice(i+1))]; }));
    const total = m['ace_requests_total'] || 0;
    const hits = m['ace_cache_hits_total'] || 0;
    const errs = m['ace_errors_total'] || 0;
    const cards = [
      ['requests', total],
      ['cache hits', hits],
      ['hit rate', total ? Math.round(hits/total*100)+'%' : '—'],
      ['errors', errs],
      ['buffered traces', traces.length],
    ];
    document.getElementById('cards').innerHTML = cards.map(([k,v]) => '<div class="card"><div class="k">'+k+'</div><div class="v">'+v+'</div></div>').join('');
    document.getElementById('rows').innerHTML = traces.map(t =>
      '<tr><td class="op">'+t.op+'</td><td>'+t.stages+'</td><td>'+t.totalMs+'</td>'+
      '<td>'+(t.cacheHit?'<span class="hit">HIT</span>':(t.errored?'<span class="err">ERR</span>':'—'))+'</td>'+
      '<td class="sub">'+t.id.slice(0,8)+'</td>'+
      '<td><details><summary>'+t.decisions.length+'</summary><pre>'+escapeHtml(JSON.stringify(t.decisions,null,2))+'</pre></details></td></tr>'
    ).join('') || '<tr><td colspan="6" class="sub">no requests yet — POST /v1/contexts or /v1/chat</td></tr>';
  } catch (e) { /* server not ready */ }
}
function escapeHtml(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
refresh(); setInterval(refresh, 2000);
</script>
</body>
</html>`;
