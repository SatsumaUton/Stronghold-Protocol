// server/match/match/echoCodex.js — 「深渊图鉴」的数据源（维护者 2026-11-06）。
//
// 玩家要一本能翻的图鉴：祝福 / 特殊祝福（盟约投影）/ 诅咒 / 侵蚀词条 / 深渊祭坛 / 深渊补给 / 规则设定。
// **不要手写第二份文案**：每一节都直接从现有的表里取（ECHO_BLESSINGS、ECHO_CURSES、ECHO_WORDS、
// ECHO_PROJECTIONS + echoPhase 里的祭坛常量），这样改了祝福忘改图鉴这种漂移不可能发生。
// 只有「祭坛 / 补给 / 规则」这几节是流程说明，它们没有数据表，写在这里，改数值时一起改。
//
// 客户端：public/js/ui/echoCodex.js（大厅顶部右侧的「深渊图鉴」按钮），
// 接口：GET /api/deepecho/codex（server/http/routes.js，只读、可缓存）。
import {
  ECHO_BLESSINGS, ECHO_BLESSING_LATE_FROM, ECHO_BLESSING_LATE_MUL, ECHO_BLESSING_MAX,
  ECHO_BLESSING_RARITY_LABEL, ECHO_BLESSING_REFRESH_MAX, echoBlessingOneShot,
} from './echoBlessing.js';
import { ECHO_CURSES, ECHO_CURSE_RARITY_LABEL, ECHO_ROUND_CURSES } from './echoCurse.js';
import { ECHO_PROJECTIONS, ECHO_PROJECTION_OPTIONS, projectionsForGd } from './echoProjection.js';
import { ECHO_WORDS } from './echoWords.js';
// 祭坛那一节**从商品目录生成**（维护者 2026-11-07：商品从 3 件扩到 20 件后，手写的那份立刻过期了）。
// 目录在 echoPhase.js（它不反过来引 echoCodex，所以没有循环依赖）。
import { ECHO_ALTAR_GOODS, ECHO_ALTAR_SLOTS, ECHO_ALTAR_DEPLOY_STEP, ECHO_ALTAR_DONATE_STEPS } from './echoPhase.js';

/** 稀有度的展示顺序（普通 → 传说）。 */
const RARITY_ORDER = Object.freeze({ common: 0, rare: 1, epic: 2 });

const byRarity = (a, b) => (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9);

/** 一条图鉴条目：名字 / 说明 / 角标（稀有度、时机、来源）。 */
// `id`：只有来自数据表（祝福 / 诅咒 / 词条 / 投影）的条目才有，管理员面板按它发 g.test
// （维护者 2026-11-17：深渊回响里要能用管理员工具加祝福 / 诅咒 / 侵蚀 / 投影）。
const item = (name, desc, tag = '', rarity = null, id = null) => ({ name, desc: String(desc || ''), tag, rarity, ...(id ? { id } : {}) });

/**
 * 图鉴的全部内容。纯数据（可 JSON），没有任何运行时状态 —— 同一个进程里每个玩家看到的一样。
 * @returns {{ version: number, sections: Array<{ id: string, name: string, note: string, items: Array<object> }> }}
 */
/**
 * 图鉴内容。`gd` 可选：给了就按该版本的核心盟约生成「盟约投影」一节（维护者 2026-11-21）。
 * 不给时保持原样（写死的 8 条），所以 HTTP 接口的默认响应不变。
 * @param {any} [gd]
 */
