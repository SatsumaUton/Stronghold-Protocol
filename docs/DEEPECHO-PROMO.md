# 深渊回响 · 宣传片工作台

> 给「深渊回响」拍宣传片用的工具与分镜。**所有画面都来自真实对局**（同一套 sim、同一个 seed 可复现），
> 不是手搓的演示动画。

## 一句话定位

| 项 | 内容 |
|---|---|
| 主宣传片 | **A「没有底」** · 30 秒 · 冷开场（无解说、只有画面与字幕） |
| 目标观众 | 已经玩过原版、想找「还能不能再深一点」的老玩家 |
| 核心钩子 | 打完最后一个 Boss 不停 —— **只有团灭才结束**，深度就是成绩 |
| 投放 | 群公告 / B 站动态 / 官网首页 |

## 三条备选（本轮做 A）

* **A「没有底」30 秒冷开场**（推荐）：信息密度最高，用「打完 Boss 不停」当钩子。
* **B「一个人的 24 小时」60 秒情感向**：讲单人深潜的保存与回归，适合群内转发。
* **C 教学向 90 秒科普**：双栏对照讲侵蚀词条与祝福，适合论坛置顶。

---

## A「没有底」30 秒分镜

时间轴按 **30 fps** 设计；每一段都标了「用哪个录像 + 从第几秒到第几秒」，
可以直接喂给 `tools/capture-video.mjs`。

| # | 时间 | 画面 | 字幕（中文主标 / 副标） | 声音 | 素材 |
|---|---|---|---|---|---|
| 1 | 0.0–2.5 s | 黑影里一枚**深度数字**从 1 滚到 120（七段数码管字体），背景是极暗的棋盘 | `深度 120` | 低频心跳 + 数码管跳字 | 纯后期（AE / 剪映） |
| 2 | 2.5–6.0 s | 深潜战斗：精英敌人从门口压进来，我方高台开火 | `每一层，都比上一层更不像话` | 战斗底噪渐入 | `dive-d16 --from 6 --to 10` |
| 3 | 6.0–10.0 s | 敌人头顶浮出**侵蚀词条**（护盾 / 巨躯 / 再生），画面轻微变暗 | `侵蚀词条 · 越深越多`<br>`最多 12 条` | 金属摩擦 | `dive-d71 --from 8 --to 12` |
| 4 | 10.0–14.0 s | 关键时刻：盾被打穿、血条见底、一波翻盘 | `打到最后一滴血` | 心跳加速 | `dive-d30 --from 20 --to 24` |
| 5 | 14.0–18.0 s | 12 条词条的极限层：满屏敌人 | `深度 120`<br>`12 条侵蚀词条` | 耳鸣 | `dive-d120 --from 15 --to 19` |
| 6 | 18.0–21.0 s | **黑屏 0.4 秒** + 一声闷响 | `打完最后一个 Boss ——` | 静音 → 闷响 | 纯后期 |
| 7 | 21.0–26.0 s | 回到战斗，但这次画面是**从深往浅倒放**，数字从 120 退回 1 | `不会结束`<br>`只有团灭才结束` | 反转音效 | 把 2–5 段倒放 |
| 8 | 26.0–30.0 s | 标题卡：`深渊回响` + 二维码 / 网址 | `深渊回响`<br>`无尽深潜 · 深度即成绩` | 主音收尾 | 纯后期 |

### 素材清单（要先生成）

```bash
# 1) 录真实深潜战斗（每层一个文件，含侵蚀词条与真实敌人强度）
node tools/record-dive.mjs --depths 16,30,71,120 --max 45

# 2) 逐帧截图 + 编码（按上面分镜的时间段，一段一条）
node tools/capture-video.mjs --scene dive-d16  --from 6  --to 10 --fps 30 --out .cache/video/s2
node tools/capture-video.mjs --scene dive-d71  --from 8  --to 12 --fps 30 --out .cache/video/s3
node tools/capture-video.mjs --scene dive-d30  --from 20 --to 24 --fps 30 --out .cache/video/s4
node tools/capture-video.mjs --scene dive-d120 --from 15 --to 19 --fps 30 --out .cache/video/s5
```

### 后期（剪映 / DaVinci / AE 任选）

1. 四段素材按顺序拼，衔接处用 6 帧黑场或闪白。
2. 第 6 段把 `18.0–21.0` 做成**全黑 + 闷响**，这是全片唯一的静默，反差全靠它。
3. 第 7 段把 2–5 段倒放（剪映「倒放」一键；或用 ffmpeg `-vf reverse`）。
4. 字幕用**思源黑体 Bold**，居中偏下，字距略宽；深潜的主色是青色（`#5fd3c4`）。
5. 导出：1080p / 30 fps / H.264 CRF 18 / `+faststart`（网页可直接播放）。

---

## 工具

### `tools/record-dive.mjs`

录一局**深渊回响**的真实战斗，格式与 `tools/record-battle.mjs` 完全一致，
产物落在 `public/dev/recordings/`，`/dev/render-demo.html` 能直接播。

```bash
node tools/record-dive.mjs                          # 默认 30 / 71 / 120 层
node tools/record-dive.mjs --depths 16,20,30 --max 40
node tools/record-dive.mjs --depths 120 --seed 7 --difficulty ABYSS
```

