/* ============================================================================
   Dashboard simples do OpenChat — conversa com o Qwen pela API /llm.

   Autenticação: nome de usuário enviado no header X-Usuario (cadastro livre).
   O histórico fica apenas neste navegador e é enviado curto ao modelo:
   o Qwen 2.5 0.5B tem contexto de 1024 tokens.
   ========================================================================== */

import {
  AUTH_BASE,
  LLM_BASE,
  chat,
  clearUsuario,
  extractContent,
  extractModelId,
  getUsuario,
  hasUsuario,
  health,
  isLocalBase,
  models,
  registerUsuario,
  rotuloModelo,
  setUsuario,
  validarUsuario,
} from './core/qwen.js';

const $ = (id) => document.getElementById(id);
const CHAVE_HISTORICO = 'pd.qwen.historico';
const CHAVE_MODELO = 'pd.qwen.modelo';
const MAX_MENSAGENS = 10;
const MAX_HISTORICO_API = 6;

const SISTEMA = 'Você é o assistente do OpenChat da Projetos Dinâmicos. '
  + 'Responda em português do Brasil, de forma curta e direta.';

const SUGESTOES = [
  'O que é SQLite?',
  'Resuma este texto em 3 pontos',
  'Me ajude a organizar minha semana',
  'Explique em uma frase o que é PWA',
];

const els = {
  status: $('api-status'),
  fonte: $('dash-fonte'),
  base: $('dash-base'),
  user: $('dash-usuario'),
  btnUser: $('btn-usuario'),
  btnUserOut: $('btn-usuario-sair'),
  userCard: $('card-usuario'),
  modelo: $('modelo-select'),
  btnModelos: $('btn-atualizar-modelos'),
  thread: $('thread'),
  compose: $('compose'),
  enviar: $('btn-enviar'),
  parar: $('btn-parar'),
  limpar: $('btn-limpar'),
  msg: $('chat-msg'),
  dialog: $('dialog-usuario'),
  formUser: $('form-usuario'),
  inputUser: $('input-usuario'),
  userMsg: $('usuario-msg'),
  salvarUser: $('btn-usuario-salvar'),
  removerUser: $('btn-usuario-remover'),
  fecharUser: $('btn-usuario-fechar'),
};

const state = {
  mensagens: [],
  modelos: [],
  modelo: '',
  ocupado: false,
  controller: null,
};

/* ------------------------------ Utilidades -------------------------------- */

function setMsg(texto, tom = '') {
  if (!els.msg) return;
  els.msg.textContent = texto || '';
  els.msg.dataset.tone = tom;
}

function setUserMsg(texto, tom = '') {
  if (!els.userMsg) return;
  els.userMsg.textContent = texto || '';
  els.userMsg.dataset.tone = tom;
}

function setStatus(estado, texto) {
  if (!els.status) return;
  els.status.dataset.state = estado;
  els.status.textContent = texto;
}

function abrirDialog() {
  if (!els.dialog) return;
  if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
  else els.dialog.setAttribute('open', '');
  els.inputUser?.focus();
}

function fecharDialog() {
  if (!els.dialog) return;
  if (typeof els.dialog.close === 'function') els.dialog.close();
  else els.dialog.removeAttribute('open');
}

function lerHistorico() {
  try {
    const dados = JSON.parse(localStorage.getItem(CHAVE_HISTORICO) || '[]');
    if (!Array.isArray(dados)) return [];
    return dados
      .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      .slice(-MAX_MENSAGENS);
  } catch {
    return [];
  }
}

function salvarHistorico() {
  try {
    const util = state.mensagens
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-MAX_MENSAGENS);
    localStorage.setItem(CHAVE_HISTORICO, JSON.stringify(util));
  } catch { /* cota cheia: conversa continua em memória */ }
}

function lerModeloSalvo() {
  try { return localStorage.getItem(CHAVE_MODELO) || ''; } catch { return ''; }
}

function salvarModelo(id) {
  try {
    if (id) localStorage.setItem(CHAVE_MODELO, id);
    else localStorage.removeItem(CHAVE_MODELO);
  } catch { /* ignora */ }
}

