import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { FactoryObjectTransport } from "./software-factory-object-store";

/** Encrypt the entire ledger before passing it to operator-installed storage.
 * The key must stay in the control plane, never in repository commands or logs.
 * Encryption does not prevent a storage administrator from rolling back history;
 * the backing transport must retain its CAS and access-control guarantees. */
export function createEncryptedFactoryTransport(options: {
  transport: FactoryObjectTransport;
  key: Uint8Array;
  scope: string;
  /** Configure the backing transport to accept at least
   * ceil(maxPlaintextBytes * 4 / 3) + 256 bytes per encrypted object.
   * Use this plaintext limit for the ledger's own capacity accounting. */
  maxPlaintextBytes?: number;
}): FactoryObjectTransport {
  if (options.key.byteLength !== 32 || !options.scope.trim()) throw Error("FACTORY_STATE_ENCRYPTION_CONFIGURATION");
  const key = Buffer.from(options.key), aad = Buffer.from(`factory-state-v1:${options.scope}`);
  const limit = options.maxPlaintextBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8 * 1024 * 1024) throw Error("FACTORY_STATE_ENCRYPTION_CONFIGURATION");
  const transport = options.transport;
  return {
    async read() {
      const value = await transport.read();
      if (!value) return undefined;
      try {
        if (Buffer.byteLength(value.body) > Math.ceil(limit * 4 / 3) + 256) throw Error();
        const envelope = JSON.parse(value.body);
        if (!envelope || Object.keys(envelope).sort().join() !== "ciphertext,nonce,tag,version" || envelope.version !== 1) throw Error();
        const decode = (text: unknown) => {
          if (typeof text !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw Error();
          return Buffer.from(text, "base64");
        };
        const nonce = decode(envelope.nonce), tag = decode(envelope.tag), ciphertext = decode(envelope.ciphertext);
        if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length > limit) throw Error();
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(aad); decipher.setAuthTag(tag);
        const bytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        return { generation: value.generation, body };
      } catch {
        // Never expose stored content or turn corruption into an empty ledger.
        throw Error("FACTORY_STATE_AUTHENTICATION_FAILED");
      }
    },
    async compareAndSwap(expectedGeneration, body) {
      const bytes = Buffer.from(body);
      if (bytes.length > limit) throw Error("FACTORY_STATE_TOO_LARGE");
      // Reject lossy UTF-16 conversion rather than silently changing ledger text.
      if (bytes.toString("utf8") !== body) throw Error("FACTORY_STATE_INVALID_TEXT");
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
      const envelope = JSON.stringify({ version: 1, nonce: nonce.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
      // No retries: an ambiguous write must preserve the worker's reservation.
      return transport.compareAndSwap(expectedGeneration, envelope);
    },
  };
}
