// Editable advisory knowledge, NOT generated game data. Every recommendation is [ASSUMED].
// Names below are source labels for the AI catalogue, not interface msgids.
// i18n-ignore: maintainer's Chinese strategy names, retained alongside stable IDs
const source = 'Maintainer first-hand/community guidance, 2026-10-19; docs/AI-STRATEGY.md';
export const COMMUNITY = {
  revision: '2026-10-19',
  mains: [
    ['band_duyaoy', 'yanShip'], ['band_ermengard', 'egirShip'], ['band_pepe', 'sargonShip'],
    ['band_paganini', 'lateranoShip'], ['band_harold', 'victoriaShip'], ['band_chiave', 'siracusaShip'],
    ['band_emperor', 'kazimierzShip'], ['band_narant', 'sargonShip'], ['band_sciurus', 'kjeragShip'],
    ['band_clementia', 'egirShip'], ['band_mlynar', 'kazimierzShip'],
  ].map(([band, main]) => ({ band, main, source })),
  pairs: [
    ['lateranoShip', ['preciShip', 'skillfulShip']],
    ['sargonShip', ['preciShip', 'swiftShip', 'skillfulShip']],
    ['victoriaShip', ['arcaneShip']], ['siracusaShip', ['arcaneShip']], ['yanShip', ['arcaneShip']],
    ['kjeragShip', ['arcaneShip', 'preciShip', 'skillfulShip']],
    ['kazimierzShip', ['raidShip', 'indomShip']], ['egirShip', ['raidShip', 'indomShip']],
  ].map(([main, subs]) => ({ main, subs, source })),
  builds: [
    { name: '卡谢', bonds: ['kazimierzShip', 'kjeragShip'], status: 'community', source }, // i18n-ignore: AI knowledge data (community build / operator names matched against game data), never shown in the UI
    { id: 'meter-backwards', name: '电表倒转', bonds: ['visiShip', 'investShip'], status: 'community', // i18n-ignore: AI knowledge data (community build / operator names matched against game data), never shown in the UI
      role: 'economy', archetype: 'cycle', source,
      // Maintainer-provided summaries of the community write-ups. Videos are references, not verified transcripts.
      sources: ['https://www.qieyou.com/content/148509', 'https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316',
        'https://www.bilibili.com/video/BV126wqzqE7f/', 'https://www.bilibili.com/video/BV1m2wuzfEMA/',
        'https://www.bilibili.com/video/BV1U3yVBtEan/'],
      shopHold: 4, upgradeSchedule: [{ round: 3, level: 2 }, { round: 4, level: 3 }, { round: 6, level: 4 }],
      stages: ['Establish cheap survival and economy members.', 'Activate investors; grow investor/foresight layers before cycling.',
        'Hold the feasible shop level, refresh little, buy cheap useful gain effects; sell only surplus copies.',
        'Feed damage bonds without losing the engine or enemy counters.'],
      preconditions: ['A feasible shop-level hold', 'Distinct investors active', 'A budget/funds source with its actual payout timing'],
      avoid: ['Competing for the same cheap shared pool', 'Early enemy pressure exceeds the survival board'],
      claims: [
        { rule: 'foresightGlobalDiscount', value: 100, version: 'part 1', source: 'https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316' },
        { rule: 'investorTriple', value: 70, version: 'part 1', source: 'https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316' },
      ],
      eventClaims: [{ operator: '山', event: 'SERVER_GAIN', source: 'https://www.qieyou.com/content/148509' }], // i18n-ignore: AI knowledge data (community build / operator names matched against game data), never shown in the UI
      variants: [
        { id: 'yan-victoria', damageBonds: ['yanShip', 'victoriaShip', 'arcaneShip'],
          namedMembers: ['伊桑', '万顷', '林', '山', '琳琅诗怀雅'], package: true, source: 'https://www.qieyou.com/content/148509' }, // i18n-ignore: AI knowledge data (community build / operator names matched against game data), never shown in the UI
        { id: 'suzuran-pinus', damageBonds: ['kazimierzShip', 'swiftShip'], namedMembers: ['焰尾'], band: 'band_lisa', // i18n-ignore: AI knowledge data (community build / operator names matched against game data), never shown in the UI
          source: 'https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316' },
        { id: 'siracusa', damageBonds: ['siracusaShip', 'swiftShip'], namedMembers: ['忍冬'], // i18n-ignore: AI knowledge data (community build / operator names matched against game data), never shown in the UI
          source: 'https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316' },
        { id: 'kjerag', damageBonds: ['kjeragShip', 'preciShip', 'skillfulShip'], namedMembers: ['雪猎', '银灰'], // i18n-ignore: AI knowledge data (community build / operator names matched against game data), never shown in the UI
          source: 'https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316' },
      ],
    },
  ],
  roles: [
    { band: 'band_ioleta', role: 'safety-net', main: 'steadShip', source,
      advice: 'Cheap elites and three steadfast members can cover a professional team with weak early matchups.' },
    { band: 'band_fang', role: 'supplier', source,
      advice: 'Buy missing professional-team operators for beacon transfer; check the automatic recipient and next-round delivery.' },
  ],
};
