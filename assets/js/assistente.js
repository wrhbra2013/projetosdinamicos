/* ============================================================================
   Projetos Dinâmicos — assistente pessoal offline (PWA).

   Conversa com o modelo Qwen 1B Instruct pela API OpenAI-compatible /llm.
   Sem token, sem rede ou com falha no gateway, usa respostas locais
   determinísticas. Sessões e preferências ficam no localStorage.
   ========================================================================== */

import { chat, clearToken, extractContent, getToken, health, models, setToken } from './core/opencode.js';
import { MODOS, modoPorId, respostaLocal, systemPrompt } from './assistente-prompts.js';
import {
  lerModo, lerModelo, lerPreferencias, lerSessaoAtiva, lerSessoes,
  novaSessao, salvarModelo, salvarModo, salvarPreferencias, salvarSessaoAtiva,
  salvarSessoes,
} from './assistente-storage.js';

const $ = (id) => document.getElementById(id);
const valor = (id) => $(id)?.value.trim() || '';

const meta = (name, fallback) => {
  const node = document.querySelector(`meta[name="${name}"]`);
  return (node?.getAttribute('content') || fallback).trim();
};

const MODELO_PADRAO = meta('pd-modelo', 'qwen1b-instruct') || 'qwen1b-instruct';

const state = {
  sessoes: [],
  sessao: null,
  modo: 'geral',
  preferencias: '',
  modelo: MODELO_PADRAO,
  modelos: [],
  fonte: '',
  ocupado: false,
  anexo: null,
  avisouToken: false,
};

/* --------------------------------- Utilidades ----------------------------- */

function abrirDialog(dialog) {
  if (!dialog || dialog.open) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function fecharDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function setMsg(texto, tom = '') {
  const node = $('chat-msg');
  if (!node) return;
  node.textContent = texto || '';
  node.dataset.tone = tom;
}

function setStatus(estado, texto) {
  const node = $('api-status');
  if (!node) return;
  node.dataset.state = estado;
  node.textContent = texto;
}

function setBanner(visivel) {
  const banner = $('offline-banner');
  if (banner) banner.classList.toggle('hidden', !visivel);
}

function novoNo(tag, classe, texto) {
  const node = document.createElement(tag);
  if (classe) node.className = classe;
  if (texto != null) node.textContent = String(texto);
  return node;
}

function dataCurta(timestamp) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
      .format(new Date(timestamp));
  } catch {
    return '';
  }
}

function pontuacaoModelo(id) {
  const nome = String(id || '').toLowerCase();
  let pontos = 0;
  if (nome.includes('qwen')) pontos += 50;
  if (/(^|[^0-9])1(?:[._-]?[58])?b([^0-9]|$)/.test(nome)) pontos += 30;
  if (/instruct|chat/.test(nome)) pontos += 20;
  return pontos;
}

/* -------------------------------- Persistência ---------------------------- */

function persistir() {
  state.sessoes = salvarSessoes(state.sessoes);
  if (state.sessao) {
    const atual = state.sessoes.find((item) => item.id === state.sessao.id);
    if (atual) state.sessao = atual;
    salvarSessaoAtiva(state.sessao.id);
  } else {
    salvarSessaoAtiva('');
  }
}

function garantirSessao() {
  if (state.sessao && state.sessoes.some((item) => item.id === state.sessao.id)) return state.sessao;
  const sessao = storeNovaSessao();
  state.sessoes.unshift(sessao);
  state.sessao = sessao;
  persistir();
  return sessao;
}

function storeNovaSessao() {
  return novaSessao(state.modo);
}

function definirTitulo(texto) {
  const sessao = garantirSessao();
  if (sessao.titulo !== 'Nova conversa') return;
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
  sessao.titulo = limpo ? `${limpo.slice(0, 46)}${limpo.length > 46 ? '…' : ''}` : 'Nova conversa';
}

function adicionarMensagem(role, texto, meta = null) {
  const sessao = garantirSessao();
  const mensagem = { role, text: String(texto || '') };
  if (meta) mensagem.meta = meta;
  sessao.mensagens.push(mensagem);
  sessao.atualizadoEm = Date.now();
  persistir();
  renderThread();
  renderSessoes();
}

