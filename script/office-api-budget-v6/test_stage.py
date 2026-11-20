import hashlib,importlib.util,json,os,shutil,subprocess,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
sha=lambda b:hashlib.sha256(b).hexdigest()
class StageTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.top=Path(self.temp.name);self.root=self.top/'app';self.root.mkdir();self.package=self.top/'package';shutil.copytree(HERE,self.package,ignore=shutil.ignore_patterns('__pycache__'));self.manifest=json.loads((self.package/'manifest.json').read_text())
  for op in self.manifest['operations']:
   if op['kind']=='patch':
    dest=self.root/op['path'];dest.parent.mkdir(parents=True,exist_ok=True)
    # Portable source fixtures concatenate the actual reviewed patch contexts.
    # They never export the custom assistant/configuration or claim a real
    # full-file preimage. Production manifest digests remain unchanged on disk.
    before=('\n// fixture boundary\n'.join(p['before'] for p in op['patches'])).encode();after=before.decode()
    for fragment in op['patches']:
     assert after.count(fragment['before'])==1;after=after.replace(fragment['before'],fragment['after'],1)
    op['beforeSha256']=sha(before);op['afterSha256']=sha(after.encode());dest.write_bytes(before);dest.chmod(0o640)
  for name,expected in self.manifest['guards'].items():
   if expected is not None:
    dest=self.root/name;dest.parent.mkdir(parents=True,exist_ok=True)
    if name=='.replit':
     # Actual configuration was NOT exported. Positive fixtures use synthetic
     # nonsecret configuration and bind its distinct digest explicitly.
     dest.write_text('[env]\nPUBLIC_TEST="fixture"\n');self.manifest['guards'][name]=sha(dest.read_bytes())
    else:
     dest.write_text('// synthetic protected fixture: '+name+'\n');self.manifest['guards'][name]=sha(dest.read_bytes())
  self.save();self.before=self.snapshot();spec=importlib.util.spec_from_file_location('stage_fixture',self.package/'stage.py');self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
 def save(self):
  data=(json.dumps(self.manifest,indent=2)+'\n').encode();(self.package/'manifest.json').write_bytes(data);self.digest=sha(data)
 def snapshot(self):return {str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
 def run_stage(self,apply=False,backup=None):return self.module.run(SimpleNamespace(root=str(self.root),manifest_sha=self.digest,apply=apply,backup=str(backup or self.top/'backup')))
 def held(self,fn):
  before=self.snapshot()
  with self.assertRaises(Exception):fn()
  self.assertEqual(self.snapshot(),before)
 def test_public_postimages_and_fixed_legacy_adaptation(self):
  original=json.loads((HERE/'manifest.json').read_text())
  for op in original['operations']:
   if op['path']=='server/clippers-local-news-translation.ts':
    self.assertEqual(op['beforeSha256'],'70f91d52ae0f0480bcf112c66c21de782941c0831aefd90e1e4b00746e3678bf')
    self.assertEqual(op['afterSha256'],'0b014083d6ba580a9af5e884a8e7312bb7efb0dc39d4a7a99e97c20e9da6e79f')
    combined=''.join(x['after'] for x in op['patches']);self.assertNotIn('ai-model-router',combined);self.assertNotIn('DEEPSEEK',combined);self.assertIn('integrationKey?',combined);self.assertIn('guardFactoryOpenAiClient',combined)
   else:self.assertEqual(sha((REPO/op['path']).read_bytes()),op['afterSha256'],op['path'])
  self.assertIsNone(original['guards']['server/ai-model-router.ts'])
 def test_dry_no_writes(self):
  self.assertEqual(self.run_stage()['state'],'dry_run_validated');self.assertEqual(self.snapshot(),self.before);self.assertFalse((self.top/'backup').exists())
 def test_apply_readback_backup_and_idempotent(self):
  self.assertEqual(self.run_stage(True)['changedFiles'],16)
  for op in self.manifest['operations']:
   target=self.root/op['path'];self.assertEqual(sha(target.read_bytes()),op['afterSha256'])
   if op['kind']=='patch':self.assertEqual((self.top/'backup'/'before'/op['path']).read_bytes(),self.before[op['path']]);self.assertEqual(target.stat().st_mode&0o777,0o640)
  for name,digest in self.manifest['guards'].items():
   if digest is not None:self.assertEqual(sha((self.root/name).read_bytes()),digest)
  self.assertFalse((self.top/'backup'/'before'/'.replit').exists());self.assertEqual((self.top/'backup').stat().st_mode&0o777,0o700);self.assertEqual(self.run_stage(True)['state'],'already_applied')
 def test_config_drift(self):
  (self.root/'.replit').write_text('drift');self.held(lambda:self.run_stage(True))
 def test_absent_router_guard(self):
  (self.root/'server/ai-model-router.ts').write_text('ghost');self.held(lambda:self.run_stage(True))
 def test_source_drift(self):
  (self.root/'server/openai-client.ts').write_text('drift');self.held(lambda:self.run_stage(True))
 def test_partial_state(self):
  op=self.manifest['operations'][0];(self.root/op['path']).write_bytes((self.package/op['payload']).read_bytes());self.held(lambda:self.run_stage(True))
 def test_new_target_symlink(self):
  op=self.manifest['operations'][0];(self.root/op['path']).symlink_to(self.root/'server/openai-client.ts');self.held(lambda:self.run_stage(True))
 def test_backup_inside_root(self):self.held(lambda:self.run_stage(True,self.root/'backup'))
 def test_temp_collision(self):
  (self.root/'server/openai-client.ts.api-budget-stage-tmp').write_text('occupied');self.held(lambda:self.run_stage(True))
 def test_manifest_tamper(self):
  (self.package/'manifest.json').write_text('{}');self.held(lambda:self.run_stage(True))
 def test_operation_outside_allowlist(self):
  self.manifest['operations'][-1]['path']='server/assistant.ts';self.save();self.held(lambda:self.run_stage(True))
 def test_failure_retains_all_backups_progress_and_lock(self):
  original=self.module.os.link;calls=[]
  def fail_second(src,dst,**kwargs):
   calls.append(str(dst))
   if len(calls)==2:raise OSError('synthetic')
   return original(src,dst,**kwargs)
  with patch.object(self.module.os,'link',side_effect=fail_second):
   with self.assertRaises(OSError):self.run_stage(True)
  backup=self.top/'backup';self.assertEqual(json.loads((backup/'failed.json').read_text())['state'],'failed_partial_preserved');self.assertEqual(len(list((backup/'before').rglob('*.ts'))),12);self.assertEqual(len(list(self.top.glob('.office-api-budget-stage-*.lock'))),1);self.assertEqual(len(json.loads((backup/'failed.json').read_text())['changed']),1)
 def test_concurrent_create_never_clobbered(self):
  original=self.module.os.link;injected=[]
  def concurrent(src,dst,**kwargs):
   if not injected:Path(dst).write_text('EXTERNAL_CONCURRENT_CREATE');injected.append(dst)
   return original(src,dst,**kwargs)
  with patch.object(self.module.os,'link',side_effect=concurrent):
   with self.assertRaises(FileExistsError):self.run_stage(True)
  self.assertEqual(Path(injected[0]).read_text(),'EXTERNAL_CONCURRENT_CREATE');self.assertTrue((self.top/'backup'/'failed.json').exists())
 def test_changed_existing_after_temp_is_held(self):
  original=self.module.os.fsync;target=self.root/'server/software-factory-store.ts';injected=[]
  def concurrent(fd):
   original(fd)
   # Trigger only while the exact existing-file temporary is open, after
   # its initial preimage check and write but before promotion.
   tmp=target.with_name(target.name+'.api-budget-stage-tmp')
   if tmp.exists() and not injected:target.write_text('EXTERNAL_EDIT');injected.append(True)
  with patch.object(self.module.os,'fsync',side_effect=concurrent):
   with self.assertRaises(self.module.Held):self.run_stage(True)
  self.assertEqual(target.read_text(),'EXTERNAL_EDIT');self.assertTrue((self.top/'backup'/'failed.json').exists())
if __name__=='__main__':unittest.main()
