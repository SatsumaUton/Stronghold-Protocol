// server/match/match/echoConfig.js — 「深渊回响」的房间级调参（维护者 2026-11-03 定）。
//
// 为什么需要这一层：深潜大厅里要能现场调参数，但**参数一旦可调，「深度」就不再可比** ——
// 深度 20 在「保守曲线」和「激进曲线」下完全是两回事。所以定下两条硬规则：
//
//   1. 调参**只给管理员**（身份门 `session.adminId`，与建房门禁同一口径）；
//   2. **调过参的房间不进排行榜**（`ranked` 自动为 false）。榜只收「标准配置」的成绩。
//
// 默认值就是现在的行为，所以不传配置的房间与加这一层之前完全一样。

/** 深潜的默认配置（= 现行行为）。 */
export const ECHO_CONFIG_DEFAULTS = Object.freeze({
  curve: 'aggressive',      // 延伸曲线档位
  eliteEvery: 3,            // 每几层出一次精英
  eliteMax: 3,              // 精英最多几只
  wordCap: 8,               // 词条上限
  blessingEvery: 5,         // 每几层一次祝福三选一
  bounty: true,             // 是否发深潜悬赏
  depthCap: 999,            // 安全阀（999 = 无尽）
});

/** 三档延伸曲线（血 / 攻 每层增速）。名字在界面上显示为 保守 / 标准 / 激进。 */
export const ECHO_CURVES = Object.freeze({
  gentle: Object.freeze({ hp: 1.08, atk: 1.03 }),
  standard: Object.freeze({ hp: 1.12, atk: 1.05 }),
  aggressive: Object.freeze({ hp: 1.15, atk: 1.08 }),
});

export const ECHO_CURVE_IDS = Object.freeze(Object.keys(ECHO_CURVES));

const intIn = (v, lo, hi, dflt) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
};

/**
 * 规范化一个房间传来的深潜配置。
 *
 * @param {object|null|undefined} raw 客户端传来的配置（可能缺字段、可能是垃圾）
 * @returns {{ cfg: typeof ECHO_CONFIG_DEFAULTS, changed: boolean, errors: string[] }}
 *   `changed` = 是否与默认值不同（不同则这个房间不进榜）
 */
export function normalizeEchoConfig(raw) {
  const errors = [];
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) errors.push('echo: not an object');
  const cfg = {
    curve: ECHO_CURVES[src.curve] ? String(src.curve) : ECHO_CONFIG_DEFAULTS.curve,
    eliteEvery: intIn(src.eliteEvery, 1, 10, ECHO_CONFIG_DEFAULTS.eliteEvery),
    eliteMax: intIn(src.eliteMax, 1, 5, ECHO_CONFIG_DEFAULTS.eliteMax),
    wordCap: intIn(src.wordCap, 1, 8, ECHO_CONFIG_DEFAULTS.wordCap),
    blessingEvery: intIn(src.blessingEvery, 1, 10, ECHO_CONFIG_DEFAULTS.blessingEvery),
    bounty: src.bounty === undefined ? ECHO_CONFIG_DEFAULTS.bounty : src.bounty === true,
    depthCap: intIn(src.depthCap, 30, 999, ECHO_CONFIG_DEFAULTS.depthCap),
  };
  if (src.curve !== undefined && !ECHO_CURVES[src.curve]) errors.push(`echo.curve: ${String(src.curve)}`);
  const changed = Object.keys(ECHO_CONFIG_DEFAULTS).some((k) => cfg[k] !== ECHO_CONFIG_DEFAULTS[k]);
  return { cfg: Object.freeze(cfg), changed, errors };
}

/** 这套配置能不能进排行榜（只有默认配置能进）。 */
export const echoConfigRanked = (cfg) => !cfg
  || Object.keys(ECHO_CONFIG_DEFAULTS).every((k) => cfg[k] === ECHO_CONFIG_DEFAULTS[k]);

/** 曲线档位 → `{ hp, atk }` 每层增速（未知档位退回默认）。 */
export const echoCurveOf = (cfg) => ECHO_CURVES[cfg && cfg.curve] || ECHO_CURVES[ECHO_CONFIG_DEFAULTS.curve];
