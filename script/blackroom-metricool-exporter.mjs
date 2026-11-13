import { mkdir, rename, writeFile } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { extractMetricoolCsvSamples } from "./blackroom-metricool-csv-bridge.mjs";
import { compareBrandEvidence } from "../server/organic-brand-comparison.mjs";

export const METRICOOL_EXPORT_PAGES = {
  tiktok: { route: "tiktok", exportIndex: 0, identity: "tiktok.com/@blackroom.clipss" },
  facebook: { route: "facebookPage", exportIndex: 1, identity: "facebook.com/1290355464151585" },
  youtube: { route: "youtube", exportIndex: 0, identity: "youtube.com/channel/UCi__qHBfHLlYg0fu86BUA8g" },
};
export const KONG_EXPORT_PAGES = {
  tiktok: { route: 'tiktok', exportIndex: 0, identity: 'tiktok.com/@kongnightlife' },
  facebook: { route: 'facebookPage', exportIndex: 1, identity: 'facebook.com/1251688224688420' },
};

/** A delivery failure on one network must not discard other successful exports. */
export async function deliverMetricoolExports(result, send, { sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const errors = { ...(result.errors || {}) };
  const importedByNetwork = {};
  let imported = 0;
  for (const item of Array.isArray(result.imports) ? result.imports : []) {
    if (!Object.hasOwn(METRICOOL_EXPORT_PAGES, item?.network) || !Array.isArray(item.samples)) continue;
    try {
      for (let start = 0; start < item.samples.length; start += 2000) {
        const samples = item.samples.slice(start, start + 2000);
        for (let attempt = 0; ; attempt++) {
          try {
            await send({ imports: [{ ...item, samples }] });
            break;
          } catch (error) {
            const status = Number(error?.status);
            const transient = [408, 429, 502, 503, 504].includes(status)
              || ["TimeoutError", "AbortError", "TypeError"].includes(error?.name);
            if (!transient || attempt >= 2) throw error;
            // Reuse the same observedAt and samples: the server deduplicates
            // uncertain deliveries. Never recapture dates to disguise a retry.
            await sleep(1000 * 2 ** attempt);
          }
        }
        imported += samples.length;
        importedByNetwork[item.network] = (importedByNetwork[item.network] || 0) + samples.length;
      }
    } catch (error) {
      const status = Number(error?.status);
      const detail = Number.isInteger(status) && status >= 400 && status <= 599 ? ` HTTP ${status}.` : "";
      errors[item.network] = `La exportación se obtuvo, pero su entrega falló.${detail} Se reintentará sin duplicar las muestras.`;
    }
  }
  const complete = Object.keys(METRICOOL_EXPORT_PAGES).every((network) =>
    importedByNetwork[network] > 0 && !errors[network])
    && Object.keys(errors).length === 0 && result.setupRequired !== true;
  return { imported, importedByNetwork, complete, errors };
}

/** Convert only explicitly local CSV wall-clock values using the known account
 * timezone. Ambiguous fall-back and nonexistent spring-forward times are gaps,
 * never guessed. Provider-supplied offset timestamps are preserved. */
export function metricoolPublicationInstant(raw, timezone = "America/New_York") {
  if (typeof raw !== "string") return undefined;
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : undefined;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})$/.exec(raw);
  if (!match) return undefined;
  const nominal = Date.parse(`${raw}Z`);
  if (!Number.isFinite(nominal)) return undefined;
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const matches = [];
  // Bounded offset search covers timezone offsets including half/quarter hours.
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const instant = new Date(nominal + offset * 60_000);
    const parts = Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]));
    if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` === raw) matches.push(instant.toISOString());
  }
  return matches.length === 1 ? matches[0] : undefined;
}

export function buildVerifiedMetricoolExport({ filename, text, network, observedAt, timezone }) {
  const parsed = extractMetricoolCsvSamples(filename, text);
  if (!parsed || parsed.network !== network) throw new Error(`Unexpected Metricool export for ${network}`);
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("Invalid export observation time");
  return { network, sourceFiles: [path.basename(filename)], samples: parsed.samples.map((sample) => ({
    ...sample, observedAt, publishedAt: metricoolPublicationInstant(sample.publishedAt, timezone),
  })) };
}

/** UI-only acquisition: no private endpoints, extracted cookies, AI calls or
 * paid analytics API. A separate WebKit profile requires one owner login. */
export async function acquireMetricoolExports({ context, authenticatedPage, now = () => new Date(), timezone = "America/New_York", networkTimeoutMs = 60_000, brandId = '6585226' }) {
  if (!['6585226','6475033'].includes(brandId)) throw new Error('Unapproved brand');
  const pages = brandId === '6475033' ? KONG_EXPORT_PAGES : METRICOOL_EXPORT_PAGES;
  const imports = [], errors = {};
  let setupRequired = false;
    for (const [network, config] of Object.entries(pages)) {
      const page = authenticatedPage || await context.newPage();
      page.setDefaultTimeout(30_000);
      let timer, timedOut = false;
      let stage = "navigation";
      try {
        const acquire = async () => {
        await page.goto(`https://app.metricool.com/evolution/${config.route}?blogId=${brandId}&userId=3558197`, { waitUntil: "domcontentloaded" });
        if (typeof page.url === 'function') {
          const location = new URL(page.url());
          if(location.hostname !== 'app.metricool.com' || location.searchParams.get('blogId') !== brandId) throw new Error('Wrong Metricool brand page');
        }
        if (typeof page.url === "function" && /\/login(?:[/?#]|$)/.test(page.url())) {
          setupRequired = true;
          throw new Error("Metricool login required");
        }
        // Wait for the actual connected account, not merely a loaded SPA shell.
        stage = "account-identity";
        await page.locator(`a[href*="${config.identity}"]`).first().waitFor({ state: "visible" });
        const identityLink = page.locator(`a[href*="${config.identity}"]`).first();
        if (typeof identityLink.getAttribute === 'function') {
          const actual = new URL(await identityLink.getAttribute('href'));
          const expected = new URL('https://' + config.identity);
          if (actual.protocol !== 'https:' || actual.hostname.replace(/^www\./,'') !== expected.hostname.replace(/^www\./,'') || actual.pathname.replace(/\/$/,'') !== expected.pathname || actual.username || actual.password) throw new Error('Wrong account identity');
        }
        stage = "date-menu";
        const period = page.getByText("Main period", { exact: true }).locator("..");
        await period.getByRole("button").first().click();
        stage = "date-range";
        await page.getByRole("button", { name: "Last 30 days", exact: true }).click();
        const downloadButton = page.getByRole("button", { name: "Download CSV", exact: true }).nth(config.exportIndex);
        stage = "export-button";
        await downloadButton.waitFor({ state: "visible" });
        stage = "download";
        const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), downloadButton.click()]);
        const failure = await download.failure();
        if (failure) throw new Error("Metricool export did not finish");
        const stream = await download.createReadStream();
        if (!stream) throw new Error("Metricool export has no readable content");
        let text = "", bytes = 0;
        const decoder = new StringDecoder("utf8");
        for await (const chunk of stream) {
          bytes += chunk.length;
          if (bytes > 25 * 1024 * 1024) throw new Error("Metricool CSV exceeds import limit");
          text += decoder.write(chunk);
        }
        text += decoder.end();
        stage = "parse";
        if (!timedOut) imports.push(buildVerifiedMetricoolExport({ filename: download.suggestedFilename(), text, network, observedAt: now().toISOString(), timezone }));
        };
        await Promise.race([acquire(), new Promise((_, reject) => {
          timer = setTimeout(() => { timedOut = true; reject(new Error("Network export timeout")); }, networkTimeoutMs);
        })]);
      } catch (error) {
        // Do not persist page content, URLs containing auth data or credentials.
        if (typeof page.url === "function" && /\/login(?:[/?#]|$)/.test(page.url())) setupRequired = true;
        errors[network] = `No se pudo exportar (${stage}${timedOut ? ":timeout" : ""}): revisa sesión, cuenta conectada o cambios en la interfaz de Metricool.`;
      } finally {
        clearTimeout(timer);
        if (!authenticatedPage || timedOut) await page.close().catch(() => undefined);
      }
      // A timed-out shared tab cannot be reused while earlier UI work may still
      // be unwinding. Preserve partial results and require a clean next run.
      if (authenticatedPage && timedOut) {
        for (const pending of Object.keys(pages)) {
          if (!errors[pending] && !imports.some((item) => item.network === pending)) errors[pending] = "No se intentó exportar: la pestaña autenticada agotó su tiempo de espera.";
        }
        break;
      }
    }
  return { brandId, imports, errors, setupRequired, checkedAt: now().toISOString() };
}

export async function acquireBrandPair({context, authenticatedPage, statePath, acquire = acquireMetricoolExports, secondaryTimeoutMs = 45000}) {
  const save = async (file, value) => { await mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(value),{mode:0o600});await rename(tmp,file); };
  const blackroom=await acquire({context,authenticatedPage,brandId:'6585226'});
  // Commit primary evidence before any optional secondary acquisition.
  await save(statePath,blackroom);
  let secondaryTimer, expired = false;
  try {
    const kong=await Promise.race([acquire({context,brandId:'6475033',networkTimeoutMs:20_000}),new Promise((_,reject)=>{secondaryTimer=setTimeout(()=>{expired=true;reject(new Error('Secondary timeout'));},secondaryTimeoutMs)})]);
    if(expired) return blackroom;
    await save(path.join(path.dirname(statePath),'kong-latest-export.json'),kong);
    await save(path.join(path.dirname(statePath),'organic-brand-comparison.json'),compareBrandEvidence(blackroom,kong));
  } catch { /* Primary export is already durable; secondary must not block it. */ }
  finally { clearTimeout(secondaryTimer); }
  return blackroom;
}

