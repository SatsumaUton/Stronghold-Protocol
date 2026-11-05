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
server/echoTesters.js                深潜测试名单
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
# 在 repo-sync 里
node tools/deepecho-repo.mjs --out D:\Stronghold-Protocol\deepecho-repo

cd D:\Stronghold-Protocol\deepecho-repo
git init -b main
git add -A
git commit -m "深渊回响：首次导入"
git remote add origin https://github.com/<你>/Stronghold-Protocol-Deepecho.git
git push -u origin main
```

（生成脚本也支持一把梭：配好 remote 后 `node tools/deepecho-repo.mjs --push`。）

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
| 深潜相关（一行也算） | **深渊回响仓库** | `node tools/deepecho-repo.mjs --push` |
| 非深潜（大厅、匹配、账号、后台…） | 公开仓库 | 正常 `git add / commit` |
| 两边都改到了共用文件 | 两边都要 | 先提交公开仓库，再 `--push` 深潜仓库 |

`tools/deepecho-repo.mjs` 的文件清单来自 `patcher/features.json` 的 `deepecho` 项，
由 `patcher/check-deepecho.mjs` 维护 —— 新加一个深潜文件时，先跑 `check-deepecho.mjs --fix`，
清单会自己变长，再 `--push` 就会带上它。

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
| 上游升级后深潜没了 | `node patcher/check-deepecho.mjs --fix` 后重新 `--push` |
| 深潜测试红了 | 按 `patcher/check-deepecho.mjs` 打印的 18 个测试逐个跑 |

---

*这份文件在公开仓库与深渊回响仓库里各有一份，内容相同；改的时候两边一起改。*
