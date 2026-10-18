// Registry only: implementations import the contract, not this module, to avoid registration/import cycles.
import { createBotRegistry, defineBotStrategy } from './botStrategyContract.js';
import { ADAPTIVE_BOT, IOLETA_ADAPTIVE_BOT } from './botAdaptive.js';
import { EXTERNAL_BOT } from './externalAI.js';
import { IOLETA_BOT } from './botIoleta.js';

// Registration does not enable external IO: the operator must select and configure it.
export const BOT_STRATEGIES = createBotRegistry([EXTERNAL_BOT, IOLETA_BOT, ADAPTIVE_BOT, IOLETA_ADAPTIVE_BOT]);

/** @param {string | import('./botStrategyContract.js').BotStrategyDefinition} [selection] */
export function getBotStrategy(selection = 'legacy', registry = BOT_STRATEGIES) {
  // An unset or empty selection means the original bot, at startup and in every match/tool.
  if (selection === '') selection = 'legacy';
  if (selection && typeof selection === 'object') return defineBotStrategy(selection);
  if (typeof selection !== 'string' || !Object.hasOwn(registry, selection)) {
    throw new Error(`Unknown bot strategy: ${String(selection)}; available: ${Object.keys(registry).join(', ')}`);
  }
  return registry[selection];
}
