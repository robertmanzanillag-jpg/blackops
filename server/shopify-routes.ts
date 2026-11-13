import type { Express } from "express";
import { createShopifyAuthorizationUrl, exchangeShopifyAuthorizationCode, getShopifyOAuthStatus } from "./shopify-oauth";
import { getCurrentUserId, getSystemUserId } from "./user-context";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function registerShopifyRoutes(app: Express): void {
  app.use("/api/shopify", (req, res, next) => {
    const userId = getCurrentUserId(req);
    const shopifyOwnerUserId = getSystemUserId();
    if (userId !== shopifyOwnerUserId) {
      return res.status(403).json({
        error: "Shopify connection management is limited to the configured single-user owner while the store token is shared.",
      });
    }
    return next();
  });

  app.get("/api/shopify/oauth/status", (_req, res) => {
    try {
      res.json(getShopifyOAuthStatus());
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch Shopify OAuth status" });
    }
  });

  app.get("/api/shopify/install", (req, res) => {
    const { shop } = req.query;
    if (!shop || typeof shop !== "string") {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Shopify install incompleto</h1>
          <p>Falta el parametro shop de Shopify.</p>
          <a href="/dropshipping-ceo" style="color:#3b82f6;">Volver a Dropshipping CEO</a>
        </body></html>
      `);
    }

    try {
      res.redirect(createShopifyAuthorizationUrl({ shop, req, verifyInstallHmac: Boolean(req.query.hmac) }));
    } catch (error: any) {
      res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Shopify no está configurado</h1>
          <p>${escapeHtml(error.message || "Agrega SHOPIFY_APP_CLIENT_ID y SHOPIFY_APP_CLIENT_SECRET.")}</p>
          <a href="/dropshipping-ceo" style="color:#3b82f6;">Volver a Dropshipping CEO</a>
        </body></html>
      `);
    }
  });

  app.get("/api/shopify/oauth/start", (req, res) => {
    const shop = typeof req.query.shop === "string" ? req.query.shop : process.env.SHOPIFY_SHOP_DOMAIN;
    if (!shop) {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Shopify store requerido</h1>
          <p>Abre esta ruta con ?shop=tu-tienda.myshopify.com o configura SHOPIFY_SHOP_DOMAIN.</p>
          <a href="/dropshipping-ceo" style="color:#3b82f6;">Volver a Dropshipping CEO</a>
        </body></html>
      `);
    }

    try {
      res.redirect(createShopifyAuthorizationUrl({ shop, req }));
    } catch (error: any) {
      res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Shopify OAuth no está configurado</h1>
          <p>${escapeHtml(error.message || "Agrega SHOPIFY_APP_CLIENT_ID y SHOPIFY_APP_CLIENT_SECRET.")}</p>
          <a href="/dropshipping-ceo" style="color:#3b82f6;">Volver a Dropshipping CEO</a>
        </body></html>
      `);
    }
  });

  app.get("/api/shopify/oauth/callback", async (req, res) => {
    const { code, state, shop, error, error_description: errorDescription } = req.query;

    if (error) {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error conectando Shopify</h1>
          <p>${escapeHtml(errorDescription || error)}</p>
          <a href="/dropshipping-ceo" style="color:#3b82f6;">Volver a Dropshipping CEO</a>
        </body></html>
      `);
    }

    if (!code || typeof code !== "string" || !state || typeof state !== "string" || !shop || typeof shop !== "string") {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error conectando Shopify</h1>
          <p>No se recibió el authorization code/state/shop de Shopify.</p>
          <a href="/dropshipping-ceo" style="color:#3b82f6;">Volver a Dropshipping CEO</a>
        </body></html>
      `);
    }

    try {
      const result = await exchangeShopifyAuthorizationCode({ code, state, shop, query: req.query });
      res.send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1 style="color:#22c55e;">Shopify conectado</h1>
          <p>El Admin API token quedó guardado para Dropshipping CEO sin mostrarlo en pantalla.</p>
          <p style="color:#94a3b8;">Store: ${escapeHtml(result.shop)}</p>
          <p style="color:#94a3b8;">Scopes: ${escapeHtml(result.scope || "guardados")}</p>
          <p style="color:#94a3b8;">Env local: ${escapeHtml(result.envFilePath)}</p>
          <a href="/dropshipping-ceo" style="color:#3b82f6;">Ir a Dropshipping CEO</a>
        </body></html>
      `);
    } catch (callbackError: any) {
      res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error conectando Shopify</h1>
          <p>${escapeHtml(callbackError.message || "No se pudo guardar la conexión de Shopify.")}</p>
          <a href="/dropshipping-ceo" style="color:#3b82f6;">Volver a Dropshipping CEO</a>
        </body></html>
      `);
    }
  });
}
