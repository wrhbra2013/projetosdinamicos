/* ============================================================================
   Camada de banco — SQLite compilado para WebAssembly (sql.js).
   O banco vive em memória e é persistido no IndexedDB do navegador.
   Nenhum dado sai do dispositivo sem ação explícita do usuário.
   ========================================================================== */

import { nowISO, debounce } from './util.js';

const IDB_NAME = 'projetosdinamicos';
const IDB_STORE = 'kv';
const IDB_KEY = 'database';
const SCHEMA_URL = new URL('../../../sql/schema.sql', import.meta.url);
const SEED_URL = new URL('../../../sql/seed_reference.sql', import.meta.url);
const WASM_BASE = new URL('../../../vendor/sql.js/', import.meta.url);

let SQL = null;
let db = null;
let initPromise = null;
let persistTimer = null;
let persistChain = Promise.resolve();
let lastPersistAt = null;
let channel = null;

export const SCHEMA_VERSION = 1;

/* ---------------------------------- IndexedDB ----------------------------- */
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ------------------------------- Carregamento ----------------------------- */
async function fetchText(url) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (err) {
    throw new Error(
      'Não foi possível carregar o esquema SQLite. Abra a plataforma por um servidor HTTP '
      + '(ex.: GitHub Pages ou "python3 -m http.server") em vez de file://.',
    );
  }
  if (!res.ok) throw new Error(`Falha ao carregar ${url.pathname} (HTTP ${res.status}).`);
  return res.text();
}

function execMulti(sql) {
  db.exec(sql);
}

function markDirty() {
  if (persistTimer) persistTimer();
}

async function applySchema() {
  const [schema, seed] = await Promise.all([fetchText(SCHEMA_URL), fetchText(SEED_URL)]);
  db.exec(schema);
  db.exec(seed);
  const exists = queryOne('SELECT version FROM schema_migrations WHERE version = ?', [SCHEMA_VERSION]);
  if (!exists) {
    run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      [SCHEMA_VERSION, 'esquema-inicial', nowISO()]);
  }
}

export async function init() {
  if (db) return DB;
  if (initPromise) { await initPromise; return DB; }
  initPromise = (async () => {
    if (typeof globalThis.initSqlJs !== 'function') {
      throw new Error('sql.js não foi carregado. Verifique vendor/sql.js/sql-wasm.js.');
    }
    SQL = await globalThis.initSqlJs({
      locateFile: (file) => new URL(file, WASM_BASE).href,
    });

    const stored = await idbGet(IDB_KEY);
    if (stored) {
      try {
        db = new SQL.Database(stored instanceof Uint8Array ? stored : new Uint8Array(stored));
        const check = db.exec('PRAGMA integrity_check;');
        const result = check?.[0]?.values?.[0]?.[0];
        if (result !== 'ok') throw new Error(`integrity_check: ${result}`);
      } catch (err) {
        console.error('Banco local corrompido, criando novo.', err);
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }

    db.run('PRAGMA foreign_keys = ON;');
    await applySchema();
    db.run('PRAGMA foreign_keys = ON;');
    await persistNow();

    if ('BroadcastChannel' in globalThis) {
      channel = new BroadcastChannel('pd-db');
      channel.onmessage = (event) => {
        if (event.data?.type === 'persist' && event.data.tab !== tabId) {
          globalThis.dispatchEvent(new CustomEvent('pd:external-change', { detail: event.data }));
        }
      };
    }

    globalThis.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persistNow();
    });
    globalThis.addEventListener('pagehide', () => { persistNow(); });

    return DB;
  })();
  await initPromise;
  return DB;
}

const tabId = Math.random().toString(36).slice(2);

/* -------------------------------- Consultas ------------------------------- */
export function queryAll(sql, params = []) {
  ensure();
  const stmt = db.prepare(sql);
  try {
    if (params && (Array.isArray(params) ? params.length : Object.keys(params).length)) {
      stmt.bind(params);
    }
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

export function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || null;
}

export function scalar(sql, params = []) {
  const row = queryOne(sql, params);
  if (!row) return null;
  return Object.values(row)[0];
}

export function run(sql, params = []) {
  ensure();
  db.run(sql, params);
  const changes = db.getRowsModified();
  markDirty();
  return changes;
}

/** Transação síncrona. O callback não pode ser async. */
export function tx(fn) {
  ensure();
  db.run('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.run('COMMIT');
    markDirty();
    return result;
  } catch (err) {
    try { db.run('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

function ensure() {
  if (!db) throw new Error('Banco não inicializado. Chame DB.init() primeiro.');
}

/* -------------------------------- Persistência ---------------------------- */
export function persist() {
  if (!persistTimer) persistTimer = debounce(() => { persistNow(); }, 400);
  persistTimer();
}

export function persistNow() {
  if (!db) return Promise.resolve();
  persistChain = persistChain.then(async () => {
    const bytes = db.export();
    await idbPut(IDB_KEY, bytes);
    lastPersistAt = new Date().toISOString();
    try {
      channel?.postMessage({ type: 'persist', at: lastPersistAt, tab: tabId });
    } catch { /* canal fechado */ }
    globalThis.dispatchEvent(new CustomEvent('pd:persisted', { detail: { at: lastPersistAt } }));
  }).catch((err) => {
    console.error('Falha ao persistir o banco', err);
    globalThis.dispatchEvent(new CustomEvent('pd:persist-error', { detail: err }));
  });
  return persistChain;
}

export function lastPersistedAt() {
  return lastPersistAt;
}

/* ----------------------------- Exportar / importar ------------------------ */
export function exportBytes() {
  ensure();
  return db.export();
}

export function databaseSize() {
  try { return exportBytes().byteLength; } catch { return 0; }
}

export function exportSqlDump() {
  ensure();
  return db.export(); // arquivo .sqlite binário
}

export async function importBytes(bytes) {
  if (!SQL) throw new Error('Banco não inicializado.');
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const header = new TextDecoder().decode(arr.slice(0, 16));
  if (!header.startsWith('SQLite format 3')) {
    throw new Error('Arquivo inválido: não é um banco SQLite.');
  }
  const candidate = new SQL.Database(arr);
  const check = candidate.exec('PRAGMA integrity_check;');
  const result = check?.[0]?.values?.[0]?.[0];
  if (result !== 'ok') {
    candidate.close();
    throw new Error(`Banco inválido (integrity_check: ${result}).`);
  }
  const tables = candidate.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users';",
  );
  if (!tables.length) {
    candidate.close();
    throw new Error('O arquivo não contém o esquema do Projetos Dinâmicos.');
  }
  db.close();
  db = candidate;
  db.run('PRAGMA foreign_keys = ON;');
  await persistNow();
  return true;
}

export async function resetDatabase() {
  if (db) { db.close(); db = null; }
  await idbDelete(IDB_KEY);
  initPromise = null;
  await init();
}

export function isReady() {
  return Boolean(db);
}

export const DB = { init, queryAll, queryOne, scalar, run, tx, persist, persistNow, exportBytes, importBytes, resetDatabase, isReady };
export default DB;
