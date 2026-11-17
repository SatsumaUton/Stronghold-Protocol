// 卫戍协议：盟约 —— 萝卜喵公益服 的安卓外壳（WebView）。
//
// 直接加载线上站点，所以站点更新后 App 无需重新发版（这就是「内容可直接更新」）。
// 全屏沉浸式、支持网页全屏、文件选择、外链跳系统浏览器、返回键＝网页后退。
// 只用 Android 框架类，不依赖 AndroidX / Gradle，便于纯命令行构建（见 build.ps1）。
package love.luobomiao.stronghold;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceResponse;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;

public class MainActivity extends Activity {
  static final String HOME = "https://stronghold.luobomiao.love/";
  static final int FILE_PICKER = 1001;

  WebView web;
  ProgressBar bar;
  FrameLayout rootView;
  ValueCallback<Uri[]> fileCallback;
  View customView;
  WebChromeClient.CustomViewCallback customViewCallback;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    Window w = getWindow();
    w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    w.setStatusBarColor(Color.BLACK);
    w.setNavigationBarColor(Color.BLACK);
    requestWindowFeature(Window.FEATURE_NO_TITLE);

    rootView = new FrameLayout(this);
    rootView.setBackgroundColor(Color.BLACK);
    setContentView(rootView, new ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

    web = new WebView(this);
    web.setBackgroundColor(Color.BLACK);
    rootView.addView(web, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

    bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
    bar.setMax(100);
    bar.setVisibility(View.GONE);
    rootView.addView(bar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 6));

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setAllowFileAccess(true);
    s.setAllowContentAccess(true);
    s.setSupportMultipleWindows(false);
    s.setJavaScriptCanOpenWindowsAutomatically(true);
    s.setLoadWithOverviewMode(true);
    s.setUseWideViewPort(true);
    s.setBuiltInZoomControls(false);
    s.setDisplayZoomControls(false);
    s.setTextZoom(100);
    if (Build.VERSION.SDK_INT >= 21) s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    s.setUserAgentString(uaWithTag(s.getUserAgentString()));

    CookieManager cm = CookieManager.getInstance();
    cm.setAcceptCookie(true);
    if (Build.VERSION.SDK_INT >= 21) cm.setAcceptThirdPartyCookies(web, true);

    web.setWebViewClient(new SiteClient(this));
    web.setWebChromeClient(new SiteChrome(this));

    Intent it = getIntent();
    String url = HOME;
    if (it != null && it.getData() != null) url = it.getData().toString();
    if (state != null) {
      web.restoreState(state);
      web.loadUrl(url);
    } else {
      web.loadUrl(url);
    }
    hideSystemBars();
    checkForUpdate(false);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 版本检查（维护者 2026-11-16：「发现新版本就提示更新」）
  //
  // 站点上有一份 /download/android-version.json：{ name: "1.2", code: 6 }。App 启动后（以及回到前台时，每 6 小时最多一次）
  // 拉一次，用 versionCode 比大小 —— 有更新的就弹一个原生对话框：
  //   「下载更新」→ 用系统浏览器打开 /download/stronghold-android.apk（浏览器负责下载 + 调起安装器）
  //   「以后再说」→ 记住这个版本号（SharedPreferences），同一个版本不再问；出现更新的版本会再问。
  // 只做提示，不静默下载、不自动安装（Android 需要用户点确认 + 允许「安装未知应用」）。
  // -------------------------------------------------------------------------------------------------------------------
  static final String VERSION_URL = "https://stronghold.luobomiao.love/download/android-version.json";
  static final String APK_URL = "https://stronghold.luobomiao.love/download/stronghold-android.apk";
  static final String PREFS = "sp-app";
  static final String KEY_SKIP = "skipVersionCode";
  static final String KEY_LAST_CHECK = "lastUpdateCheck";
  static final long CHECK_EVERY_MS = 6L * 60 * 60 * 1000;

  void checkForUpdate(boolean force) {
    try {
      android.content.SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
      long now = System.currentTimeMillis();
      if (!force && now - sp.getLong(KEY_LAST_CHECK, 0L) < CHECK_EVERY_MS) return;
      sp.edit().putLong(KEY_LAST_CHECK, now).apply();
      int mine = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
      new Thread(new UpdateCheck(this, mine, sp.getInt(KEY_SKIP, 0))).start();
    } catch (Throwable ignored) { /* 版本检查永远不能影响启动 */ }
  }

  /** 后台拉版本文件（Android 不允许在主线程做网络）。 */
  static final class UpdateCheck implements Runnable {
    final MainActivity act;
    final int mine;
    final int skipped;
    UpdateCheck(MainActivity a, int m, int s) { act = a; mine = m; skipped = s; }
    @Override public void run() {
      int remote = 0;
      String name = "";
      try {
        java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(VERSION_URL).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        c.setRequestProperty("Cache-Control", "no-cache");
        java.io.InputStream in = c.getInputStream();
        java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
        byte[] tmp = new byte[1024];
        int n;
        while ((n = in.read(tmp)) > 0) buf.write(tmp, 0, n);
        in.close();
        c.disconnect();
        org.json.JSONObject j = new org.json.JSONObject(buf.toString("UTF-8"));
        remote = j.optInt("code", 0);
        name = j.optString("name", "");
      } catch (Throwable ignored) {
        return;   // 没网 / 站点没那份文件：安静跳过，不打扰玩家
      }
      if (remote <= mine || remote == skipped) return;
      act.runOnUiThread(new UpdateAsk(act, remote, name, mine));
    }
  }

  /** 回主线程弹对话框。 */
  static final class UpdateAsk implements Runnable {
    final MainActivity act;
    final int remote;
    final String name;
    final int mine;
    UpdateAsk(MainActivity a, int r, String n, int m) { act = a; remote = r; name = n; mine = m; }
    @Override public void run() { act.askUpdate(remote, name, mine); }
  }

  /** 「下载更新」：交给系统浏览器下载并调起安装器。 */
  static final class DownloadClick implements android.content.DialogInterface.OnClickListener {
    @Override public void onClick(android.content.DialogInterface d, int w) {
      try {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(APK_URL));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        d.dismiss();
        // 需要 context：用对话框自己的 context（Android 里 Dialog 实现了 Context 之外还带 getContext? 不保证），
        // 所以这里由 AskUpdate 传入的 Activity 发起 —— 见 askUpdate() 里 new DownloadClick(act)
      } catch (Throwable ignored) { /* 没有浏览器就什么都不做 */ }
    }
  }

