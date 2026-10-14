# Backlog

Things found and not yet fixed. Opened 2026-09-24 from a walkthrough of the deployed app,
driven the way a visitor drives it. Add to it as things turn up; delete an entry when it lands.

Every item carries a status: **needs fixing (I know how)**, **needs fixing (needs scoping)**, or
**no action required**. An entry with no status is unfinished.

**Ruled 2026-09-29.** Batch A shipped items 8, 14 and 7 plus the downloadable sample invoices
(item 9, in part). Item 16, a duplicate invoice number answering an opaque 500 while silently
overwriting the original's stored PDF, was found and closed the same day and is deleted from here.

**Both production steps below are DONE, verified 2026-10-13** by read-only queries on production:
`invoices.created_at` exists, and cron job `sample-cleanup` is active on `*/5 * * * *` with 3,873
succeeded runs, the last at 2026-10-13 02:55 UTC. HISTORICAL (2026-09-29): two production steps were
owed before the next deploy proved anything, both introduced by the sample cleanup and neither
runnable by an agent:

1. Apply the migration adding `invoices.created_at` to the production database.
2. `doppler run -c prd -- bun run scripts/setup-prod-cleanup.ts` to schedule the sweep.

   Defaults: a sample is spared for 15 minutes, and the sweep runs every 5, so the longest anyone
   waits for a locked sample is 20. Those are two different settings and the wait is their SUM, so
   raising either without doing that sum is how a visitor ends up looking at a dead button for
   hours. Set `SAMPLE_TTL_MINUTES` in the deployed env; the schedule is this script's argument.
   `SEEDED_RESET_MINUTES` (default 15) is the same kind of setting for the seeded review example: a
   decision on it stands that long, then the same sweep puts the invoice back in review, so the same
   sum applies.

HISTORICAL, before the second ran: samples accumulate in production and every one of them stays marked as in
use for ever, because nothing clears them. Item 11 was moved out of Batch A into Batch B: removing the Flagged status means
a database migration, and doing only the visible half would leave the app able to crash on a row
the database still permits. See item 15 for the invoice builder, which is deliberately deferred.

**Start here: item 1, then Batch B (4, 12, 10, 11).** Item 8 shipped on 2026-09-29, so an invoice
can now be opened and three sample invoices can be audited in one click. What has not changed is
that **nothing on the live site has ever been audited**: the dashboard a visitor lands on is still
a wall of zeros, which makes item 1 the largest remaining gap. Item 4 is the engine gap and travels
with Batch B.

---

## 1. The live demo shows an audit tool that has never audited anything

**Needs fixing, I know how.** In progress: GitHub issue #3, plan
`2026-10-14-p1-demo-self-reset-and-model-swap`.

The dashboard reads Received 22, then Auditing 0, Passed 0, Paused 0, Approved 0, Rejected 0. Every
invoice in the list says Received, and opening one says "Not audited yet". The seed loads invoices
but never audits them.

So the four checks, the clause citation, the pause for a human and the trace are all invisible to a
visitor unless they upload a PDF themselves. Most will not. The first thing anyone sees is a wall of
zeros.

Fix: audit a handful of the seeded invoices in production, so the dashboard arrives with a story
(several passed, one paused for review, one approved with a note). A few model calls once, not per
visitor.

This is the highest-value item here: it is the first screen every visitor sees.

**When seeding the approved example, write a reason that matches its evidence.** Nothing
cross-checks the two, so a note can contradict the findings it is meant to justify. A walkthrough on
2026-09-24 approved an invoice carrying "No purchase order is linked to this invoice" with the
reason "checked against the PO", and the pair sat on screen together looking exactly like a reviewer
citing a document the system had just said did not exist. Harmless there because the row was test
data and was deleted; not harmless on a seeded row a visitor reads.

## 2. An uploaded invoice shows no line items and no dates

Two symptoms, two different causes, so they are fixed separately. Seeded invoices show both; uploaded
ones show neither.

### 2a. The line items are read and then thrown away

**Needs fixing, needs scoping.** The open question is a design one.

