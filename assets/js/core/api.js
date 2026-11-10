/* ============================================================================
   Cliente da API de serviços da Projetos Dinâmicos.

   Serviços ativos (produção):
     Auth  https://api.projetosdinamicos.com.br/auth
     LLM   https://api.projetosdinamicos.com.br/llm

   Endpoints usados:
     GET  {auth}/status
     POST {auth}/register   { email, senha }
     POST {auth}/login      { email, senha } -> Bearer token + cookie llm_session
     GET  {auth}/me
     POST {auth}/logout
     GET  {llm}/health
     GET  {llm}/v1/models
     POST {llm}/v1/chat/completions

   As bases podem ser trocadas sem alterar o código através das meta tags:
     <meta name="auth-api-base" content="...">
     <meta name="llm-api-base" content="...">
   ========================================================================== */

const DEFAULT_AUTH_BASE = 'https://api.projetosdinamicos.com.br/auth';
const DEFAULT_LLM_BASE = 'https://api.projetosdinamicos.com.br/llm';

const TOKEN_KEY = 'pd.api_token';
const USER_KEY = 'pd.api_user';
const MODEL_KEY = 'pd.api_model';
const REQUEST_TIMEOUT_MS = 30_000;

function metaContent(name, fallback) {
  try {
    const node = document.querySelector(`meta[name="${name}"]`);
    const value = node?.getAttribute('content');
    return value && value.trim() ? value.trim() : fallback;
  } catch {
    return fallback;
  }
}

function normalizeBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export const AUTH_BASE = normalizeBase(metaContent('auth-api-base', DEFAULT_AUTH_BASE));
export const LLM_BASE = normalizeBase(metaContent('llm-api-base', DEFAULT_LLM_BASE));

/* ------------------------------- Armazenamento ---------------------------- */

function readLocal(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

function writeLocal(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* modo restrito ou cota cheia */ }
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeJson(key, value) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch { /* ignora */ }
}

let token = readLocal(TOKEN_KEY);
let cachedUser = readJson(USER_KEY);
let preferredModel = readLocal(MODEL_KEY);

export function getToken() { return token; }
export function apiUser() { return cachedUser; }
export function apiModel() { return preferredModel; }
export function hasApiSession() { return Boolean(token || cachedUser); }

export function setApiUser(user) {
  cachedUser = user || null;
  writeJson(USER_KEY, cachedUser);
  return cachedUser;
}

export function setToken(nextToken) {
  token = String(nextToken || '').trim();
  writeLocal(TOKEN_KEY, token);
  return token;
}

export function setApiModel(model) {
  preferredModel = String(model || '').trim();
  writeLocal(MODEL_KEY, preferredModel);
  return preferredModel;
}

export function clearApiSession() {
  token = '';
  cachedUser = null;
  writeLocal(TOKEN_KEY, '');
  writeJson(USER_KEY, null);
}

/* --------------------------------- Erros ---------------------------------- */

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', network = false, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.network = network;
    this.body = body;
  }
}

const ERROR_MESSAGES = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  invalid_email: 'Informe um e-mail válido.',
  invalid_password: 'A senha não atende aos requisitos.',
  registration_closed: 'O cadastro está fechado. Peça acesso ao administrador.',
  email_taken: 'Já existe uma conta com este e-mail.',
  already_registered: 'Já existe uma conta com este e-mail.',
  unauthorized: 'Sua sessão expirou. Entre novamente.',
  forbidden: 'Você não tem permissão para esta ação.',
  rate_limited: 'Muitas requisições. Aguarde alguns instantes e tente de novo.',
  not_found: 'Endpoint não encontrado na API.',
  service_unavailable: 'O serviço está temporariamente indisponível.',
};

function errorCode(data) {
  const err = data?.error;
  if (typeof err === 'string') return err;
  return err?.code || err?.type || data?.code || '';
}

