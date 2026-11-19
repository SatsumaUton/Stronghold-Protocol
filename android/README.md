# 安卓 APK（卫戍协议：盟约 · 萝卜喵公益服）

App 里直接加载线上站点 `https://stronghold.luobomiao.love/`，所以**站点一更新，App 不用重新发版就是最新的**。
PC 上的功能（3D 战场、WebGL、音频、全屏、文件上传、邀请链接进房）都走同一套网页，没有为移动端做任何删减。

## 自带完整资源包（维护者 2026-11-17）

APK 里**已经装着**整套美术、音频、字体、图标与 vendor 库：

```
sp/assets/   public/assets 的 51791 个文件（2266.6 MB：立绘 / 模型 / 音效 / 语音 / 场景 / 特效 / 官方界面）
sp/fonts/    public/fonts    7 个
sp/icons/    public/icons    10 个
sp/vendor/   public/vendor   12 个（preact / htm / pixi / three …）
```

由 `AssetBridge.java` 在 `shouldInterceptRequest` 里拦截这些请求、直接从 APK 读（不再走网络）：

| 页面请求 | 读 APK 里的 |
|---|---|
| `https://stronghold.luobomiao.love/assets/~<hash>/char/avatar/x.png` | `sp/assets/char/avatar/x.png` |
| `https://assets.luobomiao.love/assets/local/fx/a.json` | `sp/assets/local/fx/a.json` |
| `https://<我方域名>/media/bgm/act1`（无扩展名） | `sp/assets/audio/bgm/act1.mp3` |
| `/fonts/` `/icons/` `/vendor/` | 同名目录 |

三条口径与服务器一致：**去掉内容哈希段**（`~`+16 位十六进制）、`/media/` **按扩展名次序试**
（`shared/media.js` 的 `AUDIO_EXTS`）、**命中不了就返回 null 走网络**（所以 APK 里没有的图、
或站点后加的新素材，都不会变成 404）。带 `Range` 的请求（音频拖动）也让给网络。

**打包体积**：未压缩 2266.6 MB → APK **1528.6 MB**（签名后 1532.8 MB）。png/音频本来就压过，所以按扩展名
**存而不压**，只有 json/atlas/skel/js/css 走 deflate。资源再涨要留意 ZIP32 的字段上限
（单条目 4 GB、中央目录偏移 4 GB）—— 现在 1.5 GB 还有余量。

**⚠ 为什么不用 aapt2 的 `-A`**：Windows 上的 aapt2 把 assets 条目名写成**反斜杠**
（`assets/sp\local\map\fx\[opt]merged_textures.png`），Android 的 `AssetManager` 只认正斜杠，
装到手机上会一个都读不到。所以 `build.ps1` 先做出 APK，再用 `android/pack-assets.mjs` **自己重写 ZIP**
（条目名一律 `/`，实测 51820 个条目 0 个反斜杠）。资源里 8 个带方括号的文件名（`[opt]merged_textures.png`、
`[ucp]TX_water_normal.png`）按原样保留。

只想要轻量外壳（素材全走网络）：

```powershell
pwsh -File android\build.ps1 -NoAssets
# 或只带部分：-AssetDirs "fonts,icons,vendor"
```

## 产物

```
dist\StrongholdProtocol-<versionName>.apk      ← 分发给玩家安装（自带资源，1.5 GB）
```

- 包名：`love.luobomiao.stronghold`（**永远不要改**，否则新版本无法覆盖安装）
- 最低系统：Android 7.0（API 24）；目标 API 34
- 权限：`INTERNET`、`ACCESS_NETWORK_STATE`、`WAKE_LOCK`、`REQUEST_INSTALL_PACKAGES`（第四条是应用内更新装包用的）
- 图标：站点 `/icons/app-512.png` 生成的五档 mipmap

**分发**（2026-11-19 起的口径）：

1. **原子替换**发布包 —— 先写 `public/download/stronghold-android.apk.part`，sha256 与 `dist/…apk` 一致后再
   `rename` 覆盖（1.5 GB 复制被打断也不会留下截断文件）。
2. 改 `public/download/android-version.json` 的 `code` / `name`（App 启动时拉这份小文件判断要不要提示更新）。
3. 跑 `node tools/build-android-assets.mjs` 刷新增量清单（基线＝刚发布的包）。
4. `node deploy/sync-nodes.cjs --apply`，复检必须「0 处差异」。
5. 资源站那份 APK 也要换成同一个包（`/download/stronghold-android.apk` 是 302 到资源站的）。

**nginx 侧（2026-11-19 已改）**：

