/* Painel OpenCode — teste rápido da API OpenAI-compatible do install_opencode.sh.
   Sem login/cadastro: a credencial é o Bearer token informado pelo usuário. */

import {
  OPENCODE_BASE,
  chat,
  clearToken,
  extractContent,
  getToken,
  health,
  models,
  setToken,
} from './core/opencode.js';

const $ = (id) => document.getElementById(id);

const els = {
  status: $('api-status'),
  tokenState: $('token-state'),
  tokenForm: $('token-form'),
  token: $('token'),
  tokenClear: $('token-clear'),
  tokenMsg: $('token-msg'),
  modelBadge: $('model-badge'),
  chatBox: $('chat-box'),
  file: $('file-input'),
  input: $('user-input'),
  send: $('send'),
  chatMsg: $('chat-msg'),
};

let chatMessages = [];
let modelCount = 0;

/* --------------------------------- UI ------------------------------------- */

function setStatus(state, text) {
  if (!els.status) return;
  els.status.dataset.state = state;
  els.status.textContent = text;
}

function setTokenState(state, text) {
  if (!els.tokenState) return;
  if (state) els.tokenState.dataset.state = state;
  else delete els.tokenState.dataset.state;
  els.tokenState.textContent = text;
}

function setMessage(node, text, tone = '') {
  if (!node) return;
  node.textContent = text || '';
  node.dataset.tone = tone;
}

function updateModelBadge() {
  if (!els.modelBadge) return;
  els.modelBadge.classList.toggle('hidden', modelCount <= 0);
  els.modelBadge.textContent = modelCount > 0
    ? `${modelCount} modelo${modelCount === 1 ? '' : 's'} disponível${modelCount === 1 ? '' : 'is'}`
    : '';
}

function setBusy(button, busy, label = '') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label || 'Aguarde…';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

/* ----------------------------- Conexão ------------------------------------ */

async function refreshConnection() {
  setStatus('checking', 'verificando…');
  setMessage(els.tokenMsg, '');

  try {
    await health();
    setStatus('online', 'API online');
  } catch {
    setStatus('offline', 'API offline');
    setTokenState('', getToken() ? 'token salvo' : 'sem token');
    setMessage(els.tokenMsg, 'Não foi possível alcançar /llm/health.', 'error');
    return;
  }

  if (!getToken()) {
    setTokenState('auth', 'sem token');
    setMessage(els.tokenMsg, 'Informe o Bearer token para liberar /v1/models e o chat.');
    return;
  }

  setTokenState('', 'validando token…');
  try {
    const data = await models();
    const list = data?.data || data?.models || [];
    modelCount = Array.isArray(list) ? list.length : 0;
    updateModelBadge();
    setTokenState('online', 'token válido');
  } catch (error) {
    modelCount = 0;
    updateModelBadge();
    if (error?.status === 401 || error?.status === 403) {
      setTokenState('auth', 'token inválido');
      setMessage(els.tokenMsg, 'O token foi recusado pela API. Confira o valor gerado na instalação.', 'error');
    } else {
      setTokenState('', 'token salvo');
      setMessage(els.tokenMsg, error?.message || 'Falha ao listar os modelos.', 'error');
    }
  }
}

/* ------------------------------- Token ------------------------------------ */

async function saveToken(event) {
  event?.preventDefault();
  const value = els.token?.value.trim() || '';
  if (!value) {
    setMessage(els.tokenMsg, 'Informe um Bearer token.', 'error');
    els.token?.focus();
    return;
  }
  setToken(value);
  await refreshConnection();
  if (els.tokenState?.dataset.state === 'online') {
    setMessage(els.tokenMsg, 'Token salvo e validado.', 'ok');
  }
}

async function removeToken() {
  clearToken();
  if (els.token) els.token.value = '';
  modelCount = 0;
  updateModelBadge();
  setMessage(els.tokenMsg, 'Token removido.', 'ok');
  await refreshConnection();
}

/* --------------------------------- Chat ----------------------------------- */

function appendMessage(role, text, meta = '') {
  const row = document.createElement('div');
  row.className = `message ${role}`;
  const label = document.createElement('strong');
  label.textContent = role === 'user' ? 'Você' : role === 'assistant' ? 'IA' : 'Aviso';
  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = text;
  row.append(label, body);
  if (meta) {
    const small = document.createElement('div');
    small.className = 'message-meta';
    small.textContent = meta;
    row.append(small);
  }
  els.chatBox?.append(row);
  if (els.chatBox) els.chatBox.scrollTop = els.chatBox.scrollHeight;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = (event) => reject(event);
    reader.readAsText(file);
  });
}

function chatErrorMessage(error) {
  if (error?.status === 401 || error?.status === 403) {
    return 'Token inválido ou ausente. Salve o Bearer token gerado pelo install_opencode.sh.';
  }
  if (error?.status === 429) {
    return 'Limite ou cota do modelo atingido. Aguarde alguns instantes e tente de novo.';
  }
  return error?.message || 'Falha ao comunicar com a API.';
}

async function sendMessage() {
  const text = els.input?.value.trim() || '';
  const file = els.file?.files?.[0] || null;
  if (!text && !file) return;

  if (!getToken()) {
    setMessage(els.chatMsg, 'Informe o Bearer token antes de conversar.', 'error');
    els.token?.focus();
    return;
  }

  let fullContent = text;
  let display = text;
  if (file) {
    try {
      const content = await readFileAsText(file);
      display = `${text ? `${text}\n` : ''}📄 ${file.name}`;
      fullContent = `${text}\n\n[Conteúdo do arquivo ${file.name}]:\n${content}`;
    } catch {
      setMessage(els.chatMsg, 'Não foi possível ler o arquivo.', 'error');
      return;
    }
  }

  appendMessage('user', display);
  chatMessages.push({ role: 'user', content: fullContent });
  if (els.input) els.input.value = '';
  if (els.file) els.file.value = '';
  setBusy(els.send, true, 'Enviando…');
  setMessage(els.chatMsg, '');

  try {
    const data = await chat({
      messages: [
        { role: 'system', content: 'Você é um assistente útil. Responda em português do Brasil.' },
        ...chatMessages.slice(-20),
      ],
    });
    const content = extractContent(data) || data?.message || 'Sem resposta do modelo.';
    chatMessages.push({ role: 'assistant', content });
    appendMessage('assistant', content);
    setStatus('online', 'API online');
    setTokenState('online', 'token válido');
  } catch (error) {
    const detail = chatErrorMessage(error);
    appendMessage('error', detail);
    setMessage(els.chatMsg, detail, 'error');
    if (error?.status === 401 || error?.status === 403) {
      setTokenState('auth', 'token inválido');
      setStatus('auth', 'token necessário');
    } else if (error?.network) {
      setStatus('offline', 'API offline');
    }
  } finally {
    setBusy(els.send, false);
  }
}

/* -------------------------------- Eventos --------------------------------- */

els.tokenForm?.addEventListener('submit', saveToken);
els.tokenClear?.addEventListener('click', removeToken);
els.send?.addEventListener('click', sendMessage);
els.input?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    sendMessage();
  }
});

(async function boot() {
  if (getToken() && els.token) els.token.value = getToken();
  setTokenState(getToken() ? 'online' : '', getToken() ? 'token salvo' : 'sem token');
  updateModelBadge();
  await refreshConnection();
  document.documentElement.dataset.api = OPENCODE_BASE;
  console.info(`API OpenCode: ${OPENCODE_BASE}`);
})();
