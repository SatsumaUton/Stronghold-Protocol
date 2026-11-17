// test/ui/android-app.test.js — 安卓 APP 下载入口与首次提示（本服独有，维护者 2026-11-16）。
//
// 要求：
//   1. APP 名字里带「萝卜喵服」；
//   2. 安卓浏览器上把「添加到桌面」换成「下载安卓版」（APK 直链），壳里（UA 带 StrongholdProtocolApp/）不再显示；
//   3. 首次检测到安卓用户弹一次窗，问过（或点了以后再说）就不再弹。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const {
  APK_PATH, ASKED_KEY, isAndroid, inApp, shouldOfferApp, apkUrl, shouldAsk, markAsked, fetchApkVersion,
} = await import('../../public/js/ui/androidApp.js');

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  androidApp: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 StrongholdProtocolApp/1.1',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

/** 一个最小的 win 假身子：只给模块用到的 navigator / localStorage。 */
function fakeWin(ua, stored = null) {
  const map = new Map(stored ? [[ASKED_KEY, stored]] : []);
  return {
    navigator: { userAgent: ua },
    localStorage: { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) },
  };
}

test('APK 名字里带「萝卜喵服」', () => {
  const strings = read('android/res/values/strings.xml');
  assert.match(strings, /<string name="app_name">[^<]*萝卜喵服[^<]*<\/string>/, 'APP 名称要含「萝卜喵服」');
  // 装出来的包也在这个路径下（部署时覆盖），且版本小文件与之一致
  assert.ok(existsSync(path.join(ROOT, 'public/download/stronghold-android.apk')), 'APK 要放在 public/download/stronghold-android.apk');
  const v = JSON.parse(read('public/download/android-version.json'));
  assert.equal(typeof v.name, 'string');
  assert.ok(Number.isInteger(v.code));
});

test('设备判定：安卓浏览器给入口，APP 壳里 / 其他平台不给', () => {
  assert.equal(isAndroid(fakeWin(UA.android)), true);
  assert.equal(inApp(fakeWin(UA.android)), false);
  assert.equal(shouldOfferApp(fakeWin(UA.android)), true);
  assert.equal(shouldOfferApp(fakeWin(UA.androidApp)), false, 'APP 里不再劝装 APP');
  assert.equal(shouldOfferApp(fakeWin(UA.iphone)), false);
  assert.equal(shouldOfferApp(fakeWin(UA.desktop)), false);
});

test('下载地址带版本参数时能绕开旧缓存', () => {
  assert.equal(apkUrl(), APK_PATH);
  assert.equal(apkUrl('1.1'), `${APK_PATH}?v=1.1`);
  assert.equal(APK_PATH, '/download/stronghold-android.apk');
});

test('首次提示只问一次：点「以后再说」/下载后都不再弹', () => {
  const w = fakeWin(UA.android);
  assert.equal(shouldAsk(w), true, '第一次要弹');
  markAsked(w);
  assert.equal(shouldAsk(w), false, '记住之后不再弹');
  // 老浏览器（没有 localStorage）也不能抛错
  const bare = { navigator: { userAgent: UA.android } };
  assert.equal(shouldAsk(bare), true);
  markAsked(bare);
});

test('版本小文件读不到时安静退回（不带 ?v=）', async () => {
  assert.equal(await fetchApkVersion(async () => ({ ok: false })), '');
  assert.equal(await fetchApkVersion(async () => ({ ok: true, json: async () => ({ name: '1.1' }) })), '1.1');
  assert.equal(await fetchApkVersion(async () => { throw new Error('offline'); }), '');
});

test('按钮真的换掉了：安卓分支渲染下载链接，PWA 分支保留', () => {
  const dev = read('public/js/ui/device.js');
  assert.match(dev, /shouldOfferApp\(\)/, '★ PwaInstallButton 要判安卓');
  assert.match(dev, /data-testid="apk-install"/, '★ 安卓分支是 APK 直链');
  assert.match(dev, /data-testid="pwa-install"/, 'PWA 分支保留');
  const lobby = read('public/js/screens/lobby.js');
  assert.match(lobby, /<\$\{AndroidAppPrompt\}/, '★ 大厅挂上首次提示');
  // ★ 2026-11-17 安卓真机反馈：玩家第一眼是「登录 / 注册」闸门，而闸门开着时大厅被
  //   html.sp-gate-open .app-root { visibility: hidden } 整个藏起来 —— 只挂在大厅等于永远问不到。
  const gate = read('public/js/screens/authGate.js');
  assert.match(gate, /<\$\{AndroidAppPrompt\}/, '★ 登录闸门也要挂首次提示');
});

test('软键盘弹起时登录页左下角按钮组收起（不再位移）', () => {
  const dev = read('public/js/ui/device.js');
  // 判定：visualViewport 比布局视口矮一大截 → html.sp-kb
  assert.match(dev, /root\.classList\.toggle\('sp-kb'/, 'device.js 要打 sp-kb');
  assert.match(dev, /visualViewport/, '要靠 visualViewport 判定键盘');
  const css = read('public/css/screens/authGate.css');
  assert.match(css, /html\.sp-kb \.sp-lg-actions \{ display: none; \}/, '★ 键盘弹起时那组按钮要收起');
});
