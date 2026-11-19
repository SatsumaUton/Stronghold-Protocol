// test/deploy/nginx-snapshot.test.js —— deploy/nginx.conf 必须是「脱敏但可还原」的快照。
//
// 背景（2026-11-19，维护者选了方案 A）：线上 nginx 配置（分流 / 节点分配 / 安卓下载兜底）
// 只存在服务器上，仓库里那份 deploy/nginx.conf 是另一份更旧的模板 —— 服务器一重装规则就没了。
// 现在把线上配置脱敏成快照放进仓库：
//   · 本机绝对路径 → __SP_ROOT__，资源站 IP → __ASSET_IP__
//   · 头部记下快照时间与当时的 SHA-256；正文在标记行之后
//   · deploy/render-nginx.cjs 按环境变量还原，--check 能逐字节比对
//
// 这条测试盯住：快照里不能有本机路径 / 公网 IP，占位符能被渲染掉，头部带 SHA。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TPL = join(ROOT, 'deploy', 'nginx.conf');
const RENDER = join(ROOT, 'deploy', 'render-nginx.cjs');
const MARK = '# ---8<--- 快照正文开始（这一行之前都是说明，还原时丢弃） ---8<---';

test('快照存在，且带正文标记与 SHA 行', () => {
  assert.ok(existsSync(TPL), 'deploy/nginx.conf 存在');
  const s = readFileSync(TPL, 'utf8');
  assert.ok(s.includes(MARK), '★ 必须有正文标记行（render 靠它剥离头部说明）');
  assert.match(s, /线上文件 SHA-256：[0-9a-f]{64}/, '★ 头部要记当时的 SHA-256，便于日后核对');
  assert.match(s, /快照时间：/, '头部要有快照时间');
});

test('快照里没有本机绝对路径、没有资源站公网 IP', () => {
  const s = readFileSync(TPL, 'utf8');
  assert.equal(/[A-Za-z]:[\\/]Stronghold-Protocol/.test(s), false, '★ 不能残留部署根的本机路径');
  assert.equal(/\b103\.236\.99\.203\b/.test(s), false, '★ 不能残留资源站公网 IP');
  assert.equal(/Administrator/.test(s), false, '不能残留用户名');
  // 其余盘符绝对路径也不行（排除 Windows 里的注释举例）
  const abs = s.match(/\b[A-Za-z]:[\\/][A-Za-z0-9_.\-\\/]+/g) || [];
  assert.deepEqual(abs, [], `★ 不应有其它本机绝对路径：${abs.slice(0, 3).join(' , ')}`);
});

test('渲染后占位符全部消失，且真的换成了给的值', () => {
  const s = readFileSync(TPL, 'utf8');
  const i = s.indexOf(MARK);
  const body = s.slice(i + MARK.length).replace(/^\r?\n/, '');
  const out = body.split('__SP_ROOT__').join('D:/CI/root').split('__ASSET_IP__').join('1.2.3.4');
  assert.equal(/__SP_ROOT__|__ASSET_IP__/.test(out), false, '★ 占位符必须能被完全替换');
  assert.ok(out.includes('D:/CI/root/'), '渲染结果里应出现替换后的部署根');
});

test('render-nginx.cjs 在缺 SP_ASSET_IP 时拒绝写入', () => {
  const s = readFileSync(RENDER, 'utf8');
  assert.match(s, /SP_ASSET_IP/, '脚本要读 SP_ASSET_IP');
  assert.match(s, /必须设环境变量 SP_ASSET_IP/, '★ 缺值时要报错而不是写出坏配置');
  assert.match(s, /process\.exit\(2\)/, '★ 拒绝时用非 0 退出码');
});
