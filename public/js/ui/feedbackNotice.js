// 大厅横幅：你自己的反馈有新回复时提醒你（维护者 2026-11-16）。
//
// 数据来自 matchmaker/feedback.cjs 新增的两个接口：
//   GET  /mm/api/feedback/my-replies        → { count, items: [{ id, title, reply, replyAt }] }
//   POST /mm/api/feedback/my-replies-seen   → 标记已读（同源 Cookie 鉴权）
// 邮件通道由后端在管理员保存回复时发出；这里只负责「打开网页后在大厅界面有提示」。
//
// 只在已登录时请求：游客没有 account_id，后端会直接回 { count: 0 }，但少一个请求更好。
import { useEffect, useState } from '../vendor/hooks.module.v2.js';
import { html, Icon } from './components.js';
import { t } from '../../../shared/i18n.js';

const API = '/mm/api/feedback';
const DISMISS_KEY = 'sp.fbNotice.dismissed';

/** 同一个会话里被玩家点掉过的回复时间戳，避免每次刷新都弹。 */
function dismissedAt() {
  try {
    return Number(sessionStorage.getItem(DISMISS_KEY) || 0) || 0;
  } catch {
    return 0;
  }
}

function rememberDismissed(ts) {
  try {
    sessionStorage.setItem(DISMISS_KEY, String(ts || 0));
  } catch { /* 隐私模式 */ }
}

/** 这一版网页是谁在登录（authSession.js 写进 localStorage 的标记）。 */
function loggedIn() {
  try {
    return !!localStorage.getItem('__SP_ACCOUNT_TOKEN');
  } catch {
    return false;
  }
}

export function FeedbackNotice() {
  const [info, setInfo] = useState(null);   // { count, items } | null
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loggedIn()) return undefined;
    let alive = true;
    fetch(`${API}/my-replies`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d || !(d.count > 0)) return;
        const newest = Math.max(...d.items.map((x) => x.replyAt || 0));
        if (newest <= dismissedAt()) return;      // 这一批已经点掉过了
        setInfo(d);
      })
      .catch(() => { /* 提示失败不影响大厅 */ });
    return () => { alive = false; };
  }, []);

  if (!info || !(info.count > 0)) return null;

  const markSeen = () => {
    const newest = Math.max(...info.items.map((x) => x.replyAt || 0));
    rememberDismissed(newest);
    setBusy(true);
    fetch(`${API}/my-replies-seen`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => { /* 标记失败下次还会提示，不算错 */ }).finally(() => setBusy(false));
    setInfo(null);
  };

  const openBoard = () => {
    try {
      window.open('/mm/feedback.html', '_blank', 'noopener');
    } catch { /* 弹窗被拦就只标记已读 */ }
    markSeen();
  };

  const first = info.items[0];

  return html`<div class="fb-notice" role="status" aria-live="polite">
    <span class="fb-notice__icon"><${Icon} name="info" /></span>
    <div class="fb-notice__text">
      <b>${t('你的反馈有 {n} 条新回复', { n: info.count })}</b>
      ${first ? html`<span class="fb-notice__title">#${first.id} ${first.title}</span>` : null}
    </div>
    <button type="button" class="fb-notice__go" disabled=${busy} onClick=${openBoard}>${t('查看')}</button>
    <button type="button" class="fb-notice__close" disabled=${busy} title=${t('知道了')}
      aria-label=${t('知道了')} onClick=${markSeen}><${Icon} name="close" /></button>
  </div>`;
}

