// server/testMode.js — whether this process may open test rooms (DESIGN §34.8 phase 2).
// The decision uses the address the server bound, never the HTTP peer. A public listener
// (and a wildcard bind) stays off unless the owner set SP_TEST_MODE=force. An unknown host
// fails closed, so the gate stays off until the listen address is known.
//
// [ASSUMED] unset / 0 / off / false / no / any other word is off. 1 / true / yes / on / local
// is the local-and-LAN mode. Only the exact word force enables a public or wildcard listener.
// A reverse proxy in front of loopback is still a public deployment: the process only sees the
// bind address, the same judgment as SP_PLUGIN_SCRIPTS=trusted-force.

import { isIP } from 'node:net';
import { trustedHostAllowed } from './plugins/trusted.js';

const LOCAL = new Set(['1', 'true', 'yes', 'on', 'local']);

/** @param {unknown} raw @returns {'off'|'local'|'force'} */
export function parseTestModeEnv(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'force') return 'force';
  if (LOCAL.has(s)) return 'local';
  return 'off';
}

/**
 * @param {'off'|'local'|'force'|string} mode
 * @param {string} host the bound address (empty until listen)
 * @returns {{ enabled: boolean, warn: string|null }}
 */
export function testModeGate(mode, host) {
  const m = mode === 'force' || mode === 'local' ? mode : 'off';
  if (m === 'off') return { enabled: false, warn: null };
  const known = typeof host === 'string' && isIP(host) !== 0;
  if (!known) return { enabled: false, warn: null };
  const local = trustedHostAllowed(host, 'trusted');
  if (m === 'local' && !local) {
    return {
      enabled: false,
      warn: 'SP_TEST_MODE=1 ignored on a public or wildcard listener. Set SP_TEST_MODE=force to enable it anyway.',
    };
  }
  if (m === 'force' && !local) {
    return {
      enabled: true,
      warn: 'SP_TEST_MODE=force enables test rooms on a public or wildcard listener. A reverse proxy in front of loopback is still a public deployment.',
    };
  }
  return { enabled: true, warn: null };
}
