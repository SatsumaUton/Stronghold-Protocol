// 手动指定卡池编组（移植自参考版反馈 #49）：房主自己排「谁跟谁共用一个卡池」。
//
// ★ 2026-11-02 改版（5–20 人）：参考版把整个编辑器塞在「实验性选项」弹窗里，卡片网格用
//   minmax(2.9rem, …) / minmax(2.4rem, …)。实测（tools/_measure-pool-editor.cjs，1920×1080）：
//   内容区只有 464px，两个下限都放不下两列，于是卡片和座位**全部单列**，20 人时编辑器高 1053px，
//   而弹窗 max-height 只有 100dvh-8px —— 必然溢出滚动，违背「不要出现滑动条」。
//   所以改成两层：
//     · 实验性选项弹窗里只留一行摘要（PoolSummary）：卡池数 + 各池人数，点「编辑」开独立弹窗；
//     · 独立弹窗（PoolEditorDialog）宽 min(8.2rem, 96vw) ≈ 820px，三列卡片、每卡两列座位，
//       20 人约 200px 高，不需要滚动。顶部还有快捷预设（自动 / 2–5 池），20 人不用一个个拖。
//
// 编组本身在 shared/poolPlan.js：每个座位一个卡池号，规范形式按首次出现从 0 编号。
// 一个池之所以存在，就是因为有座位在它里面 —— 所以没有空池要存。

import { useLayoutEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, Modal } from './components.js';
import {
  autoPoolPlan, evenPoolPlan, mergeLastPool, moveSeat, poolCount, planLabel, poolScale, poolSeats, splitPool,
} from '../../../shared/poolPlan.js';
import { t } from '../../../shared/i18n.js';

/** 一个池的规模，按房间现在的读数：已坐的座位，没坐人时按它分到的座位数。 */
export function poolStock(seatIds, seats) {
  const taken = seatIds.filter((seat) => seats[seat]).length;
  return { taken, scale: poolScale(taken || seatIds.length) };
}

/** 快捷预设：把 `capacity` 个座位均分成 `pools` 个池（20 人想排 5×4 就点「5 池」）。 */
const PRESETS = [2, 3, 4, 5];

function SeatStrip({ index, seat, hostId, myId, picked, editable, onPress, onDrag, onDragEnd }) {
  const mine = !!seat && seat.playerId === myId;
  const press = () => { if (editable) onPress(index); };
  const name = seat ? seat.name || t('博士') : t('空席');
  const cls = `pooled__seat${seat ? '' : ' is-empty'}${mine ? ' is-me' : ''}${picked ? ' is-picked' : ''}${editable ? ' is-editable' : ''}`;
  // a div: Firefox never starts a drag on a <button>, and the older browsers we keep are Firefox
  return html`<div class=${cls} data-testid=${`pool-seat-${index}`} role="button" tabindex=${editable ? 0 : -1} aria-pressed=${picked ? 'true' : 'false'}
      aria-disabled=${editable ? undefined : 'true'} aria-label=${t('P{n} {name}', { n: index + 1, name })} draggable=${editable}
      onClick=${(e) => { e.stopPropagation(); press(); }} onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); press(); } }}
      onDragStart=${(e) => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; onDrag(index); }} onDragEnd=${onDragEnd}>
    <span class="pooled__no num">P${index + 1}</span>
    <span class="pooled__name">${name}</span>
    ${seat?.isBot ? html`<${Icon} name="robot" class="pooled__mark" />` : null}
    ${seat && seat.playerId === hostId ? html`<${Icon} name="crown" class="pooled__mark" />` : null}
    ${mine ? html`<em class="pooled__me">${t('你')}</em>` : null}
  </div>`;
}

/**
 * 实验性选项弹窗里的那一行摘要：`卡池编组  4+4（2 个池）  [编辑…]`。
 * 房间还没排编组时显示「自动」，右边给的是自动规则会怎么分（`auto`，按已坐席位算好传进来）。
 * @param {{ plan: number[] | null, capacity: number, auto: number[], editable: boolean, busy: boolean, onEdit: () => void }} props
 */
