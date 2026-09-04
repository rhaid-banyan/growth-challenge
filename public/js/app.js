/* Shared front-end helpers: API client, header/footer, formatting. */
(function () {
  'use strict';

  const GC = (window.GC = window.GC || {});

  // ---------- API ----------
  GC.api = async function (method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (res.status === 401 && data && data.gate && location.pathname !== '/gate') { location.href = '/gate?next=' + encodeURIComponent(location.pathname + location.search); return new Promise(() => {}); }
    if (!res.ok) { const err = new Error((data && data.error) || res.statusText || 'Request failed'); err.status = res.status; throw err; }
    return data;
  };
  GC.get = (u) => GC.api('GET', u);

  // ---------- formatting ----------
  GC.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  GC.money = (n, cur) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '-';
    const sym = { USD: '$', CAD: 'CA$', NZD: 'NZ$', AUD: 'A$', BRL: 'R$', GBP: '£', EUR: '€' }[cur || 'USD'] || '';
    return sym + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };
  GC.usd = (n) => (n === null || n === undefined || n === '' ? '-' : GC.money(n, 'USD'));
  GC.usdShort = (n) => { const v = Number(n); if (!Number.isFinite(v)) return '-'; if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 2).replace(/\.?0+$/, '') + 'M'; if (Math.abs(v) >= 1e3) return '$' + Math.round(v / 1e3) + 'K'; return '$' + v; };
  GC.date = (iso, opts, tz) => { if (!iso) return '-'; const d = new Date(iso); const o = Object.assign({}, opts || { month: 'short', day: 'numeric', year: 'numeric' }); if (tz) o.timeZone = tz; return d.toLocaleDateString('en-US', o); };
  GC.dateTime = (iso) => { if (!iso) return '-'; const d = new Date(iso); return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  GC.score = (v) => (v === null || v === undefined || v === '' ? null : Number(v).toFixed(1));
  GC.initials = (name) => String(name || '?').split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  GC.words = (s) => (String(s || '').trim().match(/\S+/g) || []).length;
  GC.plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  GC.stageLabel = (s) => ({ round1: 'Round 1', round2: 'Round 2', round3: 'Round 3', funded: 'Funded', eliminated: 'Eliminated', withdrawn: 'Withdrawn' }[s] || s);

  GC.toast = function (msg, isErr) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.toggle('err', !!isErr); t.classList.add('show');
    clearTimeout(GC._toastT); GC._toastT = setTimeout(() => t.classList.remove('show'), 3200);
  };

  GC.qs = (k) => new URLSearchParams(location.search).get(k);

  // ---------- icons (lucide-style, thin stroke, Banyan icon rules) ----------
  const I = (paths, size = 24) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  GC.icons = {
    lock: I('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
    arrowRight: I('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
    arrowLeft: I('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'),
    sparkles: I('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>'),
    calendar: I('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>'),
    fileText: I('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
    trending: I('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'),
    target: I('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
    users: I('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    check: I('<path d="M20 6 9 17l-5-5"/>'),
    checkCircle: I('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
    clock: I('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    edit: I('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
    download: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'),
    settings: I('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
    dollar: I('<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
    globe: I('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
    layers: I('<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'),
    eyeOff: I('<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>'),
    lightbulb: I('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'),
    x: I('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    externalLink: I('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    pen: I('<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>'),
  };

  // ---------- header / footer ----------
  GC.session = null; // { user, roles }

  GC.loadSession = async function () {
    try { GC.session = await GC.get('/api/me'); } catch { GC.session = { user: null, roles: {} }; }
    return GC.session;
  };

  GC.roleLabel = function (s) {
    if (!s || !s.user) return '';
    const r = s.roles || {};
    const parts = [];
    if (r.isAdmin) parts.push('Challenge Admin');
    if (r.raterRounds && r.raterRounds.length) parts.push('Rater · R' + r.raterRounds.join(', R'));
    if (r.isSubmitter) parts.push(s.user.opco);
    return parts.join(' · ') || 'Banyan Viewer';
  };

  GC.renderHeader = function (active) {
    const s = GC.session || { user: null, roles: {} };
    const r = s.roles || {};
    const nav = [{ href: '/', label: 'Overview', key: 'home' }];
    if (!s.user || r.isSubmitter) nav.push({ href: '/submit', label: 'Submit an idea', key: 'submit' });
    if (s.user && ((r.raterRounds && r.raterRounds.length) || r.isAdmin)) nav.push({ href: '/review', label: 'Review', key: 'review' });
    if (s.user && r.isAdmin) nav.push({ href: '/admin', label: 'Admin', key: 'admin' });

    const user = s.user
      ? `<div class="user-menu">
           <span class="avatar">${GC.esc(GC.initials(s.user.name))}</span>
           <div class="who"><div class="name">${GC.esc(s.user.name)}</div><div class="role">${GC.esc(GC.roleLabel(s))}</div></div>
           <a href="#" class="signout" id="gc-signout">Sign out</a>
         </div>`
      : `<div class="user-menu"><a class="btn outline sm" href="/login">Sign in</a></div>`;

    const html = `
      <header class="site-header"><div class="wrap">
        <a class="brand" href="/" aria-label="Banyan Business Portal">
          <img src="/img/banyan-logo.png" alt="Banyan Software">
          <span class="divider"></span>
          <span class="app-name">2026 Growth Challenge<small>Banyan Business Portal</small></span>
        </a>
        <nav class="site-nav" aria-label="Main">${nav.map((n) => `<a href="${n.href}" class="${n.key === active ? 'active' : ''}">${n.label}</a>`).join('')}</nav>
        ${user}
      </div></header>`;
    const mount = document.getElementById('site-header');
    if (mount) mount.outerHTML = html;
    const so = document.getElementById('gc-signout');
    if (so) so.addEventListener('click', async (e) => { e.preventDefault(); await GC.api('POST', '/api/auth/logout'); location.href = '/'; });

    const f = document.getElementById('site-footer');
    if (f) f.outerHTML = `<footer class="site-footer"><div class="wrap">${GC.icons.lock}<p style="margin:0"><strong>Banyan internal. Confidential.</strong> Internal use only. Please don't share outside Banyan operating companies.</p></div></footer>`;
  };

  // Redirect to login (with return path) when a page requires a session.
  GC.requireLogin = function () {
    if (!GC.session || !GC.session.user) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); return false; }
    return true;
  };

  GC.countdown = function (deadlineIso) {
    const ms = new Date(deadlineIso).getTime() - Date.now();
    if (ms <= 0) return 'Submissions closed';
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
    if (d > 0) return `${d} day${d === 1 ? '' : 's'}, ${h} hr${h === 1 ? '' : 's'} left`;
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h} hr ${m} min left`;
  };
})();
