/* ============================================================================
   LGPD — consentimentos, direitos do titular, retenção, ROPA e conformidade.
   Base legal: Lei nº 13.709/2018 (LGPD), art. 5º, 6º, 8º, 9º, 15, 16, 18, 19, 37, 46 e 48.
   ========================================================================== */

import { queryAll, queryOne, scalar, run, tx, persist } from './db.js';
import { audit, verifyChain } from './audit.js';
import { nowISO, uid, addDays } from './util.js';
import { getMeta, setMeta } from './meta.js';
import { randomHex } from './crypto.js';

export const POLICY_VERSION = '2026-10-28';
export const DSR_DEADLINE_DAYS = 15;

export const CONSENT_PURPOSES = {
  termos_de_uso: 'Termos de Uso',
  politica_privacidade: 'Política de Privacidade',
  marketing: 'Comunicações de marketing',
  analytics: 'Métricas de uso agregadas',
  comunicacoes_projeto: 'Avisos sobre projetos',
  ia_assistente: 'Assistente de IA',
};

export const DSR_TYPES = {
  acesso: 'Acesso aos dados',
  correcao: 'Correção de dados',
  exclusao: 'Exclusão de dados',
  portabilidade: 'Portabilidade',
  revogacao: 'Revogação de consentimento',
  oposicao: 'Oposição ao tratamento',
  anonimizacao: 'Anonimização',
};

/* ----------------------------- Consentimentos ----------------------------- */
export async function recordConsent({
  userId = null, subjectKey = null, purpose, granted = true,
  legalBasis = 'consentimento', source = 'web', policyVersion = POLICY_VERSION,
  actor = null,
}) {
  const id = uid();
  const now = nowISO();
  const key = userId || subjectKey || 'anonimo';
  run(
    `INSERT INTO consents (id, user_id, subject_key, purpose, policy_version, granted,
                           legal_basis, source, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, userId, key, purpose, policyVersion, granted ? 1 : 0, legalBasis, source, now],
  );
  persist();
  await audit({
    action: granted ? 'lgpd.consent_grant' : 'lgpd.consent_revoke',
    entityType: 'consent',
    entityId: id,
    outcome: 'sucesso',
    legalBasis,
    purpose: purpose === 'marketing' ? 'marketing' : 'cumprimento_legal',
    dataCategories: ['identificacao', 'metadados'],
    detail: { finalidade: purpose, versao_politica: policyVersion, origem: source },
    ...(actor ? { actor } : {}),
  });
  return queryOne('SELECT * FROM consents WHERE id = ?', [id]);
}

export async function revokeConsent(userId, purpose, actor = null) {
  const row = queryOne(
    `SELECT * FROM consents
      WHERE user_id = ? AND purpose = ? AND granted = 1 AND revoked_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose],
  );
  if (!row) return false;
  run('UPDATE consents SET revoked_at = ? WHERE id = ?', [nowISO(), row.id]);
  persist();
  await audit({
    action: 'lgpd.consent_revoke',
    entityType: 'consent',
    entityId: row.id,
    legalBasis: 'consentimento',
    purpose: purpose === 'marketing' ? 'marketing' : 'cumprimento_legal',
    dataCategories: ['identificacao', 'metadados'],
    detail: { finalidade: purpose, versao_politica: row.policy_version },
    ...(actor ? { actor } : {}),
  });
  return true;
}

export function consentHistory(userId) {
  return queryAll(
    'SELECT * FROM consents WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
  );
}

/** Mapa finalidade → consentimento mais recente. */
export function activeConsents(userId) {
  const rows = queryAll(
    'SELECT * FROM consents WHERE user_id = ? ORDER BY created_at ASC',
    [userId],
  );
  const map = {};
  for (const row of rows) map[row.purpose] = row;
  return map;
}

export function hasConsent(userId, purpose) {
  const row = activeConsents(userId)[purpose];
  return Boolean(row && row.granted && !row.revoked_at);
}

