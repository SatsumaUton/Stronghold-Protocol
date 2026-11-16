# 纯命令行构建 APK（不依赖 Gradle / Android Studio）
#
# 用法：
#   pwsh -File android\build.ps1                # 自增 versionCode 并打包
#   pwsh -File android\build.ps1 -VersionName 1.1
#
# 产物：dist\StrongholdProtocol-<versionName>.apk
#
# 依赖（首次运行前一次性准备，见 android\README.md）：
#   D:\Stronghold-Protocol\.android-sdk\  build-tools;34.0.0 + platforms;android-34
#   JDK 17+（本机 C:\Program Files\Java\jdk-21.0.11）
param(
  [string]$VersionName = "",
  [int]$VersionCode = 0
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $here
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { 'D:\Stronghold-Protocol\.android-sdk' }
$javaHome = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:\Program Files\Java\jdk-21.0.11' }
$build = Join-Path $here 'build'
$dist = Join-Path $repo '..\dist'
$bt = Join-Path $sdk 'build-tools\34.0.0'
$androidJar = Join-Path $sdk 'platforms\android-34\android.jar'
foreach ($p in @($bt, $androidJar, (Join-Path $javaHome 'bin\javac.exe'))) {
  if (-not (Test-Path $p)) { throw "缺少构建依赖：$p（见 android\README.md）" }
}

# ---- 版本号 ----
$versionFile = Join-Path $here 'version.json'
$v = if (Test-Path $versionFile) { Get-Content $versionFile -Raw | ConvertFrom-Json } else { [pscustomobject]@{ code = 0; name = '1.0' } }
if ($VersionCode -gt 0) { $v.code = $VersionCode } else { $v.code = [int]$v.code + 1 }
if ($VersionName) { $v.name = $VersionName }
@{ code = [int]$v.code; name = "$($v.name)" } | ConvertTo-Json -Compress | Set-Content $versionFile -Encoding UTF8
Write-Host "版本：$($v.name)（versionCode $($v.code)）"

# ---- 清理 ----
Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $build, "$build\gen", "$build\classes", "$build\dex", $dist | Out-Null

# ---- 1. 资源 ----
& "$bt\aapt2.exe" compile --dir (Join-Path $here 'res') -o "$build\res.zip"
if ($LASTEXITCODE) { throw 'aapt2 compile 失败' }
& "$bt\aapt2.exe" link -o "$build\app-unsigned.apk" `
  -I $androidJar `
  --manifest (Join-Path $here 'AndroidManifest.xml') `
  -R "$build\res.zip" `
  --java "$build\gen" `
  --min-sdk-version 24 --target-sdk-version 34 `
  --version-code $v.code --version-name $v.name `
  --auto-add-overlay
if ($LASTEXITCODE) { throw 'aapt2 link 失败' }

# ---- 2. Java ----
$sources = @(Get-ChildItem -Recurse -Filter *.java -Path (Join-Path $here 'java'), "$build\gen" | ForEach-Object { $_.FullName })
& "$javaHome\bin\javac.exe" -encoding UTF-8 --release 11 -nowarn -XDstringConcat=inline `
  -classpath $androidJar -d "$build\classes" @sources
if ($LASTEXITCODE) { throw 'javac 失败' }

# ---- 3. dex ----
$classes = @(Get-ChildItem -Recurse -Filter *.class -Path "$build\classes" | ForEach-Object { $_.FullName })
& "$bt\d8.bat" --lib $androidJar --min-api 24 --output "$build\dex" @classes
if ($LASTEXITCODE) { throw 'd8 失败' }

# ---- 4. 把 classes.dex 塞进 APK ----
Push-Location "$build\dex"
& "$javaHome\bin\jar.exe" --update --file "$build\app-unsigned.apk" classes.dex
Pop-Location
if ($LASTEXITCODE) { throw 'jar 打包 classes.dex 失败' }

# ---- 5. 对齐 + 签名 ----
& "$bt\zipalign.exe" -f 4 "$build\app-unsigned.apk" "$build\app-aligned.apk"
if ($LASTEXITCODE) { throw 'zipalign 失败' }

$secretDir = Join-Path $repo '..\.secrets\android'
$ks = Join-Path $secretDir 'stronghold-release.jks'
$passFile = Join-Path $secretDir 'keystore.pass'
New-Item -ItemType Directory -Force -Path $secretDir | Out-Null
if (-not (Test-Path $ks)) {
  # 首次：生成自签名密钥（有效期 30 年）。**这个文件必须长期保存** —— 换钥匙就无法覆盖安装旧版本。
  $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  Set-Content $passFile $pw -NoNewline -Encoding UTF8
  & "$javaHome\bin\keytool.exe" -genkeypair -v -keystore $ks -alias stronghold `
    -keyalg RSA -keysize 2048 -validity 10950 -storepass $pw -keypass $pw `
    -dname "CN=Stronghold Protocol, OU=luobomiao, O=fan remake, L=CN, C=CN"
  if ($LASTEXITCODE) { throw 'keytool 失败' }
  Write-Host "已生成签名密钥：$ks（请备份，连同 $passFile）"
}
$pass = (Get-Content $passFile -Raw).Trim()
$out = Join-Path $dist "StrongholdProtocol-$($v.name).apk"
& "$bt\apksigner.bat" sign --ks $ks --ks-key-alias stronghold `
  --ks-pass "pass:$pass" --key-pass "pass:$pass" `
  --out $out "$build\app-aligned.apk"
if ($LASTEXITCODE) { throw 'apksigner 失败' }
& "$bt\apksigner.bat" verify --print-certs $out | Select-Object -First 3

$mb = [math]::Round((Get-Item $out).Length / 1MB, 2)
Write-Host "完成：$out（$mb MB）"

