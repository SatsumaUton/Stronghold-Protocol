// 搜寻中面板（2026-11-02）。
//
// 样式与标记**照搬我们自己的匹配器**：matchmaker/public/client.js 里的 `mm-ov` 覆盖层
// （品牌行 + 搜寻中.(Ns) + 难度/人数标签 + 像素侦察兵 SCANNING + 本难度等待队列 + 轮换提示 + 停止搜寻）。
// 那边是一层 fixed 全屏覆盖层，这里把它嵌到多人匹配整屏的右列里 —— 所以 lobby.css 末尾
// 用一段 `.mm-ov{position:static;...}` 把定位改回普通流，其余样式原样复用。
//
// 参考版（_ref）里那份 matchFlow.js 是另一套 mf-* 样式，两者视觉接近但不是同一个东西；
// 维护者要的是我们自己匹配器的那套，所以这个文件渲染的是 mm-ov 标记。
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { getConfig } from '../data.js';
import { t, N_ } from '../../../shared/i18n.js';

const FALLBACK_TIPS = [
  N_('联合模拟在选择策略时可以进行一次跳过'),
  N_('调度中心即使冻结，依然可以主动刷新'),
  N_('两件同名装备可以合成一件更强力的装备'),
  N_('只有达成完美作战的队友可以进行联防'),
];

/** 提示语列表：优先 config.json 的 tips，没有就用内置的几条。 */
export function tipList() {
  const cfg = getConfig();
  const list = Array.isArray(cfg?.tips)
    ? cfg.tips.map((x) => (typeof x === 'string' ? x : x?.tip)).filter((x) => typeof x === 'string' && x)
    : [];
  return list.length ? list : FALLBACK_TIPS.map((x) => t(x));
}

/** 秒数 → '12s' / '1:05'（与匹配器那边一致）。 */
export function searchClock(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  return n < 60 ? `${n}s` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

/** 品牌行：`[♜] STRONGHOLD PROTOCOL`。 */
export function BrandMark() {
  return html`<div class="mm-ov__brand"><span class="mm-ov__rook">[♜]</span>STRONGHOLD PROTOCOL</div>`;
}

/**
 * 搜寻中面板。
 * @param {{ elapsed?: number, tags?: Array<{ key: string, label: string, color?: string }>,
 *   waiting?: number|null, onStop?: (() => void)|null, class?: string }} props
 */
export function SearchPanel({ elapsed = 0, tags = [], waiting = null, onStop = null, class: cls = '' }) {
  const [tips] = useState(tipList);
  const [i, setI] = useState(() => Math.floor(Math.random() * Math.max(1, tips.length)));
  useEffect(() => { const id = setInterval(() => setI((x) => x + 1), 5000); return () => clearInterval(id); }, []);
  const dots = '.'.repeat((Math.floor(elapsed) % 3) + 1);
  return html`<div class=${`mm-ov ${cls}`} role="status" aria-live="polite" data-testid="match-queue">
    <div class="mm-ov__panel">
      <${BrandMark} />
      <div class="mm-ov__title">${t('搜寻中')}<span class="mm-ov__dots" aria-hidden="true">${dots}</span><small class="num" data-testid="match-queue-clock">(${searchClock(elapsed)})</small></div>
      <div class="mm-ov__tags" data-testid="match-queue-tags">
        ${tags.map((g) => html`<span key=${g.key} class="mm-ov__tag" style=${g.color ? `--c:${g.color}` : undefined}>${g.label}</span>`)}
      </div>
      <div class="mm-ov__scene">
        <svg class="mm-ov__scout" viewBox="0 0 240 90" aria-hidden="true" focusable="false">
          <path class="mm-ov__wave" d="M0 58 C30 40 50 76 80 58 S130 40 160 58 S210 76 240 58" />
          <g class="mm-ov__sky">
            <path d="M10 70h8v-14h6v14h10v-24h6v24h12v-10h6v10h20v-18h4v-6h4v24h18v-12h6v12h10v-20h6v20h14v-8h8v8" />
            <path d="M130 70h8v-14h6v14h10v-24h6v24h12v-10h6v10h20v-18h4v-6h4v24h18v-12h6v12h10v-20h6v20h14v-8h8v8" />
          </g>
          <g class="mm-ov__bot">
            <rect x="104" y="34" width="26" height="22" rx="3" />
            <rect class="mm-ov__eye" x="110" y="41" width="4" height="5" />
            <rect class="mm-ov__eye" x="120" y="41" width="4" height="5" />
            <rect x="114" y="26" width="6" height="8" />
            <rect x="112" y="22" width="10" height="4" />
            <rect class="mm-ov__leg" x="108" y="56" width="5" height="7" />
            <rect class="mm-ov__leg mm-ov__leg--b" x="121" y="56" width="5" height="7" />
          </g>
          <line class="mm-ov__ground" x1="60" y1="70" x2="180" y2="70" />
          <text x="120" y="84" text-anchor="middle">SCANNING · · ·</text>
        </svg>
      </div>
      <div class="mm-ov__pop" data-testid="match-queue-wait">${t('本难度等待队列')} <b>${Number(waiting) || 0}</b> ${t('人')}</div>
      <p key=${i} class="mm-ov__tip">${tips.length ? tips[i % tips.length] : ''}</p>
      ${onStop ? html`<button type="button" class="mm-ov__stop" data-testid="match-cancel" onClick=${onStop}><${Icon} name="close" />${t('停止搜寻')}</button>` : null}
    </div>
  </div>`;
}
