'use strict';
// Authentication / identity.
//
// MOCK MODE (default): the user picks an identity from the mock portal
// directory (data/users.csv) or from the rater/admin lists in config.json, and
// we set a signed session cookie. No passwords: this is a functioning mock-up.
//
// PRODUCTION: replace `resolveUserFromRequest` with a lookup against the Banyan
// Business Portal SSO session (e.g. validate the portal's JWT / session cookie,
// or trust identity headers set by an auth proxy) and return the same shape:
//   { email, name, title, opco, operating_group }
// Everything else in the app keys off that object and the email-based role
// lists in config.json, so nothing else needs to change.

const crypto = require('crypto');
const store = require('./store');

const COOKIE = 'gc_session';

function sign(value) {
  return crypto.createHmac('sha256', store.getSecret()).update(value).digest('base64url');
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function makeSessionCookie(email) {
  const payload = Buffer.from(email.toLowerCase()).toString('base64url');
  const value = payload + '.' + sign(payload);
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}`;
}

function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function emailFromCookie(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  return Buffer.from(payload, 'base64url').toString('utf8');
}

const norm = (e) => String(e || '').trim().toLowerCase();

// Find a person by email across the directory, rater lists and admin list.
function findIdentity(email, cfg) {
  email = norm(email);
  if (!email) return null;
  const users = store.load('users');
  const u = users.find((x) => norm(x.email) === email);
  if (u) return { email: norm(u.email), name: u.name, title: u.title, opco: u.opco, operating_group: u.operating_group };
  for (const r of ['1', '2', '3']) {
    const rater = (cfg.rounds[r].raters || []).find((x) => norm(x.email) === email);
    if (rater) return { email, name: rater.name || email, title: rater.title || 'Banyan', opco: 'Banyan Software', operating_group: '' };
  }
  const admin = (cfg.admins || []).find((x) => norm(typeof x === 'string' ? x : x.email) === email);
  if (admin) return { email, name: (typeof admin === 'object' && admin.name) || email, title: (typeof admin === 'object' && admin.title) || 'Banyan', opco: 'Banyan Software', operating_group: '' };
  return null;
}

// >>> SSO integration point <<<
function resolveUserFromRequest(req, cfg) {
  const email = emailFromCookie(req);
  if (!email) return null;
  return findIdentity(email, cfg);
}

function rolesFor(user, cfg) {
  if (!user) return { isAdmin: false, raterRounds: [], raterGroups: {}, isSubmitter: false };
  const email = norm(user.email);
  const isAdmin = (cfg.admins || []).some((x) => norm(typeof x === 'string' ? x : x.email) === email);
  const raterRounds = [];
  const raterGroups = {};
  for (const r of ['1', '2', '3']) {
    const rater = (cfg.rounds[r].raters || []).find((x) => norm(x.email) === email);
    if (rater) { raterRounds.push(Number(r)); raterGroups[r] = rater.groups || []; }
  }
  const isSubmitter = !!user.opco && user.opco !== 'Banyan Software';
  return { isAdmin, raterRounds, raterGroups, isSubmitter };
}

module.exports = { parseCookies, makeSessionCookie, clearSessionCookie, resolveUserFromRequest, findIdentity, rolesFor, norm };
