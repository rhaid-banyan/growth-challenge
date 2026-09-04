'use strict';
// Seeds demo data: a mock portal directory, admins/raters, ~28 proposals and a
// partial set of Round 1 scores so every screen has something to show.
//
//   node scripts/seed.js            → seed (refuses to overwrite existing data)
//   node scripts/seed.js --force    → wipe and reseed
//
// Everything here is placeholder: fictional operating companies, fictional
// people, example.com-style emails. Replace the directory with a real export
// from the Banyan Business Portal and the rater lists with real emails.

const fs = require('fs');
const path = require('path');
const store = require('../lib/store');
const scoring = require('../lib/scoring');

const force = process.argv.includes('--force');
const subPath = store.tablePath('submissions');
if (fs.existsSync(subPath) && store.load('submissions').length && !force) {
  console.error('Data already exists in ' + store.DATA_DIR + '. Re-run with --force to wipe and reseed.');
  process.exit(1);
}

// ---------------------------------------------------------------- directory
// email, name, title, opco, operating_group
const users = [
  // UK and RoE
  ['dean.c@iconi.example', 'Dean Carville', 'CEO', 'ICONI Software', 'UK and RoE'],
  ['phil.m@atamis.example', 'Phil Musgrave', 'CEO', 'Atamis', 'UK and RoE'],
  ['andy.k@intuitive.example', 'Andy Keeley', 'CEO', 'intuitive', 'UK and RoE'],
  ['juan.c@hhs.example', 'Juan Correia', 'CEO', 'HOST Hotel Systems', 'UK and RoE'],
  ['viktor.k@flexi.example', 'Viktor Kuttner', 'CEO', 'Flexi Medical Cloud', 'UK and RoE'],
  // DACH
  ['lena.h@ordoware.example', 'Lena Hartmann', 'Geschäftsführerin', 'Ordoware GmbH', 'DACH'],
  ['markus.b@kraftplan.example', 'Markus Bauer', 'CEO', 'KraftPlan Software', 'DACH'],
  ['sophie.w@zeitlog.example', 'Sophie Weber', 'CEO', 'ZeitLog AG', 'DACH'],
  // MIU
  ['carla.r@meterwise.example', 'Carla Ruiz', 'CEO', 'MeterWise', 'MIU'],
  ['james.o@gridlane.example', 'James Okafor', 'CEO', 'GridLane Systems', 'MIU'],
  ['priya.n@fieldflow.example', 'Priya Natarajan', 'CEO', 'FieldFlow', 'MIU'],
  ['tom.g@wellsync.example', 'Tom Gallagher', 'President', 'WellSync', 'MIU'],
  // GovTech
  ['maria.l@civicledger.example', 'Maria Lopez', 'CEO', 'CivicLedger', 'GovTech'],
  ['anne.d@courtstream.example', 'Anne Dubois', 'CEO', 'CourtStream', 'GovTech'],
  // EdTech
  ['rachel.k@campusloop.example', 'Rachel Kim', 'CEO', 'CampusLoop', 'EdTech'],
  ['daniel.m@gradebook.example', 'Daniel Mensah', 'CEO', 'GradeBook Pro', 'EdTech'],
  ['ines.f@escolaplus.example', 'Inês Ferreira', 'CEO', 'EscolaPlus', 'EdTech'],
  // Healthcare
  ['sam.p@clinicore.example', 'Sam Patel', 'CEO', 'CliniCore', 'Healthcare'],
  ['helen.w@therapynote.example', 'Helen Wright', 'CEO', 'TherapyNote', 'Healthcare'],
  ['luis.a@dentalink.example', 'Luis Almeida', 'CEO', 'DentaLink', 'Healthcare'],
  // Transportation and Logistics
  ['greg.s@fleetmark.example', 'Greg Sullivan', 'CEO', 'FleetMark', 'Transportation, Logistics, and Longtail'],
  ['nadia.h@portside.example', 'Nadia Haddad', 'CEO', 'Portside Software', 'Transportation, Logistics, and Longtail'],
  ['eric.l@routecraft.example', 'Eric Lindqvist', 'CEO', 'RouteCraft', 'Transportation, Logistics, and Longtail'],
  // Communications
  ['jw.s@presspage.example', 'Jan-Willem Schalkwijk', 'CEO', 'Presspage', 'Media and Communications'],
  ['olivia.b@newsdesk.example', 'Olivia Bennett', 'CEO', 'Newsdesk Suite', 'Media and Communications'],
  ['kai.z@signalhub.example', 'Kai Zhang', 'CEO', 'SignalHub', 'Media and Communications'],
  // Financial Services
  ['nora.b@lendcore.example', 'Nora Bishop', 'CEO', 'LendCore', 'Financial Services'],
  ['david.o@trustbook.example', 'David Okonkwo', 'CEO', 'TrustBook Systems', 'Financial Services'],
  // ANZ
  ['hamish.d@shapeshifter.example', 'Hamish Dean', 'CEO', 'Shapeshifter', 'MIU'],
  ['brenton.o@touchstream.example', 'Brenton Ough', 'CEO', 'Touchstream', 'ANZ'],
  ['mei.t@harbourbooks.example', 'Mei Tan', 'CEO', 'HarbourBooks', 'ANZ'],
  ['liam.w@paddockiq.example', 'Liam Walsh', 'CEO', 'PaddockIQ', 'ANZ'],
];

