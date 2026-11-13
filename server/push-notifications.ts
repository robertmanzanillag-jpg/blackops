import webpush from "web-push";
import { storage } from "./storage";
import { hasRealValue } from "./ceo-doctor-cli";

let configuredVapidSignature: string | null = null;

function getVapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!hasRealValue(publicKey) || !hasRealValue(privateKey)) return null;

  const subject = hasRealValue(process.env.VAPID_SUBJECT)
    ? process.env.VAPID_SUBJECT!
    : "mailto:blackops@reminder.app";

  return { publicKey, privateKey, subject };
}

function configureWebPush(): boolean {
  const config = getVapidConfig();
  if (!config) return false;

  const signature = `${config.subject}:${config.publicKey}:${config.privateKey}`;
  if (configuredVapidSignature !== signature) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    configuredVapidSignature = signature;
  }

  return true;
}

export function getVapidPublicKey(): string {
  return getVapidConfig()?.publicKey || "";
}

interface NotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  taskId?: string;
}

export async function sendPushNotification(
  userId: string,
  payload: NotificationPayload
): Promise<{ success: number; failed: number }> {
  if (!configureWebPush()) {
    return { success: 0, failed: 0 };
  }

  const subscriptions = await storage.getPushSubscriptions(userId);
  
  let success = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        JSON.stringify(payload)
      );
      success++;
    } catch (error: any) {
      failed++;
      // Remove invalid subscriptions (410 Gone or 404 Not Found)
      if (error.statusCode === 410 || error.statusCode === 404) {
        await storage.deletePushSubscription(sub.endpoint);
      }
    }
  }

  return { success, failed };
}

export async function sendNotificationToAll(
  payload: NotificationPayload
): Promise<{ success: number; failed: number }> {
  if (!configureWebPush()) {
    return { success: 0, failed: 0 };
  }

  const subscriptions = await storage.getAllPushSubscriptions();
  
  let success = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        JSON.stringify(payload)
      );
      success++;
    } catch (error: any) {
      failed++;
      if (error.statusCode === 410 || error.statusCode === 404) {
        await storage.deletePushSubscription(sub.endpoint);
      }
    }
  }

  return { success, failed };
}
