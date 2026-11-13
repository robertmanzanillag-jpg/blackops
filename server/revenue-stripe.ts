import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;
const SUPPORTED_PAYMENT_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

export type RevenueStripeEventPayload = {
  id: string;
  type: string;
  account?: string;
  livemode: boolean;
  created: number;
  data: { object: Record<string, unknown> };
};

export type RevenueStripePayment = {
  eventId: string;
  eventType: string;
  objectId: string;
  paymentIntentId: string;
  amountCents: number;
  currency: string;
  clientName: string;
  clientEmail: string;
  packageName: string;
  opportunityId: string;
  ownerUserId: string;
  scopeApproved: boolean;
  paidAt: Date;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseStripeSignature(header: string) {
  const entries = header.split(",").map((entry) => entry.trim().split("=", 2));
  const timestamp = Number(entries.find(([key]) => key === "t")?.[1]);
  const signatures = entries.filter(([key]) => key === "v1").map(([, value]) => value).filter(Boolean);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || signatures.length === 0) {
    throw new Error("Invalid Stripe-Signature header");
  }
  return { timestamp, signatures };
}

function safeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyRevenueStripeWebhook(
  rawBody: Buffer,
  signatureHeader: string,
  webhookSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): RevenueStripeEventPayload {
  if (!webhookSecret.startsWith("whsec_") || webhookSecret.length < 24) {
    throw new Error("Revenue Stripe webhook secret is not configured");
  }
  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  if (Math.abs(nowSeconds - timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    throw new Error("Stripe webhook timestamp is outside the allowed tolerance");
  }
  const expected = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  if (!signatures.some((signature) => safeHexEqual(signature, expected))) {
    throw new Error("Stripe webhook signature verification failed");
  }

  const payload = JSON.parse(rawBody.toString("utf8")) as RevenueStripeEventPayload;
  if (!payload || typeof payload !== "object" || cleanString(payload.id).length === 0) {
    throw new Error("Stripe webhook payload is missing an event id");
  }
  if (!payload.data || typeof payload.data.object !== "object" || payload.data.object === null) {
    throw new Error("Stripe webhook payload is missing its data object");
  }
  return payload;
}

export function assertRevenueStripeAccount(event: RevenueStripeEventPayload, expectedAccountId: string): void {
  if (!/^acct_[A-Za-z0-9]+$/.test(expectedAccountId)) {
    throw new Error("REVENUE_STRIPE_ACCOUNT_ID is not configured");
  }
  const objectMetadata = (event.data.object.metadata || {}) as Record<string, unknown>;
  const declaredAccount = cleanString(event.account) || cleanString(objectMetadata.stripeAccountId);
  if (!declaredAccount) {
    throw new Error("Stripe event is missing its Robert Websites account binding");
  }
  if (declaredAccount !== expectedAccountId) {
    throw new Error("Stripe event belongs to a different account");
  }
}

export function extractRevenueStripePayment(event: RevenueStripeEventPayload): RevenueStripePayment | null {
  if (!SUPPORTED_PAYMENT_EVENTS.has(event.type)) return null;
  const object = event.data.object;
  const metadata = (object.metadata || {}) as Record<string, unknown>;
  const paymentStatus = cleanString(object.payment_status);
  if (paymentStatus !== "paid") return null;

  const amountCents = Number(object.amount_total);
  const objectId = cleanString(object.id);
  const currency = cleanString(object.currency).toUpperCase();
  if (!objectId || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Stripe payment event is missing a valid id, amount, or currency");
  }

  const customerDetails = (object.customer_details || {}) as Record<string, unknown>;
  const clientEmail = cleanString(customerDetails.email) || cleanString(object.receipt_email) || cleanString(metadata.clientEmail);
  const clientName = cleanString(metadata.clientName) || cleanString(customerDetails.name) || clientEmail || "Cliente Stripe";
  const paymentIntent = object.payment_intent;

  return {
    eventId: event.id,
    eventType: event.type,
    objectId,
    paymentIntentId: cleanString(typeof paymentIntent === "object" && paymentIntent ? (paymentIntent as Record<string, unknown>).id : paymentIntent),
    amountCents,
    currency,
    clientName,
    clientEmail,
    packageName: cleanString(metadata.packageName) || cleanString(metadata.productName) || cleanString(object.description) || "Servicio Robert Websites",
    opportunityId: cleanString(metadata.revenueOpportunityId) || cleanString(metadata.opportunityId),
    ownerUserId: cleanString(metadata.ownerUserId),
    scopeApproved: cleanString(metadata.scopeApproved).toLowerCase() === "true",
    paidAt: new Date(event.created * 1000),
  };
}

function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
}

export function formatRevenueDealNotification(payment: RevenueStripePayment, dealRecorded: boolean): string {
  return [
    dealRecorded ? "DEAL CERRADO" : "PAGO CONFIRMADO",
    `Cliente: ${payment.clientName}`,
    `Cobrado: ${formatMoney(payment.amountCents, payment.currency)} ${payment.currency}`,
    `Producto: ${payment.packageName}`,
    `Stripe: ${payment.paymentIntentId || payment.objectId}`,
    `Fecha: ${payment.paidAt.toISOString()}`,
  ].join("\n");
}
