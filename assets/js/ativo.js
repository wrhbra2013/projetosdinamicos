/* OpenFinancial — detalhe do ativo.
   Série histórica vem da CDN; análise probabilística vem da API.
   O fallback local mantém a página útil durante o desenvolvimento. */

import { loadAssets, loadPanorama, loadSeries, sourceLabel } from './core/b3-client.js';
import { dateRangeLabel, movingAverage, renderPriceChart, sliceSeries } from './core/charts.js';
import {
  dateTime,
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

const params = new URLSearchParams(location.search);
const ticker = String(params.get('ticker') || '').toUpperCase();

const state = {
  ticker,
  period: PERIODS.has(params.get('periodo')) ? params.get('periodo') : '6m',
  series: null,
  panorama: null,
  analysis: null,
  asset: null,
};

const $ = (selector) => document.querySelector(selector);

const el = {
  crumb: $('#crumb-ticker'),
  ticker: $('#asset-ticker'),
  name: $('#asset-name'),
  sector: $('#asset-sector'),
  segment: $('#asset-segment'),
  trend: $('#asset-trend'),
  confidence: $('#asset-confidence'),
  price: $('#asset-price'),
  change: $('#asset-change'),
  periodChange: $('#asset-period-change'),
  kpiRetorno: $('#kpi-retorno'),
  kpiVol: $('#kpi-vol'),
  kpiSuporte: $('#kpi-suporte'),
  kpiResistencia: $('#kpi-resistencia'),
  statusAnalise: $('#status-analise'),
  statusSerie: $('#status-serie'),
  updated: $('#asset-updated'),
  chart: $('#grafico-preco'),
  chartSub: $('#preco-sub'),
  probAlta: $('#prob-alta'),
  probLateral: $('#prob-lateral'),
  probBaixa: $('#prob-baixa'),
  probTrack: $('#prob-track'),
  probPeriodo: $('#prob-periodo'),
  probNota: $('#prob-nota'),
  cenarios: $('#cenarios'),
  resumo: $('#asset-resumo'),
  modelo: $('#leitura-modelo'),
  sinais: $('#asset-sinais'),
  indicadores: $('#asset-indicadores'),
  fontes: $('#asset-fontes'),
  demo: $('#asset-demo'),
  alert: $('#asset-alert'),
};

function setSource(node, source, label) {
  if (!node) return;
  node.dataset.source = source || 'erro';
  node.innerHTML = `<span class="dot" aria-hidden="true"></span>${escapeHtml(label)}: ${escapeHtml(
    source ? sourceLabel(source) : 'indisponível'
  )}`;
}

function showAlert(message) {
  el.alert.innerHTML = `<div class="of-alert" role="alert"><span>${escapeHtml(message)}</span><button class="btn sm" type="button">Recarregar</button></div>`;
  el.alert.querySelector('button')?.addEventListener('click', () => location.reload());
}

function markPeriodButtons() {
  document.querySelectorAll('.of-period').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.period === state.period ? 'true' : 'false');
  });
}

function updateUrl() {
  const search = new URLSearchParams(location.search);
  search.set('ticker', state.ticker);
  search.set('periodo', state.period);
  history.replaceState(null, '', `${location.pathname}?${search.toString()}`);
}

function findAnalysis() {
  return (state.panorama?.ativos || []).find((ativo) => ativo.ticker === state.ticker) || null;
}

function findAsset() {
  return (state.assets?.ativos || []).find((ativo) => ativo.ticker === state.ticker) || null;
}

function periodVariation() {
  if (state.analysis) return Number(state.analysis.variacaoPeriodo);
  const value = state.asset?.variacaoPeriodo?.[state.period];
  return Number(value);
}

function renderIdentity() {
  const analysis = state.analysis;
  const asset = state.asset;
  const name = analysis?.nome || asset?.nome || '';
  const sector = analysis?.setor || asset?.setor || 'Setor não informado';
  const segment = analysis?.segmento || asset?.segmento || '';
  const price = analysis?.preco ?? asset?.preco;
  const variation = periodVariation();
  const trend = analysis?.tendencia;

  document.title = `${state.ticker} — OpenFinancial`;
  if (el.crumb) el.crumb.textContent = state.ticker;
  if (el.ticker) el.ticker.textContent = state.ticker;
  if (el.name) el.name.textContent = name;
  if (el.sector) el.sector.textContent = sector;
  if (el.segment) {
    el.segment.textContent = segment || 'B3';
    el.segment.classList.toggle('hidden', !segment);
  }
  if (el.price) el.price.textContent = money(price);
  if (el.change) {
    el.change.textContent = pct(variation);
    el.change.className = variationClass(variation);
  }
  if (el.periodChange) el.periodChange.textContent = `variação em ${PERIOD_NAMES[state.period]}`;

  if (el.trend) {
    el.trend.className = `trend-tag ${trend || 'lateral'}`;
    el.trend.innerHTML = `<i aria-hidden="true"></i>${escapeHtml(trend ? trendLabel(trend) : 'Sem leitura')}`;
  }
  if (el.confidence) {
    el.confidence.textContent = analysis
      ? `confiança de ${Math.round(Number(analysis.confianca || 0) * 100)}%`
      : 'confiança não informada';
  }

  if (el.kpiRetorno) {
    el.kpiRetorno.textContent = pct(variation);
    el.kpiRetorno.className = variationClass(variation);
  }
  if (el.kpiVol) {
    const vol = analysis?.indicadores?.volatilidade;
    el.kpiVol.textContent = Number.isFinite(Number(vol)) ? `${num(vol, 1, 1)}% a.a.` : '—';
  }
  if (el.kpiSuporte) el.kpiSuporte.textContent = money(analysis?.suporte);
  if (el.kpiResistencia) el.kpiResistencia.textContent = money(analysis?.resistencia);
}