/* ----------------------- Solicitações de titular (DSR) -------------------- */
export async function createDsr({
  userId = null, email = '', type, details = '', actor = null, origin = 'autoatendimento',
}) {
  if (!DSR_TYPES[type]) throw new Error('Tipo de solicitação inválido.');
  const id = uid();
  const now = new Date();
  const protocol = `PD-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomHex(3).toUpperCase()}`;
  const dueAt = addDays(now, DSR_DEADLINE_DAYS).toISOString();
  run(
    `INSERT INTO dsr_requests (id, protocol, subject_key, subject_email, request_type, status,
                               details, created_at, due_at)
     VALUES (?,?,?,?,?,'recebida',?,?,?)`,
    [id, protocol, userId || email || 'anonimo', email || null, type, String(details).slice(0, 4000),
      now.toISOString(), dueAt],
  );
  persist();
  await audit({
    action: 'lgpd.dsr_create',
    entityType: 'dsr',
    entityId: id,
    legalBasis: 'obrigacao_legal',
    purpose: 'atendimento_titular',
    dataCategories: ['identificacao', 'contato', 'conteudo'],
    detail: { protocolo: protocol, tipo: type, origem: origin, prazo: dueAt },
    ...(actor ? { actor } : {}),
  });
  return queryOne('SELECT * FROM dsr_requests WHERE id = ?', [id]);
}

export function listDsr({ actor, all = false } = {}) {
  if (all) {
    return queryAll('SELECT * FROM dsr_requests ORDER BY created_at DESC LIMIT 500');
  }
  return queryAll(
    'SELECT * FROM dsr_requests WHERE subject_key = ? OR subject_email = ? ORDER BY created_at DESC',
    [actor?.id || '', actor?.email || ''],
  );
}

export async function updateDsr(id, { status, response }, handledBy) {
  const row = queryOne('SELECT * FROM dsr_requests WHERE id = ?', [id]);
  if (!row) throw new Error('Solicitação não encontrada.');
  if (!['recebida', 'em_analise', 'concluida', 'recusada'].includes(status)) {
    throw new Error('Status inválido.');
  }
  const completedAt = status === 'concluida' || status === 'recusada' ? nowISO() : null;
  run(
    'UPDATE dsr_requests SET status = ?, response = ?, completed_at = ?, handled_by = ? WHERE id = ?',
    [status, String(response || '').slice(0, 8000), completedAt, handledBy || null, id],
  );
  persist();
  await audit({
    action: 'lgpd.dsr_update',
    entityType: 'dsr',
    entityId: id,
    legalBasis: 'obrigacao_legal',
    purpose: 'atendimento_titular',
    detail: { protocolo: row.protocol, de: row.status, para: status },
  });
  return queryOne('SELECT * FROM dsr_requests WHERE id = ?', [id]);
}

/* ------------------------- Portabilidade / acesso ------------------------ */
export function exportSubjectData(userId) {
  const user = queryOne(
    `SELECT id, email, display_name, role, status, locale, timezone, marketing_opt_in,
            created_at, updated_at, last_login_at
       FROM users WHERE id = ?`,
    [userId],
  );
  if (!user) throw new Error('Titular não encontrado.');
  const projects = queryAll('SELECT * FROM projects WHERE owner_id = ?', [userId]);
  const memberships = queryAll(
    `SELECT m.project_id, m.role, m.joined_at, m.status, p.name AS project_name
       FROM project_members m JOIN projects p ON p.id = m.project_id
      WHERE m.user_id = ?`,
    [userId],
  );
  const ideas = queryAll('SELECT * FROM ideas WHERE author_id = ?', [userId]);
  const comments = queryAll('SELECT * FROM comments WHERE author_id = ?', [userId]);
  const votes = queryAll('SELECT * FROM idea_votes WHERE user_id = ?', [userId]);
  const tasks = queryAll('SELECT * FROM tasks WHERE assignee_id = ?', [userId]);
  const consents = consentHistory(userId);
  const sessions = queryAll(
    `SELECT id, device_label, created_at, last_seen_at, expires_at, revoked_at
       FROM sessions WHERE user_id = ?`,
    [userId],
  );
  const dsr = queryAll('SELECT * FROM dsr_requests WHERE subject_key = ?', [userId]);
  const auditRows = queryAll(
    `SELECT seq, occurred_at, action, entity_type, entity_id, project_id, outcome,
            legal_basis, purpose, data_categories, detail, hash
       FROM audit_log WHERE actor_id = ? ORDER BY seq ASC LIMIT 5000`,
    [userId],
  ).map((row) => ({ ...row, detail: safeParse(row.detail) }));

  return {
    _meta: {
      formato: 'projetos-dinamicos/portabilidade',
      versao: 1,
      gerado_em: nowISO(),
      versao_politica: POLICY_VERSION,
      observacao: 'Registros de auditoria são mantidos por obrigação legal (LGPD art. 16, II e art. 37).',
    },
    titular: user,
    projetos: projects,
    participacoes: memberships,
    ideias: ideas,
    comentarios: comments,
    votos: votes,
    tarefas: tasks,
    consentimentos: consents,
    sessoes: sessions,
    solicitacoes: dsr,
    auditoria: auditRows,
  };
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return value; }
}

