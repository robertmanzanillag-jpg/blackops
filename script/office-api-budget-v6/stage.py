#!/usr/bin/env python3
"""Source-only, exact-context backport. No DB, environment or provider access."""
import argparse, hashlib, json, os, stat, sys
from pathlib import Path

NEW = {'server/software-factory-api-budget.ts','server/factory-api-context.ts','server/factory-api-invocation.ts','server/factory-api-sdk.ts'}
EXISTING = {'script/software-factory-pilot-exports.ts','server/clippers-local-news-translation.ts','server/gemini-client.ts','server/office-execution.ts','server/office-shared-credits.ts','server/openai-client.ts','server/software-factory-object-store.ts','server/software-factory-openai-transport.ts','server/software-factory-responses-runtime.ts','server/software-factory-routes.ts','server/software-factory-store.ts','server/software-factory-worker.ts'}
GUARDS = {'server/assistant.ts','server/ai-router.ts','server/software-factory-store-provider.ts','server/office-protocol.ts','.replit','server/ai-model-router.ts'}
LIMIT = 4 * 1024 * 1024
class Held(Exception): pass

def require(ok, code):
    if not ok: raise Held(code)
def sha(body): return hashlib.sha256(body).hexdigest()
def lexists(path):
    try: path.lstat(); return True
    except FileNotFoundError: return False

def read_regular(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= LIMIT,'STAGE_FILE_IDENTITY_INVALID')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(fd)
        require((info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns,info.st_mode,info.st_uid)==(opened.st_dev,opened.st_ino,opened.st_size,opened.st_mtime_ns,opened.st_ctime_ns,opened.st_mode,opened.st_uid),'STAGE_FILE_CHANGED')
        with os.fdopen(fd,'rb',closefd=False) as source: body=source.read(LIMIT+1)
        require(len(body)<=LIMIT,'STAGE_FILE_TOO_LARGE')
        after=os.fstat(fd); named=path.lstat()
        signature=lambda x:(x.st_dev,x.st_ino,x.st_size,x.st_mtime_ns,x.st_ctime_ns,x.st_mode,x.st_uid,x.st_nlink)
        require(signature(info)==signature(after)==signature(named),'STAGE_FILE_CHANGED')
        return body, stat.S_IMODE(info.st_mode)
    finally: os.close(fd)

def location(root,name):
    require(name in NEW|EXISTING|GUARDS,'STAGE_PATH_NOT_ALLOWED')
    path=root/name
    require(path.parent.resolve(strict=True)==path.parent,'STAGE_PARENT_NOT_CANONICAL')
    return path

def verify_guards(root,guards):
    require(set(guards)==GUARDS,'STAGE_GUARDS_INVALID')
    for name,expected in guards.items():
        path=location(root,name)
        if expected is None: require(not lexists(path),'STAGE_ABSENT_GUARD_CHANGED')
        else: require(sha(read_regular(path)[0])==expected,'STAGE_PROTECTED_SOURCE_CHANGED')

def plan(root,package,manifest):
    verify_guards(root,manifest['guards'])
    operations=manifest['operations']
    require(len(operations)==16 and {x['path'] for x in operations}==NEW|EXISTING,'STAGE_OPERATIONS_INVALID')
    require([x['path'] for x in operations[:4]]==manifest['newModuleOrder'] and set(manifest['newModuleOrder'])==NEW,'STAGE_DEPENDENCY_ORDER_INVALID')
    result=[]; states=[]
    for item in operations:
        name=item['path']; path=location(root,name)
        require(not lexists(path.with_name(path.name+'.api-budget-stage-tmp')),'STAGE_TEMP_COLLISION')
        if name in NEW:
            require(item['kind']=='create' and item['beforeSha256'] is None,'STAGE_CREATE_INVALID')
            payload=package/item['payload']; require(payload.parent.resolve(strict=True)==payload.parent and package in payload.parents,'STAGE_PAYLOAD_SCOPE_INVALID')
            after=read_regular(payload)[0];before=None;mode=0o644
            if lexists(path): states.append('after' if sha(read_regular(path)[0])==item['afterSha256'] else 'drift')
            else: states.append('before')
        else:
            require(item['kind']=='patch' and isinstance(item['beforeSha256'],str),'STAGE_PATCH_INVALID')
            before,mode=read_regular(path); current=sha(before)
            states.append('after' if current==item['afterSha256'] else 'before' if current==item['beforeSha256'] else 'drift')
            if current==item['afterSha256']: after=before
            else:
                after=before.decode('utf-8')
                require(item['patches'] and len(item['patches'])<=100,'STAGE_PATCH_INVALID')
                for patch in item['patches']:
                    old,new=patch['before'],patch['after']
                    require(isinstance(old,str) and isinstance(new,str) and old and after.count(old)==1,'STAGE_EXACT_CONTEXT_MISMATCH')
                    after=after.replace(old,new,1)
                after=after.encode('utf-8')
        require(sha(after)==item['afterSha256'],'STAGE_POSTIMAGE_MISMATCH')
        result.append((item,path,before,after,mode))
    require('drift' not in states,'STAGE_PREIMAGE_CHANGED')
    require(len(set(states))==1,'STAGE_MIXED_OR_PARTIAL_STATE')
    return result,states[0]

