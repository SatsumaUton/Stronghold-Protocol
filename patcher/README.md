# 补丁包（patcher）

这里保存**本服相对上游的全部改动**，以及一键还原/重打脚本。上游升级时靠它把功能原样装回去。

## ⚠ 2026-10-26 补齐说明

此前这份 README 写着「涉及的游戏文件只有两个」——那是补丁体系刚建立时的状态。
之后功能不断扩张，补丁没有跟着更新，一度有 **138 个功能代码文件**（5–20 人大厅、
并发草稿、悬赏计时、跳过按钮、联防分段、重连窗口、恢复对局、代号规则等）**不在任何补丁里**，
上游升级时会全部丢失。

现已全部补齐，当前覆盖 **312 个文件 / 200 个运行时改动，未覆盖 0**。

## 怎么确认没有遗漏

```bash
node patcher/check-coverage.mjs          # 有遗漏则退出码 1
node patcher/check-coverage.mjs --list   # 列出全部文件
```

它把「当前代码相对 upstream/master 的所有改动」与「patcher/features 的覆盖集合」逐文件对比。
**每次加完功能请跑一次**；上游升级前更要跑。

不纳入补丁管理的路径（脚本里已内置）：`public/vendor/`（第三方库，上游整包替换）、
`test/`、`tools/`、`schemas/`、`packs/`、`nginx/`（部署配置，见 `deploy/nginx.conf`）、
`package*.json`、图片资源、以及上游 `.gitignore` 明令禁止提交的 `matchmaker/public/admin.html`。

## 目录

```
patcher\
├─ features\                每个功能一个目录
│  └─ <feature>\
│     ├─ base\<path>        上游原版（来自 upstream/master）
│     └─ files\<path>       我们的版本
├─ features.json            功能清单与说明
├─ orig\                    早期锚点补丁的官方原版
├─ apply.mjs                锚点补丁（幂等插入）
├─ restore.mjs              还原为官方原版
└─ check-coverage.mjs       补丁完整性检查
```

### 功能分组（features/）

| feature | 内容 |
|---|---|
| `game-core-match` | 对局核心：5–20 人大厅、并发草稿、悬赏/盟约、跳过、联防分段、视图下发 |
| `game-core-server` | 服务端本体：连接/会话、重连窗口、持久化、HTTP 路由、模拟数据 |
| `game-core-shared` | 前后端共享常量与规则 |
| `game-core-client-core` | 客户端核心：启动、连接、资源、音频、状态存储 |
| `game-core-client-ui` | 客户端 UI 组件 |
| `game-core-client-screens` | 客户端界面 |
| `game-core-client-render` | 客户端渲染 |
| `game-core-client-style` | 客户端样式 |
| `game-core-data` | 数据与开关（房间 TTL、建房限制） |
| `server-idle-guard` | 挂机踢人、同 IP 建房与 AI 上限 |
| `server-snapshot-checkpoint` | 房间/对局快照与 Redis 检查点 |
| `server-player-capacity` | 5–20 人容量与实验选项 |
| `matching-party` | 组队匹配、跨节点转房 |
| `account-and-dashboard` | 账号登录 / 管理后台 |
| `client-*` 系列 | 公告、观战、游客建房、表情弹幕、资源缓存、商店布局、皮肤导入 |
| `deployment` | nginx、PM2、watchdog |

## 本服新增功能登记表（改代码后请对照更新）

> **这是防止「下次又忘记」的核心表。** 每加一个本服独有功能，就在下面加一行，
> 写清它动到的文件与所属补丁 —— 上游升级后按这张表逐项验收，缺哪个补哪个。
>
> 维护规则：**改了表里任何一行的文件，同一提交里把这张表对应的说明也更新掉。**
> 新增功能漏登记时，`check-coverage.mjs` 只能保证「文件进了补丁」，
> 但**不能**保证「下次升级时有人记得验收它」—— 这一步只能靠这张表。

### 深渊回响的独立性（2026-11-06）

**要求（维护者）：原版更新不许让深渊回响失效。**

上游更新走 `restore → 升级 → apply.mjs`（服务端锚点）与 `merge-features.py`（功能快照三方合并）：
官方文件是**整文件覆盖**的，只有 `patcher/features/<id>/files/` 的快照能把我们的改动救回来。
所以「深潜会不会被原版更新搞坏」=「带深潜逻辑的文件有没有最新快照 + 有没有在两张表里登记」。

这条不变量由 **`node patcher/check-deepecho.mjs`** 守住，并且是 `npm test` 的一部分
（`test/patcher/deepecho-isolation.test.js`）：

| 检查 | 说明 |
|---|---|
| 文件清单不靠人记 | 扫描 `server/ public/ shared/ matchmaker/ dashboard/ data/ content/ mm/` 里所有出现 `deepecho` / `echoVariant` / `echoBlessing` / `echoPhase` / `echoCurse` / `深渊回响` / `深潜` 等标记的运行文件（当前 **96** 个） |
| 快照逐字节一致 | 每个文件都要在 `patcher/features/deepecho/files/` 里有一份**和仓库完全相同**的副本；过期 = 上游一升级就回退到旧版本 |
| `features.json` 登记 | 有 `deepecho` 项（状态 `ported`、文件清单、验收项），升级清单里才有人知道要移植 |
| `index.json` 登记 | **关键**：`merge-features.py` 只读 `patcher/features/index.json`；缺项 = 合并阶段整份功能被忽略 |
| 测试齐全 | 18 个深潜测试文件必须存在（升级后按这份清单重跑） |

```bash
node patcher/check-deepecho.mjs          # 检查（有问题退出码 1）
node patcher/check-deepecho.mjs --list   # 打印完整清单
node patcher/check-deepecho.mjs --fix    # 把漂移/缺失的文件补进快照，并同步 index.json
```

**每次改完深潜代码（哪怕只改一行）都要跑一次 `--fix` 再提交**，否则下次上游更新会把它吞掉。
负向验证过：把 `echoPhase.js` 的快照改坏一个字节，守卫立刻报「快照过期: 1」并退出码 1。

> 深潜没有 `base/` 副本，`merge-features.py` 对它走 `no-base-keep-ours`：**整份保留我们的版本**。
> 这正是「原版更新不影响深潜」想要的效果；代价是这些文件里上游的新改动不会自动合并进来 ——
> 升级后需要人工看一眼上游是否在这些文件里改了与深潜无关的东西。

### 玩法与对局

