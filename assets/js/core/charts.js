/* OpenFinancial — graficos SVG sem dependencias externas.
   Pensados para CSP "script-src 'self'" e para funcionar em qualquer navegador
   moderno, inclusive em conexoes lentas. */

import { dateShort, num, toDate } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 820;

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  return node;
}

function reset(svg, height = 320) {
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${W} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
}

function extent(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return [0, 1];
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return [min, max];
}

function tickIndices(length, count = 6) {
  if (length <= 1) return [0];
  const step = (length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(i * step)).filter(
    (v, i, arr) => arr.indexOf(v) === i
  );
}

function linePath(points, x, y) {
  return points
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
    .join(' ');
}

function areaPath(points, x, y, baseY) {
  if (!points.length) return '';
  return `${linePath(points, x, y)} L${x(points.length - 1).toFixed(1)},${baseY.toFixed(1)} L${x(0).toFixed(1)},${baseY.toFixed(1)} Z`;
}

function grid(svg, { left, right, top, bottom, yTicks, y, format }) {
  const group = el('g', { class: 'chart-grid' });
  for (const value of yTicks) {
    const yy = y(value);
    group.append(
      el('line', {
        x1: left, y1: yy, x2: right, y2: yy,
        stroke: 'rgba(22,36,30,.10)', 'stroke-width': 1,
      })
    );
    const label = el('text', {
      x: left - 8, y: yy + 4, 'text-anchor': 'end',
      fill: '#77827b', 'font-size': 11,
    });
    label.textContent = format(value);
    group.append(label);
  }
  svg.append(group);
}

function xLabels(svg, { points, left, right, bottom, x, key = 'data' }) {
  const group = el('g', { class: 'chart-x' });
  for (const index of tickIndices(points.length, 6)) {
    const point = points[index];
    if (!point) continue;
    const label = el('text', {
      x: x(index), y: bottom + 18, 'text-anchor': 'middle',
      fill: '#77827b', 'font-size': 11,
    });
    label.textContent = dateShort(point[key]);
    group.append(label);
  }
  svg.append(group);
}

function yTicksFor(min, max, count = 5) {
  const span = max - min;
  return Array.from({ length: count }, (_, i) => min + (span * i) / (count - 1));
}

function formatPrice(value) {
  if (Math.abs(value) >= 100000) return `${num(value / 1000, 0, 0)}k`;
  const digits = Math.abs(value) < 10 ? 2 : Math.abs(value) < 1000 ? 1 : 0;
  return num(value, digits, digits);
}