- `/download/android-version.json` 与 `/download/android-assets.json` **由主站直出**（`alias` + `no-store`）——
  以前版本文件 302 到资源站，而资源站恰恰可能滞后，App 就永远看不到新版本、兜底链也不会触发；
- `/download/stronghold-android-local.apk` 是**应急直发**，指向稳定的发布包路径（不是 `dist/版本号.apk`）——
  以前它指着旧版本，每发一版都得手改 nginx；
- 线上配置的脱敏快照在 `deploy/nginx.conf`，还原用 `node deploy/render-nginx.cjs --apply`
  （必须显式设 `SP_ROOT`；`--check` 只比对）。

## 安装

1. 把 APK 传到手机（微信/QQ 传文件、数据线、网盘都行）；**1.5 GB**，第一次装要留够空间；
2. 在手机上点开 APK → 允许「安装未知来源应用」（各品牌位置不同，一般是设置 → 应用 → 特殊权限）；
3. 装好后桌面会出现「卫戍协议」，点开即用；第一次启动会自动进首页。

> 华为/荣耀等没有 GMS 的机器也能用：外壳只用系统 WebView，不依赖 Google 服务。

## 重新打包

```powershell
# 默认自带完整资源包（1.4 GB，约 6 分钟）
pwsh -File android\build.ps1 -VersionName 1.6

# 只要轻量外壳（素材全走网络，约 1 MB）
pwsh -File android\build.ps1 -NoAssets -VersionName 1.6

# 只带一部分（值 = public/ 下的目录名）
pwsh -File android\build.ps1 -AssetDirs "fonts,icons,vendor" -VersionName 1.6
```

首次构建前需要一次性准备（本机已经装好，见下表）：

| 依赖 | 位置 |
|---|---|
| JDK 17+ | `C:\Program Files\Java\jdk-21.0.11` |
| Android SDK | `D:\Stronghold-Protocol\.android-sdk` |
| build-tools;34.0.0 | `.android-sdk\build-tools\34.0.0` |
| platforms;android-34 | `.android-sdk\platforms\android-34` |

装 SDK 的办法（已做过，重装机器时用）：

```powershell
$root = 'D:\Stronghold-Protocol\.android-sdk'
# 下载 commandlinetools-win-*.zip → 解压成 $root\cmdline-tools\latest\{bin,lib,source.properties}
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21.0.11'
("y`n" * 60) | & "$root\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$root `
  "platform-tools" "build-tools;34.0.0" "platforms;android-34"
# 图标（站点图标 → 五档 mipmap）：用 Pillow 缩放，见下面「图标」
```

## 签名密钥（**必须备份**）

```
.secrets\android\stronghold-release.jks     ← 私钥
.secrets\android\keystore.pass              ← 口令（明文，仅本机）
```

- 第一次构建时自动生成（自签名，RSA 2048，有效期 30 年）；
- **换了这把钥匙，玩家就只能卸载重装**（Android 不允许不同签名的同包名覆盖安装）；
- 所以这两个文件要与仓库一起做备份，且**不要提交进 git**（`.secrets/` 已被忽略）。

## 结构

```
android/
  AndroidManifest.xml                       包名/权限/全屏主题/深链（?room=CODE）
  java/love/luobomiao/stronghold/
    MainActivity.java                       外壳：WebView + 全屏 + 文件选择 + 外链 + 返回键 + 应用内更新
    AssetBridge.java                        拦截 /assets 等请求：先读增量目录 → 再读 APK → 否则走网络
    AssetUpdater.java                       内置增量资源更新（只下 APK 里没有的素材；计费网络不下）
  res/values/strings.xml                    应用名（卫戍协议）、离线页 HTML
  res/values/styles.xml                     全屏黑底主题（框架主题，无 AndroidX）
  res/mipmap-*/ic_launcher.png              五档图标
  build.ps1                                 纯命令行构建（aapt2 → javac → d8 → zipalign → apksigner）
  version.json                              versionCode / versionName（构建时自增）
```

## 内置更新（1.3 起）

两件事都**在 App 内完成**，不用玩家自己开浏览器下 1.5 GB：

### 1. 资源增量（只补 APK 里没有的素材）

```
启动 / 回前台（每 12 小时最多一次）
  → 拉 https://stronghold.luobomiao.love/download/android-assets.json
  → 逐个比对 filesDir/overlay/sp/assets/<key> 是否已存在且大小一致
  → 只下缺的（写 .part → 校验字节数 → 原子改名）
  → 完成后弹一句「已补充 N 个资源」
```

`AssetBridge.serve()` 对 `/assets/` 请求**先查这个 overlay 目录**，命中就从磁盘喂给 WebView；
没命中照旧 APK → 网络。所以在旧包上新增的素材也会落到手机上，不必整包重发。

