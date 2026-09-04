'use strict';
// File-backed storage. Submissions and scores live in CSV files so they can be
// opened directly in Excel/Sheets; config lives in a single JSON file.
// Every write goes to a temp file and is renamed into place (atomic on POSIX).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const csv = require('./csv');

const DATA_DIR = process.env.GC_DATA_DIR || path.join(__dirname, '..', 'data');

const TABLES = {
  users: {
    file: 'users.csv',
    // Mock of the Banyan Business Portal directory. In production these fields
    // come from SSO claims / the portal's user API (see lib/auth.js).
    columns: ['email', 'name', 'title', 'opco', 'operating_group'],
  },
  submissions: {
    file: 'submissions.csv',
    columns: [
      'id', 'submitted_at', 'updated_at',
      'email', 'name', 'title_role', 'opco', 'operating_group',
      'title', 'idea', 'word_count',
      'capital_ask', 'currency', 'capital_ask_usd',
      'stage',            // round1 | round2 | round3 | funded | eliminated | withdrawn
      'eliminated_in',    // round number the proposal was eliminated in (if any)
      'award_usd',        // final award (Round 3)
      'follow_up_request', 'follow_up_response',
      'ltm_revenue', 'ltm_growth', 'purchase_price',
      'admin_notes',
    ],
  },
  scores: {
    file: 'scores.csv',
    columns: [
      'id', 'submission_id', 'round', 'rater_email', 'rater_name',
      'score',                       // R1 overall 1-5; R2 composite of dims; R3 fund conviction 1-5
      'd1', 'd2', 'd3', 'd4', 'd5',  // R2 dimensions 1-5
      'recommended_award_usd',       // R3 only
      'notes', 'updated_at',
    ],
  },
};

function ensureDir() { fs.mkdirSync(DATA_DIR, { recursive: true }); }

function tablePath(name) { return path.join(DATA_DIR, TABLES[name].file); }

function load(name) {
  ensureDir();
  const p = tablePath(name);
  if (!fs.existsSync(p)) return [];
  const { rows } = csv.toObjects(fs.readFileSync(p, 'utf8'));
  // make sure every row has every column
  return rows.map((r) => { for (const c of TABLES[name].columns) if (!(c in r)) r[c] = ''; return r; });
}

function atomicWrite(p, content) {
  const tmp = p + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, p);
}

function save(name, rows) {
  ensureDir();
  atomicWrite(tablePath(name), csv.stringify(rows, TABLES[name].columns));
}

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(5).toString('hex');
}

// ---------- config ----------
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  challenge_name: 'Banyan 2026 Growth Challenge',
  total_fund_usd: 3000000,
  word_limit: 300,
  // Deadline: Friday, October 2, 2026, 11:59 PM Eastern
  deadline: '2026-10-02T23:59:00-04:00',
  deadline_label: 'Friday, October 2, 2026 · 11:59 PM ET',
  deadline_tz: 'America/New_York',
  submissions_open: '2026-09-17',
  key_dates: [
    { date: '2026-09-17', label: 'Submissions open', detail: 'Portal opens to all operating companies' },
    { date: '2026-10-02', label: 'Deadline for submissions', detail: '11:59 PM ET' },
    { date: '2026-10-13', label: 'Round 1 and Round 2 reviews complete', detail: '' },
    { date: '2026-10-21', label: 'Deadline for additional detail from CEOs', detail: 'Only if requested; we will reach out separately' },
    { date: '2026-10-26', label: 'Allocations and winners finalized', detail: 'Announcements made' },
    { date: '2026-11-09', label: 'Budgets locked', detail: '' },
  ],
  operating_groups: [
    'UK and RoE', 'MIU', 'GovTech', 'EdTech', 'Healthcare', 'ANZ',
    'Transportation, Logistics, and Longtail', 'Financial Services', 'Media and Communications', 'DACH',
  ],
  currencies: ['USD', 'CAD', 'NZD', 'AUD', 'BRL', 'GBP', 'EUR'],
  // Approximate FX to USD, used only to normalize capital asks for comparison.
  fx_to_usd: { USD: 1.0, CAD: 0.72, NZD: 0.59, AUD: 0.65, BRL: 0.18, GBP: 1.35, EUR: 1.16 },
  admins: [],
  // Raters only ever see their own scores while a round is open. Flip a
  // round's reveal_scores to true for the discussion phase.
  rounds: {
    1: { name: 'Operating Group', status: 'pending', advance_per_group: 2, reveal_scores: false, raters: [] },
    2: { name: 'Semifinalists', status: 'pending', advance_top_n: 10, reveal_scores: false, raters: [] },
    3: { name: 'Finalists', status: 'pending', reveal_scores: false, raters: [] },
  },
  round2_dimensions: [
    { key: 'd1', label: 'Clear vision for value creation' },
    { key: 'd2', label: 'Market signals and customer feedback' },
    { key: 'd3', label: 'Clear ROI within 12 months' },
    { key: 'd4', label: 'Asymmetric upside potential' },
    { key: 'd5', label: 'Execution risk (5 = low risk)' },
  ],
};

function loadConfig() {
  ensureDir();
  if (!fs.existsSync(CONFIG_PATH)) { saveConfig(DEFAULT_CONFIG); return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  // fill any missing keys with defaults (forward compatible)
  for (const k of Object.keys(DEFAULT_CONFIG)) if (!(k in cfg)) cfg[k] = JSON.parse(JSON.stringify(DEFAULT_CONFIG[k]));
  for (const r of ['1', '2', '3']) if (!cfg.rounds[r]) cfg.rounds[r] = JSON.parse(JSON.stringify(DEFAULT_CONFIG.rounds[r]));
  return cfg;
}

function saveConfig(cfg) {
  ensureDir();
  atomicWrite(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

// Secret used to sign the session cookie. Generated once and kept on disk so
// restarts don't sign everyone out.
function getSecret() {
  if (process.env.GC_SECRET) return process.env.GC_SECRET;
  ensureDir();
  const p = path.join(DATA_DIR, '.secret');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(p, s, { mode: 0o600 });
  return s;
}

module.exports = { DATA_DIR, TABLES, load, save, newId, loadConfig, saveConfig, DEFAULT_CONFIG, getSecret, tablePath };