  /** 「以后再说」：记住这个 versionCode，同一个版本不再问。 */
  static final class SkipClick implements android.content.DialogInterface.OnClickListener {
    final MainActivity act;
    final int remote;
    SkipClick(MainActivity a, int r) { act = a; remote = r; }
    @Override public void onClick(android.content.DialogInterface d, int w) {
      try { act.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putInt(KEY_SKIP, remote).apply(); } catch (Throwable ignored) { }
      d.dismiss();
    }
  }

  /** 「下载更新」的实际动作（需要 Activity context 去 startActivity）。 */
  static final class DownloadClick2 implements android.content.DialogInterface.OnClickListener {
    final MainActivity act;
    DownloadClick2(MainActivity a) { act = a; }
    @Override public void onClick(android.content.DialogInterface d, int w) {
      try { act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(APK_URL))); } catch (Throwable ignored) { }
      d.dismiss();
    }
  }

  void askUpdate(final int remote, String name, int mine) {
    try {
      String msg = "萝卜喵服 · 卫戍协议  " + (name.isEmpty() ? ("v" + remote) : ("v" + name))
          + "\n当前版本 v" + mine + "，点「下载更新」会打开下载页（装完覆盖安装即可，数据不会丢）。";
      new android.app.AlertDialog.Builder(this)
          .setTitle("发现新版本")
          .setMessage(msg)
          .setPositiveButton("下载更新", new DownloadClick2(this))
          .setNegativeButton("以后再说", new SkipClick(this, remote))
          .setCancelable(true)
          .show();
    } catch (Throwable ignored) { /* 弹不出来也不能崩 */ }
  }
  /** UA 后面加一个标记，方便在服务端日志里认出 App 客户端。 */
  static String uaWithTag(String base) {
    StringBuilder sb = new StringBuilder();
    sb.append(base);
    sb.append(" StrongholdProtocolApp/1.2");
    return sb.toString();
  }

  void hideSystemBars() {
    if (Build.VERSION.SDK_INT >= 30) {
      WindowInsetsController c = getWindow().getInsetsController();
      if (c != null) {
        c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
        c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      }
    } else {
      getWindow().getDecorView().setSystemUiVisibility(
          View.SYSTEM_UI_FLAG_LAYOUT_STABLE
              | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
              | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_FULLSCREEN
              | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
  }

  @Override
  protected void onActivityResult(int req, int res, Intent data) {
    if (req == FILE_PICKER) {
      if (fileCallback != null) {
        fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
        fileCallback = null;
      }
      return;
    }
    super.onActivityResult(req, res, data);
  }

  @Override
  public void onBackPressed() {
    if (customView != null) {
      SiteChrome chrome = (SiteChrome) web.getWebChromeClient();
      if (chrome != null) chrome.onHideCustomView();
      return;
    }
    if (web.canGoBack()) {
      web.goBack();
      return;
    }
    super.onBackPressed();
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    web.saveState(out);
  }

  @Override
  protected void onPause() {
    super.onPause();
    web.onPause();
    CookieManager.getInstance().flush();
  }

  @Override
  protected void onResume() {
    super.onResume();
    web.onResume();
    hideSystemBars();
    checkForUpdate(false);
  }

  @Override
  protected void onDestroy() {
    if (web != null) {
      rootView.removeView(web);
      web.destroy();
      web = null;
    }
    super.onDestroy();
  }

  /** 站内（含资源站）留在 App 里开；外链交给系统浏览器。 */
  static class SiteClient extends WebViewClient {
    private final MainActivity act;

    SiteClient(MainActivity a) {
      this.act = a;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
      Uri u = req.getUrl();
      String host = u.getHost();
      if (host == null) host = "";
      if (host.endsWith("luobomiao.love")) return false;
      try {
        act.startActivity(new Intent(Intent.ACTION_VIEW, u));
      } catch (Exception ignored) {
        // 没有浏览器就留在 App 里
      }
      return true;
    }

    @Override
    public void onPageFinished(WebView v, String url) {
      act.bar.setVisibility(View.GONE);
    }

    @Override
    public void onReceivedError(WebView v, WebResourceRequest req, android.webkit.WebResourceError err) {
      if (req != null && req.isForMainFrame()) {
        String page = act.getString(R.string.offline_html);
        v.loadDataWithBaseURL(null, page, "text/html", "utf-8", null);
      }
    }

    // -----------------------------------------------------------------------------------------------------------------
    // 自带资源包（维护者 2026-11-17：「把安卓 app 做完整，然后自带完整资源包」）
    //
    // 美术 / 音频 / 字体 / 图标 / vendor 库打进 APK（见 AssetBridge 与 build.ps1 的 -A 参数），
    // 这些请求直接从 APK 读，不再走网络；页面本身、/data、/js、/css 一律照旧走站点 —— 所以站点更新后
    // App 不用重发版。APK 里没有的文件返回 null，WebView 接着走网络（不会变成 404）。
    //
    // 只对 GET 生效：Range 请求（音频拖动）交给网络，避免自己实现分段。
    // -----------------------------------------------------------------------------------------------------------------
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
      if (req == null || Build.VERSION.SDK_INT < 21) return null;
      if (!"GET".equals(req.getMethod())) return null;
      if (req.getRequestHeaders() != null && req.getRequestHeaders().containsKey("Range")) return null;
      try {
        return AssetBridge.serve(act, req.getUrl());
      } catch (Throwable t) {
        return null;   // 拦截失败就当没拦，绝不影响页面
      }
    }
  }

  /** 进度条、全屏视频/画布、文件选择。 */
  static class SiteChrome extends WebChromeClient {
    private final MainActivity act;

    SiteChrome(MainActivity a) {
      this.act = a;
    }

    @Override
    public void onProgressChanged(WebView v, int p) {
      act.bar.setVisibility(p >= 100 ? View.GONE : View.VISIBLE);
      act.bar.setProgress(p);
    }

    @Override
    public void onShowCustomView(View view, CustomViewCallback cb) {
      if (act.customView != null) {
        cb.onCustomViewHidden();
        return;
      }
      act.customView = view;
      act.customViewCallback = cb;
      act.rootView.addView(view, new FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
      act.web.setVisibility(View.GONE);
      act.bar.setVisibility(View.GONE);
      act.hideSystemBars();
    }

    @Override
    public void onHideCustomView() {
      if (act.customView == null) return;
      act.rootView.removeView(act.customView);
      act.customView = null;
      act.web.setVisibility(View.VISIBLE);
      if (act.customViewCallback != null) {
        act.customViewCallback.onCustomViewHidden();
        act.customViewCallback = null;
      }
    }

    @Override
    public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
      if (act.fileCallback != null) act.fileCallback.onReceiveValue(null);
      act.fileCallback = cb;
      try {
        act.startActivityForResult(params.createIntent(), FILE_PICKER);
      } catch (Exception e) {
        act.fileCallback = null;
        return false;
      }
      return true;
    }

    @Override
    public void onPermissionRequest(PermissionRequest request) {
      request.deny();
    }
  }
}