/* ------------------------------ Renderização ------------------------------- */

function renderSessoes() {
  const alvo = $('lista-sessoes');
  if (!alvo) return;
  alvo.replaceChildren();

  const ordenadas = [...state.sessoes].sort((a, b) => b.atualizadoEm - a.atualizadoEm);
  if (!ordenadas.length) {
    alvo.append(novoNo('p', 'as-sem-sessoes', 'Nenhuma conversa salva. Clique em “Nova conversa”.'));
    return;
  }

  for (const sessao of ordenadas) {
    const linha = novoNo('div', `as-sessao${sessao.id === state.sessao?.id ? ' ativa' : ''}`);

    const botao = novoNo('button', 'as-sessao-titulo');
    botao.type = 'button';
    botao.title = sessao.titulo;
    botao.append(novoNo('span', 'as-sessao-rotulo', sessao.titulo));
    botao.append(novoNo('small', '', `${dataCurta(sessao.atualizadoEm)} · ${sessao.mensagens.length} msg`));
    botao.addEventListener('click', () => carregarSessao(sessao.id));
    linha.append(botao);

    const excluir = novoNo('button', 'as-sessao-excluir', '✕');
    excluir.type = 'button';
    excluir.title = 'Excluir conversa';
    excluir.setAttribute('aria-label', `Excluir conversa ${sessao.titulo}`);
    excluir.addEventListener('click', () => excluirSessao(sessao.id));
    linha.append(excluir);
    alvo.append(linha);
  }
}

function renderModos() {
  document.querySelectorAll('[data-modo]').forEach((botao) => {
    botao.setAttribute('aria-pressed', String(botao.dataset.modo === state.modo));
  });
  const compose = $('compose');
  if (compose) compose.placeholder = modoPorId(state.modo).placeholder;
}

function renderConexao() {
  const info = $('conexao-info');
  if (info) {
    if (!getToken()) {
      info.textContent = 'Sem token: respostas locais. Conecte a API /llm para usar o Qwen.';
    } else if (!navigator.onLine) {
      info.textContent = 'Sem conexão: respostas locais até a rede voltar.';
    } else {
      info.textContent = `${state.modelos.length || 1} modelo(s) · ${state.fonte === 'llm' ? 'Qwen ativo' : 'pronto para conversar'}`;
    }
  }

  const label = $('modelo-label');
  if (label) label.textContent = `modelo: ${state.modelo}`;

  const fonte = $('chat-fonte');
  if (fonte) {
    if (state.fonte === 'llm') {
      fonte.textContent = 'API /llm';
      fonte.className = 'badge ok';
    } else if (state.fonte === 'local') {
      fonte.textContent = 'modo local';
      fonte.className = 'badge warn';
    } else {
      fonte.textContent = 'aguardando';
      fonte.className = 'badge tag';
    }
  }

  const select = $('modelo-select');
  if (!select) return;
  const opcoes = state.modelos.length
    ? state.modelos.map((item) => item.id)
    : [state.modelo];
  if (!opcoes.includes(state.modelo)) opcoes.unshift(state.modelo);
  select.replaceChildren();
  for (const id of opcoes) {
    const option = novoNo('option', '', id);
    option.value = id;
    select.append(option);
  }
  select.value = state.modelo;
  select.disabled = !state.modelos.length;
}