| 功能 | 涉及文件 | 所属补丁 | 生效方式 |
|---|---|---|---|
| **游戏内管理员工具**（2026-10-31）<br>在对局中点击左上角「节点状态」胶囊（`📊 汐斯塔 · 正常`），打开刷干员 / 装备 / 盟约 / 策略 / 数值 / 阶段 / 商店 / 机变 / 召唤物的面板。**权限（两道门，缺一不可）**：① 身份门 `session.adminId` = 账号 `role in (owner,admin)`；② 验码门 `session.adminTool` = 持有**只在管理后台生成**的一次性验证码换来的令牌（`typ=admin`）。服务端每次 hello 重算并通过 `welcome` 下发 `adminId` / `adminCode` / `adminTools`，普通玩家三者皆 false。**退出授权**走 `POST /api/admintool/revoke` 写吊销时间点，节点比对 `iat` 拒绝旧令牌。**二次确认**：全局类（`phase`/`round`/`timers`/`shop`）与他人座位类（`teamLp`、指定别人 uid 的 `token`）必须点确认，自身类不打断；面板顶部可选「免确认」，勾上时显示橙色警示并可一键恢复。**验证码**：后台「生成游戏内验证码」出 6 位码，10 分钟有效，兑换后得 4 小时 adminToken。 | `server/net.js`（下发 `welcome.adminTools`）<br>`server/lobby.js`（`g.test` 对 `session.admin` 放行；座位映射带 `admin`）<br>`server/match/PlayerState.js`（`this.admin`）<br>`server/match/match/testCommands.js`（`ps.admin` 放行）<br>`server/match/Match.js`（管理员座位时初始化计量/审计状态）<br>`public/js/store.js`（`adminTools` 初始字段）<br>`public/js/main.js`（`onWelcome` 赋值）<br>`public/js/ui/hud.js`（延迟胶囊开面板）<br>`public/js/ui/adminTools.js`（面板本体 + 二次确认）<br>`public/css/screens/game.css`（`.admintools*`）<br>`matchmaker/account.cjs`（`tools.game` 权限、`/api/admin2/tool-code`、`/api/admintool/exchange`）<br>`matchmaker/public/admin.html`（生成按钮、权限预设、危险权限红框） | `server` / `game-core-client-ui` / `game-core-client-style` / `matchmaker` | 刷新页面 + 重启节点 + 重启 matchmaker |
| **深渊回响（无尽深潜）**（2026-11-03）<br>第三模式：`mode: 'coop'` + `variant: 'deepecho'`，不新增 mode 值。打完玩家实际到达的最后一个 boss（R15/16）不进结算，转入**无尽深潜**：只有团灭才结束（`ECHO_SAFE_ROUND=999` 只防爆），深度即成绩。数值两段：R15–R30 血×1.2/攻×1.1，**R31 起 ×1.10/×1.05 永不见顶**（原 120× 硬封顶已取消）。结构难度：词条上限 3→8 随深度、精英每 3 层（R30 后 2 只、R60 后 3 只、位置随机）。波次：1–15 层 = 原版该回合的波次形状 × `ECHO_EARLY_GROWTH`；**每一层都从模板库**（原版 1..13 回合各做一批配比变体）里随机抽一套，怪种永远取自原版某一关；**16 层以后只数由深度设计**（`echoDeepWaveShape`：110 × 1.2^轮 × 轮内爬升，硬顶 `ECHO_MAX_UNITS = 160`，时限固定成最后一关的时长），不再跟着数据回合的只数走（旧实现在深度 16 会从 112 只掉到 14 只）。boss 返场固定 R20/25/30/35…；悬赏 R18/23/28…（避开 boss 层，目标从本回合已生成波次现抽，赏金 `clamp(round(最大生命×数量/15000×(1+0.15×深度)),1,8)`）；祝福每 5 层三选一（资金+40 / `batPct:-0.1` / 金币×1.2）。玩家侧：`disableLayerCap` 默认开；限伤按 `hitLimitMul = 当前hpMul/6.687` 缩放（`sim` 仅加 2 行、缺省 1）。备战阶段服务端**不发明细**，只给 `m.public.echo.intel = { threat, elite, nextNodeRound, nextNodeIn }`。**管理员门禁**：`lobby.create` 只放行 `session.adminId === true`，其余 `TEST_FORBIDDEN` | `server/match/match/echo.js`<br>`server/match/match/echoPhase.js`<br>`server/match/match/echoWords.js`<br>`server/match/match/echoBlessing.js`<br>`server/match/match/echoBounty.js`<br>`server/match/match/echoWaves.js`<br>`server/match/{Match,waves,gamedata,snapshot}.js`<br>`server/match/match/{phases,bossRounds,combat,settle,views,intents}.js`<br>`server/lobby.js`、`server/persist/lobbyState.js`、`shared/protocol.js`<br>`server/sim/attack/health.js`（限伤乘数）<br>`public/js/ui/{enemyDrawer,echoBlessing,echoStatus,gameActions}.js`、`public/js/screens/game.js`<br>`test/match/echo*.test.js` | `deepecho` | 刷新页面 + **重启节点** |
| **深渊回响：主题转化祝福**（2026-11-05）<br>11 条祝福把队伍**附加盟约**的主题转成对敌压制（奥术→术蚀 / 坚守→反震 / 精准→洞穿 / 灵巧→缠足 / 迅捷→迟滞 / 助力→削壁 / 协防→压制 / 奇迹→厄运 / 调和→调律 / 突袭→袭扰 / 绝技→绝境；跳过 远见 / 投资人 / 不屈 / 独行 —— 它们的效果是钱 / 招募 / 复活 / 独狼，转成对敌减益会变成另一条机制）。**不看队伍有没有那条盟约**（维护者 2026-11-05 第二次定：直接进祝福卡池），抽到就生效；字段 bondTheme 只记录主题来源，不参与判定。生效窗口 = 每回合**开局前 N 秒**，N 按稀有度分档（普通 10 / 稀有 15 / 传说 20，`ECHO_BOND_DEBUFF_SECONDS`）。实现只用 sim 已有的异常状态（`battle.applyStatus`）与 `battle.dealDamage` 反伤，`server/sim` 一行未改、golden 未动 | `server/match/match/echoBlessing.js`<br>`server/match/match/echoPhase.js`<br>`test/match/echoBondDebuff.test.js` | `deepecho` | **重启节点** |
| **深渊回响：深潜说法（退出 / 记录）**（2026-11-06）<br>深潜不是「模拟」：退出弹窗标题与放弃按钮「离开深潜 / 放弃深潜」、AI 托管浮层「返回深潜」、协议已失效盘「离开深潜」、暂停盘「放弃深潜」——统一走 `matchChrome.js:exitWords(echo)`（流程一字未改：暂离 = AI 托管，放弃 = `g.leave → room.leave`）。对局记录：**模式**列显示「深渊回响」（纯文字薄荷色，不加框），**难度**列照旧显示真实难度名；深潜记录固定算第二期下半（`variant` 入库）。 | `public/js/ui/matchChrome.js`<br>`public/js/ui/downedPlate.js`<br>`public/js/screens/game/overlays.js`<br>`public/js/screens/stats.js`<br>`public/css/screens/stats.css`<br>`public/i18n/en.json` | `deepecho` | 刷新页面 |
| **深渊回响：房间接入控制台 / 管理后台**（2026-11-06）<br>深潜房原本**完全不上报**给匹配服务（隔离：不进跨节点公开同盟列表、不被匹配器选中、不参与按房间码跳转），代价是节点控制台与管理后台的房间列表里永远看不见它们。现在节点把深潜房单独放进 `echoCodes` 上报，匹配服务只把它用于**房间目录**（`content/rooms.json` + 后台 `/api/admin2/rooms`），不并进 `codes` —— 隔离与跳转行为一字未变（`matchmaker/roomDir.cjs:dirCodes()` 是纯函数，单测钉住）。`roomInfo()` 带出 `variant`，两个界面的**类型列**显示紫色「深渊回响」角标（与玩家端深潜界面同色 `#b79cff`），统计行分列「单人 / 同盟 / 深渊回响」，深潜房的回合 tooltip 与「结束对局」确认文案说「第 N 层」。 | `server/lobby.js`<br>`matchmaker/server.js`<br>`matchmaker/account.cjs`<br>`matchmaker/roomDir.cjs`<br>`matchmaker/public/admin.html`<br>`dashboard/public/app.js`<br>`dashboard/public/index.html`<br>`test/match/echo-room-dir.test.js` | `deepecho` / `matching-party` / `account-and-dashboard` | **重启节点** + 重启 matchmaker + 重启 dashboard |
| **深渊回响：重启断点续玩**（2026-11-06）<br>节点重启后深潜局**接着潜**，不再被丢弃（以前玩家看到「服务器重启导致对局中断，同盟已返回等待室」）。根因两层：① `lobbyState.js` 的 `roomDoc` 会写 `variant`，但读档的 `roomFrom` / `fallbackRoom` **从来不读回来** → 恢复出的房间 variant = null；② `persister.restoreLocal` 的 `startMatch(…, {restore})` 只在 `room.variant` 存在时才把 `variant` 传进 Match 的 opts，于是新 Match 不装深潜缩放（`gd.echoScaleOf`）、不强制独立卡池 → 卡池组数与检查点对不上 → `checkpoint refused (pool groups)` → `abortRestoredMatch`。修法：读档恢复 `variant` + 新增 `echoCfg`（房间级调参，一起存/一起读）；`canSnapshot` 在深潜决策面板开着时**拒绝存档**（准备倒计时被按住、剩余时长不存档，存了读回来准备 0 秒且面板丢失）。 | `server/persist/lobbyState.js`<br>`server/match/snapshot.js`<br>`test/persist/echo-resume.test.js`<br>`test/match/harness.js`（`settleEchoPanels`） | `deepecho` | **重启节点** |
| **深渊回响：匹配队列接入后台 / 控制台**（2026-11-06）<br>深潜有了**自己的匹配池**：`variant` 成为池子的第四个维度（难度 / 版本 / 人数之外），深潜队伍只会和深潜队伍成局（`formPartyMatches` 的分组键与等待筛选都带 variant；`waitingPartyPlayers` 同样）。入队的 variant 以**房间文档**为准（客户端上报只作兜底），成局结果也带 variant，房主据此 `room.create { variant:'deepecho' }`（URL `?pv=deepecho`）。`/api/stats` 每个难度多一档 `byVariant`（`null` = 普通池，`deepecho` = 深潜池），管理后台与节点控制台的「匹配队列」各显示一枚紫色「深渊回响 N 人 · M 局」标签。匹配队友的搜寻面板：深潜房把「标准规则」换成紫色「深渊回响」；房间里的「正在等人」条也显示深渊回响，提示语改成「其他博士在深潜房里点『匹配队友』就会被配到一起」。 | `matchmaker/server.js`<br>`matchmaker/public/client.js`<br>`matchmaker/public/admin.html`（不入库，仅部署）<br>`dashboard/public/app.js`<br>`dashboard/public/index.html`<br>`public/js/screens/room.js`<br>`public/css/screens/room.css`<br>`public/i18n/en.json`<br>`test/match/echo-queue.test.js` | `deepecho` / `matching-party` / `account-and-dashboard` | 刷新页面 + 重启 matchmaker + 重启 dashboard |
| **深渊回响：公开深潜 / 开始多人匹配**（2026-11-06）<br>深潜整屏（`EchoSelect`）在「开始深渊回响」下面补两个按钮，和大厅同盟模拟对齐：**公开深潜** = 建房后立刻 `room.setListed { listed:true }`（`roomOpen` / `setListed` 不再硬拒 deepecho；公开列表行带 `variant`，界面显示成「深渊回响」，跨节点 `/api/rooms/open` 也带 variant）；**开始多人匹配** = 进**深潜自己的**匹配池（`room.quickMatch` 的 `variant` 维度：候选房按 variant 过滤、排队票据池键多一维、成局时 `create({ variant })` 建深潜房）。协议 `room.quickMatch` 接受可选 `variant`。**进房仍是管理员 / 测试名单专属**（`ECHO_FORBIDDEN` 不动）。 | `server/lobby.js`<br>`shared/protocol.js`<br>`matchmaker/openRooms.cjs`<br>`public/js/screens/lobby.js`<br>`public/js/ui/roomList.js`<br>`public/css/screens/lobby.css`<br>`public/i18n/en.json`<br>`test/match/echo-public-queue.test.js` | `deepecho` / `matching-party` | 刷新页面 + **重启节点** + 重启 matchmaker |
| **深渊回响：公开深潜列表（专属）**（2026-11-06）<br>深潜有了**自己的**公开列表，和普通「公开同盟」完全分开：`room.list` 接受可选 `variant`（`deepecho` = 只列深潜房；不带 = 普通同盟，且**不再混进深潜房**），跨节点 `/mm/api/rooms/open?variant=deepecho` 同理（`collectOpenRooms(perNode, { variant })`，两份列表各自缓存）。大厅「深渊回响」整屏的**公开深潜**按钮打开这份列表（标题「公开深潜 / OPEN DEEP DIVES」、加入按钮「加入深潜」、空态「暂时没有公开的深渊回响房」），列表里可以「开一间公开的」（建房 + `setListed`）。房间设置里同一个开关在深潜房显示成「公开深潜：已公开 / 未公开」。进房仍是管理员 / 测试名单专属。 | `server/lobby.js`<br>`shared/protocol.js`<br>`matchmaker/server.js`<br>`matchmaker/openRooms.cjs`<br>`public/js/ui/roomList.js`<br>`public/js/screens/lobby.js`<br>`public/js/screens/room.js`<br>`public/i18n/en.json`<br>`test/match/echo-public-list.test.js` | `deepecho` / `matching-party` | 刷新页面 + **重启节点** + 重启 matchmaker |
| 5–20 人同盟（容量实验） | `server/match/Match.js`、`server/match/match/phases.js`、`shared/playerCapacity.js`、`shared/experimental.js`、`public/js/screens/room.js`<br>**结算显示（2026-10-27）**：`public/js/ui/stats.js`（`MAX_PLAYERS` 取 `MAX_PLAYER_CAPACITY`，原本写死 6 → 记录被截断）、`public/js/screens/settle.js`（`staggerOf`：5–20 张同盟卡片的入场步长，原本 `Math.min(i,7)` 让第 8 张之后同时出现）、`public/css/screens/settle.css`（`.tcard` 动画改用 `var(--step)`） | `server-player-capacity` / `game-core-client-ui` / `game-core-client-style` | 刷新页面 + 重启节点 |
| 并发草稿（仅 allowRepeat 时） | `server/match/Match.js:concurrentDraft()`、`server/match/match/phases.js`<br>**提示文案（2026-10-30）**：`public/js/screens/bandDraft.js:draftTip()` 按 `concurrent` 分支——并发草稿里**没有跳过**（`phases.js:298` 直接拒），超时也**不固定给华法琳**（`taken` 置空后 `autoPickBand` 优先当前高亮），旧提示两件事都写，属于说不得的承诺 | `game-core-match` / `game-core-client-screens` / `game-core-client-ui` | 刷新页面（`bandDraft.js` + i18n） |
| **容量实验跨 worker 转发**（5 人以上房在内容插件 host 下开不了局） | `server/match/host/proxy.js:wireOptions()` —— 白名单里有 `seats` 却漏了 `experimental`，worker 侧 `playerCapacity` 丢失回落到 4 座，第 5 个座位抛 `RangeError: seats exceed room capacity`（生产 2026-10-26～30 累计 481 次） | `server-player-capacity` | **重启节点** |
| 悬赏决策公共计时 | `server/match/match/spDraft.js:_concurrentSpStep()` | `game-core-match` | 重启节点 |
| 跳过按钮（仅非 allowRepeat） | `public/js/match/matchChrome.js:StepHeader`、`server/match/match/phases.js` | `game-core-match` | 刷新页面 + 重启节点 |
| **鸭爵策略可叠加**（实验开关） | `server/sim/content/bands/meta.js:duckGlobal`、`server/match/Match.js`、`server/match/gamedata.js`、`server/match/snapshot.js`、`shared/experimental.js`、`public/js/screens/room.js` | `game-core-server` / `server-snapshot-checkpoint` / `server-player-capacity` | **重启节点** |
| **叠加时「补抽」**（撞到已选敌人时改抽别的目标，而不是跳过；20 人大波次覆盖率 13.6→19.5 个） | `server/sim/content/bands/meta.js:duckPicks`（`exclude` 参数）+ `duckGlobal`（`taken` 传入） | `game-core-server` | **重启节点** |
| **build 指纹与机器无关**：30 个节点算出同一个 build，玩家跨节点不再莫名刷新 | `server/http/buildTag.js`（`LOCAL_RUNTIME_FILES` 排除各机配置 + 备份文件排除）、`deploy/sync-nodes.cjs`（复制时保留 mtime）、`deploy/sync-mtime.cjs` | `game-core-server` | **重启节点** |
| 禁用鸭爵策略（5–20 人） | `server/match/gamedata.js`、`shared/experimental.js`、`public/js/screens/bandDraft.js` | `server-player-capacity` | 刷新页面 + 重启节点 |
| **联防救援（队友复活）**：被淘汰的博士在 15 秒窗口内由合格队友支付 10 点生命救回；每局每人最多被救一次 | `shared/protocol.js`（**`C2S` 的 `g.revive` 白名单**）、`server/match/Match.js:revive/revivalWindowOpen/revivalDonorEligible`、`server/match/match/intents.js`、`server/match/match/common.js`、`public/js/ui/revival.js`、`shared/experimental.js` | `server-player-capacity`（客户端 UI 在 `game-core-client-ui`） | **重启节点** |
| **挂机移出（消极游戏）**（2026-11-02 移植参考版）：每回合**备战结束**时数一次，连续 `afkRemoveRounds`（默认 2，`0` = 关）回合没有任何**实质操作**就移出。实质操作 = `shared` 无关的 `common.js:AFK_ACTIONS` 白名单 13 条（买/卖/移动/刷新/升级/冻结/装备/销毁/选择/领奖/复活/选盟约/跳过盟约）；点准备、发表情、观战都**不算**。**三条豁免**：`!ps.connected`（**掉线不算挂机** —— 原来那版没这一条，网断的人会被当挂机踢掉）、`ps.botControlled`（AI 托管）、`ps.afkActed`。移出**前一回合先警告**一次。单人局（含一真人+三 AI）完全不判定；中途退到只剩一人也不再判定（实时数 `_humanCount()`，不用建局快照）。我们原有的两条更严规则（「只花钱不部署」「什么都不做」）保留，只补上掉线豁免 —— 参考版那条抓不到「只买不部署」（`g.buy` 本身在白名单里）。`_checkIdle` 必须排在 `_checkpoint('prep-end')` **之后**，否则断点续玩恢复时会重复判定。移出沿用 `onIdleKick → lobby.kickIdle → removeMember`（有踢出记录、被踢的人加不回来），不需要参考版的 `m.removed`/`m.notice afkRemoved` 消息 | `server/match/match/common.js`（`AFK_ACTIONS` / `AFK_REMOVE_ROUNDS`）<br>`server/match/match/platform.js`（`_checkIdle` / `_removeIdle`）<br>`server/match/match/prep.js`（`endPrep` 调用点）<br>`server/match/match/intents.js`（`afkActed` + 掉线豁免）<br>`server/match/Match.js`（`afkRemoveRounds`）<br>`server/match/PlayerState.js`（`afkActed` / `afkRounds`） | `server-idle-guard` | **重启节点** |
| **预约盟约（预选盟约）**（2026-11-02 移植参考版）：开局声明「这一局我打算走哪个核心盟约」，下发给 `m.public` 的 `players[].bondPlan`，队友和观战者整局都看得见。**纯沟通功能** —— 没有任何规则、AI、计时或挂机判定读它。可预约的盟约 = **所有核心盟约**（`bonds.json` 的 `isCore === true`）：第二期 8 个、第一期 6 个，**按版本切换**（`plannableBondIds()` 读的是当前 `GameData` 的盟约表，不是全局常量；客户端同样从 `gd.list('bonds')` 现算）。可选相位与服务端一致：`INFO_CHECK` / 选策略 / 战前确认，以及第 1 回合到它的战斗之前（`bondPlanOpen()`），之后 `WRONG_PHASE`。非法盟约 `BAD_TARGET`，省略/`null` 清空，重复同一个返回 `ok` 但不重新广播（不 `markPublic`）。**本局禁用的盟约仍然可选**，只标「本局禁用」—— 预约是沟通，不是规则。`bondPlan` 在 `snapshot.js` 的 `PLAYER_FIELDS.saved` 里本来就有，所以断点续玩不会丢。**注意**：`shared/protocol.js` 必须登记 `g.bondPlan`，否则 `net.js` 在客户端就拦掉（与 `room.setBotBand` 同一个坑） | `server/match/gamedata.js`（`plannableBondIds` / `bondPlannable`）<br>`server/match/PlayerState.js`（`bondPlan`）<br>`server/match/match/intents.js`（`planBond` / `bondPlanOpen`）<br>`server/match/match/views.js`（`players[].bondPlan`）<br>`shared/protocol.js`（**`C2S` 的 `g.bondPlan` 白名单**）<br>`public/js/ui/bondPlan.js`（`plannableBonds` / `BondPlanTag` / `BondPlanPicker`）<br>`public/js/screens/bandDraft.js`（席位行标记 + 「预选盟约」入口）<br>`public/css/screens/game-panels.css`（`.bplan*`） | `game-core-match` / `game-core-server` / `game-core-shared` / `game-core-client-ui` / `game-core-client-screens` / `game-core-client-style` / `client-i18n` | 刷新页面 + **重启节点** |
| **公开同盟（同盟列表）**（2026-11-02 移植参考版）：房主可以把合作房挂到大厅的「公开同盟」列表上，别的博士在大厅点「公开同盟」就能看见并直接加入。**上架判据**全在服务端 `listable()` / `roomOpen()`：合作房、非测试房、无玩法插件、容量 ≥ `ROOM_LIST_MIN_CAPACITY`（= `MAX_SEATS` 4，本服所有合作房都够）、还没开局、房主在线、房间队列空闲。`room.list` 只回真正在等人的房，答复 `{ rooms: [{ code, host, humans, filled, capacity, difficulty, version? }] }`，**不含 playerId / 地址 / 座位明细**，按空位升序（`ROOM_LIST_CACHE_MS` 内共用一次扫描）。建房后进房会问一次「要不要公开」（`sessionStorage` 带过去，`takeListPrompt` 取走自毁），房间里也有常驻开关（`room-opt-listed`）。**2026-11-02 修**：① 点「公开同盟」曾经直接跳回大厅 —— `onBrowse` 里顺手 `setAllyOpen(false)` 把同盟模拟也关了，现在列表**叠在**同盟模拟上（`browseOpen && allyOpen`）；② 「公开同盟」按钮曾**完全不渲染** —— 解释性 `//` 注释写在了 `<${AllianceSelect} … />` 标签**内部**，htm 把它当属性名，后面的 `onBrowse` 整条被吃掉且不报错（`test/ui/htm-tag-comments.test.js` 守住这一类）<br>**2026-11-02 跨节点**：以前列表只看得见本节点的房 —— 30 个节点是独立进程，`room.list` 查的是各自的 `Lobby.rooms`。现在：① `server/persist/lobbyState.js` 把 `listed` / `matchmaking` 写进 Redis 的房间文档（为 false 整条省掉，默认房间存档逐字节不变）；② 匹配服务新增 `GET /api/rooms/open`，按节点 `HGETALL sp:n<node>:lobby:rooms` 汇总「挂了公开 + 没开局 + 有空位」的房，每条带 `node`，筛选规则在 `matchmaker/openRooms.cjs`（纯函数，`test/match/open-rooms.test.js` 10 条），缓存 3 秒；③ `RoomListDialog` 并发问 `room.list` 与 `/mm/api/rooms/open`，按房间码去重（本节点优先），跨节点的行显示节点号；④ 点「加入同盟」时本节点直接 `room.join`，别的节点用 nginx 的 `?n=<node>&room=<code>` 换过去，落地由既有 `?room=` 深链自动加入；⑤ `joinKnown` 遇到 `ROOM_NOT_FOUND` 会问 `/mm/api/find-room`（已补 Redis 回退，刚建好的房也能查到）再跳一次，`sessionStorage` 防来回跳；⑥ `ui/stickyNode.js` 正式导出 `currentNode()` 读 nginx 的 `sp_node` cookie 判断「是不是别人的节点」。**注意：换节点必然是一次页面加载**，但落地即进房（`entering` 路由），不再经过大厅 | `server/lobby.js`（`listable` / `roomOpen` / `setListed` / `roomList`）<br>`server/persist/lobbyState.js`（`listed` / `matchmaking`）<br>`matchmaker/server.js`（`/api/rooms/open`、`/api/find-room` Redis 回退）<br>`matchmaker/openRooms.cjs`（筛选规则）<br>`public/js/ui/stickyNode.js`（`currentNode`）<br>`shared/protocol.js`（`room.setListed` / `room.list`）<br>`public/js/ui/roomList.js`（`RoomListDialog` / `ListPromptDialog`）<br>`public/js/screens/lobby.js`（`.ally-pill` 公开同盟 + 叠层逻辑）<br>`public/js/screens/room.js`（`room-opt-listed`）<br>`public/js/screens/entering.js`（「正在进入同盟…」整屏等待态）<br>`public/js/store.js`（`selectRoute` 的 `entering` 分支）<br>`shared/public/css/screens/lobby.css`（`.ally-links` / `.ally-pill`） | `game-core-server` / `game-core-shared` / `game-core-client-ui` / `game-core-client-screens` / `game-core-client-style` | 刷新页面 + **重启节点** |
| **多人匹配（匹配队友）**（2026-11-02 移植参考版，2026-11-02 改为整屏 + 范围）：大厅「多人匹配」入口与「同盟模拟」里的胶囊都进**同一块整屏**（`MatchmakingSelect`，标题「同盟集结 / PUBLIC MATCHMAKING」）：左边是所选难度画面，右边是难度卡（**和独立模拟同一套 `DifficultyCard` + `.proto-list`，尺寸完全一致**）、人数/规则两组开关、匹配说明、`开始多人匹配`。**范围**照参考版 `MatchScope` 移植：人数 `four`（标准 4 人同盟）/ `multi`（5–20 人，取 `PLAYER_CAPACITIES` 里第一个 > `MAX_SEATS` 的档，本服是 8，常量 `MULTI_SEAT_DEFAULT`）、规则 `standard` / `experimental`（判据必须是 `experimentalRuleChanged()`，**不能**只看 `!!room.experimental` —— 4 人房也带 `playerCapacity`，那样标准规则会永远匹配不到人）。按下去先显示「搜寻中」（`MatchQueue`），再发 `room.quickMatch`。服务端 `quickMatch(session, { difficulty, seats, rules })`：`seats` / `rules` 各取 `four|multi|both`、`standard|experimental|both`，用于**筛选候选房**；`seats: multi` 且不含 `four` 时自己开房要用 `experimentalOptions({ ...EXPERIMENTAL_DEFAULTS, playerCapacity })` 规范化（`isExperimental` 要求至少两个键）。开局由既有机制负责：匹配**超时**（`MATCHMAKING_TIMEOUT_MS`）或**人满即开**（`freeSeat() < 0` 且真人 ≥ 2；`forceStartMatchmaking` 会把真人全标 ready 再 `startMatch`，所以凑满即**无缝进对局**，不需要房主再点开始；对局结束后人仍在房间里）。⚠ **不再有房间内的「匹配队友」开关**（维护者 2026-11-02 明确不要），改为房间里显示「正在等人」提示条（`room-matchwait`：还差几人 / 难度 / 几人同盟 / 说明别人点「多人匹配」会被安排进来），小屏隐藏。<br>**2026-11-02 matchmaker**：队列按 `difficulty + capacity + rules` 分池配对；匹配成功后进入**确认入场**（`state: 'confirm'`，30 秒 `ACCEPT_MS`），全员确认才转 `matched`；超时整局作废，已确认者退回队列、未确认者视为放弃。⚠ **跨节点配对仍未接通**（前端还没调用 `/mm/api/join`）：本服 30 个独立节点进程，`quickMatch` 只在本节点匹配；参考版整套共享队列仍只有 matchmaker 里那套票据机制，接回前端是下一步 | `server/lobby.js`（`quickMatch` 的 `seats`/`rules` 筛选、`MULTI_SEAT_DEFAULT`、人满即开）<br>`matchmaker/server.js`（rules 分池 + `ACCEPT_MS` 确认入场）<br>`shared/protocol.js`（`room.quickMatch` 白名单）<br>`public/js/screens/lobby.js`（`MatchmakingSelect` / `MatchScope` / `MatchRules` / `MatchQueue` / `matchScope` / `toggleMatchScope` / `matchScopeRequest`）<br>`public/js/screens/room.js`（`room-matchwait` 提示条；`room-opt-matchmaking` 开关**已移除**）<br>`public/css/screens/lobby.css`（`.proto-scope*` / `.mm-queue*`）<br>`public/css/screens/room.css`（`.rs-matchwait`）<br>`test/match/quick-match.test.js`（16 条）<br>`test/ui/alliance-buttons.test.js`（5 条） | `game-core-server` / `game-core-shared` / `game-core-client-screens` / `game-core-client-style` / `client-i18n` | 刷新页面 + **重启节点**（matchmaker 另需重启） |
| 房间/对局快照与 Redis 检查点 | `server/match/snapshot.js`、`server/persist/*` | `server-snapshot-checkpoint` | 重启节点 |
| **断点续玩真的会续上**（2026-11-02 修复）：节点重启后对局从检查点**恢复**，玩家继续打，不再「返回同盟」。原来 `persister.restore()` 在本地模式下无条件 `abortRestoredMatch()`，而 `restoreLocal()` 按 4 个参数调 `startMatch` 却只收 2 个 —— 是死代码。现在 `startMatch(room, key, keys, { restore })` 用存档的 `seats`/`seed`/`matchNo`，并走 `apply(match)` 而不是 `start()`（后者会重新发钱、重跑回合开始钩子）；恢复失败才回退 abort（保留房间退回等待室，比参考版的 `disposeRoom` 温和）。**四个字段一个都不能省**：`matchNo` 错了 `battlePrefix` 就错，`checkSnapshot` 会报 `refused (seed)`。验证看 `healthz.persistence` 的 `restoredMatches`/`droppedMatches` | `server/lobby.js:startMatch`（`restore` 参数）<br>`server/persist/persister.js:restore`（本地模式先 `restoreLocal`） | `server-snapshot-checkpoint` | 重启节点 |
| **结束对局（保留房间）**：控制台/管理后台单独结束一间房当前这一局，房间、座位、玩家都留着，可立刻重新开局（与「关闭房间」并存） | `server/lobby.js:abortMatch`、`server/http/routes.js:handleAdminRoomAbort`（`POST /admin/room/abort`）、`dashboard/server.js:abortMatch/adminRoomAction`、`dashboard/public/app.js`、`matchmaker/account.cjs`（`POST /api/admin2/rooms/abort`）、`matchmaker/public/admin.html`（**不进仓库**） | `game-core-server` | **重启节点**（`dashboard`/`matchmaker` 重启即生效） |
| **AI 指定策略（指定卡池编组）**（2026-11-02 移植）：房主可以给每个 AI 座位**预先指定**一个策略编组，该 AI 抽卡时直接拿这个编组，别人也不能再选它。服务端 `Match.botBands` 只记 AI 座位（去重 + `gd.bandAllowed` 校验），`bandTaken()` 把已指定但未抽的编组一起算作「已占用」，`views.js` 只在**非 allowRepeat** 时下发 `draft.reserved`；`lobby.js:setBotBand` 落座前会剔除本房关掉的编组（如 `band_ducklord` + `experimental.disableDuckLord` —— `dataFor()` 的 gd 不知道房间的实验项，必须显式判）。客户端房主点座位上的策略徽章弹 `BotBandPicker`；草稿阶段被指定的格子显示「AI 已指定」而不是「已被选择」。**注意**：`bandSeat` 用**座位号**做 key，不能用 playerId（AI 被移除再加回来 playerId 会变）。**2026-11-02 修**：① `shared/protocol.js` 的 `C2S` 表原来**没有 `room.setBotBand`**，客户端 `validateC2S` 直接拦下抛 `BAD_MSG`（玩家看到「无效的请求」），请求连 socket 都没上 —— 加消息时必须三处一起动（协议表 / 服务端分支 / 客户端调用）。② `allowRepeat` 原来对指定 AI 策略无效：服务端 `setBotBand` 与客户端 `BotBandPicker` 都无条件拒绝重复，与 `Match.bandTaken()`（`allowRepeat` 下恒 false）打架；现在两边都用 `roomAllowsRepeatBands()`，判据与 `Match.js` 的 `capacityExperiment = !isSolo && playerCapacity > 4` 逐字一致 | `server/lobby.js`（`setBotBand` / `roomAllowsRepeatBands` / `dropUnofferedBotBands` / 座位视图 `band` / 开局 opts）<br>`shared/protocol.js`（**`C2S` 的 `room.setBotBand` 白名单**）<br>`server/match/Match.js`（`botBands` + 从 `opts.seats[].band` 装载）<br>`server/match/match/phases.js`（`scheduleBandBot` 走指定编组 / `bandTaken` / `reservedBands` / `designatedBand`）<br>`server/match/match/views.js`（`draft.reserved`）<br>`public/js/screens/room.js`（`BotBandChip` / `BotBandPicker`）<br>`public/js/screens/bandDraft.js`（`reservedBands`）<br>`public/css/screens/room.css`（`.seat__band` / `.botband*` / `.rseat__band`） | `game-core-server` / `game-core-match` / `game-core-client-screens` / `game-core-client-style` | 刷新页面 + **重启节点** |

