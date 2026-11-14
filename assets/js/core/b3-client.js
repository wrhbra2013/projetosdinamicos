/* OpenFinancial — cliente das fontes de dados.
   CDN  : ativos, series e mercado (JSON estatico, cacheavel).
   API  : panorama probabilistico, analises e eventos.
   Demo : copia local em assets/data para o site nao quebrar sem backend. */

import { CONFIG, SOURCES } from './config.js';
import { safeArray } from './format.js';

const cache = new Map();

async function fetchJSON(url, timeout = CONFIG.timeout) {
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
  } finally {
    window.clearTimeout(timer);
  }
}

async function firstAvailable(candidates) {
  const errors = [];
  for (const candidate of candidates) {
    if (!candidate.url) continue;
    try {
      const data = await fetchJSON(candidate.url);
      return { data, source: candidate.source, url: candidate.url };
    } catch (error) {
      errors.push(`${candidate.source}: ${error.message}`);
    }
  }
  const error = new Error(`Nenhuma fonte respondeu. ${errors.join(' | ')}`);
  error.details = errors;
  throw error;
}

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeAsset = (item = {}) => ({
  ticker: String(item.ticker || item.symbol || item.codigo || '').toUpperCase(),
  nome: item.nome || item.name || item.razaoSocial || item.ticker || '',
  setor: item.setor || item.sector || 'Outros',
  segmento: item.segmento || item.segment || '',
  preco: toNumber(item.preco ?? item.price ?? item.ultimo ?? item.close),
  variacaoDia: toNumber(item.variacaoDia ?? item.change ?? item.variacao),
  variacaoPeriodo: item.variacaoPeriodo || item.variacoes || {},
  volume: toNumber(item.volume ?? item.volumeFinanceiro),
  marketCap: toNumber(item.marketCap ?? item.valorMercado),
  sparkline: safeArray(item.sparkline || item.historicoResumo || item.serie).map((p) =>
    toNumber(typeof p === 'number' ? p : p.fechamento ?? p.close ?? p.valor)
  ),
  atualizadoEm: item.atualizadoEm || item.updatedAt || null,
});

export function normalizeAssets(payload) {
  const list = safeArray(payload?.ativos || payload?.data || payload);
  return {
    fonte: payload?.fonte || payload?.source || 'desconhecida',
    demo: payload?.demo === true || payload?.fonte === 'demo',
    moeda: payload?.moeda || 'BRL',
    atualizadoEm: payload?.atualizadoEm || payload?.updatedAt || null,
    ativos: list.map(normalizeAsset).filter((a) => a.ticker),
  };
}

export function normalizeMarket(payload) {
  const indices = safeArray(payload?.indices || payload?.data || payload);
  return {
    fonte: payload?.fonte || payload?.source || 'desconhecida',
    demo: payload?.demo === true || payload?.fonte === 'demo',
    atualizadoEm: payload?.atualizadoEm || null,
    indices: indices.map((item) => ({
      codigo: String(item.codigo || item.symbol || item.ticker || '').toUpperCase(),
      nome: item.nome || item.name || item.codigo || '',
      tipo: item.tipo || item.type || null,
      valor: toNumber(item.valor ?? item.value ?? item.preco ?? item.close),
      variacaoDia: toNumber(item.variacaoDia ?? item.change ?? item.variacao),
      variacaoPeriodo: item.variacaoPeriodo || item.variacoes || {},
      sparkline: safeArray(item.sparkline || item.serie).map((p) =>
        toNumber(typeof p === 'number' ? p : p.fechamento ?? p.close ?? p.valor)
      ),
    })),
    breadth: payload?.breadth || null,
  };
}