function renderThread() {
  const alvo = $('thread');
  if (!alvo) return;
  alvo.replaceChildren();

  const mensagens = state.sessao?.mensagens || [];
  if (!mensagens.length) {
    const vazio = novoNo('div', 'as-empty');
    const icone = novoNo('div', 'empty-icon', '✦');
    vazio.append(icone);
    vazio.append(novoNo('h3', '', 'Como posso ajudar?'));
    vazio.append(novoNo(
      'p',
      '',
      'Converse com o assistente pessoal. Funciona com o Qwen pela API /llm e, sem conexão ou token, com respostas locais.'
    ));

    const chips = novoNo('div', 'as-chips');
    for (const sugestao of modoPorId(state.modo).sugestoes) {
      const chip = novoNo('button', 'chip', sugestao);
      chip.type = 'button';
      chip.dataset.prompt = sugestao;
      chip.addEventListener('click', () => {
        const compose = $('compose');
        if (compose) {
          compose.value = sugestao;
          compose.focus();
          autoRedimensionar(compose);
        }
      });
      chips.append(chip);
    }
    vazio.append(chips);
    alvo.append(vazio);
    return;
  }

  mensagens.forEach((mensagem, indice) => {
    const linha = novoNo('div', `as-msg ${mensagem.role}`);
    const cabecalho = novoNo('div', 'as-msg-head');
    const autor = mensagem.role === 'user'
      ? 'Você'
      : mensagem.role === 'assistant'
        ? 'Assistente'
        : 'Aviso';
    cabecalho.append(novoNo('strong', '', autor));

    if (mensagem.meta?.modelo) {
      cabecalho.append(novoNo('span', 'as-msg-meta', `${mensagem.meta.modelo} · ${mensagem.meta.modo || 'geral'}`));
    }
    linha.append(cabecalho);
    linha.append(novoNo('div', 'as-msg-body', mensagem.text));

    if (mensagem.role === 'assistant') {
      const copiar = novoNo('button', 'as-msg-copy', 'Copiar');
      copiar.type = 'button';
      copiar.dataset.index = String(indice);
      linha.append(copiar);
    }
    alvo.append(linha);
  });

  if (state.ocupado) {
    const digitando = novoNo('div', 'as-msg assistant');
    const indicador = novoNo('span', 'as-typing');
    indicador.append(novoNo('span', '', 'pensando'), novoNo('i', ''), novoNo('i', ''), novoNo('i', ''));
    digitando.append(indicador);
    alvo.append(digitando);
  }

  alvo.scrollTop = alvo.scrollHeight;
}

function renderAnexo() {
  const chip = $('anexo-chip');
  if (!chip) return;
  chip.classList.toggle('hidden', !state.anexo);
  const nome = $('anexo-nome');
  if (nome && state.anexo) nome.textContent = state.anexo.nome;
}

function renderTudo() {
  renderSessoes();
  renderModos();
  renderConexao();
  renderThread();
  renderAnexo();
}

/* ---------------------------------- Ações --------------------------------- */

function carregarSessao(id) {
  const sessao = state.sessoes.find((item) => item.id === id);
  if (!sessao || state.ocupado) return;
  state.sessao = sessao;
  state.modo = sessao.modo || 'geral';
  state.fonte = '';
  salvarSessaoAtiva(id);
  salvarModo(state.modo);
  setMsg('Conversa carregada.');
  renderTudo();
}

function criarConversa() {
  if (state.ocupado) return;
  const sessao = storeNovaSessao();
  state.sessoes.unshift(sessao);
  state.sessao = sessao;
  state.fonte = '';
  persistir();
  const compose = $('compose');
  if (compose) {
    compose.value = '';
    compose.focus();
  }
  setMsg('Nova conversa pronta.');
  renderTudo();
}

function excluirSessao(id) {
  if (state.ocupado) return;
  const sessao = state.sessoes.find((item) => item.id === id);
  if (!sessao) return;
  if (!window.confirm(`Excluir a conversa “${sessao.titulo}”?`)) return;
  state.sessoes = state.sessoes.filter((item) => item.id !== id);
  if (state.sessao?.id === id) {
    state.sessao = state.sessoes[0] || null;
    state.fonte = '';
    if (!state.sessao) {
      state.sessao = storeNovaSessao();
      state.sessoes.unshift(state.sessao);
    }
  }
  persistir();
  setMsg('Conversa excluída.');
  renderTudo();
}

function selecionarModo(id) {
  if (state.ocupado || !modoPorId(id)) return;
  state.modo = id;
  salvarModo(id);
  if (state.sessao) state.sessao.modo = id;
  persistir();
  setMsg(`Modo ${modoPorId(id).nome} ativado.`);
  renderModos();
  renderThread();
  renderConexao();
}

function limparConversa() {
  if (state.ocupado || !state.sessao) return;
  state.sessao.mensagens = [];
  state.sessao.atualizadoEm = Date.now();
  state.fonte = '';
  persistir();
  setMsg('Mensagens desta conversa apagadas. A memória local foi mantida.');
  renderTudo();
}