### 连接、恢复与账号

| 功能 | 涉及文件 | 所属补丁 | 生效方式 |
|---|---|---|---|
| 重连窗口 15 分钟（上游 10） | `server/net.js:NET_DEFAULTS.reconnectWindowMs`、`data/room-ttl.json` | `game-core-server` | 重启节点 |
| 掉线恢复：对局中不判终态 | `matchmaker/public/client.js:joinFlow`（startedCode 分支） | `matching-party` | 刷新页面 |
| 恢复对局（仅大厅显示按钮） | `matchmaker/public/client.js:installResumeButton` | `matching-party` | 刷新页面 |
| 账号恢复失败提示（不再误导） | `public/js/ui/accountObserver.js` | `account-and-dashboard` | **重启节点** |
| 同账号同房间接管座位 | `server/lobby.js:room.join` 的 takeover 分支 | `game-core-server` | 重启节点 |
| **回自己房间时先接管、不清房间**（`room.join` 的冲突判定顺序：同房间 → 接管；别的房间 → `dropStaleAccountSeats`） | `server/lobby.js:room.join` | `game-core-server` | 重启节点 |
| **清浏览器数据不再冲掉云端设置**（2026-11-01）：① `ui/loadoutSync.js:installSkinsSync` 的 `prepare(fromEdit)` —— 本机一个皮肤选择都没有时**不推**空 map（除非是玩家自己刚改出来的，`installPrefSync` 的 `edited`），否则 `welcome` 一来就把 `{}` 推给服务端；② `mm/account-title.js:schedulePush` —— 空载荷默认不 PUT，放行 `ownership` / `diy` 这两种「玩家真的能清到一个不剩」的域。事故：2026-11-01 让维护者清缓存排查素材，重登后云端 `skins` 被覆盖成空（111 个干员的选择丢失），`loadout` / `diy` 因为当晚没有再同步才幸存 | `public/js/ui/loadoutSync.js`<br>`matchmaker/public/account-title.js` | `game-core-client-ui` / `matching-party` | 刷新页面 |
| **接管后不再误清房间**（`room.state` 早于 `welcome` 到达时，用 `net.playerIdPending` 跳过身份比对，避免卡「正在进入模拟…」） | `public/js/main.js:onRoomState`、`public/js/net.js`（`_sendHello` / `_onWelcome` / `_onHelloError`） | `account-and-dashboard` | **刷新页面** |
| **恢复对局只能手动点**（去掉全部自动跳转/自动恢复；换设备、刷新、重新打开页面都不再自己跳） | `public/js/ui/accountObserver.js`、`public/js/ui/resumeMatch.js`、`matchmaker/public/client.js`（`installAutoRejoin` / `resumeTick`） | `account-and-dashboard` / `matching-party` | **刷新页面**（client.js 需重启 matchmaker） |
| **被接管的旧标签页回大厅**（不再尝试 `room.spectate` 旁观自己的座位，杜绝「观战席不可用」） | `public/js/ui/accountObserver.js:account.detached` | `account-and-dashboard` | **刷新页面** |
| **5–20 人房不再一次性预加载全场特效**（2026-11-01）：① `render/vfx/library.js:MAX_PARALLEL` 8 → 4 —— 特效文件（prefab / mesh / texture）同时下载的上限；浏览器每域名只开 6 个连接，而 `wiring.begin()` 进战斗时会排一整场的特效（每个干员约 15 个 prefab，4 人房约 59 个、**20 人房约 294 个**），并发 8 会把 6 个连接全占满，同一时刻要下的 `.skel`（单个可达 540 KB）、贴图、语音只能排队；② `render/app.js:PRELOAD_UNITS_MAX = 8` —— 单位数超过 8 时只预加载前 8 个，其余上场时由已有的 `wiring.more()`（spawn 分支）按需补。定位依据：`nginx/logs/assets.log` 里同一秒内 5 个 prefab 一起等 2.2–3.7 s，而服务器磁盘读同样文件只要 0.15 ms、`src` 全是本机直读 | `public/js/render/app.js`<br>`public/js/render/vfx/library.js` | `game-core-client-render` | 刷新页面 |
| **管理员账号异地登录提醒**（2026-10-31）：游戏账号的 `role` 是 `owner`/`admin` 时，登录若命中「新设备」**或**「IP 与这台设备上次登录的不同」，发邮件通知所有 `owner`。普通玩家**完全不写设备表、不发信**。设备指纹与后台登录同一算法（`sha256(ua + "|" + accept-language)`）。实测四种场景：新设备发信 / 同设备同IP不发 / 同设备换IP发信 / 普通玩家不记录 | `matchmaker/account.cjs`（`/api/auth/login` 分支 + `admin_devices` 的 `last_ip`/`last_seen` 两列） | `account-and-dashboard` | **重启 matchmaker** |
| **「你有进行中的对局」提示 + 高亮恢复入口**（2026-10-30，维护者要求）：<br>① **对局中手动刷新** → 静默自动回到对局，**不弹任何提示**（原有行为，不改）<br>② **多标签页 / 换设备接管** → 被夺走的那台不再只说一句 8 秒 toast：写 `sessionStorage['sp.resumeAvailable']`、派发 `sp-resume-available` 事件，大厅里恢复按钮变 `.verchip--urgent` 高亮并显示 `.resume-banner` 常驻引导条<br>③ **标题页** → 登录框上方显示 `.title-resume` 蓝色引导条（标题页已有 `ResumeMatchButton`，故不再显示大厅那条横幅，避免同一件事说两遍）<br>恢复成功（`resume` / `resumeAccount`）后清除标记 | `public/js/ui/accountObserver.js`（`account.detached`）、`public/js/ui/resumeMatch.js`（`urgent` 状态 + `showBanner` + `clearUrgent`）、`public/js/screens/title.js`（`.title-resume` 引导条）、`public/css/components.css`（`.verchip--urgent` / `.resume-banner`）、`public/css/screens/title.css`（`.title-resume`）、`public/i18n/*.json` | `account-and-dashboard` | **刷新页面** |
| **DOCTOR # 显示真实账号 tag** | `server/lobby.js`（`room.state seats[].tag`）、`public/js/screens/room.js:seatNo()` | `game-core-server` / `server-player-capacity` | **重启节点**（前端回退到哈希） |
| **名片立绘跟随账号** | `matchmaker/account.cjs`（DOMAINS + validatePrefPayload + decodePrefPayload）、`matchmaker/public/account-title.js:PREF_MAP.card`、`public/js/ui/seatArt.js` | `account-and-dashboard` / `matching-party` | 重启 matchmaker |
| 账号登录 / 管理后台 | `matchmaker/account.cjs`、`matchmaker/public/admin.html` | `account-and-dashboard` | 重启 matchmaker |
| **反馈板**（玩家提反馈、管理员回复）：页面 `/mm/feedback.html`，后端 `/api/feedback/*` 挂在 **matchmaker**（不是游戏节点）。**两个必须遵守的点**：① 前端所有请求都要写成 `fetch('/mm' + path)` —— nginx 的 `location ^?~ /mm/` 才会转给 `:3090`，少了前缀就打到游戏节点变 404（页面表现是「加载失败，请稍后重试。」）；② 除 Cookie 外还要带 `Authorization: Bearer <localStorage['mm.sid']>`，`account.cjs:currentUser()` 是「Cookie 优先、退回 Bearer」，只发 Cookie 时隐私模式/被拦截就一律 401（页面表现是「未登录」，但游戏里明明登录着）。这两条 2026-11-02 各踩过一次。**③ 新消息提醒（2026-11-02 加）**：`feedback_seen` 表记 `last_seen_id` 水位线；`GET /mm/api/feedback/unread` + `POST /mm/api/feedback/seen` 只有 `role` 为 `owner`/`admin` 能调，普通玩家一律 403；发帖时 `notifyAdmins()` 以 fire-and-forget 发邮件（收件人取 `SP_FEEDBACK_NOTIFY` 或库里所有 owner/admin，失败不影响发帖）。前端 `client.js` 的 `installFeedbackNotify()` 60 秒轮询、红点数字 + 提示条，只在数量从少变多时弹。**④ 入口按钮**在大厅左下角（`installFeedbackEntry()` 注入，标题页/对局中/房间内都不显示），样式照抄游戏本体主按钮 `.btn--primary`（绿实底 + 深字 + 右侧斜纹条），改它**不用重启**（`no-store`，刷新即生效）。详见 `MAINTENANCE.md` §9.11e / §9.11f | `matchmaker/feedback.cjs`<br>`matchmaker/public/feedback.js`<br>`matchmaker/public/feedback.css`<br>`matchmaker/public/feedback.html`<br>`matchmaker/server.js`（`/api/feedback` 挂载）<br>`matchmaker/public/client.js`（入口按钮 + 未读轮询）<br>`matchmaker/account.cjs`（导出 `mail`/`MAIL`） | `matching-party`（`matchmaker/**` 已覆盖） | **重启 matchmaker**（`feedback.cjs`/`account.cjs` 是服务端；`client.js`/`feedback.js` 这类静态文件 `no-store`，刷新即拿新版） |
| **刷新不掉出房间：`onDisconnect` 漏查隐身观战席位**（`roomOf()` 认座位/普通观战/隐身观战三种身份，取 seat 却只查前两种 → 隐身观战者断线时 `seat.connected` 抛 TypeError，`startGrace`/`broadcastState`/`leftHumanLeftAt` 全被跳过，房间状态与真实情况脱节。线上 2026-10-26～30 共 12 节点 31 次）。`startGrace` 定时器里同样的取席方式也一并改（不崩，但隐身观战者过期后永不移除） | `server/lobby.js`（`onDisconnect` 用 `seatOf \|\| watcherOf`、`startGrace` 定时器同） | `game-core-server` / `server-idle-guard` / `client-room-spectator` | **重启节点** |
| **无在线玩家的房间怎么回收**（2026-11-02 改用参考版机制）：`refreshMatchWindows(room)` + `Session.matchHeld`。对局进行中**只要还有一个真人在线**，掉线队友的 `resumeWindowMs` 就拉到 solo 那档（24h）并由 AI 代打；**一旦全员掉线**，窗口退回普通重连窗口（15 min）且**从此刻重新起算**（`matchHeld` 保证只重算一次），到期 `onExpire` → 释放座位 → 对局 `'abandoned'`。调用点只有 3 处：`onDisconnect`、`onHello` 重连、`removeMember`。`sweepOldRooms` 降级为**兜底**，对局房只兜「一个 session 都没有」（重启后从存档恢复）的情况，**且不受 `data/room-ttl.json` 的 `enabled` 影响** —— 以前 `if (forever \|\| ttlOff) continue;` 把对局房的回收一起关了，而线上开关就是 `enabled:false`，导致全员掉线的房间永不回收（node-19 的 DTTW 卡 5.5 小时）。**坑**：时间戳兜底不能写 `Number(room.createdAt) \|\| now`（`now - since` 恒为 0，永不回收）。详见 `MAINTENANCE.md` §9.11c | `server/lobby.js`（`refreshMatchWindows` / `sweepOldRooms`）<br>`server/net.js`（`Session.matchHeld`）<br>`data/room-ttl.json` | `game-core-server` / `game-core-data` | **重启节点** |
| **素材地址改写正则取太早 → 大量图片走外站**（2026-10-30，**立绘/头像「半天不出来」的根因**）：`const REMOTE_ASSET_RE = __spRemoteAssetRe()` 是模块级常量，在模块求值时就算死；而模块常在 `window.__SP__.data`（manifest）就绪**之前**求值（实测 DOMContentLoaded 224ms、data 388ms），那一刻 `assetOrigin` 读不到 → host 为空 → 正则退化成 `^https?:\/\/\/assets\/` → **永远匹配不上**，`localAssetSrc()` 原样返回资源站地址，所有图片走外站（单文件最慢 3.4s）。且不 404、不报错，日志里完全看不出来。改成**每次调用时现算** | `public/js/ui/gameComponents.js`（`localAssetSrc`）、`public/js/assets.js`（`localizeOne`）、`public/js/audio.js`（`externalToProxy`） | `game-core-client-ui` / `game-core-client-core` | **刷新页面** |
| **素材日志带 IP**（排查「小文件也要 3 秒」需要知道是哪些玩家在卡）：`log_format sp_asset` 加 `ip=$remote_addr req=${request_length}B`，插在 `uri=` 之前，行尾格式不变 | `nginx/conf/nginx.conf` | 部署配置（`deploy/nginx.conf`） | `restart-nginx.mjs --apply` |

