/* OpenFinancial — comportamento do panorama.
   Fonte de mercado: CDN. Fonte de análise: API. Fallback: assets/data (demo). */

import {
  clearCache,
  loadAssets,
  loadMarket,
  loadPanorama,
  sourceLabel,
} from './core/b3-client.js';
import { renderSparkline, renderStackedProbability } from './core/charts.js';
import {
  dateShort,
  dateTime,
  debounce,
  escapeHtml,
  money,
  num,
  pct,
  probPct,
  trendLabel,
  variationClass,
} from './core/format.js';

const PERIODS = new Set(['1m', '3m', '6m', '1a', '5a']);
const PERIOD_NAMES = {
  '1m': '1 mês',
  '3m': '3 meses',
  '6m': '6 meses',
  '1a': '1 ano',
  '5a': '5 anos',
};

const state = {
  period: '6m',
  panorama: null,
  assets: null,
  market: null,
  search: '',
  sector: '',
  trend: '',
  sparklines: new Map(),
};

const $ = (selector) => document.querySelector(selector);

const el = {
  statusPanorama: $('#status-panorama'),
  statusAtivos: $('#status-ativos'),
  atualizado: $('#atualizado'),
  heroTrend: $('#hero-trend'),
  heroTrendDetail: $('#hero-trend-detail'),
  heroCount: $('#hero-count'),
  heroModel: $('#hero-model'),
  heroPeriod: $('#hero-period'),
  resumo: $('#resumo-periodo'),
  recarregar: $('#recarregar'),
  indices: $('#indices'),
  chart: $('#grafico-prob'),
  probSub: $('#prob-sub'),
  breadthBar: $('#breadth-bar'),
  breadthList: $('#breadth-list'),
  breadthPeriod: $('#breadth-period'),
  heatmap: $('#heatmap'),
  busca: $('#busca'),
  setor: $('#setor'),
  filtros: $('#filtros-tendencia'),
  tabela: $('#tabela-ativos'),
  tabelaVazia: $('#tabela-vazia'),
  ativosCount: $('#ativos-count'),
  eventos: $('#eventos'),
  eventosFonte: $('#eventos-fonte'),
};

const periodoInicial = () => {
  const url = new URLSearchParams(location.search).get('periodo');
  return PERIODS.has(url) ? url : '6m';
};

function setSource(node, source, label) {
  if (!node) return;
  node.dataset.source = source || 'erro';
  node.innerHTML = `<span class="dot" aria-hidden="true"></span>${escapeHtml(label)}: ${escapeHtml(
    source ? sourceLabel(source) : 'indisponível'
  )}`;
}

