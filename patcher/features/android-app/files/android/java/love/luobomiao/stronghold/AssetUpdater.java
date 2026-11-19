// AssetUpdater.java —— App 内置的「只补缺失资源」更新器（维护者 2026-11-19）。
//
// 背景：APK 里嵌着整套资源包（sp/assets，1.4 GB）。以前每次加素材都只能重发整包，
// 玩家就得再下 1.5 GB。其实 AssetBridge 早就支持「包里没有就走网络」，但那是每次冷缓存都要下。
//
// 这个类把「包外增量」落到磁盘上：
//   1) 启动后（以及回前台，每 12 小时最多一次）拉 /download/android-assets.json
//      { "version": 1, "base": "https://assets.luobomiao.love/assets/",
//        "files": { "local/fx/prefabs/xxx.json": 35350, ... } }   ← 只列 APK 里没有/变了的
//   2) 逐个比对 filesDir/overlay/sp/assets/<key> 是否已存在且大小一致，不一致才下载
//   3) 下载写入 <key>.part 后原子改名 —— 断网/被杀不会留下半截文件
//   4) AssetBridge 每次请求先看这个目录，命中就直接从磁盘喂给 WebView
//
// 只做「资源增量」：页面自身的 JS/CSS 本来就走网络（AssetBridge 不拦），永远是新的。
package love.luobomiao.stronghold;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Log;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import org.json.JSONObject;

final class AssetUpdater {
  static final String TAG = "sp-assets";
  static final String MANIFEST_URL = "https://stronghold.luobomiao.love/download/android-assets.json";
  static final String PREFS = "sp-app";
  static final String KEY_LAST = "assetUpdateAt";
  static final long EVERY_MS = 12L * 60 * 60 * 1000;

  /** 增量资源的落盘根：filesDir/overlay/sp/assets/<rel> */
  static File overlayRoot(Context ctx) {
    return new File(new File(ctx.getFilesDir(), "overlay"), "sp/assets");
  }

  /** 增量文件在磁盘上的路径（AssetBridge 用同一个规则）。 */
  static File overlayFile(Context ctx, String apkPath) {
    // apkPath 形如 sp/assets/local/fx/x.json → 去掉开头的 sp/assets/
    String p = apkPath;
    if (p.startsWith("sp/assets/")) p = p.substring("sp/assets/".length());
    return new File(overlayRoot(ctx), p);
  }

  /** 当前是否在计费网络（移动数据 / 计费热点）上。 */
  static boolean metered(Context ctx) {
    try {
      android.net.ConnectivityManager cm =
          (android.net.ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
      if (cm == null) return false;
      if (cm.isActiveNetworkMetered()) return true;
      android.net.NetworkInfo ni = cm.getActiveNetworkInfo();
      return ni != null && ni.getType() == android.net.ConnectivityManager.TYPE_MOBILE;
    } catch (Throwable e) {
      return false;
    }
  }

  static void maybeStart(Activity act) {
    try {
      SharedPreferences sp = act.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      long now = System.currentTimeMillis();
      if (now - sp.getLong(KEY_LAST, 0L) < EVERY_MS) return;
      // 计费网络（移动数据）不自动补资源：增量可能有几十 MB，等玩家回到 Wi-Fi 再说。
      // 下一次启动还会进来（KEY_LAST 没写），所以回到 Wi-Fi 后自动接着补。
      if (metered(act)) { Log.i(TAG, "metered network: skip asset top-up"); return; }
      sp.edit().putLong(KEY_LAST, now).apply();
      new Thread(new Run(act)).start();
    } catch (Throwable ignored) { /* 资源更新永远不能影响启动 */ }
  }

  static final class Run implements Runnable {
    final Activity act;
    Run(Activity a) { this.act = a; }

    @Override public void run() {
      int got = 0;
      long bytes = 0;
      try {
        JSONObject m = new JSONObject(get(MANIFEST_URL));
        String base = m.optString("base", "https://assets.luobomiao.love/assets/");
        JSONObject files = m.optJSONObject("files");
        if (files == null) return;
        List<String> todo = new ArrayList<String>();
        for (Iterator<String> it = files.keys(); it.hasNext(); ) {
          String key = it.next();
          long want = files.optLong(key, -1);
          File dst = new File(overlayRoot(act), key);
          if (dst.isFile() && want > 0 && dst.length() == want) continue;   // 已经有了
          todo.add(key);
        }
        Log.i(TAG, "increment: " + todo.size() + " / " + files.length());
        for (String key : todo) {
          File dst = new File(overlayRoot(act), key);
          File dir = dst.getParentFile();
          if (dir != null && !dir.isDirectory() && !dir.mkdirs()) continue;
          File part = new File(dst.getPath() + ".part");
          if (!download(base + key, part)) { delete(part); continue; }
          if (dst.exists() && !dst.delete()) { delete(part); continue; }
          if (!part.renameTo(dst)) { delete(part); continue; }
          got++;
          bytes += dst.length();
        }
      } catch (Throwable e) {
        Log.w(TAG, "increment failed: " + e);
      }
      if (got > 0) {
        final String msg = "已补充 " + got + " 个资源（" + (bytes / 1024 / 1024) + " MB）";
        Log.i(TAG, msg);
        act.runOnUiThread(new Toast2(act, msg));
      }
    }
  }

  /**
   * 弹一个 Toast。用**命名**静态内部类而不是匿名类：
   * d8 8.2.2 处理本工程这种匿名内部类（内部类的局部匿名类）会内部 NPE（AssetUpdater\.class）。
   */
  static final class Toast2 implements Runnable {
    final Activity act;
    final String msg;
    Toast2(Activity a, String m) { this.act = a; this.msg = m; }
    @Override public void run() {
      try { Toast.makeText(act, msg, Toast.LENGTH_SHORT).show(); } catch (Throwable ignored) { }
    }
  }

  static boolean download(String url, File out) {
    HttpURLConnection c = null;
    InputStream in = null;
    FileOutputStream fo = null;
    try {
      c = (HttpURLConnection) new URL(url).openConnection();
      c.setConnectTimeout(15000);
      c.setReadTimeout(30000);
      c.setInstanceFollowRedirects(true);
      int code = c.getResponseCode();
      if (code != 200) return false;
      in = c.getInputStream();
      fo = new FileOutputStream(out);
      byte[] buf = new byte[64 * 1024];
      int n;
      while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
      fo.flush();
      return true;
    } catch (Throwable e) {
      return false;
    } finally {
      close(fo);
      close(in);
      if (c != null) c.disconnect();
    }
  }

  static String get(String url) throws Exception {
    HttpURLConnection c = null;
    InputStream in = null;
    try {
      c = (HttpURLConnection) new URL(url).openConnection();
      c.setConnectTimeout(15000);
      c.setReadTimeout(20000);
      c.setInstanceFollowRedirects(true);
      if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
      in = c.getInputStream();
      java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
      byte[] buf = new byte[16 * 1024];
      int n;
      while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
      return new String(bo.toByteArray(), "UTF-8");
    } finally {
      close(in);
      if (c != null) c.disconnect();
    }
  }

  static void close(java.io.Closeable c) {
    if (c != null) { try { c.close(); } catch (Throwable ignored) { } }
  }

  static void delete(File f) { if (f != null && f.exists()) { try { f.delete(); } catch (Throwable ignored) { } } }

  private AssetUpdater() { }
}
