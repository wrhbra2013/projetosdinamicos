/* ============================================================================
   Projetos Dinâmicos — assistente de criação de negócios.

   Fluxo: filtro (modal) -> nichos (JSON da API /llm) -> escolha -> resumo
   (MVP, capital inicial, logística, etc.). Cada mensagem nova reenvia o
   histórico curto para o modelo. Sem token ou com falha, usa demo local.
   ========================================================================== */

import { clearToken, getToken, health, models, setToken } from './core/opencode.js';
import { money } from './core/format.js';
import { MODELO, gerarResumo, sugerirNichos } from './negocios-llm.js';
import { gerarResumoDemo, sugerirNichosDemo } from './negocios-demo.js';

const $ = (id) => document.getElementById(id);
const valor = (id) => $(id)?.value.trim() || '';

const MODELO_LABEL = {
  online: 'Online',
  presencial: 'Presencial',
  hibrido: 'Híbrido',
  qualquer: 'Qualquer',
};

const OBJETIVO_LABEL = {
  renda: 'Renda extra',
  carreira: 'Troca de carreira',
  escalar: 'Escalar',
  primeiro: 'Primeiro negócio',
};

const state = {
  perfil: null,
  etapa: 'perfil',
  fonte: '',
  mensagens: [],
  sugestoes: [],
  selecionada: null,
  resumo: null,
  ocupado: false,
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

function rotuloFonte() {
  return state.fonte === 'llm' ? 'API /llm' : 'demo local';
}

function historico() {
  return state.mensagens
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({ role: item.role, text: item.text }));
}

/* ------------------------------ Renderização ------------------------------- */

function novoNo(tag, classe, texto) {
  const node = document.createElement(tag);
  if (classe) node.className = classe;
  if (texto != null) node.textContent = String(texto);
  return node;
}

function renderPerfil() {
  const alvo = $('perfil-resumo');
  if (!alvo) return;
  alvo.replaceChildren();

  if (!state.perfil) {
    alvo.append(novoNo('p', 'small muted', 'Ainda não há filtro. Abra o modal para descrever seu perfil.'));
    return;
  }

  const p = state.perfil;
  const linhas = [
    ['Ideia', p.ideia || 'Livre'],
    ['Capital', money(p.capital)],
    ['Cidade', p.cidade || 'Não informada'],
    ['Modelo', MODELO_LABEL[p.modelo] || p.modelo || 'Qualquer'],
    ['Tempo', p.horas],
    ['Objetivo', OBJETIVO_LABEL[p.objetivo] || p.objetivo],
    ['Habilidades', p.habilidades || 'Não informadas'],
    ['Público', p.publico || 'A definir'],
    ['Restrições', p.restricoes || 'Nenhuma'],
  ];

  for (const [rotulo, conteudo] of linhas) {
    const linha = novoNo('div', 'pd-kv');
    linha.append(novoNo('span', '', rotulo), novoNo('strong', '', conteudo));
    alvo.append(linha);
  }
}

function renderEtapas() {
  const ordem = ['perfil', 'nichos', 'resumo'];
  const atual = ordem.indexOf(state.etapa);
  document.querySelectorAll('[data-step]').forEach((node) => {
    const indice = ordem.indexOf(node.dataset.step);
    const situacao = indice < atual ? 'done' : indice === atual ? 'active' : 'todo';
    node.dataset.state = situacao;
  });

  const barra = $('progresso-barra');
  if (barra) barra.style.width = `${Math.max(8, ((atual + 1) / 3) * 100)}%`;
  const rotulo = $('progresso-label');
  if (rotulo) rotulo.textContent = `${Math.max(1, atual + 1)}/3`;

  const badge = $('etapa-badge');
  if (badge) {
    badge.textContent = state.etapa === 'perfil'
      ? 'etapa 1 de 3'
      : state.etapa === 'nichos'
        ? 'etapa 2 de 3'
        : 'etapa 3 de 3';
  }
}

