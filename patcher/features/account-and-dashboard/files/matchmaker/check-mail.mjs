#!/usr/bin/env node
// matchmaker/check-mail.mjs —— 邮件通道自检（2026-11-26 新增）。
//
// 为什么需要：玩家反馈「注册发送验证码显示操作失败」，排查发现三处发信点都把异常吞掉了，
// 日志里一个字都没有；只能现写脚本复现，才看到 QQ 邮箱 SMTP 回 `EAUTH 535`（授权码失效）。
// 这个脚本用与 matchmaker **完全相同**的配置做 verify + 可选真发一封，一条命令定位问题。
//
// 用法（在部署根执行）：
//   node matchmaker/check-mail.mjs                 # 只做 SMTP 连接/认证检查（不打扰任何人）
//   node matchmaker/check-mail.mjs --send you@qq.com   # 真发一封测试邮件
//
// 退出码：0 = 通道正常；1 = 配置缺失或认证/发送失败。
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(path.join(HERE, 'x.js'));
const nodemailer = require('nodemailer');

const readSecret = (name) => {
  const files = [
    path.join(ROOT, '.secrets', 'secrets.json'),
    path.join(HERE, '.secrets', 'secrets.json'),
  ];
  for (const f of files) {
    if (!existsSync(f)) continue;
    try {
      const j = JSON.parse(readFileSync(f, 'utf8'));
      if (j[name]) return j[name];
    } catch { /* 继续找下一个 */ }
  }
  return '';
};

const MAIL = {
  host: process.env.MAIL_HOST || readSecret('mailHost'),
  port: Number(process.env.MAIL_PORT || 465),
  secure: (process.env.MAIL_ENCRYPTION || 'ssl') === 'ssl',
  user: process.env.MAIL_USERNAME || readSecret('mailUser'),
  pass: process.env.MAIL_PASSWORD || readSecret('mailPassword'),
};

const mask = (s) => (s ? s.replace(/^(.)(.*)(@.*)$/, (_m, a, _b, c) => a + '***' + c) : '(空)');
console.log(`邮件配置: host=${MAIL.host || '(空)'} port=${MAIL.port} secure=${MAIL.secure} user=${mask(MAIL.user)} pass=${MAIL.pass ? `已设置(${MAIL.pass.length} 字符)` : '(空)'}`);

if (!MAIL.host || !MAIL.user || !MAIL.pass) {
  console.error('✗ 配置不完整：请在 .secrets/secrets.json 里填 mailHost / mailUser / mailPassword');
  process.exit(1);
}

const transport = nodemailer.createTransport({ host: MAIL.host, port: MAIL.port, secure: MAIL.secure, auth: { user: MAIL.user, pass: MAIL.pass } });

try {
  await transport.verify();
  console.log('✓ SMTP 连接与认证正常');
} catch (e) {
  console.error(`✗ SMTP 认证失败: ${e.code || ''} ${String(e.response || e.message).slice(0, 200)}`);
  if (e.code === 'EAUTH') {
    console.error('  → 这是凭据问题：QQ 邮箱要用「设置 → 账户 → POP3/SMTP 服务」里生成的**授权码**（不是登录密码），');
    console.error('    改 .secrets/secrets.json 的 mailPassword，然后 pm2 restart matchmaker。');
  }
  process.exit(1);
}

const to = (process.argv[process.argv.indexOf('--send') + 1] || '').trim();
if (process.argv.includes('--send')) {
  if (!/^[^@\s]+@[^@\s]+$/.test(to)) { console.error('✗ --send 后面要跟一个邮箱地址'); process.exit(1); }
  try {
    const info = await transport.sendMail({ from: `"萝卜喵公益服" <${MAIL.user}>`, to, subject: '【自检】邮件通道正常', text: '这是一封自检邮件，收到即表示验证码邮件通道可用。' });
    console.log(`✓ 测试邮件已发出: ${info.messageId}`);
  } catch (e) {
    console.error(`✗ 发信失败: ${e.code || ''} ${String(e.response || e.message).slice(0, 200)}`);
    process.exit(1);
  }
}
process.exit(0);
