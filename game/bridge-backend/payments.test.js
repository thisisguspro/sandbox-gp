// Paid-purchase webhook security test (LIVE Stripe mode, no real account needed).
//
// Real money grants (Prisms, name-change credits, cosmetics) hinge on TWO
// invariants that are otherwise only verified by hand:
//   1) The /payments/webhook endpoint trusts NOTHING without a valid Stripe
//      signature — an unsigned or forged event must grant nothing.
//   2) Fulfillment happens EXACTLY once (idempotent replay) AND a fulfillment
//      failure releases the claim so a legitimate Stripe retry can still complete
//      (the player must never pay and get nothing).
//
// This boots the real Express app in LIVE mode by setting non-placeholder Stripe
// keys BEFORE importing config, then signs events with the same webhook secret
// using Stripe's own offline test-header helper (pure HMAC, no network). It hits
// the actual HTTP route so the raw-body capture + signature verification run for
// real.
//
// Run: node payments.test.js   (no external servers required — boots in-process).

// MUST be set before importing config/app — config reads these at module load.
process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_payments_test";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake_for_payments_test";
// Keep the test hermetic and side-effect free: never connect to or write into the
// real Postgres snapshot. Running pure in-memory means the test users/sessions we
// create here can't pollute production state and the test needs no database.
delete process.env.DATABASE_URL;

const { app } = await import("./src/server.js");
const { db } = await import("./src/store/index.js");
const { stripePlaceholders } = await import("./src/config/index.js");
const Stripe = (await import("stripe")).default;

let pass = 0, fail = 0;
const assert = (cond, msg) => { if (cond) pass++; else { fail++; console.log("  ✗ FAIL:", msg); } };

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const signer = new Stripe(process.env.STRIPE_SECRET_KEY);

// Build a checkout.session.completed event body for a given session id. An
// optional payment_intent is recorded on the session so a later refund/dispute
// event can be traced back to it (real Stripe completion events carry this).
const completedEvent = (sessionId, paymentIntent) =>
  JSON.stringify({ id: "evt_" + sessionId, type: "checkout.session.completed", data: { object: { id: sessionId, payment_intent: paymentIntent } } });

// Build a charge.refunded event. Stripe's charge object references the
// PaymentIntent (not the checkout session id) — that's the only link back.
const refundEvent = (paymentIntent, chargeId) =>
  JSON.stringify({ id: "evt_" + chargeId, type: "charge.refunded", data: { object: { id: chargeId, payment_intent: paymentIntent, refunded: true } } });

// Build a charge.dispute.created event. The dispute object also carries the
// PaymentIntent (plus the charge id) so it traces back the same way.
const disputeEvent = (paymentIntent, disputeId) =>
  JSON.stringify({ id: "evt_" + disputeId, type: "charge.dispute.created", data: { object: { id: disputeId, payment_intent: paymentIntent } } });

// Sign a payload exactly as Stripe would, using the configured webhook secret.
const sign = (payload, secret = WEBHOOK_SECRET) =>
  signer.webhooks.generateTestHeaderString({ payload, secret });

// Start the app on an ephemeral port so the real route + raw-body middleware run.
const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;