* 它真的建一个 `variant: 'deepecho'` 的 Match、`startRound(N)` 跳到第 N 层，
  用 Match 自己算出来的 `_normalOpts(ps)` 当战斗参数 —— 所以**侵蚀词条、深层敌人的血量 / 护甲 /
  精英数量都是线上那一局真会发生的**。
* 录像里多带一个 `dive` 字段（`{ depth, difficulty, words: [{name, desc}] }`），
  `render-demo` 忽略不认识的字段，不影响播放。
* 索引写在**单独的 `extra.json`**，不碰公开仓库跟踪的 `index.json`；深潜录像本身也被 `.gitignore`
  排除（`public/dev/recordings/dive-d*.json`、`extra.json`）—— 它们属于深潜独占内容，不进公开仓库。
  `render-demo` 会在读完 `index.json` 之后再追加 `extra.json`，文件不存在就是空数组。

### `tools/capture-video.mjs`

用无头 Edge 把 `render-demo` 的某一段**逐帧**截下来，再交给 ffmpeg 编码。

```bash
node tools/capture-video.mjs --scene dive-d16 --from 6 --to 10 --fps 30 \
     --width 1920 --height 1080 --out .cache/video/s2
```

| 参数 | 说明 |
|---|---|
| `--scene` | 录像名（深潜的在 `public/dev/recordings/extra.json`，原版的在 `index.json`） |
| `--from` / `--to` | 秒 |
| `--fps` | 默认 30；60 也行，只是慢一倍 |
| `--width` / `--height` | 默认 1920×1080；草稿建议 1280×720 |
| `--cam` | 机位，等同 `render-demo.html?cam=`（`normal` / `boss` / `prep` …） |
| `--panel 0` | 隐藏调试面板（默认就是 0，出片必须 0） |
| `--port` | 调试端口，默认 9333 |

**为什么逐帧而不是录屏**：录屏拿到的是「实时播放的屏幕」——帧率随机器波动、会掉帧、有压缩伪影，
而且同一段素材每次导出都不一样。逐帧是**可复现**的：同一个 seed、同一段录像、同一个时间点，
每次导出都是同一帧。

**速度**：这台机器没有 GPU 直通，走 SwiftShader 软渲染，大约 **1 帧/秒**。
10 秒 1080p ≈ 5 分钟。草稿用 `--width 1280 --height 720 --fps 15` 会快 4 倍。

### 前置条件

| 需要 | 说明 |
|---|---|
| `public/assets` | 34k 个素材文件，不在 git 里。开发机可以 junction 到某个节点：`cmd /c mklink /J repo-sync\public\assets <部署根>\node-1\public\assets` |
| 本地服务 | `PORT=3999 HOST=127.0.0.1 node server/index.js`（`capture-video` 默认连 `http://127.0.0.1:3999`） |
| ffmpeg | 脚本会依次找 PATH、`D:\ffmpeg\ffmpeg.exe`、`.cache/ffmpeg.exe`；也可以用 `--ffmpeg <路径>` 指定 |
| Edge | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`（版本目录里的那份也行） |

> ⚠ **拍完把 junction 删掉再跑测试**。`public/assets` 一出现，`test/render/*.test.js` 会多出 13 条失败
> （「清单里的文件在不在磁盘上」这类检查会因为多出来的素材而改变判定）。删掉 junction 就回到基线
> 1118 / 1083 / 10：`Remove-Item repo-sync\public\assets -Force`（只删链接，不动目标）。

> ⚠ **不要用 `puppeteer.launch`**：这台机器上已经有一个 Edge 在跑（SessionId 2），
> 直接 launch 会失败（`Failed to launch the browser process: Code: 0`，stderr 还是空的）。
> `capture-video` 改成**自己起浏览器 + CDP 连上去**（独立 `--user-data-dir` + 固定 `--remote-debugging-port`），
> 稳定得多。

---

## 已录制素材

| 文件 | 深度 | 时长 | 峰值单位 | 词条 |
|---|---|---|---|---|
| `dive-d16.json` | 16 | 42 s | 39 | 巨躯·硬化·疾冲（3 条） |
| `dive-d20.json` | 20 | 42 s | 30 | 刚体·冲刺·再生（3 条） |
| `dive-d30.json` | 30 | 42 s | 20 | 易怒·护符·坚固·愤怒（4 条） |
| `dive-d71.json` | 71 | 42 s | 21 | 硬壳·怨怒·迟钝·坚韧·凶暴·巨人·再生（7 条） |
| `dive-d120.json` | 120 | 42 s | 38 | 12 条（迟缓·狂怒·坚韧·护盾·巨兽·每防·暴戾·敏手·凶暴·自愈·滞缓·巨躯） |

**选层经验**（实测扫过 16–120 层）：16 / 20 层打得出击杀（6/40、5/29），画面有来有回；
24 层往上基本是「敌人推到你脸上」——难，但**画面上没有交战感**，宣传片不要用。
30 层勉强能用（有 4 条词条、有精英）；71 / 120 层适合当「压迫感」镜头，不适合当「战斗」镜头。

## 已出样片

`.cache/video/d16-1080/dive-d16.mp4` —— 深度 16 层，4–14 秒，**1920×1080 / 30 fps / H.264 / 5.3 MB**。
这条是流水线跑通的证明（300 帧用了 290 秒），按上面的分镜再跑三段就能成片。