function setOcupado(ocupado) {
  state.ocupado = ocupado;
  const enviar = $('btn-enviar');
  if (enviar) enviar.textContent = ocupado ? 'Pensando…' : 'Enviar';
  for (const id of ['btn-enviar', 'btn-anexar', 'btn-limpar-chat', 'btn-nova-conversa', 'btn-novo-top']) {
    const node = $(id);
    if (node) node.disabled = ocupado;
  }
  const compose = $('compose');
  if (compose) compose.disabled = ocupado;
  const select = $('modelo-select');
  if (select) select.disabled = ocupado || !state.modelos.length;
}

function registrarFalha(erro) {
  const status = Number(erro?.status || 0);
  let detalhe = String(erro?.message || 'falha desconhecida').slice(0, 120);

  if (status === 401 || status === 403) {
    detalhe = 'token recusado pela API';
    setStatus('auth', 'token inválido');
    abrirDialog($('dialog-token'));
    const msgToken = $('token-msg');
    if (msgToken) {
      msgToken.textContent = 'O token foi recusado. Confira o valor e salve novamente.';
      msgToken.dataset.tone = 'error';
    }
  } else if (status === 429) {
    detalhe = 'limite ou cota do modelo atingida';
  } else if (erro?.network) {
    detalhe = 'gateway inalcançável';
    setStatus('offline', 'API offline · modo local');
    setBanner(true);
  }

  adicionarMensagem('note', `API /llm indisponível (${detalhe}). Usando resposta local.`);
}

function respostaFallback(pergunta) {
  state.fonte = 'local';
  return { texto: respostaLocal({ texto: pergunta, modoId: state.modo }), fonte: 'local' };
}

async function gerarResposta(pergunta, historico) {
  if (!getToken()) {
    if (!state.avisouToken) {
      state.avisouToken = true;
      adicionarMensagem('note', 'Sem token informado: usando respostas locais. Conecte a API /llm quando quiser o Qwen.');
      abrirDialog($('dialog-token'));
    }
    return respostaFallback(pergunta);
  }

  if (navigator.onLine === false) {
    adicionarMensagem('note', 'Sem conexão com a rede: usando resposta local.');
    return respostaFallback(pergunta);
  }

  try {
    const mensagens = [
      { role: 'system', content: systemPrompt(state.modo, state.preferencias) },
      ...historico.slice(-20).map((item) => ({
        role: item.role === 'user' ? 'user' : 'assistant',
        content: String(item.text || '').slice(0, 3000),
      })),
      { role: 'user', content: String(pergunta || '').slice(0, 8000) },
    ];

    const dados = await chat({
      model: state.modelo,
      messages,
      temperature: 0.6,
      max_tokens: 900,
    });
    const conteudo = extractContent(dados).trim();
    if (!conteudo) throw new Error('O modelo retornou uma resposta vazia.');

    state.fonte = 'llm';
    return {
      texto: conteudo,
      fonte: 'llm',
      meta: { modelo: state.modelo, modo: modoPorId(state.modo).nome },
    };
  } catch (erro) {
    registrarFalha(erro);
    return respostaFallback(pergunta);
  }
}

async function enviar() {
  if (state.ocupado) return;
  const digitado = valor('compose');
  if (!digitado && !state.anexo) {
    setMsg('Escreva uma mensagem para enviar.', 'warn');
    $('compose')?.focus();
    return;
  }

  garantirSessao();
  let pergunta = digitado;
  if (state.anexo) {
    pergunta = `${digitado || 'Analise este arquivo.'}\n\n[Arquivo: ${state.anexo.nome}]\n${state.anexo.conteudo}`.slice(0, 9000);
  }
  definirTitulo(digitado || state.anexo?.nome || '');

  const historico = state.sessao.mensagens
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({ role: item.role, text: item.text }));

  adicionarMensagem('user', pergunta);
  const compose = $('compose');
  if (compose) {
    compose.value = '';
    autoRedimensionar(compose);
  }
  state.anexo = null;
  renderAnexo();
  setMsg('');

  setOcupado(true);
  renderThread();
  setStatus('checking', state.fonte === 'llm' ? 'gerando resposta…' : 'consultando API…');
  const resposta = await gerarResposta(pergunta, historico);
  setOcupado(false);
  adicionarMensagem('assistant', resposta.texto, resposta.meta || null);
  renderConexao();

  if (resposta.fonte === 'llm') {
    setStatus('online', 'API /llm online');
    setMsg('Resposta gerada pela API /llm.', 'ok');
  } else {
    setMsg('Resposta local. Conecte a API /llm para usar o Qwen.', 'warn');
  }
}

