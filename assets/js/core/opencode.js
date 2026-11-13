/* ============================================================================
   Cliente da API OpenAI-compatible publicada pelo install_opencode.sh.

   Base:      https://api.projetosdinamicos.com.br/llm
   Auth:      Authorization: Bearer <BRIDGE_TOKEN>
   Endpoints: GET  /health
              GET  /v1/models
              POST /v1/chat/completions

   A ponte do instalador não usa login, cadastro nem cookie de sessão. O token
   é o mesmo "Bearer token" impresso no fim da instalação. Ele fica salvo
   apenas neste navegador (localStorage) e nunca é embutido no HTML.

   A base pode ser trocada sem alterar o código por meio da meta tag:
     <meta name="llm-api-base" content="...">
   ========================================================================== */

const DEFAULT_BASE = 'https://api.projetosdinamicos.com.br/llm';
const TOKEN_KEY = 'pd.opencode_token';
const REQUEST_TIMEOUT_MS = 30_000;
const CHAT_TIMEOUT_MS = 120_000;

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

export const OPENCODE_BASE = normalizeBase(metaContent('llm-api-base', DEFAULT_BASE));

/* ------------------------------- Token ------------------------------------ */

function readStoredToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

function storeToken(value) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* modo restrito ou cota cheia */ }
}

let token = readStoredToken();

export function getToken() { return token; }
export function hasToken() { return Boolean(token); }

export function setToken(nextToken) {
  // Aceita o valor com ou sem o prefixo "Bearer ".
  token = String(nextToken || '').trim().replace(/^Bearer\s+/i, '');
  storeToken(token);
  return token;
}

export function clearToken() {
  token = '';
  storeToken('');
}

/* --------------------------------- Erros ---------------------------------- */

export class OpenCodeError extends Error {
  constructor(message, { status = 0, code = '', network = false, body = null } = {}) {
    super(message);
    this.name = 'OpenCodeError';
    this.status = status;
    this.code = code;
    this.network = network;
    this.body = body;
  }
}

const ERROR_MESSAGES = {
  unauthorized: 'Token ausente ou inválido. Salve o Bearer token gerado pelo install_opencode.sh.',
  invalid_request_error: 'Requisição inválida para a API.',
  rate_limited: 'Limite ou cota do modelo atingido. Aguarde alguns instantes e tente de novo.',
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
    || data?.message || data?.detail || '';

  if (status === 401 || status === 403) return ERROR_MESSAGES.unauthorized;
  if (status === 429) return ERROR_MESSAGES.rate_limited;
  if (status === 404) return ERROR_MESSAGES.not_found;
  if (status >= 500) return ERROR_MESSAGES.service_unavailable;
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return detail || (code ? `Erro da API: ${code}` : `A API respondeu HTTP ${status}.`);
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/* ------------------------------- Requisições ------------------------------ */

async function request(path, {
  method = 'GET', body, signal, timeout = REQUEST_TIMEOUT_MS, auth = true,
} = {}) {
  const controller = new AbortController();
  const external = signal || null;
  const abortFromCaller = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeout);

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`${OPENCODE_BASE}${path}`, {
      method,
      // A ponte responde CORS com "*". Enviar cookies (credentials: include)
      // invalidaria a resposta nesse modo, então o Bearer é a única credencial.
      credentials: 'omit',
      cache: 'no-store',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await parseBody(res);
    if (!res.ok) {
      throw new OpenCodeError(errorMessage(data, res.status), {
        status: res.status,
        code: errorCode(data),
        body: data,
      });
    }
    return data;
  } catch (err) {
    if (err instanceof OpenCodeError) throw err;
    if (err?.name === 'AbortError') {
      if (external?.aborted) throw err;
      throw new OpenCodeError('A API demorou demais para responder. Tente novamente.', {
        network: true,
        code: 'timeout',
      });
    }
    throw new OpenCodeError(
      'Não foi possível falar com a API. Verifique sua conexão e se o serviço está no ar.',
      { network: true, code: 'network' },
    );
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener?.('abort', abortFromCaller);
  }
}

/* ---------------------------------- API ----------------------------------- */

export function health() {
  return request('/health', { auth: false, timeout: 8_000 });
}

export function models() {
  return request('/v1/models', { timeout: 15_000 });
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

export function chat({ messages, model, temperature = 0.7, max_tokens = 1024, signal }) {
  const body = { messages, stream: false, temperature, max_tokens };
  const selected = String(model || '').trim();
  if (selected) body.model = selected;
  return request('/v1/chat/completions', {
    method: 'POST',
    body,
    signal,
    timeout: CHAT_TIMEOUT_MS,
  });
}
