// 新建的 SpineActor 在第一次 draw 之前就要摆好真正的 idle 姿势。
//
// 移植自参考版 test/render/spine-first-pose.test.js。为什么要有这条：
// 准备阶段（PREP）的资源是异步加载的，模型可能在第一次 tick 之前就被画出来或被测量尺寸。
// 那时如果没有主动 update(0)，骨架会停在 Spine 的默认姿势上（Default / Start），
// 玩家看到的就是「开局时干员是跪地的」那一类问题（参考版 feedback5 就是宴的这个报告）。
//
// 还有第二个坑：pose 完要把 track 的 nextTrackLast 设成 -1，让「pose 之后才设的 clip」
// 被当作从没播过 —— 否则第一次切动作会从这个假姿势混过去，出现一段糊掉的过渡。
//
// 本服数据布局和参考版不同：皮肤挂在本体下面（chars.<id>.skins.<skinId>），
// 参考版是顶层平铺的 skins 表，所以这里按本服的结构取。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakePixi } from './fakepixi.js';
import { SpineActor } from '../../public/js/render/spine.js';

const manifest = JSON.parse(readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));

/** 本服的皮肤：chars.<charId>.skins.<skinId>.spine.<side> */
const skinSpine = (charId, skinId, side) => manifest.chars[charId].skins[skinId].spine[side];
const clipCount = (entry) => Object.keys(entry?.animations || {}).length;

// 本服 532 个皮肤里，234 个两侧都有动画、265 个只有 back、29 个都没有。
// 一个侧面没有动画表时，SpineActor 的 names 就是空的，_play 会直接放弃 —— 那种侧面本来
// 也不做骨架渲染，所以只测真有动画的侧面。
const SKINS = [
  ['char_332_archet', 'char_332_archet_sale_14'],  // 参考版用的那个（本服只有 back 有动画）
  ['char_003_kalts', 'char_003_kalts_2'],          // 两侧都有
];

test('新加载的皮肤在第一帧就摆好真 idle，不播 Default / Start', () => {
  const fake = installFakePixi();
  const Original = globalThis.PIXI.spine.Spine;
  const calls = [];
  globalThis.PIXI.spine.Spine = class extends Original {
    update(dt) { calls.push({ dt, track: this.state.tracks[0]?.animation.name, time: this.state.tracks[0]?.trackTime }); this.posed = true; }
  };
  try {
    let checked = 0;
    for (const [charId, skinId] of SKINS) {
      for (const side of ['front', 'back']) {
        const entry = skinSpine(charId, skinId, side);
        if (clipCount(entry) === 0) continue;
        calls.length = 0;
        const a = new SpineActor({ animations: Object.keys(entry.animations).map((name) => ({ name })) }, entry);
        const where = `${charId}/${skinId} ${side}`;
        assert.deepEqual(calls, [{ dt: 0, track: 'Idle', time: 0 }], `${where}: 第一帧就该是 idle，且时钟不动`);
        assert.equal(a.spine.posed, true, where);
        assert.equal(a.spine.autoUpdate, false, where);
        assert.equal(a.mode, 'base'); assert.equal(a.current, 'Idle'); assert.equal(a.clock, 0);
        assert.equal(a.skillOn, false); assert.equal(a.dead, false);
        a.destroy();
        checked++;
      }
    }
    assert.ok(checked >= 2, `至少要覆盖到 2 个侧面（实际 ${checked}）`);
  } finally { fake.restore(); }
});

test('立刻摆姿势时保留骨架自己选的休息动作（不是硬写 Idle）', () => {
  const fake = installFakePixi();
  const Original = globalThis.PIXI.spine.Spine;
  const calls = [];
  globalThis.PIXI.spine.Spine = class extends Original {
    update(dt) { calls.push([dt, this.state.tracks[0]?.animation.name]); }
  };
  try {
    const a = new SpineActor({ animations: [{ name: 'Rest' }, { name: 'Idle' }] }, { anims: { idle: 'Rest' }, animations: { Rest: 2 } });
    assert.deepEqual(calls, [[0, 'Rest']], '用的是 anims.idle 指定的那个动作');
    assert.equal(a.clock, 0); assert.equal(a.current, 'Rest'); a.destroy();
  } finally { fake.restore(); }
});

test('pose 完把 nextTrackLast 归 -1：之后设的 clip 不从这个假姿势混过去', () => {
  const fake = installFakePixi();
  try {
    const a = new SpineActor({ animations: [{ name: 'Idle' }, { name: 'Attack' }] }, { anims: { idle: 'Idle' }, animations: { Idle: 1, Attack: 1 } });
    const track = a.spine.state.tracks[0];
    assert.equal(track.nextTrackLast, -1, '第一帧之后 track 要标成「没播过」');
    a.destroy();
  } finally { fake.restore(); }
});
