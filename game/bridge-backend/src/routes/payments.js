import { Router } from "express";
import crypto from "crypto";
import Stripe from "stripe";
import { db } from "../store/index.js";
import { requireAuth } from "../middleware/auth.js";
import { config, PRISM_PACKS, stripePlaceholders } from "../config/index.js";

export const paymentsRouter = Router();

// Lazily build the Stripe client from the configured secret key. Returns null in
// stub mode so the dev simulation path stays active without a real account.
let _stripe = null;
function stripe() {
  if (stripePlaceholders()) return null;
  if (!_stripe) _stripe = new Stripe(config.stripe.secretKey);
  return _stripe;
}

// ============================================================
// Paid store (Stripe). CRITICAL: real money is NEVER credited on the client's
// say-so. The only place Prisms are granted is the webhook, which Stripe calls
// server-to-server AFTER the user actually pays. The client just kicks off a
// Checkout Session and is redirected to Stripe's hosted page.
//
// In dev (placeholder keys) we simulate this: createCheckout returns a fake
// session + a "simulate payment" URL, and /webhook accepts a locally-signed
// event so the full path is testable without a real Stripe account.
// ============================================================

// List the Gold Nugget bundles the paid store sells.
paymentsRouter.get("/packs", (_req, res) => {
  res.json({
    currency: "PREMIUM",
    label: "Gold Nuggets",
    stripeMode: stripePlaceholders() ? "stub" : "live",
    packs: Object.values(PRISM_PACKS).map((p) => ({
      id: p.id, label: p.label,
      prisms: p.prisms + (p.bonus || 0),
      basePrisms: p.prisms, bonus: p.bonus || 0,
      priceCents: p.priceCents,
      priceDisplay: `$${(p.priceCents / 100).toFixed(2)}`,
    })),
  });
});

// Start a purchase. Creates a Checkout Session and records it as pending.
// Returns the URL the client should send the user to.
paymentsRouter.post("/checkout", requireAuth, async (req, res) => {
  const { packId } = req.body || {};
  const pack = PRISM_PACKS[packId];
  if (!pack) return res.status(404).json({ error: "Unknown pack." });
  const prisms = pack.prisms + (pack.bonus || 0);

  if (stripePlaceholders()) {
    // DEV STUB: fabricate a session id and a local "pay" link that POSTs a
    // simulated webhook. With real keys this block is replaced by a real
    // stripe.checkout.sessions.create({...}) call returning session.url.
    const sessionId = "cs_test_" + crypto.randomBytes(8).toString("hex");
    await db.createCheckoutSession(sessionId, { userId: req.userId, packId, prisms });
    return res.json({
      mode: "stub",
      sessionId,
      // The real flow redirects to Stripe; in stub mode we expose how to simulate
      // the webhook so the purchase can be completed end-to-end in dev.
      checkoutUrl: null,
      devSimulate: {
        method: "POST", path: "/payments/webhook",
        note: "Send this body to simulate Stripe confirming payment.",
        body: { type: "checkout.session.completed", data: { object: { id: sessionId } } },
      },
    });
  }

  // LIVE: create a real Stripe Checkout Session and send the user to its hosted page.
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [{ price_data: { currency: "usd",
        product_data: { name: pack.label },
        unit_amount: pack.priceCents }, quantity: 1 }],
      success_url: config.stripe.successUrl,
      cancel_url: config.stripe.cancelUrl,
      metadata: { userId: req.userId, packId },
    });
    await db.createCheckoutSession(session.id, { userId: req.userId, packId, prisms });
    return res.json({ mode: "live", sessionId: session.id, checkoutUrl: session.url });
  } catch (e) {
    console.error("[payments/checkout] Stripe error:", e.message);
    return res.status(502).json({ error: "Could not start checkout. Please try again." });
  }
});