export function buildEchoCodex(gd = null) {
  const blessings = ECHO_BLESSINGS.map((b) => item(
    b.name,
    b.desc,
    [ECHO_BLESSING_RARITY_LABEL[b.rarity] || '', echoBlessingOneShot(b) ? '一次性' : ''].filter(Boolean).join(' · '),
    b.rarity,
    b.id,
  )).sort(byRarity);

  const curses = [
    ...ECHO_CURSES.filter((c) => c.live !== false).map((c) => item(
      c.name, c.desc,
      [ECHO_CURSE_RARITY_LABEL[c.rarity] || '', c.scope === 'run' ? '整局' : '本回合'].filter(Boolean).join(' · '),
      c.rarity,
      c.id,
    )),
    ...ECHO_ROUND_CURSES.map((c) => item(
      c.name, c.desc,
      [ECHO_CURSE_RARITY_LABEL[c.rarity] || '', '本回合'].filter(Boolean).join(' · '),
      c.rarity,
      c.id,
    )),
  ].sort(byRarity);

  const projections = projectionsForGd(gd).map((p) => item(
    p.name,
    p.desc,
    `满档 ${p.tier} 人`,
    null,
    p.id,
  ));

  const words = ECHO_WORDS.map((w) => item(w.name, w.desc, '敌方', null, w.id));

  return {
    version: 2,
    sections: [
      {
        id: 'blessing',
        name: '祝福',
        note: `每 ${5} 层一次三选一，同时最多持有 ${ECHO_BLESSING_MAX} 条（一次性祝福用掉就出列）；每局可刷新 ${ECHO_BLESSING_REFRESH_MAX} 次。`,
        items: blessings,
      },
      {
        id: 'projection',
        name: '特殊祝福',
        note: `盟约投影：16 层起每 10 层，每人各自从 ${ECHO_PROJECTION_OPTIONS} 条候选里选一条（各选各的，互不影响、不用等队友），按满档生效且让你自己的全体干员都算该盟约成员；不占祝福名额，同一时间只有一条，选新的会替换旧的。`,
        items: projections,
      },
      {
        id: 'curse',
        name: '诅咒',
        note: '定期挂上的负面词条：整局型一直有效，本回合型只在这一回合。层数越深越容易抽到高稀有度。',
        items: curses,
      },
      {
        id: 'word',
        name: '侵蚀词条',
        note: '每回合随机挂到敌人身上的强化（对一场战斗生效），深度越深条数越多。',
        items: words,
      },
      {
        id: 'altar',
        name: '深渊祭坛',
        note: `16 层起出现，每次开启从 ${ECHO_ALTAR_GOODS.length} 件商品里随机上架 ${ECHO_ALTAR_SLOTS} 件；按回合的商品在本回合限次，整局唯一的商品只能买一次。价格随深度微涨，「永久」每 5 层 +${ECHO_ALTAR_DEPLOY_STEP} 且不封顶。没达成条件的商品（生命已满 / 祝福已满 / 没有诅咒 / 账户没钱 …）按钮直接禁用，点了也不扣钱。`,
        items: [
          ...ECHO_ALTAR_GOODS.map((g) => {
            const parts = [];
            if (g.scope === 'match') {
              parts.push('整局 1 次');
              if (g.team) parts.push('全队共享');
              if (g.every5) parts.push('每 5 层');
            } else {
              parts.push(`每回合 ${g.limit} 次`);
            }
            parts.push(`基础价 ${g.base}`);
            return item(g.name, g.desc, parts.join(' · '));
          }),
          // 存钱（维护者 2026-11-06）：它是**搬钱**，不是消费 —— 这一条写清楚，
          // 免得玩家以为「存进去」也算花掉了（2026-11-08 玩家反馈过：来回存取能把「本回合每花费 3 资金」刷满）。
          //
          // ★ 2026-11-08（维护者：「深渊图鉴中出现了 2 个献祭 · 提现」）：
          //   「献祭 · 提现」**已经在 `ECHO_ALTAR_GOODS` 里**（id `cash`，上面的 map 会生成一条），
          //   这里以前又手写了一条同名条目 → 图鉴里同一件商品出现两次，两条的角标和文案还不一样。
          //   现在只保留商品目录那一条（它是唯一事实来源，价格 / 限购跟着代码走），
          //   这里只补目录里**没有**的「捐献 · 存钱」（存钱不是商品）。
          item(
            '捐献 · 存钱',
            `把手上的资金存进祭坛账户（${ECHO_ALTAR_DONATE_STEPS.join(' / ')} 一档），跨回合不会清零；买献祭时优先从这笔钱扣。存钱是转账，不算「本回合花费」，也不会触发「每花费 N 资金」类的特质。`,
            '随时可用',
          ),
        ],
      },
      {
        id: 'supply',
        name: '深渊补给',
        note: '16 层起，每回合每人一次三选一；全队共享同一个补给位，选到的临时词条只在这一回合生效。',
        items: [
          item('补给', '从三条临时词条里选一条，只在本回合生效。', '每回合 1 次'),
        ],
      },
      {
        id: 'rules',
        name: '规则与设定',
        note: '这一节的数字都来自代码里的常量，改数值时请一起改。',
        items: [
          item('深度即成绩', '打完最后一个领袖后继续往下潜，能潜多深就是成绩；深度没有上限。'),
          item('祝福节奏', `每 5 层一次三选一，全队投票决定；护盾 / 弃选 / 刷新投票都要过半（${'⌈0.75n⌉'}）。`),
          item('深层强化', `${ECHO_BLESSING_LATE_FROM} 层起，数值型祝福的效果 ×${ECHO_BLESSING_LATE_MUL}（计数类与资金类不放大）。`),
          item('盟约投影节奏', '16 / 26 / 36 … 层，每 10 层一次，每人各自三选一（各选各的，互不影响）；投影不占祝福名额，按满档生效。'),
          item('深渊祭坛', `16 层起出现，${ECHO_ALTAR_GOODS.length} 种商品每次随机上架 ${ECHO_ALTAR_SLOTS} 种；本回合消耗类按回合限购，永久收益类整局 1 次（「永久」部署位每 5 层 +${ECHO_ALTAR_DEPLOY_STEP}，不封顶）。`),
          item('深渊补给', '16 层起每回合一次，选到的临时词条只在这一回合生效。'),
          item('侵蚀词条', '每回合随机挂到敌人身上，深度越深越多；诅咒「侵蚀」可以提高上限。'),
          item('隐藏核心', '只在第 15 层判定；25 / 35 / 45 层打赢返场 boss 不会跳层。'),
          item('返场 boss', '25 / 35 层起会返场，血量按深度 ×1.25 / 层，每次随机换一只（含隐藏 boss）。'),
          item('团队血池', 'boss 回合结束会复位团队血池，队友倒地后仍可被救。'),
          item('频次怪', '器物类敌人「打 N 下」：1–15 层用原版血量，16 层起按深度给绝对血量。'),
          item('独立卡池', '深潜强制独立卡池，重刷本局会重建卡池（不会沿用开局那一池）。'),
        ],
      },
    ],
  };
}
