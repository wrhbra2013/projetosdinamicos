/* ============================================================================
   Sincronização opcional com backend SQLite (install_api.sh).
   Modelo: snapshot com resolução last-write-wins por updated_at.
   O backend é opcional — a plataforma funciona 100% local sem ele.
   ========================================================================== */

import { queryAll, queryOne, run, tx, persistNow } from './db.js';
import { audit } from './audit.js';
import { nowISO, uid } from './util.js';
import { randomHex } from './crypto.js';

const CONFIG_KEY = 'pd.server_config';

const SYNC_TABLES = ['users', 'projects', 'project_members', 'ideas', 'idea_votes', 'comments', 'tasks'];

export function serverConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    return { url: '', token: '', lastSyncAt: '', ...raw };
  } catch {
    return { url: '', token: '', lastSyncAt: '' };
  }
}

export function setServerConfig({ url, token }) {
  const clean = {
    url: String(url || '').trim().replace(/\/+$/, ''),
    token: String(token || '').trim(),
    lastSyncAt: serverConfig().lastSyncAt || '',
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(clean));
  return clean;
}

export function clearServerConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

async function request(path, options = {}) {
  const config = serverConfig();
  if (!config.url) throw new Error('Nenhum servidor configurado.');
  const res = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || `Servidor respondeu ${res.status}.`);
  return data;
}