function renderThread() {
  const alvo = $('thread');
  if (!alvo) return;
  alvo.replaceChildren();

  if (!state.mensagens.length) {
    const vazio = novoNo('div', 'empty');
    vazio.append(novoNo('div', 'empty-icon', '✦'));
    vazio.append(novoNo('h3', '', 'Comece pelo filtro'));
    vazio.append(novoNo(
      'p',
      '',
      'Informe capital, tempo, modelo e habilidades. A IA devolve nichos e, após sua escolha, monta o resumo do negócio.'
    ));
    const botao = novoNo('button', 'btn primary', 'Abrir filtro de nicho');
    botao.type = 'button';
    botao.addEventListener('click', () => abrirDialog($('dialog-filtros')));
    vazio.append(botao);
    alvo.append(vazio);
    return;
  }

  for (const mensagem of state.mensagens) {
    const linha = novoNo('div', `pd-msg ${mensagem.role}`);
    const autor = mensagem.role === 'user'
      ? 'Você'
      : mensagem.role === 'assistant'
        ? 'Assistente'
        : 'Sistema';
    linha.append(novoNo('strong', 'pd-msg-autor', autor));
    linha.append(novoNo('div', 'pd-msg-corpo', mensagem.text));
    alvo.append(linha);
  }

  if (state.etapa === 'nichos' && state.sugestoes.length) {
    const lista = novoNo('div', 'pd-sugestoes');
    lista.append(novoNo('h3', '', 'Nichos sugeridos'));
    for (const sugestao of state.sugestoes) {
      const cartao = novoNo('article', 'pd-sugestao');
      if (state.selecionada?.id === sugestao.id) cartao.classList.add('selecionada');

      const cabecalho = novoNo('div', 'pd-sugestao-head');
      cabecalho.append(novoNo('h4', '', sugestao.nome));
      cabecalho.append(novoNo('span', 'badge ok', `${sugestao.adesao}%`));
      cartao.append(cabecalho);

      cartao.append(novoNo('p', 'pd-sugestao-nicho', sugestao.nicho));
      const metas = novoNo('div', 'pd-sugestao-metas');
      metas.append(novoNo('span', '', `Capital: ${sugestao.capitalEstimado}`));
      metas.append(novoNo('span', '', `Prazo: ${sugestao.prazo}`));
      cartao.append(metas);

      cartao.append(novoNo('p', 'pd-linha', `Porquê: ${sugestao.porque || '—'}`));
      cartao.append(novoNo('p', 'pd-linha', `MVP: ${sugestao.mvp || '—'}`));
      cartao.append(novoNo('p', 'pd-linha muted', `Riscos: ${sugestao.riscos || '—'}`));

      const botao = novoNo('button', 'btn sm primary', 'Aprofundar este nicho');
      botao.type = 'button';
      botao.disabled = state.ocupado;
      botao.addEventListener('click', () => selecionarNicho(sugestao.id));
      cartao.append(botao);
      lista.append(cartao);
    }
    alvo.append(lista);
  }
}

function blocoResumo(titulo, conteudo) {
  const bloco = novoNo('div', 'pd-resumo-bloco');
  bloco.append(novoNo('h3', '', titulo));

  if (Array.isArray(conteudo)) {
    const lista = novoNo('ul', 'pd-lista');
    for (const item of conteudo) lista.append(novoNo('li', '', item));
    bloco.append(lista);
    return bloco;
  }

  if (conteudo && typeof conteudo === 'object') {
    bloco.append(novoNo('strong', 'pd-total', conteudo.total || '—'));
    const itens = Array.isArray(conteudo.itens) ? conteudo.itens : [];
    if (itens.length) {
      const lista = novoNo('ul', 'pd-lista');
      for (const item of itens) {
        lista.append(novoNo('li', '', `${item.item || 'Item'}: ${item.valor || '—'}`));
      }
      bloco.append(lista);
    }
    return bloco;
  }

  const texto = String(conteudo || '').trim();
  bloco.append(novoNo('p', texto ? '' : 'pendente', texto || 'Aguardando geração do resumo.'));
  return bloco;
}

