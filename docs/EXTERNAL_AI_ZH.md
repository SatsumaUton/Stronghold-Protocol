# 服主接入外部 AI

这是维护者 2026-10-17 决定、2026-10-19 要求实现的扩展，基于 @HankDUMPLINGZhong 的 PR #673
策略框架。默认仍是原来的 `legacy`；玩家不能从房间里指定程序或网址。

先在一个终端运行示例 HTTP AI：

```sh
node tools/ai/http.mjs 8765
```

在另一个终端启动服务器（以下为 macOS / Linux shell）：

```sh
SP_BOT_STRATEGY=external SP_EXTERNAL_AI_TRANSPORT=http \
SP_EXTERNAL_AI_URL=http://127.0.0.1:8765 SP_EXTERNAL_AI_SEATS=1 npm start
```

`SEATS=1` 只接管编号 1 的 AI 席位（编号从 0 开始）；省略则接管全部 AI 席位与真人 AI 托管。
第三方服务可填 HTTPS 地址；若需要鉴权，在环境变量 `SP_EXTERNAL_AI_TOKEN` 设置令牌。
不要把令牌放进网址。程序收到的只有已有公开视图、该席位的私有视图和决策上下文，没有随机种子或其他人的私有数据。

也可让服务器启动本机程序，用标准输入／输出逐行 JSON 通信：

```sh
SP_BOT_STRATEGY=external SP_EXTERNAL_AI_TRANSPORT=stdio \
SP_EXTERNAL_AI_COMMAND='["node","tools/ai/stdio.mjs"]' npm start
```

PowerShell 用 `$env:SP_BOT_STRATEGY = 'external'` 的形式逐个设置同名变量，再运行 `npm start`。
服务部署建议把命令和脚本写成绝对路径。本机程序拥有服务器的系统权限与环境变量；只运行自己信任的程序。
每局复用一个子进程，结束时关闭；程序崩溃后，下次请求在退避时间过后重新启动。

示例只选择策略／机变／交互卡并准备，不会精细经营。自行实现 AI 时，可以分批买入、移动、刷新、处理奖励等，
每批后读取新视图与上一批的结果，所有操作都经过真人相同的协议和规则校验。
超时、断线、格式错误或没有完成准备，会由原内置 AI 接着完成；回合倒计时不延长。
默认每次决策 1000 毫秒、64 个操作、回复 64 KiB、连续失败 3 次后本局该席位固定用内置 AI，
子进程重启退避 1000 毫秒；这些工程参数及预留半个阶段剩余时间给回退均为 **[ASSUMED]**，可按英文文档调整。

测试模式会记录外部回复与回退，回放不再访问外部服务。取消 `SP_BOT_STRATEGY` 或设为 `legacy` 即恢复默认。
完整协议、配置范围、错误处理与安全说明见 [External AI API](EXTERNAL_AI.md)；框架见
[AI 策略开发文档](BOT_STRATEGIES.md)。没有改动官方经济、部署、轮次或战斗规则。

## 语言模型玩家：顾问模式（§35.9）

维护者于 **2026-10-19** 批准，仍然全部可选：默认机器人是 `legacy`，外部 AI 默认仍为
`direct`（直接提交操作）。服主设置 `SP_EXTERNAL_AI_MODE=plan` 后，模型每个休整回合只回答一次
计划，选策略、公共机变和插件选项窗口各回答一次；采购过程中新增的私人选择、晋升奖励由原 AI
继续处理。通常每席约 15–20 次决策，具体取决于模式、存活回合和插件窗口。

