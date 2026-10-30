/* Roteador por hash — simples, previsível e compatível com páginas estáticas. */

import { el } from '../core/util.js';
import { emptyState, pageHead, toast } from './components.js';
import { icon } from './icons.js';

const routes = [];
let renderer = () => {};
let started = false;

export function register(pattern, handler) {
  const parts = pattern.split('/').filter(Boolean);
  routes.push({ pattern, parts, handler });
}

export function setRenderer(fn) {
  renderer = fn;
}

export function currentPath() {
  const raw = location.hash.replace(/^#/, '');
  return raw || '/painel';
}

export function pathOnly() {
  return currentPath().split('?')[0];
}

export function query() {
  const [, qs = ''] = currentPath().split('?');
  return new URLSearchParams(qs);
}

export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (location.hash === target) { refresh(); return; }
  if (replace) {
    history.replaceState(null, '', target);
    dispatch();
  } else {
    location.hash = target;
  }
}

export function refresh() {
  dispatch();
}

function match(path) {
  const clean = path.split('?')[0];
  const parts = clean.split('/').filter(Boolean);
  for (const route of routes) {
    if (route.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < route.parts.length; i++) {
      const p = route.parts[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]);
      else if (p !== parts[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

export async function dispatch() {
  const path = pathOnly();
  const found = match(path);
  if (!found) {
    renderer(el('div', {}, pageHead({ title: 'Página não encontrada' }),
      emptyState({
        iconName: 'search',
        title: 'Este caminho não existe',
        text: `Não encontramos "${path}".`,
        action: el('a', { class: 'btn primary', href: '#/painel' }, 'Voltar ao painel'),
      })));
    return;
  }
  try {
    const node = await found.route.handler(found.params, { path, query: query() });
    if (node) renderer(node);
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao carregar a página.', 'danger');
    renderer(el('div', {},
      pageHead({ title: 'Algo deu errado' }),
      emptyState({
        iconName: 'alert',
        title: 'Não foi possível carregar esta página',
        text: err.message || String(err),
        action: el('button', {
          class: 'btn primary', type: 'button',
          onclick: () => { location.reload(); },
        }, icon('refresh', 15), 'Recarregar'),
      })));
  }
}

export function start() {
  if (!started) {
    window.addEventListener('hashchange', dispatch);
    started = true;
  }
  dispatch();
}

export function routeHref(path) {
  return `#${path}`;
}