function renderResumo() {
  const alvo = $('resumo-content');
  if (!alvo) return;
  alvo.replaceChildren();

  const badge = $('resumo-badge');
  if (badge) {
    badge.textContent = state.resumo ? rotuloFonte() : 'aguardando';
    badge.className = state.resumo
      ? `badge ${state.fonte === 'llm' ? 'ok' : 'warn'}`
      : 'badge tag';
  }

  if (!state.resumo) {
    const titulos = ['Nicho', 'MVP', 'Capital inicial', 'Logística', 'Público-alvo', 'Próximos passos'];
    for (const titulo of titulos) alvo.append(blocoResumo(titulo, ''));
    return;
  }

  const n = state.resumo.negocio || {};
  alvo.append(blocoResumo('Nicho', n.nicho));
  alvo.append(blocoResumo('Proposta de valor', n.propostaValor));
  alvo.append(blocoResumo('MVP', n.mvp));
  alvo.append(blocoResumo('Capital inicial', n.capitalInicial));
  alvo.append(blocoResumo('Logística', n.logistica));
  alvo.append(blocoResumo('Canais e precificação', [n.canais, n.precificacao].filter(Boolean)));
  alvo.append(blocoResumo('Riscos', n.riscos));
  alvo.append(blocoResumo('Próximos passos', n.passos));
  alvo.append(blocoResumo('Premissas a validar', state.resumo.premissas));
}

function renderFonte() {
  const info = $('fonte-info');
  if (!info) return;
  if (!state.fonte) {
    info.textContent = 'Nenhuma interação ainda. A fonte aparece após a primeira sugestão.';
    return;
  }
  info.textContent = state.fonte === 'llm'
    ? `Respostas geradas pela API /llm com o modelo ${MODELO}. O token fica apenas neste navegador.`
    : 'Respostas locais de demonstração: a API não respondeu ou o token não foi informado.';
}

function renderTudo() {
  renderPerfil();
  renderEtapas();
  renderThread();
  renderResumo();
  renderFonte();

  const resumoBtn = $('btn-resumo');
  if (resumoBtn) resumoBtn.disabled = !state.selecionada || state.ocupado;
  const copiarBtn = $('btn-copiar');
  if (copiarBtn) copiarBtn.disabled = !state.resumo;
}

function adicionarMensagem(role, texto) {
  state.mensagens.push({ role, text: String(texto || '') });
  renderThread();
}

function setOcupado(ocupado) {
  state.ocupado = ocupado;
  const botoes = [
    'btn-filtros-top', 'btn-filtros-hero', 'btn-editar-filtros',
    'btn-refinar', 'btn-outras', 'btn-resumo',
  ];
  for (const id of botoes) {
    const node = $(id);
    if (node && id !== 'btn-resumo') node.disabled = ocupado;
  }
  const compose = $('compose');
  if (compose) compose.disabled = ocupado;
  const submit = $('btn-filtros-enviar');
  if (submit) submit.disabled = ocupado;

  const resumoBtn = $('btn-resumo');
  if (resumoBtn) resumoBtn.disabled = ocupado || !state.selecionada;
  const cardBotoes = document.querySelectorAll('.pd-sugestao button');
  cardBotoes.forEach((node) => { node.disabled = ocupado; });
}

/* --------------------------------- Chamadas ------------------------------- */

function registrarFalha(erro) {
  const status = Number(erro?.status || 0);
  let detalhe = String(erro?.message || 'falha desconhecida').slice(0, 140);

  if (status === 401 || status === 403) {
    detalhe = 'token recusado pela API';
    abrirDialog($('dialog-token'));
    const msgToken = $('token-msg');
    if (msgToken) {
      msgToken.textContent = 'O token foi recusado. Confira o valor e salve novamente.';
      msgToken.dataset.tone = 'error';
    }
  } else if (status === 429) {
    detalhe = 'limite ou cota do modelo atingido';
  }

  adicionarMensagem('note', `API /llm indisponível (${detalhe}). Seguindo em modo demonstração.`);
}

