// Login / register gate — the first screen (维护者 2026-11-16; design: docs-plan/login-design/login-screen.css,
// flow: docs-plan/开场动画与登录前置-预案.md).
//
// Flow this component is one box in:
//   **[登录 / 注册]  ← 本文件** → [点击进入] → [开场动画] → [原标题页：代号 + 开始] → [大厅]
//
// It is a full-screen layer over the title screen (which is already mounted behind it — that is why the
// gate never replaces a route). Everything visual is the design draft: `sp-lg-` classes, styles in
// css/screens/authGate.css (copied verbatim from the draft). The only draft-only pieces left out are the
// preview page's own `.doc` / `.frame` rules (they are not in the .css file).
//
// The form is deliberately the same set of requests as matchmaker/public/account-title.js
// (`/mm/api/auth/{captcha,login,register,send-code}`) — those routes are authoritative. The gate keeps no
// session state of its own: on success it fills the same globals account-title.js writes
// (authSession.js adoptAuth) and closes.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.v2.js';
import { html } from '../ui/components.js';
import { PwaInstallButton } from '../ui/device.js';
import { AndroidAppPrompt } from '../ui/androidApp.js';
import { useLang, useLangs, switchLang, langMenuModel } from '../ui/lang.js';
import { data } from '../data.js';
import { uiUrl } from '../ui/assetUrls.js';
import { t, N_ } from '../../../shared/i18n.js';
import { adoptAuth, api, AUTH_CAPTCHA_URL, AUTH_LOGIN_URL, AUTH_REGISTER_URL, AUTH_SEND_CODE_URL, AUTH_RESET_SEND_URL, AUTH_RESET_URL, setGuestChosen } from './authSession.js';

const QQ_EMAIL = /^[1-9][0-9]{4,11}@qq\.com$/;
const PASS_MIN = 8;
const COOLDOWN = 60;

/** The server's `error` code → the player's sentence (the same table account-title.js shows). */
function errorText(code) {
  const MAP = {
    bad_credentials: N_('邮箱或密码错误'),
    email_taken: N_('该邮箱已注册'),
    invalid_email: N_('邮箱格式不正确'),
    invalid_password: N_('密码需 8 位以上'),
    invalid_code: N_('验证码格式不正确'),
    code_required: N_('请先获取验证码'),
    code_expired: N_('验证码已过期，请重新获取'),
    code_wrong: N_('邮箱验证码错误'),
    code_attempts: N_('验证码错误次数过多，请重新获取'),
    too_many_requests: N_('操作过于频繁，请稍后再试'),
    captcha_wrong: N_('图形验证码错误'),
    too_soon: N_('发送太频繁，请稍后再试'),
    too_many_codes: N_('今日验证码发送次数已达上限，请明天再试'),
    // ★ 2026-11-26（玩家：注册发送验证码显示「操作失败」）：服务端在邮件发不出去时回
    //   `mail_failed`（QQ 邮箱 SMTP 授权码失效那类），这里以前没有映射 → 落到兜底「操作失败」，
    //   玩家完全不知道是邮件通道的问题，也不会去联系管理员。
    mail_failed: N_('验证码邮件发送失败（邮件通道异常），请联系管理员'),
    mail_not_configured: N_('验证码邮件未配置，请联系管理员'),
  };
  return MAP[code] ? t(MAP[code]) : t(N_('操作失败，请稍后重试'));
}

/** One labelled field: the draft's `.sp-lg-field` (Latin tag on the left, input on the right). */
function Field({ tag, children, label }) {
  return html`<label class="sp-lg-field">
    <span class="sp-lg-field__tag">${tag}</span>
    ${children}
  </label>`;
}

/**
 * The gate.
 * @param {{ onDone: (how: 'login' | 'register' | 'guest') => void, checkError?: boolean }} props
 *   onDone: the flow continues (main.js then plays the entry film); checkError: the /me probe failed, so the
 *   status line says so instead of claiming a connection
 */
