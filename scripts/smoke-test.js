'use strict';
// End-to-end smoke test against a fresh seeded copy of the data, run on a
// throwaway port with its own data directory. Exercises: mock login, submit +
// edit + one-per-OpCo rule, word limit, Round 1 blind scoring and group
// scoping, admin composites, bulk advance, Round 2 dimensions, Round 3
// allocation, exports, and the deadline lock.
//
//   node scripts/smoke-test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-test-'));
process.env.GC_DATA_DIR = tmp;
process.env.PORT = '3999';
execFileSync(process.execPath, [path.join(__dirname, 'seed.js'), '--force'], { env: process.env, stdio: 'ignore' });

const { server } = require('../server.js');
const store = require('../lib/store');
const BASE = 'http://localhost:3999';

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { failures++; console.log('  ✗', msg); } };

class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body) {
    const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Cookie: this.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  async login(email) { const r = await this.call('POST', '/api/auth/login', { email }); if (r.status !== 200) throw new Error('login failed for ' + email + ': ' + JSON.stringify(r.data)); return r.data; }
}

(async () => {
  await new Promise((r) => server.listen(3999, r));
  try {
    console.log('\nSubmitter flow');
    const anon = new Client();
    ok((await anon.call('GET', '/api/submission/mine')).status === 401, 'anonymous cannot read submissions');

    const ceo = new Client();
    const me = await ceo.login('sam.p@clinicore.example');
    ok(me.user.opco === 'CliniCore' && me.user.operating_group === 'Healthcare', 'login auto-populates name, OpCo and Operating Group');
    let mine = (await ceo.call('GET', '/api/submission/mine')).data;
    ok(mine.submission && mine.submission.title.includes('prior-authorisation'), 'sees the OpCo\'s existing proposal (one per OpCo)');

    const tooLong = Array(301).fill('word').join(' ');
    let r = await ceo.call('POST', '/api/submission', { title: 'X', idea: tooLong, currency: 'GBP', capital_ask: '1000', attest: true });
    ok(r.status === 400 && /301 words/.test(r.data.error), 'rejects 301-word idea');
    r = await ceo.call('POST', '/api/submission', { title: 'X', idea: 'short idea', currency: 'XXX', capital_ask: '1000', attest: true });
    ok(r.status === 400, 'rejects unknown currency');
    r = await ceo.call('POST', '/api/submission', { title: 'Edited title', idea: 'Edited idea text here.', currency: 'GBP', capital_ask: '250,000', attest: true });
    ok(r.status === 200 && r.data.submission.title === 'Edited title' && r.data.submission.capital_ask === '250000', 'edits existing proposal in place');
    ok(r.data.submission.capital_ask_usd === String(Math.round(250000 * 1.35)), 'normalises ask to USD via FX table');
    const all = store.load('submissions');
    ok(all.filter((s) => s.opco === 'CliniCore' && s.stage !== 'withdrawn').length === 1, 'still exactly one active proposal for the OpCo');
    const idIconi = r.data.submission.id;

    // a Banyan staffer cannot submit
    const staff = new Client(); await staff.login('ajarzebowicz@banyansoftware.com');
    r = await staff.call('POST', '/api/submission', { title: 'X', idea: 'y', currency: 'USD', capital_ask: 1, attest: true });
    ok(r.status === 403, 'Banyan team members cannot submit');

    console.log('\nRound 1 blind scoring');
    const op = new Client(); await op.login('dharris@banyansoftware.com');
    let rounds = (await op.call('GET', '/api/review/rounds')).data.rounds;
    ok(rounds.length === 1 && rounds[0].round === 1, 'R1-only rater sees only Round 1');
    let q = (await op.call('GET', '/api/review/1/queue')).data;
    ok(q.items.every((i) => ['Healthcare', 'EdTech'].includes(i.operating_group)), 'Round 1 queue limited to assigned Operating Groups');
    ok(q.items.every((i) => i.panel === undefined && !('rounds' in i)), 'rater payload carries no other raters\' scores');
    const target = q.items.find((i) => i.id === idIconi);
    r = await op.call('PUT', `/api/review/1/proposal/${target.id}/score`, { score: 5, notes: 'Best in group' });
    ok(r.status === 200 && r.data.score.score === '5', 'R1 rater saves a 1-5 score');
    r = await op.call('PUT', `/api/review/1/proposal/${target.id}/score`, { score: 4, notes: 'Revised' });
    ok(r.status === 200 && store.load('scores').filter((s) => s.submission_id === target.id && s.rater_email === 'dharris@banyansoftware.com').length === 1, 're-scoring upserts (one row per rater/round/proposal)');
    r = await op.call('PUT', `/api/review/1/proposal/${target.id}/score`, { score: 7 });
    ok(r.status === 400, 'rejects out-of-range score');
    const outside = store.load('submissions').find((s) => s.operating_group === 'MIU');
    r = await op.call('PUT', `/api/review/1/proposal/${outside.id}/score`, { score: 3 });
    ok(r.status === 403, 'cannot score outside assigned groups');
    ok((await op.call('GET', '/api/admin/overview')).status === 403, 'rater cannot reach admin API');
    ok((await op.call('GET', '/api/review/2/queue')).status === 403, 'rater cannot open a round they are not assigned to');

    console.log('\nAdmin: composites and advancement');
    const admin = new Client(); await admin.login('rhaid@banyansoftware.com');
    let ov = (await admin.call('GET', '/api/admin/overview')).data;
    ok(ov.total === 32 && ov.stages.round1 === 32, 'overview counts 32 proposals in Round 1');
    let list = (await admin.call('GET', '/api/admin/proposals?stage=round1')).data.items;
    const iconi = list.find((i) => i.id === idIconi);
    ok(iconi.rounds[1].raters.some((x) => x.rater_email === 'dharris@banyansoftware.com' && x.composite === 4), 'admin sees per-rater Round 1 scores');
    const expected = iconi.rounds[1].raters.reduce((a, x) => a + x.composite, 0) / iconi.rounds[1].raters.length;
    ok(Math.abs(iconi.rounds[1].composite - Math.round(expected * 10) / 10) < 0.01, 'Round 1 composite = mean of rater scores, one decimal');
    ok(list.filter((i) => i.operating_group === 'Healthcare').some((i) => i.rank === 1), 'ranked within Operating Group');

    r = await admin.call('POST', '/api/admin/advance', { from_round: 1, top_n: 2 });
    ok(r.status === 200, `bulk advance: ${r.data.advanced} advanced, ${r.data.eliminated} eliminated`);
    ov = (await admin.call('GET', '/api/admin/overview')).data;
    ok(ov.stages.round2 >= 10 && (ov.stages.round1 || 0) === 0, `top 2 per group moved to Round 2 (${ov.stages.round2}; ties at the cut line advance together)`);
    const advancedRanks = list.filter((i) => store.load('submissions').find((s) => s.id === i.id).stage === 'round2').map((i) => i.rank);
    ok(advancedRanks.length && advancedRanks.every((rk) => rk !== null && rk <= 2), 'every advanced proposal ranked 1 or 2 within its group');

    // restore one eliminated proposal and re-eliminate it from the modal path
    const elim = store.load('submissions').find((s) => s.stage === 'eliminated');
    r = await admin.call('POST', `/api/admin/proposals/${elim.id}/stage`, { stage: 'round2' });
    ok(r.status === 200 && r.data.submission.stage === 'round2' && r.data.submission.eliminated_in === '', 'restore moves proposal back and clears eliminated_in');
    r = await admin.call('POST', `/api/admin/proposals/${elim.id}/stage`, { stage: 'eliminated' });
    ok(r.data.submission.eliminated_in === '2', 'eliminating from Round 2 records eliminated_in = 2');

    console.log('\nRound 2 five-dimension scoring');
    let cfg = (await admin.call('GET', '/api/admin/config')).data;
    cfg.rounds[1].status = 'closed'; cfg.rounds[2].status = 'open';
    await admin.call('PUT', '/api/admin/config', cfg);
    const alex = new Client(); await alex.login('ajarzebowicz@banyansoftware.com');
    q = (await alex.call('GET', '/api/review/2/queue')).data;
    ok(q.status === 'open' && q.items.length === ov.stages.round2, 'R2 rater sees all semifinalists');
    const p = q.items[0];
    r = await alex.call('PUT', `/api/review/2/proposal/${p.id}/score`, { d1: 5, d2: 4, d3: 4, d4: 5, d5: 3, notes: 'x' });
    ok(r.status === 200 && r.data.score.score === '4.2', 'R2 composite = mean of five dimensions (4.2)');
    r = await alex.call('PUT', `/api/review/2/proposal/${p.id}/score`, { d1: 5, d2: 4, d3: 4, d4: 5 });
    ok(r.status === 400, 'rejects incomplete dimensions');
    const melissa = new Client(); await melissa.login('mhammerle@banyansoftware.com');
    await melissa.call('PUT', `/api/review/2/proposal/${p.id}/score`, { d1: 3, d2: 3, d3: 3, d4: 3, d5: 3 });
    q = (await melissa.call('GET', '/api/review/2/queue')).data;
    ok(q.items.find((i) => i.id === p.id).my_score.score === '3' && !q.items[0].panel, 'raters see only their own score (blind)');
    list = (await admin.call('GET', '/api/admin/proposals?stage=round2')).data.items;
    ok(Math.abs(list.find((i) => i.id === p.id).rounds[2].composite - 3.6) < 0.01, 'proposal composite = mean of rater composites (3.6)');
    cfg.rounds[2].reveal_scores = true; await admin.call('PUT', '/api/admin/config', cfg);
    q = (await melissa.call('GET', '/api/review/2/queue')).data;
    ok(q.items.find((i) => i.id === p.id).panel && q.items.find((i) => i.id === p.id).panel.n === 2, 'reveal_scores exposes panel composite to raters');
    cfg.rounds[2].reveal_scores = false; await admin.call('PUT', '/api/admin/config', cfg);

    console.log('\nRound 3 allocation');
    r = await admin.call('POST', '/api/admin/advance', { from_round: 2, top_n: 10, keep_others: true });
    ok(r.status === 200 && r.data.eliminated === 0, 'advance top 10 with keep_others leaves the rest in Round 2');
    cfg.rounds[3].status = 'open'; await admin.call('PUT', '/api/admin/config', cfg);
    const tonya = new Client(); await tonya.login('tcross@banyansoftware.com');
    q = (await tonya.call('GET', '/api/review/3/queue')).data;
    ok(q.items.length >= 1, `R3 rater sees ${q.items.length} finalist(s)`);
    const f = q.items[0];
    r = await tonya.call('PUT', `/api/review/3/proposal/${f.id}/score`, { score: 5, recommended_award_usd: '250,000', notes: 'fund' });
    ok(r.status === 200 && r.data.score.recommended_award_usd === '250000', 'R3 records conviction and recommended award');
    r = await admin.call('PATCH', `/api/admin/proposals/${f.id}`, { award_usd: 200000, follow_up_request: 'Share pipeline detail', ltm_revenue: '$4.2M' });
    ok(r.status === 200 && r.data.submission.award_usd === '200000', 'admin sets award and follow-up');
    q = (await tonya.call('GET', '/api/review/3/queue')).data;
    ok(q.items[0].follow_up_request === 'Share pipeline detail' && q.items[0].ltm_revenue === '$4.2M', 'R3 raters see follow-up and finance context');
    await admin.call('POST', `/api/admin/proposals/${f.id}/stage`, { stage: 'funded' });
    ov = (await admin.call('GET', '/api/admin/overview')).data;
    ok(ov.stages.funded === 1 && ov.awarded_usd === 200000, 'overview tracks allocated dollars against the $3M fund');

    console.log('\nExports and deadline lock');
    r = await admin.call('GET', '/api/admin/export/results');
    ok(r.status === 200 && /r1_composite/.test(r.data) && r.data.split('\n').length > 30, 'results CSV export includes composites');
    cfg.deadline = '2026-09-01T00:00:00-07:00'; await admin.call('PUT', '/api/admin/config', cfg);
    r = await ceo.call('POST', '/api/submission', { title: 'Late', idea: 'late', currency: 'GBP', capital_ask: '1', attest: true });
    ok(r.status === 403, 'submissions locked after the deadline');
    ok((await ceo.call('DELETE', '/api/submission/mine')).status === 403, 'withdrawal locked after the deadline');

    // CSV round-trip sanity: quotes and newlines in ideas survive a save/load
    const reloaded = store.load('submissions').find((s) => s.id === idIconi);
    ok(reloaded.title === 'Edited title', 'CSV round-trips edited fields');
    const withNewlines = store.load('submissions').find((s) => s.idea.includes('\n'));
    ok(withNewlines && withNewlines.idea.includes('\n\n'), 'CSV preserves paragraph breaks in ideas');
  } catch (e) {
    failures++; console.error('  ✗ test crashed:', e);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
  }
})();