function respostaDemo(tipo, args) {
  state.fonte = 'demo';
  return tipo === 'nichos'
    ? sugerirNichosDemo(args.perfil, args.mensagem, state.sugestoes.length)
    : gerarResumoDemo(args.perfil, args.selecionada);
}

async function chamarModelo(tipo, args) {
  if (!getToken()) {
    if (!state.avisouToken) {
      state.avisouToken = true;
      abrirDialog($('dialog-token'));
      const msgToken = $('token-msg');
      if (msgToken) {
        msgToken.textContent = 'Informe o Bearer token da API /llm para usar o modelo.';
        msgToken.dataset.tone = '';
      }
      adicionarMensagem('note', 'Sem token informado: usando o modo demonstração. Conecte a API quando quiser respostas do modelo.');
    }
    setMsg('Sem token: sugestões locais de demonstração.', 'warn');
    return respostaDemo(tipo, args);
  }

  try {
    const dados = tipo === 'nichos'
      ? await sugerirNichos(args)
      : await gerarResumo(args);
    state.fonte = 'llm';
    return dados;
  } catch (erro) {
    registrarFalha(erro);
    return respostaDemo(tipo, args);
  }
}

async function carregarNichos(ajuste = '') {
  if (state.ocupado) return;
  if (!state.perfil) {
    abrirDialog($('dialog-filtros'));
    return;
  }

  setOcupado(true);
  setMsg('Consultando a API /llm para sugerir nichos…');

  if (ajuste) adicionarMensagem('user', ajuste);
  const dados = await chamarModelo('nichos', {
    perfil: state.perfil,
    historico: historico(),
    mensagem: ajuste,
  });

  if (dados) {
    state.etapa = 'nichos';
    state.sugestoes = dados.sugestoes || [];
    state.selecionada = null;
    state.resumo = null;
    const texto = [dados.titulo, dados.resumo, dados.pergunta].filter(Boolean).join(' ');
    adicionarMensagem('assistant', texto);
    setMsg(`${state.sugestoes.length} nichos gerados via ${rotuloFonte()}. Escolha um para aprofundar.`, 'ok');
  }

  setOcupado(false);
  renderTudo();
}

async function carregarResumo(ajuste = '') {
  if (state.ocupado) return;
  if (!state.selecionada) {
    setMsg('Escolha um nicho antes de gerar o resumo.', 'warn');
    return;
  }

  setOcupado(true);
  setMsg('Montando o resumo com MVP, capital inicial e logística…');

  if (ajuste) adicionarMensagem('user', ajuste);
  const dados = await chamarModelo('resumo', {
    perfil: state.perfil,
    selecionada: state.selecionada,
    historico: historico(),
    mensagem: ajuste,
  });

  if (dados) {
    state.etapa = 'resumo';
    state.resumo = dados;
    adicionarMensagem('assistant', [dados.titulo, dados.resumo].filter(Boolean).join(' '));
    setMsg(`Resumo gerado via ${rotuloFonte()}. Você pode pedir ajustes no campo de mensagem.`, 'ok');
  }

  setOcupado(false);
  renderTudo();
}

async function selecionarNicho(id) {
  if (state.ocupado) return;
  const sugestao = state.sugestoes.find((item) => item.id === id);
  if (!sugestao) return;
  state.selecionada = sugestao;
  adicionarMensagem('user', `Quero aprofundar: ${sugestao.nome}`);
  renderTudo();
  await carregarResumo();
}

/* --------------------------------- Filtro ---------------------------------- */

