/* ============================================================================
   Autenticação e autorização — contas locais, PBKDF2 e sessões expiráveis.
   ========================================================================== */

import { queryAll, queryOne, scalar, run, tx, persist } from './db.js';
import { hashPassword, verifyPassword, randomToken, sha256Hex } from './crypto.js';
import { nowISO, uid, isEmail, passwordStrength, addDays } from './util.js';
import { audit, maskEmail, setActorProvider } from './audit.js';
import { recordConsent, revokeConsent, POLICY_VERSION } from './lgpd.js';

const SESSION_KEY = 'pd.session';
const ATTEMPTS_KEY = 'pd.login_attempts';
const SESSION_HOURS = 12;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

let current = null;
let session = null;

/* ------------------------------ Estado ----------------------------------- */
export function currentUser() { return current; }
export function currentSession() { return session; }
export function isAuthenticated() { return Boolean(current); }
export function isAdmin() { return current && (current.role === 'owner' || current.role === 'admin'); }
export function isOwner() { return current?.role === 'owner'; }

export function userCount() {
  return scalar("SELECT COUNT(*) FROM users WHERE status <> 'deleted'") || 0;
}

export function listUsers() {
  return queryAll("SELECT * FROM users WHERE status <> 'deleted' ORDER BY display_name COLLATE NOCASE");
}

export function findUserByEmail(email) {
  return queryOne('SELECT * FROM users WHERE email = ?', [String(email || '').trim().toLowerCase()]);
}

export function getUser(id) {
  return queryOne('SELECT * FROM users WHERE id = ?', [id]);
}

/* ------------------------------ Sessão ----------------------------------- */
function setActor() {
  setActorProvider(() => (current
    ? { id: current.id, label: current.display_name, role: current.role }
    : { id: null, label: 'Visitante', role: null }));
}

async function createSession(user, deviceLabel = '') {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const id = uid();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3_600_000).toISOString();
  run(
    `INSERT INTO sessions (id, user_id, token_hash, device_label, created_at, last_seen_at, expires_at)
     VALUES (?,?,?,?,?,?,?)`,
    [id, user.id, tokenHash, String(deviceLabel || navigator.platform || '').slice(0, 120),
      now.toISOString(), now.toISOString(), expires],
  );
  persist();
  try { sessionStorage.setItem(SESSION_KEY, token); } catch { /* modo restrito */ }
  session = { id, token, expires_at: expires, created_at: now.toISOString() };
  return session;
}

