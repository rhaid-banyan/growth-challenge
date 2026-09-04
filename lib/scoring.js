'use strict';
// Composite score math, shared by the rater and admin APIs.

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
// All composites are reported to one decimal place.
const round2 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

// Round 2: a rater's composite is the mean of the five dimensions.
function raterComposite(scoreRow) {
  const dims = ['d1', 'd2', 'd3', 'd4', 'd5'].map((k) => num(scoreRow[k])).filter((v) => v !== null);
  if (dims.length === 5) return mean(dims);
  return num(scoreRow.score);
}

// For a submission, summarize all scores in a round:
//   composite  = mean of rater composites (R1: raw scores, R2: dim means, R3: conviction)
//   n          = number of raters who scored
//   avg_award  = mean recommended award (R3)
function summarize(scores, submissionId, round) {
  const rows = scores.filter((s) => s.submission_id === submissionId && String(s.round) === String(round));
  const comps = rows.map(raterComposite).filter((v) => v !== null);
  const awards = rows.map((r) => num(r.recommended_award_usd)).filter((v) => v !== null);
  const dimAvgs = {};
  if (String(round) === '2') {
    for (const k of ['d1', 'd2', 'd3', 'd4', 'd5']) {
      const vals = rows.map((r) => num(r[k])).filter((v) => v !== null);
      dimAvgs[k] = round2(mean(vals));
    }
  }
  return {
    composite: round2(mean(comps)),
    n: comps.length,
    avg_award_usd: awards.length ? Math.round(mean(awards)) : null,
    dims: dimAvgs,
    raters: rows.map((r) => ({
      rater_email: r.rater_email, rater_name: r.rater_name,
      composite: round2(raterComposite(r)),
      d1: num(r.d1), d2: num(r.d2), d3: num(r.d3), d4: num(r.d4), d5: num(r.d5),
      recommended_award_usd: num(r.recommended_award_usd),
      notes: r.notes, updated_at: r.updated_at,
    })),
  };
}

// Rank a list of {composite} descending; ties share a rank. Unscored go last.
function rank(items, key = 'composite') {
  const sorted = [...items].sort((a, b) => {
    const av = a[key] === null || a[key] === undefined ? -Infinity : a[key];
    const bv = b[key] === null || b[key] === undefined ? -Infinity : b[key];
    return bv - av;
  });
  let lastVal = null, lastRank = 0;
  sorted.forEach((it, i) => {
    if (it[key] === lastVal) it.rank = lastRank; else { it.rank = i + 1; lastRank = i + 1; lastVal = it[key]; }
    if (it[key] === null || it[key] === undefined) it.rank = null;
  });
  return sorted;
}

function toUsd(amount, currency, fx) {
  const a = num(amount);
  const rate = fx && fx[currency];
  if (a === null || !rate) return null;
  return Math.round(a * rate);
}

module.exports = { mean, num, round2, raterComposite, summarize, rank, toUsd };