function scenarioList() {
  const analysis = state.analysis;
  if (!analysis) return [];
  if (Array.isArray(analysis.cenarios) && analysis.cenarios.length) return analysis.cenarios;
  const probs = analysis.probabilidades || {};
  return [
    { nome: 'alta', probabilidade: probs.alta, retorno: null },
    { nome: 'lateral', probabilidade: probs.lateral, retorno: 0 },
    { nome: 'baixa', probabilidade: probs.baixa, retorno: null },
  ];
}

function renderProbability() {
  const analysis = state.analysis;
  const probs = analysis?.probabilidades || { alta: 0, lateral: 0, baixa: 0 };
  const alta = Number(probs.alta || 0);
  const lateral = Number(probs.lateral || 0);
  const baixa = Number(probs.baixa || 0);

  if (el.probAlta) el.probAlta.textContent = probPct(alta);
  if (el.probLateral) el.probLateral.textContent = probPct(lateral);
  if (el.probBaixa) el.probBaixa.textContent = probPct(baixa);
  if (el.probPeriodo) el.probPeriodo.textContent = PERIOD_NAMES[state.period];

  if (el.probTrack) {
    el.probTrack.innerHTML = `
      <span class="seg alta" style="width:${alta * 100}%"></span>
      <span class="seg lateral" style="width:${lateral * 100}%"></span>
      <span class="seg baixa" style="width:${baixa * 100}%"></span>`;
  }

  if (el.cenarios) {
    const labels = { alta: 'Cenário de alta', lateral: 'Cenário lateral', baixa: 'Cenário de baixa' };
    const scenarios = scenarioList();
    el.cenarios.innerHTML = scenarios.length
      ? scenarios
          .map((scenario) => {
            const name = scenario.nome || 'lateral';
            const probability = Number(scenario.probabilidade || 0);
            const retorno = scenario.retorno === null || scenario.retorno === undefined
              ? null
              : Number(scenario.retorno) * 100;
            return `<div class="of-scenario">
              <strong>${labels[name] || escapeHtml(name)}</strong>
              <b class="${retorno === null ? 'flat' : variationClass(retorno)}">${
                retorno === null ? '—' : pct(retorno)
              }</b>
              <small>probabilidade ${probPct(probability)} · retorno no cenário</small>
            </div>`;
          })
          .join('')
      : '<p class="small muted">Sem cenários detalhados para este período.</p>';
  }

  if (el.probNota) {
    if (!analysis) {
      el.probNota.textContent = 'A análise probabilística não está disponível para este ativo.';
    } else if (lateral >= alta && lateral >= baixa) {
      el.probNota.textContent =
        'A classe lateral é a mais provável. O modelo não força uma direção quando os sinais estão fracos.';
    } else if (Math.abs(alta - baixa) < 0.12) {
      el.probNota.textContent =
        'Alta e baixa estão próximas: a incerteza é alta e o cenário lateral também pesa.';
    } else {
      el.probNota.textContent =
        'Há um viés direcional, mas ele é probabilístico e condicionado aos dados deste período.';
    }
  }
}

function renderChart() {
  const points = sliceSeries(state.series?.serie || [], state.period);
  const closes = points.map((point) => point.fechamento).filter((value) => Number.isFinite(value));
  const overlays = [];
  if (closes.length >= 21) {
    overlays.push({ values: movingAverage(closes, 20), color: '#c19a4a', dash: '4 4' });
  }
  if (closes.length >= 51) {
    overlays.push({ values: movingAverage(closes, 50), color: '#2c6b8a', dash: '3 5' });
  }

  renderPriceChart(el.chart, {
    history: points,
    projection: state.analysis?.projecao || null,
    overlays,
    height: 380,
  });

  if (el.chartSub) {
    const range = dateRangeLabel(points);
    const horizon = state.analysis?.horizonteDias;
    el.chartSub.textContent = range
      ? `${points.length} sessões · ${range}${horizon ? ` · projeção de ${horizon} pregões` : ''}`
      : 'Sem série histórica para este período.';
  }
}