function preencherFiltros(p) {
  const campos = {
    'f-ideia': p?.ideia,
    'f-capital': p?.capital,
    'f-cidade': p?.cidade,
    'f-modelo': p?.modelo,
    'f-horas': p?.horas,
    'f-habilidades': p?.habilidades,
    'f-publico': p?.publico,
    'f-objetivo': p?.objetivo,
    'f-restricoes': p?.restricoes,
  };
  for (const [id, conteudo] of Object.entries(campos)) {
    const node = $(id);
    if (node && conteudo != null) node.value = conteudo;
  }
}

function lerFiltros() {
  const capital = Number(valor('f-capital'));
  if (!Number.isFinite(capital) || capital < 0) {
    const erro = $('filtros-erro');
    if (erro) {
      erro.textContent = 'Informe um capital válido (use 0 se não quiser informar).';
      erro.classList.remove('hidden');
    }
    return null;
  }

  return {
    ideia: valor('f-ideia'),
    capital,
    cidade: valor('f-cidade'),
    modelo: valor('f-modelo') || 'qualquer',
    horas: valor('f-horas') || '10 a 20 horas',
    habilidades: valor('f-habilidades'),
    publico: valor('f-publico'),
    objetivo: valor('f-objetivo') || 'primeiro',
    restricoes: valor('f-restricoes'),
  };
}

function enviarFiltros(evento) {
  evento?.preventDefault();
  if (state.ocupado) return;
  const erro = $('filtros-erro');
  erro?.classList.add('hidden');

  const perfil = lerFiltros();
  if (!perfil) return;

  state.perfil = perfil;
  state.mensagens = [];
  state.sugestoes = [];
  state.selecionada = null;
  state.resumo = null;
  state.fonte = '';
  fecharDialog($('dialog-filtros'));

  const partes = [
    perfil.ideia && `Ideia: ${perfil.ideia}`,
    `Capital: ${money(perfil.capital)}`,
    perfil.cidade && `Local: ${perfil.cidade}`,
    `Modelo: ${MODELO_LABEL[perfil.modelo] || perfil.modelo}`,
    `Tempo: ${perfil.horas}`,
    perfil.habilidades && `Habilidades: ${perfil.habilidades}`,
    perfil.publico && `Público: ${perfil.publico}`,
    `Objetivo: ${OBJETIVO_LABEL[perfil.objetivo] || perfil.objetivo}`,
    perfil.restricoes && `Restrições: ${perfil.restricoes}`,
  ].filter(Boolean);

  adicionarMensagem('user', `Filtro do negócio — ${partes.join(' · ')}`);
  renderTudo();
  carregarNichos();
}

/* --------------------------------- Ações ---------------------------------- */

function textoParaCopiar() {
  if (!state.resumo) return '';
  const n = state.resumo.negocio || {};
  const capital = n.capitalInicial || {};
  const linhas = [
    state.resumo.titulo,
    state.resumo.resumo,
    '',
    `Nicho: ${n.nicho || '—'}`,
    `Público-alvo: ${n.publico || '—'}`,
    `Proposta de valor: ${n.propostaValor || '—'}`,
    `MVP: ${n.mvp || '—'}`,
    `Capital inicial: ${capital.total || '—'}`,
    ...(Array.isArray(capital.itens) ? capital.itens.map((i) => `  - ${i.item}: ${i.valor}`) : []),
    `Logística: ${n.logistica || '—'}`,
    `Canais: ${n.canais || '—'}`,
    `Precificação: ${n.precificacao || '—'}`,
    `Riscos: ${n.riscos || '—'}`,
    '',
    'Próximos passos:',
    ...(Array.isArray(n.passos) ? n.passos.map((p, i) => `${i + 1}. ${p}`) : []),
    '',
    'Premissas a validar:',
    ...(Array.isArray(state.resumo.premissas) ? state.resumo.premissas.map((p) => `- ${p}`) : []),
    '',
    `Fonte: ${rotuloFonte()}`,
  ];
  return linhas.filter((linha) => linha !== undefined).join('\n');
}