function setBusy(busy) {
  if (el.recarregar) {
    el.recarregar.disabled = busy;
    el.recarregar.textContent = busy ? 'Atualizando…' : 'Atualizar dados';
  }
  if (el.chart) el.chart.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function showAlert(message) {
  document.querySelector('.of-alert[data-auto]')?.remove();
  const alert = document.createElement('div');
  alert.className = 'of-alert';
  alert.dataset.auto = 'true';
  alert.setAttribute('role', 'alert');
  alert.innerHTML = `<span>${escapeHtml(message)}</span><button class="btn sm" type="button">Tentar de novo</button>`;
  alert.querySelector('button').addEventListener('click', () => {
    alert.remove();
    reloadAll(true);
  });
  const toolbar = document.querySelector('.of-toolbar');
  toolbar?.before(alert);
}

function markPeriodButtons() {
  document.querySelectorAll('.of-period').forEach((button) => {
    const active = button.dataset.period === state.period;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function updateUrl() {
  const params = new URLSearchParams(location.search);
  if (state.period === '6m') params.delete('periodo');
  else params.set('periodo', state.period);
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}

function fmtIndexValue(index) {
  const tipo = index.tipo || (index.codigo === 'IBOV' ? 'indice' : index.codigo === 'USD/BRL' ? 'moeda' : 'taxa');
  if (tipo === 'indice') return `${num(index.valor, 0, 0)} pts`;
  if (tipo === 'moeda') return `R$ ${num(index.valor, 2, 2)}`;
  return `${num(index.valor, 2, 2)}%`;
}

function fmtIndexChange(index, value) {
  const tipo = index.tipo || 'indice';
  if (tipo === 'taxa' || tipo === 'inflacao') {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n), 2, 2)} p.p.`;
  }
  return pct(value);
}

function renderIndices() {
  const market = state.market;
  if (!el.indices) return;
  if (!market?.indices?.length) {
    el.indices.innerHTML = '<div class="of-alert"><span>Indicadores de mercado indisponíveis no momento.</span></div>';
    return;
  }

  el.indices.innerHTML = market.indices
    .map((index) => {
      const change = index.variacaoPeriodo?.[state.period] ?? index.variacaoDia;
      const cls = variationClass(change);
      const label = state.period === '1m' ? 'em 1 mês' : `em ${PERIOD_NAMES[state.period]}`;
      return `
        <article class="of-index">
          <div class="of-index-head">
            <span class="of-index-code">${escapeHtml(index.codigo)}</span>
            <span class="of-index-name">${escapeHtml(index.nome)}</span>
          </div>
          <strong class="of-index-value">${escapeHtml(fmtIndexValue(index))}</strong>
          <div class="of-index-foot">
            <span class="of-index-change ${cls}">${escapeHtml(fmtIndexChange(index, change))}</span>
            <span class="of-index-label">${escapeHtml(label)}</span>
          </div>
          <svg data-index-spark="${escapeHtml(index.codigo)}" aria-hidden="true"></svg>
        </article>`;
    })
    .join('');

  for (const index of market.indices) {
    const svg = el.indices.querySelector(`[data-index-spark="${CSS.escape(index.codigo)}"]`);
    if (!svg) continue;
    const change = index.variacaoPeriodo?.[state.period] ?? index.variacaoDia;
    renderSparkline(svg, index.sparkline, {
      color: Number(change) < 0 ? '#b05a4a' : '#2f7a64',
      height: 30,
      width: 180,
    });
  }
}

function renderHero(panorama) {
  const ativos = panorama.ativos || [];
  const dist = panorama.distribuicao || {};
  const total = Object.values(dist).reduce((sum, value) => sum + Number(value || 0), 0);
  const dominant = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
  const share = total ? (dominant?.[1] || 0) / total : 0;

  if (el.heroCount) el.heroCount.textContent = String(ativos.length || '—');
  if (el.heroTrend) {
    el.heroTrend.textContent = dominant ? trendLabel(dominant[0]) : '—';
    el.heroTrend.className = dominant ? `trend-${dominant[0]}` : '';
    if (dominant) el.heroTrend.style.color = '';
  }
  if (el.heroTrendDetail) {
    el.heroTrendDetail.textContent = dominant
      ? `${pct(share * 100, 0, false)} da cesta em ${trendLabel(dominant[0]).toLowerCase()}`
      : 'Sem distribuição disponível.';
  }
  if (el.heroModel) {
    const model = panorama.modelo || 'OpenFinancial';
    el.heroModel.textContent = model.split('/').pop();
    el.heroModel.title = model;
  }
  if (el.heroPeriod) el.heroPeriod.textContent = `período de ${panorama.periodoLabel || PERIOD_NAMES[state.period]}`;
  if (el.resumo) {
    const frases = String(panorama.resumo || '').split('. ');
    const curto = frases.slice(0, 2).join('. ');
    el.resumo.textContent = curto
      ? `${curto}${curto.endsWith('.') ? '' : '.'}`
      : 'Sem resumo para este período.';
    el.resumo.title = panorama.resumo || '';
  }
  if (el.probSub) {
    el.probSub.textContent = `Evolução das classes de tendência · ${panorama.periodoLabel || PERIOD_NAMES[state.period]}`;
  }
  if (el.breadthPeriod) el.breadthPeriod.textContent = panorama.periodoLabel || PERIOD_NAMES[state.period];
}

function renderBreadth(panorama) {
  const dist = panorama.distribuicao || { alta: 0, lateral: 0, baixa: 0 };
  const total = Math.max(1, Number(dist.alta || 0) + Number(dist.lateral || 0) + Number(dist.baixa || 0));
  const keys = ['alta', 'lateral', 'baixa'];
  const labels = { alta: 'Alta', lateral: 'Lateral', baixa: 'Baixa' };

  if (el.breadthBar) {
    el.breadthBar.innerHTML = keys
      .map((key) => `<span class="${key}" style="width:${((Number(dist[key]) || 0) / total) * 100}%"></span>`)
      .join('');
  }

  if (el.breadthList) {
    el.breadthList.innerHTML = keys
      .map((key) => {
        const count = Number(dist[key]) || 0;
        const share = (count / total) * 100;
        return `<div>
          <dt class="${key}"><i aria-hidden="true"></i>${labels[key]}</dt>
          <span class="track"><span class="${key}" style="width:${share}%"></span></span>
          <dd>${count} · ${pct(share, 0, false)}</dd>
        </div>`;
      })
      .join('');
  }
}

function renderHeatmap(panorama) {
  if (!el.heatmap) return;
  const ativos = (panorama.ativos || []).slice().sort(
    (a, b) => (b.probabilidades?.alta || 0) - (a.probabilidades?.alta || 0)
  );
  if (!ativos.length) {
    el.heatmap.innerHTML = '<p class="muted small">Nenhum ativo analisado neste período.</p>';
    return;
  }

  el.heatmap.innerHTML = ativos
    .map((ativo) => {
      const probs = ativo.probabilidades || {};
      const trend = ativo.tendencia || 'lateral';
      const href = `ativo.html?ticker=${encodeURIComponent(ativo.ticker)}&periodo=${encodeURIComponent(state.period)}`;
      return `<a class="of-tile" data-trend="${escapeHtml(trend)}" href="${href}"
        aria-label="${escapeHtml(ativo.ticker)}: ${escapeHtml(trendLabel(trend))}, ${probPct(probs.alta)} de probabilidade de alta">
        <span class="of-tile-top">
          <strong>${escapeHtml(ativo.ticker)}</strong>
          <span class="${variationClass(ativo.variacaoPeriodo)}">${escapeHtml(pct(ativo.variacaoPeriodo))}</span>
        </span>
        <span class="of-tile-name">${escapeHtml(ativo.nome || ativo.setor || '')}</span>
        <span class="of-tile-bottom">
          <small>${escapeHtml(trendLabel(trend))} · ${probPct(probs.alta)}</small>
          <span class="of-mini-stack" aria-hidden="true">
            <span class="seg alta" style="width:${Number(probs.alta || 0) * 100}%"></span>
            <span class="seg lateral" style="width:${Number(probs.lateral || 0) * 100}%"></span>
            <span class="seg baixa" style="width:${Number(probs.baixa || 0) * 100}%"></span>
          </span>
        </span>
      </a>`;
    })
    .join('');
}

function populateSectors(panorama) {
  if (!el.setor) return;
  const sectors = [...new Set((panorama.ativos || []).map((a) => a.setor).filter(Boolean))].sort();
  const current = el.setor.value;
  el.setor.innerHTML =
    '<option value="">Todos os setores</option>' +
    sectors.map((sector) => `<option value="${escapeHtml(sector)}">${escapeHtml(sector)}</option>`).join('');
  if (sectors.includes(current)) el.setor.value = current;
}

function filteredAssets(panorama) {
  const query = state.search.trim().toLowerCase();
  return (panorama.ativos || []).filter((ativo) => {
    if (state.trend && ativo.tendencia !== state.trend) return false;
    if (state.sector && ativo.setor !== state.sector) return false;
    if (!query) return true;
    return [ativo.ticker, ativo.nome, ativo.setor]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
}

function renderTable(panorama) {
  if (!el.tabela) return;
  const ativos = filteredAssets(panorama);
  if (el.ativosCount) {
    const total = (panorama.ativos || []).length;
    el.ativosCount.textContent =
      ativos.length === total ? `${total} ativos` : `${ativos.length} de ${total} ativos`;
  }
  if (el.tabelaVazia) el.tabelaVazia.hidden = ativos.length > 0;

  if (!ativos.length) {
    el.tabela.innerHTML = '<tr><td colspan="8" class="muted">Nenhum ativo corresponde aos filtros.</td></tr>';
    return;
  }

  state.sparklines.clear();
  el.tabela.innerHTML = ativos
    .map((ativo) => {
      const probs = ativo.probabilidades || {};
      const trend = ativo.tendencia || 'lateral';
      const spark = state.assets?.ativos?.find((item) => item.ticker === ativo.ticker)?.sparkline || [];
      if (spark.length > 1) state.sparklines.set(ativo.ticker, spark);
      return `<tr class="clickable" tabindex="0" data-ticker="${escapeHtml(ativo.ticker)}"
        aria-label="Abrir análise de ${escapeHtml(ativo.ticker)}">
        <td>
          <div class="of-asset">
            <strong>${escapeHtml(ativo.ticker)}</strong>
            <small>${escapeHtml(ativo.nome || '')}</small>
          </div>
        </td>
        <td class="of-sector">${escapeHtml(ativo.setor || '—')}</td>
        <td class="num">${money(ativo.preco)}</td>
        <td class="num"><span class="${variationClass(ativo.variacaoPeriodo)}">${escapeHtml(
          pct(ativo.variacaoPeriodo)
        )}</span></td>
        <td><span class="trend-tag ${escapeHtml(trend)}"><i aria-hidden="true"></i>${escapeHtml(
          trendLabel(trend)
        )}</span></td>
        <td>
          <div class="of-prob-cell">
            <span class="of-mini-stack" aria-hidden="true">
              <span class="seg alta" style="width:${Number(probs.alta || 0) * 100}%"></span>
              <span class="seg lateral" style="width:${Number(probs.lateral || 0) * 100}%"></span>
              <span class="seg baixa" style="width:${Number(probs.baixa || 0) * 100}%"></span>
            </span>
            <b>${probPct(probs.alta)}</b>
          </div>
        </td>
        <td><svg class="of-spark" data-spark="${escapeHtml(ativo.ticker)}" aria-hidden="true"></svg></td>
        <td class="of-open" aria-hidden="true">→</td>
      </tr>`;
    })
    .join('');

  for (const [ticker, values] of state.sparklines) {
    const svg = el.tabela.querySelector(`[data-spark="${CSS.escape(ticker)}"]`);
    if (svg) renderSparkline(svg, values, { color: '#2f7a64', width: 92, height: 28 });
  }
}

function renderEvents(panorama) {
  if (!el.eventos) return;
  const events = (panorama.eventos || []).slice().reverse();
  if (!events.length) {
    el.eventos.innerHTML = '<li class="of-event"><div></div><div><h3>Sem eventos catalogados neste período.</h3></div></li>';
    if (el.eventosFonte) el.eventosFonte.textContent = 'sem eventos';
    return;
  }

  el.eventos.innerHTML = events
    .map((event) => {
      const impact = ['positivo', 'negativo', 'neutro'].includes(event.impacto) ? event.impacto : 'neutro';
      const title = event.url
        ? `<a href="${escapeHtml(event.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(event.titulo)}</a>`
        : escapeHtml(event.titulo);
      return `<li class="of-event">
        <time datetime="${escapeHtml(event.data || '')}">${escapeHtml(dateShort(event.data))}</time>
        <div>
          <h3>${title}</h3>
          <div class="of-event-meta">
            <span>${escapeHtml(event.fonte || 'fonte não informada')}</span>
            <span aria-hidden="true">·</span>
            <span class="of-impact ${impact}"><i aria-hidden="true"></i>${impact}</span>
            ${event.demo ? '<span aria-hidden="true">·</span><span>demo</span>' : ''}
          </div>
        </div>
      </li>`;
    })
    .join('');

  const demo = panorama.demo || events.every((event) => event.demo);
  if (el.eventosFonte) {
    el.eventosFonte.textContent = demo ? 'demonstração' : `${events.length} no período`;
  }
}