function errorMessage(data, status) {
  const code = errorCode(data);
  const err = data?.error;
  const detail = (typeof err === 'object' && err && (err.message || err.detail))
    || data?.message || data?.detail || data?.msg || '';

  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (status === 401) return ERROR_MESSAGES.unauthorized;
  if (status === 403) return ERROR_MESSAGES.forbidden;
  if (status === 429) return ERROR_MESSAGES.rate_limited;
  if (status === 404) return ERROR_MESSAGES.not_found;
  if (status >= 500) return ERROR_MESSAGES.service_unavailable;
  return detail || (code ? `Erro da API: ${code}` : `A API respondeu HTTP ${status}.`);
}

function makeError(status, data, fallback = '') {
  const code = errorCode(data);
  return new ApiError(fallback || errorMessage(data, status), {
    status,
    code,
    body: data,
  });
}

export function isTransportError(err) {
  return Boolean(err && (err.network || err.status === 0 || err.status >= 500));
}

/* ------------------------------- Requisições ------------------------------ */

function authHeaders(extra = {}) {
  const headers = { Accept: 'application/json', ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/**
 * Requisição JSON para um dos serviços.
 * Sempre envia cookies (credentials: include) para a sessão llm_session.
 */
export async function apiRequest(base, path, {
  method = 'GET', body, signal, auth = true, timeout = REQUEST_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  const external = signal || null;
  const abortFromCaller = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${normalizeBase(base)}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: authHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await parseBody(res);
    if (!res.ok) throw makeError(res.status, data);
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err?.name === 'AbortError') {
      if (external?.aborted) throw err;
      throw new ApiError('A API demorou demais para responder. Tente novamente.', {
        network: true,
        code: 'timeout',
      });
    }
    throw new ApiError(
      'Não foi possível falar com a API. Verifique sua conexão e se o serviço está no ar.',
      { network: true, code: 'network' },
    );
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener?.('abort', abortFromCaller);
  }
}

/* --------------------------- Normalização de dados ------------------------ */

export function extractToken(data) {
  if (!data || typeof data !== 'object') return '';
  const candidates = [
    data.token,
    data.access_token,
    data.session_token,
    data.bearer,
    data.session?.token,
    data.session?.access_token,
    data.data?.token,
    data.data?.access_token,
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim());
  return found ? found.trim() : '';
}

export function normalizeUser(data) {
  if (!data || typeof data !== 'object') return null;
  const candidates = [
    data.user,
    data.account,
    data.profile,
    data.usuario,
    data.data?.user,
    data.data,
    data,
  ];
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'object') continue;
    const email = String(raw.email || raw.mail || '').trim().toLowerCase();
    const id = raw.id ?? raw.user_id ?? raw.uid ?? raw.sub ?? null;
    if (!email && !id) continue;
    return {
      id,
      email,
      display_name: String(
        raw.display_name || raw.displayName || raw.name || raw.nome
        || (email ? email.split('@')[0] : 'Usuário'),
      ).trim(),
      role: raw.role || raw.papel || null,
      raw,
    };
  }
  return null;
}

/* ---------------------------------- Auth ---------------------------------- */

export async function authStatus() {
  return apiRequest(AUTH_BASE, '/status', { timeout: 12_000 });
}

export async function authRegister({ email, senha }) {
  const data = await apiRequest(AUTH_BASE, '/register', {
    method: 'POST',
    auth: false,
    body: { email, senha },
  });
  const nextToken = extractToken(data);
  const user = normalizeUser(data);
  if (nextToken) setToken(nextToken);
  if (user) setApiUser(user);
  return { data, token: nextToken, user };
}

/**
 * Faz login e devolve o usuário normalizado.
 * O token Bearer é guardado em localStorage; o cookie llm_session também
 * fica disponível para o navegador (credentials: include).
 */
export async function authLogin(email, senha) {
  const data = await apiRequest(AUTH_BASE, '/login', {
    method: 'POST',
    auth: false,
    body: { email, senha },
  });

  const nextToken = extractToken(data);
  if (nextToken) setToken(nextToken);

  let user = normalizeUser(data);
  if (!user) {
    try { user = await authMe(); } catch { /* cookie pode não ter sido aceito */ }
  }
  if (!user) {
    user = {
      id: null,
      email: String(email || '').trim().toLowerCase(),
      display_name: String(email || '').split('@')[0] || 'Usuário',
      role: null,
      raw: data,
    };
  }
  setApiUser(user);
  return user;
}