function renderReading() {
  const analysis = state.analysis;
  if (el.resumo) {
    el.resumo.textContent =
      analysis?.resumo ||
      'A leitura textual depende da API de análises. A série de preços e os indicadores continuam disponíveis.';
  }
  if (el.modelo) {
    const model = state.panorama?.modelo || 'OpenFinancial';
    el.modelo.textContent = model.split('/').pop();
    el.modelo.title = model;
  }

  if (el.sinais) {
    const signals = analysis?.sinais || [];
    el.sinais.innerHTML = signals.length
      ? signals.map((signal) => `<span class="of-signal">${escapeHtml(signal)}</span>`).join('')
      : '<span class="small muted">Sem sinais técnicos para este período.</span>';
  }

  if (el.indicadores) {
    const indicators = analysis?.indicadores || {};
    const rows = [
      ['MM 20', Number.isFinite(Number(indicators.mm20)) ? money(indicators.mm20) : '—'],
      ['MM 50', Number.isFinite(Number(indicators.mm50)) ? money(indicators.mm50) : '—'],
      ['MM 200', Number.isFinite(Number(indicators.mm200)) ? money(indicators.mm200) : '—'],
      ['RSI 14', Number.isFinite(Number(indicators.rsi14)) ? num(indicators.rsi14, 1, 1) : '—'],
      ['MACD', Number.isFinite(Number(indicators.macd)) ? num(indicators.macd, 3, 3) : '—'],
      [
        'Volatilidade',
        Number.isFinite(Number(indicators.volatilidade)) ? `${num(indicators.volatilidade, 1, 1)}% a.a.` : '—',
      ],
    ];
    el.indicadores.innerHTML = rows
      .map(
        ([label, value]) =>
          `<div class="of-indicator"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
      )
      .join('');
  }

  if (el.fontes) {
    const sources = analysis?.fontes || [];
    el.fontes.innerHTML = sources.length
      ? sources.map((source) => `<li>${escapeHtml(source)}</li>`).join('')
      : '<li>B3 — séries históricas e API OpenFinancial</li>';
  }

  if (el.demo) {
    const demo = state.panorama?.demo || state.series?.demo || state.assets?.demo;
    el.demo.hidden = !demo;
  }

  if (el.updated) {
    const stamp =
      state.analysis?.atualizadoEm || state.panorama?.geradoEm || state.series?.atualizadoEm || null;
    el.updated.textContent = stamp ? `atualizado em ${dateTime(stamp)}` : 'atualização não informada';
  }
}

function renderAll() {
  renderIdentity();
  renderProbability();
  renderChart();
  renderReading();
}

async function changePeriod(period) {
  if (!PERIODS.has(period) || (period === state.period && state.analysis)) return;
  const anterior = state.period;
  state.period = period;
  markPeriodButtons();
  document.querySelectorAll('.of-period').forEach((button) => {
    button.disabled = true;
  });
  try {
    const panorama = await loadPanorama(period);
    const analysis = (panorama.ativos || []).find((ativo) => ativo.ticker === state.ticker) || null;
    if (!analysis) {
      state.period = anterior;
      markPeriodButtons();
      showAlert(`Não há análise de ${state.ticker} para ${PERIOD_NAMES[period]}.`);
      return;
    }
    state.panorama = panorama;
    state.analysis = analysis;
    setSource(el.statusAnalise, panorama._source, 'análise');
    el.alert.innerHTML = '';
    renderAll();
    updateUrl();
  } catch (error) {
    state.period = anterior;
    markPeriodButtons();
    showAlert('Não foi possível carregar a análise deste período.');
    console.error(error);
  } finally {
    document.querySelectorAll('.of-period').forEach((button) => {
      button.disabled = false;
    });
  }
}

async function start() {
  if (!ticker) {
    location.replace('index.html#ativos');
    return;
  }


  markPeriodButtons();
  document.querySelectorAll('.of-period').forEach((button) => {
    button.addEventListener('click', () => changePeriod(button.dataset.period));
  });

  const [series, assets, panorama] = await Promise.allSettled([
    loadSeries(state.ticker),
    loadAssets(),
    loadPanorama(state.period),
  ]);

  if (series.status === 'fulfilled') {
    state.series = series.value;
    setSource(el.statusSerie, series.value._source, 'série');
  } else {
    setSource(el.statusSerie, null, 'série');
    showAlert('A série histórica não respondeu. Os indicadores podem ficar incompletos.');
    console.error(series.reason);
  }

  if (assets.status === 'fulfilled') {
    state.assets = assets.value;
    state.asset = findAsset();
  }

  if (panorama.status === 'fulfilled') {
    state.panorama = panorama.value;
    state.analysis = findAnalysis();
    setSource(el.statusAnalise, panorama.value._source, 'análise');
    if (!state.analysis) {
      showAlert(`O ativo ${state.ticker} não aparece na cesta analisada deste período.`);
    }
  } else {
    setSource(el.statusAnalise, null, 'análise');
    showAlert('A API de análises não respondeu. Exibindo apenas a série de preços.');
    console.error(panorama.reason);
  }

  renderAll();
  updateUrl();
}

start();
