// 自带资源包（维护者 2026-11-17：「把安卓 app 做完整，然后自带完整资源包」）。
//
// 外壳仍然从线上站点加载页面（这样站点一更新，App 不用重新发版就是最新的），
// 但**体积大、几乎不变**的那部分 —— 美术、音频、字体、图标、vendor 库 —— 打进 APK 里，
// 由 WebViewClient.shouldInterceptRequest 从 APK 的 assets 直接喂给 WebView：
//
//   https://stronghold.luobomiao.love/assets/char/avatar/x.png   → APK assets sp/assets/char/avatar/x.png
//   https://assets.luobomiao.love/assets/local/fx/a.json         → APK assets sp/assets/local/fx/a.json
//   https://<任一我方域名>/media/bgm/act1                        → APK assets sp/assets/audio/bgm/act1.<ext>
//   https://<任一我方域名>/fonts/x.woff2 / /icons/ / /vendor/    → 同名目录
//
// 三条必须遵守的口径（与 server/http/static.js + shared/assetPaths.js 一致）：
//   1. URL 的第一段可能是**内容哈希**（`~` + 16 位十六进制，`/assets/~0123…/char/x.png`），
//      服务端会把它去掉再取文件，这里也必须去掉；
//   2. `/media/…` 是无扩展名的音频路由，服务端按 AUDIO_EXTS 的次序试扩展名（shared/media.js）；
//   3. 命中不了就返回 null —— 让 WebView 照常走网络，所以即便 APK 里没有某张图、
//      或者站点后来加了新素材，都不会变成 404。
//
// 只用 Android 框架类，便于 build.ps1 纯命令行构建。
package love.luobomiao.stronghold;

import android.content.Context;
import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

final class AssetBridge {
  /** APK assets 里这些目录的前缀（build.ps1 把 public/assets 等复制到 sp/assets 等）。 */
  static final String ROOT = "sp";

  /** 只拦我们自己的域名：页面主站与资源站。 */
  static final String[] HOSTS = { "stronghold.luobomiao.love", "assets.luobomiao.love" };

  /** 值得打进 APK 的路径前缀（页面本身与 /data 不拦，它们必须永远是最新的）。 */
  static final String[] PREFIXES = { "/assets/", "/fonts/", "/icons/", "/vendor/", "/media/" };

  /** `/media/` 的扩展名次序，照 shared/media.js 的 AUDIO_EXTS。 */
  static final String[] AUDIO_EXTS = { ".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav" };

  /** 内容哈希段：`~` + 16 位小写十六进制（shared/assetPaths.js 的 HASH_SEGMENT_RE）。 */
  static final int HASH_LEN = 16;

  private AssetBridge() { }

  /**
   * 为一次资源请求返回 APK 里的那个文件；没有就走网络（返回 null）。
   * @param ctx Activity
   * @param uri 请求地址
   */
  static WebResourceResponse serve(Context ctx, Uri uri) {
    if (ctx == null || uri == null) return null;
    String host = uri.getHost();
    if (host == null || !hostAllowed(host)) return null;
    String path = uri.getPath();
    if (path == null || path.length() < 2) return null;

    // ---- 1. 去掉内容哈希段 ----
    String cleaned = stripHash(path);

    // ---- 2. 定位到 APK assets 里的相对路径 ----
    String apkPath = null;
    String mime = null;
    if (cleaned.startsWith("/media/")) {
      String rest = cleaned.substring("/media/".length());
      if (rest.isEmpty() || rest.endsWith("/")) return null;
      apkPath = findAudio(ctx.getAssets(), rest);
      mime = apkPath == null ? null : mimeOf(apkPath);
    } else {
      apkPath = ROOT + cleaned;
      mime = mimeOf(cleaned);
    }
    if (apkPath == null || mime == null) return null;

    // ---- 3. 从 APK 读出来 ----
    InputStream in = null;
    try {
      in = ctx.getAssets().open(apkPath);
    } catch (IOException e) {
      if (in != null) {
        try { in.close(); } catch (IOException ignored) { }
      }
      return null;   // 包里没有这个文件：交给网络，别吞掉请求
    }

    WebResourceResponse res = new WebResourceResponse(mime, encodingOf(mime), in);
    Map<String, String> headers = new HashMap<String, String>();
    // 带哈希段的内容永远不变（server/assetPaths.js 就是为此设计的），可以放心长缓存；
    // 不带哈希段的沿用站点同路径的 1 天。
    headers.put("Cache-Control", hasHash(path) ? "public, max-age=31536000, immutable" : "public, max-age=86400");
    // 资源站（assets.luobomiao.love）对页面（stronghold.luobomiao.love）是跨域：清单里可能是绝对地址，
    // 客户端用 fetch/XHR 取的时候会走 CORS。这里是我们替服务器回的，必须自己补上 CORS 头，
    // 否则一路「被拦截的请求」在控制台里静默失败、图全是空的。素材本来就是公开只读，`*` 足够。
    headers.put("Access-Control-Allow-Origin", "*");
    headers.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    // 预检请求（带 Range 或自定义头时会有）也可能被拦到，直接回空 200。
    res.setResponseHeaders(headers);
    return res;
  }

