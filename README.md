# Banyan 2026 Growth Challenge: portal

A standalone, functioning mock-up of the submission and scoring portal for the
Banyan 2026 Growth Challenge ($3M for transformative growth ideas across Banyan
operating companies). It is styled to match the Banyan Business Portal and is
built so it can be dropped behind the portal's SSO later with a one-function
change.

## Run it

Requires Node 18 or newer. There are **no dependencies to install**.

```bash
cd growth-challenge-site
npm run seed     # loads a demo directory, ~30 proposals, partial Round 1 scores
npm start        # → http://localhost:3000
```

Then open http://localhost:3000, click **Sign in**, and pick who to be:

| Try this as… | Sign in as | What you see |
|---|---|---|
| An OpCo CEO | any operating company user, e.g. *Sam Patel · CliniCore* | Landing page with their status, prefilled submission form, 300-word counter, capital ask + currency, edit/withdraw until the deadline |
| A Round 1 rater | *Darren Harris* | Only the proposals in their Operating Groups (Healthcare, EdTech), 1 to 5 scoring, blind to everyone else's scores |
| A Round 2/3 rater | *Melissa Hammerle*, *Luke Reimer*, *Tonya Cross*, *David Berkal* | Five-dimension scoring (R2), fund conviction + recommended award (R3); rounds appear once they're opened |
| An admin | *Ryan Haid* or *Alex Jarzebowicz* | Pipeline by round, composites and ranks, per-proposal advance/eliminate, allocation tracker, follow-ups, reviewer privileges, settings, CSV exports |

Useful commands: `npm run reseed` wipes and regenerates demo data;
`npm test` runs an end-to-end smoke test against a throwaway copy of the data.
`PORT=8080 npm start` changes the port; `GC_DATA_DIR=/path npm start` moves the
data directory.

## How it works

```
server.js            zero-dependency HTTP server: static pages + JSON API
lib/store.js         CSV/JSON storage (atomic writes), config defaults
lib/auth.js          identity: mock sign-in now, SSO later (see below)
lib/scoring.js       composites, ranking, FX normalisation
lib/csv.js           small RFC 4180 CSV reader/writer
public/              index (landing), login, gate, submit, review, admin + css/js/img
render.yaml          one-click Render deploy (Node service + persistent disk)
scripts/seed.js      demo data       scripts/smoke-test.js   end-to-end checks
data/
  submissions.csv    one row per proposal (open it in Excel / Sheets any time)
  scores.csv         one row per rater × round × proposal
  users.csv          mock of the portal directory (email, name, OpCo, Operating Group)
  config.json        deadline, rounds, raters, admins, FX rates, dimensions
```

### Submission rules (enforced server-side)
- One proposal per operating company (matched on OpCo name; a colleague from
  the same OpCo sees and can edit the existing one).
- Title, idea (≤ 300 words, configurable), capital ask > 0, currency in
  USD/CAD/NZD/AUD/BRL/GBP/EUR, and an attestation checkbox.
- Ask is normalised to USD at the indicative rates in `config.json` for
  comparison only; the original amount and currency are kept.
- Editable and withdrawable until the deadline
  (`2026-10-02T23:59:00-04:00`, 11:59 PM ET, by default); locked after.

### Rounds
Every submission enters **Round 1**. Each proposal has one `stage`:
`round1 → round2 → round3 → funded`, or `eliminated` (with the round it left in)
or `withdrawn`.

| Round | Who scores | What they enter | Composite |
|---|---|---|---|
| 1 · Operating Group | Group Presidents, Portfolio Leaders and Chiefs of Staff, each assigned to Operating Groups | one 1 to 5 (1 = do not fund, 3 = solid contender, 5 = fund no matter what) + notes | mean of rater scores, ranked **within Operating Group** |
| 2 · Semifinalists | panel | five dimensions 1 to 5 (vision, market signals, 12-mo ROI, asymmetric upside, execution risk) + notes | mean of dimensions per rater, then mean across raters, ranked overall |
| 3 · Finalists | panel | fund conviction 1 to 5, optional recommended award (USD) + notes | mean conviction, mean recommended award |

All composites are shown to one decimal place.

**Blind scoring**: a rater only ever receives their own score for a proposal.
Composites and other raters' scores exist only in the admin API. An admin can
flip *Reveal panel scores to raters* per round for the discussion phase.

**Moving proposals**: every row on the Round 1, 2 and 3 tabs has its own
*Advance to Round N* (or *Mark funded*) and *Eliminate* buttons, and any column
can be sorted by clicking its heading (default: composite, high to low). Rank is
shown within Operating Group in Round 1 and overall afterwards; ties share a
rank. Eliminated proposals can be restored from the Eliminated tab. A bulk
advance endpoint (`POST /api/admin/advance`) still exists for scripting but has
no button in the UI.