export function AuthGate({ onDone, checkError = false }) {
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { text, tone: 'ok' | 'err' }
  const [captcha, setCaptcha] = useState(null); // { id, svg }
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const captchaId = useRef(null);
  const emailRef = useRef(null);
  const lang = useLang();
  const langs = langMenuModel(useLangs(), lang);
  const assets = data.get('assets');

  const say = (text, tone = 'err') => setMsg(text ? { text, tone } : null);

  /** Fetch a fresh captcha image (and remember its id). */
  async function loadCaptcha() {
    try {
      const r = await api(AUTH_CAPTCHA_URL);
      if (r.body && r.body.ok && r.body.id) {
        captchaId.current = r.body.id;
        setCaptcha({ id: r.body.id, svg: String(r.body.svg || '') });
        setCaptchaText('');
      }
    } catch { /* 图片取不到不影响填表，提交时服务端会再判一次 */ }
  }

  useEffect(() => { loadCaptcha(); }, []);
  useEffect(() => {
    if (!cooldown) return undefined;
    const timer = setInterval(() => setCooldown((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [cooldown > 0]);
  useEffect(() => { emailRef.current?.focus(); }, [mode]);

  /** The shared submit: POST, then either adoptAuth + close, or show the server's sentence. */
  async function submit(url, body, how) {
    if (busy) return;
    setBusy(true);
    say(t(N_('处理中…')), 'ok');
    try {
      const r = await api(url, { method: 'POST', body: JSON.stringify(body) });
      if (!r.body || !r.body.ok) {
        say(errorText(r.body && r.body.error));
        loadCaptcha();
        return;
      }
      adoptAuth(r.body);
      say('');
      onDone(how);
    } catch {
      say(t(N_('网络错误，请稍后重试')));
    } finally {
      setBusy(false);
    }
  }

  function doLogin() {
    const mail = email.trim().toLowerCase();
    if (!QQ_EMAIL.test(mail)) return say(t(N_('请输入正确的 QQ 邮箱')));
    if (!pass) return say(t(N_('请输入密码')));
    if (!captchaText.trim()) return say(t(N_('请输入图形验证码')));
    return submit(AUTH_LOGIN_URL, { email: mail, password: pass, captcha: captchaText.trim(), captchaId: captchaId.current }, 'login');
  }

  async function sendCode() {
    const mail = email.trim().toLowerCase();
    if (!QQ_EMAIL.test(mail)) return say(t(N_('请输入正确的 QQ 邮箱')));
    if (cooldown > 0) return undefined;
    try {
      // ★ 2026-11-22：重置模式发的是「重置密码验证码」（/api/auth/reset/send），不是注册验证码
      const url = mode === 'reset' ? AUTH_RESET_SEND_URL : AUTH_SEND_CODE_URL;
      const r = await api(url, { method: 'POST', body: JSON.stringify({ email: mail }) });
      if (!r.body || !r.body.ok) {
        const retry = Number(r.body && r.body.retryAfter);
        if (Number.isFinite(retry) && retry > 0) setCooldown(Math.min(3600, retry));
        return say(errorText(r.body && r.body.error));
      }
      setCooldown(COOLDOWN);
      return say(t(N_('验证码已发送，请查收邮箱（10 分钟内有效）')), 'ok');
    } catch {
      return say(t(N_('网络错误，请稍后重试')));
    }
  }

  function doRegister() {
    const mail = email.trim().toLowerCase();
    if (!QQ_EMAIL.test(mail)) return say(t(N_('请输入正确的 QQ 邮箱')));
    if (!/^[0-9]{6}$/.test(code.trim())) return say(t(N_('请输入 6 位邮箱验证码')));
    if (pass.length < PASS_MIN) return say(t(N_('密码至少 8 位')));
    if (!captchaText.trim()) return say(t(N_('请输入图形验证码')));
    return submit(AUTH_REGISTER_URL, { email: mail, code: code.trim(), password: pass, captcha: captchaText.trim(), captchaId: captchaId.current }, 'register');
  }

  /**
   * 「忘记密码」：邮箱验证码重置（维护者 2026-11-22）。
   *   成功后**直接登录** —— 密码刚改过，玩家就是本人，不必再输一遍。
   */
  async function doReset() {
    const mail = email.trim().toLowerCase();
    if (!QQ_EMAIL.test(mail)) return say(t(N_('请输入正确的 QQ 邮箱')));
    if (!/^[0-9]{6}$/.test(code.trim())) return say(t(N_('请输入 6 位邮箱验证码')));
    if (pass.length < PASS_MIN) return say(t(N_('密码至少 8 位')));
    if (busy) return undefined;
    setBusy(true);
    say(t(N_('处理中…')), 'ok');
    try {
      const r = await api(AUTH_RESET_URL, {
        method: 'POST', body: JSON.stringify({ email: mail, code: code.trim(), password: pass }),
      });
      if (!r.body || !r.body.ok) return say(errorText(r.body && r.body.error));
      // 重置成功：后端已经把旧会话全部踢掉，这里自动登录一次拿新会话
      const login = await api(AUTH_LOGIN_URL, {
        method: 'POST',
        body: JSON.stringify({ email: mail, password: pass, captcha: captchaText.trim(), captchaId: captchaId.current }),
      });
      if (login.body && login.body.ok) {
        adoptAuth(login.body);
        say('');
        onDone('login');
        return undefined;
      }
      // 自动登录失败（图形验证码填错之类）：密码已经改好了，把玩家留在登录页自己登
      setMode('login');
      say(t(N_('密码已重置，请用新密码登录')));
      loadCaptcha();
      return undefined;
    } catch {
      return say(t(N_('网络错误，请稍后重试')));
    } finally {
      setBusy(false);
    }
  }

  const submitNow = () => (mode === 'login' ? doLogin() : mode === 'reset' ? doReset() : doRegister());
  const onKeyDown = (e) => { if (e.key === 'Enter' && !busy) submitNow(); };

  return html`<div class="sp-lg-screen" data-testid="auth-gate" role="dialog" aria-modal="true" aria-label=${t(N_('登录 / 注册'))}>
    ${/* 安卓浏览器首次进入：登录页就问一次（维护者 2026-11-17：以前只挂在大厅，而玩家第一眼是这一屏，
         大厅又被 html.sp-gate-open 整个隐藏，等于永远问不到） */ null}
    <${AndroidAppPrompt} />
    <div class="sp-lg-bg">
      <img class="sp-lg-bg__art" alt="" src=${uiUrl(assets, 'entry/bkg_01') || ''} />
      <div class="sp-lg-bg__shade"></div>
      <div class="sp-lg-bg__scan"></div>
      <div class="sp-lg-bg__vig"></div>
    </div>
    <span class="sp-lg-corner sp-lg-corner--tl"></span>
    <span class="sp-lg-corner sp-lg-corner--tr"></span>
    <span class="sp-lg-corner sp-lg-corner--bl"></span>
    <span class="sp-lg-corner sp-lg-corner--br"></span>

    <div class="sp-lg-top">
      <div>
        <div class="sp-lg-micro">RHODES ISLAND <b>//</b> SIMULATION SERVICE</div>
        <div class="sp-lg-micro" style="margin-top:3px">TACTICAL CO-OP NODE <b>·</b> <em>02</em></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        ${checkError
          ? html`<span class="sp-lg-status sp-lg-status--bad" data-testid="auth-status"><i class="sp-lg-status__dot"></i>${t(N_('无法连接服务器'))}</span>`
          : html`<span class="sp-lg-status sp-lg-status--ok" data-testid="auth-status"><i class="sp-lg-status__dot"></i>${t(N_('已连接服务器'))}</span>`}
        <div class="sp-lg-lang">
          ${langs.items.map((it) => html`<button key=${it.code} class=${it.on ? 'is-on' : ''} title=${it.title || it.label}
            data-testid=${`auth-lang-${it.code}`} onClick=${() => switchLang(it.code)}>${it.label}</button>`)}
        </div>
      </div>
    </div>

    <div class="sp-lg-main">
      <div class="sp-lg-card">
        <div class="sp-lg-head">
          <div class="sp-lg-head__no">01</div>
          <div class="sp-lg-head__body">
            <div class="sp-lg-head__cn">${t(N_('登录'))}<em> / </em>${t(N_('注册'))}</div>
            <div class="sp-lg-head__en">Alliance Access Terminal</div>
          </div>
        </div>

        <div class="sp-lg-panel">
          <div class="sp-lg-tabs">
            <button class=${`sp-lg-tab${mode === 'login' ? ' is-on' : ''}`} data-testid="auth-tab-login"
              onClick=${() => { setMode('login'); say(''); }}>${t(N_('登录'))}</button>
            <button class=${`sp-lg-tab${mode === 'register' ? ' is-on' : ''}`} data-testid="auth-tab-register"
              onClick=${() => { setMode('register'); say(''); }}>${t(N_('注册'))}</button>
          </div>
          ${mode === 'reset' ? html`<div class="sp-lg-hint sp-lg-hint--reset" data-testid="auth-reset-hint">${t(N_('用邮箱重置密码：填好邮箱后点「发送验证码」，收到 6 位验证码后设置新密码'))}</div>` : null}

          <div class="sp-lg-fields" onKeyDown=${onKeyDown}>
            <${Field} tag="MAIL">
              <input class="sp-lg-field__input" ref=${emailRef} value=${email} autocomplete="username" data-testid="auth-email"
                placeholder=${t(N_('QQ 邮箱（如 10001@qq.com）'))} onInput=${(e) => setEmail(e.currentTarget.value)} />
            <//>
            <p class="sp-lg-hint">${t(N_('仅支持 QQ 号邮箱，QQ 号必须是纯数字；不支持自定义邮箱名'))}</p>

            ${mode !== 'login' ? html`<${Field} tag=${html`MAIL<br />CODE`}>
              <input class="sp-lg-field__input" value=${code} inputmode="numeric" data-testid="auth-code"
                placeholder=${t(N_('6 位邮箱验证码'))} onInput=${(e) => setCode(e.currentTarget.value)} />
              <button class="sp-lg-field__act" data-testid="auth-send-code" disabled=${cooldown > 0}
                onClick=${sendCode}>${cooldown > 0 ? t(N_('{n} 秒后重发'), { n: cooldown }) : t(N_('发送验证码'))}</button>
            <//>` : null}

            <${Field} tag="PASS">
              <input class="sp-lg-field__input" type="password" value=${pass} data-testid="auth-pass"
                autocomplete=${mode === 'login' ? 'current-password' : 'new-password'}
                placeholder=${mode === 'login' ? t(N_('密码')) : mode === 'reset' ? t(N_('新密码（至少 8 位）')) : t(N_('密码（至少 8 位）'))}
                onInput=${(e) => setPass(e.currentTarget.value)} />
            <//>

            <div class="sp-lg-captcha">
              <div class="sp-lg-captcha__pic" title=${t(N_('点击刷新'))} data-testid="auth-captcha-pic" onClick=${loadCaptcha}
                dangerouslySetInnerHTML=${{ __html: captcha ? captcha.svg : '' }}></div>
              <${Field} tag="CODE">
                <input class="sp-lg-field__input" value=${captchaText} autocomplete="off" data-testid="auth-captcha"
                  placeholder=${t(N_('图形验证码'))} onInput=${(e) => setCaptchaText(e.currentTarget.value)} />
              <//>
            </div>

            <button class=${`sp-lg-submit${busy ? ' is-busy' : ''}`} data-testid="auth-submit" disabled=${busy} onClick=${submitNow}>
              ${mode === 'login' ? t(N_('登 录')) : mode === 'reset' ? t(N_('重置密码并登录')) : t(N_('注册并登录'))}
            </button>
            ${/* ★ 2026-11-22（维护者：登录页没有忘记密码）：重置入口。register 模式不显示，重置模式变成「返回登录」 */ null}
            <div class="sp-lg-forgot">
              ${mode === 'reset'
                ? html`<button type="button" class="sp-lg-forgot__link" data-testid="auth-forgot-back" onClick=${() => { setMode('login'); say(''); }}>${t(N_('返回登录'))}</button>`
                : mode === 'login'
                  ? html`<button type="button" class="sp-lg-forgot__link" data-testid="auth-forgot" onClick=${() => { setMode('reset'); say(''); }}>${t(N_('忘记密码？'))}</button>`
                  : null}
            </div>
          </div>

          ${msg ? html`<div class=${`sp-lg-msg ${msg.tone === 'ok' ? 'is-ok' : 'is-err'}`} data-testid="auth-msg">${msg.text}</div>` : null}

          <div class="sp-lg-alt">OR</div>
          <button class="sp-lg-guest" data-testid="auth-guest" onClick=${() => { setGuestChosen(true); onDone('guest'); }}>
            ${t(N_('游客访问'))} <span>${t(N_('· 不登录也能玩，但不能创建同盟 / 添加 AI'))}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="sp-lg-actions">
      <button type="button" class="sp-lg-actions__btn sp-lg-actions__qq" onClick=${() => copyQQ()}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6a2.5 2.5 0 0 1 2.5 2.5v.9c1.1 1.2 1.8 2.8 1.8 4.4 0 .5-.2.8-.5.8-.3 0-.5-.3-.7-.7-.3.5-.7.9-1.1 1.2.4.2.7.4.7.7 0 .5-.9.8-2.7.8s-2.7-.3-2.7-.8c0-.3.3-.5.7-.7-.4-.3-.8-.7-1.1-1.2-.2.4-.4.7-.7.7-.3 0-.5-.3-.5-.8 0-1.6.7-3.2 1.8-4.4v-.9A2.5 2.5 0 0 1 8 1.6Z" /></svg>
        ${t(N_('官方Q群：{qq}', { qq: '312990596' }))}
      </button>
      <${PwaInstallButton} class="sp-lg-actions__btn sp-lg-actions__pwa" />
    </div>

    <div class="sp-lg-foot">
      <div class="sp-lg-foot__keys">
        <span><b>ENTER</b>${t(N_('提交'))}</span>
        <span><b>TAB</b>${t(N_('切换输入'))}</span>
      </div>
      ${/* 维护者 2026-11-16：备案号写在「非官方同人复刻…」**前面**、用 ` · ` 连成一句，
           整组居中（以前是分开的两个 flex 子项，space-between 把备案号甩到最右边）。 */ ''}
      <div class="sp-lg-foot__legal">
        <a class="sp-lg-icp" href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer noopener">${ICP}</a>
        <span aria-hidden="true"> · </span>
        <span>${t('非官方同人复刻 · 游戏素材版权归 上海鹰角网络 / Yostar 所有')}</span>
      </div>
    </div>
  </div>`;
}

const ICP = '鲁ICP备2026010707号-1'; // i18n-ignore: a registration number

/** Copy the QQ group number (the draft's button has no other action; one tap copies it). */
function copyQQ() {
  try {
    navigator.clipboard?.writeText?.('312990596');
  } catch { /* 无剪贴板权限就算了 */ }
}