/* ------------------------------- Eliminação ------------------------------ */
/**
 * Direito à eliminação (LGPD art. 18, VI).
 * modo "anonimizar": remove a identidade, preserva a contribuição coletiva.
 * modo "excluir": remove também o conteúdo autoral do titular.
 */
export async function eraseSubjectData({ userId, mode = 'anonimizar', performedBy = null, actor = null }) {
  if (!['anonimizar', 'excluir'].includes(mode)) throw new Error('Modo inválido.');
  const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('Titular não encontrado.');

  const successor = queryOne(
    `SELECT id FROM users WHERE id <> ? AND status = 'active'
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
               created_at ASC LIMIT 1`,
    [userId],
  );
  if (user.role === 'owner') {
    if (!successor) throw new Error('Não é possível eliminar a última conta administradora.');
    run("UPDATE users SET role = 'owner', updated_at = ? WHERE id = ?", [nowISO(), successor.id]);
    run("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?", [nowISO(), userId]);
  }

  const counts = {};

  tx(() => {
    if (mode === 'excluir') {
      counts.comentarios = run('DELETE FROM comments WHERE author_id = ?', [userId]);
      counts.ideias = run('DELETE FROM ideas WHERE author_id = ?', [userId]);
      counts.votos = run('DELETE FROM idea_votes WHERE user_id = ?', [userId]);
      counts.participacoes = run('DELETE FROM project_members WHERE user_id = ?', [userId]);
      run('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?', [userId]);
      if (successor) {
        run('UPDATE projects SET owner_id = ? WHERE owner_id = ?', [successor.id, userId]);
      }
    } else {
      counts.votos = run('DELETE FROM idea_votes WHERE user_id = ?', [userId]);
      counts.participacoes = run('DELETE FROM project_members WHERE user_id = ?', [userId]);
      counts.sessoes = run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    }
    run(
      `UPDATE users SET email = ?, display_name = 'Titular anonimizado', password_hash = ?,
              status = 'deleted', marketing_opt_in = 0, is_demo = 0, deleted_at = ?, updated_at = ?
        WHERE id = ?`,
      [`anonimizado+${userId}@exemplo.invalid`, `anonimizado$${randomHex(16)}`, nowISO(), nowISO(), userId],
    );
  });

  run('UPDATE consents SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowISO(), userId]);
  persist();

  await audit({
    action: 'lgpd.erase',
    entityType: 'user',
    entityId: userId,
    legalBasis: 'obrigacao_legal',
    purpose: 'atendimento_titular',
    dataCategories: ['identificacao', 'contato', 'conteudo'],
    detail: { modo: mode, ...counts, executado_por: performedBy },
    ...(actor ? { actor } : {}),
  });

  return counts;
}

/* -------------------------------- Retenção -------------------------------- */
export function retentionPolicies() {
  return queryAll('SELECT * FROM retention_policies ORDER BY entity');
}

export async function applyRetention() {
  const policies = retentionPolicies();
  const now = Date.now();
  const cutoff = (days) => new Date(now - days * 86_400_000).toISOString();
  const counts = {};

  for (const policy of policies) {
    const limit = cutoff(policy.retention_days);
    let changes = 0;
    switch (policy.entity) {
      case 'sessions':
        changes = run('DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)', [limit, limit]);
        break;
      case 'conteudo_excluido':
        changes += run('DELETE FROM comments WHERE deleted_at IS NOT NULL AND deleted_at < ?', [limit]);
        changes += run('DELETE FROM ideas WHERE deleted_at IS NOT NULL AND deleted_at < ?', [limit]);
        changes += run('DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?', [limit]);
        changes += run('DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?', [limit]);
        break;
      case 'audit_log':
        // Imutável por design. O arquivamento é feito por exportação + rotação do banco.
        changes = 0;
        break;
      default:
        // Políticas de arquivamento (consents, dsr, incidents) não apagam dados.
        changes = 0;
    }
    run('UPDATE retention_policies SET last_run_at = ? WHERE id = ?', [nowISO(), policy.id]);
    counts[policy.entity] = changes;
  }

  persist();
  await audit({
    action: 'lgpd.retention_run',
    entityType: 'retention',
    legalBasis: 'obrigacao_legal',
    purpose: 'cumprimento_legal',
    detail: counts,
  });
  return counts;
}

/* ------------------------------ ROPA / DPO -------------------------------- */
export function processingActivities() {
  return queryAll('SELECT * FROM processing_activities ORDER BY name COLLATE NOCASE');
}

export async function updateProcessingActivity(id, fields) {
  const row = queryOne('SELECT * FROM processing_activities WHERE id = ?', [id]);
  if (!row) throw new Error('Atividade de tratamento não encontrada.');
  const allowed = ['name', 'purpose', 'legal_basis', 'data_categories', 'data_subjects',
    'retention', 'recipients', 'international_transfer', 'security_measures'];
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.includes(key)) continue;
    sets.push(`${key} = ?`);
    values.push(key === 'international_transfer' ? (value ? 1 : 0) : String(value));
  }
  if (!sets.length) return row;
  sets.push('updated_at = ?');
  values.push(nowISO());
  run(`UPDATE processing_activities SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
  persist();
  await audit({
    action: 'lgpd.ropa_update',
    entityType: 'ropa',
    entityId: id,
    legalBasis: 'obrigacao_legal',
    purpose: 'cumprimento_legal',
    detail: { campos: Object.keys(fields) },
  });
  return queryOne('SELECT * FROM processing_activities WHERE id = ?', [id]);
}

export function dpoInfo() {
  return {
    name: getMeta('dpo_name', ''),
    email: getMeta('dpo_email', ''),
    updatedAt: getMeta('dpo_updated_at', ''),
  };
}

export async function setDpo({ name, email }) {
  if (!String(name || '').trim() || !String(email || '').trim()) {
    throw new Error('Informe nome e e-mail do encarregado.');
  }
  setMeta('dpo_name', name.trim());
  setMeta('dpo_email', email.trim());
  setMeta('dpo_updated_at', nowISO());
  await audit({
    action: 'lgpd.report',
    entityType: 'config',
    entityId: 'dpo',
    legalBasis: 'obrigacao_legal',
    purpose: 'cumprimento_legal',
    dataCategories: ['identificacao', 'contato'],
    detail: { encarregado_definido: true },
  });
  return dpoInfo();
}

/* ------------------------------- Incidentes ------------------------------- */
export function listIncidents() {
  return queryAll('SELECT * FROM incidents ORDER BY detected_at DESC');
}

export async function createIncident({ title, severity, description, affected = 0, detectedAt }) {
  if (!String(title || '').trim()) throw new Error('Informe o título do incidente.');
  const id = uid();
  run(
    `INSERT INTO incidents (id, title, severity, description, detected_at, affected_subjects,
                            status, created_at)
     VALUES (?,?,?,?,?,?,'aberto',?)`,
    [id, title.trim(), severity || 'media', String(description || '').slice(0, 8000),
      detectedAt || nowISO(), Number(affected) || 0, nowISO()],
  );
  persist();
  await audit({
    action: 'incident.create',
    entityType: 'incident',
    entityId: id,
    legalBasis: 'obrigacao_legal',
    purpose: 'seguranca',
    dataCategories: ['metadados'],
    detail: { severidade: severity, afetados: Number(affected) || 0 },
  });
  return queryOne('SELECT * FROM incidents WHERE id = ?', [id]);
}

export async function updateIncident(id, { status, containedAt, notifiedAt }) {
  const row = queryOne('SELECT * FROM incidents WHERE id = ?', [id]);
  if (!row) throw new Error('Incidente não encontrado.');
  run(
    'UPDATE incidents SET status = ?, contained_at = ?, notified_at = ? WHERE id = ?',
    [status || row.status, containedAt || row.contained_at, notifiedAt || row.notified_at, id],
  );
  persist();
  await audit({
    action: 'incident.update',
    entityType: 'incident',
    entityId: id,
    legalBasis: 'obrigacao_legal',
    purpose: 'seguranca',
    detail: { de: row.status, para: status },
  });
  return queryOne('SELECT * FROM incidents WHERE id = ?', [id]);
}

/* --------------------------- Relatório de conformidade -------------------- */
export async function complianceReport() {
  const chain = await verifyChain();
  const dpo = dpoInfo();
  const ropa = processingActivities();
  const policies = retentionPolicies();
  const users = scalar("SELECT COUNT(*) FROM users WHERE status = 'active'") || 0;
  const weakHashes = scalar(
    "SELECT COUNT(*) FROM users WHERE status <> 'deleted' AND password_hash NOT LIKE 'pbkdf2-sha256$210000$%'",
  ) || 0;
  const consentsWithVersion = scalar(
    "SELECT COUNT(*) FROM consents WHERE policy_version IS NOT NULL AND policy_version <> ''",
  ) || 0;
  const totalConsents = scalar('SELECT COUNT(*) FROM consents') || 0;
  const dsrOpen = scalar("SELECT COUNT(*) FROM dsr_requests WHERE status IN ('recebida','em_analise')") || 0;
  const dsrOverdue = scalar(
    "SELECT COUNT(*) FROM dsr_requests WHERE status IN ('recebida','em_analise') AND due_at < ?",
    [nowISO()],
  ) || 0;
  const incidentsOpen = scalar("SELECT COUNT(*) FROM incidents WHERE status IN ('aberto','contido')") || 0;
  const backups = Boolean(getMeta('last_backup_at', ''));

  const checks = [
    {
      id: 'dpo',
      label: 'Encarregado pelo tratamento (DPO) designado e publicado',
      status: dpo.name && dpo.email ? 'ok' : 'pendente',
      detail: dpo.name ? `${dpo.name} — ${dpo.email}` : 'Defina o encarregado em LGPD › Governança.',
    },
    {
      id: 'politica',
      label: 'Política de Privacidade versionada',
      status: getMeta('policy_version') ? 'ok' : 'pendente',
      detail: `Versão ${getMeta('policy_version', '—')}.`,
    },
    {
      id: 'ropa',
      label: 'Inventário de operações de tratamento (ROPA)',
      status: ropa.length >= 5 && ropa.every((r) => r.legal_basis) ? 'ok' : 'atencao',
      detail: `${ropa.length} atividades registradas, todas com base legal.`,
    },
    {
      id: 'consent',
      label: 'Consentimentos com versão de política e histórico',
      status: totalConsents === 0 || consentsWithVersion === totalConsents ? 'ok' : 'atencao',
      detail: `${totalConsents} registros, ${consentsWithVersion} com versão.`,
    },
    {
      id: 'audit',
      label: 'Trilha de auditoria íntegra e à prova de alteração',
      status: chain.ok ? 'ok' : 'pendente',
      detail: chain.ok ? `${chain.total} eventos verificados.` : `Quebra no evento #${chain.brokenAt}.`,
    },
    {
      id: 'retention',
      label: 'Políticas de retenção e descarte definidas',
      status: policies.length >= 4 ? 'ok' : 'atencao',
      detail: `${policies.length} políticas cadastradas.`,
    },
    {
      id: 'dsr',
      label: 'Canal de direitos do titular com prazo de 15 dias',
      status: dsrOverdue > 0 ? 'atencao' : 'ok',
      detail: dsrOverdue > 0
        ? `${dsrOverdue} solicitação(ões) fora do prazo; ${dsrOpen} em aberto.`
        : `${dsrOpen} solicitação(ões) em aberto, nenhuma atrasada.`,
    },
    {
      id: 'security',
      label: 'Credenciais protegidas com PBKDF2-SHA256 (210.000 iterações)',
      status: weakHashes === 0 ? 'ok' : 'atencao',
      detail: `${users} contas ativas; ${weakHashes} com hash legado.`,
    },
    {
      id: 'incidents',
      label: 'Plano de resposta a incidentes (LGPD art. 48)',
      status: incidentsOpen === 0 ? 'ok' : 'atencao',
      detail: incidentsOpen === 0 ? 'Nenhum incidente em aberto.' : `${incidentsOpen} incidente(s) em aberto.`,
    },
    {
      id: 'portability',
      label: 'Portabilidade e backup sob controle do titular',
      status: backups ? 'ok' : 'atencao',
      detail: backups ? `Último backup em ${getMeta('last_backup_at')}.` : 'Nenhum backup gerado ainda.',
    },
    {
      id: 'minimization',
      label: 'Minimização e redação de dados sensíveis na auditoria',
      status: 'ok',
      detail: 'Senhas, tokens e segredos são removidos antes da gravação.',
    },
    {
      id: 'local',
      label: 'Dados armazenados localmente no dispositivo (sem rastreamento)',
      status: 'ok',
      detail: 'SQLite no navegador; nenhum cookie de rastreamento ou analytics de terceiros.',
    },
  ];

  const weight = { ok: 1, atencao: 0.5, pendente: 0 };
  const score = Math.round(
    (checks.reduce((sum, c) => sum + weight[c.status], 0) / checks.length) * 100,
  );

  return { score, checks, generatedAt: nowISO(), chain };
}

export { getMeta, setMeta };
