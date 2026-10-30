/* ============================================================================
   Metadados da instalação (chave/valor) — configurações e versões de política.
   ========================================================================== */

import { queryAll, queryOne, run, persist } from './db.js';
import { nowISO } from './util.js';

export function getMeta(key, fallback = null) {
  const row = queryOne('SELECT value FROM app_meta WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  run(
    `INSERT INTO app_meta (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, String(value), nowISO()],
  );
  persist();
}

export function allMeta() {
  return Object.fromEntries(queryAll('SELECT key, value FROM app_meta').map((r) => [r.key, r.value]));
}

export function deleteMeta(key) {
  run('DELETE FROM app_meta WHERE key = ?', [key]);
  persist();
}
