import { FACTORY_ASISTENTE_REPOSITORY } from "./software-factory-github-client";

/** Dedicated worker credential, supplied only by its private launcher. It never
 * reaches generated code or process arguments. No retries or redirects. */
export function createAsistenteGitHubTransport(token: string, transport: typeof fetch = fetch) {
  if (!/^github_pat_[A-Za-z0-9_]{40,250}$/.test(token)) throw Error("FACTORY_GITHUB_CREDENTIAL_REQUIRED");
  const root = `/repos/${FACTORY_ASISTENTE_REPOSITORY}`;
  return async (url: string, init: RequestInit): Promise<Response> => {
    const target = new URL(url), method = init.method || "GET";
    const route = target.pathname.slice(root.length);
    if (target.origin !== "https://api.github.com" || target.username || target.password || target.hash ||
        !(target.pathname === root || target.pathname.startsWith(root + "/")) ||
        !["GET", "POST"].includes(method) || !init.signal) throw Error("FACTORY_GITHUB_TRANSPORT_SCOPE_INVALID");
    if (method === "POST" && (!/^\/(?:git\/(?:blobs|trees|commits|refs)|pulls)$/.test(route) || target.search)) {
      throw Error("FACTORY_GITHUB_TRANSPORT_WRITE_DENIED");
    }
    const artifactDownload = method === "GET" && /^\/actions\/artifacts\/[1-9][0-9]*\/zip$/.test(route) && !target.search;
    if (method === "GET" && !artifactDownload && !/^(?:$|\/git\/(?:commits|trees|blobs|ref)\/|\/contents\/|\/actions\/(?:workflows|runs)\/|\/pulls$)/.test(route)) {
      throw Error("FACTORY_GITHUB_TRANSPORT_READ_DENIED");
    }
    init.signal.throwIfAborted();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const accept = headers.get("Accept") || "application/vnd.github+json";
    if (!["application/vnd.github+json", "application/vnd.github.object+json"].includes(accept)) throw Error("FACTORY_GITHUB_TRANSPORT_MEDIA_INVALID");
    headers.set("Accept", accept);
    headers.set("X-GitHub-Api-Version", "2026-03-10");
    headers.set("Content-Type", "application/json");
    try { return await transport(target.href, { ...init, method, headers, redirect: artifactDownload ? "manual" : "error", credentials: "omit" }); }
    catch { throw Error("FACTORY_GITHUB_TRANSPORT_UNCONFIRMED"); }
  };
}