export function renderPriceChart(svg, { history, projection = null, overlays = [], height = 340 }) {
  reset(svg, height);
  const margin = { left: 54, right: 16, top: 18, bottom: 34 };
  const left = margin.left;
  const right = W - margin.right;
  const top = margin.top;
  const bottom = height - margin.bottom;

  const hist = (history || []).filter((p) => Number.isFinite(p.fechamento));
  if (!hist.length) {
    const text = el('text', { x: W / 2, y: height / 2, 'text-anchor': 'middle', fill: '#77827b', 'font-size': 14 });
    text.textContent = 'Sem serie historica para o periodo.';
    svg.append(text);
    return;
  }

  const projDates = projection?.datas || [];
  const allDates = [...hist.map((p) => p.data), ...projDates];
  const total = allDates.length;
  const x = (index) => left + ((right - left) * index) / Math.max(1, total - 1);
  const histEnd = hist.length - 1;

  const values = [
    ...hist.map((p) => p.fechamento),
    ...(projection?.p10 || []),
    ...(projection?.p90 || []),
  ];
  const [min, max] = extent(values);
  const pad = (max - min) * 0.06 || 1;
  const y = (value) => bottom - ((value - (min - pad)) / (max + pad - (min - pad))) * (bottom - top);

  const yTicks = yTicksFor(min - pad, max + pad, 5);
  grid(svg, { left, right, top, bottom, yTicks, y, format: formatPrice });

  // Banda 10-90 e 25-75 da projecao.
  if (projection?.p10?.length && projection?.p90?.length) {
    const start = histEnd;
    const band = (lower, upper, fill, opacity) => {
      if (!lower?.length || !upper?.length) return;
      const upperPath = upper.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(start + i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      const lowerPath = lower.slice().reverse().map((v, i) => {
        const idx = start + (lower.length - i);
        return `L${x(idx).toFixed(1)},${y(v).toFixed(1)}`;
      }).join(' ');
      svg.append(el('path', { d: `${upperPath} ${lowerPath} Z`, fill, opacity }));
    };
    band(projection.p10, projection.p90, '#2f7a64', 0.11);
    band(projection.p25, projection.p75, '#2f7a64', 0.16);
  }

  // Area e linha historica.
  const histValues = hist.map((p) => p.fechamento);
  const gradientId = `of-grad-${Math.random().toString(36).slice(2, 8)}`;
  const defs = el('defs');
  const gradient = el('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' });
  gradient.append(el('stop', { offset: '0%', 'stop-color': '#2f7a64', 'stop-opacity': '0.22' }));
  gradient.append(el('stop', { offset: '100%', 'stop-color': '#2f7a64', 'stop-opacity': '0' }));
  defs.append(gradient);
  svg.append(defs);

  svg.append(
    el('path', {
      d: areaPath(histValues, x, y, bottom),
      fill: `url(#${gradientId})`,
    })
  );
  svg.append(
    el('path', {
      d: linePath(histValues, x, y),
      fill: 'none', stroke: '#1d5a4a', 'stroke-width': 2.2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke',
    })
  );

  // Medias moveis.
  for (const overlay of overlays) {
    const values = overlay.values || [];
    if (values.length < 2) continue;
    const offset = Math.max(0, hist.length - values.length);
    const path = values
      .map((value, i) => `${i === 0 ? 'M' : 'L'}${x(offset + i).toFixed(1)},${y(value).toFixed(1)}`)
      .join(' ');
    svg.append(
      el('path', {
        d: path, fill: 'none', stroke: overlay.color || '#c19a4a',
        'stroke-width': 1.4, 'stroke-dasharray': overlay.dash || '4 4',
        opacity: 0.85, 'vector-effect': 'non-scaling-stroke',
      })
    );
  }

  // Linha central da projecao.
  if (projection?.p50?.length) {
    const path = projection.p50
      .map((value, i) => `${i === 0 ? 'M' : 'L'}${x(histEnd + i + 1).toFixed(1)},${y(value).toFixed(1)}`)
      .join(' ');
    svg.append(
      el('path', {
        d: path, fill: 'none', stroke: '#2f7a64', 'stroke-width': 1.8,
        'stroke-dasharray': '6 5', 'vector-effect': 'non-scaling-stroke',
      })
    );
    const last = projection.p50[projection.p50.length - 1];
    const cx = x(total - 1);
    const cy = y(last);
    svg.append(el('circle', { cx, cy, r: 4, fill: '#2f7a64' }));
  }

  // Ultimo preco historico.
  const lastValue = histValues[histValues.length - 1];
  svg.append(el('circle', { cx: x(histEnd), cy: y(lastValue), r: 3.2, fill: '#0b2a23' }));

  xLabels(svg, { points: allDates.map((data) => ({ data })), left, right, bottom, x });

  // Divisor entre historico e projecao.
  if (projection?.datas?.length) {
    svg.append(
      el('line', {
        x1: x(histEnd), y1: top, x2: x(histEnd), y2: bottom,
        stroke: 'rgba(22,36,30,.18)', 'stroke-width': 1, 'stroke-dasharray': '3 4',
      })
    );
    const label = el('text', {
      x: x(histEnd) + 6, y: top + 12, fill: '#77827b', 'font-size': 10,
    });
    label.textContent = 'projecao';
    svg.append(label);
  }
}