/* ------------------------------ Renderização ------------------------------- */

function renderUsuario() {
  const nome = getUsuario();
  if (els.user) els.user.textContent = nome || (isLocalBase() ? 'llamafile local' : 'sem usuário');
  if (els.btnUser) {
    els.btnUser.textContent = nome ? 'Trocar usuário' : 'Conectar';
    els.btnUser.classList.toggle('hidden', isLocalBase());
  }
  if (els.btnUserOut) els.btnUserOut.classList.toggle('hidden', !nome);
  if (els.userCard) els.userCard.classList.toggle('hidden', isLocalBase());
  if (els.inputUser) els.inputUser.value = nome;
}

function renderModelos() {
  if (!els.modelo) return;
  const opcoes = state.modelos.map((item) => item.id);
  if (!opcoes.includes(state.modelo)) opcoes.unshift(state.modelo);

  els.modelo.replaceChildren();
  for (const id of opcoes) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id ? rotuloModelo(id) : 'modelo padrão do servidor';
    els.modelo.append(option);
  }
  els.modelo.value = state.modelo;
  els.modelo.disabled = state.ocupado || state.modelos.length < 2;
  if (els.fonte) {
    els.fonte.textContent = state.modelos.length
      ? rotuloModelo(extractModelId({ data: state.modelos }))
      : 'detectando modelo…';
  }
}

function renderThread() {
  if (!els.thread) return;
  els.thread.replaceChildren();

  if (!state.mensagens.length) {
    const vazio = document.createElement('div');
    vazio.className = 'dash-empty';
    const titulo = document.createElement('h3');
    titulo.textContent = 'Como posso ajudar?';
    const texto = document.createElement('p');
    texto.textContent = 'Converse com o Qwen. Use um nome de usuário para liberar o gateway /llm.';
    const chips = document.createElement('div');
    chips.className = 'chip-row';
    for (const sugestao of SUGESTOES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = sugestao;
      chip.addEventListener('click', () => {
        if (!els.compose) return;
        els.compose.value = sugestao;
        els.compose.focus();
        redimensionar();
      });
      chips.append(chip);
    }
    vazio.append(titulo, texto, chips);
    els.thread.append(vazio);
    return;
  }

  for (const mensagem of state.mensagens) {
    const linha = document.createElement('div');
    linha.className = `dash-msg ${mensagem.role}`;
    const cabecalho = document.createElement('div');
    cabecalho.className = 'dash-msg-head';
    const autor = document.createElement('strong');
    autor.textContent = mensagem.role === 'user' ? 'Você'
      : mensagem.role === 'assistant' ? 'Qwen' : 'Aviso';
    cabecalho.append(autor);

    const corpo = document.createElement('div');
    corpo.className = 'dash-msg-body';
    corpo.textContent = mensagem.content;
    linha.append(cabecalho, corpo);
    els.thread.append(linha);
  }

  if (state.ocupado) {
    const pensando = document.createElement('div');
    pensando.className = 'dash-msg assistant';
    const corpo = document.createElement('div');
    corpo.className = 'dash-msg-body muted';
    corpo.textContent = 'pensando…';
    pensando.append(coro);
    els.thread.append(pensando);
  }

  els.thread.scrollTop = els.thread.scrollHeight;
}

function redimensionar() {
  if (!els.compose) return;
  els.compose.style.height = 'auto';
  els.compose.style.height = `${Math.min(els.compose.scrollHeight, 160)}px`;
}

function setOcupado(ocupado) {
  state.ocupado = ocupado;
  if (els.enviar) {
    els.enviar.textContent = ocupado ? 'Enviando…' : 'Enviar';
    els.enviar.disabled = ocupado;
  }
  if (els.parar) els.parar.classList.toggle('hidden', !ocupado);
  if (els.limpar) els.limpar.disabled = ocupado;
  if (els.modelo) els.modelo.disabled = ocupado || state.modelos.length < 2;
  if (els.compose) els.compose.disabled = ocupado;
  if (!ocupado) redimensionar();
  renderThread();
}

