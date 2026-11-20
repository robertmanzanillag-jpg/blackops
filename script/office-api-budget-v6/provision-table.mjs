import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
export const TABLE_SQL='CREATE TABLE IF NOT EXISTS public.software_factory_api_authority (owner_key text PRIMARY KEY, state jsonb NOT NULL);';
const COLUMNS="SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='software_factory_api_authority' ORDER BY ordinal_position";
const PRIMARY="SELECT array_agg(a.attname ORDER BY u.ordinality) AS columns FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY u(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=u.attnum WHERE n.nspname='public' AND t.relname='software_factory_api_authority' AND c.contype='p' GROUP BY c.oid";
class SchemaHeld extends Error {constructor(code){super(code);Object.defineProperty(this,'safeCode',{value:code});}}
const held=code=>new SchemaHeld(code);
/** Explicit table-only transaction. No env files, grants, months, balances or
 * checkpoints are initialized. Dry run is the default and always rolls back. */
export async function provisionApiAuthorityTable(pool,{apply=false}={}){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SET LOCAL lock_timeout = 2000');
  await client.query('SET LOCAL statement_timeout = 15000');
  await client.query('SELECT pg_advisory_xact_lock(83817421)');
  const scope=await client.query('SELECT current_schema() AS schema');
  if(scope.rows[0]?.schema!=='public')throw held('SCHEMA_SCOPE_UNSUPPORTED');
  const before=await client.query("SELECT to_regclass('public.software_factory_api_authority') IS NOT NULL AS present");
  const wasPresent=before.rows[0]?.present===true;
  let rowCount=0;
  if(wasPresent)rowCount=Number((await client.query('SELECT count(*)::bigint AS count FROM public.software_factory_api_authority')).rows[0]?.count);
  if(!Number.isSafeInteger(rowCount)||rowCount<0)throw held('SCHEMA_ROW_COUNT_UNVERIFIED');
  await client.query(TABLE_SQL);
  const columns=(await client.query(COLUMNS)).rows;
  if(JSON.stringify(columns)!==JSON.stringify([{column_name:'owner_key',data_type:'text',is_nullable:'NO'},{column_name:'state',data_type:'jsonb',is_nullable:'NO'}]))throw held('SCHEMA_SHAPE_MISMATCH');
  const primary=(await client.query(PRIMARY)).rows;
  if(primary.length!==1||JSON.stringify(primary[0].columns)!==JSON.stringify(['owner_key']))throw held('SCHEMA_IDENTITY_MISMATCH');
  const after=Number((await client.query('SELECT count(*)::bigint AS count FROM public.software_factory_api_authority')).rows[0]?.count);
  if(after!==rowCount)throw held('SCHEMA_ROWS_CHANGED');
  await client.query(apply?'COMMIT':'ROLLBACK');
  return {scope:'current_operator_connection',tableValidated:true,applied:apply,existedBefore:wasPresent,rowsUnchanged:true,initializedMonth:false,initializedBalance:false,wroteCheckpoint:false,providerCalled:false};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();}
}
async function main(){
 const argv=process.argv.slice(2);if(argv.length>1||argv.some(value=>value!=='--apply'))throw held('ARGUMENT_INVALID');
 const backend=process.env.SOFTWARE_FACTORY_STORAGE_BACKEND;
 if((backend!==undefined&&backend!=='postgres')||process.env.SOFTWARE_FACTORY_STORE_MODULE)throw held('SCHEMA_POSTGRES_SELECTION_REQUIRED');
 const root=fs.realpathSync(process.cwd()),require=createRequire(path.join(root,'package.json'));
 const {Pool}=require('pg');
 const {resolveDatabaseConnectionString}=await import(pathToFileURL(path.join(root,'server/database-url.ts')).href);
 const connectionString=resolveDatabaseConnectionString();
 if(typeof connectionString!=='string'||!connectionString.trim())throw held('SCHEMA_CONNECTION_REQUIRED');
 const pool=new Pool({connectionString,connectionTimeoutMillis:10000,statement_timeout:15000,max:1,allowExitOnIdle:true});
 pool.on('error',()=>{});
 try{console.log(JSON.stringify(await provisionApiAuthorityTable(pool,{apply:argv.includes('--apply')})));}
 finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 main().catch(error=>{console.error(JSON.stringify({state:'held',code:error instanceof SchemaHeld?error.safeCode:'SCHEMA_UNAVAILABLE'}));process.exitCode=1;});
}