export function normalizePanorama(payload, period) {
  if (!payload) return null;
  const periodos = payload.periodos || payload.periods;
  const selected = periodos?.[period] || periodos?.['6m'] || payload;
  const ativos = safeArray(selected.ativos || selected.analises || selected.data || selected);

  return {
    fonte: payload.fonte || selected.fonte || 'desconhecida',
    demo: payload.demo === true || payload.fonte === 'demo' || selected.demo === true,
    geradoEm: payload.geradoEm || selected.atualizadoEm || selected.geradoEm || null,
    modelo: payload.modelo || selected.modelo || null,
    disclaimer: payload.disclaimer || selected.disclaimer || '',
    periodo: selected.periodo || period,
    periodoLabel: selected.periodoLabel || period,
    resumo: selected.resumo || '',
    distribuicao: selected.distribuicao || null,
    serieProbabilidades: safeArray(selected.serieProbabilidades || selected.serie || selected.probabilidades).map((p) => ({
      data: p.data || p.date,
      alta: toNumber(p.alta ?? p.up),
      lateral: toNumber(p.lateral ?? p.side),
      baixa: toNumber(p.baixa ?? p.down),
    })).filter((p) => p.data),
    eventos: safeArray(selected.eventos || selected.events).map((e) => ({
      data: e.data || e.date,
      titulo: e.titulo || e.title || '',
      fonte: e.fonte || e.source || '',
      impacto: (e.impacto || e.impact || 'neutro').toLowerCase(),
      url: e.url || e.link || null,
      demo: e.demo === true,
    })),
    ativos: ativos.map((item) => ({
      ticker: String(item.ticker || item.symbol || '').toUpperCase(),
      nome: item.nome || item.name || '',
      setor: item.setor || item.sector || 'Outros',
      segmento: item.segmento || '',
      tendencia: (item.tendencia || item.trend || 'lateral').toLowerCase(),
      score: toNumber(item.score ?? item.scoreTendencia),
      confianca: toNumber(item.confianca ?? item.confidence, 0.5),
      probabilidades: {
        alta: toNumber(item.probabilidades?.alta ?? item.probabilities?.up),
        lateral: toNumber(item.probabilidades?.lateral ?? item.probabilities?.side),
        baixa: toNumber(item.probabilidades?.baixa ?? item.probabilities?.down),
      },
      cenarios: safeArray(item.cenarios || item.scenarios),
      variacaoPeriodo: toNumber(item.variacaoPeriodo ?? item.changePeriod),
      preco: toNumber(item.preco ?? item.price, NaN),
      indicadores: item.indicadores || item.indicators || {},
      suporte: toNumber(item.suporte ?? item.support, NaN),
      resistencia: toNumber(item.resistencia ?? item.resistance, NaN),
      horizonteDias: toNumber(item.horizonteDias ?? item.horizonDays, 21),
      projecao: item.projecao || item.projection || null,
      resumo: item.resumo || item.summary || '',
      sinais: safeArray(item.sinais || item.signals),
      fontes: safeArray(item.fontes || item.sources),
      atualizadoEm: item.atualizadoEm || item.updatedAt || null,
    })).filter((a) => a.ticker),
  };
}

export function normalizeSeries(payload) {
  const points = safeArray(payload?.serie || payload?.series || payload?.data || payload);
  return {
    ticker: String(payload?.ticker || payload?.symbol || '').toUpperCase(),
    fonte: payload?.fonte || 'desconhecida',
    demo: payload?.demo === true || payload?.fonte === 'demo',
    serie: points
      .map((p) => ({
        data: p.data || p.date || p.timestamp,
        fechamento: toNumber(p.fechamento ?? p.close ?? p.price ?? p.valor),
        volume: toNumber(p.volume),
      }))
      .filter((p) => p.data && Number.isFinite(p.fechamento)),
  };
}

export async function loadAssets({ force = false } = {}) {
  const key = 'assets';
  if (!force && cache.has(key)) return cache.get(key);
  const result = await firstAvailable([
    { url: SOURCES.cdn('ativos.json'), source: 'cdn' },
    { url: SOURCES.local('ativos.json'), source: 'demo' },
  ]);
  const data = normalizeAssets(result.data);
  const output = { ...data, _source: result.source, _url: result.url };
  cache.set(key, output);
  return output;
}

export async function loadMarket({ force = false } = {}) {
  const key = 'market';
  if (!force && cache.has(key)) return cache.get(key);
  const result = await firstAvailable([
    { url: SOURCES.cdn('mercado.json'), source: 'cdn' },
    { url: SOURCES.local('mercado.json'), source: 'demo' },
  ]);
  const data = normalizeMarket(result.data);
  const output = { ...data, _source: result.source, _url: result.url };
  cache.set(key, output);
  return output;
}

export async function loadPanorama(period, { force = false } = {}) {
  const key = `panorama:${period}`;
  if (!force && cache.has(key)) return cache.get(key);
  const result = await firstAvailable([
    { url: SOURCES.api(`/v1/panorama?periodo=${encodeURIComponent(period)}`), source: 'api' },
    { url: SOURCES.cdn('panorama.json'), source: 'cdn' },
    { url: SOURCES.local('panorama.json'), source: 'demo' },
  ]);
  const data = normalizePanorama(result.data, period);
  if (!data) throw new Error('Panorama vazio.');
  const output = { ...data, _source: result.source, _url: result.url };
  cache.set(key, output);
  return output;
}

export async function loadSeries(ticker, { force = false } = {}) {
  const key = `series:${ticker}`;
  if (!force && cache.has(key)) return cache.get(key);
  const result = await firstAvailable([
    { url: SOURCES.api(`/v1/ativos/${encodeURIComponent(ticker)}/serie?periodo=5a`), source: 'api' },
    { url: SOURCES.cdn(`series/${encodeURIComponent(ticker)}.json`), source: 'cdn' },
    { url: SOURCES.local(`series/${encodeURIComponent(ticker)}.json`), source: 'demo' },
  ]);
  const data = normalizeSeries(result.data);
  const output = { ...data, ticker: data.ticker || ticker, _source: result.source, _url: result.url };
  cache.set(key, output);
  return output;
}

export function clearCache() {
  cache.clear();
}

export function sourceLabel(source) {
  return { api: 'API', cdn: 'CDN', demo: 'demo local' }[source] || source || '—';
}
