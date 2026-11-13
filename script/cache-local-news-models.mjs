// Explicit operator-only bootstrap for the pinned, zero-cost local translation models.
// Production runtime keeps remote model loading disabled after this cache is populated.
process.env.CLIPPERS_LOCAL_NEWS_ALLOW_MODEL_DOWNLOAD = "true";
process.env.NODE_ENV = "production";

const { OpusMtLocalTranslationAdapter } = await import("../server/clippers-local-news-translation.ts");
const adapter = new OpusMtLocalTranslationAdapter();

await adapter.translate("The road is closed.", "en-es");
await adapter.translate("La carretera está cerrada.", "es-en");

console.log("Pinned OPUS-MT English/Spanish models cached for local inference.");
