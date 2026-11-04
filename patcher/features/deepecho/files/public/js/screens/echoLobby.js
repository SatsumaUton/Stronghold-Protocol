// public/js/screens/echoLobby.js — 「深渊回响」的专属大厅（维护者 2026-11-03 定）。
//
// 从大厅第三张卡进入（目前只有管理员进得来），里面有：
//   * 难度三档（险境 / 绝境 / 终极 —— 不给「标准模拟」）
//   * 排行榜（服务端 GET /api/dive/board，Redis 共用，30 台一致）+ 本周最佳
//   * 我的最佳（本机记录，和成就统计一样只存这个浏览器）
//   * 找房间（等价于同盟模拟的「公开同盟」，改名「深潜同盟」；模式未开放前禁用）
//   * 调参（只有管理员看得到；调过参的房间**不进排行榜**）
//   * 开始深潜
//
// 配色沿用模式主题（深紫），样式钩子都在 game-panels.css 的 `.echo-*` 里。
import { useEffect, useMemo, useState } from '../../vendor/hooks.module.js';
import { html, Button } from '../ui/components.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';
import { DIFFICULTY_NAMES } from '../../../shared/constants.js';

/** 深潜开放的难度（与 screens/lobby.js 的 DEEP_ECHO_DIFFICULTIES 一致）。 */
const DIFFICULTIES = ['NORMAL', 'HARD', 'ABYSS'];
const DEFAULT_DIFFICULTY = 'HARD';
/** 本机最佳成绩的存储键。 */
const BEST_KEY = 'sp.echo.best';
/** 榜单默认取多少条。 */
const BOARD_LIMIT = 20;
const WEEK_MS = 7 * 24 * 3600 * 1000;

const readBest = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(BEST_KEY) || 'null');
    return raw && Number.isFinite(raw.depth) ? raw : null;
  } catch { return null; }
};
const writeBest = (rec) => {
  try {
    const old = readBest();
    if (old && old.depth >= rec.depth) return;
    localStorage.setItem(BEST_KEY, JSON.stringify(rec));
  } catch { /* 存不了就算了 */ }
};

/** 把一条成绩格式化成「深度 N · 房间 · 时间」。 */
const rowText = (r) => {
  const when = r.at ? new Date(r.at).toLocaleDateString() : '-';
  return `深度 ${r.depth} · ${r.roomCode || '----'} · ${when}`;
};

