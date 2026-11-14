/* OpenFinancial — formatacao e utilidades compartilhadas. */

const nf = (min = 2, max = 2) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const dateLongFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export const num = (value, min = 2, max = 2) =>
  Number.isFinite(Number(value)) ? nf(min, max).format(Number(value)) : '—';

export const money = (value) =>
  Number.isFinite(Number(value))
    ? `R$ ${nf(2, 2).format(Number(value))}`
    : '—';

export const pct = (value, digits = 2, signed = true) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const text = `${nf(digits, digits).format(Math.abs(n))}%`;
  if (!signed) return text;
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${text}`;
};

export const probPct = (value) => `${Math.round(Number(value || 0) * 100)}%`;

export const compactNumber = (value) =>
  Number.isFinite(Number(value)) ? compact.format(Number(value)) : '—';

export const dateShort = (value) => {
  const d = toDate(value);
  return d ? dateFmt.format(d) : '—';
};

export const dateLong = (value) => {
  const d = toDate(value);
  return d ? dateLongFmt.format(d) : '—';
};

export const dateTime = (value) => {
  const d = toDate(value);
  return d ? dateTimeFmt.format(d) : '—';
};

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(String(value).length <= 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const TREND = {
  alta: { label: 'Alta', className: 'trend-alta', color: '#2f7a64' },
  lateral: { label: 'Lateral', className: 'trend-lateral', color: '#c19a4a' },
  baixa: { label: 'Baixa', className: 'trend-baixa', color: '#b05a4a' },
};

export const trendLabel = (trend) => TREND[trend]?.label || 'Neutro';
export const trendClass = (trend) => TREND[trend]?.className || 'trend-lateral';
export const trendColor = (trend) => TREND[trend]?.color || '#8a7a5a';

export const variationClass = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
};

export function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.itens)) return value.itens;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.ativos)) return value.ativos;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

export function debounce(fn, delay = 180) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