function renderPanorama() {
  const panorama = state.panorama;
  if (!panorama) return;
  renderHero(panorama);
  renderBreadth(panorama);
  renderHeatmap(panorama);
  populateSectors(panorama);
  renderTable(panorama);
  renderEvents(panorama);
  renderIndices();
  renderStackedProbability(el.chart, {
    points: panorama.serieProbabilidades || [],
    height: 300,
  });
  if (el.atualizado) {
    const stamp = panorama.geradoEm || state.market?.atualizadoEm || panorama.ativos?.[0]?.atualizadoEm;
    el.atualizado.textContent = stamp ? `atualizado em ${dateTime(stamp)}` : 'atualização não informada';
  }
}

function openAsset(ticker) {
  if (!ticker) return;
  location.href = `ativo.html?ticker=${encodeURIComponent(ticker)}&periodo=${encodeURIComponent(state.period)}`;
}

function wireTable() {
  el.tabela?.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-ticker]');
    if (row) openAsset(row.dataset.ticker);
  });
  el.tabela?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('tr[data-ticker]');
    if (!row) return;
    event.preventDefault();
    openAsset(row.dataset.ticker);
  });
}

async function changePeriod(period) {
  if (!PERIODS.has(period) || period === state.period) return;
  const anterior = state.period;
  state.period = period;
  markPeriodButtons();
  setBusy(true);
  try {
    state.panorama = await loadPanorama(period);
    renderPanorama();
    setSource(el.statusPanorama, state.panorama._source, 'análises');
    updateUrl();
  } catch (error) {
    // Mantém a leitura anterior e devolve o seletor ao período que está na tela.
    state.period = anterior;
    markPeriodButtons();
    showAlert('Não foi possível carregar o período selecionado. A leitura anterior foi mantida.');
    console.error(error);
  } finally {
    setBusy(false);
  }
}

