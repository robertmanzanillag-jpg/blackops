import {createHash} from "node:crypto";

/** JSONB preserves values and array order, but not object key order. */
export function canonicalEvidenceJson(value:unknown):string {
  const normalize=(item:any):any=>Array.isArray(item)?item.map(normalize):item && typeof item==="object"
    ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,normalize(item[key])])) : item;
  return JSON.stringify(normalize(value));
}
export const canonicalEvidenceDigest=(value:unknown)=>createHash("sha256").update(canonicalEvidenceJson(value)).digest("hex");