### 网络与性能

| 功能 | 涉及文件 | 所属补丁 | 生效方式 |
|---|---|---|---|
| **合并轮询 `/api/pulse`** | `matchmaker/server.js`（新端点）、`matchmaker/public/client.js`（refreshPulse / onPulse / getPulse） | `matching-party` / `client-announcement` | **重启 matchmaker**（前端刷新即可） |
| **client.js 版本自检**（matchmaker 改动自动下发） | `matchmaker/server.js:clientBuildTag()`、`matchmaker/public/client.js:checkClientBuild()` | `matching-party` / `client-announcement` | **重启 matchmaker** |
| **nginx 缓存键归一化**（`~hash` 剥离） | `nginx/conf/nginx.conf`（`map $uri $sp_asset_cache_uri` + `proxy_cache_key`） | 部署配置（`deploy/nginx.conf`） | `nginx -s reload` |
| 缓存预热工具 | `tools/warm-cache.mjs` | 不入补丁（运维工具） | 手动运行 |
| 缓存体检/调优工具 | `tools/augment-cdn.mjs` | 不入补丁（运维工具） | 手动运行 |
| 资源本机优先 + 缺失回源 | `nginx/conf/nginx.conf`（`/assets/` + `@assets_origin`）、`public/js/assets.js`、`public/js/assetPack.js` | 部署配置（见 `deploy/nginx.conf`） | `nginx -s reload` |
| `sw.js` 永久 no-cache | `server/http/files.js:cacheControlFor()` | `game-core-server` | **重启节点** |
| 资源站进 nginx 缓存 | `nginx/conf/nginx.conf`（`proxy_cache sp_assets`） | 部署配置 | `nginx -s reload` |