async function copiarResumo() {
  const texto = textoParaCopiar();
  if (!texto) {
    setMsg('Ainda não há resumo para copiar.', 'warn');
    return;
  }
  try {
    await navigator.clipboard.writeText(texto);
    setMsg('Resumo copiado.', 'ok');
  } catch {
    const area = document.createElement('textarea');
    area.value = texto;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    setMsg('Resumo copiado.', 'ok');
  }
}

function reiniciar() {
  state.perfil = null;
  state.etapa = 'perfil';
  state.fonte = '';
  state.mensagens = [];
  state.sugestoes = [];
  state.selecionada = null;
  state.resumo = null;
  preencherFiltros(null);
  const compose = $('compose');
  if (compose) compose.value = '';
  setMsg('Sessão reiniciada. Abra o filtro para começar de novo.');
  renderTudo();
}

/* --------------------------------- Status --------------------------------- */

async function atualizarStatus() {
  setStatus('checking', 'verificando API…');
  const info = $('modelo-info');
  if (info) info.textContent = `modelo: ${MODELO}`;

  try {
    await health();
  } catch {
    setStatus('offline', 'API /llm offline');
    return;
  }

  if (!getToken()) {
    setStatus('auth', 'token necessário');
    return;
  }

  try {
    const dados = await models();
    const lista = dados?.data || dados?.models || [];
    const total = Array.isArray(lista) ? lista.length : 0;
    setStatus('online', total ? `API online · ${total} modelo(s)` : 'API online · token válido');
  } catch (erro) {
    const invalido = [401, 403].includes(Number(erro?.status || 0));
    setStatus(invalido ? 'auth' : 'offline', invalido ? 'token inválido' : 'API online');
  }
}

/* -------------------------------- Eventos --------------------------------- */

$('form-filtros')?.addEventListener('submit', enviarFiltros);

$('btn-filtros-top')?.addEventListener('click', () => abrirDialog($('dialog-filtros')));
$('btn-filtros-hero')?.addEventListener('click', () => abrirDialog($('dialog-filtros')));
$('btn-filtros-vazio')?.addEventListener('click', () => abrirDialog($('dialog-filtros')));
$('btn-editar-filtros')?.addEventListener('click', () => {
  preencherFiltros(state.perfil);
  abrirDialog($('dialog-filtros'));
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
  const campoToken = $('token');
  if (campoToken) campoToken.value = '';
  fecharDialog($('dialog-token'));
  setMsg('Token salvo neste navegador.', 'ok');
  atualizarStatus();
});

$('btn-token-remover')?.addEventListener('click', () => {
  clearToken();
  setMsg('Token removido deste navegador.');
  const msg = $('token-msg');
  if (msg) msg.textContent = 'Token removido.';
  atualizarStatus();
});

$('btn-refinar')?.addEventListener('click', () => {
  const ajuste = valor('compose');
  if (!ajuste) {
    setMsg('Escreva um ajuste para refinar as sugestões.', 'warn');
    $('compose')?.focus();
    return;
  }
  const destino = state.etapa === 'resumo' ? carregarResumo : carregarNichos;
  if (state.etapa === 'perfil') {
    setMsg('Abra o filtro antes de refinar.', 'warn');
    return;
  }
  const compose = $('compose');
  if (compose) compose.value = '';
  destino(ajuste);
});

$('compose')?.addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter' && !evento.isComposing) {
    evento.preventDefault();
    $('btn-refinar')?.click();
  }
});

$('btn-outras')?.addEventListener('click', () => {
  if (!state.perfil) {
    abrirDialog($('dialog-filtros'));
    return;
  }
  carregarNichos('Traga outras opções, diferentes das sugestões anteriores, respeitando o mesmo filtro.');
});

$('btn-resumo')?.addEventListener('click', () => carregarResumo());
$('btn-copiar')?.addEventListener('click', copiarResumo);
$('btn-reiniciar')?.addEventListener('click', reiniciar);

/* ---------------------------------- Boot ---------------------------------- */

(function boot() {
  const campoToken = $('token');
  if (getToken() && campoToken) campoToken.value = getToken();
  renderTudo();
  atualizarStatus();
})();
