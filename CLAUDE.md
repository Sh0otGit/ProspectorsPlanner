# Prospector's Planner

Course planning tool for UTEP students. Searches the sections offered next
term, ranks the instructors teaching them, and outputs a conflict-free schedule
plus a CRN list ready to paste into Goldmine at registration time.

**Status:** the public site runs on real data (Build order phase 3, done
2026-08-19) -- `server/lib/catalog.js` joins the scraped `sections`,
`instructors` and `evaluations` tables into the same per-course shape the
prototype used to get from a fabricated `CATALOG`, served through
`/api/term`, `/api/courses` and `/api/course`. `prototype/js/data.js` (the
fabricated `CATALOG`/`REVIEWS`) is gone. There is no degree-evaluation upload
or "your unmet requirements" feature: that entire step was cut rather than
built (see Build order item 4), so course selection is a real search against
every course actually offered this term, permanently, not a personalized
list waiting on a future parser. The flow is four steps -- Courses,
Availability, Instructors, Schedule -- not five.
Rate My Professors is now scraped too (`scrapers/rmp.js`, done 2026-08-19),
a deliberate exception to this project's otherwise legally-clean data
sourcing, since RMP's own ToS prohibits it; see Data sources below for the
reasoning and CLAUDE.md's own record of that decision. Plus a
password-gated admin panel (`server/`, plain `node:http`, no framework) and
working scrapers (`scrapers/`) for HB 2504 evaluations and the public Banner
class schedule. Run with `ADMIN_PASSWORD=yourpassword node server/index.js`;
it serves the public site and the admin panel (`/admin/login.html`) from one
process on port 8420. No build step, no npm dependencies anywhere in the
project.

Not affiliated with, sponsored by or endorsed by The University of Texas at El
Paso.

---

## Non-negotiable constraints

### 1. No UTEP trademarks anywhere

Independent project, not a University service. Per UTEP's Visual Brand and
Editorial Style Guide (v1.1, Jan 2024), student organizations are "separate
entities from the University" and "generally prohibited from using UTEP
name/visuals without approval."

**Never add:** the acronym logo (flat or classic), the boxmark, the pick or
spirit marks, any University or college seal, Paydirt Pete (athletics-only,
the single most restricted asset in the guide), the Tungsten typeface, "UTEP"
in the product name or domain, UTEP's address/phone as contact info, or
breadcrumbs/chrome implying the tool lives on utep.edu.

**Allowed:** the published brand colors, and naming UTEP descriptively
("Course planning for UTEP students" -- nominative use), linking to utep.edu /
goldmine9.utep.edu / hb2504.utep.edu, and data published under HB 2504.

**Required, always visible:** a non-affiliation disclaimer in the top utility
bar and in the footer. The footer states the project is independent, uses no
UTEP mark, and references UTEP only to describe who it serves.

Free and open source changes none of this -- trademark is about confusion over
source, not money.

### 2. Never show a raw average as a ranking

Evaluation response counts vary from 4 to 250. A raw mean puts statistical
noise at the top of the list. Always apply the shrinkage below, and always
display the response count next to the score.

---

## Scoring

Instructor score is a 50/50 blend of the UTEP evaluation average and the Rate
My Professors score, both on a 5-point scale. The evaluation average is shrunk
toward the university mean before blending:

```
adjusted = (C * m + n * raw) / (C + n)

m = 4.20   global/university mean
C = 12     prior weight, in responses
n          response count for that instructor
raw        published evaluation average
```

A 5.00 from four students lands near the mean. A 4.80 from sixty stays near
4.80. Both constants are guesses pending the real distribution from Phase 1
below.

Rules that follow:

- Rank on the **instructor** rating, not the course rating. A required weeder
  course tanks the course rating through no fault of the professor.
- Weight recent terms higher when aggregating. 2019 numbers say little about
  how someone teaches now.
- Instructors with no data get their own bucket, sorted last but never hidden.
  "No data" is never rendered as a low score.
- Flag low-n instructors explicitly in the UI (currently n < ~10).

---

