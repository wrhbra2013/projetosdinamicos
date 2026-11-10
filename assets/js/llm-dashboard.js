/* Painel LLM — teste rápido da API ativa com arquivos e conta autenticada. */

import {
  AUTH_BASE,
  LLM_BASE,
  authStatus,
  authLogin,
  authRegister,
  authLogout,
  restoreApiUser,
  getToken,
  setToken,
  apiUser,
  llmChat,
  llmModels,
  llmHealth,
  extractContent,
} from './core/api.js';

const $ = (id) => document.getElementById(id);

const els = {
  status: $('api-status'),
  authState: $('auth-state'),
  authUser: $('auth-user'),
  authLogged: $('auth-logged'),
  loginForm: $('login-form'),
  email: $('email'),
  password: $('password'),
  login: $('login'),
  register: $('register'),
  logout: $('logout'),
  authMsg: $('auth-msg'),
  token: $('token'),
  tokenSave: $('token-save'),
  chatBox: $('chat-box'),
  file: $('file-input'),
  input: $('user-input'),
  send: $('send'),
  chatMsg: $('chat-msg'),
};

let chatMessages = [];
let model = '';

function setStatus(state, text) {
  if (!els.status) return;
  els.status.dataset.state = state;
  els.status.textContent = text;
}

function setAuthMessage(text, tone = '') {
  if (!els.authMsg) return;
  els.authMsg.textContent = text || '';
  els.authMsg.dataset.tone = tone;
}

function setAuthUi(user) {
  const authenticated = Boolean(user);
  els.authLogged?.classList.toggle('hidden', !authenticated);
  els.loginForm?.classList.toggle('hidden', authenticated);
  if (els.authUser) els.authUser.textContent = user ? `${user.display_name || user.email} <${user.email || ''}>` : '';
  if (els.authState) {
    els.authState.textContent = authenticated ? 'conta conectada' : 'visitante';
    if (authenticated) els.authState.dataset.state = 'online';
    else delete els.authState.dataset.state;
  }
  if (els.token && getToken()) els.token.value = getToken();
}

function setChatMessage(text, tone = '') {
  if (!els.chatMsg) return;
  els.chatMsg.textContent = text || '';
  els.chatMsg.dataset.tone = tone;
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

async function resolveAuth() {
  const user = await restoreApiUser();
  setAuthUi(user || null);
  return user || null;
}

async function refreshRegistrationPolicy() {
  try {
    const status = await authStatus();
    if (els.register && status && !status.registration_open) {
      els.register.disabled = true;
      els.register.title = 'O cadastro está fechado. Peça acesso ao administrador.';
    }
  } catch { /* API offline: mantém o botão para mostrar o erro ao tentar */ }
}

async function checkServices() {
  setStatus('checking', 'verificando…');
  const results = await Promise.allSettled([llmHealth(), llmModels()]);
  const health = results[0];
  const models = results[1];

  if (health.status === 'fulfilled') {
    setStatus('online', 'API online');
  } else if (health.reason?.status === 401 || health.reason?.status === 403) {
    setStatus('auth', 'login necessário');
  } else {
    setStatus('offline', 'API offline');
    setChatMessage(health.reason?.message || 'Não foi possível alcançar a API.', 'error');
    return;
  }

  if (models.status === 'fulfilled') {
    const first = models.value?.data?.[0] || models.value?.models?.[0];
    if (first?.id) model = String(first.id);
  }
}

async function doLogin(event) {
  event?.preventDefault();
  const email = els.email?.value.trim() || '';
  const senha = els.password?.value || '';
  if (!email || !senha) { setAuthMessage('Informe e-mail e senha.', 'error'); return; }
  setBusy(els.login, true, 'Entrando…');
  setAuthMessage('');
  try {
    const user = await authLogin(email, senha);
    setAuthUi(user);
    if (els.password) els.password.value = '';
    setAuthMessage('Sessão iniciada.', 'ok');
    await checkServices();
  } catch (error) {
    setAuthMessage(error.message || 'Não foi possível entrar.', 'error');
  } finally {
    setBusy(els.login, false);
  }
}

async function doRegister() {
  const email = els.email?.value.trim() || '';
  const senha = els.password?.value || '';
  if (!email || !senha) { setAuthMessage('Informe e-mail e senha para criar a conta.', 'error'); return; }
  setBusy(els.register, true, 'Criando…');
  setAuthMessage('');
  try {
    await authRegister({ email, senha });
    if (!getToken()) await authLogin(email, senha);
    const user = await resolveAuth();
    setAuthMessage(user ? 'Conta criada e sessão iniciada.' : 'Conta criada. Entre com sua senha.', 'ok');
    await checkServices();
  } catch (error) {
    setAuthMessage(error.message || 'Não foi possível criar a conta.', 'error');
  } finally {
    setBusy(els.register, false);
  }
}

async function doLogout() {
  await authLogout();
  setAuthUi(null);
  setAuthMessage('Sessão encerrada.', 'ok');
  setStatus('auth', 'login necessário');
}

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

async function sendMessage() {
  const text = els.input?.value.trim() || '';
  const file = els.file?.files?.[0] || null;
  if (!text && !file) return;

  let fullContent = text;
  let display = text;
  if (file) {
    try {
      const content = await readFileAsText(file);
      display = `${text ? `${text}\n` : ''}📄 ${file.name}`;
      fullContent = `${text}\n\n[Conteúdo do arquivo ${file.name}]:\n${content}`;
    } catch {
      setChatMessage('Não foi possível ler o arquivo.', 'error');
      return;
    }
  }

  appendMessage('user', display);
  chatMessages.push({ role: 'user', content: fullContent });
  if (els.input) els.input.value = '';
  if (els.file) els.file.value = '';
  setBusy(els.send, true, 'Enviando…');
  setChatMessage('');

  try {
    const data = await llmChat({
      messages: [
        { role: 'system', content: 'Você é um assistente útil. Responda em português do Brasil.' },
        ...chatMessages.slice(-20),
      ],
      model,
    });
    const content = extractContent(data) || data?.message || 'Sem resposta do modelo.';
    chatMessages.push({ role: 'assistant', content });
    appendMessage('assistant', content);
    setStatus('online', 'API online');
  } catch (error) {
    const detail = error?.status === 401 || error?.status === 403
      ? 'Sua sessão na API expirou. Entre novamente para continuar.'
      : error?.status === 429
        ? 'Limite de requisições atingido. Aguarde alguns segundos.'
        : error?.message || 'Falha ao comunicar com a API.';
    appendMessage('error', detail);
    setChatMessage(detail, 'error');
    if (error?.status === 401 || error?.status === 403) setStatus('auth', 'login necessário');
    else setStatus('offline', 'API offline');
  } finally {
    setBusy(els.send, false);
  }
}

els.loginForm?.addEventListener('submit', doLogin);
els.register?.addEventListener('click', doRegister);
els.logout?.addEventListener('click', doLogout);
els.send?.addEventListener('click', sendMessage);
els.input?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    sendMessage();
  }
});
els.tokenSave?.addEventListener('click', () => {
  const value = els.token?.value.trim() || '';
  if (!value) setAuthMessage('Informe um token Bearer.', 'error');
  else {
    setToken(value);
    setAuthMessage('Token salvo neste navegador.', 'ok');
    resolveAuth().then(checkServices);
  }
});

(async function boot() {
  setAuthUi(apiUser());
  await Promise.all([resolveAuth(), refreshRegistrationPolicy()]);
  await checkServices();
  document.documentElement.dataset.api = LLM_BASE;
  console.info(`API LLM: ${LLM_BASE} · Auth: ${AUTH_BASE}`);
})();
