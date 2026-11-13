import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  assertRevenueStripeAccount,
  extractRevenueStripePayment,
  formatRevenueDealNotification,
  verifyRevenueStripeWebhook,
} from "../server/revenue-stripe";

const secret = "whsec_revenue_websites_test_secret";
const timestamp = 1_700_000_000;

function signedPayload(overrides: Record<string, unknown> = {}) {
  const payload = Buffer.from(JSON.stringify({
    id: "evt_revenue_1",
    type: "checkout.session.completed",
    account: "acct_robertwebsites",
    livemode: true,
    created: timestamp,
    data: {
      object: {
        id: "cs_revenue_1",
        payment_status: "paid",
        payment_intent: "pi_revenue_1",
        amount_total: 125000,
        currency: "usd",
        customer_details: { name: "Acme Med Spa", email: "owner@example.com" },
        metadata: {
          stripeAccountId: "acct_robertwebsites",
          revenueOpportunityId: "automation-123",
          ownerUserId: "owner-1",
          packageName: "Website Premium",
          scopeApproved: "true",
        },
      },
    },
    ...overrides,
  }));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload.toString("utf8")}`).digest("hex");
  return { payload, header: `t=${timestamp},v1=${signature}` };
}

test("verifies a signed Robert Websites payment and extracts the deal", () => {
  const signed = signedPayload();
  const event = verifyRevenueStripeWebhook(signed.payload, signed.header, secret, timestamp);
  assertRevenueStripeAccount(event, "acct_robertwebsites");
  const payment = extractRevenueStripePayment(event);
  assert.equal(payment?.amountCents, 125000);
  assert.equal(payment?.opportunityId, "automation-123");
  assert.equal(payment?.scopeApproved, true);
});

test("rejects tampered payloads and events from another Stripe account", () => {
  const signed = signedPayload();
  assert.throws(
    () => verifyRevenueStripeWebhook(Buffer.from(`${signed.payload.toString("utf8")} `), signed.header, secret, timestamp),
    /signature verification failed/,
  );
  const event = verifyRevenueStripeWebhook(signed.payload, signed.header, secret, timestamp);
  assert.throws(() => assertRevenueStripeAccount(event, "acct_kogn"), /different account/);

  const unbound = signedPayload({
    account: undefined,
    data: {
      object: {
        id: "cs_unbound",
        payment_status: "paid",
        amount_total: 10000,
        currency: "usd",
        metadata: {},
      },
    },
  });
  const unboundEvent = verifyRevenueStripeWebhook(unbound.payload, unbound.header, secret, timestamp);
  assert.throws(() => assertRevenueStripeAccount(unboundEvent, "acct_robertwebsites"), /missing.*account binding/);
});

test("formats the exact amount in the owner notification", () => {
  const signed = signedPayload();
  const event = verifyRevenueStripeWebhook(signed.payload, signed.header, secret, timestamp);
  const payment = extractRevenueStripePayment(event)!;
  const message = formatRevenueDealNotification(payment, true);
  assert.match(message, /DEAL CERRADO/);
  assert.match(message, /Acme Med Spa/);
  assert.match(message, /\$1,250\.00 USD/);
  assert.match(message, /Website Premium/);
  assert.match(message, /pi_revenue_1/);
});

test("ignores unpaid or unrelated Stripe events", () => {
  const unpaid = signedPayload({
    type: "checkout.session.completed",
    data: { object: { id: "cs_unpaid", payment_status: "unpaid", amount_total: 5000, currency: "usd" } },
  });
  const unpaidEvent = verifyRevenueStripeWebhook(unpaid.payload, unpaid.header, secret, timestamp);
  assert.equal(extractRevenueStripePayment(unpaidEvent), null);

  const unrelated = signedPayload({ type: "customer.created" });
  const unrelatedEvent = verifyRevenueStripeWebhook(unrelated.payload, unrelated.header, secret, timestamp);
  assert.equal(extractRevenueStripePayment(unrelatedEvent), null);

  const paymentIntent = signedPayload({ type: "payment_intent.succeeded" });
  const paymentIntentEvent = verifyRevenueStripeWebhook(paymentIntent.payload, paymentIntent.header, secret, timestamp);
  assert.equal(extractRevenueStripePayment(paymentIntentEvent), null);
});
