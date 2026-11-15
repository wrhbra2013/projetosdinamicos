/* ============================================================================
   OpenFinancial — console de busca.

   Motor principal : GET {apiBase}/v1/ativos?busca=<termo>
   Fallback 1      : POST {llmBase}/chat/completions (com o catálogo como contexto)
   Fallback 2      : assets/data/ativos.json (demo local)

   O resultado é sempre texto simples, exibido no textarea da página.
   ========================================================================== */

import { CONFIG, SOURCES } from './core/config.js';
import { normalizeAssets } from './core/b3-client.js';
import {
  compactNumber,
  dateTime,
  money,
  pct,
  probPct,
  trendLabel,
} from './core/format.js';

const $ = (id) => document.getElementById(id);

const els = {
  form: $('form-busca'),
  q: $('q'),
  submit: $('btn-buscar'),
  copy: $('btn-copiar'),
  clear: $('btn-limpar'),
  status: $('status-busca'),
  info: $('busca-info'),
  message: $('busca-status'),
  total: $('busca-total'),
  results: $('resultados'),
};

const MAX_TERMO = 120;

const SOURCE_LABEL = {
  api: 'API /v1/ativos',
  llm: 'IA /llm/v1',
  demo: 'demo local',
};

const resumirErro = (erro, limite = 180) => {
  const texto = String(erro?.message || erro || 'erro desconhecido')
    .replace(/\s+/g, ' ')
    .trim();
  return texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto;
};

/* ------------------------------- Rede ------------------------------------- */

async function fetchJSON(url, timeout = CONFIG.timeout) {
  if (!url) throw new Error('fonte indisponível');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`tempo esgotado em ${url}`);
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function postJSON(url, payload, timeout) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.error?.message || data?.mensagem || data?.message || `HTTP ${response.status}`;
      throw new Error(detail);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('tempo esgotado no gateway de IA');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

/* ----------------------------- Catálogo local ----------------------------- */

let localPromise = null;

function loadLocal() {
  if (!localPromise) {
    localPromise = (async () => {
      const [ativosPayload, panoramaPayload] = await Promise.all([
        fetchJSON(SOURCES.local('ativos.json')),
        fetchJSON(SOURCES.local('panorama.json')).catch(() => null),
      ]);
      const ativos = normalizeAssets(ativosPayload).ativos;
      const trends = new Map();
      const bloco = panoramaPayload?.periodos?.['6m'];
      for (const analise of bloco?.ativos || []) {
        if (analise?.ticker) trends.set(String(analise.ticker).toUpperCase(), analise);
      }
      return {
        ativos,
        trends,
        fonte: ativosPayload?.fonte || 'demo',
        atualizadoEm: ativosPayload?.atualizadoEm || null,
      };
    })().catch((error) => {
      localPromise = null;
      throw error;
    });
  }
  return localPromise;
}

/* -------------------------------- Motores --------------------------------- */

async function searchAPI(termo) {
  const payload = await fetchJSON(
    SOURCES.api(`/v1/ativos?busca=${encodeURIComponent(termo)}`)
  );
  const normalizado = normalizeAssets(payload);
  const totalApi = Number(payload?.total);
  return {
    source: 'api',
    ativos: normalizado.ativos,
    total: payload?.total != null && Number.isFinite(totalApi)
      ? totalApi
      : normalizado.ativos.length,
    atualizadoEm: payload?.atualizadoEm || normalizado.atualizadoEm || null,
    fonte: payload?.fonte || normalizado.fonte,
  };
}

async function searchLLM(termo) {
  const local = await loadLocal();
  if (!local.ativos.length) throw new Error('catálogo local indisponível');

  const catalogo = local.ativos.map((ativo) => {
    const analise = local.trends.get(ativo.ticker);
    const probs = analise?.probabilidades;
    const tendencia = analise
      ? ` | tendência 6m: ${trendLabel(analise.tendencia)} ` +
        `(alta ${probPct(probs?.alta)}, lateral ${probPct(probs?.lateral)}, baixa ${probPct(probs?.baixa)})`
      : '';
    return `${ativo.ticker} — ${ativo.nome} | setor: ${ativo.setor}` +
      `${ativo.segmento ? ' / ' + ativo.segmento : ''} | ` +
      `preço: ${money(ativo.preco)} | dia: ${pct(ativo.variacaoDia)}${tendencia}`;
  }).join('\n');

  const data = await postJSON(
    CONFIG.llmBase + '/chat/completions',
    {
      model: CONFIG.searchModel,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        {
          role: 'system',
          content: 'Você é o motor de busca do OpenFinancial, um panorama probabilístico de ativos da B3. ' +
            'Responda em português do Brasil, em texto simples, sem markdown. Liste no máximo 6 ativos do ' +
            'catálogo recebido que atendam à busca, com ticker, nome, setor, preço e tendência. ' +
            'Se nada combinar, diga isso claramente e sugira termos próximos.',
        },
        {
          role: 'user',
          content: `Catálogo de ativos:\n${catalogo}\n\nBusca do usuário: "${termo}"`,
        },
      ],
    },
    CONFIG.llmTimeout
  );

  const texto = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!texto) throw new Error('o gateway de IA não retornou resultados');
  return { source: 'llm', answer: texto };
}

