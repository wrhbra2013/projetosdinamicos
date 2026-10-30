/* ============================================================================
   Auditoria — trilha append-only com encadeamento de hashes SHA-256.
   Toda operação de tratamento passa por aqui (LGPD art. 37).
   ========================================================================== */

import { queryAll, queryOne, scalar, run, persist } from './db.js';
import { sha256Hex, randomHex } from './crypto.js';
import { nowISO, uid } from './util.js';

const GENESIS = '0'.repeat(64);
const MAX_STRING = 400;
const MAX_ARRAY = 30;

export const LEGAL_BASIS = {
  consentimento: 'Consentimento',
  contrato: 'Execução de contrato',
  obrigacao_legal: 'Obrigação legal',
  legitimo_interesse: 'Legítimo interesse',
  protecao_vida: 'Proteção da vida',
  tutela_saude: 'Tutela da saúde',
  interesse_publico: 'Interesse público',
  exercicio_direitos: 'Exercício regular de direitos',
};

export const PURPOSE = {
  prestacao_servico: 'Prestação do serviço',
  autenticacao: 'Autenticação e acesso',
  seguranca: 'Segurança da informação',
  comunicacao: 'Comunicações operacionais',
  marketing: 'Marketing',
  analytics: 'Métricas agregadas',
  cumprimento_legal: 'Cumprimento de obrigação legal',
  atendimento_titular: 'Atendimento ao titular',
  auditoria: 'Auditoria e conformidade',
};

export const DATA_CATEGORIES = {
  identificacao: 'Identificação',
  contato: 'Contato',
  credenciais: 'Credenciais',
  conteudo: 'Conteúdo',
  metadados: 'Metadados',
  localizacao: 'Localização',
};

export const ACTION_LABELS = {
  'auth.register': 'Conta criada',
  'auth.login': 'Login realizado',
  'auth.login_failed': 'Tentativa de login falhou',
  'auth.logout': 'Sessão encerrada',
  'auth.password_change': 'Senha alterada',
  'auth.session_revoke': 'Sessão revogada',
  'auth.lock': 'Sessão bloqueada por inatividade',
  'profile.update': 'Perfil atualizado',
  'project.create': 'Projeto criado',
  'project.update': 'Projeto atualizado',
  'project.archive': 'Projeto arquivado',
  'project.restore': 'Projeto restaurado',
  'project.delete': 'Projeto excluído',
  'member.add': 'Membro adicionado',
  'member.remove': 'Membro removido',
  'member.role_change': 'Papel de membro alterado',
  'idea.create': 'Ideia criada',
  'idea.update': 'Ideia atualizada',
  'idea.status': 'Status da ideia alterado',
  'idea.delete': 'Ideia excluída',
  'idea.vote': 'Voto registrado',
  'comment.create': 'Comentário publicado',
  'comment.delete': 'Comentário excluído',
  'task.create': 'Tarefa criada',
  'task.update': 'Tarefa atualizada',
  'task.move': 'Tarefa movida',
  'task.delete': 'Tarefa excluída',
  'lgpd.consent_grant': 'Consentimento concedido',
  'lgpd.consent_revoke': 'Consentimento revogado',
  'lgpd.dsr_create': 'Solicitação de titular registrada',
  'lgpd.dsr_update': 'Solicitação de titular atualizada',
  'lgpd.export': 'Dados exportados',
  'lgpd.erase': 'Dados do titular eliminados',
  'lgpd.retention_run': 'Rotina de retenção executada',
  'lgpd.report': 'Relatório de conformidade gerado',
  'lgpd.ropa_update': 'Inventário de tratamentos atualizado',
  'incident.create': 'Incidente registrado',
  'incident.update': 'Incidente atualizado',
  'audit.verify': 'Integridade da auditoria verificada',
  'audit.export': 'Auditoria exportada',
  'sync.push': 'Sincronização enviada',
  'sync.pull': 'Sincronização recebida',
  'data.import': 'Backup importado',
  'data.export': 'Backup exportado',
  'data.reset': 'Banco local reiniciado',
  'demo.seed': 'Dados de demonstração carregados',
};

const SENSITIVE_KEY = /(senha|password|passwd|token|secret|authorization|credential|hash|salt)/i;

let actorProvider = () => ({ id: null, label: 'Visitante', role: null });

export function setActorProvider(fn) {
  actorProvider = typeof fn === 'function' ? fn : actorProvider;
}

function deviceId() {
  try {
    let id = localStorage.getItem('pd.device_id');
    if (!id) {
      id = `dev_${randomHex(8)}`;
      localStorage.setItem('pd.device_id', id);
    }
    return id;
  } catch {
    return 'dev_efemero';
  }
}