## Data sources

| Source | Gives | Auth | Notes |
|---|---|---|---|
| `hb2504.utep.edu` | Instructor eval scores, per section, back to ~2019 | none | Statute-mandated public posting. Legally clean. The real signal. Re-verified 2026-08-18, works exactly as below. |
| `catalog.utep.edu/course-search` | Static course catalog: title, description, credit hours, prerequisites | none | A Leepfrog/CourseLeaf "FOSE" JSON API. No CRNs, no seats, no instructors, no meeting times -- catalog-year granularity, not per-term sections. Confirmed working 2026-08-18. Useful only for course descriptions/prereqs, not scheduling. |
| `goldmine9.utep.edu` (Banner 9 Self-Service) | What a student actually registers with: CRN, days, times, room, instructor, seats | **CAS login required** | Confirmed 2026-08-18: the entire app, including class search, redirects to `cas.utep.edu` SSO. No anonymous access at all. This supersedes the old Banner 8 OWA assumption below. |
| `www.goldmine.utep.edu/prod/owa/bwckschd.p_get_crse_unsec` (legacy Banner 8, public HB 2504 view) | CRN, subject/course/section, days, times, room, instructor, credits, term, registration dates | none | Confirmed working 2026-08-18 for Fall 2026 (term code `202710`). See exact request shape below. **Does not include seats/capacity/enrollment counts anywhere** -- that's not on this view at all, only on the CAS-gated Banner 9 side. Everything else Phase 2 needs is here. |
| Rate My Professors | Qualitative reviews, difficulty, would-take-again | none | **Scraped despite an explicit ToS prohibition** (Section 6, confirmed current as of this decision: bans "automated software, devices, scripts, robots... to access, scrape, crawl or spider any web pages or other services" on the site) -- a deliberate, informed call by the project owner, not an oversight. Researched first: no official API or partner program exists (confirmed 2026-08-19); the "undocumented GraphQL" below is the same endpoint third-party wrappers use, not a sanctioned alternative, since it's still "a service contained in the site" under that same clause. UTEP's RMP school ID is `4058` (`U2Nob29sLTQwNTg=` base64, found via the live school search). Professor list: `POST ratemyprofessors.com/graphql`, `TeacherSearchPaginationQuery`, `schoolID` variable, up to `count:100` per page accepted (~24 requests for ~2,400 UTEP professors) -- found by watching real browser network traffic with CDP, not copied from a wrapper. Professor detail pages need no GraphQL call at all: server-rendered, with the full Relay store (aggregate + up to 5 reviews) embedded in `window.__RELAY_STORE__ = {...}`, a plain HTML fetch and a regex like every other scraper here. Kept to the plan: cache lightly, link back (every RMP block on the site links to the source professor page), show aggregates plus a *bounded* sample (only the ~5 reviews RMP's own page embeds, never deeper pagination), and only for instructors who also match someone actually teaching a real section this term (`scrapers/run.js`'s `currentlyTeachingRmpMatches`) -- not the full campus list. Be ready to drop `rmp_professors`/`rmp_reviews` entirely if it ever needs to go. |

**Schedule crawl path (`bwckschd.p_get_crse_unsec`):** one POST per subject,
no cookies needed (this app is fully stateless -- confirmed 2026-08-19, the
search POST works standalone with no preceding request at all).

