/* Componentes de interface reutilizáveis. */

import { el, initials, hashHue, truncate, setBusy } from '../core/util.js';
import { icon } from './icons.js';

/* --------------------------------- Toasts -------------------------------- */
let toastHost = null;

export function toast(message, tone = 'ok', ms = 4200) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host', id: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const item = el('div', { class: `toast ${tone}` },
    icon(tone === 'danger' ? 'alert' : tone === 'warn' ? 'alert' : 'check', 16),
    el('span', { text: message }));
  toastHost.append(item);
  requestAnimationFrame(() => item.classList.add('show'));
  setTimeout(() => {
    item.classList.remove('show');
    setTimeout(() => item.remove(), 250);
  }, ms);
  return item;
}

/* --------------------------------- Modal --------------------------------- */
export function modal({ title, subtitle = '', body, actions = [], size = '', onClose = null }) {
  const host = el('div', { class: 'modal-host', role: 'dialog', 'aria-modal': 'true' });
  const close = () => {
    host.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const footer = actions.length
    ? el('div', { class: 'modal-actions' }, actions.map((action) => el('button', {
      class: `btn ${action.class || ''}`,
      type: 'button',
      onclick: async (event) => {
        if (action.onClick) {
          const button = event.currentTarget;
          setBusy(button, true, action.busyLabel || 'Aguarde…');
          try { await action.onClick(close, button); } finally { setBusy(button, false); }
        } else {
          close();
        }
      },
    }, action.icon ? icon(action.icon, 15) : null, action.label)))
    : null;

  const panel = el('div', { class: `modal ${size}` },
    el('div', { class: 'modal-head' },
      el('div', {},
        el('h2', { text: title }),
        subtitle ? el('p', { class: 'modal-sub', text: subtitle }) : null),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: close }, icon('x', 18))),
    el('div', { class: 'modal-body' }, body),
    footer);

  host.append(panel);
  host.addEventListener('click', (event) => { if (event.target === host) close(); });
  document.body.append(host);
  setTimeout(() => panel.querySelector('input, select, textarea, button')?.focus(), 40);
  return { host, panel, body: panel.querySelector('.modal-body'), close };
}