/* ------------------------------- Conexão ----------------------------------- */

function verificarConexao({ abrirSeSemUsuario = false } = {}) {
  if (!isLocalBase() && !hasUsuario()) {
    setStatus('auth', 'informe seu usuário');
    setMsg('Cadastre um nome de usuário para usar o gateway /llm.', 'warn');
    if (abrirSeSemUsuario) abrirDialog();
    return;
  }

  setStatus('checking', 'verificando API…');
  health()
    .then(() => {
      setStatus('online', 'Qwen online');
      return carregarModelos();
    })
    .then(() => {
      setMsg(isLocalBase()
        ? 'Conectado ao llamafile local.'
        : `Conectado como ${getUsuario() || 'usuário'}.`);
    })
    .catch((erro) => {
      const mensagem = erro?.message || 'Falha ao verificar a API.';
      setStatus(erro?.status === 401 || erro?.status === 403 ? 'auth' : 'offline',
        erro?.status === 401 || erro?.status === 403 ? 'usuário não cadastrado' : 'API offline');
      setMsg(mensagem, 'error');
      if ((erro?.status === 401 || erro?.status === 403) && !isLocalBase()) abrirDialog();
    });
}

async function carregarModelos() {
  const dados = await models();
  const lista = dados?.data || dados?.models || [];
  const ids = (Array.isArray(lista) ? lista : [])
    .map((item) => (typeof item === 'string' ? item : item?.id || item?.model || ''))
    .map((id) => String(id).trim())
    .filter(Boolean);
  state.modelos = [...new Set(ids)].map((id) => ({ id }));

  const salvo = lerModeloSalvo();
  if (!state.modelos.some((item) => item.id === salvo)) {
    const preferido = state.modelos.find((item) => /qwen|instruct|chat/i.test(item.id)) || state.modelos[0];
    state.modelo = preferido?.id || '';
    salvarModelo(state.modelo);
  } else {
    state.modelo = salvo;
  }
  renderModelos();
}

/* ------------------------------- Usuário ----------------------------------- */

async function conectarUsuario(evento) {
  evento?.preventDefault();
  const nome = els.inputUser?.value || '';
  const invalido = validarUsuario(nome);
  if (invalido) {
    setMsg(invalido, 'error');
    setUserMsg(invalido, 'error');
    els.inputUser?.focus();
    return;
  }

  if (els.salvarUser) els.salvarUser.disabled = true;
  setMsg('Cadastrando/validando usuário…');
  try {
    const resultado = await registerUsuario(nome);
    setUsuario(resultado.usuario || nome);
    fecharDialog();
    renderUsuario();
    const aviso = resultado.jaExistia
      ? `Usuário ${getUsuario()} reconhecido.`
      : `Usuário ${getUsuario()} cadastrado.`;
    setMsg(aviso, 'ok');
    setUserMsg(aviso, 'ok');
    verificarConexao();
  } catch (erro) {
    const detalhe = erro?.message || 'Não foi possível cadastrar o usuário.';
    setMsg(detalhe, 'error');
    setUserMsg(detalhe, 'error');
  } finally {
    if (els.salvarUser) els.salvarUser.disabled = false;
  }
}

function desconectarUsuario() {
  clearUsuario();
  if (els.inputUser) els.inputUser.value = '';
  setUserMsg('');
  state.modelos = [];
  state.modelo = '';
  salvarModelo('');
  renderUsuario();
  renderModelos();
  setMsg('Usuário removido deste navegador.', 'ok');
  setStatus('auth', 'informe seu usuário');
  abrirDialog();
}

/* --------------------------------- Chat ----------------------------------- */

function addMensagem(role, content) {
  state.mensagens.push({ role, content: String(content || '') });
  state.mensagens = state.mensagens.slice(-MAX_MENSAGENS);
  salvarHistorico();
  renderThread();
}