const normalizarTexto = (valor) => String(valor ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

async function searchDemo(termo) {
  const local = await loadLocal();
  const alvo = normalizarTexto(termo);
  const ativos = local.ativos.filter((ativo) =>
    normalizarTexto(
      [ativo.ticker, ativo.nome, ativo.setor, ativo.segmento].filter(Boolean).join(' ')
    ).includes(alvo)
  );
  return {
    source: 'demo',
    ativos,
    total: ativos.length,
    trends: local.trends,
    atualizadoEm: local.atualizadoEm,
    fonte: local.fonte,
  };
}

async function search(termo) {
  const notes = [];

  try {
    return await searchAPI(termo);
  } catch (error) {
    notes.push('API: ' + resumirErro(error));
  }

  try {
    const resultado = await searchLLM(termo);
    return { ...resultado, notes };
  } catch (error) {
    notes.push('IA: ' + resumirErro(error));
  }

  const resultado = await searchDemo(termo);
  return { ...resultado, notes };
}

/* ------------------------------- Formatação ------------------------------- */

const PERIODOS = ['1m', '3m', '6m', '1a', '5a'];

function variacaoPeriodo(variacoes) {
  const partes = PERIODOS
    .filter((periodo) => Number.isFinite(Number(variacoes?.[periodo])))
    .map((periodo) => `${periodo} ${pct(variacoes[periodo])}`);
  return partes.length ? partes.join(' | ') : '—';
}

function linkAtivo(ticker) {
  return new URL(`ativo.html?ticker=${encodeURIComponent(ticker)}`, location.href).href;
}

function renderAtivos(resultado) {
  if (!resultado.ativos.length) {
    return 'Nenhum ativo encontrado.\n\n' +
      'Tente outro ticker, nome ou setor (ex.: PETR4, Vale, bancos, energia).';
  }

  return resultado.ativos.map((ativo, indice) => {
    const linhas = [
      `${indice + 1}. ${ativo.ticker} — ${ativo.nome}`,
      `   Setor: ${ativo.setor}${ativo.segmento ? ' · ' + ativo.segmento : ''}`,
      `   Preço: ${money(ativo.preco)} · Dia: ${pct(ativo.variacaoDia)}`,
      `   Variação: ${variacaoPeriodo(ativo.variacaoPeriodo)}`,
    ];

    if (Number(ativo.volume) > 0) {
      linhas.push(`   Volume: ${compactNumber(ativo.volume)}`);
    }

    const analise = resultado.trends?.get(ativo.ticker);
    const probs = analise?.probabilidades;
    if (probs) {
      linhas.push(
        `   Tendência 6m: ${trendLabel(analise.tendencia)} · ` +
        `alta ${probPct(probs.alta)} / lateral ${probPct(probs.lateral)} / baixa ${probPct(probs.baixa)}`
      );
    }

    linhas.push(`   ${linkAtivo(ativo.ticker)}`);
    return linhas.join('\n');
  }).join('\n\n');
}

function renderResultado(resultado, termo) {
  const total = resultado.source === 'llm'
    ? 'resposta da IA'
    : `${resultado.total ?? resultado.ativos?.length ?? 0} resultado(s)`;
  const atualizado = resultado.atualizadoEm
    ? ` · atualizado em ${dateTime(resultado.atualizadoEm)}`
    : '';
  const dados = resultado.source === 'api' && resultado.fonte
    ? ` · dados: ${resultado.fonte}`
    : '';
  const cabecalho =
    `Busca: "${termo}"\n` +
    `Fonte: ${SOURCE_LABEL[resultado.source] || resultado.source}${dados} · ${total}${atualizado}\n` +
    `${'='.repeat(56)}\n\n`;

  const corpo = resultado.source === 'llm'
    ? resultado.answer
    : renderAtivos(resultado);

  const tentativas = resultado.notes?.length
    ? `\n\n${'-'.repeat(56)}\nTentativas:\n` +
      resultado.notes.map((nota) => '· ' + nota).join('\n')
    : '';

  return cabecalho + corpo + tentativas;
}

/* ---------------------------------- UI ------------------------------------ */

function setChip(source, texto) {
  if (!els.status) return;
  els.status.dataset.source = source || '';
  els.status.innerHTML = '<span class="dot" aria-hidden="true"></span>';
  els.status.append(document.createTextNode(texto));
}

function setBusy(busy) {
  if (els.submit) {
    els.submit.disabled = busy;
    els.submit.textContent = busy ? 'Pesquisando…' : 'Pesquisar';
  }
  if (els.q) els.q.disabled = busy;
  els.form?.setAttribute('aria-busy', String(busy));
}

function setTotal(resultado) {
  if (!els.total) return;
  els.total.textContent = resultado.source === 'llm'
    ? 'via IA'
    : `${resultado.total ?? resultado.ativos?.length ?? 0} ativo(s)`;
}

function updateUrl(termo) {
  try {
    const url = termo
      ? `${location.pathname}?${new URLSearchParams({ q: termo }).toString()}`
      : location.pathname;
    history.replaceState(null, '', url);
  } catch {
    // Histórico indisponível (file://, iframe restrito): a busca continua.
  }
}

async function runSearch() {
  const termo = (els.q?.value || '').trim().slice(0, MAX_TERMO);
  if (!termo) {
    els.q?.focus();
    if (els.message) els.message.textContent = 'Digite um ticker, nome ou setor para pesquisar.';
    return;
  }

  const inicio = performance.now();
  setBusy(true);
  setChip('loading', 'fonte: consultando…');
  let host = 'a API OpenFinancial';
  try {
    host = new URL(CONFIG.apiBase).host || host;
  } catch {
    // Mantém o rótulo genérico quando a base configurada não é uma URL válida.
  }
  if (els.message) els.message.textContent = `Consultando ${host}…`;
  if (els.total) els.total.textContent = '…';

  try {
    const resultado = await search(termo);
    const texto = renderResultado(resultado, termo);
    if (els.results) {
      els.results.value = texto;
      els.results.scrollTop = 0;
    }

    const segundos = ((performance.now() - inicio) / 1000).toFixed(1).replace('.', ',');
    const total = resultado.source === 'llm'
      ? 'resposta da IA'
      : `${resultado.total ?? resultado.ativos?.length ?? 0} resultado(s)`;
    setChip(resultado.source, `fonte: ${SOURCE_LABEL[resultado.source] || resultado.source}`);
    setTotal(resultado);
    if (els.message) {
      els.message.textContent = `Concluído em ${segundos}s · ${total} · motor: ${SOURCE_LABEL[resultado.source] || resultado.source}`;
    }
    if (els.info) {
      els.info.textContent = resultado.atualizadoEm
        ? `dados de ${dateTime(resultado.atualizadoEm)}`
        : 'busca concluída';
    }

    updateUrl(termo);
  } catch (error) {
    setChip('erro', 'fonte: indisponível');
    if (els.results) {
      els.results.value = 'Não foi possível concluir a busca.\n\n' + (error.message || error);
    }
    if (els.message) els.message.textContent = 'Falha na busca.';
    if (els.info) els.info.textContent = 'busca indisponível';
    if (els.total) els.total.textContent = '—';
  } finally {
    setBusy(false);
    els.q?.focus();
  }
}

/* -------------------------------- Eventos --------------------------------- */

els.form?.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch();
});

els.copy?.addEventListener('click', async () => {
  const texto = els.results?.value.trim() || '';
  if (!texto) {
    if (els.message) els.message.textContent = 'Nada para copiar ainda.';
    return;
  }
  try {
    await navigator.clipboard.writeText(texto);
    if (els.message) els.message.textContent = 'Resultados copiados.';
  } catch {
    els.results.select();
    document.execCommand('copy');
    if (els.message) els.message.textContent = 'Resultados copiados.';
  }
});

els.clear?.addEventListener('click', () => {
  if (els.q) els.q.value = '';
  if (els.results) {
    els.results.value = '';
    els.results.scrollTop = 0;
  }
  if (els.total) els.total.textContent = '—';
  if (els.info) els.info.textContent = 'aguardando busca';
  if (els.message) els.message.textContent = 'Digite um ticker, nome ou setor para pesquisar.';
  setChip('', 'fonte: aguardando');
  updateUrl('');
  els.q?.focus();
});

/* ------------------------------- Inicialização ---------------------------- */

(function boot() {
  setChip('', 'fonte: aguardando');
  const termo = new URLSearchParams(location.search).get('q');
  if (termo && els.q) {
    els.q.value = termo.slice(0, MAX_TERMO);
    runSearch();
  }
})();