export function confirmDialog({
  title = 'Confirmar ação',
  message = '',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const dialog = modal({
      title,
      body: el('p', { class: 'confirm-text', text: message }),
      actions: [
        { label: cancelLabel, class: 'ghost', onClick: (close) => { answered = true; close(); resolve(false); } },
        {
          label: confirmLabel,
          class: danger ? 'danger-solid' : 'primary',
          onClick: (close) => { answered = true; close(); resolve(true); },
        },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
    return dialog;
  });
}

/* -------------------------------- Átomos --------------------------------- */
export function badge(text, tone = 'neutral') {
  return el('span', { class: `badge ${tone}`, text });
}

export function statusBadge(map, value) {
  const tone = {
    ativo: 'ok', concluido: 'ok', aprovada: 'ok', publico: 'info',
    em_analise: 'warn', em_discussao: 'warn', fazendo: 'info', revisao: 'warn',
    pausado: 'warn', nova: 'info', rascunho: 'neutral', privado: 'neutral',
    arquivado: 'neutral', interna: 'neutral', interno: 'info', critica: 'danger',
    alta: 'warn', media: 'info', baixa: 'neutral', aberto: 'danger',
    recebida: 'warn', em_analise_dsr: 'warn', recusada: 'danger', contido: 'warn',
    notificado: 'info', encerrado: 'ok',
  }[value] || 'neutral';
  return badge(map[value] || value, tone);
}

export function avatar(name = '', size = 32) {
  return el('span', {
    class: 'avatar',
    text: initials(name),
    title: name,
    style: {
      width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px`,
      '--h': String(hashHue(name)),
    },
  });
}

export function pageHead({ eyebrow = '', title, subtitle = '', actions = null }) {
  return el('header', { class: 'page-head', 'data-title': title },
    el('div', { class: 'page-head-main' },
      eyebrow ? el('div', { class: 'eyebrow', text: eyebrow }) : null,
      el('h1', { text: title }),
      subtitle ? el('p', { class: 'page-sub', text: subtitle }) : null),
    actions ? el('div', { class: 'page-head-actions' }, actions) : null);
}

export function emptyState({ iconName = 'sparkles', title, text = '', action = null }) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty-icon' }, icon(iconName, 26)),
    el('h3', { text: title }),
    text ? el('p', { text }) : null,
    action);
}

export function statCard({ label, value, hint = '', iconName = 'activity', tone = '', href = null }) {
  const content = el('div', { class: `stat ${tone}` },
    el('div', { class: 'stat-icon' }, icon(iconName, 18)),
    el('div', { class: 'stat-value', text: String(value) }),
    el('div', { class: 'stat-label', text: label }),
    hint ? el('div', { class: 'stat-hint', text: hint }) : null);
  if (!href) return content;
  return el('a', { class: 'stat-link', href }, content);
}

export function progress(value, total, { showLabel = false, tone = '' } = {}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return el('div', { class: `progress-wrap ${tone}` },
    el('div', { class: 'progress' }, el('div', { class: 'progress-bar', style: { width: `${pct}%` } })),
    showLabel ? el('span', { class: 'progress-label', text: `${value}/${total}` }) : null);
}

export function chip(text, { active = false, onClick = null, iconName = null } = {}) {
  return el(onClick ? 'button' : 'span', {
    class: `chip ${active ? 'active' : ''}`,
    type: onClick ? 'button' : null,
    onclick: onClick,
  }, iconName ? icon(iconName, 13) : null, text);
}

export function tabs(items, active, onSelect) {
  return el('div', { class: 'tabs', role: 'tablist' },
    items.map((item) => el('button', {
      class: `tab ${item.id === active ? 'active' : ''}`,
      type: 'button',
      role: 'tab',
      'aria-selected': item.id === active ? 'true' : 'false',
      onclick: () => onSelect(item.id),
    },
    item.label,
    item.count !== undefined ? el('span', { class: 'tab-count', text: String(item.count) }) : null)));
}

/* -------------------------------- Formulário ------------------------------ */
export function field(label, control, hint = '') {
  return el('div', { class: 'field' },
    el('span', { class: 'field-label', text: label }),
    control,
    hint ? el('span', { class: 'field-hint', text: hint }) : null);
}

export function inputEl(props = {}) {
  return el('input', { class: 'input', ...props });
}

export function selectEl(options, value, props = {}) {
  const select = el('select', { class: 'input', ...props },
    options.map((opt) => el('option', {
      value: opt.value,
      selected: String(opt.value) === String(value ?? ''),
      text: opt.label,
    })));
  return select;
}

export function textareaEl(props = {}) {
  return el('textarea', { class: 'input', rows: 4, ...props });
}

export function checkbox(label, checked, props = {}) {
  return el('label', { class: 'check' },
    el('input', { type: 'checkbox', checked, ...props }),
    el('span', { text: label }));
}

/* ------------------------------- Utilitários ------------------------------ */
export function loading(text = 'Carregando…') {
  return el('div', { class: 'loading' }, el('span', { class: 'spinner' }), el('span', { text }));
}

export function truncated(text, max = 120) {
  return el('span', { title: text, text: truncate(text, max) });
}

export function jsonBlock(value) {
  return el('pre', { class: 'json-block', text: JSON.stringify(value, null, 2) });
}

export function sectionTitle(title, action = null) {
  return el('div', { class: 'section-title' }, el('h2', { text: title }), action);
}

export function scoreRing(score, size = 96) {
  const color = score >= 80 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--danger)';
  return el('div', {
    class: 'score-ring',
    style: {
      width: `${size}px`, height: `${size}px`,
      background: `conic-gradient(${color} ${score * 3.6}deg, var(--panel-2) 0deg)`,
    },
  }, el('div', { class: 'score-inner' },
    el('strong', { text: `${score}%` }),
    el('small', { text: 'conformidade' })));
}

export function kv(label, value) {
  return el('div', { class: 'kv' }, el('span', { text: label }), el('strong', { text: value ?? '—' }));
}
