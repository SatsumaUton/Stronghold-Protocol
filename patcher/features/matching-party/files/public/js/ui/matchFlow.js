// 搜寻中面板（移植自参考版 public/js/ui/matchFlow.js 的 SearchPanel 一族，2026-11-02）。
//
// 为什么单独一个文件：大厅「多人匹配」排队时，维护者要求**直接用同盟模拟里
// 「匹配队友」那套界面** —— 品牌行 + 搜寻中。(Ns) + 难度标签 + 像素侦察兵 + 轮换提示 + 停止搜寻。
// 这里的图形（像素小人、地平线、扫描线）都是参考版的画法，样式在 css/screens/lobby.css 的 mf-*。
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

/** The loading tips (config.json `tips`, else a few built-in ones). */
export function tipList() {
  const cfg = getConfig();
  const list = Array.isArray(cfg?.tips) ? cfg.tips.map((x) => (typeof x === 'string' ? x : x?.tip)).filter((x) => typeof x === 'string' && x) : [];
  return list.length ? list : FALLBACK_TIPS.map((x) => t(x));
}

/** Seconds → '12s' / '1:05'. */
export function searchClock(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  return n < 60 ? `${n}s` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

/** The rook in brackets used as the brand mark. */
export function BrandMark({ class: cls = '' }) {
  return html`<span class=${`mf-brand ${cls}`}><span class="mf-brand__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span>STRONGHOLD PROTOCOL</span>`;
}

/** A little pixel scout (an original square bot) running over a scrolling skyline. */
export function PixelScout({ happy = false }) {
  return html`<svg class=${`mf-scout${happy ? ' is-happy' : ''}`} viewBox="0 0 240 90" aria-hidden="true" focusable="false">
    <path class="mf-scout__wave" d="M0 58 C30 40 50 76 80 58 S130 40 160 58 S210 76 240 58" />
    <g class="mf-scout__sky">
      <path d="M10 70h8v-14h6v14h10v-24h6v24h12v-10h6v10h20v-18h4v-6h4v24h18v-12h6v12h10v-20h6v20h14v-8h8v8" />
      <path d="M130 70h8v-14h6v14h10v-24h6v24h12v-10h6v10h20v-18h4v-6h4v24h18v-12h6v12h10v-20h6v20h14v-8h8v8" />
    </g>
    <g class="mf-scout__bot">
      <rect x="104" y="34" width="26" height="22" rx="3" />
      <rect class="mf-scout__eye" x="110" y="41" width="4" height="5" />
      <rect class="mf-scout__eye mf-scout__eye--r" x="120" y="41" width="4" height="5" />
      <rect x="114" y="26" width="6" height="8" />
      <rect x="112" y="22" width="10" height="4" />
      <rect class="mf-scout__leg mf-scout__leg--a" x="108" y="56" width="5" height="7" />
      <rect class="mf-scout__leg mf-scout__leg--b" x="121" y="56" width="5" height="7" />
    </g>
    <line class="mf-scout__ground" x1="60" y1="70" x2="180" y2="70" />
    <text x="120" y="84" text-anchor="middle">${happy ? 'CONNECTED' : 'SCANNING · · ·'}</text>
  </svg>`;
}

/**
 * 搜寻中面板。
 * @param {{ elapsed?: number, tags?: Array<{ key: string, label: string, color?: string, icon?: any }>,
 *   onStop?: (() => void)|null, stopping?: boolean, note?: string|null, class?: string }} props
 */
export function SearchPanel({ elapsed = 0, tags = [], onStop = null, stopping = false, note = null, class: cls = '' }) {
  const [tips] = useState(tipList);
  const [i, setI] = useState(() => Math.floor(Math.random() * Math.max(1, tips.length)));
  useEffect(() => { const id = setInterval(() => setI((x) => x + 1), 5000); return () => clearInterval(id); }, []);
  const dots = '.'.repeat((Math.floor(elapsed) % 3) + 1);
  return html`<aside class=${`mf-search ${cls}`} role="status" aria-live="polite" data-testid="match-queue">
    <${BrandMark} />
    <h3 class="mf-search__title">${t('搜寻中')}<span class="mf-search__dots" aria-hidden="true">${dots}</span><small class="num" data-testid="match-queue-clock">(${searchClock(elapsed)})</small></h3>
    ${tags.length ? html`<div class="mf-search__tags">${tags.map((g) => html`<span key=${g.key} class="mf-tag" style=${g.color ? `--tag:${g.color}` : undefined}>${g.icon || null}${g.label}</span>`)}</div>` : null}
    <div class="mf-search__scene"><i class="mf-cross mf-cross--tl"></i><i class="mf-cross mf-cross--tr"></i><${PixelScout} /><i class="mf-cross mf-cross--bl"></i><i class="mf-cross mf-cross--br"></i></div>
    <p key=${i} class="mf-search__tip">${tips.length ? tips[i % tips.length] : ''}</p>
    ${note ? html`<p class="mf-search__note" data-testid="match-queue-wait">${note}</p>` : null}
    ${onStop ? html`<button type="button" class="mf-stop" data-testid="match-cancel" onClick=${onStop} disabled=${stopping}><span class="mf-stop__x"><${Icon} name="close" /></span>${t('停止搜寻')}</button>` : null}
  </aside>`;
}
