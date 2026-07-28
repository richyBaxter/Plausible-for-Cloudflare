import type { Env } from "./types";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function loginPage(error = false): Response {
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Analytics</title>
<style>${BASE_CSS}
.login{max-width:360px;margin:12vh auto;padding:32px;background:var(--panel);border:1px solid var(--border);border-radius:14px}
.login h1{font-size:20px;margin:0 0 4px}.login p{color:var(--muted);margin:0 0 24px;font-size:14px}
.login input{width:100%;padding:11px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--fg);font-size:15px;margin-bottom:14px}
.login button{width:100%;padding:11px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-weight:600;font-size:15px;cursor:pointer}
.login button:hover{background:var(--accent-hover)}
.err{color:#ef4444;font-size:13px;margin-bottom:12px}</style></head>
<body><div class="login">
<h1>📊 Analytics</h1><p>Enter your dashboard password to continue.</p>
${error ? '<div class="err">Incorrect password. Try again.</div>' : ""}
<form method="POST" action="/login">
<input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" required>
<button type="submit">Sign in</button>
</form></div></body></html>`;
  return htmlResponse(html);
}

export function dashboardPage(env: Env): Response {
  const site = escapeHtml(env.SITE_NAME || env.SITE_DOMAIN || "Analytics");
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${site} · Analytics</title>
<style>${BASE_CSS}${DASH_CSS}</style></head>
<body>
<header class="top">
  <div class="brand"><span class="dot"></span><strong>${site}</strong><span id="live" class="live" title="Current visitors"></span></div>
  <div class="right">
    <select id="period" aria-label="Time period">
      <option value="day">Today</option>
      <option value="7d" selected>Last 7 days</option>
      <option value="30d">Last 30 days</option>
      <option value="month">This month</option>
      <option value="6mo">Last 6 months</option>
      <option value="12mo">Last 12 months</option>
    </select>
    <a class="logout" href="/logout">Sign out</a>
  </div>
</header>

<main>
  <section class="tiles" id="tiles"></section>

  <section class="panel chart-panel">
    <div class="chart-head"><span id="chart-title">Visitors</span></div>
    <div id="chart" class="chart"></div>
  </section>

  <div class="grid">
    <section class="panel">
      <div class="panel-head"><h3>Top Pages</h3><div class="col">Visitors</div></div>
      <div id="pages" class="list"></div>
    </section>
    <section class="panel">
      <div class="panel-head tabs" id="src-tabs">
        <h3 data-prop="source" class="active">Top Sources</h3>
      </div>
      <div id="sources" class="list"></div>
    </section>
    <section class="panel">
      <div class="panel-head tabs" id="loc-tabs">
        <h3 data-prop="country" class="active">Countries</h3>
      </div>
      <div id="locations" class="list"></div>
    </section>
    <section class="panel">
      <div class="panel-head tabs" id="dev-tabs">
        <h3 data-prop="browser" class="active">Browser</h3>
        <h3 data-prop="os">OS</h3>
        <h3 data-prop="device">Device</h3>
      </div>
      <div id="devices" class="list"></div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3>Goals &amp; Custom Events</h3><div class="col">Count</div></div>
      <div id="goals" class="list"></div>
    </section>
  </div>

  <section class="panel" id="funnels-panel">
    <div class="panel-head">
      <h3>Funnels</h3>
      <button id="funnel-add-toggle" class="mini-btn" type="button">+ New funnel</button>
    </div>
    <form id="funnel-form" class="funnel-form" hidden>
      <input id="funnel-name" placeholder="Funnel name (e.g. Signup flow)" required>
      <input id="funnel-steps" placeholder="Steps, comma-separated: /pricing, /signup, Signup" required>
      <button type="submit">Save</button>
    </form>
    <div id="funnels" class="funnels"></div>
  </section>

  <footer class="foot">Powered by <a href="https://github.com/richybaxter/plausible-for-cloudflare">Insights</a> · privacy-friendly, cookieless analytics on the Cloudflare edge · <a href="/mcp" title="Model Context Protocol endpoint for AI clients">MCP</a></footer>
</main>
<script>${DASH_JS}</script>
</body></html>`;
  return htmlResponse(html);
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

// --------------------------------------------------------------------------- //

const BASE_CSS = `
:root{--bg:#f6f7f9;--panel:#fff;--fg:#1a1a2e;--muted:#71717a;--border:#e5e7eb;--accent:#6366f1;--accent-hover:#4f46e5;--bar:#e0e7ff;--bar-strong:#6366f1}
@media (prefers-color-scheme:dark){:root{--bg:#101014;--panel:#18181d;--fg:#ececf1;--muted:#8b8b96;--border:#26262e;--accent:#818cf8;--accent-hover:#6366f1;--bar:#26264a;--bar-strong:#818cf8}}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--fg);-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}`;

const DASH_CSS = `
.top{display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:var(--panel);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10}
.brand{display:flex;align-items:center;gap:10px;font-size:16px}
.brand .dot{width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.2)}
.live{font-size:13px;color:var(--muted);padding-left:8px;border-left:1px solid var(--border)}
.right{display:flex;align-items:center;gap:14px}
select{padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--fg);font-size:14px;cursor:pointer}
.logout{font-size:13px;color:var(--muted)}
main{max-width:1080px;margin:0 auto;padding:24px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--border);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:20px}
.tile{background:var(--panel);padding:16px 20px}
.tile .k{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.tile .v{font-size:26px;font-weight:700;margin-top:4px}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:20px}
.chart-panel{padding-bottom:8px}
.chart-head{font-size:13px;color:var(--muted);margin-bottom:8px}
.chart{height:220px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:720px){.grid{grid-template-columns:1fr}}
.panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.panel-head h3{font-size:14px;margin:0;font-weight:600}
.panel-head .col{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.tabs{gap:16px;justify-content:flex-start}
.tabs h3{color:var(--muted);cursor:pointer;font-weight:500}
.tabs h3.active{color:var(--fg);font-weight:600}
.list{display:flex;flex-direction:column;gap:2px;min-height:60px}
.row{position:relative;display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-radius:6px;font-size:14px;overflow:hidden}
.row .bg{position:absolute;left:0;top:0;bottom:0;background:var(--bar);border-radius:6px;z-index:0}
.row .label,.row .val{position:relative;z-index:1}
.row .label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:78%}
.row .val{font-variant-numeric:tabular-nums;color:var(--muted);font-weight:600}
.empty{color:var(--muted);font-size:13px;padding:18px 10px;text-align:center}
.delta{font-size:12px;font-weight:600;margin-left:6px;vertical-align:middle}
.delta.up{color:#22c55e}.delta.down{color:#ef4444}.delta.flat{color:var(--muted)}
.mini-btn{font-size:12px;padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);cursor:pointer}
.mini-btn:hover{border-color:var(--accent)}
.funnel-form{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.funnel-form input{flex:1;min-width:180px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px}
.funnel-form button{padding:8px 14px;border:0;border-radius:6px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}
.funnels{display:flex;flex-direction:column;gap:20px}
.funnel-title{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600;margin-bottom:8px}
.funnel-title .del{font-size:12px;color:var(--muted);cursor:pointer;font-weight:400}
.funnel-title .del:hover{color:#ef4444}
.fstep{position:relative;display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:6px;overflow:hidden;font-size:13px;margin-bottom:3px}
.fstep .bg{position:absolute;left:0;top:0;bottom:0;background:var(--bar);z-index:0}
.fstep .l,.fstep .r{position:relative;z-index:1}
.fstep .l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%}
.fstep .r{color:var(--muted);font-variant-numeric:tabular-nums}
.fstep .conv{color:var(--accent);font-weight:600;margin-left:8px}
.foot{text-align:center;color:var(--muted);font-size:12px;margin:8px 0 24px}
.svgbar rect.bar{fill:var(--bar-strong);transition:opacity .15s}.svgbar rect.bar:hover{opacity:.75}
.svgbar text{fill:var(--muted);font-size:10px}
.svgbar line{stroke:var(--border)}`;

const DASH_JS = `
const $ = s => document.querySelector(s);
const fmt = n => n>=1000000?(n/1000000).toFixed(1)+'M':n>=1000?(n/1000).toFixed(1)+'k':String(n);
const dur = s => { s=Math.round(s||0); if(s<60)return s+'s'; const m=Math.floor(s/60); return m+'m '+(s%60)+'s'; };
let period = '7d';

async function api(path){ const r = await fetch(path,{credentials:'same-origin'}); if(r.status===401){location.href='/login';return null;} return r.json(); }

function tile(k,v,delta,inverse){
  return '<div class="tile"><div class="k">'+k+'</div><div class="v">'+v+deltaBadge(delta,inverse)+'</div></div>';
}
function deltaBadge(d,inverse){
  if(d===null||d===undefined) return '';
  if(d===0) return ' <span class="delta flat">0%</span>';
  var better = (d>0) !== !!inverse; // inverse metrics (bounce rate) are better when down
  var arrow = d>0 ? '▲' : '▼';
  return ' <span class="delta '+(better?'up':'down')+'">'+arrow+Math.abs(d)+'%</span>';
}

async function loadTiles(){
  const a = await api('/api/stats/compare?period='+period); if(!a)return;
  const c=a.current, ch=a.change;
  $('#tiles').innerHTML =
    tile('Unique visitors', fmt(c.visitors), ch.visitors) +
    tile('Total pageviews', fmt(c.pageviews), ch.pageviews) +
    tile('Visits', fmt(c.visits), ch.visits) +
    tile('Bounce rate', (c.bounce_rate||0)+'%', ch.bounce_rate, true) +
    tile('Visit duration', dur(c.visit_duration), ch.visit_duration);
}

async function loadFunnels(){
  const defs = await api('/api/funnels'); if(!defs)return;
  if(!defs.length){ $('#funnels').innerHTML='<div class="empty">No funnels yet. Create one to track conversion across pages and goals.</div>'; return; }
  const parts = await Promise.all(defs.map(async function(d){
    const f = await api('/api/stats/funnel?name='+encodeURIComponent(d.name)+'&period='+period);
    return renderFunnel(d, f);
  }));
  $('#funnels').innerHTML = parts.join('');
  document.querySelectorAll('#funnels .del').forEach(function(el){
    el.addEventListener('click', function(){ deleteFunnel(el.dataset.id); });
  });
}
function renderFunnel(def, f){
  if(!f || !f.steps){ return '<div class="funnel"><div class="funnel-title"><span>'+esc(def.name)+'</span></div><div class="empty">No data</div></div>'; }
  const top = Math.max(f.entered||0, 1);
  const steps = f.steps.map(function(s){
    const w = Math.max(2, Math.round((s.visitors/top)*100));
    return '<div class="fstep"><span class="bg" style="width:'+w+'%"></span>'+
      '<span class="l" title="'+esc(s.step)+'">'+esc(s.step)+'</span>'+
      '<span class="r">'+fmt(s.visitors)+' <span class="conv">'+s.conversion_rate+'%</span></span></div>';
  }).join('');
  return '<div class="funnel"><div class="funnel-title"><span>'+esc(def.name)+'</span>'+
    '<span class="del" data-id="'+def.id+'">delete</span></div>'+steps+'</div>';
}
async function deleteFunnel(id){
  await fetch('/api/funnels?id='+id,{method:'DELETE',credentials:'same-origin'});
  loadFunnels();
}

async function loadLive(){ const c = await api('/api/stats/current'); if(c) $('#live').textContent = c.visitors+' current visitor'+(c.visitors===1?'':'s'); }

function rows(el, items, key, max){
  if(!items || !items.length){ el.innerHTML = '<div class="empty">No data for this period</div>'; return; }
  const top = Math.max.apply(null, items.map(i=>i[key]||0)) || 1;
  el.innerHTML = items.map(function(i){
    const w = Math.max(2, Math.round(((i[key]||0)/top)*100));
    const name = (i.name===null||i.name===undefined||i.name==='') ? 'Direct' : i.name;
    return '<div class="row"><span class="bg" style="width:'+w+'%"></span>'+
           '<span class="label" title="'+esc(name)+'">'+esc(name)+'</span>'+
           '<span class="val">'+fmt(i[key]||0)+'</span></div>';
  }).join('');
}
function esc(s){ s=String(s); return s.replace(/[&<>"\\u0027]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

async function loadBreakdown(prop, el, key){
  const d = await api('/api/stats/breakdown?property='+prop+'&period='+period+'&limit=9'); if(!d)return;
  rows(el, d.results, key||'visitors');
}

async function loadChart(){
  const d = await api('/api/stats/timeseries?period='+period); if(!d)return;
  const s = d.series, W=1000, H=200, pad=24;
  const max = Math.max.apply(null, s.map(p=>p.visitors)) || 1;
  const bw = (W-pad*2)/s.length;
  let bars='', labels='';
  s.forEach(function(p,i){
    const h = Math.round((p.visitors/max)*(H-pad*2));
    const x = pad + i*bw, y = H-pad-h;
    bars += '<rect class="bar" x="'+(x+bw*0.15)+'" y="'+y+'" width="'+(bw*0.7)+'" height="'+Math.max(h,0)+'" rx="2"><title>'+esc(fmtLabel(p.date,d.interval))+': '+p.visitors+' visitors, '+p.pageviews+' pageviews</title></rect>';
    if(i % Math.ceil(s.length/8||1) === 0){ labels += '<text x="'+(x+bw/2)+'" y="'+(H-6)+'" text-anchor="middle">'+esc(shortLabel(p.date,d.interval))+'</text>'; }
  });
  $('#chart').innerHTML = '<svg class="svgbar" viewBox="0 0 '+W+' '+H+'" width="100%" height="100%" preserveAspectRatio="none">'+
    '<line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'"/>'+bars+labels+'</svg>';
}
function fmtLabel(d,iv){ return d; }
function shortLabel(d,iv){ if(iv==='hour')return d.slice(11,16); if(iv==='month')return d; return d.slice(5); }

function wireTabs(id, el){
  document.querySelectorAll('#'+id+' h3').forEach(function(h){
    h.addEventListener('click', function(){
      document.querySelectorAll('#'+id+' h3').forEach(x=>x.classList.remove('active'));
      h.classList.add('active');
      loadBreakdown(h.dataset.prop, el, 'visitors');
    });
  });
}

async function refresh(){
  await Promise.all([
    loadTiles(), loadChart(), loadLive(),
    loadBreakdown('page', $('#pages'), 'visitors'),
    loadBreakdown(document.querySelector('#src-tabs h3.active').dataset.prop, $('#sources')),
    loadBreakdown(document.querySelector('#loc-tabs h3.active').dataset.prop, $('#locations')),
    loadBreakdown(document.querySelector('#dev-tabs h3.active').dataset.prop, $('#devices')),
    loadBreakdown('goal', $('#goals'), 'visitors'),
    loadFunnels()
  ]);
}

$('#period').addEventListener('change', function(e){ period = e.target.value; refresh(); });
wireTabs('src-tabs', $('#sources'));
wireTabs('loc-tabs', $('#locations'));
wireTabs('dev-tabs', $('#devices'));

$('#funnel-add-toggle').addEventListener('click', function(){ const f=$('#funnel-form'); f.hidden=!f.hidden; if(!f.hidden) $('#funnel-name').focus(); });
$('#funnel-form').addEventListener('submit', async function(e){
  e.preventDefault();
  const name = $('#funnel-name').value.trim();
  const steps = $('#funnel-steps').value.split(',').map(function(s){return s.trim();}).filter(Boolean);
  const r = await fetch('/api/funnels',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({name:name,steps:steps})});
  if(r.ok){ $('#funnel-name').value=''; $('#funnel-steps').value=''; $('#funnel-form').hidden=true; loadFunnels(); }
  else { const er = await r.json().catch(function(){return {error:'failed'};}); alert(er.error||'Failed to save funnel'); }
});

refresh();
setInterval(loadLive, 15000);`;