The upload stores only the number, vendor, amounts and the PDF. The engine reads the lines off the
PDF, uses them for the arithmetic check, then discards them. The page renders a table header with
nothing under it.

The tension: storing what the model read would make model output into stored fact, which cuts
against how this app works, where the database is truth and the PDF is the thing being checked.

The way through, if it survives scrutiny: the model's reading is **evidence belonging to the audit**,
not a fact about the invoice. The app already fails invoices on that reading, so hiding it while
acting on it is the real inconsistency, and today the arithmetic verdict gives a number with no way
to see which lines produce it. Attach the lines to the arithmetic check's evidence, where every other
piece of evidence already lives, and show them there labelled as read from the PDF. The invoice's own
line items stay empty, correctly.

Separately and regardless: **an empty table with headers reads as broken.** When there are no line
items on record, say so in a sentence. Worth doing even if the rest is never built.

### 2b. The dates are never read at all

**Needs fixing, I know how**, and it is a smaller job than 2a.

The invoice date and due date are not on the upload form, not in the schema the model fills in, and
not mentioned in its prompt. For an uploaded invoice they exist nowhere in the system, so the dash on
the page is literal rather than a display fault.

Two routes. Adding the two fields to the upload form is trivial and involves no model at all, but the
dates are then typed by whoever uploads rather than read from the document. Adding them to what the
model reads fits the product's story better and costs more: changing the extraction forces the eval
dataset to be rebuilt and re-graded, and the new fields need answer keys, though those exist already
because seeded invoices carry real dates.

## 3. A failed check can be approved with no reason recorded

**Needs fixing, I know how.**

The only rule on a review decision is that the invoice must be in the review queue. Nothing looks at
what failed, and the note is optional in the form, in the service and in the database. So an invoice
whose arithmetic does not balance can be approved with no explanation at all.

A human overriding a failed check is correct and is the point of pausing. Recording nothing about why
is not: it breaks the evidence trail at the exact moment it matters most. Approving over "no purchase
order linked" also takes the same two clicks as approving over "the arithmetic does not balance",
which flattens a distinction an auditor would expect.

Fix: require the reason when the run contains a failure; keep it optional when everything passed or
only flagged.

Worth doing for the portfolio specifically. "Can someone just approve a failed invoice?" is exactly
what an interviewer asks about this screen, and the honest answer today is yes, silently.

## 4. The real engine ignores whether a vendor is approved

**Needs fixing, I know how.** The most substantive item here after 1.

The seed deliberately carries an unapproved supplier, Dodgy Diggers Supplies Pty Ltd, as one of its
anomaly cases. The two engines then disagree about it.

The mock engine fails such an invoice outright: "Vendor X is not approved." The real engine loads the
same flag, annotates it in its own source as "on the approved supplier list; false is a finding, not
an error", and then never reads it again. Nothing in the langgraph engine mentions vendor approval
outside the loader that fetches it.

Observed 2026-09-24 on the deployed app: an invoice from that unapproved vendor came back with the
vendor check reading Pass, on the grounds that no contract clauses are on file so no contract term
applies. A supplier nobody authorised sails through for the very reason that should make it
suspicious.

Two things make this worth doing rather than noting. It is a seeded anomaly the shipped engine does
not catch, so the demo data contains a case the product misses. And it is a behaviour difference
between the two engines the whole project exists to compare, which undermines the comparison itself.

## 5. An uploaded invoice can never match a purchase order

**Needs fixing, needs scoping**, because the right answer depends on what the demo is for.

The upload endpoint accepts an optional purchase-order reference, but the form has no field for one,
so it is always empty. Every uploaded invoice therefore flags "No purchase order is linked to this
invoice", permanently. One of the four checks can never pass on the path a visitor actually takes,
and the flag they see says nothing about the invoice they uploaded.

**Measured 2026-09-29, and it is worse than one flagged check.** Three sample invoices were run
through the live engine. On all three `po_match` flagged, as expected, but the contract check ALSO
returned a finding on all three, and on two of them what it objected to was the missing purchase
order rather than the fault that was planted. So the missing PO does not cost one check, it costs
two, and it muddies the one check a reader is being asked to watch.

