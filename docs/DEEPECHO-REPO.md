# 深渊回响：独立仓库与分离手册

> 维护者 2026-11-06 要求：**深渊回响的所有内容单独一个仓库；公开仓库只放其余内容，且绝不能出现深渊回响的文件。**
> 这份手册是那条规则的操作说明，也是两个仓库的边界定义。

---

## 1. 两个仓库的分工

| | 公开仓库 | 深渊回响仓库 |
|---|---|---|
| 名字（建议） | `Stronghold-Protocol`（现有，公开） | `Stronghold-Protocol-Deepecho`（**私有**） |
| 分支 | `custom/production` | `main` |
| 放什么 | 上游基板 + 本服其余功能（挂机防护、容量实验、匹配、账号、后台…） | **只放深渊回响**：深潜运行文件、测试、补丁快照、本手册 |
| 谁能看 | 所有人 | 只有你（私有） |
| 更新时机 | 改完非深潜内容 | 改完深潜内容（含一行） |

深潜的模式内容还没公开，所以那个仓库**必须私有**。

---

## 2. 红线（只有一条，但绝不能破）

**深渊回响的独占文件，一个都不许出现在公开仓库里。**

「独占文件」= 只为深潜存在的文件：

```
server/match/match/echo*.js          深潜的回合/祝福/诅咒/词条/悬赏/波次/投影/配置
public/js/ui/echo*.js                深潜的界面块（状态条、祝福、buff、印记、投影、补给）
public/js/ui/enemyRecords.js         跨版本敌人名字/图标（深潜带旧版本敌人）
public/js/screens/echoLobby.js       深潜大厅
matchmaker/diveBoard.cjs             深潜排行榜（Redis）
matchmaker/roomDir.cjs               房间目录（公开深潜列表用）
patcher/features/deepecho/**         深潜的补丁快照
test/**/echo*.test.js                深潜测试
test/persist/echo-resume.test.js     断点续玩
test/content/whitw2-stack.test.js    叠层上限
test/patcher/deepecho-isolation.test.js
```

**共用文件**（`server/match/Match.js`、`server/lobby.js`、`public/js/screens/lobby.js`、`theme.css`、i18n …）
同时含原版代码，**必须留在公开仓库**；它们里面的深潜那部分由
`patcher/features/deepecho/files/` 的快照保护（上游升级时靠它恢复）。

---

## 3. 怎么保证（两道自动检查）

```bash
node patcher/check-deepecho.mjs      # 深潜自包含：96 个文件有最新快照 + 两张表登记 + 18 个测试
node patcher/check-repo-split.mjs    # 公开仓库里没有深潜独占文件（--strict 时违规即退出 1）
```

两条都在 `npm test` 里（`test/patcher/`）。**提交前跑一次**，红就别提交。

`check-repo-split.mjs` 违规时会直接把要执行的命令打出来：

```
git rm --cached <file> …
```

---

## 4. 第一次建仓库（三步）

### 4.1 在 GitHub 上建一个**私有**空仓库

网页：<https://github.com/new> → Repository name 填 `Stronghold-Protocol-Deepecho` →
**Private** → **不要**勾 Add a README / .gitignore / license（要空仓库）→ Create。

命令行（装了 `gh` 的话）：

```bash
gh repo create Stronghold-Protocol-Deepecho --private --description "深渊回响（私有）"
```

API（本机网络要走镜像，直连 GitHub API 会超时）：

```bash
curl -H "Authorization: token $TOKEN" -d '{"name":"Stronghold-Protocol-Deepecho","private":true}' \
  https://api.github.com/user/repos
```

### 4.2 把内容生成出来并推上去

```bash
# 在 repo-sync 里：先重建本地树（只新增/覆盖，不删除）
node tools/deepecho-repo.mjs

# 再推到私有仓库
node tools/deepecho-push.mjs --check      # 预演：看远端 head 与需要变动的文件数
node tools/deepecho-push.mjs --apply      # 实际推送（追加一个 commit）
```

> ★ 这台生产机**不能** `git push`：`github.com:443` 直连超时（20 秒），`ghfast.top`
> 镜像只读（推送回 403）。只有 `api.github.com` 可达，所以推送走 **Git Data API**
> （blobs → tree → commit → ref），由 `tools/deepecho-push.mjs` 完成。
> 原来记的 `git init / remote add / git push` 在这台机器上必然失败，已按实际可用路径改写。
>
> 空仓库（从未有过提交）的 Git Data API 会一律回 `409 Git Repository is empty`，
> 包括建 blob。所以**第一次**要先用 Contents API 种一个提交：
>
> ```bash
> curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
>   -d '{"message":"init","content":"'$(printf '# repo\n' | base64 -w0)'"}' \
>   https://api.github.com/repos/<你>/Stronghold-Protocol-Deepecho/contents/README.md
> ```
>
> 之后 `--apply` 就能正常推。推送脚本只**新增/覆盖**，不删除远端独有的文件；
> 内容没变时不会产生空提交（按 Git blob sha 比对）。

