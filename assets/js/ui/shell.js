/* Estrutura persistente do aplicativo: barra lateral, topo e menu do usuário. */

import { el, bytes, fmtDateTime } from '../core/util.js';
import { currentUser, logout } from '../core/auth.js';
import { databaseSize, lastPersistedAt } from '../core/db.js';
import { icon } from './icons.js';
import { avatar, toast } from './components.js';
import { navigate, pathOnly } from './router.js';

const NAV = [
  { group: 'Trabalho', items: [
    { path: '/painel', label: 'Painel', icon: 'grid' },
    { path: '/projetos', label: 'Projetos', icon: 'folder' },
    { path: '/ideias', label: 'Ideias', icon: 'bulb' },
    { path: '/tarefas', label: 'Tarefas', icon: 'checkSquare' },
  ] },
  { group: 'Governança', items: [
    { path: '/equipe', label: 'Equipe', icon: 'users' },
    { path: '/auditoria', label: 'Auditoria', icon: 'activity' },
    { path: '/lgpd', label: 'LGPD', icon: 'scale' },
  ] },
  { group: 'Sistema', items: [
    { path: '/configuracoes', label: 'Configurações', icon: 'settings' },
  ] },
];

let refs = {};

export function mountShell(root) {
  const user = currentUser();
  const sidebar = el('aside', { class: 'sidebar', id: 'sidebar' },
    el('a', { class: 'brand', href: '#/painel', 'aria-label': 'Projetos Dinâmicos' },
      el('span', { class: 'brand-mark' }, icon('sparkles', 20)),
      el('span', { class: 'brand-text' },
        el('strong', {}, 'Projetos ', el('em', {}, 'Dinâmicos')),
        el('small', { text: 'ideias colaborativas' }))),
    el('nav', { class: 'nav', 'aria-label': 'Navegação principal' },
      NAV.map((section) => el('div', { class: 'nav-group' },
        el('div', { class: 'nav-group-label', text: section.group }),
        section.items.map((item) => el('a', {
          class: 'nav-item', href: `#${item.path}`, dataset: { path: item.path },
        }, icon(item.icon, 18), el('span', { text: item.label })))))),
    el('div', { class: 'sidebar-foot' },
      el('div', { class: 'local-badge' },
        el('span', { class: 'dot' }),
        el('div', {},
          el('strong', { text: 'SQLite local' }),
          el('small', { text: 'sem servidor · sem cookies' }))),
      el('div', { class: 'storage-line', id: 'storageLine', text: '—' }),
      el('div', { class: 'storage-line muted', id: 'persistLine', text: '—' })));

  const backdrop = el('div', { class: 'sidebar-backdrop', id: 'sidebarBackdrop' });
  const titleSlot = el('div', { class: 'topbar-title', id: 'topbarTitle', text: 'Painel' });
  const userMenu = el('div', { class: 'user-menu hidden', id: 'userMenu' },
    el('div', { class: 'user-menu-head' },
      avatar(user.display_name, 38),
      el('div', {},
        el('strong', { text: user.display_name }),
        el('small', { text: user.email }))),
    el('a', { class: 'menu-item', href: '#/configuracoes' }, icon('settings', 16), 'Configurações'),
    el('a', { class: 'menu-item', href: '#/lgpd' }, icon('shield', 16), 'Privacidade e LGPD'),
    el('button', {
      class: 'menu-item danger', type: 'button',
      onclick: async () => {
        await logout('manual');
        toast('Sessão encerrada.', 'ok');
        location.hash = '#/painel';
        location.reload();
      },
    }, icon('logout', 16), 'Sair'));

  const topbar = el('header', { class: 'topbar' },
    el('button', {
      class: 'icon-btn mobile-only', type: 'button', 'aria-label': 'Abrir menu',
      onclick: () => toggleSidebar(true),
    }, icon('menu', 20)),
    titleSlot,
    el('div', { class: 'topbar-actions' },
      el('span', { class: 'local-chip', title: 'Os dados ficam neste navegador' },
        el('span', { class: 'dot' }), 'Local-first'),
      el('button', {
        class: 'btn primary sm', type: 'button',
        onclick: () => navigate('/projetos?novo=1'),
      }, icon('plus', 15), el('span', { class: 'hide-sm', text: 'Novo projeto' })),
      el('button', {
        class: 'user-chip', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false',
        onclick: (event) => { event.stopPropagation(); userMenu.classList.toggle('hidden'); },
      }, avatar(user.display_name, 30), icon('chevronDown', 14))));

  const view = el('main', { class: 'content', id: 'view', tabindex: '-1' });
  const app = el('div', { class: 'app' }, backdrop, sidebar,
    el('div', { class: 'main' }, topbar, view, userMenu));

  root.replaceChildren(app);
  refs = { app, sidebar, backdrop, view, titleSlot, userMenu };

  backdrop.addEventListener('click', () => toggleSidebar(false));
  document.addEventListener('click', (event) => {
    if (!userMenu.contains(event.target) && !event.target.closest('.user-chip')) {
      userMenu.classList.add('hidden');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') toggleSidebar(false);
  });
  window.addEventListener('hashchange', () => {
    updateActive();
    toggleSidebar(false);
  });

  updateActive();
  updateStorage();
  globalThis.addEventListener('pd:persisted', updateStorage);
  setInterval(updateStorage, 15_000);

  return {
    view,
    setTitle: (text) => { titleSlot.textContent = text || 'Painel'; },
    refreshUser: () => {
      const updated = currentUser();
      if (updated) {
        userMenu.querySelector('.user-menu-head strong').textContent = updated.display_name;
        userMenu.querySelector('.user-menu-head small').textContent = updated.email;
      }
    },
  };
}

export function toggleSidebar(open) {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar) return;
  const shouldOpen = open ?? !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', shouldOpen);
  backdrop?.classList.toggle('show', shouldOpen);
  document.body.classList.toggle('no-scroll', shouldOpen);
}

export function updateActive() {
  const path = pathOnly();
  document.querySelectorAll('.nav-item').forEach((item) => {
    const target = item.dataset.path;
    const active = path === target || path.startsWith(`${target}/`);
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
}

export function setTitleFromView(node) {
  const titleNode = node?.querySelector?.('[data-title]');
  const title = titleNode?.dataset.title || 'Painel';
  refs.titleSlot.textContent = title;
  document.title = `${title} · Projetos Dinâmicos`;
}

function updateStorage() {
  const storage = document.getElementById('storageLine');
  const persist = document.getElementById('persistLine');
  if (!storage) return;
  try {
    storage.textContent = `Banco local: ${bytes(databaseSize())}`;
    const at = lastPersistedAt();
    persist.textContent = at ? `Salvo ${fmtDateTime(at)}` : 'Salvando automaticamente';
  } catch {
    storage.textContent = 'Banco local indisponível';
  }
}

export function refreshShellUser() {
  refs.app?.dispatchEvent(new CustomEvent('shell:refresh'));
}
