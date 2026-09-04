'use strict';
// Banyan 2026 Growth Challenge: standalone portal.
// Zero dependencies: Node's built-in http server, CSV storage, vanilla front-end.
//
//   node server.js            → http://localhost:3000
//   PORT=8080 node server.js  → custom port
//   npm run seed              → load demo directory, proposals and scores

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const store = require('./lib/store');
const auth = require('./lib/auth');
const scoring = require('./lib/scoring');
const csv = require('./lib/csv');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------- helpers
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new HttpError(413, 'Payload too large')); req.destroy(); } });
    req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch { reject(new HttpError(400, 'Invalid JSON')); } });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function serveStatic(req, res, pathname) {
  // clean URLs: /submit -> public/submit.html
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  if (!path.extname(rel)) rel += '.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, 'Not found');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(filePath).pipe(res);
}

const now = () => new Date().toISOString();
const wordCount = (s) => (String(s || '').trim().match(/\S+/g) || []).length;
const deadlinePassed = (cfg) => Date.now() > new Date(cfg.deadline).getTime();

function ctx(req) {
  const cfg = store.loadConfig();
  const user = auth.resolveUserFromRequest(req, cfg);
  const roles = auth.rolesFor(user, cfg);
  return { cfg, user, roles };
}

// ---- demo password gate -------------------------------------------------
// When GC_DEMO_PASSWORD is set, every page and API call requires a signed
// gate cookie obtained by entering that password once at /gate. This is a
// stopgap for a hosted demo; SSO replaces it in production.
const crypto = require('crypto');
const DEMO_PASSWORD = process.env.GC_DEMO_PASSWORD || '';
const gateToken = () => crypto.createHmac('sha256', store.getSecret()).update('gate:' + DEMO_PASSWORD).digest('base64url');
function gateOk(req) {
  if (!DEMO_PASSWORD) return true;
  const raw = auth.parseCookies(req).gc_gate || '';
  const expected = gateToken();
  return raw.length === expected.length && crypto.timingSafeEqual(Buffer.from(raw), Buffer.from(expected));
}
const GATE_EXEMPT = /^\/(gate|api\/gate|css\/|img\/|js\/app\.js|favicon)/;

function requireUser(c) { if (!c.user) throw new HttpError(401, 'Sign in required'); }
function requireAdmin(c) { requireUser(c); if (!c.roles.isAdmin) throw new HttpError(403, 'Admin access required'); }
function requireRater(c, round) {
  requireUser(c);
  if (c.roles.isAdmin) return; // admins can preview any round
  if (!c.roles.raterRounds.includes(Number(round))) throw new HttpError(403, 'You are not a rater in this round');
}

const STAGE_OF_ROUND = { 1: 'round1', 2: 'round2', 3: 'round3' };
const ROUND_OF_STAGE = { round1: 1, round2: 2, round3: 3 };

// Strip fields raters should never see; attach the caller's own score.
function proposalForRater(sub, myScore, cfg) {
  return {
    id: sub.id, title: sub.title, idea: sub.idea, word_count: sub.word_count,
    opco: sub.opco, operating_group: sub.operating_group, name: sub.name, title_role: sub.title_role,
    capital_ask: sub.capital_ask, currency: sub.currency, capital_ask_usd: sub.capital_ask_usd,
    stage: sub.stage, submitted_at: sub.submitted_at,
    follow_up_request: sub.follow_up_request, follow_up_response: sub.follow_up_response,
    ltm_revenue: sub.ltm_revenue, ltm_growth: sub.ltm_growth, purchase_price: sub.purchase_price,
    my_score: myScore ? {
      score: myScore.score, d1: myScore.d1, d2: myScore.d2, d3: myScore.d3, d4: myScore.d4, d5: myScore.d5,
      recommended_award_usd: myScore.recommended_award_usd, notes: myScore.notes, updated_at: myScore.updated_at,
    } : null,
  };
}