/* ------------------------------- Conexão ----------------------------------- */

async function carregarModelos() {
  if (!getToken() || navigator.onLine === false) return false;
  try {
    const dados = await models();
    let lista = dados?.data || dados?.models || [];
    if (!Array.isArray(lista)) lista = [];
    state.modelos = lista
      .map((item) => (typeof item === 'string' ? item : item?.id || item?.name || ''))
      .map((id) => String(id).trim())
      .filter(Boolean)
      .map((id) => ({ id }));

    if (state.modelos.length) {
      const salvo = lerModelo();
      const melhor = [...state.modelos].sort((a, b) => pontuacaoModelo(b.id) - pontuacaoModelo(a.id))[0];
      const escolhido = state.modelos.find((item) => item.id === salvo) || melhor;
      state.modelo = escolhido.id;
      salvarModelo(state.modelo);
    }
    return true;
  } catch {
    return false;
  }
}

async function atualizarStatus() {
  setStatus('checking', 'verificando API…');
  if (navigator.onLine === false) {
    setStatus('offline', 'sem conexão · modo local');
    setBanner(true);
    renderConexao();
    return;
  }

  try {
    await health();
  } catch {
    setStatus('offline', 'API /llm offline');
    setBanner(true);
    renderConexao();
    return;
  }

  if (!getToken()) {
    setStatus('auth', 'token necessário');
    setBanner(false);
    renderConexao();
    return;
  }

  const ok = await carregarModelos();
  setStatus(ok ? 'online' : 'offline', ok ? 'API /llm online' : 'modelos indisponíveis');
  setBanner(!ok);
  renderConexao();
}

/* ---------------------------------- Outros --------------------------------- */

function autoRedimensionar(node) {
  if (!node) return;
  node.style.height = 'auto';
  node.style.height = `${Math.min(node.scrollHeight, 190)}px`;
}

function lerArquivo(file) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result || ''));
    leitor.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    leitor.readAsText(file);
  });
}

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    setMsg('Resposta copiada.', 'ok');
  } catch {
    const area = document.createElement('textarea');
    area.value = texto;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    setMsg('Resposta copiada.', 'ok');
  }
}

function registrarSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const registrar = () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // A aplicação continua funcionando sem cache (modo online).
    });
  };
  if (document.readyState === 'complete') registrar();
  else window.addEventListener('load', registrar, { once: true });
}

/* -------------------------------- Eventos ---------------------------------- */

$('btn-novo-top')?.addEventListener('click', criarConversa);
$('btn-nova-conversa')?.addEventListener('click', criarConversa);
$('btn-limpar-chat')?.addEventListener('click', limparConversa);
$('btn-enviar')?.addEventListener('click', enviar);

document.querySelectorAll('[data-modo]').forEach((botao) => {
  botao.addEventListener('click', () => selecionarModo(botao.dataset.modo));
});

$('compose')?.addEventListener('input', (evento) => autoRedimensionar(evento.target));
$('compose')?.addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter' && !evento.shiftKey && !evento.isComposing) {
    evento.preventDefault();
    enviar();
  }
});

$('thread')?.addEventListener('click', (evento) => {
  const botao = evento.target.closest('.as-msg-copy');
  if (!botao) return;
  const indice = Number(botao.dataset.index);
  const mensagem = state.sessao?.mensagens?.[indice];
  if (mensagem) copiarTexto(mensagem.text);
});

let timerMemoria = 0;
$('memoria')?.addEventListener('input', (evento) => {
  clearTimeout(timerMemoria);
  const texto = evento.target.value;
  timerMemoria = window.setTimeout(() => {
    state.preferencias = salvarPreferencias(texto);
    const aviso = $('memoria-msg');
    if (aviso) aviso.textContent = 'Salvo neste navegador.';
  }, 400);
});