export async function authMe() {
  const data = await apiRequest(AUTH_BASE, '/me', { timeout: 12_000 });
  const user = normalizeUser(data);
  if (user) setApiUser(user);
  return user;
}

/** Restaura a sessão remota por token e/ou cookie. Nunca lança por 401. */
export async function restoreApiUser() {
  try {
    const user = await authMe();
    if (user) return user;
  } catch (err) {
    if (err?.status === 401) clearApiSession();
    if (err?.status === 401 || err?.status === 403) return null;
  }
  try {
    const status = await authStatus();
    if (status?.authenticated && status.user) {
      const user = normalizeUser(status.user) || normalizeUser({ user: status.user });
      if (user) { setApiUser(user); return user; }
    }
    if (!status?.authenticated) clearApiSession();
  } catch { /* API offline: mantém o estado local */ }
  return null;
}

export async function authLogout() {
  try {
    await apiRequest(AUTH_BASE, '/logout', { method: 'POST', signal: undefined, timeout: 8_000 });
  } catch { /* o logout local deve acontecer mesmo com a API fora do ar */ }
  finally {
    clearApiSession();
  }
}

/* ----------------------------------- LLM ---------------------------------- */

export async function llmHealth() {
  return apiRequest(LLM_BASE, '/health', { timeout: 12_000 });
}

export async function llmModels() {
  return apiRequest(LLM_BASE, '/v1/models', { timeout: 12_000 });
}

export function extractContent(data, isDelta = false) {
  const choice = data?.choices?.[0];
  if (!choice) return '';
  const part = isDelta
    ? (choice.delta || choice.message)
    : (choice.message || choice.delta);
  if (!part) return '';
  if (typeof part.content === 'string') return part.content;
  if (Array.isArray(part.content)) {
    return part.content.map((item) => (item && (item.text || item.content)) || '').join('');
  }
  return '';
}

export async function llmChat({
  messages, model, temperature = 0.7, max_tokens = 1024, signal,
}) {
  const body = { messages, stream: false, temperature, max_tokens };
  const selected = String(model || preferredModel || '').trim();
  if (selected) body.model = selected;
  return apiRequest(LLM_BASE, '/v1/chat/completions', { method: 'POST', body, signal });
}

/**
 * Chat com streaming SSE (OpenAI-compatible).
 * `onDelta(texto)` é chamado a cada fragmento recebido.
 */
export async function llmStream({
  messages, model, temperature = 0.7, max_tokens = 1024, signal, onDelta,
}) {
  const selected = String(model || preferredModel || '').trim();
  const body = { messages, stream: true, temperature, max_tokens };
  if (selected) body.model = selected;

  const res = await fetch(`${LLM_BASE}/v1/chat/completions`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const data = await parseBody(res);
    throw makeError(res.status, data);
  }

  if (!res.body || !res.body.getReader) {
    const data = await res.json();
    const content = extractContent(data);
    if (content && onDelta) onDelta(content);
    return content;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let answer = '';

  function consume(line) {
    const cleaned = line.replace(/\r$/, '');
    if (!cleaned || cleaned.startsWith(':')) return;
    if (!cleaned.startsWith('data:')) return;
    const payload = cleaned.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const json = JSON.parse(payload);
      const delta = extractContent(json, true);
      if (delta) {
        answer += delta;
        if (onDelta) onDelta(delta);
      }
    } catch { /* fragmento parcial: será completado no próximo chunk */ }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(consume);
  }
  if (buffer) consume(buffer);
  return answer;
}

/* ------------------------------- Diagnóstico ------------------------------ */

export async function apiDiagnostics() {
  const [auth, llm] = await Promise.allSettled([authStatus(), llmHealth()]);
  return {
    auth: auth.status === 'fulfilled'
      ? { ok: true, data: auth.value }
      : { ok: false, error: auth.reason?.message || String(auth.reason) },
    llm: llm.status === 'fulfilled'
      ? { ok: true, data: llm.value }
      : { ok: false, error: llm.reason?.message || String(llm.reason), status: llm.reason?.status },
  };
}