### 界面

| 功能 | 涉及文件 | 所属补丁 | 生效方式 |
|---|---|---|---|
| 公告条 | `matchmaker/public/client.js` | `client-announcement` | 刷新页面 |
| 观战 / 房间旁观 | `public/js/screens/*`、`matchmaker/public/client.js` | `client-room-spectator` / `client-watch` | 刷新页面 |
| 游客建房 | `public/js/screens/lobby.js`、`matchmaker/public/client.js` | `client-guest-create` | 刷新页面 |
| 表情弹幕 | `public/js/ui/*` | `client-emote-danmaku` | 刷新页面 |
| 资源缓存（资源包） | `public/js/assetPack.js`、`public/js/assets.js` | `client-asset-cache` | 刷新页面 |
| 商店布局 | `public/js/screens/shop.js` | `client-shop-layout` | 刷新页面 |
| 皮肤导入/导出 | `public/js/ui/skinIO.js` | `client-skin-io` | 刷新页面 |
| 标题界面 Q群按钮定位 | `matchmaker/public/client.js:2022`、`shared/public/css/screens/title.css` | `matching-party` / `game-core-client-style` | 刷新页面 |
| 版本号右下角对齐 | `shared/public/css/screens/title.css`（`.title-foot__meta`） | `game-core-client-style` | 刷新页面 |
| **房间玩家标签唯一样式源**（控制台 `:3080` 与管理后台 `:3090` 共用，避免各写一份改一边忘一边） | `shared/admin-ui/room-tags.css`（经 `/__admin-ui/room-tags.css` 由两侧 Node 提供；nginx 需有对应转发，见手册 §9.22）、`dashboard/public/index.html`、`matchmaker/public/admin.html`（**不进仓库**） | `admin-ui-shared` | 刷新页面（两侧 Node 都在跑时即可） |

