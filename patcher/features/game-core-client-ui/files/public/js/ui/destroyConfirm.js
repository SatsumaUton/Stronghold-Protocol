// ui/destroyConfirm.js — 销毁道具的确认框（维护者 2026-11-08）。
//
// 提示框里多一个「下次不再提醒」勾选框：勾着点「销毁」就把设置 `confirmDestroy` 关掉，之后销毁不再弹框；
// 设置 →「销毁道具前确认」可以重新打开。两处销毁入口（棋盘下的 underframe / 详情面板的道具卡）共用这一份，
// 免得一处记住了、另一处还弹。
import { t } from '../../../shared/i18n.js';
import { confirmWithCheck } from './components.js';
import { settingsStore, updateSettings } from './settings.js';

/**
 * Ask before an item / Art is destroyed. `true` = go ahead (the dialog was answered yes, or the reminder is off).
 * @param {string} [name] the item's display name
 * @returns {Promise<boolean>}
 */
export async function confirmDestroy(name) {
  if (!settingsStore.get().confirmDestroy) return true;
  const r = await confirmWithCheck({
    title: t('销毁道具'),
    text: t('道具无法出售。确定要销毁「{name}」吗？', { name: name || t('道具') }),
    okText: t('销毁'),
    danger: true,
    checkLabel: t('下次不再提醒'),
  });
  if (r && r.ok && r.checked) updateSettings({ confirmDestroy: false });
  return !!(r && r.ok);
}