export function maskEmail(email = '') {
  const [user, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${(user || '').slice(0, 2)}***@${domain}`;
}

/** Remove dados sensíveis e limita o tamanho do detalhe auditado. */
export function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[limite de profundidade]';
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) { out[key] = '[REDIGIDO]'; continue; }
      out[key] = redact(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

function payloadFromRow(row) {
  return {
    id: row.id,
    occurred_at: row.occurred_at,
    actor_id: row.actor_id,
    actor_label: row.actor_label,
    actor_role: row.actor_role,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    project_id: row.project_id,
    outcome: row.outcome,
    legal_basis: row.legal_basis,
    purpose: row.purpose,
    data_categories: row.data_categories,
    user_agent: row.user_agent,
    device_id: row.device_id,
    detail: row.detail,
    prev_hash: row.prev_hash,
  };
}

/**
 * Registra um evento de auditoria.
 * @param {object} event
 * @param {string} event.action        ex.: 'project.create'
 * @param {string} event.entityType    ex.: 'project'
 * @param {string} [event.entityId]
 * @param {string} [event.projectId]
 * @param {string} [event.outcome]     sucesso | falha | negado
 * @param {string} [event.legalBasis]  chave de LEGAL_BASIS
 * @param {string} [event.purpose]     chave de PURPOSE
 * @param {string[]} [event.dataCategories]
 * @param {object} [event.detail]
 * @param {object} [event.actor]       sobrescreve o ator atual
 */
export async function audit(event) {
  const actor = event.actor || actorProvider() || {};
  const occurredAt = event.occurredAt || nowISO();
  const detail = JSON.stringify(redact(event.detail || {}));
  const categories = JSON.stringify(event.dataCategories || []);
  const prev = scalar('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1') || GENESIS;
  const base = {
    id: uid(),
    occurred_at: occurredAt,
    actor_id: actor.id || null,
    actor_label: actor.label || 'Sistema',
    actor_role: actor.role || null,
    action: event.action,
    entity_type: event.entityType || 'sistema',
    entity_id: event.entityId || null,
    project_id: event.projectId || null,
    outcome: event.outcome || 'sucesso',
    legal_basis: event.legalBasis || 'obrigacao_legal',
    purpose: event.purpose || 'auditoria',
    data_categories: categories,
    user_agent: (navigator.userAgent || '').slice(0, 255),
    device_id: deviceId(),
    detail,
    prev_hash: prev,
  };
  const hash = await sha256Hex(JSON.stringify(base));
  run(
    `INSERT INTO audit_log
      (id, occurred_at, actor_id, actor_label, actor_role, action, entity_type, entity_id,
       project_id, outcome, legal_basis, purpose, data_categories, user_agent, device_id,
       detail, prev_hash, hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [base.id, base.occurred_at, base.actor_id, base.actor_label, base.actor_role, base.action,
      base.entity_type, base.entity_id, base.project_id, base.outcome, base.legal_basis,
      base.purpose, base.data_categories, base.user_agent, base.device_id, base.detail,
      base.prev_hash, hash],
  );
  persist();
  return { ...base, hash };
}

/** Recalcula a cadeia inteira e aponta a primeira inconsistência. */
export async function verifyChain() {
  const rows = queryAll('SELECT * FROM audit_log ORDER BY seq ASC');
  let prev = GENESIS;
  for (const row of rows) {
    if (row.prev_hash !== prev) {
      return { ok: false, total: rows.length, brokenAt: row.seq, reason: 'encadeamento', at: row.occurred_at };
    }
    const expected = await sha256Hex(JSON.stringify(payloadFromRow(row)));
    if (expected !== row.hash) {
      return { ok: false, total: rows.length, brokenAt: row.seq, reason: 'hash', at: row.occurred_at };
    }
    prev = row.hash;
  }
  return { ok: true, total: rows.length, head: prev, checkedAt: nowISO() };
}

/**
 * Lista eventos com filtros e escopo por perfil.
 * @param {object} opts
 * @param {object} opts.actor usuário atual
 * @param {boolean} opts.all   true para owner/admin (vê tudo)
 */
export function listAudit(opts = {}) {
  const {
    actor, all = false, search = '', action = '', entityType = '', projectId = '',
    outcome = '', from = '', to = '', limit = 50, offset = 0,
  } = opts;
  const where = [];
  const params = [];

  if (!all) {
    where.push('(actor_id = ? OR project_id IN (SELECT project_id FROM project_members WHERE user_id = ?))');
    params.push(actor?.id || '', actor?.id || '');
  }
  if (search) {
    where.push('(action LIKE ? OR actor_label LIKE ? OR entity_id LIKE ? OR detail LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (action) { where.push('action = ?'); params.push(action); }
  if (entityType) { where.push('entity_type = ?'); params.push(entityType); }
  if (projectId) { where.push('project_id = ?'); params.push(projectId); }
  if (outcome) { where.push('outcome = ?'); params.push(outcome); }
  if (from) { where.push('occurred_at >= ?'); params.push(`${from}T00:00:00.000Z`); }
  if (to) { where.push('occurred_at <= ?'); params.push(`${to}T23:59:59.999Z`); }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = scalar(`SELECT COUNT(*) FROM audit_log ${clause}`, params) || 0;
  const rows = queryAll(
    `SELECT * FROM audit_log ${clause} ORDER BY seq DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(Number(limit) || 50, 5000), Math.max(Number(offset) || 0, 0)],
  );
  return { rows, total };
}

export function auditStats() {
  return {
    total: scalar('SELECT COUNT(*) FROM audit_log') || 0,
    last24h: scalar('SELECT COUNT(*) FROM audit_log WHERE occurred_at >= ?',
      [new Date(Date.now() - 86_400_000).toISOString()]) || 0,
    failures: scalar("SELECT COUNT(*) FROM audit_log WHERE outcome IN ('falha','negado')") || 0,
    last: queryOne('SELECT * FROM audit_log ORDER BY seq DESC LIMIT 1'),
  };
}

export function auditForProject(projectId, limit = 20) {
  return queryAll(
    'SELECT * FROM audit_log WHERE project_id = ? ORDER BY seq DESC LIMIT ?',
    [projectId, limit],
  );
}

export function auditForSubject(subjectKey, limit = 500) {
  return queryAll(
    'SELECT * FROM audit_log WHERE actor_id = ? ORDER BY seq DESC LIMIT ?',
    [subjectKey, limit],
  );
}

export function exportAuditRows(opts = {}) {
  const { rows } = listAudit({ ...opts, limit: 5000, offset: 0 });
  return rows;
}

export function actionLabel(action) {
  return ACTION_LABELS[action] || action;
}