export function PoolSummary({ plan, capacity, auto, editable, busy, onEdit }) {
  const effective = Array.isArray(plan) && plan.length === capacity ? plan : auto;
  const automatic = !Array.isArray(plan);
  return html`<div class="poolsum" data-testid="pool-summary">
    <span class="poolsum__k">${t('卡池编组')}</span>
    <span class="poolsum__v" data-testid="pool-summary-label">
      <b>${planLabel(effective)}</b>
      <em>${automatic ? t('自动') : t('共 {n} 个卡池', { n: poolCount(effective) })}</em>
    </span>
    ${editable ? html`<${Button} size="sm" data-testid="pool-edit-open" disabled=${!!busy} onClick=${onEdit}>${t('编辑…')}<//>` : null}
  </div>`;
}

/**
 * 独立的大弹窗：排座位分组。
 *
 * 交互（鼠标 / 触屏 / 键盘都一样）：点一个座位选中，再点目标卡池（卡片、它的「移到此处」、
 * 或它里面的任一座位）把它移过去；再点自己一次或按 Esc 放开。桌面端也可以直接拖。
 *
 * @param {{ open: boolean, plan: number[], seats: any[], hostId: any, myId: any, busy: boolean,
 *   onClose: () => void, onPlan: (plan: number[]) => void }} props
 */
export function PoolEditorDialog({ open, plan, seats, hostId, myId, busy, onClose, onPlan }) {
  const [picked, setPicked] = useState(null);
  const [dragged, setDragged] = useState(null);
  const can = !busy;
  // 关掉弹窗时放开选中的座位，免得下次打开还「粘」着一个
  useLayoutEffect(() => {
    if (!open) { setPicked(null); setDragged(null); return undefined; }
    const onKey = (e) => { if (e.key === 'Escape' && picked != null) { e.stopPropagation(); setPicked(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, picked]);

  const groups = poolSeats(plan);
  const pools = groups.length, capacity = plan.length;
  const moving = dragged ?? picked;
  const send = (next) => { setPicked(null); setDragged(null); if (can) onPlan(next); };
  const place = (seat, pool) => { if (seat != null && groups[pool] && !groups[pool].includes(seat)) send(moveSeat(plan, seat, pool)); };
  const press = (seat, pool) => {
    if (picked === seat) setPicked(null);
    else if (picked != null && !groups[pool].includes(picked)) place(picked, pool);
    else setPicked(seat);
  };

  return html`<${Modal} open=${open} title=${t('手动指定卡池编组')} width="min(8.2rem, 96vw)" class="poolmodal"
      onClose=${onClose}
      actions=${html`<${Button} variant="primary" size="sm" onClick=${onClose}>${t('完成')}<//>`}>
    <section class="pooled" data-testid="pool-editor" data-pools=${pools} data-capacity=${capacity}>
      <div class="pooled__bar">
        <span class="pooled__total">${t('共 {n} 个卡池', { n: pools })}</span>
        <div class="pooled__step">
          <${Button} size="sm" square=${true} icon="minus" data-testid="pool-fewer" disabled=${!can || pools <= 1} onClick=${() => send(mergeLastPool(plan))} title=${t('减少卡池')} aria-label=${t('减少卡池')} />
          <${Button} size="sm" square=${true} icon="plus" data-testid="pool-more" disabled=${!can || pools >= capacity} onClick=${() => send(splitPool(plan))} title=${t('增加卡池')} aria-label=${t('增加卡池')} />
        </div>
        <${Button} size="sm" data-testid="pool-even" disabled=${!can} onClick=${() => send(evenPoolPlan(capacity, pools))}>${t('均分')}<//>
        <${Button} size="sm" data-testid="pool-auto" disabled=${!can} onClick=${() => send(autoPoolPlan(capacity))}>${t('恢复自动')}<//>
      </div>
      ${capacity > 4 ? html`<div class="pooled__presets">
        <span class="pooled__presets-k">${t('快捷')}</span>
        ${PRESETS.filter((n) => n <= capacity).map((n) => html`<${Button} key=${n} size="sm"
          class=${`pooled__preset${pools === n ? ' is-active' : ''}`} data-testid=${`pool-preset-${n}`} disabled=${!can}
          aria-pressed=${pools === n ? 'true' : 'false'}
          onClick=${() => send(evenPoolPlan(capacity, n))}>${t('{n} 池', { n })}<//>`)}
        <${Button} size="sm" class=${`pooled__preset${pools === capacity ? ' is-active' : ''}`}
          data-testid="pool-preset-solo" disabled=${!can} aria-pressed=${pools === capacity ? 'true' : 'false'}
          onClick=${() => send(evenPoolPlan(capacity, capacity))}>${t('每人独立')}<//>
      </div>` : null}
      <div class="pooled__grid">
        ${groups.map((seatIds, pool) => {
          const { taken, scale } = poolStock(seatIds, seats);
          const target = can && moving != null && !seatIds.includes(moving);
          const mine = seatIds.some((seat) => seats[seat] && seats[seat].playerId === myId);
          return html`<article key=${pool} class=${`pooled__card${target ? ' is-target' : ''}${mine ? ' is-mine' : ''}${seatIds.length > 4 ? ' is-wide' : ''}`}
              data-testid=${`pool-card-${pool}`} aria-label=${t('卡池 {n}，{count} 席', { n: pool + 1, count: seatIds.length })}
              onClick=${() => { if (target && dragged == null) place(picked, pool); }}
              onDragOver=${(e) => { if (target) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
              onDrop=${(e) => { e.preventDefault(); place(dragged, pool); }}>
            <header class="pooled__head">
              <b>${t('卡池 {n}', { n: pool + 1 })}</b>
              <span>${t('{n} 人', { n: taken })} · ${scale === 1 ? t('完整牌库') : t('牌库 ×{n}', { n: scale })}</span>
              ${target ? html`<button type="button" class="pooled__here" data-testid=${`pool-here-${pool}`} onClick=${(e) => { e.stopPropagation(); place(moving, pool); }}>${t('移到此处')}</button>` : null}
            </header>
            <div class="pooled__seats">
              ${seatIds.map((index) => html`<${SeatStrip} key=${index} index=${index} seat=${seats[index]} hostId=${hostId} myId=${myId} picked=${picked === index}
                editable=${can} onPress=${(seat) => press(seat, pool)} onDrag=${setDragged} onDragEnd=${() => setDragged(null)} />`)}
            </div>
          </article>`;
        })}
      </div>
      <p class="pooled__foot">${t('点一个座位，再点目标卡池即可移动；桌面端也可以直接拖。改动会随「应用」一起生效。')}</p>
    </section>
  <//>`;
}