**Round 3 allocation**: the *Round 3 · Allocation* tab shows each finalist's
ask in USD, R2 composite, R3 conviction and average recommended award, with an
inline award field and a running total against the $3M fund. From a proposal's
detail view the admin can record a follow-up request to the CEO and their
response (both visible to Round 3 raters), add finance context (LTM revenue,
performance, purchase price), and mark the proposal *Funded*.

**Reviewer privileges**: the *Reviewers* tab is one row per Banyan team
member: name, title, SSO email, an Admin flag, a checkbox for each round, and
the Operating Groups they may review in Round 1 (none ticked means all). Saving
writes the admin list and the per-round rater lists in `config.json`, which is
what a signed-in email is matched against.

**Exports**: Results CSV (everything incl. per-round composites and dimension
averages), raw submissions, raw scores.

## Putting it on GitHub and hosting a demo

GitHub Pages cannot run this app (Pages serves static files only; the portal
needs the Node process for sign-in, saving and the admin API). Push the code to
a **private** GitHub repo, then run it on a host that runs Node. The repo
includes a Render blueprint.

```bash
git add -A && git commit -m "Growth Challenge portal"
git remote add origin https://github.com/<org>/growth-challenge-site.git
git push -u origin main        # or: master
```

**Render** (about ten minutes): New > Blueprint > choose the repo. `render.yaml`
creates one web service with a 1 GB persistent disk mounted at `/data` and sets:

| Variable | Value | Why |
|---|---|---|
| `GC_DATA_DIR` | `/data` | CSV files live on the disk, so deploys do not wipe them |
| `GC_DEMO_PASSWORD` | `Banyan2026` | Everyone must enter this once at `/gate` before seeing anything |
| `GC_SEED_ON_EMPTY` | `true` | Loads the demo directory and proposals on the very first boot only |
| `GC_SECRET` | generated | Signs the session and gate cookies |

Change the password in the Render dashboard (Environment tab) any time; existing
visitors are signed out of the gate automatically. Unset `GC_DEMO_PASSWORD` to
turn the gate off (for example once SSO is in front of it). To start clean on
the hosted copy, delete the files under `/data` from the Render shell and set
`GC_SEED_ON_EMPTY` to `false` before restarting.

Locally the gate is off unless you run `GC_DEMO_PASSWORD=Banyan2026 npm start`.

## Plugging into the Banyan Business Portal

The app deliberately keeps identity in one place.

1. **SSO**: replace `resolveUserFromRequest(req, cfg)` in `lib/auth.js` with a
   lookup against the portal's session (validate its JWT/session cookie, or
   trust identity headers from an auth proxy) and return
   `{ email, name, title, opco, operating_group }`. Delete `public/login.html`
   and the `/api/auth/*` + `/api/directory` routes. Nothing else changes: roles
   (admin, rater per round, submitter) are derived from the email against
   `config.json`, and the OpCo/Operating Group come from the identity object.
2. **Directory**: `data/users.csv` stands in for the portal's user records.
   In production those fields come from the SSO claims or the portal's user
   API, so the file goes away.
3. **Hosting**: it is a single Node process serving static files and JSON.
   Mount it under a path (e.g. `/growth-challenge`) behind the portal's proxy,
   or lift `public/` into the portal's React app and keep `server.js` as the
   API. The header already mirrors the portal's; the pages could link back to
   `portal.banyansoftware.io` instead of rendering their own header.
4. **Storage**: CSV files were chosen so submissions can be opened directly in
   Sheets, like last year's process. If the volume or concurrency grows, swap
   `lib/store.js` for a database; the rest of the code only calls
   `load(table)` / `save(table, rows)`.

## Things to set before launch
- *Admin > Reviewers*: verify every email. The seed follows the pattern of
  Ryan's address (first initial + last name @banyansoftware.com) but nobody has
  confirmed them. SSO matches people to roles by email, so a wrong address means
  that person sees nothing.
- *Admin > Settings*: deadline, key dates, Operating Groups, FX rates.
- Replace `data/users.csv` with an export of real portal users, or connect SSO.
- Round 1 is seeded as *open* for the demo; set each round's status when you are
  ready (*Admin → Overview*).
- Delete `data/submissions.csv` and `data/scores.csv` (or run the server once
  with an empty `data/` directory) to start clean.

Everything in the seed is placeholder: fictional operating companies, fictional
people, `.example` email domains.