export function renderStackedProbability(svg, { points, height = 300 }) {
  reset(svg, height);
  const margin = { left: 44, right: 16, top: 16, bottom: 34 };
  const left = margin.left;
  const right = W - margin.right;
  const top = margin.top;
  const bottom = height - margin.bottom;
  const data = (points || []).filter((p) => p.data);

  if (data.length < 2) {
    const text = el('text', { x: W / 2, y: height / 2, 'text-anchor': 'middle', fill: '#77827b', 'font-size': 14 });
    text.textContent = 'Sem serie de probabilidades para o periodo.';
    svg.append(text);
    return;
  }

  const x = (index) => left + ((right - left) * index) / (data.length - 1);
  const y = (value) => bottom - (bottom - top) * value;

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  grid(svg, {
    left, right, top, bottom, yTicks, y,
    format: (value) => `${Math.round(value * 100)}%`,
  });

  const series = [
    { key: 'alta', color: '#2f7a64' },
    { key: 'lateral', color: '#c19a4a' },
    { key: 'baixa', color: '#b05a4a' },
  ];

  let base = data.map(() => 0);
  for (const item of series) {
    const upper = data.map((p, i) => base[i] + Number(p[item.key] || 0));
    const topPath = upper
      .map((value, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(value).toFixed(1)}`)
      .join(' ');
    const lowerPath = base
      .slice()
      .reverse()
      .map((value, i) => `L${x(base.length - 1 - i).toFixed(1)},${y(value).toFixed(1)}`)
      .join(' ');
    svg.append(
      el('path', {
        d: `${topPath} ${lowerPath} Z`,
        fill: item.color,
        opacity: 0.82,
      })
    );
    base = upper;
  }

  xLabels(svg, { points: data, left, right, bottom, x });
}

export function renderSparkline(svg, values, { color = '#2f7a64', height = 38, width = 132 } = {}) {
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const data = (values || []).filter((v) => Number.isFinite(v));
  if (data.length < 2) return;
  const [min, max] = extent(data);
  const pad = (max - min) * 0.12 || 1;
  const x = (i) => (width * i) / (data.length - 1);
  const y = (v) => height - ((v - (min - pad)) / (max + pad - (min - pad))) * height;
  svg.append(
    el('path', {
      d: areaPath(data, x, y, height),
      fill: color,
      opacity: 0.12,
    })
  );
  svg.append(
    el('path', {
      d: linePath(data, x, y),
      fill: 'none',
      stroke: color,
      'stroke-width': 1.6,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke',
    })
  );
}

export function renderMiniBars(svg, items, { height = 34, width = 132 } = {}) {
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const data = items || [];
  if (!data.length) return;
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const gap = 3;
  const barWidth = (width - gap * (data.length - 1)) / data.length;
  data.forEach((item, index) => {
    const h = (Math.abs(item.value) / max) * (height - 4);
    const x = index * (barWidth + gap);
    svg.append(
      el('rect', {
        x,
        y: height - h,
        width: barWidth,
        height: h,
        rx: 2,
        fill: item.color || '#2f7a64',
        opacity: 0.8,
      })
    );
  });
}

export function movingAverage(values, windowSize) {
  const output = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i < windowSize - 1) continue;
    const slice = values.slice(i - windowSize + 1, i + 1);
    output.push(slice.reduce((sum, v) => sum + v, 0) / windowSize);
  }
  return output;
}

export function sliceSeries(serie, period) {
  const map = { '1m': 21, '3m': 63, '6m': 126, '1a': 252, '5a': 1260 };
  const size = map[period] || 126;
  return (serie || []).slice(-size);
}

export function dateRangeLabel(serie) {
  if (!serie?.length) return '';
  const start = toDate(serie[0].data);
  const end = toDate(serie[serie.length - 1].data);
  if (!start || !end) return '';
  return `${dateShort(start)} — ${dateShort(end)}`;
}