export async function runMetricoolExporter({ profileDir, statePath, login = false, headless = true }) {
  const { webkit } = await import("playwright");
  const context = await webkit.launchPersistentContext(profileDir, { headless: login ? false : headless, acceptDownloads: true });
  try {
    let authenticatedPage;
    if (login) {
      authenticatedPage = context.pages()[0] || await context.newPage();
      await authenticatedPage.goto("https://app.metricool.com/");
      // Let the owner authenticate normally. Keep the same tab/context; do not
      // read, copy or synthesize cookies, tokens or browser storage.
      await authenticatedPage.waitForURL(/^https:\/\/app\.metricool\.com\/(?:evolution|planner|user-settings|brands)(?:\/|\?|$)/, { timeout: 20 * 60_000 });
    }
    const result = await acquireBrandPair({context,authenticatedPage,statePath});
    return result;
  } finally { await Promise.race([context.close().catch(()=>{}),new Promise(resolve=>{const timer=setTimeout(resolve,2000);timer.unref();})]); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(process.env.BLACKROOM_ANALYTICS_STATE_DIR || (process.platform === "darwin"
    ? path.join(homedir(), "Library/Application Support/BlackRoom/analytics")
    : path.join(process.cwd(), "clippers_workspace/blackroom/analytics")));
  const profileDir = path.join(root, "browser-profile");
  await runMetricoolExporter({ profileDir, statePath: path.join(root, "latest-export.json"), login: process.argv.includes("--login") });
}
