/* ============================================================================
   Cliente do Qwen 2.5 0.5B Instruct (llamafile) atrás do gateway /llm.

   Bases (configuráveis por meta tag):
     LLM   https://api.projetosdinamicos.com.br/llm
     AUTH  https://api.projetosdinamicos.com.br/auth

   Autenticação: header X-Usuario, com cadastro livre em POST /auth/register.
   O llamafile local (127.0.0.1:8080) não exige usuário; o gateway exige um
   nome já cadastrado até para GET /health.

   Endpoints:
     GET  /llm/health
     GET  /llm/v1/models
     POST /llm/v1/chat/completions
     POST /auth/register  { usuario }
   ========================================================================== */

const DEFAULT_LLM_BASE = 'https://api.projetosdinamicos.com.br/llm';
const DEFAULT_AUTH_BASE = 'https://api.projetosdinamicos.com.br/auth';
const USER_KEY = 'pd.qwen.usuario';
const REQUEST_TIMEOUT_MS = 15_000;
const CHAT_TIMEOUT_MS = 60_000;

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

export const LLM_BASE = normalizeBase(metaContent('llm-api-base', DEFAULT_LLM_BASE));
export const AUTH_BASE = normalizeBase(metaContent('auth-api-base', DEFAULT_AUTH_BASE));

/** O llamafile local roda sem cadastro; o gateway público exige X-Usuario. */
export function isLocalBase() {
  try {
    return ['127.0.0.1', 'localhost', '::1'].includes(new URL(LLM_BASE).hostname);
  } catch {
    return false;
  }
}

/* -------------------------------- Usuário ---------------------------------- */

export function normalizeUsuario(valor) {
  return String(valor || '').trim().slice(0, 40);
}

export function validarUsuario(valor) {
  const nome = normalizeUsuario(valor);
  if (!/^[\p{L}\p{N}._-]{2,40}$/u.test(nome)) {
    return 'Use de 2 a 40 caracteres: letras, números, ponto, hífen ou underscore.';
  }
  return '';
}

function readUsuario() {
  try { return localStorage.getItem(USER_KEY) || ''; } catch { return ''; }
}

let usuario = readUsuario();

export function getUsuario() { return usuario; }
export function hasUsuario() { return Boolean(usuario); }

export function setUsuario(valor) {
  usuario = normalizeUsuario(valor);
  try {
    if (usuario) localStorage.setItem(USER_KEY, usuario);
    else localStorage.removeItem(USER_KEY);
  } catch { /* navegador restrito: mantém só em memória */ }
  return usuario;
}

export function clearUsuario() {
  usuario = '';
  try { localStorage.removeItem(USER_KEY); } catch { /* ignora */ }
}

/* --------------------------------- Erros ----------------------------------- */

export class QwenError extends Error {
  constructor(message, { status = 0, code = '', network = false, body = null } = {}) {
    super(message);
    this.name = 'QwenError';
    this.status = status;
    this.code = code;
    this.network = network;
    this.body = body;
  }
}

const MENSAGENS = {
  usuario_exists: 'Este nome já está cadastrado. Você pode usá-lo normalmente.',
  invalid_usuario: 'Nome de usuário inválido.',
  unauthorized: 'Usuário não cadastrado neste gateway. Cadastre um nome para conversar.',
  invalid_request_error: 'Requisição inválida para a API.',
  rate_limited: 'Limite de requisições atingido. Aguarde alguns instantes.',
  not_found: 'Endpoint não encontrado na API.',
  service_unavailable: 'O serviço está temporariamente indisponível.',
};

function errorCode(data) {
  const err = data?.error;
  if (typeof err === 'string') return err;
  return err?.code || err?.type || data?.code || data?.error || '';
}