// POST a webhook with an optional signature header. Returns { status, json }.
async function postWebhook(payload, sigHeader) {
  const headers = { "Content-Type": "application/json" };
  if (sigHeader !== undefined) headers["stripe-signature"] = sigHeader;
  const res = await fetch(`${base}/payments/webhook`, { method: "POST", headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body (e.g. signature error text) */ }
  return { status: res.status, json };
}

try {
  // Sanity: with both real-looking keys set, we are NOT in stub mode, so signature
  // verification is actually exercised. If this fails the whole test is meaningless.
  assert(!stripePlaceholders(), "app is in LIVE Stripe mode (signature verification active)");

  const buyer = await db.createUser({ name: "Buyer", googleId: "g-buyer-payments-test" });

  // ============================================================
  // 1) UNSIGNED / FORGED events are rejected and grant nothing.
  // ============================================================
  await db.createCheckoutSession("cs_forge", { userId: buyer.id, packId: "pack_small", prisms: 500 });
  const forgeBody = completedEvent("cs_forge");

  // (a) No signature header at all.
  const noSig = await postWebhook(forgeBody, undefined);
  assert(noSig.status === 400, "unsigned webhook is rejected with 400");

  // (b) Garbage signature header.
  const junkSig = await postWebhook(forgeBody, "t=123,v1=deadbeef");
  assert(junkSig.status === 400, "webhook with a bogus signature is rejected with 400");

  // (c) Validly-signed but with the WRONG secret (attacker who doesn't know ours).
  const wrongSecret = await postWebhook(forgeBody, sign(forgeBody, "whsec_attacker_secret"));
  assert(wrongSecret.status === 400, "webhook signed with the wrong secret is rejected with 400");

  // (d) Body tampered AFTER signing (signature no longer matches the bytes).
  const goodHeaderForForge = sign(forgeBody);
  const tampered = await postWebhook(completedEvent("cs_forge") + " ", goodHeaderForForge);
  assert(tampered.status === 400, "webhook whose body was tampered after signing is rejected with 400");

  // After all forgery attempts, nothing was granted and the session is still claimable.
  assert((await db.getBalance(buyer.id, "PREMIUM")) === 0, "no Prisms credited from any forged/unsigned event");
  assert((await db.getCheckoutSession("cs_forge")).status === "pending", "forged attempts left the session unfulfilled (pending)");

  // ============================================================
  // 2) A VALID event grants EXACTLY ONCE (replay / idempotency).
  // ============================================================
  await db.createCheckoutSession("cs_valid", { userId: buyer.id, packId: "pack_small", prisms: 500 });
  const validBody = completedEvent("cs_valid");
  const validHeader = sign(validBody);

  const first = await postWebhook(validBody, validHeader);
  assert(first.status === 200 && first.json?.credited === 500, "valid signed event credits the Prisms once");
  assert((await db.getBalance(buyer.id, "PREMIUM")) === 500, "balance reflects exactly one credit after first delivery");

  // Replay the EXACT same signed request — Stripe retries, so this must be a no-op.
  const replay = await postWebhook(validBody, validHeader);
  assert(replay.status === 200 && replay.json?.alreadyFulfilled === true, "replayed event is acknowledged as already fulfilled");
  assert((await db.getBalance(buyer.id, "PREMIUM")) === 500, "replay does NOT double-credit (idempotent)");

  // ============================================================
  // 3) Fulfillment FAILURE releases the claim so a legit retry completes.
  // ============================================================
  await db.createCheckoutSession("cs_retry", { userId: buyer.id, packId: "pack_small", prisms: 300 });
  const retryBody = completedEvent("cs_retry");
  const retryHeader = sign(retryBody);

  // Force the credit step to throw on the first delivery (simulates a transient
  // store error AFTER the session was claimed as fulfilled).
  const realAdjust = db.adjustBalance;
  let throwOnce = true;
  db.adjustBalance = async (...args) => {
    if (throwOnce) { throwOnce = false; throw new Error("simulated transient store failure"); }
    return realAdjust.apply(db, args);
  };

  const failedDelivery = await postWebhook(retryBody, retryHeader);
  assert(failedDelivery.status === 500, "a fulfillment error surfaces as 500 (Stripe will retry)");
  assert((await db.getCheckoutSession("cs_retry")).status === "pending", "failed fulfillment RELEASES the claim (session back to pending)");
  assert((await db.getBalance(buyer.id, "PREMIUM")) === 500, "no Prisms credited when fulfillment failed");

  // Legitimate Stripe retry now succeeds and grants exactly once.
  const retry = await postWebhook(retryBody, retryHeader);
  db.adjustBalance = realAdjust; // restore before any assert can throw
  assert(retry.status === 200 && retry.json?.credited === 300, "the retry after a released claim completes the purchase");
  assert((await db.getBalance(buyer.id, "PREMIUM")) === 800, "retry credits exactly once (500 + 300)");

  // ============================================================
  // 4) Paid name-change credit (items cart) also grants once, only when signed.
  // ============================================================
  await db.createCheckoutSession("cs_name", { userId: buyer.id, kind: "items", grantCosmetics: [], grantNameChanges: 1, totalCents: 100, itemNames: ["Name Change"] });
  const nameBody = completedEvent("cs_name");

  // Unsigned attempt grants no credit.
  const nameUnsigned = await postWebhook(nameBody, undefined);
  assert(nameUnsigned.status === 400, "unsigned name-change webhook is rejected");
  assert(((await db.getUser(buyer.id)).nameChangeCredits || 0) === 0, "no name-change credit granted from unsigned event");

  // Signed attempt grants exactly one, and a replay does not stack a second.
  const nameHeader = sign(nameBody);
  const nameFirst = await postWebhook(nameBody, nameHeader);
  assert(nameFirst.status === 200 && nameFirst.json?.nameChangeCredits === 1, "signed name-change event grants one credit");
  const nameReplay = await postWebhook(nameBody, nameHeader);
  assert(nameReplay.status === 200 && nameReplay.json?.alreadyFulfilled === true, "replayed name-change event is already fulfilled");
  assert((await db.getUser(buyer.id)).nameChangeCredits === 1, "name-change credit granted exactly once (no stacking on replay)");

  // ============================================================
  // 5) REFUND reverses a Prism grant EXACTLY ONCE (idempotent clawback).
  // ============================================================
  const refundee = await db.createUser({ name: "Refundee", googleId: "g-refundee-payments-test" });
  await db.createCheckoutSession("cs_ref1", { userId: refundee.id, packId: "pack_small", prisms: 500 });
  const comp1 = completedEvent("cs_ref1", "pi_ref1");
  await postWebhook(comp1, sign(comp1));
  assert((await db.getBalance(refundee.id, "PREMIUM")) === 500, "purchase credited 500 Prisms before refund");

  const ref1 = refundEvent("pi_ref1", "ch_ref1");
  const ref1Header = sign(ref1);
  const refunded = await postWebhook(ref1, ref1Header);
  assert(refunded.status === 200 && refunded.json?.reversed === true && refunded.json?.debited === 500, "signed refund debits the granted Prisms");
  assert((await db.getBalance(refundee.id, "PREMIUM")) === 0, "Prisms clawed back after refund");
  assert((await db.getCheckoutSession("cs_ref1")).status === "reversed", "session recorded as reversed");

  // Replay the EXACT same signed refund — Stripe retries, so this must be a no-op.
  const refundReplay = await postWebhook(ref1, ref1Header);
  assert(refundReplay.status === 200 && refundReplay.json?.alreadyReversed === true, "replayed refund is acknowledged as already reversed");
  assert((await db.getBalance(refundee.id, "PREMIUM")) === 0, "replayed refund does NOT double-debit (idempotent)");

  // ============================================================
  // 6) UNSIGNED / FORGED refund events reverse NOTHING.
  // ============================================================
  await db.createCheckoutSession("cs_ref2", { userId: refundee.id, packId: "pack_small", prisms: 500 });
  const comp2 = completedEvent("cs_ref2", "pi_ref2");
  await postWebhook(comp2, sign(comp2));
  assert((await db.getBalance(refundee.id, "PREMIUM")) === 500, "second purchase credited 500 Prisms");

  const ref2 = refundEvent("pi_ref2", "ch_ref2");
  const forgedRefund = await postWebhook(ref2, undefined); // no signature
  assert(forgedRefund.status === 400, "unsigned refund webhook is rejected with 400");
  const junkRefund = await postWebhook(ref2, sign(ref2, "whsec_attacker_secret")); // wrong secret
  assert(junkRefund.status === 400, "refund signed with the wrong secret is rejected with 400");
  assert((await db.getBalance(refundee.id, "PREMIUM")) === 500, "no Prisms clawed back from a forged/unsigned refund");
  assert((await db.getCheckoutSession("cs_ref2")).status === "fulfilled", "forged refund left the session fulfilled (not reversed)");

  // ============================================================
  // 7) Reversing a PARTIALLY-SPENT grant degrades gracefully (clamps at 0).
  // ============================================================
  await db.createCheckoutSession("cs_ref3", { userId: refundee.id, packId: "pack_small", prisms: 300 });
  const comp3 = completedEvent("cs_ref3", "pi_ref3");
  await postWebhook(comp3, sign(comp3));
  // refundee now holds 500 (from cs_ref2) + 300 = 800. Spend down to 100 so the
  // remaining balance is LESS than the 300 this session granted.
  await db.adjustBalance(refundee.id, "PREMIUM", -700, "test:spend");
  assert((await db.getBalance(refundee.id, "PREMIUM")) === 100, "balance spent down below the granted amount");

  const ref3 = refundEvent("pi_ref3", "ch_ref3");
  const partialRefund = await postWebhook(ref3, sign(ref3));
  assert(partialRefund.status === 200 && partialRefund.json?.reversed === true, "partially-spent refund still reverses");
  assert(partialRefund.json?.debited === 100, "clawback takes only what's left (clamped), not the full grant");
  assert((await db.getBalance(refundee.id, "PREMIUM")) === 0, "balance clamped at 0, never negative");

  // ============================================================
  // 8) DISPUTE (chargeback) revokes granted cosmetics + name-change credits.
  // ============================================================
  await db.createCheckoutSession("cs_ref4", { userId: refundee.id, kind: "items", grantCosmetics: ["head_halo"], grantNameChanges: 1, totalCents: 200, itemNames: ["Spirit Halo", "Name Change"] });
  const comp4 = completedEvent("cs_ref4", "pi_ref4");
  await postWebhook(comp4, sign(comp4));
  assert((await db.getUser(refundee.id)).cosmetics.has("head_halo"), "cosmetic granted before chargeback");
  assert((await db.getUser(refundee.id)).nameChangeCredits === 1, "name-change credit granted before chargeback");

  const disp4 = disputeEvent("pi_ref4", "dp_ref4");
  const disp4Header = sign(disp4);
  const disputed = await postWebhook(disp4, disp4Header);
  assert(disputed.status === 200 && disputed.json?.reversed === true, "signed dispute reverses the item grant");
  assert(!(await db.getUser(refundee.id)).cosmetics.has("head_halo"), "cosmetic revoked after chargeback");
  assert((await db.getUser(refundee.id)).nameChangeCredits === 0, "name-change credit revoked after chargeback");
  // Replayed dispute is a no-op.
  const disputeReplay = await postWebhook(disp4, disp4Header);
  assert(disputeReplay.status === 200 && disputeReplay.json?.alreadyReversed === true, "replayed dispute is already reversed (idempotent)");

  // ============================================================
  // 9) ADMIN reversal log + restore (Task #13).
  // A wrongly-reversed session can be re-granted by an admin, and the reversal
  // log surfaces both still-reversed and already-restored sessions.
  // ============================================================
  // The reversed cs_ref4 (cosmetic + name-change credit) appears in the log as
  // restorable, with the human-facing detail the console renders.
  const { reversals: beforeRestore } = await db.adminListReversals();
  const logged = beforeRestore.find((r) => r.sessionId === "cs_ref4");
  assert(!!logged, "reversed item session is surfaced in the admin reversal log");
  assert(logged.status === "reversed", "logged reversal is marked restorable (status=reversed)");
  assert(logged.userId === refundee.id && logged.userName === "Refundee", "log carries which account was reversed");
  assert(logged.reversalReason === "charge.dispute.created", "log carries the Stripe event type that caused the reversal");
  assert(Array.isArray(logged.grantCosmetics) && logged.grantCosmetics.includes("head_halo"), "log shows what cosmetic was taken back");
  assert(logged.grantNameChanges === 1, "log shows the name-change credits taken back");

  // Restore re-grants the exact items the chargeback stripped.
  const restoreItems = await db.restoreCheckoutSession("cs_ref4", buyer.id);
  assert(!restoreItems.notReversed, "restore acts on a reversed session");
  assert((await db.getUser(refundee.id)).cosmetics.has("head_halo"), "restored cosmetic is re-granted to the player");
  assert((await db.getUser(refundee.id)).nameChangeCredits === 1, "restored name-change credit is re-granted");
  assert((await db.getCheckoutSession("cs_ref4")).status === "fulfilled", "restored session flips back to fulfilled");

  // After restore it shows as RESTORED (with who/when), not as a pending clawback.
  const { reversals: afterRestore } = await db.adminListReversals();
  const restoredEntry = afterRestore.find((r) => r.sessionId === "cs_ref4");
  assert(!!restoredEntry && restoredEntry.status === "fulfilled" && !!restoredEntry.restoredAt, "restored session stays in the log marked as restored");
  assert(restoredEntry.restoredBy === buyer.id, "log records which admin restored the grant");

  // The player is told what came back: a notice is queued naming the exact items
  // (Task #15). The in-app banner drains this queue via ackNotices.
  const itemNotice = ((await db.getUser(refundee.id)).notices || [])[0];
  assert(!!itemNotice && itemNotice.kind === "restore", "restoring a session queues a player-facing notice");
  assert(/Spirit Halo/.test(itemNotice.text) && /name-change credit/.test(itemNotice.text), "notice names exactly what was restored (cosmetic + name-change credit)");

  // A second restore is a guarded no-op (no double re-grant) — and queues NO notice.
  const noticeCountBeforeNoop = (await db.getUser(refundee.id)).notices.length;
  const restoreAgain = await db.restoreCheckoutSession("cs_ref4", buyer.id);
  assert(restoreAgain.notReversed === true, "restoring an already-restored session is a guarded no-op");
  assert((await db.getUser(refundee.id)).nameChangeCredits === 1, "second restore does NOT double-grant credits");
  assert((await db.getUser(refundee.id)).notices.length === noticeCountBeforeNoop, "guarded no-op restore queues NO notice");

  // A restored session can be reversed again by a genuine later refund, then
  // re-credited via restore — covering the Prism-pack path too.
  await db.createCheckoutSession("cs_ref5", { userId: refundee.id, packId: "pack_small", prisms: 250 });
  const comp5 = completedEvent("cs_ref5", "pi_ref5");
  await postWebhook(comp5, sign(comp5));
  const ref5 = refundEvent("pi_ref5", "ch_ref5");
  await postWebhook(ref5, sign(ref5));
  const balAfterRefund = await db.getBalance(refundee.id, "PREMIUM");
  const restorePack = await db.restoreCheckoutSession("cs_ref5", buyer.id);
  assert(restorePack.restored?.credited === 250, "restoring a Prism-pack session re-credits the Prisms");
  assert((await db.getBalance(refundee.id, "PREMIUM")) === balAfterRefund + 250, "restored Prisms land back in the balance");
  // The Prism-pack restore also notifies the player, naming the amount.
  const packNotice = ((await db.getUser(refundee.id)).notices || [])[0];
  assert(!!packNotice && /250 Prisms/.test(packNotice.text), "Prism-pack restore queues a notice naming the credited Prisms");

  // ackNotices drains the player's queue (what the in-app banner calls on dismiss).
  const drained = await db.ackNotices(refundee.id);
  assert(drained.cleared.length >= 1, "ackNotices reports the drained notice ids");
  assert((await db.getUser(refundee.id)).notices.length === 0, "ackNotices empties the notice queue so it doesn't re-show");

  // ============================================================
  // 9b) ADMIN reversal log: status filter + search (Task #16).
  // As the log grows admins narrow it by status and free-text search; the
  // default view leads with still-reversed (restorable) sessions.
  // ============================================================
  // cs_ref5 is reversed again to give the log a mix of reversed + restored.
  const ref5b = refundEvent("pi_ref5", "ch_ref5");
  await postWebhook(ref5b, sign(ref5b));

  const { reversals: all, total: allTotal } = await db.adminListReversals();
  assert(all.length >= 2, "default (all) log surfaces both reversed and restored sessions");
  assert(allTotal >= 2, "log reports a total count of matching reversals");
  const firstRestored = all.findIndex((r) => !!r.restoredAt);
  const lastReversed = all.map((r) => !r.restoredAt).lastIndexOf(true);
  assert(firstRestored === -1 || lastReversed === -1 || lastReversed < firstRestored,
    "still-reversed (restorable) sessions lead, restored history trails");

  const { reversals: reversedOnly } = await db.adminListReversals({ status: "reversed" });
  assert(reversedOnly.length > 0 && reversedOnly.every((r) => !r.restoredAt),
    "status=reversed returns only still-clawed-back sessions");

  const { reversals: restoredOnly } = await db.adminListReversals({ status: "restored" });
  assert(restoredOnly.length > 0 && restoredOnly.every((r) => !!r.restoredAt),
    "status=restored returns only already-restored sessions");

  const { reversals: byName } = await db.adminListReversals({ query: "refundee" });
  assert(byName.length > 0 && byName.every((r) => r.userName === "Refundee"),
    "search matches player name (case-insensitive)");
  const { reversals: byId } = await db.adminListReversals({ query: refundee.id });
  assert(byId.length > 0 && byId.every((r) => r.userId === refundee.id), "search matches player id");
  const { reversals: noMatch, total: noMatchTotal } = await db.adminListReversals({ query: "zzz-nobody" });
  assert(noMatch.length === 0 && noMatchTotal === 0, "search with no match returns an empty log");

  // ============================================================
  // 9b-ii) ADMIN reversal log: date-range narrowing (Task #25).
  // Admins jump to an incident window by from/to (date-only, inclusive UTC).
  // An entry matches if its reversal OR restore timestamp lands in the window.
  // ============================================================
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const farFuture = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const farPast = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const { total: allRangeTotal } = await db.adminListReversals({ status: "all" });
  const todayRange = await db.adminListReversals({ status: "all", from: today, to: today });
  assert(todayRange.total === allRangeTotal,
    "a from/to window covering today captures every reversal/restore made this run");
  const wideRange = await db.adminListReversals({ status: "all", from: yesterday, to: tomorrow });
  assert(wideRange.total === allRangeTotal, "a wider window still captures the full set");
  const futureRange = await db.adminListReversals({ status: "all", from: tomorrow, to: farFuture });
  assert(futureRange.total === 0 && futureRange.reversals.length === 0,
    "a future-only window excludes everything (nothing reversed in the future)");
  const pastRange = await db.adminListReversals({ status: "all", from: farPast, to: yesterday });
  assert(pastRange.total === 0, "a past-only window (before this run) excludes everything");
  // from bound is inclusive of the start of day; to bound is inclusive of the end of day.
  const fromOnly = await db.adminListReversals({ status: "all", from: today });
  assert(fromOnly.total === allRangeTotal, "an open-ended from (no to) keeps everything from that day on");
  const toOnly = await db.adminListReversals({ status: "all", to: today });
  assert(toOnly.total === allRangeTotal, "an open-ended to (no from) keeps everything up to end of that day");
  // Date range composes with the status filter and search.
  const rangedReversed = await db.adminListReversals({ status: "reversed", from: today, to: today });
  assert(rangedReversed.reversals.every((r) => !r.restoredAt),
    "date range composes with the status filter");
  const rangedByName = await db.adminListReversals({ from: today, to: today, query: "refundee" });
  assert(rangedByName.reversals.every((r) => r.userName === "Refundee"),
    "date range composes with free-text search");

  // ============================================================
  // 9c) ADMIN reversal log: pagination (Task #19).
  // The log returns a bounded page (limit/offset) plus total/hasMore so a busy
  // store with thousands of entries doesn't ship everything in one response.
  // Paging keeps the active status filter.
  // ============================================================
  const page1 = await db.adminListReversals({ status: "all", limit: 1, offset: 0 });
  assert(page1.reversals.length === 1, "limit bounds the returned page size");
  assert(page1.total >= 2, "total reflects the full filtered set, not just the page");
  assert(page1.hasMore === true, "hasMore flags there is more history beyond the page");
  const page2 = await db.adminListReversals({ status: "all", limit: 1, offset: 1 });
  assert(page2.reversals.length === 1, "offset returns the next page");
  assert(page2.reversals[0].sessionId !== page1.reversals[0].sessionId,
    "consecutive pages return different entries (no overlap)");
  const lastPage = await db.adminListReversals({ status: "all", limit: 1, offset: page1.total - 1 });
  assert(lastPage.hasMore === false, "hasMore is false on the final page");
  const bigLimit = await db.adminListReversals({ status: "all", limit: 1000 });
  assert(bigLimit.reversals.length === bigLimit.total && bigLimit.hasMore === false,
    "a limit larger than the set returns everything with hasMore=false");
  // Pagination respects the status filter: a reversed-only page only has reversed.
  const reversedPaged = await db.adminListReversals({ status: "reversed", limit: 1, offset: 0 });
  assert(reversedPaged.reversals.every((r) => !r.restoredAt),
    "paged results keep the active status filter");

  // ============================================================
  // 10) REFUND does NOT strip a cosmetic re-acquired from another valid source.
  //    A player buys a cosmetic, then legitimately re-obtains the SAME cosmetic
  //    via a loot box / gift / level unlock. A later refund of the purchase must
  //    leave the cosmetic in place — it is no longer SOLELY attributable to it.
  // ============================================================
  const keeper = await db.createUser({ name: "Keeper", googleId: "g-keeper-payments-test" });
  await db.createCheckoutSession("cs_keep", { userId: keeper.id, kind: "items", grantCosmetics: ["head_halo"], grantNameChanges: 0, totalCents: 100, itemNames: ["Spirit Halo"] });
  const compKeep = completedEvent("cs_keep", "pi_keep");
  await postWebhook(compKeep, sign(compKeep));
  assert((await db.getUser(keeper.id)).cosmetics.has("head_halo"), "purchased cosmetic granted before refund");

  // Player re-acquires the SAME cosmetic from a separate, still-valid source
  // (e.g. a loot-box drop) AFTER the purchase.
  await db.grantCosmetic(keeper.id, "head_halo", "box:prism_vault");

  const refKeep = refundEvent("pi_keep", "ch_keep");
  const keepRes = await postWebhook(refKeep, sign(refKeep));
  assert(keepRes.status === 200 && keepRes.json?.reversed === true, "refund of a re-acquired cosmetic still processes");
  assert((await db.getUser(keeper.id)).cosmetics.has("head_halo"), "cosmetic re-acquired from another source survives the refund clawback");
  const keepRevoked = (keepRes.json?.revokedItems || [])[0];
  assert(keepRevoked && keepRevoked.removed === false && keepRevoked.remainingSources === 1,
    "clawback reports the cosmetic kept (one valid source still holds it)");

  // ...but a fresh purchase with NO other source is still fully clawed back.
  await db.createCheckoutSession("cs_only", { userId: keeper.id, kind: "items", grantCosmetics: ["head_crown"], grantNameChanges: 0, totalCents: 100, itemNames: ["Astral Crown"] });
  const compOnly = completedEvent("cs_only", "pi_only");
  await postWebhook(compOnly, sign(compOnly));
  assert((await db.getUser(keeper.id)).cosmetics.has("head_crown"), "single-source cosmetic granted before refund");
  const refOnly = refundEvent("pi_only", "ch_only");
  const onlyRes = await postWebhook(refOnly, sign(refOnly));
  assert(onlyRes.status === 200 && onlyRes.json?.reversed === true, "single-source refund processes");
  assert(!(await db.getUser(keeper.id)).cosmetics.has("head_crown"), "single-source cosmetic is still removed by the clawback");

  // ============================================================
  // 10) REFUND does NOT strip a purchased cosmetic ALSO unlocked by leveling up.
  //     Buy a cosmetic that a later level grants (tool_wrench @ lvl 10), then earn
  //     enough XP to cross that level AFTER owning it. The level unlock must still
  //     register as a valid source so the purchase refund leaves the item in place.
  // ============================================================
  const leveler = await db.createUser({ name: "Leveler", googleId: "g-leveler-payments-test" });
  await db.createCheckoutSession("cs_lvl", { userId: leveler.id, kind: "items", grantCosmetics: ["tool_wrench"], grantNameChanges: 0, totalCents: 100, itemNames: ["Wrench"] });
  const compLvl = completedEvent("cs_lvl", "pi_lvl");
  await postWebhook(compLvl, sign(compLvl));
  assert((await db.getUser(leveler.id)).cosmetics.has("tool_wrench"), "level-grant cosmetic purchased before refund");

  // Cross level 10 (xpForLevel(10) = 4500), which grants tool_wrench — already owned.
  await db.addXp(leveler.id, 5000, "test:levelup");
  assert((await db.getUser(leveler.id)).level >= 10, "leveler reached the level that grants the cosmetic");

  const refLvl = refundEvent("pi_lvl", "ch_lvl");
  const lvlRes = await postWebhook(refLvl, sign(refLvl));
  assert(lvlRes.status === 200 && lvlRes.json?.reversed === true, "refund of a level-unlocked cosmetic still processes");
  assert((await db.getUser(leveler.id)).cosmetics.has("tool_wrench"), "cosmetic also unlocked by leveling survives the refund clawback");
} finally {
  server.close();
}

console.log(`\n=========================`);
console.log(`PASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
