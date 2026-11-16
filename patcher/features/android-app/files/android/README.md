# 安卓 APK（卫戍协议：盟约 · 萝卜喵公益服）

一个**薄外壳**：App 里直接加载线上站点 `https://stronghold.luobomiao.love/`，
所以**站点一更新，App 不用重新发版就是最新的**（这就是「内容可以直接更新」）。
PC 上的功能（3D 战场、WebGL、音频、全屏、文件上传、邀请链接进房）都走同一套网页，
没有为移动端做任何删减。

## 产物

```
dist\StrongholdProtocol-<versionName>.apk      ← 分发给玩家安装
```

- 包名：`love.luobomiao.stronghold`（**永远不要改**，否则新版本无法覆盖安装）
- 最低系统：Android 7.0（API 24）；目标 API 34
- 权限：`INTERNET`、`ACCESS_NETWORK_STATE`、`WAKE_LOCK`（只这三条）
- 图标：站点 `/icons/app-512.png` 生成的五档 mipmap

## 安装

1. 把 APK 传到手机（微信/QQ 传文件、数据线、网盘都行）；
2. 在手机上点开 APK → 允许「安装未知来源应用」（各品牌位置不同，一般是设置 → 应用 → 特殊权限）；
3. 装好后桌面会出现「卫戍协议」，点开即用；第一次启动会自动进首页。

> 华为/荣耀等没有 GMS 的机器也能用：外壳只用系统 WebView，不依赖 Google 服务。

## 重新打包

```powershell
# 版本号会自动 +1；要指定版本名：
pwsh -File android\build.ps1 -VersionName 1.1
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
    MainActivity.java                       外壳：WebView + 全屏 + 文件选择 + 外链 + 返回键
  res/values/strings.xml                    应用名（卫戍协议）、离线页 HTML
  res/values/styles.xml                     全屏黑底主题（框架主题，无 AndroidX）
  res/mipmap-*/ic_launcher.png              五档图标
  build.ps1                                 纯命令行构建（aapt2 → javac → d8 → zipalign → apksigner）
  version.json                              versionCode / versionName（构建时自增）
```

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