export function EchoLobby({ onClose, onStart }) {
  const adminId = useStore((s) => s.adminId === true);
  const [difficulty, setDifficulty] = useState(DEFAULT_DIFFICULTY);
  const [rows, setRows] = useState(null);          // null = 还没加载
  const [err, setErr] = useState(null);
  const [best, setBest] = useState(() => readBest());
  // 管理员调参
  const [curve, setCurve] = useState('aggressive');
  const [eliteEvery, setEliteEvery] = useState(3);
  const [wordCap, setWordCap] = useState(8);
  const [bounty, setBounty] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/dive/board?limit=${BOARD_LIMIT}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (alive) setRows(Array.isArray(j?.rows) ? j.rows : []); })
      .catch((e) => { if (alive) { setRows([]); setErr(e.message || 'load failed'); } });
    return () => { alive = false; };
  }, []);

  const weekBest = useMemo(() => {
    const since = Date.now() - WEEK_MS;
    const recent = (rows || []).filter((r) => (r.at || 0) >= since);
    return recent.length ? Math.max(...recent.map((r) => r.depth)) : null;
  }, [rows]);

  // 调参与默认值一致才算「标准配置」（可进榜）；否则这局不进榜
  const echoConfig = useMemo(() => {
    const cfg = { curve, eliteEvery, wordCap, bounty };
    const standard = curve === 'aggressive' && eliteEvery === 3 && wordCap === 8 && bounty === true;
    return standard ? null : cfg;
  }, [curve, eliteEvery, wordCap, bounty]);

  const start = () => {
    // 本机记一笔（正式成绩由服务端在结算时写榜）
    try { writeBest({ depth: readBest()?.depth ?? 0, difficulty, at: Date.now() }); } catch { /* ignore */ }
    onStart({ difficulty, echo: echoConfig });
  };

  return html`<section class="echo-lobby" aria-label=${t('深渊回响')}>
    <div class="echo-lobby__sheet">
      <header class="echo-lobby__head">
        <div class="echo-lobby__title">
          <h2>${t('深渊回响')}</h2>
          <span class="echo-lobby__sub">${t('无尽深潜 · 深度即成绩')}</span>
        </div>
        <${Button} size="sm" variant="ghost" icon="close" onClick=${onClose}>${t('返回大厅')}<//>
      </header>

      <div class="echo-lobby__cols">
        <div class="echo-lobby__left">
          <section class="echo-panel">
            <h3 class="echo-panel__h">${t('难度')}</h3>
            <div class="echo-lobby__diffs">
              ${DIFFICULTIES.map((d) => html`<button key=${d} type="button"
                  class=${`echo-diff${difficulty === d ? ' is-sel' : ''}`}
                  onClick=${() => setDifficulty(d)}>
                  <b>${t(DIFFICULTY_NAMES[d] || d)}</b>
                  ${difficulty === d ? html`<span class="echo-diff__tick" aria-hidden="true">✓</span>` : null}
                </button>`)}
            </div>
            <p class="echo-lobby__note">${t('标准模拟不进深潜：它的强度曲线是按前 14 回合配的，R15 之后压力太低。')}</p>
          </section>

          <section class="echo-panel">
            <h3 class="echo-panel__h">${t('我的成绩')}</h3>
            <div class="echo-stats">
              <div class="echo-stat">
                <span class="echo-stat__k">${t('本机最佳')}</span>
                <b class="echo-stat__v">${best ? best.depth : '—'}</b>
              </div>
              <div class="echo-stat">
                <span class="echo-stat__k">${t('本周最佳')}</span>
                <b class="echo-stat__v">${weekBest == null ? '—' : weekBest}</b>
              </div>
            </div>
          </section>
        </div>

        <section class="echo-panel echo-panel--board">
          <h3 class="echo-panel__h">${t('排行榜')}</h3>
          ${rows == null
            ? html`<p class="echo-lobby__note">${t('读取中…')}</p>`
            : rows.length === 0
              ? html`<div class="echo-empty">
                  <b>${err ? t('排行榜暂时不可用') : t('还没有人留下深度记录')}</b>
                  <span>${t('第一条深度记录会出现在这里。')}</span>
                </div>`
              : html`<ol class="echo-lobby__board">
                  ${rows.map((r) => html`<li key=${r.member} class=${r.rank <= 3 ? 'is-top' : ''}>
                    <b class="num">${r.rank}</b><span>${rowText(r)}</span></li>`)}
                </ol>`}
        </section>
      </div>

      <footer class="echo-lobby__foot">
        <${Button} variant="secondary" icon="search" disabled=${true}
          title=${t('模式未开放前无法浏览房间')}>${t('深潜同盟（找房间）')}<//>
        <${Button} variant="primary" size="lg" iconRight="chevrons" onClick=${start}>${t('开始深潜')}<//>
      </footer>
      ${echoConfig ? html`<p class="echo-lobby__note echo-lobby__note--warn">${t('当前为调参配置，这一局不会进入排行榜。')}</p>` : null}

      ${adminId ? html`<details class="echo-lobby__tune">
        <summary>${t('调参（仅管理员 · 调过参的房间不进排行榜）')}</summary>
        <div class="echo-lobby__tune-grid">
          <label>${t('曲线')}
            <select value=${curve} onChange=${(e) => setCurve(e.target.value)}>
              <option value="gentle">${t('保守')}</option>
              <option value="standard">${t('标准')}</option>
              <option value="aggressive">${t('激进（默认）')}</option>
            </select>
          </label>
          <label>${t('精英间隔（层）')}
            <input type="number" min="1" max="10" value=${eliteEvery} onChange=${(e) => setEliteEvery(Number(e.target.value) || 3)} />
          </label>
          <label>${t('词条上限')}
            <input type="number" min="1" max="8" value=${wordCap} onChange=${(e) => setWordCap(Number(e.target.value) || 8)} />
          </label>
          <label>${t('深潜悬赏')}
            <input type="checkbox" checked=${bounty} onChange=${(e) => setBounty(e.target.checked === true)} />
          </label>
        </div>
      </details>` : null}
    </div>
  </section>`;
}