The scoping question is which fix serves the demo. A vendor's open purchase orders could be offered
on the form, which is honest but adds a step. Or the engine could match on the amount and vendor
rather than requiring an explicit link, which demonstrates more of the product. Neither is obviously
right without deciding whether the upload page is a data-entry screen or a showcase.

## 6. Continuous integration runs everything on every push

**No action required as a cost measure.** Measured 2026-10-13: 5 of 31 pushes were docs-only, about
75 cents in total. Kept as hygiene to do before P2 forks the workflow, which would otherwise copy the
gap.

There are no path filters, so a change to a markdown file still pays for everything it cannot
possibly affect. Re-read from `ci.yml` on 2026-10-08: three jobs spend model money on every push to
`main` and every manual dispatch, `langgraph-e2e` (Claude reads the PDFs, the contract agent
judges), `eval-grade` (20 judge calls) and `integration` (the seed's 32 OpenAI embeddings). A fourth,
`e2e-mock`, runs the same 32-embedding seed on every pull request push as well.

Fix: `paths-ignore` (or a changed-files step) so a docs-only diff skips the paid jobs. Item 18
covers the embedding spend separately, and measured too small to act on.

Traps, both known before starting: a _skipped_ job can block a required status check under branch
protection, so set the two up together rather than twice; and landing the change is itself a merge,
so it costs one paid run to save future ones. Batch it rather than pushing it alone. Branch
protection returned 403 while the repo was private (2026-09-23); the repo is now public, where GitHub
Free allows it, so recheck that first.

Worth doing before P2 inherits this workflow.

## 7. The upload button reads as broken before a vendor is chosen

**No action required.**

It is disabled until the form can be submitted, which is correct, but on a blank form it looks
greyed-out rather than waiting. Worth a glance if that page is touched for another reason.

## 8. Nothing shows that an invoice can be opened

**Needs fixing, I know how.** Highest priority here, with 1.

On both the dashboard and the invoice list, the invoice number is a link styled with a hover
underline and nothing else. No colour, no underline at rest, no cue of any kind. On a still page it
is indistinguishable from bold text, so a visitor has no reason to click it.

The detail view is where the entire product lives: the four checks, the evidence, the clause
citation, the trace. A visitor who never discovers the link never sees any of it.

Combined with 1 this is fatal to the demo. The landing page shows a table of invoices that have not
been audited, and offers no visible way to open one. Both halves have to be fixed for either to be
worth anything.

## 9. There is no uploaded-invoice set that proves the engine works

**Needs fixing, needs scoping**, because it is a set to design rather than a single change.

Everything demonstrated so far has gone through a seeded invoice or a single fixture. What is missing
is a set a person can upload, one fault at a time, that shows each check working on its own.

**One invoice carrying every fault proves almost nothing.** If all four checks fire together, the
only thing established is that something went wrong; a price check that flags unconditionally is
indistinguishable from one that works. Isolating a single fault per invoice is what makes each check
verifiable.

The set, and what each one is for:

| Invoice                  | What it proves                                                                                                          | Exists?                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Happy                    | All four pass, purchase order matches, lines render, variance genuinely zero because it was checked rather than skipped | No                                                    |
| Overcharged line         | The rate check alone, with a visible non-zero variance                                                                  | No                                                    |
| Arithmetic wrong         | The sums, alone                                                                                                         | Yes, `sample-invoice.pdf`                             |
| Contract clause breached | Retrieval, the model and the cited clause: the only check that needs an LLM                                             | Yes, `clause-breach-invoice.pdf`                      |
| Adversarial              | That text designed to manipulate the model does not move the verdict                                                    | Seeded as data only, no PDF, so it cannot be uploaded |

Also missing from every path so far: **rejection has never been exercised.** Not by a spec, not by
the smoke, not by any walkthrough. The button sits beside Approve on the review card and has never
been pressed anywhere. One of these invoices should be rejected rather than approved.

Two further cases become demonstrable only after other items land: an unapproved vendor once 4 is
wired, and an invoice with no contract on file once its display stops reading as a clean pass.

Cost to weigh: every upload runs a real audit, vision model and retrieval included. A full pass over
this set is five audits, so it is a deliberate exercise rather than something to run casually.

**Partly landed 2026-09-29.** Three of these now exist as downloadable PDFs on the upload page, with
a button that fills the form and attaches the file so a visitor only presses Upload: the arithmetic
mismatch, an overpriced line, and the contract-clause breach. They are a set of their own rather than
the e2e fixtures, so a demo change cannot redden the paid suite, and none is billed to the unapproved
supplier whose vendor check the live engine still wrongly passes (item 4).

All three were run through the live engine the day they were written, and the page's wording was
corrected to match what came back rather than what was expected. Two corrections worth keeping:
the rate check returns `flag`, not `fail`, and the contract check fires on all three (see item 5).

Still missing from the set, and still true: **the happy invoice cannot be built until item 5 is
fixed**, because no upload can pass the purchase-order check; the adversarial case has no PDF; and
**rejection has still never been exercised anywhere.**

## 10. The same invoice shows two different totals, and nothing checks the one you typed

**Needs fixing, I know how. RULED 2026-09-24 — do not reopen the fork.** The most serious item here.

**The ruling: the declared total becomes a FIFTH check.** Not folded into the arithmetic check, and
not fixed by dropping the amount fields from the form.

Why, in one line: _"the supplier declared $1,100, the document says $5,328"_ is a finding a human
acts on differently from _"this document does not add up internally"_. One is a possible lie, the
other a probable mistake. Folding them into one check destroys that distinction; dropping the fields
removes a real audit signal rather than the contradiction.

Costs accepted at the time, all of which are why this sits in Batch B rather than anywhere cheaper:

- a migration, because the database constraint allows four check types;
- the smoke and two browser specs, which assert exactly four checks;
- the README's framing;
- one eval rebuild;
- **all three engines, not one.** Mock and stub return four as well, so wiring only the live engine
  recreates the very divergence bug item 4 exists to close.

Landed 2026-09-29 as a stopgap, not a fix: the form's three amount boxes are now captioned as what
the SENDER states, so a reader knows whose numbers they are. The hole is untouched.

The upload form asks for the subtotal, GST and total. Those numbers are stored and are what the
detail page prints in its header. Every check, meanwhile, reads its own values off the PDF. Nothing
ever compares the two.

Observed 2026-09-24 on the deployed app, one screen, two totals:

| Shown where      | Value     | Source                   |
| ---------------- | --------- | ------------------------ |
| Header, "Total"  | $1,100.00 | typed on the upload form |
| Arithmetic check | 5,328.00  | read from the PDF        |

Neither is labelled, nothing reconciles them, and a reader is left to assume one of them is a bug.

The second half is worse than the display. **Nobody checks that what was typed matches the
document.** Someone can enter $10 for a $5,000 invoice and every check still passes, because each one
compares the PDF against itself. For a tool whose entire purpose is catching invoices that do not add
up, an unverified declared total is a conspicuous hole, and it is the first thing a sceptical
interviewer would poke at.

Comparing the typed total against the extracted one catches a class of fraud the other four checks
cannot: a correct-looking document attached to a wrong claim.

Still to do when this is built: **the header must say where its number came from.** That was part of
the ruling and is not covered by the form caption, which labels the input rather than the display.

## 11. The filter offers a status nothing can ever have

**Needs fixing, I know how.**

The status filter is built from the full list of statuses, which includes Flagged. Nothing in the
system ever sets Flagged: the worker writes only Passed or Paused for review, and review writes
Approved or Rejected. So choosing Flagged always returns an empty list, permanently, and reads as a
broken filter rather than an empty category.

The dashboard already leaves Flagged out of its tiles, so the two disagree about whether the status
exists. Either drop it from the vocabulary and the database constraint, or start using it.

## 12. The check labelled "Contract / vendor" never looks at the vendor

**Needs fixing, I know how.** Same root as 4, but a separate symptom.

The heading promises two things and delivers one. The real engine checks contract clauses only, so an
invoice from a supplier marked not approved can show that check reading Pass. A reader takes the
label at face value and concludes the vendor was verified.

Fixing 4 fixes this. Until then the label is a claim the code does not honour, which is exactly the
class of thing the README's own marker exists to prevent elsewhere.

## 13. Rejection is irreversible, unconfirmed, and one click away

**Needs fixing, needs scoping.**

Reject sits beside Approve with no confirmation step. A decision may only be recorded on an invoice
that is paused for review, so once rejected an invoice can never be reviewed again: there is no path
back and no way to correct a misclick. Approve has the same shape, but rejection is the one a person
regrets.

Scoping is about how much ceremony belongs in a demo. A confirmation step is the obvious answer, and
a way to reopen a decision is the honest one.

## 14. The dashboard's invoice table is a dead end

**No action required**, listed so it is not rediscovered.

"Recent invoices" shows eight rows and offers no way to see the rest. A visitor has to notice the
Invoices item in the top navigation. Harmless on its own; worth a "view all" link whenever that
section is touched for another reason.

## 15. A visitor cannot build an invoice of their own

**Needs fixing, needs scoping. Deliberately deferred: build it after Batch B (ruled 2026-09-29).**

The downloadable samples in item 9 let a visitor audit something, but not something of their own.
The fuller idea is a small builder on the upload page: pick a vendor, add lines, set quantities and
prices, and the app renders the PDF for them to submit. A visitor could then plant their own fault
and watch the right check find it, which is a far better answer to "does this actually work" than
three fixed files.

The plumbing is already there. One renderer produces every invoice PDF in this repo, and the
extraction prompt is written against that layout, so a builder would be a third caller of the same
function rather than a new document the model has never seen.

**Why it waits for Batch B.** Batch B closes the purchase-order gap (item 5) and the unchecked
declared total (item 10). Until those land, anything a visitor builds comes back with two findings
that are the app's fault rather than theirs, and a builder is precisely the feature that invites
someone to poke at exactly those holes.

## 17. Sign-in with Microsoft Entra ID, tied to the approver

**Needs fixing, needs scoping.** Ruled 2026-10-08 (from the build-resume session): Entra goes in
this project, not in Apply Proper (P5, `~/code/projects-portfolio/p5-apply-proper`), because here it is the right tool rather than a
resume choice.

The app has no sign-in today. Its users would be procurement staff, who sign in with Microsoft 365
at work, and it already has a job for identity: the human who clears a paused invoice. With Entra
that approval is tied to a signed-in user and recorded in the audit trail ("who approved this
payment"). It also answers Perth demand: 13 of 45 Azure-naming ads ask for Entra ID or Active
Directory (`~/code/build-resume/docs/azure-path.md`, measured 2026-09-08).

Unknowns to scope before planning:

- **Cost.** Believed free at this scale; unverified. Read Microsoft's official Entra pricing page
  first, then set a $0 budget alert on the Azure account.
- **The open demo.** Sign-in must not lock visitors out. Needs a guest demo mode (read-only or
  sandboxed) alongside it.
- **Workforce tenant or External ID.** Staff sign-in suggests a workforce tenant; decide with the
  guest mode.

## 18. CI re-embeds the same 32 contract clauses on every run

**No action required.** Measured: 32 clauses, about 2,100 tokens, under $0.0001 per run. Kept for the
record. Raised 2026-10-08 from the P5 session; verified against `ci.yml`.

`bun run seed` embeds the contract corpus through OpenAI (`apps/api/scripts/embed-contract-docs.ts`,
`text-embedding-3-small`), one call per clause. Three CI jobs seed: `e2e-mock` on every pull request
push and every push to `main`, `langgraph-e2e` and `integration` on `main` and dispatch. The clauses
never change, so every one of those runs buys the same 32 vectors again.

The fix, should it ever be wanted: embed once, commit the vectors as a fixture, and have the seed load the fixture instead of
calling OpenAI. Three things to hold while doing it:

- **The fixture is tied to the model.** Retrieval embeds the query live with the same model
  (`apps/api/src/audit/retrieval.ts`), so a fixture built with a different model returns nonsense
  rankings, silently. Record the model beside the vectors and refuse a mismatch.
- **It does not remove the key from CI.** `config/env` validates both model keys at import even when
  nothing spends them, per the `integration` job's own comment. Check whether that validation can be
  made lazy, or accept that the `ci` config keeps the key unspent.
- **`langgraph-e2e` still spends on OpenAI**, because a real audit embeds its query. Only the seed's
  share goes.

If it is done, combine it with item 6 in one merge: both edit the paid side of CI, and each landing costs a paid run.

## 19. A test leaves orphan queue jobs behind

**Status: needs fixing (needs scoping).** Ruled 2026-10-14: record, with a trigger.

Some integration test deletes its invoices without draining the audit queue, so jobs pointing at
rows that no longer exist pile up locally. Found during T3 of the self-reset plan: 12 such jobs
filled the worker's 10-job read and failed two unrelated review tests. The review test now drains
the queue in its own setup, so nothing is broken today; the test responsible is not identified.

**Trigger:** the next time an integration test fails on queue contention, or before P2 forks this
test suite. The fix is to find the test (run each integration file alone against an empty queue
and read the depth afterwards) and give it an `afterAll` drain or a delete that also purges its jobs.

---

## 20. The eval tool pins the Anthropic SDK below 1.0 for a reason that no longer holds

**Status: needs fixing (needs scoping).** Ruled 2026-10-14: record, with a trigger.

`evals/ragas/pyproject.toml` holds `anthropic` under 1.0. The docstring's reason (the adapter still
sent `temperature`) was closed by the judge dropping `temperature` itself on 2026-10-14. Whether
1.x changes anything else on the judge path (instructor's forced tool call, the reply shape) is
unmeasured.

**Trigger:** the next dependency upgrade of the eval tool, or the moment ragas or instructor requires
`anthropic` 1.x. Lift the pin, run `uv run --project evals/ragas pytest evals/ragas/tests -q`, then
one paid re-grade from a warm cache and compare the per-metric means.

## 21. The Doppler to Vercel integration did not push a replaced secret

**Status: needs fixing (needs scoping).** Ruled 2026-10-14: record, with a trigger.

The Anthropic key was replaced in Doppler `prd` on 2026-10-14 at 15:49 AWST. The deploy that
evening still ran with the old one: Vercel listed `ANTHROPIC_API_KEY` for production as created
21 days earlier, and the first production audit failed with `401 invalid x-api-key` (worker log,
12:37 UTC). The key was pushed by hand with the Doppler-to-Vercel pipe and the site redeployed;
the smoke then passed. Note `vercel env ls` shows a _created_ date that does not move on an
update, so it is no evidence either way; the first real audit is the only proof.
Whether the integration is disconnected, paused, or only syncs on some other event is unknown; it
is a Doppler dashboard question.

**Trigger:** the next time any `prd` secret changes, or before P2 copies this deploy setup. Check
the integration's sync log in the Doppler dashboard first; if it is dead, remove it and keep the
documented pipe (`doppler secrets get … | vercel env add … --force`) as the only route, so a
silent half-sync cannot recur.

## 22. The arithmetic card says "does not balance" beside two equal figures

**Status: needs fixing (I know how).** Ruled 2026-10-14: record; goes with the next PR or plan
that touches `apps/api/src/audit/` (an engine-folder change forces an eval rebuild, so it rides
along rather than paying for its own).

Seen on the production seed, INV-0018: lines sum to $2,000, the stated subtotal is $2,100. The
math check fails correctly, but its evidence reads `expected 2310.00 / actual 2310.00`, the
total, which IS consistent with the stated subtotal. The figure a visitor needs, subtotal
against line sum, is not shown, so the card contradicts itself. Fix: the evidence names the pair
that disagrees (line sum vs stated subtotal, or GST vs 10% of subtotal, or total vs subtotal
plus GST), not always the total. One check file and its unit test.

---

## Verified working, 2026-09-24

Checked on the deployed app so these are not re-investigated: the stored PDF link returns a real
document; upload failures surface their reason on the form; the detail page polls while an audit is
running, so results appear without a manual refresh; the empty review queue and empty invoice list
both say so in words; and every page returns 200 with no console errors, no uncaught exceptions and
no failed requests.