// ---------------------------------------------------------------- config
// Start from the built-in defaults so a reseed also resets rounds, groups and dates.
const cfg = JSON.parse(JSON.stringify(store.DEFAULT_CONFIG));
// Emails for the Banyan team follow the pattern of Ryan's address
// (first initial + last name @banyansoftware.com). VERIFY EACH ONE before
// launch: SSO matches people to their roles by email. Edit in Admin > Reviewers.
const B = (first, last) => (first[0] + last).toLowerCase().replace(/[^a-z]/g, '') + '@banyansoftware.com';
const T = 'Transportation, Logistics, and Longtail', FS = 'Financial Services', MC = 'Media and Communications';
cfg.admins = [
  { email: 'rhaid@banyansoftware.com', name: 'Ryan Haid', title: 'Chief of Staff' },
  { email: B('Alex', 'Jarzebowicz'), name: 'Alex Jarzebowicz', title: '' },
];
cfg.rounds[1].status = 'open';
cfg.rounds[1].raters = [
  { email: B('Darren', 'Harris'), name: 'Darren Harris', title: 'Group President, Healthcare and EdTech', groups: ['Healthcare', 'EdTech'] },
  { email: B('Adam', 'Cole'), name: 'Adam Cole', title: 'Portfolio Leader, Healthcare', groups: ['Healthcare'] },
  { email: B('Oliver', 'Wreford'), name: 'Oliver Wreford', title: 'Portfolio Leader, EdTech', groups: ['EdTech'] },
  { email: B('Tom', 'Prendiville'), name: 'Tom Prendiville', title: 'Chief of Staff, EdTech', groups: ['EdTech'] },
  { email: B('Valentina', 'Matheus'), name: 'Valentina Matheus', title: 'Chief of Staff, Healthcare', groups: ['Healthcare'] },
  { email: B('Tristan', 'Jordan'), name: 'Tristan Jordan', title: 'OP, Transportation and Financial Services', groups: [T, FS] },
  { email: B('Scott', 'Burgess'), name: 'Scott Burgess', title: 'Portfolio Leader, Transportation', groups: [T] },
  { email: B('Amrith', 'Krushnakumaar'), name: 'Amrith Krushnakumaar', title: 'Chief of Staff, Financial Services', groups: [FS] },
  { email: B('Bridget', 'Zakrzewski'), name: 'Bridget Zakrzewski', title: 'Chief of Staff, Transportation', groups: [T] },
  { email: B('Arun', 'Srinivasan'), name: 'Arun Srinivasan', title: 'Group President, MIU and GovTech', groups: ['MIU', 'GovTech'] },
  { email: B('Stephen', 'Ryczek'), name: 'Stephen Ryczek', title: 'Portfolio Leader, GovTech', groups: ['GovTech'] },
  { email: B('Claire', 'Rollins'), name: 'Claire Rollins', title: 'Portfolio Leader, UK and RoE', groups: ['UK and RoE'] },
  { email: B('Julie', 'Koegenboeg'), name: 'Julie Koegenboeg', title: 'Portfolio Leader, UK and RoE', groups: ['UK and RoE'] },
  { email: B('Henry', 'Hunter'), name: 'Henry Hunter', title: 'Chief of Staff, UK and RoE', groups: ['UK and RoE'] },
  { email: B('Erleyene', 'Brookman'), name: 'Erleyene Brookman', title: 'Portfolio Leader, UK and RoE', groups: ['UK and RoE'] },
  { email: B('Maria Lucia', 'Pardo'), name: 'Maria Lucia Pardo', title: 'Chief of Staff, UK and RoE', groups: ['UK and RoE'] },
  { email: B('Kay', 'Ingo'), name: 'Kay Ingo', title: 'Group President, DACH', groups: ['DACH'] },
  { email: B('Reed', 'Fawell'), name: 'Reed Fawell', title: 'Group President, Communications and Longtail', groups: [MC] },
  { email: B('Susie', 'Hendrick'), name: 'Susie Hendrick', title: 'Portfolio Leader, Communications and Longtail', groups: [MC] },
  { email: B('Ryan', 'Salisbury'), name: 'Ryan Salisbury', title: 'Chief of Staff, Communications and Longtail', groups: [MC] },
  { email: B('Jordan', 'Di Paolo'), name: 'Jordan Di Paolo', title: 'Chief of Staff, Communications and Longtail', groups: [MC] },
  { email: B('David', 'Brice'), name: 'David Brice', title: 'Group President, APAC', groups: ['ANZ'] },
];
cfg.rounds[2].raters = [
  { email: 'rhaid@banyansoftware.com', name: 'Ryan Haid', title: 'Chief of Staff', groups: [] },
  { email: B('Alex', 'Jarzebowicz'), name: 'Alex Jarzebowicz', title: '', groups: [] },
  { email: B('Melissa', 'Hammerle'), name: 'Melissa Hammerle', title: 'President, Portfolio', groups: [] },
  { email: B('Luke', 'Reimer'), name: 'Luke Reimer', title: 'S&M Operating Partner', groups: [] },
];
cfg.rounds[3].raters = [
  { email: 'rhaid@banyansoftware.com', name: 'Ryan Haid', title: 'Chief of Staff', groups: [] },
  { email: B('Alex', 'Jarzebowicz'), name: 'Alex Jarzebowicz', title: '', groups: [] },
  { email: B('Tonya', 'Cross'), name: 'Tonya Cross', title: 'COO', groups: [] },
  { email: B('David', 'Berkal'), name: 'David Berkal', title: 'CEO', groups: [] },
];
store.saveConfig(cfg);