// Start a CART checkout for one or more PREMIUM/cash store items (e.g. the $1
// test items). Computes the total from the items' priceCents server-side (never
// trusts a client price), creates a pending session that — once Stripe confirms
// — grants the cosmetics. In stub mode it returns the simulate-webhook recipe;
// with live keys, swap in stripe.checkout.sessions.create with the line items.
paymentsRouter.post("/checkout-items", requireAuth, async (req, res) => {
  const { itemIds } = req.body || {};
  if (!Array.isArray(itemIds) || itemIds.length === 0) return res.status(400).json({ error: "Cart is empty." });
  const items = [];
  for (const id of itemIds) {
    const it = await db.getStoreItem(id);
    if (!it || it.enabled === false) return res.status(404).json({ error: `Item ${id} not available.` });
    if (it.currency !== "PREMIUM") return res.status(400).json({ error: `${it.name} isn't a cash item.` });
    if (!it.priceCents) return res.status(400).json({ error: `${it.name} has no cash price set.` });
    items.push(it);
  }
  const totalCents = items.reduce((a, it) => a + it.priceCents, 0);
  const grantCosmetics = items.map((it) => it.cosmeticId).filter(Boolean);
  // Utility products (e.g. the $1 name change) grant account credits instead of a
  // cosmetic. Sum the credits to grant so the webhook can hand them out.
  const grantNameChanges = items.reduce((a, it) => a + (it.grantsNameChange || 0), 0);

  if (stripePlaceholders()) {
    const sessionId = "cs_test_" + crypto.randomBytes(8).toString("hex");
    await db.createCheckoutSession(sessionId, { userId: req.userId, kind: "items", grantCosmetics, grantNameChanges, totalCents,
      itemNames: items.map((i) => i.name) });
    return res.json({
      mode: "stub", sessionId, totalCents, priceDisplay: `$${(totalCents / 100).toFixed(2)}`,
      checkoutUrl: null,
      devSimulate: { method: "POST", path: "/payments/webhook",
        note: "POST this to simulate Stripe confirming the payment and granting the items.",
        body: { type: "checkout.session.completed", data: { object: { id: sessionId } } } },
    });
  }
  // LIVE: create a real session with one line item per cart item. The cosmetics
  // to grant are stored on the session and only handed out by the webhook.
  try {
    const session = await stripe().checkout.sessions.create({ mode: "payment",
      line_items: items.map((it) => ({ price_data: { currency: "usd",
        product_data: { name: it.name }, unit_amount: it.priceCents }, quantity: 1 })),
      success_url: config.stripe.successUrl, cancel_url: config.stripe.cancelUrl,
      metadata: { userId: req.userId, kind: "items" } });
    await db.createCheckoutSession(session.id, { userId: req.userId, kind: "items", grantCosmetics, grantNameChanges, totalCents,
      itemNames: items.map((i) => i.name) });
    return res.json({ mode: "live", sessionId: session.id, checkoutUrl: session.url, totalCents, priceDisplay: `$${(totalCents / 100).toFixed(2)}` });
  } catch (e) {
    console.error("[payments/checkout-items] Stripe error:", e.message);
    return res.status(502).json({ error: "Could not start checkout. Please try again." });
  }
});


// from Stripe (signature), then fulfills the matching session exactly once.
paymentsRouter.post("/webhook", async (req, res) => {
  let event = req.body;

  if (!stripePlaceholders()) {
    // LIVE: verify the signature against the raw body + webhook secret. Anyone can
    // POST here, so an unverified event must never be trusted to grant anything.
    const sig = req.headers["stripe-signature"];
    try {
      event = stripe().webhooks.constructEvent(req.rawBody, sig, config.stripe.webhookSecret);
    } catch (e) {
      console.error("[payments/webhook] signature verification failed:", e.message);
      return res.status(400).send(`Webhook signature failed: ${e.message}`);
    }
  }

  if (!event || typeof event.type !== "string") {
    return res.json({ received: true, ignored: true });
  }

  // Refund / chargeback: Stripe sends these AFTER a purchase is clawed back.
  // Reverse the matching fulfillment so the player doesn't keep what they no
  // longer paid for. Same signature gate as the completion path above.
  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    return handleReversal(req, res, event);
  }

  // STUB: accept the event as-is (dev only). Only handle the completion event.
  if (event.type !== "checkout.session.completed") {
    return res.json({ received: true, ignored: true });
  }
  const sessionId = event?.data?.object?.id;
  const session = await db.getCheckoutSession(sessionId);
  if (!session) return res.status(404).json({ error: "Unknown session." });

  // Record the PaymentIntent so a later refund/dispute event (which references the
  // charge's payment_intent, not this session id) can be traced back here.
  const paymentIntent = event?.data?.object?.payment_intent;
  if (paymentIntent) { try { await db.linkPaymentIntent(sessionId, paymentIntent); } catch { /* best effort */ } }

  try {
    const result = await db.fulfillCheckoutSession(sessionId);
    if (result.alreadyFulfilled) {
      return res.json({ received: true, alreadyFulfilled: true }); // idempotent: no double-credit
    }
    // Fulfill based on session kind. Item carts grant cosmetics; packs credit prisms.
    if (session.kind === "items") {
      const granted = [];
      for (const cosmeticId of (session.grantCosmetics || [])) {
        const g = await db.grantCosmetic(session.userId, cosmeticId, `stripe:${sessionId}`);
        await db.addItem(session.userId, cosmeticId, "Purchased", `stripe:${sessionId}`);
        granted.push({ cosmeticId, newlyOwned: g.newlyOwned });
      }
      // Hand out any paid name-change credits bundled into this cart.
      let nameChangeCredits;
      if (session.grantNameChanges > 0) {
        ({ nameChangeCredits } = await db.grantNameChangeCredit(session.userId, session.grantNameChanges));
      }
      // Count the confirmed spend toward the loyalty ladder (item cart total).
      try { await db.recordSpend(session.userId, session.totalCents || 0); } catch { /* loyalty tracking is non-fatal */ }
      return res.json({ received: true, grantedItems: granted, nameChangeCredits });
    }
    // Default: prism pack — credit the premium currency now that payment is confirmed.
    const balance = await db.adjustBalance(session.userId, "PREMIUM", session.prisms, `stripe:${sessionId}`);
    // Count the confirmed spend toward the loyalty ladder (server-side pack price).
    try { await db.recordSpend(session.userId, PRISM_PACKS[session.packId]?.priceCents || 0); } catch { /* loyalty tracking is non-fatal */ }
    res.json({ received: true, credited: session.prisms, balance });
  } catch (e) {
    // A fulfillment failure (e.g. the target account no longer exists, or a
    // transient store error) must NEVER bubble up as an unhandled rejection and
    // crash the whole single-process game server. Log and report a 500 instead.
    // We claimed the session above (status=fulfilled) before crediting; since the
    // credit failed, release the claim so a legitimate retry can complete and the
    // player isn't charged without receiving their purchase. Stripe retries 5xx.
    try { await db.unclaimCheckoutSession(sessionId); } catch { /* best effort */ }
    req.log?.error?.({ err: e, sessionId }, "payment webhook fulfillment failed");
    console.error("[payments/webhook] fulfillment failed:", e.message);
    res.status(500).json({ error: "Fulfillment failed." });
  }
});