**清单的基线语义**：`android-assets.json` 永远相对**当前已发布的那个 APK**生成
（`tools/build-android-assets.mjs` 读 APK 的 ZIP 中央目录，与 `public/assets` 比大小）。
刚打完包时清单是 0 条 —— 这是对的：装新包的人不需要补任何东西；素材再变才会出现增量。
`build.ps1` 在打包末尾自动跑一次刷新基线。

**多源兜底**：清单里的 `bases` 是 `[资源站, 主站]`。某个源下不到、或下到的**字节数与清单不符**
（说明那个源还是旧版本）就自动换下一个源 —— 这正是「资源站滞后时先从兜底下」。

**计费网络**：`isActiveNetworkMetered()` 为真时**不自动补**（增量可能几十 MB），回到 Wi-Fi 再补。

### 2. 应用内下载 + 安装

```
启动时拉 /download/android-version.json（主站直出，不缓存）
  → 比 versionCode，有新版就弹「发现新版本」
  → 「立即更新」→ DownloadManager 在 App 内下载（通知栏看进度）
  → 下载完成广播（ApkDone）→ 弹「立即安装」
  → DownloadManager.getUriForDownloadedFile 拿 content:// 交给系统安装器
```

- 不静默安装（Android 必须用户点确认 + 允许「安装未知应用」）；
- `mirrors` 数组可加备用地址（绝对 URL 或 `/` 开头的站内路径），下载失败自动换下一个；
- 不需要 FileProvider：`DownloadManager` 自己产出并授权 `content://`。

### 3. 画面适配的保命出口

网页的「异形屏适配 / 界面大小」把人锁死时（画面点不到设置），**长按返回键 1.2 秒**：
清掉本机 `sp.pref.screenFit` 并刷新。网页侧另有 `clampFitToViewport`，保证适配框不小于
min(320, 55% 宽) × min(240, 45% 高)。

## ⚠ 构建陷阱：不要用匿名内部类

`d8`（R8 8.2.2）处理本工程的**匿名内部类**会内部 NPE（`Cannot invoke "String.length()" because ... is null`），
表现为 `d8 失败`，而报错堆栈全在 R8 内部、指不到源文件。**一律用命名静态内部类**：
`Dl`（DownloadListener）、`Toast2`、`ApkDone`、`InstallClick`、`SiteClient`、`UpdateCheck` 都是这么写的。

另两个容易踩的：

- **漏 `package love.luobomiao.stronghold;`**：新加的 .java 会落在默认包，同包类看不见它，报「找不到符号」。
- **`build.ps1` 不建 `build\classes` / `build\dex`**：手工清过中间产物后要先 `mkdir`，否则 d8 报
  `Invalid output ... Output must be a .zip or .jar archive or an existing directory`。
## 与站点的关系

| 改了什么 | 怎么做 |
|---|---|
| 页面、样式、数据、服务端逻辑 | **不用管 APK** —— 玩家重开 App 就是最新 |
| 外壳本身（权限、图标、加载域名、返回键行为…） | 改 `MainActivity.java` / `AndroidManifest.xml` → 跑 `build.ps1` → 发新的 APK |
| 换域名 | 改 `MainActivity.HOME` 一行，重新打包 |

## 已知取舍

- **纯 WebView 外壳**，不是 TWA：不需要在站点上放 `assetlinks.json`、不依赖 Chrome，任何机器都能跑；
  代价是没有「像原生应用」的启动动画（启动即加载网页，通常 1–2 秒）。
- 网页里的 `target=_blank` 与 `window.open` 都在同一个 WebView 内打开（`setSupportMultipleWindows(false)`），
  避免冒出第二个窗口。
- 麦克风/摄像头权限一律拒绝（站点目前不需要）。
- 文件选择支持（换头像、上传皮肤），走系统的文件选择器。

## 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| 打开是空白/黑屏 | 网络不通或站点证书问题；App 会在主文档失败时显示「连不上服务器，正在重试…」离线页 |
| 点输入框键盘挡住 | `windowSoftInputMode=adjustResize` 已开；若仍是遮挡，把系统字体缩放调回 100% |
| 装不上（解析包错误） | APK 传输损坏，重新传一次；或 Android 版本低于 7.0 |
| 覆盖安装失败（签名不一致） | 之前装过别处编译的同名包，请先卸载 |
| 打开「异形屏适配」后点不到设置 | **长按返回键 1.2 秒**复位画面适配（清 `sp.pref.screenFit` 并刷新） |
| 点「下载」没反应 | 1.2 及更早的包没有 `setDownloadListener`，需升级到 1.3+；新版会在通知栏下载 |