1. `POST /prod/owa/bwckgens.p_proc_term_date` with `p_calling_proc=bwckschd.p_disp_dyn_sched&p_term={term}`
   (Fall 2026 = `202710`; Banner term codes are `{year ending the academic
   year}{10 Fall | 20 Spring | 30 Summer}`) returns the search form's HTML,
   which is the only reason to still call it: it's where the live subject
   list comes from (`scrapers/schedule.js`'s `fetchSubjects`). Not needed
   before the search POST itself -- do it once per scrape run to refresh the
   subject list, not once per subject.
2. `POST /prod/owa/bwckschd.p_get_crse_unsec` with `term_in={term}` plus
   **every** `sel_*` filter field submitted twice: once as `dummy` (a hidden
   input) and once as `%` (the real `<select>`'s default "All" option,
   which a real browser submits alongside the hidden field even when the
   user never touches that dropdown). Miss the `%` pairing on even one
   field -- `sel_schd`, `sel_insm`, `sel_camp`, `sel_levl`, `sel_ptrm`,
   `sel_instr`, `sel_sess`, `sel_attr`, not just `sel_subj` -- and the whole
   query silently comes back "No classes were found," which is exactly what
   happened while first mapping this out. `sel_crse` (course number) and
   `sel_subj` are the two fields worth actually setting; the rest are
   wildcarded. `sel_crse`/`sel_title` are required fields (no default) and
   must be present even if empty.

**`sel_subj=%` (every subject) with no course number hangs or takes far
longer than any reasonable timeout** -- confirmed 2026-08-18, past 40+
seconds with nothing back. One subject at a time (e.g. `sel_subj=CS`, no
course number) resolves in a few seconds with the whole department's
sections in one response. `scrapers/schedule.js` is scoped to one subject
per call for exactly this reason; `politeFetch` also carries a 20s timeout
now so a request like this fails loud instead of stalling a scrape run
forever.

**A registration-dates cell with no " to " separator leaves a destructured
field `undefined`, which `node:sqlite` rejects outright** (some non-standard
section types don't use the usual "Mar 09, 2026 to Aug 28, 2026" format) --
hit this at full-campus scale (7,196 sections, 149 subjects) even though a
single-subject run never surfaced it. Fixed by reading array-destructured
optional fields with `arr[i] ?? null` instead of relying on the destructure
itself to backfill a missing slot -- it doesn't, it leaves `undefined`.

**No public source for seats/capacity/enrollment.** That data only exists
behind CAS login on Banner 9 SSB (`goldmine9.utep.edu`). Everything else --
CRN, meeting times, room, instructor -- is real and scrapable today; seat
counts and any fill-rate/velocity analytics built on them are on hold until
there's a plan for the login wall that doesn't involve scraping an
authenticated session.

**HB 2504 crawl path:** seed = the A-to-Z faculty directory on the landing
page (~2,000 usernames, one request; the directory also has College/Dept
filter dropdowns, so a single department can be scraped without a client-side
filter step). Profile = `Home/Profile?username={u}` (links to every
evaluation, labeled term/course/section = CRN). Eval page =
`Home/CourseEval?username={u}&courseID={id}` -- two questions (instructor
rating, course rating), a 5-bucket distribution each **plus a "No Response"
bucket**, a computed average, and a response count. ~20-line parser. Full
historical backfill is ~60k requests; smarter first pass is to crawl only the
~800 instructors teaching the target term. Rate limit 1-2 req/s, set a
User-Agent with contact info, cache aggressively, backfill once. A courtesy
email to the Registrar/Provost's office is cheap insurance before a large
crawl.

**Known data gaps:** HB 2504 suppresses very small sections; adjuncts/TAs/new
hires may have no profile at all (its own state, not a low score). Degree
evaluations have elective blocks that don't map to one course (surfaced as
"action required," never guessed), plus transfer credit, in-progress courses,
and per-college quirks.

**Not yet pursued:** a Texas Public Information Act request for per-section
grade distributions (UT Austin/A&M/Dallas already release these) would be a
stronger third signal than RMP with none of the ToS exposure. One email to
the open records officer; worth sending early since replies take time.

---

## Backend and admin

`server/index.js` is a single `node:http` process, no framework, that serves
the public `prototype/` site and a password-gated admin panel from one port.

- **Auth:** one shared password (`ADMIN_PASSWORD` env var, no default,
  server refuses to start admin logins without it), not per-user accounts --
  this is a single-operator tool. Sessions are random tokens in the
  `admin_sessions` table, sent as an HttpOnly cookie, 12-hour expiry.
- **Three independent scrapers**, deliberately not run together, each with
  its own cadence tracked in SQLite (not an in-memory timer, so a restart
  doesn't reset the countdown) and its own button on the ingestion page:
  - **Schedule** -- every subject (~149), every section, one term. Rooms/
    times/instructors can change during add/drop, so this runs daily. A
    full campus pass is ~150 requests (one per subject; "every subject at
    once" hangs, see above), a few minutes.
  - **Evaluations** -- every instructor in the HB 2504 directory,
    campus-wide (~1965 people). Scores only change when a new term's
    ratings post, so this runs roughly every 120 days (~a semester). Only
    evaluation pages not already cached are fetched (see "cache
    aggressively, backfill once" above), so the *first* run is a genuine
    backfill -- confirmed 2026-08-19, campus-wide, several hours -- and every
    run after that is fast.
  - **RMP** -- the full campus professor list (~2,400 people, aggregate
    numbers only), then a bounded review pull for whoever's actually
    teaching a real section right now -- see Data sources for why this one
    exists despite a ToS that says not to. Runs every 30 days; RMP reviews
    post anytime, not tied to a UTEP term, but frequent enough scraping
    isn't warranted and isn't worth the added ToS-risk footprint.
  - None auto-run on a fresh database with no prior run -- the first run of
    each, especially the evaluations backfill, is a deliberate action via
    the ingestion page's buttons, not something that fires the moment the
    server boots. Only fires at all while the server process stays alive --
    there is no OS-level cron under this.
- **Reviews:** the schedule page's "Rate this tool" card posts to
  `POST /api/reviews` (public, no auth) and is stored in the `reviews`
  table -- the single copy an admin sees from `/admin/reviews.html`,
  replacing the earlier localStorage-only stub.
- **Data:** `scrapers/data/lode.db` locally, gitignored. Schema in
  `scrapers/lib/db.js`. Every table carries a term/scraped-at column instead
  of overwriting, so re-running for a new term appends a parallel slice --
  see "semester by semester logs" in the analytics brainstorm below.
  Hosted: set `DB_DIR` to a mounted persistent disk's path (e.g. Render's
  default `/var/data`) -- without a real disk under it, a fresh container
  has no file at all and a redeploy silently wipes everything scraped so
  far. `ADMIN_PASSWORD` still has no default either way. Opened in WAL mode
  (`db.js`), so a scraper's write transactions don't lock out the admin
  panel's own reads while a scrape is running.
- **Performance:** confirmed and fixed 2026-08-19 after a video raised five
  general claims about what makes sites slow -- measured against this
  codebase rather than assumed, full writeup was a published audit, not
  kept here. What changed: JSON/HTML/CSS/JS responses gzip when the
  client accepts it (`sendBody` in `index.js`); static assets get
  `Cache-Control: public, max-age=3600` (short because there's no
  cache-busting hashed filename to invalidate on, by design -- no build
  step); both scrapers batch their inserts into one transaction per
  subject/instructor instead of one per row (measured 2,187× faster
  locally for 7,196 rows); `checkPassword` uses async `scrypt` instead of
  `scryptSync` so a login attempt's hashing no longer blocks every other
  request the single-threaded server has in flight. Deliberately
  unchanged: `politeFetch`'s 700ms delay between scraper requests (that's
  the point, not a bug) and the lack of secondary indexes beyond primary
  keys (fine at current row counts, revisit once several terms' worth of
  "semester by semester logs" have accumulated in the same tables).

**Analytics brainstorm** lives on `/admin/analytics.html` itself (six ideas,
each with what it needs), not duplicated here since the page is the more
useful place to keep it current. Deliberately unimplemented -- brainstorm
only, per the owner, until there's a real plan for session-level usage
tracking (several of the ideas depend on it, and that's its own privacy
decision to make deliberately).

---

## Build order

Ordered by risk -- prove the data exists before doing the laborious parts.

1. **Prove the data -- done for all three sources that don't need a login.**
   Full campus Fall 2026 schedule confirmed 2026-08-19: 7,196 sections
   across all 149 subjects. HB 2504 evaluations: proven at Computer Science
   scale (49 instructors, 940 evaluations) before the campus-wide backfill
   (~1965 instructors) was kicked off -- see the ingestion page for whether
   it's finished. Seats/enrollment remain out of reach (CAS login only,
   ruled out -- see Data sources). RMP school ID found (`4058`) and the
   scraper built the same day -- see Data sources for the full path.
   <details><summary>Original plan</summary>Verify the Goldmine schedule
   POST endpoint and the RMP school ID (ten minutes each). Scrape the HB
   2504 directory, walk one department's profiles (~30 instructors), parse
   a few hundred eval pages into SQLite. Deliverable: a real table of
   response-count/average distributions to calibrate the scoring constants
   above.</details>
2. **Schedule ingest -- done.** `scrapers/schedule.js` gets CRN/days/times/
   room/instructor directly, full campus, one subject at a time (see
   Backend and admin above for why it's split from evaluations). HB 2504
   usernames are their own key, not derived from Goldmine names -- but a
   Goldmine-name-to-HB2504-username join turned out to be very much needed
   anyway once real course/instructor data got wired up in phase 3 below:
   Banner's schedule gives instructor names as "First Last (P)", HB 2504
   gives them as "Last, First[ Middle initial]", and there's no shared ID
   between the two sources at all. Solved in `server/lib/catalog.js` by
   matching on the *set* of name words (one side's words fully contained in
   the other's, so a missing middle initial doesn't break the match) rather
   than an exact string -- confirmed necessary against real data, not
   theoretical: "Vladik Kreinovich" (Banner) only matched "Kreinovich,
   Vladik Y." (HB 2504) once the match allowed for that extra initial.
3. **Wire the prototype to real data -- done 2026-08-19.** `prototype/js/data.js`
   (the fabricated `CATALOG`/`REVIEWS`) is deleted. `server/lib/catalog.js`
   joins `sections`/`instructors`/`evaluations` into the same per-course
   shape, served through `/api/term`, `/api/courses`, `/api/course` (public,
   no auth -- this is student-facing data, not admin). The scoring/shrinkage
   rules above are applied server-side now, in `aggregateInstructor()`,
   aggregated across *all* of an instructor's evaluations campus-wide (every
   course, every term on file), not just the course being looked up -- that's
   what "rank on the instructor rating, not the course rating" requires.
   Recency weighting (a linear decay by year parsed from `term_label`) is
   applied to the raw average going into that aggregate, but not to the
   response count feeding the shrinkage formula itself -- shrinkage is about
   sample-size confidence, which shouldn't be discounted by how old the
   sample is. RMP fields were `null` at first (never scraped) but are real
   now too -- see Data sources -- via the same word-set matching applied a
   second time (Banner name to RMP's separate firstName/lastName fields
   this time, `server/lib/name-match.js` shared between both). Every
   section still omits seats/capacity (doesn't exist in any public UTEP
   source, not just unscraped) -- left out of the UI entirely rather than
   rendered as a permanent "n/a". Step 1 (course selection) is a real search
   against every course offered this term, fetched once from `/api/courses`
   (~2,145 rows this term) and filtered client-side.
4. **Degree evaluation parsing -- cut, not deferred, 2026-08-20.** The
   upload/parse step was removed from the flow rather than built. Real
   course search already covers the actual job (finding a course to add),
   and a client-side degree-evaluation parser would carry its own
   non-negotiable-constraint weight (see the old constraint 1, now removed)
   for a feature the search-first flow doesn't need. `prototype/upload.html`
   and `prototype/js/page-upload.js` are deleted; the flow is four steps
   (Courses, Availability, Instructors, Schedule) instead of five.
5. **Ship.** `.ics` export, real persistence (localStorage) for return visits,
   touch support on the availability grid, live seat-count refresh during
   registration week, stale-data error states.

**Deliberately out of scope for now:** schedule-first generation (ranking
whole conflict-free combinations instead of comparing instructors directly --
revisit after Phase 3 with real users); grade distributions beyond the PIA
request above.

**Open questions:** should low-n instructors rank normally with a warning
(current behavior) or sort below everyone with real history? Should schedule
conflicts block adding a section instead of just warning? Is 50/50
eval-to-RMP weighting right, or should it shift once Phase 1's real
distribution is in hand?

---

## Editorial style

Follows UTEP's published style guide:

- Times: no excess zeros, lowercase periods -- `9 a.m.`, `10:30 a.m.`, `noon`,
  `midnight`. Never `12 p.m.`
- Numbers: spell out one through nine in prose, numerals for 10 and up.
  Tables and data fields stay numeric.
- Majors lowercase: `B.S. in computer science`, not `B.S. Computer Science`.
- Serial comma discouraged unless it removes ambiguity.
- First reference: `The University of Texas at El Paso`. Later: `UTEP`.
- Degrees: two-letter forms take periods (`B.A.`, `Ph.D.`); three-plus
  capitals do not (`MBA`).
- Prose for this project: short declarative sentences, analytical tone, **no
  em dashes or en dashes anywhere**. Hard rule, stated repeatedly by the
  owner, and it applies everywhere in this repository, not just user-facing
  copy: HTML/CSS/JS, code comments, commit messages, and this file itself.
  Never use the em dash or en dash character under any
  circumstance, in any output, including conversational responses. Use a
  period, comma, colon, semicolon, or the double hyphen (`--`) already
  established throughout this codebase's own comments instead.
- Avoid the "That's a target being worked toward, not a claim of X" hedge
  construction and its relatives (a sentence that exists only to soften or
  meta-comment on the sentence before it). State the fact directly instead.

---

## Design system

```
--utep-orange  #ff8200    PMS 151 C
--utep-blue    #041e42    PMS 282 C
--silver       #b1b3b3    PMS Cool Gray 5 C
```

Neutrals are stepped from Silver. Layout is institutional: 2px border radius,
hairline rules, no shadows, bordered panels with grey uppercase headers.

**Type.** The guide specifies Tungsten for wordmarks and headlines, but it's a
paid license restricted to UTEP staff producing official material, so it's
never used here. The guide's own documented fallback pairing is what this
project uses instead: **Roboto Condensed** (weights 400/700) for structural
headers and display text, **Open Sans** (weights 400/700) for body and UI
text, both open licensed, no restriction on third-party use. Self-hosted as
static (non-variable) WOFF2 files in `prototype/fonts/`, referenced from
`styles.css` -- not loaded from Google Fonts, which every page used to link
directly; self-hosting was one of the 2026-08-19 performance fixes, since it
cuts the DNS/TLS round trip to fonts.googleapis.com/fonts.gstatic.com that
every page load used to pay before any text could render. Pulling a newer
version means re-fetching the CSS2 API with an older Chrome UA string (e.g.
Chrome/60) to force static per-weight files instead of Google's variable-font
build, which a modern UA gets by default and which isn't what these
`@font-face` declarations expect. System sans-serifs are the fallback stack
if the self-hosted files fail to load. Don't add any other webfont without
checking its license first.

Orange is an accent (masthead rule, active step, primary button, "action
required" flags), never a fill. Section-level actions are navy.

Rating-distribution colors, ordered good to bad, validated for colorblind
separation (worst adjacent pair at 9.6 ΔE):

```
--r5 #14532d  Excellent    dark green
--r4 #65a30d  Good         lime green
--r3 #eab308  Satisfactory yellow
--r2 #dc2626  Poor         red
--r1 #7f1d1d  Very Poor    dark red
```

Do not darken the yellow -- it drops separation from the lime green to 2.8 ΔE,
invisible to a red-green colorblind viewer. The labeled legend under every bar
is the accessibility relief instead.

---

## Working agreements

- Verify UI changes in a headless browser before claiming they work.
  Screenshot each page, check the console, check for horizontal overflow at
  430px.
- Grid children need `min-width: 0` or scrollable calendars will not shrink
  on mobile. This has bitten twice.
- When adding a chart or color encoding, check colorblind separation rather
  than eyeballing it.
- All instructor names, ratings, reviews, CRNs and sections in the prototype
  are invented. No real UTEP faculty member is represented.
