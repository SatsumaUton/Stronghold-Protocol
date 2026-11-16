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
  }

  /** UA 后面加一个标记，方便在服务端日志里认出 App 客户端。 */
  static String uaWithTag(String base) {
    StringBuilder sb = new StringBuilder();
    sb.append(base);
    sb.append(" StrongholdProtocolApp/1.0");
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