// Convenience for the client to poll whether their session completed.
paymentsRouter.get("/session/:id", requireAuth, async (req, res) => {
  const s = await db.getCheckoutSession(req.params.id);
  if (!s || s.userId !== req.userId) return res.status(404).json({ error: "Not found." });
  res.json({ status: s.status, packId: s.packId, prisms: s.prisms });
});

// Handle a signature-verified refund / chargeback event. Stripe's charge and
// dispute objects carry the PaymentIntent (not the checkout session id), so we
// trace it back to the original fulfilled session and reverse exactly that grant.
// Idempotent: a replayed refund event reverses at most once (status=reversed).
async function handleReversal(req, res, event) {
  const obj = event?.data?.object || {};
  const paymentIntent = obj.payment_intent;
  const session = await db.findCheckoutSessionByPaymentIntent(paymentIntent);
  // No fulfilled session matches this charge — nothing was granted here to take
  // back (e.g. a refund on a charge unrelated to a tracked purchase). Ack so
  // Stripe doesn't keep retrying.
  if (!session) return res.json({ received: true, ignored: true });

  try {
    const claim = await db.reverseCheckoutSession(session.sessionId, event.type);
    if (claim.alreadyReversed) return res.json({ received: true, alreadyReversed: true });
    if (claim.notFulfilled) return res.json({ received: true, notFulfilled: true });

    try {
      const reversal = await applyReversal(session);
      return res.json({ received: true, reversed: true, ...reversal });
    } catch (e) {
      // The clawback failed AFTER we claimed the reversal; release the claim so a
      // Stripe retry of the refund event can complete it. Re-throw to the 500 path.
      try { await db.unreverseCheckoutSession(session.sessionId); } catch { /* best effort */ }
      throw e;
    }
  } catch (e) {
    req.log?.error?.({ err: e, sessionId: session.sessionId }, "payment webhook reversal failed");
    console.error("[payments/webhook] reversal failed:", e.message);
    return res.status(500).json({ error: "Reversal failed." });
  }
}

// Reverse the exact grant a fulfilled session handed out. Item carts revoke the
// granted cosmetics and remove unspent name-change credits; packs debit the
// granted Prisms. All debits clamp at 0 so a partially-spent grant degrades
// gracefully instead of pushing a balance negative.
async function applyReversal(session) {
  if (session.kind === "items") {
    const revoked = [];
    for (const cosmeticId of (session.grantCosmetics || [])) {
      // Drop only THIS purchase's hold on the cosmetic. If the player re-acquired
      // the same item from a still-valid source (loot box, gift, level unlock,
      // code, another purchase), it survives the clawback.
      const r = await db.removeCosmeticSource(session.userId, cosmeticId, `stripe:${session.sessionId}`);
      revoked.push({ cosmeticId, removed: r.removed, remainingSources: r.remainingSources });
    }
    let nameChangeCredits, nameChangesRevoked;
    if (session.grantNameChanges > 0) {
      ({ nameChangeCredits, revoked: nameChangesRevoked } =
        await db.revokeNameChangeCredit(session.userId, session.grantNameChanges));
    }
    return { revokedItems: revoked, nameChangeCredits, nameChangesRevoked };
  }
  // Default: prism pack — debit the granted Prisms (clamped at 0).
  const { balance, debited } = await db.debitBalanceClamped(
    session.userId, "PREMIUM", session.prisms || 0, `stripe:refund:${session.sessionId}`);
  return { debited, balance };
}