async function reloadAll(force = false) {
  if (force) clearCache();
  const overrides = force ? { force: true } : {};
  setBusy(true);
  setSource(el.statusPanorama, null, 'análises');
  setSource(el.statusAtivos, null, 'ativos');
  if (el.atualizado) el.atualizado.textContent = 'consultando fontes…';

  const [panorama, assets, market] = await Promise.allSettled([
    loadPanorama(state.period, overrides),
    loadAssets(overrides),
    loadMarket(overrides),
  ]);

  if (panorama.status === 'fulfilled') {
    state.panorama = panorama.value;
    setSource(el.statusPanorama, panorama.value._source, 'análises');
    renderPanorama();
  } else {
    setSource(el.statusPanorama, null, 'análises');
    showAlert('As análises não responderam. Verifique a conexão e tente novamente.');
    console.error(panorama.reason);
  }

  if (assets.status === 'fulfilled') {
    state.assets = assets.value;
    setSource(el.statusAtivos, assets.value._source, 'ativos');
    if (state.panorama) {
      renderTable(state.panorama);
      renderHeatmap(state.panorama);
    }
  } else {
    setSource(el.statusAtivos, null, 'ativos');
  }

  if (market.status === 'fulfilled') {
    state.market = market.value;
    renderIndices();
    if (state.panorama && el.atualizado) {
      const stamp = state.panorama.geradoEm || market.value.atualizadoEm;
      if (stamp) el.atualizado.textContent = `atualizado em ${dateTime(stamp)}`;
    }
  }

  setBusy(false);
}

function wireControls() {
  document.querySelectorAll('.of-period').forEach((button) => {
    button.addEventListener('click', () => changePeriod(button.dataset.period));
  });

  el.recarregar?.addEventListener('click', () => reloadAll(true));

  const applyFilters = () => {
    if (!state.panorama) return;
    renderTable(state.panorama);
  };

  el.busca?.addEventListener(
    'input',
    debounce(() => {
      state.search = el.busca.value;
      applyFilters();
    }, 160)
  );

  el.setor?.addEventListener('change', () => {
    state.sector = el.setor.value;
    applyFilters();
  });

  el.filtros?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-trend]');
    if (!button) return;
    state.trend = button.dataset.trend || '';
    el.filtros.querySelectorAll('button').forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    applyFilters();
  });
}

function start() {
  state.period = periodoInicial();
  markPeriodButtons();
  updateUrl();
  wireControls();
  wireTable();

  if (location.protocol === 'file:') {
    showAlert('Módulos ES não funcionam em file://. Sirva a pasta com "python3 -m http.server 8080" e abra http://localhost:8080/.');
    setSource(el.statusPanorama, null, 'análises');
    setSource(el.statusAtivos, null, 'ativos');
    return;
  }

  reloadAll(false);
}

start();