export async function restoreSession() {
  let token = null;
  try { token = sessionStorage.getItem(SESSION_KEY); } catch { /* ignore */ }
  if (!token) { setActor(); return null; }
  const tokenHash = await sha256Hex(token);
  const row = queryOne(
    `SELECT s.*, u.display_name, u.email, u.role, u.status, u.locale, u.timezone,
            u.marketing_opt_in, u.created_at AS user_created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [tokenHash],
  );
  if (!row || row.revoked_at || new Date(row.expires_at) <= new Date() || row.status !== 'active') {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    setActor();
    return null;
  }
  current = {
    id: row.user_id, email: row.email, display_name: row.display_name, role: row.role,
    locale: row.locale, timezone: row.timezone, marketing_opt_in: row.marketing_opt_in,
    created_at: row.user_created_at,
  };
  session = { id: row.id, token, expires_at: row.expires_at, created_at: row.created_at };
  run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [nowISO(), row.id]);
  setActor();
  return current;
}

function clearLocalSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  current = null;
  session = null;
  setActor();
}

/* --------------------------- Tentativas de login -------------------------- */
function loadAttempts() {
  try { return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{}'); } catch { return {}; }
}
function saveAttempts(data) {
  try { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}
function checkAttempts(email) {
  const data = loadAttempts();
  const now = Date.now();
  const list = (data[email] || []).filter((t) => now - t < ATTEMPT_WINDOW_MS);
  data[email] = list;
  saveAttempts(data);
  if (list.length >= MAX_ATTEMPTS) {
    const wait = Math.ceil((ATTEMPT_WINDOW_MS - (now - list[0])) / 60000);
    throw new Error(`Muitas tentativas. Tente novamente em ${wait} minuto(s).`);
  }
}
function registerFailure(email) {
  const data = loadAttempts();
  data[email] = [...(data[email] || []), Date.now()].slice(-MAX_ATTEMPTS);
  saveAttempts(data);
}
function clearFailures(email) {
  const data = loadAttempts();
  delete data[email];
  saveAttempts(data);
}

/* ------------------------------- Cadastro -------------------------------- */
export async function register({
  name, email, password, acceptTerms, acceptPrivacy, marketing = false, deviceLabel = '',
}) {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (cleanName.length < 2) throw new Error('Informe seu nome completo.');
  if (!isEmail(cleanEmail)) throw new Error('E-mail inválido.');
  if (!acceptTerms || !acceptPrivacy) {
    throw new Error('É necessário aceitar os Termos de Uso e a Política de Privacidade.');
  }
  if (!passwordStrength(password).ok) {
    throw new Error('A senha deve ter ao menos 10 caracteres, com letras maiúsculas, minúsculas e números.');
  }
  if (findUserByEmail(cleanEmail)) throw new Error('Já existe uma conta com este e-mail.');

  const first = userCount() === 0;
  const passwordHash = await hashPassword(password);
  const id = uid();
  const now = nowISO();

  tx(() => {
    run(
      `INSERT INTO users (id, email, display_name, password_hash, role, status, marketing_opt_in,
                          created_at, updated_at)
       VALUES (?,?,?,?,?,'active',?,?,?)`,
      [id, cleanEmail, cleanName, passwordHash, first ? 'owner' : 'member', marketing ? 1 : 0, now, now],
    );
    run('INSERT INTO sync_state (id, device_id) VALUES (1, ?) ON CONFLICT(id) DO NOTHING', [uid()]);
  });

  const user = getUser(id);
  await recordConsent({ userId: id, purpose: 'termos_de_uso', granted: true, legalBasis: 'contrato', source: 'cadastro', actor: { id, label: cleanName, role: user.role } });
  await recordConsent({ userId: id, purpose: 'politica_privacidade', granted: true, legalBasis: 'contrato', source: 'cadastro', actor: { id, label: cleanName, role: user.role } });
  if (marketing) {
    await recordConsent({ userId: id, purpose: 'marketing', granted: true, legalBasis: 'consentimento', source: 'cadastro', actor: { id, label: cleanName, role: user.role } });
  }

  await audit({
    action: 'auth.register',
    entityType: 'user',
    entityId: id,
    legalBasis: 'contrato',
    purpose: 'autenticacao',
    dataCategories: ['identificacao', 'contato', 'credenciais'],
    detail: { email: maskEmail(cleanEmail), role: user.role, primeiro_usuario: first },
    actor: { id, label: cleanName, role: user.role },
  });

  current = user;
  await createSession(user, deviceLabel);
  await audit({
    action: 'auth.login',
    entityType: 'session',
    entityId: session.id,
    legalBasis: 'contrato',
    purpose: 'autenticacao',
    dataCategories: ['credenciais', 'metadados'],
    detail: { metodo: 'cadastro' },
  });
  return user;
}

/* --------------------------------- Login --------------------------------- */
export async function login(email, password, deviceLabel = '') {
  const cleanEmail = String(email || '').trim().toLowerCase();
  checkAttempts(cleanEmail);
  const user = findUserByEmail(cleanEmail);
  const ok = user && user.status === 'active' && await verifyPassword(password, user.password_hash);

  if (!ok) {
    registerFailure(cleanEmail);
    await audit({
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user?.id || null,
      outcome: 'falha',
      legalBasis: 'legitimo_interesse',
      purpose: 'seguranca',
      dataCategories: ['credenciais', 'metadados'],
      detail: { email: maskEmail(cleanEmail), motivo: user ? 'senha_incorreta' : 'conta_inexistente' },
      actor: { id: user?.id || null, label: maskEmail(cleanEmail), role: null },
    });
    throw new Error('E-mail ou senha incorretos.');
  }

  clearFailures(cleanEmail);
  current = user;
  run('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', [nowISO(), nowISO(), user.id]);
  await createSession(user, deviceLabel);
  await audit({
    action: 'auth.login',
    entityType: 'session',
    entityId: session.id,
    legalBasis: 'contrato',
    purpose: 'autenticacao',
    dataCategories: ['credenciais', 'metadados'],
    detail: { email: maskEmail(cleanEmail) },
  });
  return user;
}

export async function logout(reason = 'manual') {
  if (session) {
    run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [nowISO(), session.id]);
    await audit({
      action: reason === 'inatividade' ? 'auth.lock' : 'auth.logout',
      entityType: 'session',
      entityId: session.id,
      legalBasis: 'contrato',
      purpose: 'autenticacao',
      detail: { motivo: reason },
    });
  }
  clearLocalSession();
  persist();
}

/* ------------------------------- Sessões --------------------------------- */
export function listSessions() {
  if (!current) return [];
  return queryAll(
    'SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC',
    [current.id],
  );
}

export async function revokeSession(sessionId) {
  if (!current) throw new Error('Sessão expirada.');
  const row = queryOne('SELECT * FROM sessions WHERE id = ? AND user_id = ?', [sessionId, current.id]);
  if (!row) throw new Error('Sessão não encontrada.');
  run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [nowISO(), sessionId]);
  await audit({
    action: 'auth.session_revoke',
    entityType: 'session',
    entityId: sessionId,
    legalBasis: 'legitimo_interesse',
    purpose: 'seguranca',
    detail: { dispositivo: row.device_label },
  });
  persist();
}

/* ------------------------------ Senha / perfil ---------------------------- */
export async function changePassword(currentPassword, newPassword) {
  if (!current) throw new Error('Sessão expirada.');
  const user = getUser(current.id);
  if (!await verifyPassword(currentPassword, user.password_hash)) {
    throw new Error('Senha atual incorreta.');
  }
  if (!passwordStrength(newPassword).ok) {
    throw new Error('A nova senha não atende aos requisitos mínimos.');
  }
  const hash = await hashPassword(newPassword);
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, nowISO(), current.id]);
  run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ?', [nowISO(), current.id, session.id]);
  await audit({
    action: 'auth.password_change',
    entityType: 'user',
    entityId: current.id,
    legalBasis: 'legitimo_interesse',
    purpose: 'seguranca',
    dataCategories: ['credenciais'],
    detail: { outras_sessoes_revogadas: true },
  });
  persist();
}

export async function updateProfile({ displayName, timezone, locale, marketingOptIn }) {
  if (!current) throw new Error('Sessão expirada.');
  const name = String(displayName || current.display_name).trim();
  if (name.length < 2) throw new Error('Nome inválido.');
  const before = getUser(current.id);
  run(
    'UPDATE users SET display_name = ?, timezone = ?, locale = ?, marketing_opt_in = ?, updated_at = ? WHERE id = ?',
    [name, timezone || current.timezone, locale || current.locale,
      marketingOptIn ? 1 : 0, nowISO(), current.id],
  );
  if (Boolean(before.marketing_opt_in) !== Boolean(marketingOptIn)) {
    if (marketingOptIn) {
      await recordConsent({ userId: current.id, purpose: 'marketing', granted: true, legalBasis: 'consentimento', source: 'configuracoes' });
    } else {
      await revokeConsent(current.id, 'marketing');
    }
  }
  current = { ...current, display_name: name, timezone, locale, marketing_opt_in: marketingOptIn ? 1 : 0 };
  setActor();
  await audit({
    action: 'profile.update',
    entityType: 'user',
    entityId: current.id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    dataCategories: ['identificacao', 'contato'],
    detail: { nome_alterado: before.display_name !== name, marketing: Boolean(marketingOptIn) },
  });
  persist();
  return current;
}

/* ------------------------------ Permissões -------------------------------- */
export function projectRole(projectId, userId = current?.id) {
  if (!userId) return null;
  const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) return null;
  if (project.owner_id === userId) return 'coordenador';
  const member = queryOne(
    "SELECT role FROM project_members WHERE project_id = ? AND user_id = ? AND status = 'ativo'",
    [projectId, userId],
  );
  if (member) return member.role;
  if (isAdmin()) return 'coordenador';
  if (project.visibility === 'publico' || project.visibility === 'interno') return 'observador';
  return null;
}

export function canViewProject(projectId, userId = current?.id) {
  return Boolean(projectRole(projectId, userId));
}

/** Ações: view, edit, manage, comment, vote, createTask, manageTask */
export function canProject(projectId, action, userId = current?.id) {
  const role = projectRole(projectId, userId);
  if (!role) return false;
  if (role === 'coordenador') return true;
  if (role === 'colaborador') return ['view', 'edit', 'comment', 'vote', 'createTask', 'manageTask'].includes(action);
  return action === 'view';
}

export function canEditIdea(idea, userId = current?.id) {
  if (!idea) return false;
  return idea.author_id === userId || canProject(idea.project_id, 'edit', userId);
}

export function requireAuth() {
  if (!current) throw new Error('Faça login para continuar.');
  return current;
}

/* ------------------------- Administração de contas ------------------------ */
export async function setUserRole(userId, role) {
  if (!isAdmin()) throw new Error('Apenas administradores podem alterar papéis.');
  if (!['admin', 'member', 'viewer'].includes(role)) throw new Error('Papel inválido.');
  const target = getUser(userId);
  if (!target) throw new Error('Conta não encontrada.');
  if (target.role === 'owner') throw new Error('O papel do proprietário não pode ser alterado.');
  if (target.id === current.id) throw new Error('Você não pode alterar o seu próprio papel.');
  if (current.role !== 'owner' && role === 'admin') {
    throw new Error('Apenas o proprietário pode promover alguém a administrador.');
  }
  run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [role, nowISO(), userId]);
  await audit({
    action: 'profile.update',
    entityType: 'user',
    entityId: userId,
    legalBasis: 'legitimo_interesse',
    purpose: 'seguranca',
    dataCategories: ['identificacao', 'credenciais'],
    detail: { de: target.role, para: role, conta: target.display_name },
  });
  persist();
  return getUser(userId);
}

export async function adminResetPassword(userId, newPassword) {
  if (!isAdmin()) throw new Error('Apenas administradores podem redefinir senhas.');
  const target = getUser(userId);
  if (!target) throw new Error('Conta não encontrada.');
  if (!passwordStrength(newPassword).ok) {
    throw new Error('A nova senha não atende aos requisitos mínimos.');
  }
  const hash = await hashPassword(newPassword);
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, nowISO(), userId]);
  run('UPDATE sessions SET revoked_at = ? WHERE user_id = ?', [nowISO(), userId]);
  await audit({
    action: 'auth.password_change',
    entityType: 'user',
    entityId: userId,
    legalBasis: 'legitimo_interesse',
    purpose: 'seguranca',
    dataCategories: ['credenciais'],
    detail: { redefinicao_por_administrador: true, conta: target.display_name },
  });
  persist();
}

export function resetAuthState() {
  clearLocalSession();
}

export { POLICY_VERSION };