### 部署与运维

| 功能 | 涉及文件 | 所属补丁 | 生效方式 |
|---|---|---|---|
| 多节点同步（**含 `server/`**） | `deploy/sync-nodes.cjs` | 不入补丁（`deploy/` 已进 IGNORE） | 手动运行 |
| 重启旧代码节点 | `tools/_restart-stale.ps1` | 不入补丁 | 手动运行 |
| 重建 nginx 开放列表 | `tools/_set-open-nodes.ps1` | 不入补丁 | 手动运行 |
| **按代码新旧维护开放列表**（每 5 分钟，SP-Open-Nodes） | `tools/sync-open-nodes.ps1`、`nginx/conf/open-nodes.conf`、`nginx/conf/nginx.conf`（`include` 与 `X-SP-Accepts-New`） | 入仓库 | 计划任务自动 reload |
| **结算页「刷新换新版本」提示** | `public/js/ui/nodeCodeHint.js`、`public/js/screens/result.js`、`public/css/screens/result.css`、`public/i18n/*.json` | 入补丁 | 玩家刷新页面 |
| 按节点号手工设开放列表 | `tools/_set-open-nodes.mjs` | 入仓库 | 写 `open-nodes.conf` + reload |
| nginx 配置备份 | `deploy/nginx.conf` | 入仓库 | `nginx -s reload` |
| **一键重启全部节点**（2026-11-02，控制台运维区）<br>`POST /api/ops/restart-all { confirm:true, includeBusy?, dryRun? }`：**默认只重启 `matches = 0` 的节点**，有对局的跳过并在结果里逐台列出；勾「也重启正在对局的节点」才传 `includeBusy:true`，界面会先报出受影响节点与玩家数、再连确认两次。`dryRun:true` 只回报会动谁、绝不重启（界面就是先拿它写确认框，避免用几秒前的状态漏掉刚开局的节点）。真正动手前**逐个再探一次 `matches`**，全部复查通过才 `pm2 startOrReload --only …`；**成功才 `save`**（失败时 save 会固化一个可能不对的进程表），6 秒后再复查一次有没有没起来的。 | `dashboard/server.js:opsRestartAll`、`dashboard/public/app.js`、`dashboard/public/index.html` | `account-and-dashboard` | 重启 dashboard |
| **只有「正开着对局」的人才被 cookie 粘在旧代码节点上**（2026-10-31）<br>`sp_route` 有效期 30 天，老 cookie 会把根本没在对局的人永久锁在跑旧代码的节点上（实测 node-6 早上 5 个新房全是这样进来的）。现在 nginx 多一层判断：cookie 指向的节点 `X-SP-Accepts-New=0`（跑旧代码）时，**只有同时带 `sp_sticky` cookie 且值等于 `sp_route` 的人才准粘住**，其余人改派到随机新代码节点。`sp_sticky` 由前端在对局中写入（`selectRoute === 'game'`）、离开对局立即删除。**只对 HTML 文档生效**，`/healthz`、`/data`、`/js`、WebSocket 一律留在页面那台。 | `public/js/ui/stickyNode.js`（写入/清除 cookie）、`public/js/main.js`（`startStickyNode`）<br>配置侧（不入补丁，部署目录）：`nginx/conf/nginx.conf`（`location /` 里的 `$sp_sticky`/`$sp_final_open`/`$sp_dispatch`）、`deploy/sync-open-nodes.ps1` 生成的 `map $cookie_sp_route $sp_cookie_accepts_new` | `client-watch` | 刷新页面 + reload nginx |

