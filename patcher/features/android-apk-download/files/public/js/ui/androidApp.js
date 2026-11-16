// public/js/ui/androidApp.js — 安卓 APP（本服自己的 WebView 壳）的下载入口与首次提示（维护者 2026-11-16）。
//
// 三件事：
//   1. 认出「安卓浏览器」和「已经在 APP 里」——APP 的 UA 末尾带 `StrongholdProtocolApp/<ver>`
//      （android/java/.../MainActivity.java 的 uaWithTag），所以壳里不会再劝你装壳。
//   2. 给一个确定的下载地址：`/download/stronghold-android.apk`（部署时把新包覆盖到这个路径）。
//      `?v=<versionName>` 来自 `/download/android-version.json`，用于让浏览器别拿旧缓存；
//      读不到那份小文件就退回不带参数的地址（照样能下）。
//   3. `AndroidAppPrompt`：安卓浏览器**首次**打开时弹一次「要不要装 APP」，选「以后再说」记在
//      localStorage（`sp.android.appAsk`），不再骚扰；已经在 APP 里 / 非安卓 一律不弹。

import { useEffect, useState } from '../../vendor/hooks.module.v2.js';
import { html, Modal, Button } from './components.js';
import { t } from '../../../shared/i18n.js';

/** 部署时用新包覆盖这个路径（public/download/stronghold-android.apk）。 */
export const APK_PATH = '/download/stronghold-android.apk';
/** 版本小文件：{ name: '1.1', code: 5 }（build.ps1 之后由部署脚本写出来）。 */
export const APK_VERSION_PATH = '/download/android-version.json';
/** 问过一次就记住的键（值为 '1'）。 */
export const ASKED_KEY = 'sp.android.appAsk';
/** APP 的 UA 标记（MainActivity.uaWithTag）。 */
export const APP_UA_TAG = 'StrongholdProtocolApp/';

export function isAndroid(win = globalThis) {
  const ua = String(win?.navigator?.userAgent || '');
  return /Android/i.test(ua);
}

/** 已经在 APP 的 WebView 里（不用再劝装）。 */
export function inApp(win = globalThis) {
  const ua = String(win?.navigator?.userAgent || '');
  return ua.includes(APP_UA_TAG);
}

/** 该不该给出「下载安卓版」入口：安卓浏览器，且不在 APP 里。 */
export function shouldOfferApp(win = globalThis) {
  return isAndroid(win) && !inApp(win);
}

/** 下载地址（带版本参数时能绕开旧缓存）。 */
export function apkUrl(version = '') {
  return version ? `${APK_PATH}?v=${encodeURIComponent(version)}` : APK_PATH;
}

/** 读版本小文件（失败 → ''，下载地址不带参数）。 */
export async function fetchApkVersion(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(APK_VERSION_PATH, { cache: 'no-store' });
    if (!res || !res.ok) return '';
    const json = await res.json();
    return typeof json?.name === 'string' ? json.name : '';
  } catch { return ''; }
}

function storage(win = globalThis) {
  try { return win?.localStorage || null; } catch { return null; }
}

/** 这一次该不该弹窗：安卓浏览器 + 没在 APP 里 + 没问过。 */
export function shouldAsk(win = globalThis) {
  if (!shouldOfferApp(win)) return false;
  const s = storage(win);
  try { return s?.getItem(ASKED_KEY) !== '1'; } catch { return true; }
}

export function markAsked(win = globalThis) {
  const s = storage(win);
  try { s?.setItem(ASKED_KEY, '1'); } catch { /* 隐私模式：每次都会问，可接受 */ }
}

/** 触发下载（真机上就是浏览器下载 APK）。 */
export function downloadApk(win = globalThis, version = '') {
  markAsked(win);
  const url = apkUrl(version);
  try {
    const a = win?.document?.createElement?.('a');
    if (a) { a.href = url; a.rel = 'noopener'; a.download = ''; win.document.body.appendChild(a); a.click(); a.remove(); return url; }
    if (win?.location) win.location.href = url;
  } catch { /* 交给调用方的兜底链接 */ }
  return url;
}

/**
 * 首次进入时的安装提示（安卓浏览器一次）。确认 = 开始下载并记住；取消 = 记住，不再弹。
 * `force` 用来在设置里手动打开（不记「以后再说」）。
 */
export function AndroidAppPrompt({ force = false, onClose = null } = {}) {
  const [open, setOpen] = useState(() => (force ? true : shouldAsk()));
  const [version, setVersion] = useState('');
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    fetchApkVersion().then((v) => { if (alive && v) setVersion(v); });
    return () => { alive = false; };
  }, [open]);
  if (!open) return null;
  const close = () => { markAsked(); setOpen(false); onClose?.(); };
  return html`<${Modal} open=${true} tone="mint" class="android-app" onClose=${close}
      title=${t('安装萝卜喵服 APP')} micro="ROBOMIAO ANDROID">
    <div class="android-app__body">
      <p>${t('检测到你用的是安卓设备。装上「萝卜喵服 · 卫戍协议」APP，可以全屏、免浏览器地址栏，功能和网页版完全一样，还能在游戏里直接更新，不用重装。')}</p>
      ${version ? html`<p class="android-app__ver">${t('当前版本：{v}', { v: version })}</p>` : null}
    </div>
    <div class="android-app__actions">
      <${Button} variant="primary" onClick=${() => { downloadApk(globalThis, version); markAsked(); setOpen(false); onClose?.(); }}>${t('下载并安装')}<//>
      <${Button} variant="secondary" onClick=${close}>${t('以后再说')}<//>
    </div>
  <//>`;
}

/** 一个纯链接版本（放进菜单/设置里，不再弹窗）。 */
export function AndroidAppLink({ class: cls = '', label = null, version = '' } = {}) {
  if (!shouldOfferApp()) return null;
  return html`<a class=${cls} href=${apkUrl(version)} download rel="noopener"
      onClick=${() => markAsked()}>${label || t('下载安卓版')}</a>`;
}
