// test/helpers/unitModKeys.js \u2014 \u5355\u4f4d mods \u5b57\u6bb5\u767d\u540d\u5355\u7684**\u552f\u4e00\u6765\u6e90**\u3002
//
// \u4ee5\u524d\u4e24\u4efd\u540d\u5355\u5206\u6563\u5728\u4e24\u4e2a\u6d4b\u8bd5\u91cc\uff08\u8bcd\u6761\u4e00\u4efd\u3001\u795d\u798f\u4e00\u4efd\uff09\uff0c\u53e3\u5f84\u4e0d\u4e00\u81f4\u3002
// \u8fd9\u91cc\u5408\u5e76\uff0c\u5e76\u6807\u6ce8\u6bcf\u4e2a\u952e\u5728\u54ea\u6761\u8def\u5f84\u4e0a\u88ab\u8bfb\u53d6\uff1a
//   ENEMY_*\uff1a\u654c\u4eba\u8def\u5f84\uff08server/sim/content/generic.js \u7684\u654c\u4eba\u5c5e\u6027\u6620\u5c04\uff09
//   OPERATOR_*\uff1a\u5e72\u5458\u8def\u5f84\uff08buff \u805a\u5408\u4e0e units \u9762\u677f\u8ba1\u7b97\uff09
// \u4e24\u8005\u6709\u4ea4\u96c6\uff0c\u4e5f\u5404\u6709\u72ec\u6709\u952e\uff08\u5982 batPct \u53ea\u5728\u5e72\u5458\u8def\u5f84\uff09\u3002

/** \u654c\u4eba\u8def\u5f84\u4f1a\u8bfb\u7684 mods \u952e\uff08\u4e0e echoWords.test.js \u539f\u6765\u90a3\u4efd\u9010\u5b57\u4e00\u81f4\uff09\u3002 */
export const ENEMY_MOD_KEYS = new Set([
  'atkFlat', 'atkPct', 'atkMul', 'atkFinal', 'defFlat', 'defPct', 'defMul',
  'hpFlat', 'hpPct', 'hpMul', 'resFlat', 'resMul', 'moveFlat', 'moveMul',
  'aspd', 'blockCnt', 'rangeExtend', 'taunt', 'costMul',
]);

/** \u5e72\u5458\u8def\u5f84\u4f1a\u8bfb\u7684 mods \u952e\uff08\u795d\u798f\u7528\uff09\u3002 */
export const OPERATOR_MOD_KEYS = new Set([
  'atkMul', 'hpMul', 'defFlat', 'resFlat', 'resMul', 'batPct',
  'dmgDealtMul', 'dmgTakenMul', 'hpRegen', 'spRecoveryFlat',
  'blockCnt', 'defIgnoreFlat', 'resIgnoreFlat', 'rangeExtend', 'maxTargets',
  'shield', 'taunt',
]);

/** \u4e24\u6761\u8def\u5f84\u90fd\u4e0d\u8ba4\u7684\u952e\uff08\u5199\u4e0a\u53bb\u4e5f\u662f\u7a7a\u8f6c\uff09\u3002 */
export function unknownModKeys(keys, scope = 'both') {
  const list = keys || [];
  return list.filter((k) => {
    const inEnemy = ENEMY_MOD_KEYS.has(k);
    const inOp = OPERATOR_MOD_KEYS.has(k);
    if (scope === 'enemy') return !inEnemy;
    if (scope === 'operator') return !inOp;
    return !inEnemy && !inOp;
  });
}