// ---------------------------------------------------------------- proposals
// [submitter email, title, ask, currency, idea]
const proposals = [
  ['dean.c@iconi.example', 'Programme Builder AI Assistant for Enspirio', 200000, 'GBP',
    'We propose a Programme Builder assistant that reads a customer\'s programme documentation, often 200+ pages, and produces a recommended Enspirio configuration in under an hour instead of three to six weeks of business-analyst time.\n\nExecution: two engineers and one domain BA for nine months, building on our existing configuration API. First 90 days: ingest the last 40 implementations as training examples and ship an internal-only version to our onboarding team. The largest risk is configuration accuracy on unusual programmes; we mitigate with a mandatory human review step until accuracy exceeds 95% on the back-catalogue.\n\nMarket unlock: customers currently pay around £10.5k for a medium programme build and larger ones run multiple programmes a year. A £20k per-build price or £40–50k unlimited licence is attractive to the 30 customers who told us onboarding time is the main blocker to expanding usage. It also opens the mid-market segment we cannot serve profitably today.\n\nROI: £120k of internal BA capacity redeployed to sales engineering plus £250k of new build revenue in the first twelve months against a £200k ask.'],
  ['phil.m@atamis.example', 'Data Insight Hub for public-sector procurement benchmarks', 365000, 'GBP',
    'Atamis holds procurement data across 200+ UK public bodies. Today it sits in customer silos. We propose a Data Insight Hub that consolidates anonymised spend, supplier and cycle-time data into benchmarks and predictive analytics sold as a premium tier.\n\nExecution: a data engineer, an analyst and a part-time product manager for twelve months. Ninety-day milestone: benchmark reports for the NHS trust segment, piloted free with six "innovation partner" customers already signed up in principle. Risk: data-sharing consent; we have legal sign-off on the anonymisation approach and will make participation opt-in.\n\nMarket unlock: this moves us from workflow tool to strategic partner for procurement directors and opens a sale to central government bodies that do not buy our transactional product.\n\nROI: 25 customers at £15k per year within twelve months is £375k ARR, with 80%+ margin because the data already exists. Payback inside the first year on a £365k ask.'],
  ['andy.k@intuitive.example', 'Cruise inventory and booking in iVector', 175000, 'GBP',
    'iVector is excluded from cruise-centric RFPs and disadvantaged wherever cruise is a requirement. We propose adding live cruise inventory, pricing and booking to the platform.\n\nExecution: MVP integration with two cruise lines in three months, full feature set in nine, using our existing integration framework (400+ supplier connections to date). Team: two developers and a product owner. Risk: supplier contracting timelines, mitigated by starting with the two lines where relationships already exist.\n\nMarket unlock: expands our UK TAM by an estimated £10.7m ARR and improves win rates in a £5.2m segment of our current pipeline. A cruise-only competitor exists but no full-service platform offers this.\n\nROI: a targeted campaign to 67 operators; we expect 25–30 engagements and at least two signed deals worth ~£300k ARR within twelve months, ~£900k within 24. Payback in under a year.'],
  ['juan.c@hhs.example', 'Cancellation prediction and recovery for hotels', 150000, 'EUR',
    'A 100-room hotel at 70% occupancy sees about 140 cancellations a month. We propose a model that flags high-risk bookings and an automated, multilingual outreach flow through Host PMS that strengthens guest commitment before they cancel.\n\nExecution: three-month A/B pilot across ten hotels already committed, then rollout to the base. Team: one data scientist and one developer, with our revenue-management lead as product owner. Risk: guest response rates below plan; our pilot design measures this in the first 90 days before we scale.\n\nMarket unlock: success-fee pricing (7.5% of recovered revenue) means hotels pay only for results, which opens the small-independent segment that resists subscription upsells.\n\nROI: recovering 20% of contacted bookings is roughly €4,200 per hotel per month. Scaling to 300 hotels in twelve months yields over €1m of gross recovery revenue and €500k+ of contribution against a €150k ask.'],
  ['viktor.k@flexi.example', 'AI-powered dental supplies marketplace inside Flexi-Dent', 135000, 'USD',
    'Hungarian dental practices buy roughly HUF 30bn of supplies a year with 8–12% distributor commissions and opaque pricing. Because all invoices flow through the tax authority in real time, Flexi already knows who bought what, when and for how much.\n\nExecution: integrate a supplies webshop into Flexi-Dent that tracks stock depletion from treatments, matches identical products across suppliers, and alerts practices to the cheapest source; purchases run through Flexi Pay. Team: three developers for ten months. Risk: supplier onboarding; we have letters of intent from four distributors covering ~40% of the market.\n\nMarket unlock: a new revenue stream from supplier fees and payment processing, never from our clients, and a foundation for the same model in our Romanian and Slovak expansion.\n\nROI: $1.15m ARR potential at full adoption; 18% return in year one, 50% in year two, on a $135k ask.'],
  ['lena.h@ordoware.example', 'Ordoware Connect: e-invoicing compliance module for German SMEs', 220000, 'EUR',
    'Germany\'s mandatory B2B e-invoicing phases in from 2027, and our 1,900 SME customers will need compliant issuance and receipt. We propose Ordoware Connect: a certified e-invoicing module (XRechnung, ZUGFeRD, Peppol) sold as an add-on.\n\nExecution: certification work with a partner already engaged, two developers for eight months, and a launch campaign timed to the regulatory deadline. Risk: certification slippage; we start with the receipt path, which has the earliest deadline.\n\nMarket unlock: every customer is a prospect, and compliance is the wedge into the 8,000 German firms on legacy competitors who will not deliver in time.\n\nROI: €9/month per customer on 60% of the base is €1.2m ARR within twelve months of launch; €220k ask covers build and certification.'],
  ['markus.b@kraftplan.example', 'Expand KraftPlan into Austria and Switzerland', 300000, 'EUR',
    'KraftPlan leads maintenance planning for German mid-size energy utilities but has no presence in Austria or Switzerland, where the same regulatory drivers apply. We propose a dedicated two-person DACH expansion team and localisation of the product.\n\nExecution: hire a sales lead in Vienna and a solutions consultant; localise for Austrian and Swiss grid regulations in the first six months; attend the two key industry events. Risk: long utility sales cycles, mitigated by our existing referenceable customers who operate cross-border.\n\nMarket unlock: 140 addressable utilities in Austria and Switzerland, roughly doubling our TAM, with no incumbent vertical solution.\n\nROI: four new customers at €90k ACV in twelve months (€360k ARR) with an eighteen-month payback on the €300k ask; the pipeline after that is what matters.'],
  ['sophie.w@zeitlog.example', 'ZeitLog mobile time capture for field crews', 90000, 'EUR',
    'Our customers\' field crews still submit paper timesheets that office staff key in. We propose a mobile capture app with offline support and photo receipts that syncs into ZeitLog.\n\nExecution: one mobile developer and one backend developer for six months; pilot with three customers who have asked for this. Risk: adoption by crews; we are designing for a two-tap daily interaction.\n\nMarket unlock: enables selling to construction firms with 50+ field staff, a segment that has rejected us on this gap.\n\nROI: €4 per user per month on an addressable 4,000 seats is €190k ARR; €90k ask.'],
  ['carla.r@meterwise.example', 'MeterWise Insights: usage analytics for co-op utilities', 350000, 'USD',
    'MeterWise bills 180 rural electric co-ops. Their boards increasingly want to see load patterns, EV adoption and outage correlations that we already hold the data for. We propose Insights, a self-serve analytics layer sold per co-op.\n\nExecution: two data engineers and a designer for nine months, using our existing warehouse; five co-ops in a design-partner program have committed to pay on launch. Risk: performance on our largest customers\' data volumes; we will validate the architecture on the top three in the first 90 days.\n\nMarket unlock: opens the sale to the 600 co-ops on competitor billing platforms, since Insights can ingest their data as a standalone product.\n\nROI: $25k per year on 40 co-ops within twelve months is $1m ARR against a $350k ask.'],
  ['james.o@gridlane.example', 'Outage management module for municipal utilities', 275000, 'USD',
    'Small municipal utilities cannot afford enterprise outage management systems and run on phones and whiteboards. GridLane already has their customer and meter data. We propose a lightweight OMS module.\n\nExecution: three developers for ten months; two municipals are pilot partners. Risk: integration with diverse SCADA systems; we will support the two most common first.\n\nMarket unlock: a $12k-per-year module for 400 addressable utilities, plus a differentiator against our two main competitors in new-logo bids.\n\nROI: 30 customers in twelve months is $360k ARR on a $275k ask.'],
  ['priya.n@fieldflow.example', 'FieldFlow AI dispatcher', 180000, 'USD',
    'Dispatchers at our water-utility customers spend hours a day manually sequencing work orders. We propose an AI dispatcher that proposes daily routes and re-sequences work as emergencies arrive, with a human approving each plan.\n\nExecution: one ML engineer and one developer for eight months; three customers in a pilot. Risk: trust; the dispatcher stays in the loop and every recommendation is explainable.\n\nMarket unlock: repositions FieldFlow from a record-keeping tool to a productivity tool, supporting a 30% price uplift at renewal and a new pitch to the 250 utilities on competitor systems.\n\nROI: uplift on 60 renewals in twelve months is $290k ARR against a $180k ask.'],
  ['tom.g@wellsync.example', 'WellSync regulatory reporting for Texas and New Mexico', 120000, 'USD',
    'Independent oil and gas operators file the same production data with three regulators in slightly different formats. WellSync holds the data. We propose automated regulatory filing for Texas RRC and New Mexico OCD.\n\nExecution: two developers for six months; the formats are documented and we have customers willing to test. Risk: regulator format changes, handled by a maintenance budget.\n\nMarket unlock: an add-on for all 300 customers and the clearest reason for the 900 operators on spreadsheets to adopt us.\n\nROI: $3k per year per customer on 120 customers is $360k ARR; $120k ask.'],
  ['maria.l@civicledger.example', 'Grant management for mid-size counties', 400000, 'USD',
    'Federal infrastructure and resilience grants have created a compliance burden counties cannot staff. CivicLedger holds the general ledger; we propose a grant management module for tracking awards, drawdowns, and reporting.\n\nExecution: four developers and a product manager for twelve months; two counties are committed design partners. Risk: scope creep across grant programs, handled by launching with the three largest federal programs.\n\nMarket unlock: a $30k-per-year module for our 90 counties, and the first product we can sell standalone into the 1,200 counties on competitor ERPs.\n\nROI: 25 module sales plus 5 standalone within twelve months is roughly $900k ARR against a $400k ask.'],
  ['anne.d@courtstream.example', 'CourtStream remote hearing scheduling', 210000, 'CAD',
    'Provincial courts hold more hearings remotely than in person, but scheduling still runs on our in-person model. We propose a remote-hearing scheduling and notification product integrated with the major video platforms.\n\nExecution: three developers for nine months; one province is a pilot partner. Risk: platform integration certification timelines.\n\nMarket unlock: opens sales to tribunals and administrative bodies outside our traditional court base, a segment twice our current TAM.\n\nROI: CAD 550k ARR from four new bodies plus upsell to existing customers within eighteen months; CAD 210k ask.'],
  ['rachel.k@campusloop.example', 'CampusLoop Career Signals for community colleges', 250000, 'USD',
    'Community colleges are funded increasingly on employment outcomes but have little visibility into where graduates land. CampusLoop holds enrolment and completion data; we propose Career Signals, which matches completions to labour-market outcomes and reports against state metrics.\n\nExecution: a data partnership already negotiated, two engineers and an analyst for nine months, and a pilot with three colleges in Texas. Risk: data-matching accuracy; we will report confidence intervals rather than point estimates.\n\nMarket unlock: a $20k add-on for our 140 colleges, and a standalone product for the 900 colleges on competitor SIS platforms.\n\nROI: 40 sales in twelve months is $800k ARR against a $250k ask.'],
  ['daniel.m@gradebook.example', 'GradeBook Pro parent app', 85000, 'USD',
    'Parents at our 600 K-12 schools ask for a mobile app; we have only a web portal. We propose a native parent app with grades, attendance and messaging.\n\nExecution: two mobile developers for five months. Risk: app-store review; we have done this before at a prior company.\n\nMarket unlock: parent-facing tools are a requirement in most district RFPs we lose.\n\nROI: improves win rate on an estimated $1.5m of annual RFP volume; $85k ask.'],
  ['ines.f@escolaplus.example', 'EscolaPlus tuition financing marketplace', 600000, 'BRL',
    'Private schools in Brazil lose 8–12% of families each year to affordability. EscolaPlus manages billing for 400 schools. We propose a financing marketplace where partner lenders offer instalment plans at the point of enrolment.\n\nExecution: two developers and a partnerships lead for nine months; two lenders have signed term sheets. Risk: regulatory approval for the referral model, on which we have legal guidance.\n\nMarket unlock: a referral-fee revenue stream and a reason for the 3,000 schools on competitor systems to switch.\n\nROI: R$1.8m of referral fees in the first twelve months at planned volumes; R$600k ask.'],
  ['sam.p@clinicore.example', 'CliniCore prior-authorisation automation', 320000, 'USD',
    'Specialty clinics spend 14 staff hours a week per physician on prior authorisations. CliniCore holds the clinical and payer data. We propose automating submission and status tracking for the ten largest payers.\n\nExecution: three engineers for twelve months, integrating with two clearinghouses; four clinics are pilot partners. Risk: payer portal changes, mitigated by clearinghouse APIs where available.\n\nMarket unlock: a $15k-per-provider-group module for our 220 groups, and the clearest ROI story we have ever had for new logos.\n\nROI: 60 groups within twelve months is $900k ARR against a $320k ask.'],
  ['helen.w@therapynote.example', 'TherapyNote outcomes dashboards for group practices', 110000, 'USD',
    'Payers increasingly ask behavioural-health practices to demonstrate outcomes. TherapyNote collects standard measures; we propose outcomes dashboards and payer-ready reports.\n\nExecution: two developers and a clinical advisor for six months. Risk: measure standardisation across practices.\n\nMarket unlock: a requirement for the value-based contracts our larger customers are pursuing, and a wedge into 200+ group practices.\n\nROI: $6k per year on 80 practices is $480k ARR; $110k ask.'],
  ['luis.a@dentalink.example', 'DentaLink patient recall and reactivation engine', 95000, 'USD',
    'Dental practices lose 20–30% of patients to lapsed recall. We propose an automated recall and reactivation engine with two-way texting and online booking.\n\nExecution: two developers for five months; pilot with 20 practices. Risk: carrier messaging compliance, handled through a registered provider.\n\nMarket unlock: a $200/month add-on across 1,500 practices, and a new-logo differentiator.\n\nROI: 400 practices in twelve months is $960k ARR against a $95k ask.'],
  ['greg.s@fleetmark.example', 'FleetMark ELD and compliance for small carriers', 240000, 'USD',
    'Carriers with under 20 trucks use FleetMark for dispatch but a separate ELD vendor for hours-of-service. We propose our own ELD with integrated compliance reporting.\n\nExecution: hardware partner selected; three developers for ten months to certify and integrate. Risk: FMCSA certification timing.\n\nMarket unlock: a $40-per-truck-per-month line across 9,000 trucks in the base and a bundle that undercuts standalone ELD vendors.\n\nROI: 3,000 trucks in twelve months is $1.4m ARR on a $240k ask.'],
  ['nadia.h@portside.example', 'Portside customs documentation automation', 190000, 'USD',
    'Freight forwarders using Portside re-key shipment data into customs filings. We propose automated customs documentation for US and Canadian entries.\n\nExecution: two developers and a customs specialist for eight months. Risk: broker relationships; we position as a tool for brokers, not a replacement.\n\nMarket unlock: opens the mid-size forwarder segment that requires customs integration.\n\nROI: $5k per year on 90 customers is $450k ARR; $190k ask.'],
  ['eric.l@routecraft.example', 'RouteCraft last-mile optimisation for regional couriers', 130000, 'USD',
    'Regional couriers plan routes by hand. RouteCraft manages their orders; we propose an optimisation engine with driver app integration.\n\nExecution: one optimisation engineer and one developer for seven months; three couriers in a pilot. Risk: real-world constraints not captured by the model; the pilot exists to find them.\n\nMarket unlock: repositions us against the two enterprise vendors that ignore sub-50-vehicle couriers.\n\nROI: $9k per year on 50 couriers is $450k ARR; $130k ask.'],
  ['nora.b@lendcore.example', 'LendCore embedded credit decisioning for community banks', 300000, 'USD',
    'Community banks using LendCore for loan servicing still make credit decisions in spreadsheets and email. We propose an embedded decisioning module that scores applications against the bank\'s own policy and portfolio history, with every recommendation explainable to an examiner.\n\nExecution: two engineers and a credit-risk analyst for ten months; three banks have agreed to pilot, and our compliance counsel has reviewed the model-governance approach. Risk: examiner acceptance, which is why explainability is the first feature, not the last.\n\nMarket unlock: a $40k-per-year module for our 90 banks, and our first product that credit unions on competitor cores can buy standalone.\n\nROI: 20 sales in twelve months is $800k ARR on a $300k ask.'],
  ['david.o@trustbook.example', 'TrustBook client portal for trust and estate administrators', 140000, 'USD',
    'Trust companies using TrustBook field hundreds of beneficiary calls a month asking for statements and distribution status. We propose a beneficiary portal with statements, documents and secure messaging.\n\nExecution: two developers and a designer for six months; two customers are pilot partners. Risk: identity verification for beneficiaries, handled through an established provider.\n\nMarket unlock: a $12k-per-year add-on across 60 customers and a requirement in most RFPs we currently lose to the two larger vendors.\n\nROI: 35 customers in twelve months is $420k ARR on a $140k ask.'],
  ['jw.s@presspage.example', 'Presspage Discover: executive insights tier', 380000, 'EUR',
    'Presspage sells €30k contracts to communications teams but misses the executive layer where larger budgets live. We propose Presspage Discover: a premium tier with media-monitoring integration, predictive insights and an executive dashboard on reputation and communication ROI.\n\nExecution: a data engineer, an ML engineer and a front-end developer for twelve months, delivered in two phases: internal data first, external monitoring data second. Risk: over-scoping; phase one ships a customer-usable product on our own data alone.\n\nMarket unlock: a €20k add-on for 200+ existing customers and a repositioning of new sales toward CMO/CFO buyers at €100k+ contracts. Enterprise clients consistently ask for analytics we cannot deliver today.\n\nROI: 50 add-on sales in the first twelve months is €1m ARR; payback in 8–10 months on a €380k ask.'],
  ['olivia.b@newsdesk.example', 'Newsdesk Suite podcast and audio publishing', 140000, 'GBP',
    'Our newsroom customers are launching podcasts on standalone tools. We propose audio publishing, hosting and analytics inside Newsdesk Suite.\n\nExecution: two developers for six months; five customers have asked for this. Risk: hosting costs at scale, priced into the tier.\n\nMarket unlock: a £6k-per-year add-on and a reason for regional publishers to consolidate on us.\n\nROI: 40 customers in twelve months is £240k ARR; £140k ask.'],
  ['kai.z@signalhub.example', 'SignalHub SMS-to-RCS migration for enterprise alerts', 200000, 'USD',
    'Enterprises using SignalHub for alerts are moving from SMS to RCS and rich messaging. We propose an RCS channel with rich templates and delivery analytics.\n\nExecution: two developers for seven months; carrier agreements in progress. Risk: carrier availability by region, so we launch in the US first.\n\nMarket unlock: higher-margin messaging and a differentiator against commodity SMS gateways.\n\nROI: 20% margin uplift on $2m of messaging revenue plus $300k of new customers; $200k ask.'],
  ['hamish.d@shapeshifter.example', 'AI pattern prediction from tech packs', 500000, 'USD',
    'Brands lose billions annually from 15–30% fabric costing errors at the design stage, because patterns are only created after sampling. We propose a dual AI system that predicts fabric consumption directly from tech packs: computer vision on sketches to identify style features, and a regression model trained on our historical pattern library to estimate consumption.\n\nExecution: two ML engineers and one product engineer for twelve months; three brand customers have agreed to supply training data and pilot the output. First 90 days: baseline model on our own 12,000-pattern archive. Risk: prediction accuracy on novel styles; we will publish accuracy bands and position the tool for costing, not cutting.\n\nMarket unlock: 500+ brands and 2,000+ manufacturers who never buy pattern software today, in a $200m market for pre-sampling prediction.\n\nROI: $600k ARR within twelve months from ten brand customers at $60k, on a $500k ask; the asymmetric upside is a new product category.'],
  ['brenton.o@touchstream.example', 'Touchstream streaming QoE for sports rights holders', 300000, 'AUD',
    'Sports rights holders are moving direct-to-consumer and cannot see viewer quality-of-experience across their distribution partners. Touchstream monitors streams for broadcasters; we propose a QoE product for rights holders aggregating data across their partners.\n\nExecution: two engineers and a solutions consultant for nine months; one league is a design partner. Risk: partner data access, mitigated by starting with public-signal monitoring.\n\nMarket unlock: a new buyer (rights holders) with larger budgets than our broadcaster base, in a segment no competitor serves.\n\nROI: three rights holders at A$250k in twelve months is A$750k ARR against an A$300k ask.'],
  ['mei.t@harbourbooks.example', 'HarbourBooks embedded payments for marine trades', 150000, 'NZD',
    'Marine trade businesses using HarbourBooks invoice through us but collect payments elsewhere. We propose embedded card and bank payments with automatic reconciliation.\n\nExecution: payments partner selected; two developers for six months. Risk: partner onboarding timelines.\n\nMarket unlock: transaction revenue on NZ$120m of annual invoicing, plus a lower-churn product.\n\nROI: 0.6% take rate on 40% adoption is NZ$290k ARR; NZ$150k ask.'],
  ['liam.w@paddockiq.example', 'PaddockIQ carbon reporting for livestock farms', 220000, 'AUD',
    'Australian processors and banks are starting to require on-farm emissions data. PaddockIQ already tracks herd and pasture data for 1,100 farms. We propose a carbon reporting module aligned to the national framework.\n\nExecution: one agronomist and two developers for eight months; two processors have asked to pilot with their suppliers. Risk: methodology changes, tracked by our advisory partner.\n\nMarket unlock: processor-sponsored deployments across their supplier bases, a channel that could triple our farm count.\n\nROI: A$800 per farm per year on 600 farms within twelve months is A$480k ARR; A$220k ask.'],
];