def private_json(path,value):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as target: json.dump(value,target,indent=2);target.write('\n');target.flush();os.fsync(target.fileno())

def run(args):
    package=Path(__file__).resolve().parent
    manifest_body=read_regular(package/'manifest.json')[0]
    require(sha(manifest_body)==args.manifest_sha,'STAGE_MANIFEST_CHANGED')
    manifest=json.loads(manifest_body)
    require(manifest['version']==1 and manifest['kind']=='office_api_budget_actual_v6','STAGE_MANIFEST_INVALID')
    root=Path(args.root).resolve(strict=True);require(root.is_dir(),'STAGE_ROOT_INVALID')
    proposed,state=plan(root,package,manifest)
    if not args.apply or state=='after': return {'state':'already_applied' if state=='after' else 'dry_run_validated','changedFiles':0,'plannedFiles':16,'manifestSha256':args.manifest_sha,'databaseTouched':False,'pricingOrCheckpointWritten':False,'canonicalRouterInstalled':False}
    require(args.backup is not None,'STAGE_EXTERNAL_BACKUP_REQUIRED')
    raw=Path(args.backup);require(raw.is_absolute() and raw.name not in ('.','..'),'STAGE_BACKUP_INVALID')
    backup=raw.parent.resolve(strict=True)/raw.name
    require(backup!=root and root not in backup.parents and backup not in root.parents,'STAGE_BACKUP_INSIDE_SOURCE')
    require(not lexists(backup),'STAGE_BACKUP_EXISTS')
    lock=backup.parent/('.office-api-budget-stage-'+sha(str(root).encode())[:16]+'.lock')
    require(not lexists(lock),'STAGE_LOCK_EXISTS')
    fd=os.open(lock,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(fd)
    backup.mkdir(mode=0o700)
    receipt={'version':1,'manifestSha256':args.manifest_sha,'state':'prepared','changed':[],'databaseTouched':False,'pricingOrCheckpointWritten':False,'canonicalRouterInstalled':False}
    try:
        # Capture every original before the first source mutation. Configuration
        # and protected source guards are hashes only; never backed up here.
        for item,path,before,after,mode in proposed:
            if before is not None:
                target=backup/'before'/item['path'];target.parent.mkdir(parents=True,mode=0o700,exist_ok=True)
                fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                with os.fdopen(fd,'wb') as out:out.write(before);out.flush();os.fsync(out.fileno())
        private_json(backup/'prepared.json',receipt)
        for item,path,before,after,mode in proposed:
            verify_guards(root,manifest['guards'])
            if before is None: require(not lexists(path),'STAGE_SOURCE_CHANGED_DURING_APPLY')
            else: require(read_regular(path)[0]==before,'STAGE_SOURCE_CHANGED_DURING_APPLY')
            temporary=path.with_name(path.name+'.api-budget-stage-tmp')
            fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,mode);os.fchmod(fd,mode)
            with os.fdopen(fd,'wb') as out:out.write(after);out.flush();os.fsync(out.fileno())
            # Recheck after writing the temporary; new modules are published
            # atomically without clobbering a concurrent creator. Existing-file
            # promotion assumes the documented single operator staging window.
            verify_guards(root,manifest['guards'])
            if before is None:
                os.link(temporary,path,follow_symlinks=False)
                temporary.unlink()
            else:
                require(read_regular(path)[0]==before,'STAGE_SOURCE_CHANGED_DURING_APPLY')
                os.replace(temporary,path)
            require(sha(read_regular(path)[0])==item['afterSha256'],'STAGE_POST_WRITE_MISMATCH')
            receipt['changed'].append({'path':item['path'],'beforeSha256':item['beforeSha256'],'afterSha256':item['afterSha256']})
            private_json(backup/('progress-%02d.json'%len(receipt['changed'])),receipt)
        verify_guards(root,manifest['guards']);receipt['state']='applied_source_only';private_json(backup/'receipt.json',receipt);lock.unlink()
        return {'state':'applied_source_only','changedFiles':16,'backup':str(backup),'manifestSha256':args.manifest_sha,'databaseTouched':False,'pricingOrCheckpointWritten':False,'canonicalRouterInstalled':False}
    except Exception:
        receipt['state']='failed_partial_preserved'
        private_json(backup/'failed.json',receipt)
        raise

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);parser.add_argument('--manifest-sha',required=True);parser.add_argument('--backup');parser.add_argument('--apply',action='store_true')
    try: print(json.dumps(run(parser.parse_args()),sort_keys=True))
    except Exception as error:
        code=str(error) if isinstance(error,Held) else 'STAGE_UNAVAILABLE'
        print(json.dumps({'state':'held','code':code}),file=sys.stderr);sys.exit(1)
