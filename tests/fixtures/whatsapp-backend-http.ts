import assert from "node:assert/strict";
import { build } from "esbuild";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createOfficeKongConnector } from "../../server/office-kong";
import type { WhatsAppReaderEvidence } from "../../shared/whatsapp-office-agent";

export const BACKEND_REVISION = "daada94d52df2e6b008b59799d2db723215df0c5";
const OWNER = "11111111-1111-4111-8111-111111111111";
const TOKEN = "synthetic-office-fixture-read-token-00000000";
/** Actual backend HTTP office projection, fixture auth/storage only; no live DB or outgoing network. */
export async function createBackendHttpFixture() {
  const configured = process.env.KONG_WHATSAPP_BACKEND_FIXTURE;
  assert.ok(configured?.trim(), "KONG_WHATSAPP_BACKEND_FIXTURE must name the pinned backend checkout");
  const backend = resolve(configured);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: backend, encoding: "utf8" }).trim(), BACKEND_REVISION);
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", "server", "shared"], { cwd: backend, stdio: "pipe" });
  const temp = await mkdtemp(join(tmpdir(), "office-whatsapp-http-"));
  const outfile = join(temp, "backend.mjs");
  const require = createRequire(import.meta.url);
  await build({ entryPoints: [join(backend,"server/kong-ceo/routes.ts")], outfile, bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",tsconfigRaw:{},
    define: { "process.env.KONG_OFFICE_READ_TOKEN": JSON.stringify(TOKEN) },
    plugins: [{name:"isolated-services",setup(builder) {
      builder.onResolve({filter:/^express$/},()=>({path:pathToFileURL(require.resolve("express")).href,external:true}));
      builder.onResolve({filter:/.*/},args=>args.kind === "dynamic-import" && args.path !== "./company-operations" ? {path:args.path,namespace:"fixture"} : undefined);
      builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({loader:"js",contents:args.path === "../db" ? "export const pool={async query(){return {rows:[]}}};" : "throw new Error('UNEXPECTED_SERVICE');"}));
    }}],
  });
  const { registerCeoRoutes } = await import(pathToFileURL(outfile).href);
  let stored: WhatsAppReaderEvidence | null = null;
  const app=express(); app.use(express.json({limit:4096}));
  const auth=(req:any,res:any,next:any)=>req.headers["x-fixture-producer"] === "yes" ? (req.user={id:"synthetic-producer",role:"admin"},next()) : res.status(401).json({code:"AUTH_REQUIRED"});
  registerCeoRoutes(app,auth,{enabled:true,backgroundWorkerEnabled:false,assistantCallbackEnabled:false,service:{},whatsappEvidenceBridge:{enabled:true,expectedOwnerId:OWNER,authorize:(req:any)=>req.user?.id === "synthetic-producer",store:{put:async(value:WhatsAppReaderEvidence)=>{stored=structuredClone(value);return "stored";},read:async()=>stored}}});
  const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  const address=server.address(); assert.ok(address && typeof address !== "string");
  const base=`http://127.0.0.1:${address.port}`;
  async function audit(value:WhatsAppReaderEvidence|null) {
    stored=null;
    if(value) {
      const response=await fetch(`${base}/api/admin/ceo/whatsapp-reader/evidence`,{method:"POST",headers:{"content-type":"application/json","x-fixture-producer":"yes"},body:JSON.stringify(value)});
      assert.equal(response.status,200);
    }
    let projection:any;
    const connector=createOfficeKongConnector({token:()=>TOKEN,fetchImpl:async(url,init)=>{
      if(String(url)==="https://kongnightlife.com/api/admin/ceo/operations") {
        const response=await fetch(`${base}/api/admin/ceo/operations`,init);
        projection=await response.clone().json();
        assert.deepEqual(projection.objectives,[]); // Proves restricted office-read projection, not admin raw DTO.
        return response;
      }
      assert.equal(String(url),"https://kongnightlife.com/api/admin/city-agents");
      const cities=projection.agents.filter((agent:any)=>agent.kind==="city").map((agent:any)=>({id:agent.id.replace(/^city:/,""),name:"Fixture City",countryCode:"US",timeZone:"America/New_York",currency:"USD",status:"healthy",jobs:[]}));
      return new Response(JSON.stringify({enabled:true,coordinator:"global",maxConcurrent:1,referenceCity:cities[0].id,countries:["US"],needsAttention:[],cities}),{headers:{"content-type":"application/json"}});
    }});
    return { audit:await connector.runOfficeKongReadOnly(), projection };
  }
  return {audit,close:async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(temp,{recursive:true,force:true});}};
}