const userByEmail = Object.fromEntries(users.map((u) => [u[0], u]));
const submissions = [];
let day = new Date('2026-09-08T09:00:00-07:00').getTime();
for (const [email, title, ask, currency, idea] of proposals) {
  const u = userByEmail[email];
  day += 3600 * 1000 * (5 + Math.floor(Math.random() * 30));
  const ts = new Date(day).toISOString();
  submissions.push({
    id: store.newId('gc'), submitted_at: ts, updated_at: ts,
    email, name: u[1], title_role: u[2], opco: u[3], operating_group: u[4],
    title, idea, word_count: String((idea.match(/\S+/g) || []).length),
    capital_ask: String(ask), currency, capital_ask_usd: String(scoring.toUsd(ask, currency, cfg.fx_to_usd) ?? ''),
    stage: 'round1', eliminated_in: '', award_usd: '', follow_up_request: '', follow_up_response: '',
    ltm_revenue: '', ltm_growth: '', purchase_price: '', admin_notes: '',
  });
}

// ---------------------------------------------------------------- partial Round 1 scores
// Deterministic-ish pseudo random so reseeds look similar.
let seed = 42; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
const scores = [];
for (const sub of submissions) {
  for (const rater of cfg.rounds[1].raters) {
    const covers = !rater.groups.length || rater.groups.includes(sub.operating_group);
    if (!covers) continue;
    if (rnd() < 0.3) continue; // leave ~30% unscored so progress bars are meaningful
    const base = 2 + Math.round(rnd() * 3); // 2..5
    const s = Math.max(1, Math.min(5, base + (rnd() < 0.3 ? -1 : 0)));
    const notes = ['', '', 'Strong customer signal; ask feels right-sized.', 'Would want to see the pipeline behind the ARR claim.', 'They will likely do this anyway without funding.', 'Execution risk is the concern here.', 'Best idea in the group.'][Math.floor(rnd() * 7)];
    scores.push({ id: store.newId('sc'), submission_id: sub.id, round: '1', rater_email: rater.email, rater_name: rater.name, score: String(s), d1: '', d2: '', d3: '', d4: '', d5: '', recommended_award_usd: '', notes, updated_at: new Date(day + 86400000 * 20 + rnd() * 86400000 * 3).toISOString() });
  }
}

store.save('users', users.map(([email, name, title, opco, operating_group]) => ({ email, name, title, opco, operating_group })));
store.save('submissions', submissions);
store.save('scores', scores);

console.log(`Seeded ${users.length} directory users, ${submissions.length} proposals and ${scores.length} Round 1 scores into ${store.DATA_DIR}`);
console.log('Admin: rhaid@banyansoftware.com · Round 1 is open. Sign in at /login to try it.');
