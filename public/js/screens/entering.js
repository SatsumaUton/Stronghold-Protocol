// 「正在进入同盟…」——已认下房间码、正在加入时的整屏等待态。
//
// 为什么需要它：从「公开同盟」列表点「加入同盟」时，本节点要发一次 room.join，
// 跨节点则要 `?n=<节点>` 换页（页面落到那台节点后由 `?room=` 深链自动加入）。
// 这两种情况中间都有一小段「既不在列表、也还没进房」的时间。
// 以前这段时间显示的是**大厅** —— 玩家看到的是「列表 → 大厅 → 房间」，像是被弹回去一次。
// 现在它显示这个等待态，进房是一步到位。
//
// 失败时不用在这里处理：main.js 的 schedulePendingJoin 会把 pendingJoin 清掉，
// 路由随即回到大厅，并照常弹错误提示（房间满了 / 房间不存在等）。
//
// 深潜房不是同盟（维护者 2026-11-08）：从「公开深潜」列表跳过来时，lobby.js 的 enterRoom 会留一个
// 会话标记 `sp.joinDive`，这里据此说「正在进入深潜…」。标记只在这个页面读一次就删 —— 之后普通进房
// 不会再被它带偏。
import { html, Spinner } from '../ui/components.js';
import { useStore, selectRoute } from '../store.js';
import { t } from '../../../shared/i18n.js';

/** 这一跳是去深潜房吗（读一次就删；跨节点换页时 sessionStorage 跟着走）。 */
export function takeJoinDive() {
  try {
    const on = sessionStorage.getItem('sp.joinDive') === '1';
    sessionStorage.removeItem('sp.joinDive');
    return on;
  } catch { return false; }
}

export function EnteringRoomScreen() {
  // 路由在 `entering` 上时 pendingJoin 一定有值；这里读它只是为了把房间码念给玩家听。
  const code = useStore((s) => (selectRoute(s) === 'entering' ? s.ui?.pendingJoin : null));
  const dive = useStore((s) => s.ui?.pendingJoinDive === true);
  return html`<div class="screen gload entering-room" data-testid="entering-room">
    <${Spinner} size="lg" label=${dive ? 'ENTERING DEEP DIVE' : 'ENTERING ALLIANCE'} />
    <p class="t-lo">${code
      ? (dive ? t('正在进入深潜 {code}…', { code }) : t('正在进入同盟 {code}…', { code }))
      : (dive ? t('正在进入深潜…') : t('正在进入同盟…'))}</p>
  </div>`;
}