async function enviar() {
  if (state.ocupado) return;
  const texto = els.compose?.value.trim() || '';
  if (!texto) {
    setMsg('Escreva uma mensagem para enviar.', 'warn');
    els.compose?.focus();
    return;
  }
  if (!isLocalBase() && !hasUsuario()) {
    setMsg('Conecte um nome de usuário antes de conversar.', 'warn');
    abrirDialog();
    return;
  }

  addMensagem('user', texto.slice(0, 4000));
  if (els.compose) {
    els.compose.value = '';
    redimensionar();
  }
  setMsg('');
  setStatus('checking', 'gerando resposta…');
  setOcupado(true);

  const controller = new AbortController();
  state.controller = controller;
  const historico = state.mensagens
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .slice(-MAX_HISTORICO_API)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 1200) }));
  const mensagens = [{ role: 'system', content: SISTEMA }, ...historico];

  try {
    const dados = await chat({
      messages: mensagens,
      model: state.modelo,
      temperature: 0.6,
      max_tokens: 256,
      signal: controller.signal,
    });
    const conteudo = extractContent(dados).trim();
    if (!conteudo) throw new Error('O modelo retornou uma resposta vazia.');
    addMensagem('assistant', conteudo);
    setStatus('online', 'Qwen online');
    setMsg('Resposta gerada pelo Qwen.', 'ok');
  } catch (erro) {
    if (erro?.name === 'AbortError') {
      addMensagem('note', 'Geração interrompida.');
      setMsg('Geração interrompida.', 'warn');
    } else {
      addMensagem('note', erro?.message || 'Falha ao gerar a resposta.');
      setMsg(erro?.message || 'Falha ao gerar a resposta.', 'error');
      if (erro?.status === 401 || erro?.status === 403) {
        setStatus('auth', 'usuário não cadastrado');
        abrirDialog();
      } else if (erro?.network) {
        setStatus('offline', 'API offline');
      }
    }
  } finally {
    state.controller = null;
    setOcupado(false);
  }
}

function parar() {
  state.controller?.abort();
}

function novaConversa() {
  if (state.ocupado) return;
  state.mensagens = [];
  salvarHistorico();
  setMsg('Nova conversa pronta.', 'ok');
  renderThread();
  els.compose?.focus();
}

/* -------------------------------- Eventos --------------------------------- */

els.enviar?.addEventListener('click', enviar);
els.parar?.addEventListener('click', parar);
els.limpar?.addEventListener('click', novaConversa);
els.compose?.addEventListener('input', redimensionar);
els.compose?.addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter' && !evento.shiftKey && !evento.isComposing) {
    evento.preventDefault();
    enviar();
  }
});

els.btnUser?.addEventListener('click', abrirDialog);
els.btnUserOut?.addEventListener('click', (evento) => {
  evento.stopPropagation();
  desconectarUsuario();
});
els.formUser?.addEventListener('submit', conectarUsuario);
els.salvarUser?.addEventListener('click', conectarUsuario);
els.removerUser?.addEventListener('click', desconectarUsuario);
els.fecharUser?.addEventListener('click', fecharDialog);

els.modelo?.addEventListener('change', (evento) => {
  state.modelo = evento.target.value;
  salvarModelo(state.modelo);
  setMsg(`Modelo selecionado: ${rotuloModelo(state.modelo)}.`, 'ok');
});

els.btnModelos?.addEventListener('click', () => verificarConexao());

window.addEventListener('online', () => verificarConexao());
window.addEventListener('offline', () => {
  setStatus('offline', 'sem conexão');
  setMsg('Sem conexão com a rede. Aguarde para usar o Qwen.', 'warn');
});

/* ---------------------------------- Boot ----------------------------------- */

(function boot() {
  state.mensagens = lerHistorico();
  state.modelo = lerModeloSalvo();
  if (els.base) els.base.textContent = LLM_BASE;
  if (els.inputUser) els.inputUser.value = getUsuario();
  renderUsuario();
  renderModelos();
  renderThread();
  redimensionar();
  document.documentElement.dataset.api = LLM_BASE;
  document.documentElement.dataset.auth = AUTH_BASE;
  verificarConexao({ abrirSeSemUsuario: true });
})();