`deepecho-repo/` 里的本地 git 仓库（`git init` + 提交）仍可保留，用来看历史与 diff；
它和远端不是同一条线，**以 `tools/deepecho-push.mjs` 推上去的树为准**。
每次推送后用 `node <tmp>/verify` 之类的方式核对：远端文件数、逐路径 blob sha。


### 4.3 把深潜独占文件从公开仓库摘掉

```bash
node patcher/check-repo-split.mjs --list      # 先看要摘哪些
node patcher/check-repo-split.mjs --apply     # 只摘 git 索引（文件留在磁盘上，生产不受影响）
```

`--apply` 等价于对每个独占文件执行 `git rm --cached`，并把模式写进 `.gitignore`；
**磁盘上的文件不动**，所以 30 个节点的部署、`patcher/check-deepecho.mjs` 全都照旧。

> ⚠ 公开仓库的**历史**里仍然有这些文件（之前已经提交过）。要彻底清掉得重写历史
> （`git filter-repo`），那是另一件事；当前这一步只保证**今后**不再上传。

---

## 5. 日常怎么更新

| 你改了什么 | 往哪提交 | 命令 |
|---|---|---|
| 深潜相关（一行也算） | **深渊回响仓库** | `node tools/deepecho-repo.mjs` → `node tools/deepecho-push.mjs --apply` |
| 非深潜（大厅、匹配、账号、后台…） | 公开仓库 | 正常 `git add / commit` |
| 两边都改到了共用文件 | 两边都要 | 先提交公开仓库，再重建 + 推深潜仓库 |

`tools/deepecho-repo.mjs` 的文件清单来自 `patcher/features.json` 的 `deepecho` 项，
由 `patcher/check-deepecho.mjs` 维护 —— 新加一个深潜文件时，先跑 `check-deepecho.mjs --fix`，
清单会自己变长，再重跑生成 + `deepecho-push.mjs --apply` 就会带上它。

---

## 6. 上游更新时

深潜的补丁快照只存在于深渊回响仓库（`patcher/features/deepecho/`）。
升级流程不变：`restore → 升级 → apply.mjs → merge-features.py`，
其中 `merge-features.py` 读的 `patcher/features/index.json` 里也要有 `deepecho` 项
（`check-deepecho.mjs` 会检查）。

因为深潜没有 `base/` 副本，合并对它走 `no-base-keep-ours`：**整份保留我们的版本**，
所以原版更新不会把深潜冲掉；代价是那些共用文件里上游的新改动不会自动合并，升级后要人工看。

---

## 7. 出问题时的两分钟排查

| 症状 | 先看 |
|---|---|
| 公开仓库里又出现深潜文件 | `node patcher/check-repo-split.mjs --list` |
| 深潜仓库缺文件 / 落后 | `node tools/deepecho-repo.mjs --check` |
| 上游升级后深潜没了 | `node patcher/check-deepecho.mjs --fix` 后重新生成 + `deepecho-push.mjs --apply` |
| 推送报 `github.com:443` 超时 | 正常：这台机器只能走 API，用 `tools/deepecho-push.mjs` |
| 推送报 `409 Git Repository is empty` | 空仓库不能建 blob，先按 §4.2 用 Contents API 种一个提交 |
| 深潜测试红了 | 按 `patcher/check-deepecho.mjs` 打印的 18 个测试逐个跑 |

---

## 8. 公开仓库怎么推（2026-11-06 起：只能推「干净提交」）

本地 `custom/production` 里有几百个提交，其中 200 多个提交的**树里**带着
`server/match/match/echo*.js` 这类深潜独占文件（2026-11-06 才把它们从索引里摘掉）。
所以一旦把本地分支推上去，这些文件会**连同历史**进入公开仓库 —— `check-repo-split.mjs`
拦得住「现在」，拦不住「历史」。规矩是：**只推一个干净提交**。

```bash
# 1) 当前树必须是干净的
node patcher/check-repo-split.mjs        # 必须是 0 / 0
node patcher/check-deepecho.mjs          # 97 文件快照齐全

# 2) 用当前树造一个「父 = 远端 HEAD」的提交（内容干净，且是快进）
SHA=$(git commit-tree "HEAD^{tree}" -p "$(git rev-parse origin/custom/production)" -m "发布：<这一版改了什么>")
git branch -f public-clean "$SHA"

# 3) 推它
git push origin public-clean:custom/production
```

- 代价：公开仓库里看不到本地这几百个提交的粒度（**一次发布 = 一个提交**）；本地历史不受影响。
- 推完 `local custom/production` 与远端就**分叉**了（本地领先 N、远端领先 1）。`git push` 会报
  non-fast-forward —— **不要 force**，按上面重来一次即可。
- 想在公开仓库里也有细粒度历史，只能先 `git filter-repo` 把那些路径从历史里删掉再推（重写全部 SHA，另案）。

---

*这份文件在公开仓库与深渊回响仓库里各有一份，内容相同；改的时候两边一起改。*