$('btn-limpar-memoria')?.addEventListener('click', () => {
  const campo = $('memoria');
  if (campo) campo.value = '';
  state.preferencias = salvarPreferencias('');
  const aviso = $('memoria-msg');
  if (aviso) aviso.textContent = 'Memória local apagada.';
});

$('modelo-select')?.addEventListener('change', (evento) => {
  state.modelo = evento.target.value;
  salvarModelo(state.modelo);
  renderConexao();
  setMsg(`Modelo selecionado: ${state.modelo}.`);
});

$('btn-atualizar-modelos')?.addEventListener('click', () => {
  if (!getToken()) {
    abrirDialog($('dialog-token'));
    return;
  }
  atualizarStatus();
});

$('btn-token-top')?.addEventListener('click', () => abrirDialog($('dialog-token')));
$('btn-token-side')?.addEventListener('click', () => abrirDialog($('dialog-token')));

document.querySelectorAll('[data-close]').forEach((botao) => {
  botao.addEventListener('click', () => fecharDialog($(botao.dataset.close)));
});

$('form-token')?.addEventListener('submit', (evento) => {
  evento.preventDefault();
  const token = valor('token');
  if (!token) {
    const msg = $('token-msg');
    if (msg) {
      msg.textContent = 'Informe o Bearer token.';
      msg.dataset.tone = 'error';
    }
    return;
  }
  setToken(token);
  const campo = $('token');
  if (campo) campo.value = '';
  fecharDialog($('dialog-token'));
  setMsg('Token salvo neste navegador.', 'ok');
  atualizarStatus();
});

$('btn-token-remover')?.addEventListener('click', () => {
  clearToken();
  state.modelos = [];
  state.fonte = '';
  setMsg('Token removido deste navegador.');
  const msg = $('token-msg');
  if (msg) msg.textContent = 'Token removido.';
  renderConexao();
  atualizarStatus();
});

$('btn-anexar')?.addEventListener('click', () => $('file-input')?.click());
$('btn-remover-anexo')?.addEventListener('click', () => {
  state.anexo = null;
  const input = $('file-input');
  if (input) input.value = '';
  renderAnexo();
});

$('file-input')?.addEventListener('change', async (evento) => {
  const arquivo = evento.target.files?.[0];
  if (!arquivo) return;
  if (arquivo.size > 60_000) {
    setMsg('Arquivo muito grande. Use um texto de até 60 KB.', 'warn');
    evento.target.value = '';
    return;
  }
  try {
    const conteudo = await lerArquivo(arquivo);
    state.anexo = { nome: arquivo.name.slice(0, 80), conteudo: conteudo.slice(0, 6000) };
    renderAnexo();
    setMsg('Arquivo anexado à próxima mensagem.', 'ok');
    $('compose')?.focus();
  } catch {
    setMsg('Não foi possível ler o arquivo.', 'error');
  }
});

window.addEventListener('online', () => {
  setBanner(false);
  atualizarStatus();
});
window.addEventListener('offline', () => {
  setStatus('offline', 'sem conexão · modo local');
  setBanner(true);
  renderConexao();
});

/* ---------------------------------- Boot ----------------------------------- */

(function boot() {
  state.sessoes = lerSessoes();
  state.sessao = state.sessoes.find((item) => item.id === lerSessaoAtiva()) || state.sessoes[0] || null;
  if (!state.sessao) {
    state.sessao = storeNovaSessao();
    state.sessoes.unshift(state.sessao);
    persistir();
  }
  state.modo = state.sessao.modo || lerModo();
  state.preferencias = lerPreferencias();
  state.modelo = lerModelo() || MODELO_PADRAO;

  if (new URLSearchParams(location.search).has('nova')) {
    const sessao = storeNovaSessao();
    state.sessoes.unshift(sessao);
    state.sessao = sessao;
    state.modo = sessao.modo;
    persistir();
  }

  const campoMemoria = $('memoria');
  if (campoMemoria) campoMemoria.value = state.preferencias;
  const campoToken = $('token');
  if (campoToken && getToken()) campoToken.value = getToken();

  renderTudo();
  atualizarStatus();
  registrarSW();
})();
