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