function errorMessage(data, status) {
  const code = errorCode(data);
  const err = data?.error;
  const detalhe = (typeof err === 'object' && err && (err.message || err.detail))
    || data?.message || data?.detail || '';

  if (status === 401 || status === 403) return MENSAGENS.unauthorized;
  if (status === 429) return MENSAGENS.rate_limited;
  if (status === 404) return MENSAGENS.not_found;
  if (status >= 500) return MENSAGENS.service_unavailable;
  if (MENSAGENS[code]) return MENSAGENS[code];
  return detalhe || (code ? `Erro da API: ${code}` : `A API respondeu HTTP ${status}.`);
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/* ------------------------------- Requisição -------------------------------- */

async function request(path, {
  base = LLM_BASE,
  method = 'GET',
  body,
  signal,
  timeout = REQUEST_TIMEOUT_MS,
  withUser = true,
} = {}) {
  const controller = new AbortController();
  const externo = signal || null;
  const abortar = () => controller.abort();
  if (externo) {
    if (externo.aborted) controller.abort();
    else externo.addEventListener('abort', abortar, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeout);

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (withUser && usuario) headers['X-Usuario'] = usuario;

  try {
    const res = await fetch(`${normalizeBase(base)}${path}`, {
      method,
      // A credencial é o header X-Usuario; cookies não são necessários.
      credentials: 'omit',
      cache: 'no-store',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await parseBody(res);
    if (!res.ok) {
      throw new QwenError(errorMessage(data, res.status), {
        status: res.status,
        code: errorCode(data),
        body: data,
      });
    }
    return data;
  } catch (err) {
    if (err instanceof QwenError) throw err;
    if (err?.name === 'AbortError') {
      if (externo?.aborted) throw err;
      throw new QwenError('A API demorou demais para responder. Tente novamente.', {
        network: true,
        code: 'timeout',
      });
    }
    throw new QwenError(
      'Não foi possível falar com a API. Verifique a conexão e se o gateway está no ar.',
      { network: true, code: 'network' },
    );
  } finally {
    clearTimeout(timer);
    if (externo) externo.removeEventListener?.('abort', abortar);
  }
}

/* ---------------------------------- API ------------------------------------ */

export function health() {
  return request('/health', { timeout: 8_000 });
}

export function models() {
  return request('/v1/models');
}

/**
 * Cadastro livre por nome de usuário. Se o nome já existe (409), segue em frente:
 * isso permite "entrar" novamente sem senha.
 */
export async function registerUsuario(valor) {
  const nome = normalizeUsuario(valor);
  try {
    const data = await request('/register', {
      base: AUTH_BASE,
      method: 'POST',
      body: { usuario: nome },
      withUser: false,
      timeout: 10_000,
    });
    return { ...(data || {}), jaExistia: false, usuario: nome };
  } catch (err) {
    if (err.status === 409 || err.code === 'usuario_exists') {
      return { user: { usuario: nome }, jaExistia: true, usuario: nome };
    }
    throw err;
  }
}

export function extractContent(data) {
  const choice = data?.choices?.[0];
  const part = choice?.message || choice?.delta;
  if (!part) return '';
  if (typeof part.content === 'string') return part.content;
  if (Array.isArray(part.content)) {
    return part.content.map((item) => (item && (item.text || item.content)) || '').join('');
  }
  return '';
}

export function extractModelId(data) {
  const lista = data?.data || data?.models || [];
  if (!Array.isArray(lista) || !lista.length) return '';
  const primeiro = lista[0];
  if (typeof primeiro === 'string') return primeiro;
  return primeiro?.id || primeiro?.model || primeiro?.name || '';
}

/** Mostra "Qwen 2.5 0.5B Instruct" em vez do caminho completo do .gguf. */
export function rotuloModelo(id) {
  const nome = String(id || '').split('/').pop() || String(id || '');
  return nome
    .replace(/\.gguf$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\bq4 k m\b/i, 'Q4_K_M')
    .replace(/\binstruct\b/i, 'Instruct')
    .trim() || 'Modelo padrão';
}

export function chat({ messages, model, temperature = 0.6, max_tokens = 256, signal }) {
  const body = { messages, stream: false, temperature, max_tokens };
  const escolhido = String(model || '').trim();
  // O llamafile aceita qualquer id (ou nenhum); enviar o id detectado é inofensivo.
  if (escolhido) body.model = escolhido;
  return request('/v1/chat/completions', {
    method: 'POST',
    body,
    signal,
    timeout: CHAT_TIMEOUT_MS,
  });
}
