// Original synthetic fixtures only; no game install, network or UnityPy is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fxFixture } from './helpers/fxFixtures.js';
import { skel } from './helpers/pluginFixtures.js';

function py(code) {
  const source = `import sys,json\nsys.path.insert(0, ${JSON.stringify(path.resolve('tools/local-extract'))})\nimport operators as op, extract as ex\n${code}`;
  const r = spawnSync('python3', ['-B', '-c', source], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('operator plan names only exact base/E2 sprites and default battle Front/Back groups', () => {
  const [job] = py(`print(json.dumps(op.plan(['char_9001_test', '../char_9002_bad', 'char_x_custom', 'char_9001_test'])))`);
  assert.equal(job.bundle, 'chararts/char_9001_test.ab');
  assert.equal(job.prefab, '/char_9001_test/defaultskin.prefab');
  assert.deepEqual(job.pictures.avatar, { bundles: 'spritepack/ui_char_avatar_*.ab', names: { avatar: 'char_9001_test', avatarE2: 'char_9001_test_2' } });
  assert.deepEqual(job.pictures.portrait, { bundles: 'spritepack/char_portrait_*.ab', names: { portrait: 'char_9001_test_1', portraitE2: 'char_9001_test_2' } });
  assert.deepEqual(job.spines, { front: 'spine/char/char_9001_test/front', back: 'spine/char/char_9001_test/back' });
  const selected = py(`print(json.dumps([ex.wants_sub([], op.SUB), ex.wants_sub(['fx'], op.SUB), ex.spine_ids(['plugin-art/char_9001_test'], op.SUB, ['char_9001_test','char_9002_test'])]))`);
  assert.deepEqual(selected, [true, false, ['char_9001_test']]);
});

test('partial manifest merge preserves other operators, old pictures, and unextracted battle directions', () => {
  const got = py(`old={'char_9001_test': {'avatar':'old', 'portrait':'keep', 'spine': {'front': {'skel':'old'}, 'back': {'skel':'keep'}}}, 'char_9002_test': {'avatar':'keep'}}
new={'char_9001_test': {'avatar':'new', 'spine': {'front': {'skel':'new'}}}}
print(json.dumps({'merged':op.merge_chars(old,new),'old':old,'groups':ex.merge_manifest({'other':{'a':1},'char/avatar/char_9002_test':{'b':2}},{'char/avatar/char_9001_test':{'c':3}}, {'char/avatar/char_9001_test'})}))`);
  assert.equal(got.merged.char_9001_test.avatar, 'new');
  assert.equal(got.merged.char_9001_test.portrait, 'keep');
  assert.equal(got.merged.char_9001_test.spine.back.skel, 'keep');
  assert.equal(got.merged.char_9002_test.avatar, 'keep');
  assert.equal(got.old.char_9001_test.avatar, 'old');
  assert.equal(Object.keys(got.groups).length, 3);
});

test('exporter writes only requested sprites and passes both complete model groups through the existing exporter', t => {
  const f = fxFixture(t);
  const got = py(`from pathlib import Path
from types import SimpleNamespace as NS
root=Path(${JSON.stringify(f.root)})
for rel in ['spritepack/ui_char_avatar_0.ab','spritepack/char_portrait_0.ab','chararts/char_9001_test.ab']:
 p=root/rel; p.parent.mkdir(parents=True,exist_ok=True); p.touch()
class Image:
 width=4; height=8
 def save(self,p): Path(p).write_bytes(b'original synthetic image')
class Obj:
 def __init__(self,name,kind='Sprite',pid=0): self.name=name; self.type=NS(name=kind); self.path_id=pid
 def read(self): return NS(m_Name=self.name,image=Image())
 def read_typetree(self): return {'synthetic':self.name}
def load(p):
 if 'chararts/' in p: return NS(objects=[Obj('front','MonoBehaviour',1),Obj('back','MonoBehaviour',2)],container={'dyn/char_9001_test/defaultskin.prefab':Obj('prefab')})
 suffix='' if 'avatar' in p else '_1'
 return NS(objects=[Obj('char_9001_test'+suffix),Obj('char_9001_test_2'),Obj('char_9001_test_skin#1'),Obj('char_9002_other')])
sys.modules['UnityPy']=NS(load=load); sys.modules['aklz4']=NS()
ex.prefab_spine_nodes=lambda *a: [('Front',True,{'m_PathID':1}),('Back',True,{'m_PathID':2}),('Build',True,{'m_PathID':3})]
calls=[]
def write(objects,sda,sub,name,out,groups,log):
 calls.append(sub); d=Path(out)/sub; d.mkdir(parents=True,exist_ok=True)
 groups[sub]={}
 for file in ['unit.skel','unit.atlas','page.png','page2.png']:
  (d/file).write_bytes(b'synthetic'); groups[sub][file]={'path':'/assets/local/'+sub+'/'+file}
 return 4
ex.write_spine=write
op.subprocess.check_output=lambda *a,**k: b'{"anims":{"idle":"Idle"}}'
groups={}; chars,n=op.export(root,root/'out',groups,lambda *a:None,['char_9001_test'])
print(json.dumps({'chars':chars,'count':n,'calls':calls,'files':sorted(str(p.relative_to(root/'out')) for p in (root/'out').rglob('*') if p.is_file())}))`);
  assert.equal(got.count, 12);
  assert.equal(got.files.length, 12);
  assert.equal(got.calls.length, 2);
  const art = got.chars.char_9001_test;
  assert.ok(art.avatarE2 && art.portraitE2);
  for (const face of ['front', 'back']) {
    assert.equal(art.spine[face].textures.length, 2);
    assert.equal(art.spine[face].anims.idle, 'Idle');
  }
  assert.ok(got.files.every(p => !p.includes('skin') && !p.includes('other')));
});

test('Spine metadata bridge parses original synthetic skeletons with existing animation roles', t => {
  const f = fxFixture(t);
  f.put('unit.skel', skel({ animations: { Idle: [], Attack: [['OnAttack', 0.5]] } }));
  const r = spawnSync(process.execPath, ['tools/local-extract/plugin-art.mjs', '--spine', path.join(f.root, 'unit.skel')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const meta = JSON.parse(r.stdout);
  assert.equal(meta.pma, true);
  assert.equal(meta.anims.idle, 'Idle');
  assert.equal(meta.anims.attack.loop, 'Attack');
});
