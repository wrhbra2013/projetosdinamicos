/* ============================================================================
   Backup, restauração e portabilidade do banco inteiro.
   Formatos: .sqlite (binário) e .pdb.json (JSON com SQLite em base64,
   opcionalmente cifrado com AES-256-GCM).
   ========================================================================== */

import { exportBytes, importBytes, databaseSize } from './db.js';
import { encryptJson, decryptJson, sha256Hex } from './crypto.js';
import { setMeta, getMeta } from './meta.js';
import { audit, verifyChain } from './audit.js';
import { nowISO, download, readFile, bytes } from './util.js';
import { resetAuthState, currentUser } from './auth.js';

function bytesToBase64(array) {
  const arr = array instanceof Uint8Array ? array : new Uint8Array(array);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function backupFilename(ext = 'pdb.json') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  return `projetos-dinamicos-backup-${stamp}.${ext}`;
}

/**
 * Gera um backup completo. Se `passphrase` for informada, o conteúdo é cifrado.
 * Retorna metadados para exibição.
 */
export async function createBackup({ passphrase = '', downloadFile = true } = {}) {
  const raw = exportBytes();
  const chain = await verifyChain();
  const envelope = {
    format: 'projetos-dinamicos/backup',
    version: 1,
    created_at: nowISO(),
    app_version: '1.0.0',
    schema_version: getMeta('schema_version', '1'),
    size_bytes: raw.byteLength,
    audit: { ok: chain.ok, total: chain.total, head: chain.head || null },
    checksum: await sha256Hex(raw),
    sqlite: bytesToBase64(raw),
  };

  let payload;
  let encrypted = false;
  if (passphrase) {
    encrypted = true;
    payload = {
      format: 'projetos-dinamicos/backup-cifrado',
      version: 1,
      created_at: envelope.created_at,
      encrypted: true,
      envelope: await encryptJson(envelope, passphrase),
    };
  } else {
    payload = envelope;
  }

  setMeta('last_backup_at', nowISO());
  if (downloadFile) {
    download(backupFilename(encrypted ? 'pdb.enc.json' : 'pdb.json'),
      JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  }

  await audit({
    action: 'data.export',
    entityType: 'backup',
    entityId: 'full',
    legalBasis: 'consentimento',
    purpose: 'prestacao_servico',
    dataCategories: ['conteudo', 'metadados'],
    detail: {
      cifrado: encrypted,
      tamanho_bytes: raw.byteLength,
      auditoria_integra: chain.ok,
      eventos: chain.total,
    },
  });

  return {
    size: bytes(raw.byteLength),
    encrypted,
    chainOk: chain.ok,
    filename: backupFilename(encrypted ? 'pdb.enc.json' : 'pdb.json'),
  };
}

export async function exportSqliteFile() {
  const raw = exportBytes();
  download(backupFilename('sqlite'), new Blob([raw], { type: 'application/x-sqlite3' }));
  setMeta('last_backup_at', nowISO());
  await audit({
    action: 'data.export',
    entityType: 'backup',
    entityId: 'sqlite',
    legalBasis: 'consentimento',
    purpose: 'prestacao_servico',
    dataCategories: ['conteudo', 'metadados'],
    detail: { formato: 'sqlite', tamanho_bytes: raw.byteLength },
  });
  return { size: bytes(raw.byteLength) };
}

/**
 * Restaura um backup .pdb.json (cifrado ou não) ou um .sqlite binário.
 * ATENÇÃO: substitui integralmente o banco local.
 */
export async function restoreBackup(file, { passphrase = '' } = {}) {
  const isSqlite = /\.sqlite$/i.test(file.name) || file.type === 'application/x-sqlite3';
  let sqliteBytes;

  if (isSqlite) {
    sqliteBytes = new Uint8Array(await readFile(file, 'buffer'));
  } else {
    const text = await readFile(file, 'text');
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('Arquivo JSON inválido.'); }

    let envelope = parsed;
    if (parsed.encrypted) {
      if (!passphrase) throw new Error('Este backup está cifrado. Informe a frase secreta.');
      envelope = await decryptJson(parsed.envelope, passphrase);
    }
    if (envelope.format !== 'projetos-dinamicos/backup') {
      throw new Error('Formato de backup não reconhecido.');
    }
    sqliteBytes = base64ToBytes(envelope.sqlite);
    const checksum = await sha256Hex(sqliteBytes);
    if (envelope.checksum && checksum !== envelope.checksum) {
      throw new Error('Falha na verificação de integridade do backup (checksum).');
    }
  }

  const user = currentUser();
  await importBytes(sqliteBytes);
  resetAuthState();

  const chain = await verifyChain();
  await audit({
    action: 'data.import',
    entityType: 'backup',
    entityId: 'full',
    actor: { id: user?.id || null, label: user?.display_name || 'Sistema', role: user?.role || null },
    legalBasis: 'consentimento',
    purpose: 'prestacao_servico',
    dataCategories: ['conteudo', 'metadados'],
    detail: {
      origem: file.name,
      tamanho_bytes: sqliteBytes.byteLength,
      auditoria_integra: chain.ok,
      eventos: chain.total,
    },
  });

  return { chainOk: chain.ok, total: chain.total, size: bytes(sqliteBytes.byteLength) };
}

export function backupInfo() {
  return {
    size: bytes(databaseSize()),
    lastBackupAt: getMeta('last_backup_at', ''),
    lastExportAt: getMeta('last_export_at', ''),
  };
}