export async function testServer({ url, token }) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (!clean) throw new Error('Informe a URL do servidor.');
  const res = await fetch(`${clean}/health`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Servidor indisponível (HTTP ${res.status}).`);
  const data = await res.json();
  if (data?.status !== 'ok') throw new Error('Resposta inesperada do servidor.');
  return data;
}

export function buildSnapshot() {
  const snapshot = {
    format: 'projetos-dinamicos/snapshot',
    version: 1,
    generated_at: nowISO(),
    device_id: deviceId(),
    tables: {},
  };
  for (const table of SYNC_TABLES) {
    let rows;
    if (table === 'users') {
      rows = queryAll(
        `SELECT id, email, display_name, role, status, locale, timezone, created_at, updated_at
           FROM users WHERE status <> 'deleted'`,
      );
    } else {
      rows = queryAll(`SELECT * FROM ${table}`);
    }
    snapshot.tables[table] = rows;
  }
  return snapshot;
}

function deviceId() {
  try {
    let id = localStorage.getItem('pd.device_id');
    if (!id) { id = `dev_${randomHex(8)}`; localStorage.setItem('pd.device_id', id); }
    return id;
  } catch { return 'dev_efemero'; }
}

export async function push() {
  const snapshot = buildSnapshot();
  const result = await request('/api/sync/push', {
    method: 'POST',
    body: JSON.stringify({ snapshot, device: deviceId() }),
  });
  const config = serverConfig();
  setServerConfig({ ...config, lastSyncAt: nowISO() });
  await audit({
    action: 'sync.push',
    entityType: 'sync',
    entityId: 'snapshot',
    legalBasis: 'consentimento',
    purpose: 'prestacao_servico',
    dataCategories: ['conteudo', 'metadados'],
    detail: { servidor: config.url, ...result?.stats },
  });
  return result;
}

export async function pull() {
  const data = await request('/api/sync/pull', { method: 'GET' });
  if (!data?.snapshot) throw new Error('O servidor não retornou um snapshot válido.');
  const counts = applySnapshot(data.snapshot);
  await persistNow();
  const config = serverConfig();
  setServerConfig({ ...config, lastSyncAt: nowISO() });
  await audit({
    action: 'sync.pull',
    entityType: 'sync',
    entityId: 'snapshot',
    legalBasis: 'consentimento',
    purpose: 'prestacao_servico',
    dataCategories: ['conteudo', 'metadados'],
    detail: { servidor: config.url, ...counts },
  });
  return counts;
}

export async function syncNow() {
  await push();
  return pull();
}

/** Aplica um snapshot recebido, preservando credenciais locais. */
export function applySnapshot(snapshot) {
  if (snapshot?.format !== 'projetos-dinamicos/snapshot') {
    throw new Error('Snapshot em formato desconhecido.');
  }
  const t = snapshot.tables || {};
  const counts = {};

  tx(() => {
    // 1. Usuários (sem senha; nunca promovemos papéis remotos).
    for (const u of t.users || []) {
      const existing = queryOne('SELECT id, email FROM users WHERE id = ?', [u.id]);
      if (existing) {
        run(
          'UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?',
          [u.display_name || 'Membro remoto', u.updated_at || nowISO(), u.id],
        );
        continue;
      }
      let email = u.email || `sync+${u.id}@local.invalid`;
      if (queryOne('SELECT id FROM users WHERE email = ?', [email])) {
        email = `sync+${u.id}@local.invalid`;
      }
      run(
        `INSERT INTO users (id, email, display_name, password_hash, role, status, locale, timezone,
                            created_at, updated_at)
         VALUES (?,?,?,?,'member','active','pt-BR','America/Sao_Paulo',?,?)`,
        [u.id, email, u.display_name || 'Membro remoto', 'remoto$sem-login',
          u.created_at || nowISO(), u.updated_at || nowISO()],
      );
      counts.usuarios = (counts.usuarios || 0) + 1;
    }

    // 2. Projetos
    for (const p of t.projects || []) {
      if (!queryOne('SELECT id FROM users WHERE id = ?', [p.owner_id])) continue;
      const exists = queryOne('SELECT id FROM projects WHERE id = ?', [p.id]);
      if (exists) {
        run(
          `UPDATE projects SET name = ?, description = ?, status = ?, visibility = ?, tags = ?,
                  start_date = ?, due_date = ?, updated_at = ?, archived_at = ?, deleted_at = ?
            WHERE id = ? AND updated_at < ?`,
          [p.name, p.description, p.status, p.visibility, p.tags, p.start_date, p.due_date,
            p.updated_at, p.archived_at, p.deleted_at, p.id, p.updated_at],
        );
      } else {
        run(
          `INSERT INTO projects (id, name, description, status, visibility, owner_id, tags,
                                 start_date, due_date, created_at, updated_at, archived_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [p.id, p.name, p.description, p.status, p.visibility, p.owner_id, p.tags,
            p.start_date, p.due_date, p.created_at, p.updated_at, p.archived_at, p.deleted_at],
        );
        counts.projetos = (counts.projetos || 0) + 1;
      }
    }

    // 3. Membros
    for (const m of t.project_members || []) {
      if (!queryOne('SELECT id FROM projects WHERE id = ?', [m.project_id])) continue;
      if (!queryOne('SELECT id FROM users WHERE id = ?', [m.user_id])) continue;
      run(
        `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at, status)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role, status = excluded.status`,
        [m.project_id, m.user_id, m.role, m.invited_by, m.joined_at, m.status],
      );
    }

    // 4. Ideias
    for (const i of t.ideas || []) {
      if (!queryOne('SELECT id FROM projects WHERE id = ?', [i.project_id])) continue;
      if (!queryOne('SELECT id FROM users WHERE id = ?', [i.author_id])) continue;
      const exists = queryOne('SELECT id FROM ideas WHERE id = ?', [i.id]);
      if (exists) {
        run(
          `UPDATE ideas SET title = ?, body = ?, category = ?, status = ?, impact = ?, effort = ?,
                  updated_at = ?, deleted_at = ?
            WHERE id = ? AND updated_at < ?`,
          [i.title, i.body, i.category, i.status, i.impact, i.effort, i.updated_at, i.deleted_at,
            i.id, i.updated_at],
        );
      } else {
        run(
          `INSERT INTO ideas (id, project_id, author_id, title, body, category, status, impact,
                              effort, created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [i.id, i.project_id, i.author_id, i.title, i.body, i.category, i.status, i.impact,
            i.effort, i.created_at, i.updated_at, i.deleted_at],
        );
        counts.ideias = (counts.ideias || 0) + 1;
      }
    }

    // 5. Votos
    for (const v of t.idea_votes || []) {
      if (!queryOne('SELECT id FROM ideas WHERE id = ?', [v.idea_id])) continue;
      if (!queryOne('SELECT id FROM users WHERE id = ?', [v.user_id])) continue;
      run(
        `INSERT INTO idea_votes (idea_id, user_id, value, created_at) VALUES (?,?,?,?)
         ON CONFLICT(idea_id, user_id) DO UPDATE SET value = excluded.value`,
        [v.idea_id, v.user_id, v.value, v.created_at],
      );
    }

    // 6. Comentários
    for (const c of t.comments || []) {
      if (!queryOne('SELECT id FROM ideas WHERE id = ?', [c.idea_id])) continue;
      if (!queryOne('SELECT id FROM users WHERE id = ?', [c.author_id])) continue;
      run(
        `INSERT INTO comments (id, idea_id, author_id, body, parent_id, created_at, edited_at, deleted_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET body = excluded.body, edited_at = excluded.edited_at,
                                       deleted_at = excluded.deleted_at`,
        [c.id, c.idea_id, c.author_id, c.body, c.parent_id, c.created_at, c.edited_at, c.deleted_at],
      );
    }

    // 7. Tarefas
    for (const task of t.tasks || []) {
      if (!queryOne('SELECT id FROM projects WHERE id = ?', [task.project_id])) continue;
      if (task.assignee_id && !queryOne('SELECT id FROM users WHERE id = ?', [task.assignee_id])) {
        task.assignee_id = null;
      }
      const exists = queryOne('SELECT id FROM tasks WHERE id = ?', [task.id]);
      if (exists) {
        run(
          `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, assignee_id = ?,
                  due_date = ?, position = ?, updated_at = ?, deleted_at = ?
            WHERE id = ? AND updated_at < ?`,
          [task.title, task.description, task.status, task.priority, task.assignee_id,
            task.due_date, task.position, task.updated_at, task.deleted_at, task.id, task.updated_at],
        );
      } else {
        run(
          `INSERT INTO tasks (id, project_id, idea_id, title, description, status, priority,
                              assignee_id, due_date, position, created_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [task.id, task.project_id, task.idea_id, task.title, task.description, task.status,
            task.priority, task.assignee_id, task.due_date, task.position, task.created_at,
            task.updated_at, task.deleted_at],
        );
        counts.tarefas = (counts.tarefas || 0) + 1;
      }
    }
  });

  return counts;
}

export function newDeviceId() {
  const id = `dev_${randomHex(8)}`;
  try { localStorage.setItem('pd.device_id', id); } catch { /* ignore */ }
  return id;
}

export function syncState() {
  return queryOne('SELECT * FROM sync_state WHERE id = 1') || { id: 1, device_id: deviceId() };
}

export { SYNC_TABLES };
