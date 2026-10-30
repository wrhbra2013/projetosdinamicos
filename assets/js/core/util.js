/* ============================================================================
   Utilidades gerais — DOM, datas, formatação e arquivos.
   Nenhuma dependência externa.
   ========================================================================== */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Cria elementos de forma segura. Conteúdo de usuário deve ir em `text`.
 * el('div', { class: 'card' }, el('h2', { text: titulo }))
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = value; // apenas com conteúdo confiável
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value') node.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'required') {
      node[key] = Boolean(value);
    } else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const nowISO = () => new Date().toISOString();

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function fmtDate(iso, { withTime = false, short = false } = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = short
    ? { day: '2-digit', month: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' };
  if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  return new Intl.DateTimeFormat('pt-BR', opts).format(d).replace('.', '');
}

export function fmtDateTime(iso) {
  return fmtDate(iso, { withTime: true });
}

export function relTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  if (abs < 60_000) return 'agora';
  if (abs < 3_600_000) return rtf.format(Math.round(-diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(-diff / 3_600_000), 'hour');
  if (abs < 2_592_000_000) return rtf.format(Math.round(-diff / 86_400_000), 'day');
  return fmtDate(iso);
}

export function daysBetween(a, b = new Date()) {
  return Math.ceil((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
}

export function dateInputValue(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || '?';
}

export function hashHue(text = '') {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

export function truncate(text, max = 140) {
  const s = String(text || '').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'projeto';
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(value || '').trim());
}

export function parseTags(value) {
  if (Array.isArray(value)) return value;
  try { const arr = JSON.parse(value || '[]'); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}

export function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function debounce(fn, ms = 250) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => { clearTimeout(timer); fn(...args); };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function download(filename, content, type = 'application/json;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function readFile(file, as = 'text') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    if (as === 'buffer') reader.readAsArrayBuffer(file);
    else reader.readAsText(file, 'utf-8');
  });
}

export function bytes(n) {
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(
    typeof c.value === 'function' ? c.value(row) : row[c.key],
  )).join(',')).join('\n');
  return `\uFEFF${head}\n${body}`;
}

export function passwordStrength(password = '') {
  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const labels = ['muito fraca', 'fraca', 'razoável', 'boa', 'forte', 'muito forte'];
  return { score, label: labels[Math.min(score, 5)], ok: password.length >= 10 && score >= 3 };
}

export function sortBy(list, key, dir = 'asc') {
  return [...list].sort((a, b) => {
    const av = typeof key === 'function' ? key(a) : a[key];
    const bv = typeof key === 'function' ? key(b) : b[key];
    if (av === bv) return 0;
    return (av > bv ? 1 : -1) * (dir === 'asc' ? 1 : -1);
  });
}

export function groupBy(list, key) {
  return list.reduce((acc, item) => {
    const k = typeof key === 'function' ? key(item) : item[key];
    (acc[k] ||= []).push(item);
    return acc;
  }, {});
}

export function confirmDialog(message) {
  return window.confirm(message);
}

export function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    if (label) button.textContent = label;
  } else {
    button.disabled = false;
    if (button.dataset.label) button.textContent = button.dataset.label;
  }
}