> ⚠ **`sp_sticky` 只能前端写。** nginx 是「看 cookie 做决定」的那一端，它没法自己判断
> 「这个人是不是在打对局」。所以 `ui/stickyNode.js` 的写入时机必须准：**宁可多删不可多留**。
> 另外 `add_header` 的值不能是空串 —— nginx 照样会输出 `Set-Cookie: sp_route=;`，
> 那会把玩家的 cookie 清掉（每打一次 `/healthz` 就把人踢下节点）。

> ⚠ **开放列表的口径：`split_clients` 按「代码新旧」，`map $cookie_sp_route` 按「是否存活」。**
> 两者的范围**故意不同**，不要为了整齐改成一样：
> 把旧代码节点从 `map` 里摘掉 → 那台上的玩家一刷新就掉大厅（2026-10-31 事故，详见 `MAINTENANCE.md` §9.34）。
>
> 升级上游后若 `nginx.conf` 被整体替换，务必确认这两样还在：
> `include open-nodes.conf;` 和 `add_header X-SP-Accepts-New $sp_node_accepts_new always;`。
> 丢了 `include`，所有块都不生效（`_set-open-nodes.mjs` 会主动报错退出）；
> 丢了响应头，结算页提示只是不出现，不影响游玩。

### ⚠ 已知陷阱（踩过一次，别再踩）

1. **`deploy/sync-nodes.cjs` 曾经不同步 `server/`** —— 导致 29 个节点一直跑 10-25 的旧服务端代码，
   重启也拿不到新功能（2026-10-27 修复，提交 `bf9a7c58`）。
   **凡是改 `server/`，同步后再确认一次各节点内容一致**（`node deploy/sync-nodes.cjs` 应输出 `0 处差异`）。
2. **`healthz` 的 `build` 字段不覆盖 `server/net.js`、`server/lobby.js`、`server/match/**`** ——
   不能靠 build 相同判断服务端已更新，要用「进程启动时间 vs 文件 mtime」。
3. **`Copy-Item` 会保留源文件 mtime** —— 复制到各节点后 mtime 看起来还是旧的，
   用内容哈希或 `deploy/sync-nodes.cjs` 的差异报告核对，不要只看时间戳。
4. **前端/服务端两层的改动要分别验收** —— 例如 DOCTOR # 需要服务端下发 tag，
   旧节点上前端会自动回退到哈希，看起来"没坏"但功能没生效。
5. **静态文件"部署完成"不等于"玩家已生效"** —— 页面加载后模块留在内存里，服务器更新送不到
   已打开的标签页。节点侧靠 `ui/buildGuard.js` 盯 `/healthz.build` 自动刷新，但那个
   `buildTag` **不含 `matchmaker/`**。所以改 `matchmaker/public/client.js` 后，要么等玩家
   自己刷新，要么靠 `/api/pulse` 带回来的 `clientBuild` 自检（本服新增，见上表）。
   验证方式：看 access.log 里新端点是否开始被大量调用，而不是只看文件已部署。
6. **改 `server/` 后不能只跑 `deploy/sync-nodes.cjs --apply`** —— 它把 **node-1 当母版**，
   只保证 node-2…30 和 node-1 一致；如果改动是在 `repo-sync/server/` 里做的、还没进 node-1，
   脚本会诚实地报 `0 处差异`（因为大家一样旧），**改动等于没发**。
   正确的判断方式：拿 `repo-sync/server/<file>` 的哈希和节点上的比（参考第 3 条）。
   2026-10-27 的 `room.join` 修复就差点在这上面漏掉（见第 7 条）。
7. **`room.join` 的冲突判定顺序必须"同房间 → 接管"在前** —— 先无条件
   `dropStaleAccountSeats()` 会把**同一账号在目标房间自己的座位**当成遗留座位删掉；
   若那是房间唯一的人类座位，房间会直接 `disposed (empty)`，玩家开新标签页回来时
   报「未找到该同盟密钥对应的房间」。回归测试：`node test/join-takeover-order.mjs`。
8. **接管后的三条前端提示要一起看** —— 玩家实测同时看到「该身份已在其他页面登录」
   「正在进入模拟…（卡住）」「对局已转移，但观战席不可用」，这是**一条链上的三个坑**，
   只修其中一个仍然不可用：
   - `room.state` 可能早于 `welcome` 到达，这期间 `store.me.playerId` 还是旧会话的，
     `onRoomState` 会误判「座位里没有我」而清空房间 → 卡「正在进入模拟…」；
     用 `net.playerIdPending` 跳过这段时间的身份比对。
   - 旧标签页被接管后**不要**再去 `room.spectate`：那座位现在的 `accountId` 还是自己，
     `accountRoomConflict` 必然判 `SESSION_IN_USE` →「观战席不可用」。直接回大厅。
   回归测试：`node test/takeover-full-chain.mjs`；真实链路：`node tools/_verify-join-takeover-live.mjs 1`。
9. **恢复对局一律不许自动跳转**（维护者 2026-10-27 要求）—— 曾经有 6 条自动路径，
   玩家打开页面 / 刷新 / 换设备就被页面自己跳走，换设备那次还会把原来那台顶下线。
   现在唯一入口是大厅「恢复对局」按钮；跨节点的跳转也必须是玩家**再点一次**
   （`resumeMatch.js` 的 `goToRoom`），并且靠**一次性**的 `sp.accountResume` 标记
   （读完即删，所以刷新不会再触发）。
   **改这块之前先跑 `node test/manual-resume-only.mjs`**，它会扫全站确认没有任何
   「不由点击触发」的 `accountResume` 跳转。
10. **换设备点「恢复对局」卡在「正在进入模拟…」的真凶是 `identity.adopt` 不存在** ——
    `adoptAccountSeat` 里写了 `identity.adopt(msg.token)`，但 `net.js` 的 `createIdentity()`
    只暴露 `saveToken / rejectToken / getToken …`，**没有 `adopt`**。于是每次接管都抛
    `TypeError`：token 从未被采用 → 不重连 → 服务端不再推 `room.state`/`m.public` →
    页面永远停在「正在进入模拟…」。异常从 net 事件回调里抛出，`done()` 不会执行，
    所以还要干等 8 秒超时，看起来像"转圈然后卡死"。
    **正确写法：`identity.saveToken(msg.token)` 然后用新 token 重连。**
    这类"调用不存在的成员"语法检查发现不了（合法 JS），所以专门加了守卫：
    `node test/identity-members-exist.mjs`（把全仓 `identity.xxx` 和 net.js 实际成员比对）。
    真实链路验证：`node tools/_verify-crossdevice-resume.mjs 4 --start`
    （注意必须模拟前端「拿 token 后断开重连」那一步，否则是假阴性）。
11. **重启节点前要先清 Redis 里的死房间，否则重启后房间又被恢复** ——
    房间状态会持久化到 Redis（`sp:nN:lobby:rooms` 是 **hash**，`type` 是 hash，
    用 `get` 会报 WRONGTYPE，要用 `hkeys` / `hdel`）。只重启进程的话，
    服务端启动时会把 Redis 里的房间读回内存，`rooms` 数不变 ——
    表现为"重启了什么都没变"。清理顺序：`hdel sp:nN:lobby:rooms <CODE>` → 再重启节点。
    **删之前先确认 `matches=0` 且 `sockets=0`**（无人连接），别误删活房间。
12. **判断"能否重启"只看 `matches`，不要看 `rooms`** ——
    维护者明确的口径：**有对局（`matches>0`）就不动；`matches=0` 就可以重启**，
    哪怕是开着未开局的房间、有待机连接、有旁观者。
    `rooms>0 && matches=0` 的节点（空壳房、等待室）都能安全重启。
    现成的工具：`tools/_restart-when-idle.ps1`（默认只报告，`-Apply` 才重启；
    重启前会自己复查一次 `matches`）。
13. **`sp.matchInterrupted` 是 localStorage（跨标签页共享、30 分钟），不能当作「本页状态」** ——
    它记录的是「最近一次正在打的那一局」。踩过两个坑：
    - **任何新标签页都弹「本局模拟已结束」**：因为 `resumeTick` 里原本「只要没房间就弹面板」。
      现在要求 `s.room.code === rec.code` 才弹（本页确实进过那间房）。
    - **点「返回同盟」回到的是新开的对局**：按钮里先读标记拿到旧房号，紧接着
      `if (inRoom) code = s.room.code` 用**当前房间**把它覆盖掉，然后只 `location.reload()`。
      在新标签页点就等于原地刷新新房。现在以标记里的房间码为准，不一致就显式跳过去。
    回归测试：`node test/restart-panel-scope.mjs`。
14. **实验性选项弹窗的下拉：不要"预留空间"，也不要移动元素躲菜单** ——
    维护者 2026-10-27 的原话：「不要预留下拉框的空间」「窗口整体拉大、不要出现滑动条」
    「下拉框可以遮挡下面的按钮的」「这个界面一直弹来弹去的好看吗」。
    结论：**弹窗尺寸恒定 + 元素零位移 + 菜单正常遮挡下方内容**（点外面收起），
    这才是要的效果。踩过的三个坑：
    - 给 `.exp-modal__body` 加 `padding-bottom` 预留 → 内容区被撑高，
      `.modal` 是 `place-items:center`，弹窗一变高就整体上移，所有元素位移 20px。
    - 写 `align-self: start` 想让布局稳定 → 弹窗被钉到屏幕最上方。
    - 展开时把开关推下去 → 弹窗跳一下，比遮挡更难看。
    另一个隐性问题：`overflow-y: visible` 单独写**无效**。基础规则是
    `overflow: hidden auto`，CSS 规定一边 visible、另一边不是时 visible 会被计算成 auto，
    必须用 `overflow` 简写把两个方向都设成 visible。
    回归测试：`node test/exp-modal-dropdown.mjs`（四档尺寸，检查位移/滚动条/可点击）。
