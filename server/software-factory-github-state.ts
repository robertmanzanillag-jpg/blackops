import { createHash } from "node:crypto";
import type { FactoryObjectTransport } from "./software-factory-object-store";
import { createEncryptedFactoryTransport } from "./software-factory-encrypted-state";

/** Dedicated control repository only. The operator creates factory-state before
 * explicitly bootstrapping the ledger. No automatic budget reset or retry. */
export function createGitHubFactoryStateTransport(options: {
  repository: string;
  key: Uint8Array;
  request: (url: string, init: RequestInit) => Promise<Response>;
  maxPlaintextBytes?: number;
  /** Separate synthetic CAS proof; never reuse it as the financial ledger. */
  object?: "ledger" | "transport-probe";
}): FactoryObjectTransport {
  if (!/^[A-Za-z0-9-]+\/software-factory-pilot$/.test(options.repository)) throw Error("FACTORY_STATE_REPOSITORY_INVALID");
  const repository = options.repository, request = options.request;
  const limit = options.maxPlaintextBytes ?? 8 * 1024 * 1024;
  const encodedLimit = Math.ceil(limit * 4 / 3) + 256;
  const base = `https://api.github.com/repos/${repository}`;
  if (options.object !== undefined && !["ledger", "transport-probe"].includes(options.object)) throw Error("FACTORY_STATE_OBJECT_INVALID");
  const path = `.factory/${options.object ?? "ledger"}.enc.json`, branch = "factory-state";
  const shaValid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
  const blobSha = (body: Buffer) => createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
  const generation = (sha: string) => BigInt(`0x${sha}`).toString();
  const decodeGeneration = (value: string) => {
    if (!/^[1-9][0-9]{0,48}$/.test(value)) throw Error("FACTORY_STATE_GENERATION_INVALID");
    const sha = BigInt(value).toString(16).padStart(40, "0");
    if (!shaValid(sha)) throw Error("FACTORY_STATE_GENERATION_INVALID");
    return sha;
  };
  async function call(route: string, method = "GET", body?: unknown) {
    try {
      const response = await request(base + route, { method, redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { Accept: method === "GET" && route.startsWith("/contents/") ? "application/vnd.github.object+json" : "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2026-03-10" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) { await response.body?.cancel(); return { status: response.status, data: undefined }; }
      const reader = response.body?.getReader(); if (!reader) throw Error();
      const chunks: Buffer[] = []; let size = 0;
      try {
        for (;;) { const c = await reader.read(); if (c.done) break; size += c.value.length;
          if (size > Math.ceil(encodedLimit * 4 / 3) + 65536) throw Error(); chunks.push(Buffer.from(c.value)); }
      } finally { await reader.cancel(); }
      return { status: response.status, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } catch { throw Error("FACTORY_STATE_REQUEST_UNCONFIRMED"); }
  }
  async function validateRepository() {
    const r = await call("");
    if (r.status !== 200 || r.data?.full_name !== repository || r.data.private !== false || r.data.archived || r.data.disabled || r.data.default_branch === branch) throw Error("FACTORY_STATE_REPOSITORY_UNVERIFIED");
  }
  const raw: FactoryObjectTransport = {
    async read() {
      await validateRepository();
      const meta = await call(`/contents/${path}?ref=refs%2Fheads%2F${branch}`);
      if (meta.status === 404) return undefined;
      const m = meta.data;
      if (meta.status !== 200 || m?.type !== "file" || m.path !== path || !shaValid(m.sha) || !Number.isSafeInteger(m.size) || m.size < 0 || m.size > encodedLimit) throw Error("FACTORY_STATE_METADATA_INVALID");
      // Read the immutable blob, never a second mutable branch download.
      const blob = await call(`/git/blobs/${m.sha}`), b = blob.data;
      if (blob.status !== 200 || b?.sha !== m.sha || b.encoding !== "base64" || b.size !== m.size || typeof b.content !== "string") throw Error("FACTORY_STATE_VERSION_UNCONFIRMED");
      const encoded = b.content.replace(/\n/g, "");
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.toString("base64") !== encoded || bytes.length !== m.size || blobSha(bytes) !== m.sha) throw Error("FACTORY_STATE_VERSION_UNCONFIRMED");
      return { generation: generation(m.sha), body: new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(bytes) };
    },
    async compareAndSwap(expected, body) {
      const sha = expected === null ? undefined : decodeGeneration(expected);
      if (Buffer.byteLength(body) > encodedLimit) throw Error("FACTORY_STATE_TOO_LARGE");
      await validateRepository();
      const bytes = Buffer.from(body);
      const r = await call(`/contents/${path}`, "PUT", { branch, message: "Checkpoint encrypted factory state",
        content: bytes.toString("base64"), ...(sha ? { sha } : {}) });
      if (r.status === 409) return { kind: "conflict" };
      if (![200, 201].includes(r.status) || r.data?.content?.sha !== blobSha(bytes) || r.data.content.path !== path) throw Error("FACTORY_STATE_WRITE_UNCONFIRMED");
      return { kind: "written", generation: generation(r.data.content.sha) };
    },
  };
  return createEncryptedFactoryTransport({ transport: raw, key: options.key, scope: `${repository}/${branch}/${path}`, maxPlaintextBytes: limit });
}