// Full admin view of a proposal with per-round summaries.
function proposalForAdmin(sub, scores) {
  return {
    ...sub,
    rounds: { 1: scoring.summarize(scores, sub.id, 1), 2: scoring.summarize(scores, sub.id, 2), 3: scoring.summarize(scores, sub.id, 3) },
  };
}

// ---------------------------------------------------------------- routes
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

// ---- demo gate
route('GET', '/api/gate', () => ({ enabled: !!DEMO_PASSWORD }));
route('POST', '/api/gate', async (c, req, res) => {
  const body = await readBody(req);
  if (!DEMO_PASSWORD) return { ok: true };
  const given = String(body.password || '');
  const a = Buffer.from(given), b = Buffer.from(DEMO_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'That password is not right.');
  res.setHeader('Set-Cookie', `gc_gate=${gateToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
  return { ok: true };
});

// ---- identity
route('GET', '/api/me', (c) => ({ user: c.user, roles: c.roles, mock_auth: true }));

route('GET', '/api/directory', (c) => {
  // Mock-only: the list of identities the sign-in picker offers.
  const users = store.load('users').map((u) => ({ email: u.email, name: u.name, title: u.title, opco: u.opco, operating_group: u.operating_group, kind: 'OpCo' }));
  const seen = new Set(users.map((u) => auth.norm(u.email)));
  const staffMap = new Map();
  const addStaff = (email, name, title, role) => {
    const e = auth.norm(email); if (!e || seen.has(e)) return;
    const s = staffMap.get(e) || { email: e, name: name || e, title: title || '', opco: 'Banyan Software', operating_group: '', roles: [] };
    if (name && s.name === e) s.name = name; if (title && !s.title) s.title = title; s.roles.push(role); staffMap.set(e, s);
  };
  for (const a of c.cfg.admins || []) addStaff(typeof a === 'string' ? a : a.email, typeof a === 'object' ? a.name : '', typeof a === 'object' ? a.title : '', 'Admin');
  for (const r of ['1', '2', '3']) for (const x of c.cfg.rounds[r].raters || []) addStaff(x.email, x.name, x.title, 'Round ' + r);
  const staff = [...staffMap.values()].map((s) => ({ ...s, kind: s.roles.join(', ') }));
  return { users, staff };
});

route('POST', '/api/auth/login', async (c, req, res) => {
  const body = await readBody(req);
  const id = auth.findIdentity(body.email, c.cfg);
  if (!id) throw new HttpError(404, 'No portal user with that email');
  res.setHeader('Set-Cookie', auth.makeSessionCookie(id.email));
  return { ok: true, user: id, roles: auth.rolesFor(id, c.cfg) };
});

route('POST', '/api/auth/logout', (c, req, res) => { res.setHeader('Set-Cookie', auth.clearSessionCookie()); return { ok: true }; });

// ---- public config
route('GET', '/api/config/public', (c) => {
  const cfg = c.cfg;
  return {
    challenge_name: cfg.challenge_name, total_fund_usd: cfg.total_fund_usd, word_limit: cfg.word_limit,
    deadline: cfg.deadline, deadline_label: cfg.deadline_label, deadline_tz: cfg.deadline_tz, deadline_passed: deadlinePassed(cfg),
    operating_groups: cfg.operating_groups, currencies: cfg.currencies, fx_to_usd: cfg.fx_to_usd, key_dates: cfg.key_dates || [],
    rounds: Object.fromEntries(['1', '2', '3'].map((r) => [r, { name: cfg.rounds[r].name, status: cfg.rounds[r].status }])),
    round2_dimensions: cfg.round2_dimensions,
  };
});

// ---- submitter
function mySubmission(c) {
  const subs = store.load('submissions');
  // One proposal per OpCo: match on OpCo name (case-insensitive), fall back to email.
  const opco = auth.norm(c.user.opco);
  return subs.find((s) => s.stage !== 'withdrawn' && (auth.norm(s.opco) === opco || auth.norm(s.email) === auth.norm(c.user.email))) || null;
}

route('GET', '/api/submission/mine', (c) => {
  requireUser(c);
  if (!c.roles.isSubmitter) return { submission: null, can_submit: false, reason: 'Only operating company users can submit.' };
  const sub = mySubmission(c);
  return { submission: sub, can_submit: !deadlinePassed(c.cfg), deadline_passed: deadlinePassed(c.cfg) };
});

route('POST', '/api/submission', async (c, req) => {
  requireUser(c);
  if (!c.roles.isSubmitter) throw new HttpError(403, 'Only operating company users can submit.');
  if (deadlinePassed(c.cfg)) throw new HttpError(403, 'The submission deadline has passed.');
  const body = await readBody(req);
  const title = String(body.title || '').trim();
  const idea = String(body.idea || '').trim();
  const currency = String(body.currency || '').toUpperCase();
  const ask = parseFloat(String(body.capital_ask || '').replace(/[^0-9.]/g, ''));
  if (!title || title.length > 120) throw new HttpError(400, 'Please give your idea a short title (max 120 characters).');
  if (!idea) throw new HttpError(400, 'Please describe your idea.');
  const wc = wordCount(idea);
  if (wc > c.cfg.word_limit) throw new HttpError(400, `Your idea is ${wc} words; the limit is ${c.cfg.word_limit}.`);
  if (!c.cfg.currencies.includes(currency)) throw new HttpError(400, 'Please select a currency.');
  if (!Number.isFinite(ask) || ask <= 0) throw new HttpError(400, 'Please enter a capital ask greater than zero.');
  if (!body.attest) throw new HttpError(400, 'Please confirm the attestation before submitting.');

  const subs = store.load('submissions');
  let sub = mySubmission(c);
  const ts = now();
  if (!sub) {
    sub = { id: store.newId('gc'), submitted_at: ts, stage: 'round1', eliminated_in: '', award_usd: '', follow_up_request: '', follow_up_response: '', ltm_revenue: '', ltm_growth: '', purchase_price: '', admin_notes: '' };
    subs.push(sub);
  } else {
    const idx = subs.findIndex((s) => s.id === sub.id); sub = subs[idx];
  }
  Object.assign(sub, {
    updated_at: ts, email: c.user.email, name: c.user.name, title_role: c.user.title || '', opco: c.user.opco, operating_group: c.user.operating_group,
    title, idea, word_count: String(wc), capital_ask: String(ask), currency, capital_ask_usd: String(scoring.toUsd(ask, currency, c.cfg.fx_to_usd) ?? ''),
  });
  store.save('submissions', subs);
  return { ok: true, submission: sub };
});

route('DELETE', '/api/submission/mine', (c) => {
  requireUser(c);
  if (deadlinePassed(c.cfg)) throw new HttpError(403, 'The submission deadline has passed.');
  const subs = store.load('submissions');
  const sub = mySubmission(c);
  if (!sub) throw new HttpError(404, 'No proposal found.');
  const row = subs.find((s) => s.id === sub.id); row.stage = 'withdrawn'; row.updated_at = now();
  store.save('submissions', subs);
  return { ok: true };
});

// ---- raters
function queueFor(c, round) {
  const stage = STAGE_OF_ROUND[round];
  const groups = c.roles.raterGroups[String(round)] || [];
  let subs = store.load('submissions').filter((s) => s.stage === stage);
  // Round 1 raters only see their assigned Operating Groups (admins see all).
  if (Number(round) === 1 && !c.roles.isAdmin && groups.length) subs = subs.filter((s) => groups.includes(s.operating_group));
  if (Number(round) === 1 && c.roles.isAdmin && groups.length) subs = subs.filter((s) => groups.includes(s.operating_group));
  return subs;
}

route('GET', '/api/review/rounds', (c) => {
  requireUser(c);
  const scores = store.load('scores');
  const out = [];
  for (const r of [1, 2, 3]) {
    if (!c.roles.isAdmin && !c.roles.raterRounds.includes(r)) continue;
    const q = queueFor(c, r);
    const mine = scores.filter((s) => String(s.round) === String(r) && auth.norm(s.rater_email) === auth.norm(c.user.email));
    const scored = q.filter((s) => mine.some((m) => m.submission_id === s.id)).length;
    out.push({ round: r, name: c.cfg.rounds[r].name, status: c.cfg.rounds[r].status, total: q.length, scored, groups: c.roles.raterGroups[String(r)] || [], reveal_scores: !!c.cfg.rounds[r].reveal_scores });
  }
  return { rounds: out };
});

route('GET', '/api/review/:round/queue', (c, req, res, p) => {
  requireRater(c, p.round);
  const scores = store.load('scores');
  const me = auth.norm(c.user.email);
  const items = queueFor(c, p.round).map((s) => {
    const my = scores.find((x) => x.submission_id === s.id && String(x.round) === String(p.round) && auth.norm(x.rater_email) === me);
    const item = proposalForRater(s, my, c.cfg);
    if (c.cfg.rounds[p.round].reveal_scores) item.panel = scoring.summarize(scores, s.id, p.round);
    return item;
  });
  // stable, blind-friendly ordering: by operating group then submission time
  items.sort((a, b) => (a.operating_group || '').localeCompare(b.operating_group || '') || (a.submitted_at || '').localeCompare(b.submitted_at || ''));
  return { round: Number(p.round), status: c.cfg.rounds[p.round].status, reveal_scores: !!c.cfg.rounds[p.round].reveal_scores, items, dimensions: c.cfg.round2_dimensions };
});

route('PUT', '/api/review/:round/proposal/:id/score', async (c, req, res, p) => {
  requireRater(c, p.round);
  const round = Number(p.round);
  if (c.cfg.rounds[round].status !== 'open') throw new HttpError(403, `Round ${round} is not open for scoring.`);
  const subs = store.load('submissions');
  const sub = subs.find((s) => s.id === p.id);
  if (!sub) throw new HttpError(404, 'Proposal not found');
  if (sub.stage !== STAGE_OF_ROUND[round]) throw new HttpError(400, 'This proposal is not in this round.');
  if (round === 1 && !c.roles.isAdmin) {
    const groups = c.roles.raterGroups['1'] || [];
    if (groups.length && !groups.includes(sub.operating_group)) throw new HttpError(403, 'This proposal is outside your Operating Group.');
  }
  const body = await readBody(req);
  const in15 = (v) => { const n = parseInt(v, 10); return n >= 1 && n <= 5 ? n : null; };
  const rec = { score: '', d1: '', d2: '', d3: '', d4: '', d5: '', recommended_award_usd: '' };
  if (round === 2) {
    const dims = ['d1', 'd2', 'd3', 'd4', 'd5'].map((k) => in15(body[k]));
    if (dims.some((d) => d === null)) throw new HttpError(400, 'Please score all five dimensions from 1 to 5.');
    ['d1', 'd2', 'd3', 'd4', 'd5'].forEach((k, i) => { rec[k] = String(dims[i]); });
    rec.score = String(Math.round((dims.reduce((a, b) => a + b, 0) / 5) * 10) / 10);
  } else {
    const s = in15(body.score);
    if (s === null) throw new HttpError(400, 'Please choose a score from 1 to 5.');
    rec.score = String(s);
    if (round === 3 && body.recommended_award_usd !== undefined && body.recommended_award_usd !== '') {
      const a = parseFloat(String(body.recommended_award_usd).replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(a) || a < 0) throw new HttpError(400, 'Recommended award must be a number.');
      rec.recommended_award_usd = String(Math.round(a));
    }
  }
  const notes = String(body.notes || '').slice(0, 4000);
  const scores = store.load('scores');
  const me = auth.norm(c.user.email);
  let row = scores.find((x) => x.submission_id === sub.id && String(x.round) === String(round) && auth.norm(x.rater_email) === me);
  if (!row) { row = { id: store.newId('sc'), submission_id: sub.id, round: String(round), rater_email: me, rater_name: c.user.name }; scores.push(row); }
  Object.assign(row, rec, { notes, updated_at: now() });
  store.save('scores', scores);
  return { ok: true, score: row };
});

// ---- admin
route('GET', '/api/admin/overview', (c) => {
  requireAdmin(c);
  const subs = store.load('submissions');
  const scores = store.load('scores');
  const active = subs.filter((s) => s.stage !== 'withdrawn');
  const byGroup = {};
  for (const g of c.cfg.operating_groups) byGroup[g] = { group: g, submissions: 0, round1: 0, round2: 0, round3: 0, funded: 0, eliminated: 0, ask_usd: 0, awarded_usd: 0 };
  for (const s of active) {
    const g = byGroup[s.operating_group] || (byGroup[s.operating_group] = { group: s.operating_group, submissions: 0, round1: 0, round2: 0, round3: 0, funded: 0, eliminated: 0, ask_usd: 0, awarded_usd: 0 });
    g.submissions++; g[s.stage] = (g[s.stage] || 0) + 1; g.ask_usd += scoring.num(s.capital_ask_usd) || 0; g.awarded_usd += scoring.num(s.award_usd) || 0;
  }
  const stages = {};
  for (const s of active) stages[s.stage] = (stages[s.stage] || 0) + 1;
  const awarded = active.reduce((a, s) => a + (scoring.num(s.award_usd) || 0), 0);
  const raterProgress = {};
  for (const r of [1, 2, 3]) {
    const stage = STAGE_OF_ROUND[r];
    raterProgress[r] = (c.cfg.rounds[r].raters || []).map((rt) => {
      let pool = active.filter((s) => s.stage === stage);
      if (r === 1 && rt.groups && rt.groups.length) pool = pool.filter((s) => rt.groups.includes(s.operating_group));
      const done = pool.filter((s) => scores.some((x) => x.submission_id === s.id && String(x.round) === String(r) && auth.norm(x.rater_email) === auth.norm(rt.email))).length;
      return { email: rt.email, name: rt.name, groups: rt.groups || [], total: pool.length, done };
    });
  }
  return {
    total: active.length, stages, awarded_usd: awarded, total_fund_usd: c.cfg.total_fund_usd,
    by_group: Object.values(byGroup), rater_progress: raterProgress,
    deadline: c.cfg.deadline, deadline_passed: deadlinePassed(c.cfg), rounds: c.cfg.rounds,
    withdrawn: subs.length - active.length,
  };
});

route('GET', '/api/admin/proposals', (c, req) => {
  requireAdmin(c);
  const url = new URL(req.url, 'http://x');
  const stage = url.searchParams.get('stage');
  const subs = store.load('submissions');
  const scores = store.load('scores');
  let items = subs.filter((s) => (stage ? s.stage === stage : s.stage !== 'withdrawn')).map((s) => proposalForAdmin(s, scores));
  // rank: within stage's round, R1 within group, R2/R3 overall
  const roundOf = stage && ROUND_OF_STAGE[stage];
  if (roundOf) {
    items.forEach((it) => { it.composite = it.rounds[roundOf].composite; it.n_raters = it.rounds[roundOf].n; });
    if (roundOf === 1) {
      const groups = [...new Set(items.map((i) => i.operating_group))];
      for (const g of groups) scoring.rank(items.filter((i) => i.operating_group === g));
    } else scoring.rank(items);
  }
  return { items, config: { rounds: c.cfg.rounds, total_fund_usd: c.cfg.total_fund_usd, dimensions: c.cfg.round2_dimensions } };
});

route('POST', '/api/admin/proposals/:id/stage', async (c, req, res, p) => {
  requireAdmin(c);
  const body = await readBody(req);
  const target = body.stage;
  const valid = ['round1', 'round2', 'round3', 'funded', 'eliminated', 'withdrawn'];
  if (!valid.includes(target)) throw new HttpError(400, 'Invalid stage');
  const subs = store.load('submissions');
  const sub = subs.find((s) => s.id === p.id);
  if (!sub) throw new HttpError(404, 'Proposal not found');
  if (target === 'eliminated') sub.eliminated_in = String(ROUND_OF_STAGE[sub.stage] || body.eliminated_in || '');
  else sub.eliminated_in = '';
  sub.stage = target; sub.updated_at = now();
  store.save('submissions', subs);
  return { ok: true, submission: sub };
});

// Bulk advance. Round 1 → top N per Operating Group; Round 2 → top N overall.
// Others in that round are marked eliminated (unless keep_others=true).
route('POST', '/api/admin/advance', async (c, req) => {
  requireAdmin(c);
  const body = await readBody(req);
  const from = Number(body.from_round);
  if (![1, 2].includes(from)) throw new HttpError(400, 'from_round must be 1 or 2');
  const n = Math.max(1, parseInt(body.top_n, 10) || (from === 1 ? c.cfg.rounds[1].advance_per_group : c.cfg.rounds[2].advance_top_n));
  const subs = store.load('submissions');
  const scores = store.load('scores');
  const pool = subs.filter((s) => s.stage === STAGE_OF_ROUND[from]).map((s) => ({ sub: s, composite: scoring.summarize(scores, s.id, from).composite }));
  const advanced = [], eliminated = [];
  const pick = (list) => {
    const ranked = scoring.rank(list);
    for (const it of ranked) {
      if (it.composite !== null && it.rank <= n) { it.sub.stage = STAGE_OF_ROUND[from + 1]; it.sub.eliminated_in = ''; advanced.push(it.sub.id); }
      else if (!body.keep_others) { it.sub.stage = 'eliminated'; it.sub.eliminated_in = String(from); eliminated.push(it.sub.id); }
      it.sub.updated_at = now();
    }
  };
  if (from === 1) for (const g of [...new Set(pool.map((p) => p.sub.operating_group))]) pick(pool.filter((p) => p.sub.operating_group === g));
  else pick(pool);
  store.save('submissions', subs);
  return { ok: true, advanced: advanced.length, eliminated: eliminated.length };
});

route('PATCH', '/api/admin/proposals/:id', async (c, req, res, p) => {
  requireAdmin(c);
  const body = await readBody(req);
  const subs = store.load('submissions');
  const sub = subs.find((s) => s.id === p.id);
  if (!sub) throw new HttpError(404, 'Proposal not found');
  const editable = ['award_usd', 'follow_up_request', 'follow_up_response', 'ltm_revenue', 'ltm_growth', 'purchase_price', 'admin_notes', 'capital_ask_usd', 'operating_group', 'opco', 'title'];
  for (const k of editable) if (k in body) sub[k] = body[k] === null || body[k] === undefined ? '' : String(body[k]);
  sub.updated_at = now();
  store.save('submissions', subs);
  return { ok: true, submission: sub };
});

route('GET', '/api/admin/proposals/:id/scores', (c, req, res, p) => {
  requireAdmin(c);
  const scores = store.load('scores');
  return { 1: scoring.summarize(scores, p.id, 1), 2: scoring.summarize(scores, p.id, 2), 3: scoring.summarize(scores, p.id, 3) };
});

route('GET', '/api/admin/config', (c) => { requireAdmin(c); return c.cfg; });

route('PUT', '/api/admin/config', async (c, req) => {
  requireAdmin(c);
  const body = await readBody(req);
  const cfg = c.cfg;
  const allowed = ['challenge_name', 'total_fund_usd', 'word_limit', 'deadline', 'deadline_label', 'deadline_tz', 'key_dates', 'operating_groups', 'currencies', 'fx_to_usd', 'admins', 'rounds', 'round2_dimensions'];
  for (const k of allowed) if (k in body) cfg[k] = body[k];
  // normalise rounds
  for (const r of ['1', '2', '3']) {
    const rd = cfg.rounds[r] || {};
    if (!['pending', 'open', 'closed'].includes(rd.status)) rd.status = 'pending';
    rd.raters = (rd.raters || []).map((x) => ({ email: auth.norm(x.email), name: x.name || '', title: x.title || '', groups: Array.isArray(x.groups) ? x.groups : [] })).filter((x) => x.email);
    cfg.rounds[r] = rd;
  }
  cfg.admins = (cfg.admins || []).map((a) => (typeof a === 'string' ? { email: auth.norm(a), name: '', title: '' } : { email: auth.norm(a.email), name: a.name || '', title: a.title || '' })).filter((a) => a.email);
  store.saveConfig(cfg);
  return { ok: true, config: cfg };
});

route('POST', '/api/admin/recompute-fx', (c) => {
  requireAdmin(c);
  const subs = store.load('submissions');
  for (const s of subs) s.capital_ask_usd = String(scoring.toUsd(s.capital_ask, s.currency, c.cfg.fx_to_usd) ?? '');
  store.save('submissions', subs);
  return { ok: true, updated: subs.length };
});

route('GET', '/api/admin/export/:what', (c, req, res, p) => {
  requireAdmin(c);
  let text, name;
  if (p.what === 'submissions') { text = fs.readFileSync(store.tablePath('submissions'), 'utf8'); name = 'submissions.csv'; }
  else if (p.what === 'scores') { text = fs.readFileSync(store.tablePath('scores'), 'utf8'); name = 'scores.csv'; }
  else if (p.what === 'results') {
    const subs = store.load('submissions'); const scores = store.load('scores');
    const cols = ['id', 'opco', 'operating_group', 'name', 'email', 'title', 'capital_ask', 'currency', 'capital_ask_usd', 'stage', 'eliminated_in', 'r1_composite', 'r1_raters', 'r2_composite', 'r2_raters', 'r2_d1', 'r2_d2', 'r2_d3', 'r2_d4', 'r2_d5', 'r3_conviction', 'r3_raters', 'r3_avg_recommended_award_usd', 'award_usd', 'follow_up_request', 'follow_up_response', 'ltm_revenue', 'ltm_growth', 'purchase_price', 'admin_notes', 'word_count', 'idea', 'submitted_at'];
    const rows = subs.map((s) => { const r1 = scoring.summarize(scores, s.id, 1), r2 = scoring.summarize(scores, s.id, 2), r3 = scoring.summarize(scores, s.id, 3); return { ...s, r1_composite: r1.composite, r1_raters: r1.n, r2_composite: r2.composite, r2_raters: r2.n, r2_d1: r2.dims.d1, r2_d2: r2.dims.d2, r2_d3: r2.dims.d3, r2_d4: r2.dims.d4, r2_d5: r2.dims.d5, r3_conviction: r3.composite, r3_raters: r3.n, r3_avg_recommended_award_usd: r3.avg_award_usd }; });
    text = csv.stringify(rows, cols); name = 'growth-challenge-results.csv';
  } else throw new HttpError(404, 'Unknown export');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` });
  res.end(text);
  return undefined; // already responded
});

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (!gateOk(req) && !GATE_EXEMPT.test(pathname)) {
      if (pathname.startsWith('/api/')) return send(res, 401, { error: 'Enter the access password first.', gate: true });
      res.writeHead(302, { Location: '/gate?next=' + encodeURIComponent(req.url) }); return res.end();
    }
    if (pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = pathname.match(r.pattern);
        if (!m) continue;
        const c = ctx(req);
        const result = await r.handler(c, req, res, m.groups || {});
        if (result !== undefined && !res.writableEnded) send(res, 200, result);
        return;
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    serveStatic(req, res, pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    send(res, status, { error: err.message || 'Server error' });
  }
});

if (require.main === module) {
  store.loadConfig(); // creates data/config.json on first run
  // Hosted demos start with an empty disk: seed once so there is something to show.
  if (process.env.GC_SEED_ON_EMPTY === 'true' && !store.load('submissions').length) {
    require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'scripts', 'seed.js'), '--force'], { stdio: 'inherit', env: process.env });
  }
  if (DEMO_PASSWORD) console.log('Demo password gate is ON (GC_DEMO_PASSWORD is set).');
  server.listen(PORT, () => {
    console.log(`Banyan 2026 Growth Challenge portal → http://localhost:${PORT}`);
    console.log(`Data directory: ${store.DATA_DIR}`);
  });
}

module.exports = { server };
