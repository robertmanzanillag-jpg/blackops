import {assertWebSourceOwner,validateWebRoleSource,type SourcePool,type WebRoleSource,type WebSourceRole} from "./office-web-role-sources";
import {sourceDigest} from "./office-role-snapshots";
export const OFFICE_WEB_ROLE_SOURCE_SCHEMA_SQL=`CREATE TABLE IF NOT EXISTS office_web_role_sources(owner_key text NOT NULL,role text NOT NULL,source jsonb NOT NULL,observed_at timestamptz NOT NULL,PRIMARY KEY(owner_key,role));`;
export async function persistWebRoleSources(pool:SourcePool,owner:string,configuredOwner:string,sources:WebRoleSource[]) {
 await assertWebSourceOwner(pool,owner,configuredOwner);
 if(new Set(sources.map(s=>s.role)).size!==sources.length)throw new Error("Duplicate role export");
 const checked=sources.map(s=>validateWebRoleSource(s,owner));
 for(const source of checked){const result=await pool.query(`INSERT INTO office_web_role_sources(owner_key,role,source,observed_at) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(owner_key,role) DO UPDATE SET source=EXCLUDED.source,observed_at=EXCLUDED.observed_at WHERE office_web_role_sources.observed_at<EXCLUDED.observed_at OR (office_web_role_sources.observed_at=EXCLUDED.observed_at AND office_web_role_sources.source=EXCLUDED.source) RETURNING role`,[sourceDigest(owner),source.role,JSON.stringify(source),source.observedAt]);if(result.rows.length!==1)throw new Error("Stale or conflicting export");}
}
export async function readStoredWebRoleSource(pool:SourcePool,owner:string,configuredOwner:string,role:WebSourceRole):Promise<WebRoleSource|null>{
 await assertWebSourceOwner(pool,owner,configuredOwner);
 const result=await pool.query("SELECT source FROM office_web_role_sources WHERE owner_key=$1 AND role=$2",[sourceDigest(owner),role]);
 if(result.rows.length>1)throw new Error("Duplicate stored export");
 if(!result.rows.length)return null;const source=validateWebRoleSource(result.rows[0].source,owner);if(source.role!==role)throw new Error("Stored role mismatch");return source;
}
