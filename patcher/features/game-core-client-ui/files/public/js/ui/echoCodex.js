// public/js/ui/echoCodex.js — 「深渊图鉴」（维护者 2026-11-06）：深渊回响大厅顶部右侧的按钮 + 全屏浮层。
//
// 内容**不在前端写死**：整份清单来自 `GET /api/deepecho/codex`（server/match/match/echoCodex.js，
// 从祝福 / 诅咒 / 侵蚀词条 / 盟约投影这几张表 + 祭坛补给常量生成）。所以改了表，图鉴自动跟上。
// 大厅只负责按钮与开关；浮层第一次打开才请求，之后复用同一份数据。
import { useEffect, useState } from '../../vendor/hooks.module.v2.js';
import { html, Button, Icon, Modal } from './components.js';
import { t } from '../../../shared/i18n.js';

const SECTION_ICON = {
  blessing: 'target',
  projection: 'rook',
  curse: 'alert',
  word: 'enemy',
  altar: 'coin',
  supply: 'gift',
  rules: 'info',
};

/** 一个分类的条目列表。 */
function CodexList({ items }) {
  return html`<ul class="echo-codex__list">
    ${items.map((it, i) => html`<li key=${`${it.name}-${i}`} class=${`echo-codex__item${it.rarity ? ` is-${it.rarity}` : ''}`}>
      <div class="echo-codex__head">
        <b class="echo-codex__name">${it.name}</b>
        ${it.tag ? html`<span class="echo-codex__tag">${it.tag}</span>` : null}
      </div>
      <p class="echo-codex__desc">${it.desc}</p>
    </li>`)}
  </ul>`;
}

/** 深渊图鉴：`open` 控制显隐，`onClose` 关掉。 */
export function EchoCodex({ open, onClose }) {
  const [codex, setCodex] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState(null);
  useEffect(() => {
    if (!open || codex || failed) return undefined;
    let stop = false;
    (async () => {
      try {
        // ★ 2026-11-21：带上版本 —— 规程房里要看到规程的盟约投影文本（缺省 = 第二期下半）
        let ver = null;
        try { ver = globalThis.localStorage?.getItem('sp.pref.lobby.version'); } catch { /* ignore */ }
        const q = ver && ver !== 'act2autochess' ? '?version=' + encodeURIComponent(ver) : '';
        const res = await fetch(`/api/deepecho/codex${q}`, { cache: 'no-store' });
        const body = res.ok ? await res.json() : null;
        if (stop) return;
        if (!body || !Array.isArray(body.sections) || !body.sections.length) { setFailed(true); return; }
        setCodex(body);
        setTab((cur) => cur || body.sections[0].id);
      } catch {
        if (!stop) setFailed(true);
      }
    })();
    return () => { stop = true; };
  }, [open, codex, failed]);

  const sections = codex?.sections || [];
  const current = sections.find((s) => s.id === tab) || sections[0] || null;

  return html`<${Modal} open=${open} onClose=${onClose} title=${t('深渊图鉴')} class="echo-codex is-echo" data-testid="echo-codex-dialog"
    actions=${html`<${Button} onClick=${onClose}>${t('关闭')}<//>`}>
    ${!codex && !failed ? html`<p class="echo-codex__state">${t('正在读取图鉴…')}</p>` : null}
    ${failed ? html`<p class="echo-codex__state is-error">${t('图鉴读取失败，请稍后重试。')}</p>` : null}
    ${current ? html`
      <nav class="echo-codex__tabs" role="tablist" aria-label=${t('深渊图鉴')}>
        ${sections.map((s) => html`<button key=${s.id} type="button" role="tab"
          aria-selected=${current.id === s.id ? 'true' : 'false'}
          class=${`echo-codex__tab${current.id === s.id ? ' is-on' : ''}`}
          data-testid=${`echo-codex-tab-${s.id}`}
          onClick=${() => setTab(s.id)}>
          ${SECTION_ICON[s.id] ? html`<${Icon} name=${SECTION_ICON[s.id]} />` : null}
          <span>${t(s.name)}</span>
          <i class="num">${s.items.length}</i>
        </button>`)}
      </nav>
      <section class="echo-codex__body" role="tabpanel">
        <p class="echo-codex__note">${t(current.note)}</p>
        <${CodexList} items=${current.items} />
      </section>
    ` : null}
  <//>`;
}

/** 大厅顶部右侧的「深渊图鉴」按钮（受控：`onOpen` 交给大厅去开浮层）。 */
export function EchoCodexButton({ onOpen }) {
  return html`<button type="button" class="echo-codexbtn" data-testid="echo-codex" onClick=${onOpen}
    title=${t('深渊图鉴：祝福 / 特殊祝福 / 诅咒 / 侵蚀词条 / 祭坛 / 补给 / 规则')}>
    <span class="echo-codexbtn__label">${t('深渊图鉴')}</span>
    <i class="echo-codexbtn__sub">CODEX</i>
  </button>`;
}
