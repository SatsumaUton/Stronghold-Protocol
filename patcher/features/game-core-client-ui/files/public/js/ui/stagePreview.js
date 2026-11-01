// 选策略阶段的战场小地图（移植自参考版 ui/stagePreview.js，#65）：
// 用的是关卡自己的 tile（data/stages.json），所以每个官方版本的每张战场都能画出来，
// 不需要下载任何美术资源。行号像棋盘一样自下而上：敌人的门（红）和保护点（蓝）
// 就画在对局里它们实际所在的位置。
// 样式在 css/screens/draft.css（.stagemap）。

import { html } from './components.js';
import { fallbackTileClass } from './fallbackField.js';

/** 战场的取景范围：GEO.FIELD 的行，从保护点所在列到最后一列门。 */
const RECT = Object.freeze({ r0: 9, r1: 12, c0: 2, c1: 12 });

/**
 * 单个格子的外观：'gate' / 'goal' / 'void' / 'high'（远程高台）或 fallback 棋盘上的特殊地面，
 * 其余按 groundPassable 分成 'road'（敌人能走）和 'fence'（低地，走不了）。
 * @param {any} stage @param {number} r @param {number} c
 */
export function miniTile(stage, r, c) {
  const cls = fallbackTileClass(stage, r, c);
  if (cls !== 'floor' && cls !== 'lane') return cls;
  return stage.tiles?.[stage.rows[r][c]]?.groundPassable === false ? 'fence' : 'road';
}

/**
 * 要画的格子（void 不画），x / y 是从左上角算起的格数。
 * @param {any} stage data/stages.json 里的一条记录
 * @returns {{ w: number, h: number, tiles: Array<{ x: number, y: number, kind: string }> } | null} 没有 tile 数据时返回 null
 */
export function stagePreview(stage) {
  if (!Array.isArray(stage?.rows) || !stage.rows[RECT.r1]) return null;
  const tiles = [];
  for (let r = RECT.r0; r <= RECT.r1; r++) {
    for (let c = RECT.c0; c <= RECT.c1; c++) {
      const kind = miniTile(stage, r, c);
      if (kind !== 'void') tiles.push({ x: c - RECT.c0, y: RECT.r1 - r, kind });
    }
  }
  return { w: RECT.c1 - RECT.c0 + 1, h: RECT.r1 - RECT.r0 + 1, tiles };
}

/**
 * @param {{ stage: any, class?: string }} props 没有 tile 数据时不渲染
 */
export function StageMiniMap({ stage, class: cls }) {
  const map = stagePreview(stage);
  if (!map) return null;
  return html`<svg class=${cls ? `stagemap ${cls}` : 'stagemap'} viewBox=${`0 0 ${map.w} ${map.h}`} aria-hidden="true" data-testid="stage-minimap">
    ${map.tiles.map((t) => html`<rect key=${`${t.x},${t.y}`} class=${`stagemap__t stagemap__t--${t.kind}`} x=${t.x + 0.04} y=${t.y + 0.04} width="0.92" height="0.92" />`)}
  </svg>`;
}
