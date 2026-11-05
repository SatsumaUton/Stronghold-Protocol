// ui/enemyRecords.js — 敌人记录的**统一查找**：本房数据表 + 服务端随快照带来的跨版本记录。
//
// 背景（维护者 2026-11-05 反馈）：有的敌对目标在「查看即将迎击的敌方单位」里查不到信息，
// 战斗中点击它也没有说明框。
//
// 原因不是渲染，是**数据**：深潜的波次会从各版本的模板库里抽怪（server/match/match/echoCrossVersion.js），
// 抽到第一期独有的敌人时 key 带 `act1autochess:` 前缀，而客户端加载的是本房版本的数据表
// （data/enemies.json 里没有那 6 条）。于是：
//   · 情报列表 groupEnemies 拿不到记录 → 名字退化成 key、图标没有；
//   · 点开敌人 resolveDetail 拿不到记录 → 直接返回 null，面板根本不出现。
//
// 服务端现在把本回合真正会出场的那些记录一起发下来（m.public.echo.crossEnemyDefs），
// 这里就是客户端唯一的合并点：**所有**「按 key 查敌人」的地方都走 enemyRecord()，不要各自 data.lookup。

import { data } from '../data.js';
import { store } from '../store.js';
import { t } from '../../../shared/i18n.js';

/** 「情报被遮蔽」的占位 key（服务端 _echoMaskBountyPreview 把悬赏目标/整片情报换成它）。 */
export const UNKNOWN_ENEMY_KEY = 'enemy_unknown';

/**
 * 占位记录：`enemy_unknown` 在数据里没有条目，情报列表原本会把它显示成字面量 "enemy_unknown"
 * （维护者 2026-11-05：被迷雾 / 遮蔽隐藏的怪在列表里是一串英文 key）。给它一个能看的名字。
 */
export function unknownEnemyRecord(key = UNKNOWN_ENEMY_KEY) {
  return {
    key: String(key),
    name: t('未知敌人'),
    rank: 'NORMAL',
    stats: {},
    acTypes: [],
    abilities: [],
    desc: t('情报被「迷雾 / 遮蔽」隐藏，开战时揭晓'),
    unknown: true,
  };
}

/**
 * 纯函数：本房数据表里没有时，用随快照带来的跨版本记录补上。
 *
 * @param {string} key 敌人 key（可能带 `<version>:` 前缀）
 * @param {object|null} direct data.lookup('enemies', key) 的结果
 * @param {Record<string, object>|null|undefined} cross 服务端发来的跨版本记录表
 * @returns {object|null}
 */
export function pickEnemyRecord(key, direct, cross) {
  if (direct && typeof direct === 'object') return direct;
  if (key == null) return null;
  const id = String(key);
  if (!id) return null;
  const rec = cross && typeof cross === 'object' ? cross[id] : null;
  return rec && typeof rec === 'object' ? rec : null;
}

/**
 * 敌人记录：先查本房数据表，再查服务端带来的跨版本记录。
 *
 * @param {string|null|undefined} key
 * @returns {object|null} 查不到返回 null（调用方各自决定怎么退化）
 */
export function enemyRecord(key) {
  if (key == null) return null;
  const id = String(key);
  if (!id) return null;
  const pub = store.getState?.()?.match?.public;
  const cross = pub && pub.echo ? pub.echo.crossEnemyDefs : null;
  const rec = pickEnemyRecord(id, data.lookup('enemies', id), cross);
  // 被「迷雾 / 遮蔽」藏起来的怪：给个占位记录，列表里才不会出现字面量 key
  if (!rec && id === UNKNOWN_ENEMY_KEY) return unknownEnemyRecord(id);
  return rec;
}