  /** 只认我们自己的主机（含子域），其余一律交给网络。 */
  static boolean hostAllowed(String host) {
    String h = host.toLowerCase(Locale.US);
    for (String want : HOSTS) {
      if (h.equals(want) || h.endsWith("." + want)) return true;
    }
    return false;
  }

  /** `/assets/~0123456789abcdef/char/x.png` → `/assets/char/x.png`；没有哈希段则原样返回。 */
  static String stripHash(String path) {
    for (String prefix : PREFIXES) {
      if (!path.startsWith(prefix)) continue;
      int segStart = prefix.length();
      int segEnd = path.indexOf('/', segStart);
      if (segEnd < 0) return path;
      String seg = path.substring(segStart, segEnd);
      if (seg.length() == HASH_LEN + 1 && seg.charAt(0) == '~' && isHex(seg.substring(1))) {
        return prefix + path.substring(segEnd + 1);
      }
      return path;
    }
    return path;
  }

  /** 这个 URL 有没有内容哈希段（决定缓存多久）。 */
  static boolean hasHash(String path) {
    return !stripHash(path).equals(path);
  }

  static boolean isHex(String s) {
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      boolean ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
      if (!ok) return false;
    }
    return s.length() > 0;
  }

  /**
   * `/media/bgm/act1` → 依次试 `assets/audio/bgm/act1.mp3` …；给了扩展名就以它优先。
   * @return APK 里的完整路径，或 null
   */
  static String findAudio(AssetManager am, String rest) {
    String given = "";
    String stem = rest;
    int dot = rest.lastIndexOf('.');
    int slash = rest.lastIndexOf('/');
    if (dot > slash) {
      String ext = rest.substring(dot).toLowerCase(Locale.US);
      if (isAudioExt(ext)) {
        given = ext;
        stem = rest.substring(0, dot);
      }
    }
    if (stem.isEmpty() || stem.endsWith("/")) return null;
    if (given.length() > 0) {
      String p = ROOT + "/assets/audio/" + stem + given;
      if (exists(am, p)) return p;
    }
    for (String ext : AUDIO_EXTS) {
      if (ext.equals(given)) continue;
      String p = ROOT + "/assets/audio/" + stem + ext;
      if (exists(am, p)) return p;
    }
    return null;
  }

  static boolean isAudioExt(String ext) {
    for (String e : AUDIO_EXTS) if (e.equals(ext)) return true;
    return false;
  }

  /** APK assets 里这个条目在不在（不读内容，只开关一次）。 */
  static boolean exists(AssetManager am, String path) {
    InputStream in = null;
    try {
      in = am.open(path);
      return true;
    } catch (IOException e) {
      return false;
    } finally {
      if (in != null) {
        try { in.close(); } catch (IOException ignored) { }
      }
    }
  }

  /** 扩展名 → MIME。查不到就 application/octet-stream（WebView 按字节给，不会当 HTML 解析）。 */
  static String mimeOf(String path) {
    String p = path.toLowerCase(Locale.US);
    String ext = "";
    int dot = p.lastIndexOf('.');
    if (dot >= 0) ext = p.substring(dot);
    if (ext.equals(".png")) return "image/png";
    if (ext.equals(".jpg") || ext.equals(".jpeg")) return "image/jpeg";
    if (ext.equals(".webp")) return "image/webp";
    if (ext.equals(".gif")) return "image/gif";
    if (ext.equals(".svg")) return "image/svg+xml";
    if (ext.equals(".ico")) return "image/x-icon";
    if (ext.equals(".mp3")) return "audio/mpeg";
    if (ext.equals(".ogg") || ext.equals(".oga")) return "audio/ogg";
    if (ext.equals(".opus")) return "audio/opus";
    if (ext.equals(".m4a")) return "audio/mp4";
    if (ext.equals(".aac")) return "audio/aac";
    if (ext.equals(".wav")) return "audio/wav";
    if (ext.equals(".json")) return "application/json";
    if (ext.equals(".js") || ext.equals(".mjs")) return "text/javascript";
    if (ext.equals(".css")) return "text/css";
    if (ext.equals(".html")) return "text/html";
    if (ext.equals(".txt") || ext.equals(".obj") || ext.equals(".atlas") || ext.equals(".fnt")) return "text/plain";
    if (ext.equals(".woff2")) return "font/woff2";
    if (ext.equals(".woff")) return "font/woff";
    if (ext.equals(".ttf")) return "font/ttf";
    if (ext.equals(".otf")) return "font/otf";
    return "application/octet-stream";
  }

  /** 文本类要给 WebView 一个 encoding；二进制必须给 null（给了会当文本解码，图就坏了）。 */
  static String encodingOf(String mime) {
    if (mime.startsWith("text/") || mime.equals("application/json") || mime.equals("image/svg+xml")) return "UTF-8";
    return null;
  }
}
