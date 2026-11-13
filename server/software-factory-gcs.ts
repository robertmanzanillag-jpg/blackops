import { createHash } from "node:crypto";
import type { FactoryObjectTransport } from "./software-factory-object-store";

/** The operator supplies an authenticated request implementation with bounded
 * retries. No credential is accepted from a project, payload, or model output. */
export function createGcsFactoryTransport(options: {
  bucket: string;
  object: string;
  request: (url: string, init: RequestInit) => Promise<Response>;
  maxBytes: number;
}): FactoryObjectTransport {
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(options.bucket) ||
      !/^factory\/[a-zA-Z0-9_-]+\/ledger\.json$/.test(options.object) ||
      !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1024 || options.maxBytes > 16 * 1024 * 1024) {
    throw new Error("FACTORY_STORAGE_CONFIGURATION_INVALID");
  }
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(options.bucket)}/o/${encodeURIComponent(options.object)}`;
  const generation = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,30}$/.test(value);
  async function request(url: string, init: RequestInit, limit: number): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await options.request(url, { ...init, redirect: "error", signal: controller.signal });
      // Error bodies can contain provider details; never log or expose them.
      if (!response.ok) { await response.body?.cancel(); return { status: response.status, text: "" }; }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("FACTORY_STORAGE_EMPTY_RESPONSE");
      const parts: Buffer[] = []; let bytes = 0;
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > limit) { await reader.cancel(); throw new Error("FACTORY_STORAGE_SIZE_LIMIT"); }
        parts.push(Buffer.from(chunk.value));
      }
      return { status: response.status, text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)) };
    } catch {
      throw new Error("FACTORY_STORAGE_REQUEST_UNCONFIRMED");
    } finally { clearTimeout(timer); }
  }
  return {
    async read() {
      const metadata = await request(`${base}?fields=generation,size,md5Hash,contentEncoding`, { method: "GET" }, 4096);
      if (metadata.status === 404) return undefined;
      if (metadata.status !== 200) throw new Error("FACTORY_STORAGE_READ_UNAVAILABLE");
      let parsed: { generation?: unknown; size?: unknown; md5Hash?: unknown; contentEncoding?: unknown };
      try { parsed = JSON.parse(metadata.text); } catch { throw new Error("FACTORY_STORAGE_METADATA_INVALID"); }
      if (!parsed || !generation(parsed.generation) || typeof parsed.size !== "string" ||
          !/^[0-9]+$/.test(parsed.size) || BigInt(parsed.size) > BigInt(options.maxBytes) ||
          typeof parsed.md5Hash !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(parsed.md5Hash) || parsed.contentEncoding) {
        throw new Error("FACTORY_STORAGE_METADATA_INVALID");
      }
      // Pin the download. With versioning disabled a concurrent replacement may
      // yield 404; this is a read failure, never permission to reset the ledger.
      const data = await request(`${base}?alt=media&generation=${parsed.generation}`, { method: "GET" }, options.maxBytes);
      if (data.status !== 200 || Buffer.byteLength(data.text) !== Number(parsed.size) ||
          createHash("md5").update(data.text).digest("base64") !== parsed.md5Hash) throw new Error("FACTORY_STORAGE_VERSION_UNCONFIRMED");
      return { generation: parsed.generation, body: data.text };
    },
    async compareAndSwap(expectedGeneration, body) {
      if ((expectedGeneration !== null && !generation(expectedGeneration)) ||
          typeof body !== "string" || Buffer.byteLength(body) > options.maxBytes) throw new Error("FACTORY_STORAGE_WRITE_INVALID");
      const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(options.bucket)}/o?uploadType=media&name=${encodeURIComponent(options.object)}&ifGenerationMatch=${expectedGeneration ?? "0"}`;
      const result = await request(url, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body }, 4096);
      if (result.status === 412) return { kind: "conflict" };
      if (result.status !== 200 && result.status !== 201) throw new Error("FACTORY_STORAGE_WRITE_UNCONFIRMED");
      let parsed: { generation?: unknown };
      try { parsed = JSON.parse(result.text); } catch { throw new Error("FACTORY_STORAGE_WRITE_UNCONFIRMED"); }
      if (!parsed || !generation(parsed.generation)) throw new Error("FACTORY_STORAGE_WRITE_UNCONFIRMED");
      return { kind: "written", generation: parsed.generation };
    },
  };
}