计划可指定盟约及优先级、想买／保留／出售的干员、升级目标、最多刷新次数、刷新后最低余额、
装备保留和携带者、可选站位。原 AI 用这些偏好调整评分，再完成采购、试算摆阵和准备；它们不强制
跳过真人合法性检查。无效结构会回退原 AI；不存在、不可买、不可摆的目标不强制执行。
空计划 `{}` 表示让原 AI 自行决定。完整字段与数值范围见 [API 顾问模式](EXTERNAL_AI.md#advisor-mode-and-readable-observations-359)。
例如回复：

```json
{"v":"sp-ai/1","id":"ai-3","plan":{"bonds":[{"id":"yanShip","priority":4}],"economy":{"level":3,"maxRefreshes":6,"refreshAbove":2}}}
```

这些权重、限额和提示词是 **[ASSUMED] 工程／策略选择**，不是官方推荐阵容。
经济仍按官方数据及项目已核实的规则：没有经验值系统；升级价每回合减一；通常不继承剩余资金，
不要套用其他自走棋的通用利息。坎诺特的 `aceffect_band_34 / coin_carry_over` 是满 5 资金加 1、
利息上限 1。商店按等级允许的剩余副本数加权，不是固定各阶概率表。知识包提供初始卡池各级占比，
明确标注未扣除随机禁用、购买和自选库存，绝不发送实际隐藏库存。来源：本地官方
`activity_table.json` 的 `autoChessData` 与 `activity.AUTOCHESS_SEASON.act2autochess`、干员／技能／
敌人表，以及 [玩法说明](PLAYING.md)、[数据说明](DATA.md)；这次没有改动玩法规则。

顾问模式默认先发一次带内容哈希的知识包（HTTP hello POST 或 stdio hello 行，服务必须回应相同
`knowledgeVersion`）；并发席位共用，stdio 子进程重启才重发。包含当前玩法插件的数据、规则和
公开选项卡，资料更新后哈希也变。`SP_EXTERNAL_AI_LANGUAGE` 可选 `zh-CN/en/ja/ko/zh-TW`，名称始终
附 `nameZh`，缺翻译保留中文；原始玩法表、规则说明和中文经济表是参考，插件效果以当前数据为准。
旧 direct 服务不需要 hello；需要知识包时设置 `SP_EXTERNAL_AI_KNOWLEDGE=1`。

每次观察保留原始视图并增加 `digest`：有名字的商店、费用与等阶、手牌／棋盘坐标、盟约进度、
当前利息与下一档、升级费用、敌人／领袖预览、其他玩家公开棋盘，以及本次可用的短操作编号。
直接模式可回复 `"intents":["a1","a3"]`，顾问选卡可写 `"plan":{"choice":"a2"}`；编号只在当前
请求有效，服务端仍重新校验，不能假定一批中的前一步执行后后一步仍合法。快捷列表保守列出能
无副作用判断的操作；交换、法术、依赖效果的消耗品、策略高亮和选项刷新继续支持原始 intent。
不为了预判任意插件效果而执行它。模型示例省去重复原始视图和大量逐格摆阵操作，交给原 AI 试算。

## 示例语言模型适配器

`tools/ai/llm-agent.mjs` 通过 stdio 接入游戏，通过兼容的 `/chat/completions` 接口调用模型。
需显式设置 `SP_LLM_BASE_URL`（包括 `/v1`）、`SP_LLM_MODEL`、`SP_LLM_API_KEY`，没有默认付费服务。
密钥只从环境读取，不写日志／测试回放。`SP_LLM_TIMEOUT_MS` 默认 20000，上限 30000；游戏侧的
总预算还包括握手，并保留一半阶段时间给回退。示例配置（先在本地或可信服务端设置环境变量）：

```sh
export SP_BOT_STRATEGY=external SP_EXTERNAL_AI_MODE=plan SP_EXTERNAL_AI_TRANSPORT=stdio
export SP_EXTERNAL_AI_COMMAND='["node","tools/ai/llm-agent.mjs"]'
export SP_EXTERNAL_AI_TIMEOUT_MS=30000
export SP_LLM_BASE_URL=http://127.0.0.1:8000/v1
export SP_LLM_MODEL=your-model
export SP_LLM_API_KEY="$YOUR_KEY"
npm start
```

知识包作为稳定系统提示词前缀缓存在内存，是否命中服务端提示词缓存由模型提供方决定；兼容
无状态接口仍须发送该前缀。自写策略提示词强调可达盟约、合理角色、晋升收益、存活与长期投入，
没有复制攻略，也没有声称胜过原 AI。回复必须是 JSON 计划，本地验证后才转给游戏；错误时只返回
通用失败，不回显服务端响应。测试只连接回环模拟服务器，不调用任何真实模型 API。

## 先和 legacy 比较，再决定是否启用

两个工具都等待外部异步决策结束才推进虚拟时间，避免把正常网络响应误判成超时；线上对局计时
照常。用同一内容版本、种子范围、难度、人数、试算次数，分别跑基线和候选。先用不联网示例检查
协议，再换模型适配器：

```sh
node tools/botbench.mjs --configs solo:FUNNY,coop4:HARD --seed 7 --seeds 10 --jobs 1 --bot legacy --json legacy.json
SP_EXTERNAL_AI_MODE=plan SP_EXTERNAL_AI_TRANSPORT=stdio \
SP_EXTERNAL_AI_COMMAND='["node","tools/ai/stdio.mjs"]' \
node tools/botbench.mjs --configs solo:FUNNY,coop4:HARD --seed 7 --seeds 10 --jobs 1 --bot external --json advisor.json
node tools/botbench.mjs --compare legacy.json advisor.json
```

改用 `llm-agent.mjs` 时再按上节配置提供方。`SP_EXTERNAL_AI_SEATS=0` 可只测一席，其余仍由 legacy
控制。`--json -` 可直接输出 JSON；`tools/matchrun.mjs --bot external --json` 也包含相同的逐席指标。
输出按策略列出存活回合、最终 LP、累计伤害、领袖伤害、胜场，及外部调用、模型报告的输入／输出／
缓存 token、延迟、回退次数；hello 次数单列。缺少 token 报告代表未知，不能当作免费。回退计数是
失败决策次数，不含成功的空计划委托；禁用后的整局 legacy 也不继续计数。种子固定不代表远程模型
确定性，建议多种子、重复试验，同时检查异常和回退率，不能只看一次胜利。

`strategyMetrics` 是逐席真实结算数据，汇总的生存／LP／伤害为平均值，胜场和调用计数是总数。
比较时也记录模型版本和配置，但不要把 API key、带凭证的 URL 写入结果文件。