15. **🚫 红线：绝不能在 AI 助手 / 终端 / 任何交互式 shell 里启动 PM2**（2026-10-27 全体玩家断线）——
    pm2 会挂在那个会话的进程树下面，**那个应用一重启，pm2 跟着死，30 个节点全没**。
    当天维护者重启 AI 助手，玩家看到「与服务器的连接已中断，正在重连（第 7 次）」。
    而当时的看门狗只写 `ALERT` 从不修复，所以断了 3 分钟没人救。
    **正确做法**：双击 `启动服务器.bat`（内部走 `schtasks /Run /TN "SP-PM2-Resurrect"`，
    SYSTEM 身份 + Session 0，与任何登录会话无关）。
    **每次动过运维配置都要做冷杀测试**：杀掉 pm2 → 60 秒内必须自己回来。
    完整经过、验证命令、排查表见 [MAINTENANCE.md](../MAINTENANCE.md) **§9.9**。
    同一条红线也在 [AGENTS.md](../AGENTS.md) 的「更新 GitHub 前必查清单」里。
16. **验证 nginx 配置改动必须「绕过缓存」**（2026-10-27 踩过）——
    `/assets-cdn/` 的语义是 `proxy_pass .../assets/`：请求 `/assets-cdn/spine/x` → 源站
    `/assets/spine/x`。有人（包括我）会以为 `/assets-cdn/assets/spine/x` 才是对的，
    改成 `proxy_pass https://assets.luobomiao.love/;` —— **这是错的，会把原本正常的
    路径也弄坏**，因为源站只有 `/assets/...` 一种路径（`/spine/...` 直接 404）。

    最坑的是：改完测试**全部 200**，看起来修好了 —— 实际是**命中了旧缓存**
    （`X-SP-Asset-Cache: HIT`），根本没回源。

    **正确验证方式**：
    - 换一个**从未请求过**的文件（`Get-ChildItem shared/assets -Recurse | Select -Skip N`）；
    - 或看响应头 `X-SP-Asset-Cache`：`MISS`/`BYPASS` 才是真的走了新逻辑，`HIT` 什么都不算；
    - 注意 `proxy_cache_key "$sp_asset_cache_uri"` **不受 proxy_pass 影响**，
      改回源路径不会让旧缓存失效，所以你测到的可能是几天前的条目。

    `deploy/nginx.conf` 是这份配置的备份（`nginx/conf/nginx.conf` 不进仓库）。

17. **看门狗绝不能把「读不到」当成「全都没了」**（2026-10-28 连环事故）——
    `_stack-watchdog.ps1` 原来这样写：

    ```powershell
    cmd /c "pm2 jlist > tmp 2>nul"      # 失败静默返回空
    $online = @($r.out -split ',')      # → 空数组
    $missing = <全部 32 个应用>          # 全被判成"缺失"
    pm2 resurrect                        # ← 重启整张进程表
    ```

    `pm2 jlist` 在 pm2 忙时会**间歇性失败**，一次抖动就让看门狗以为「所有应用都丢了」，
    然后 `resurrect` 把全服重启一遍。**实测一次误判中断了 10 局对局**，玩家体感
    「一直在重启」。

    同一天这条链的上游还有一环：`nginx-gateway`（pm2 里托管 nginx 的 wrapper）与
    计划任务 `SP-Nginx-Start` 抢 443，前者崩溃循环 **4321 次**。

    **三条通用规则**（写任何「检测→修复」脚本都适用）：
    - **先区分「真的坏了」和「我读不到」**。读取失败 / 结果为空 / 明显不完整 → 这一轮
      **什么都不做**，只记日志；
    - **`pm2 resurrect` 是高危操作**，只用于「pm2 守护进程整个挂了」（那时所有应用本来就
      都没了）。补缺失应用一律 `pm2 start <eco> --only <name>`；
    - 换托管方（例如 nginx 从 pm2 挪到计划任务）必须**先停旧的再起新的**，只做一半会让
      两者抢同一个端口。

    排查入口：`pm2 jlist` 看 `restart_time`（几百上千次 = 崩溃循环），
    巡检日志 `logs\restart-watch.log`。完整经过见 [MAINTENANCE.md](../MAINTENANCE.md) **§9.12**。
18. **新增 `g.*` / `room.*` 消息类型，必须同时加进 `shared/protocol.js` 的 `C2S` 白名单**（2026-10-28 踩过）——
    `server/net.js` 在把请求交给对局之前先查白名单，缺了就直接回 `ERR.BAD_MSG`（「无效的请求」），
    **请求根本到不了业务逻辑**。复活（`g.revive`）就是这样丢的：客户端按钮、`Match.revive()`、
    `intents.js` 的路由全都在，唯独白名单那一行在上游同步时被抹平了，玩家点了只看到「无效的请求」。
    症状的迷惑之处：玩家说「我没漏怪、血也够」，但这些条件属于业务层的判断，**从来没被读到过**。
    日志里也看不出来 —— `unknown type` 只回给客户端，不写服务端日志。
    验证：`node tools/verify-revive.mjs <节点号> <userToken>`，看回复是 `BAD_MSG`（没修好）
    还是 `WRONG_PHASE / no running match`（已放行到业务层）。详见 [MAINTENANCE.md](../MAINTENANCE.md) **§9.14**。

### 回归测试清单（改相关代码后要跑）

| 测试 | 守住什么 |
|---|---|
| `node test/join-takeover-order.mjs` | `room.join` 必须「同房间 → 接管」在「清理遗留座位」之前 |
| `node test/takeover-full-chain.mjs` | 接管后的完整链路：`net.playerIdPending` 竞态、旧标签页回大厅 |
| `node test/manual-resume-only.mjs` | 全站不得有「不由点击触发」的恢复跳转 |
| `node test/identity-members-exist.mjs` | 所有 `identity.xxx` 调用都必须是 `net.js` 真实存在的成员 |
| `node test/restart-panel-scope.mjs` | 「本局模拟已结束」只对进过那间房的页面显示；返回同盟跳对房间 |

真实链路工具（要连线上节点，会真的建房，用完注意清理）：

| 工具 | 验证什么 |
|---|---|
| `node tools/_verify-join-takeover-live.mjs 1` | 开新标签页回自己房间，房间不被解散 |
| `node tools/_verify-crossdevice-resume.mjs 4 --start` | 换设备恢复：`account.resume` → 重连 → 收到 `room.state` / `m.public` |

> 注意第 2 个工具**必须模拟前端「拿 token 后断开重连」那一步**，否则服务端不会推状态，
> 得到的是假阴性（我第一版就漏了这一步）。
> 这两个工具会在节点上留下房间；`matches=0 sockets=0` 时可重启节点 +
> `hdel sp:nN:lobby:rooms <CODE>` 清掉（见第 11 条）。

## 两个一键脚本（在仓库根目录）| 脚本 | 作用 |
|---|---|
| `apply-patch.bat` | 打补丁 → 同步到 node-1…node-30 → 重启 PM2 |
| `restore-patch.bat` | 还原官方文件 → 重启 PM2 |

## 官方更新时的标准流程

1. **先跑 `node patcher/check-coverage.mjs`**，确认当前没有未覆盖的改动；
2. 双击 **`restore-patch.bat`** —— 恢复官方版本；
3. 按官方方式应用更新包（服务器能正常启动）；
4. 双击 **`apply-patch.bat`** —— 在新版本源码上重新打上补丁并重启；
5. **再跑一次 `node patcher/check-coverage.mjs`**，确认功能都回来了。

> 补丁是**按锚点插入**的，不覆盖整份文件，所以新版本里的其它改动都会保留。
> 如果新版本改动了锚点，`apply-patch.bat` 会在写文件**之前**中止，并打印是哪一条找不到锚点。

## 单独使用（命令行）

```powershell
node patcher\apply.mjs             # 打补丁
node patcher\apply.mjs --check     # 检查是否已全部打好（不改文件）
node patcher\restore.mjs           # 还原
node patcher\restore.mjs --check   # 检查是否已是官方原版
node patcher\check-coverage.mjs    # 补丁完整性
```

## 断点快照（服务器重启 / 意外关闭）

`server/lobby.js` 里还加了快照逻辑：

- 每 10 秒把「房间 + 座位 + 重连 token」写到 `node-N\state\snapshot.json`；
- 正常关机（PM2 stop/restart、SIGTERM）时再写一次；
- 进程重新起来时自动读回：房间码不变、座位不变，玩家浏览器用原来的 token 重连会**回到同一个房间**；
- 开服后 **30 分钟内没有任何真人回来的房间自动作废**（不会把很久以前的空房间一直挂着）；
- 对局**本身**不能续跑（引擎状态在内存里），重连时会提示「服务器重启，上一局模拟已中断，可重新开始」，然后原地重新开局。

关闭方式：节点的环境变量 `SP_SNAPSHOT=0`（默认开启）。

## 对局检查点（Redis 检查点的第一步）

- 每 10 秒把进行中的对局写入 `node-N\state\matches\<房间码>.json`（回合、阶段、玩家资金/棋盘/商店等）；
- 重启后玩家重连时自动把对局挂回去（同一回合/阶段），见 `server/match/checkpoint.js`；
- 对局同时双写到 Redis（`SP_REDIS_URL`，默认 `redis://127.0.0.1:6379/0`），启动时本地文件缺失会用 Redis 的存档补齐；
- 已验证：第 0 回合与第 2 回合恢复、删除本地文件后从 Redis 恢复。

## 环境变量（防护参数）

在 `ecosystem.config.cjs` 每个节点的 `env` 里：

```js
SP_MAX_ROOMS_PER_ADDR: '1',      // 同一 IP 同时存在的房间数（0 = 关闭）
SP_MAX_BOTS_PER_ADDR: '6',       // 同一 IP 跨房间累计的 AI 队友数（0 = 关闭）
SP_IDLE_KICK_MS: '240000',       // 多久没有操作就踢出房间（0 = 关闭）
```

改完需要让 PM2 重新读取环境：`pm2 start ecosystem.config.cjs --update-env`（两个 bat 已经这么做了）。
