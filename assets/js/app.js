/* ============================================================================
   Bootstrap da aplicação — inicializa o SQLite, restaura a sessão e monta a
   interface. Nenhum dado sai do navegador sem ação explícita do usuário.
   ========================================================================== */

import DB from './core/db.js';
import { restoreSession, currentUser, logout } from './core/auth.js';
import { mountShell, setTitleFromView } from './ui/shell.js';
import { register, setRenderer, start, navigate } from './ui/router.js';
import { renderAuth } from './ui/views/auth.js';
import { dashboardView } from './ui/views/dashboard.js';
import { projectsView } from './ui/views/projects.js';
import { projectView } from './ui/views/project.js';
import { ideasView } from './ui/views/ideas.js';
import { tasksView } from './ui/views/tasks.js';
import { teamView } from './ui/views/team.js';
import { auditView } from './ui/views/audit.js';
import { lgpdView } from './ui/views/lgpd.js';
import { settingsView } from './ui/views/settings.js';
import { toast } from './ui/components.js';
import { icon } from './ui/icons.js';
import { el } from './core/util.js';

const root = document.getElementById('app');
const IDLE_LIMIT_MS = 30 * 60 * 1000;
let shell = null;
let idleTimer = null;

/* --------------------------------- Rotas ---------------------------------- */
register('/painel', dashboardView);
register('/projetos', projectsView);
register('/projeto/:id', projectView);
register('/projeto/:id/:tab', projectView);
register('/ideias', ideasView);
register('/tarefas', tasksView);
register('/equipe', teamView);
register('/auditoria', auditView);
register('/lgpd', lgpdView);
register('/configuracoes', settingsView);

/* ------------------------------- Renderização ----------------------------- */
function renderIntoShell(node) {
  shell.view.replaceChildren(node);
  setTitleFromView(node);
  shell.view.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function bootShell() {
  shell = mountShell(root);
  setRenderer(renderIntoShell);
  start();
  if (!location.hash) navigate('/painel', { replace: true });
  setupIdleWatcher();
}

/* ------------------------------ Tela de entrada --------------------------- */
function bootAuth() {
  const screen = renderAuth({
    onSuccess: () => {
      location.hash = '#/painel';
      location.reload();
    },
  });
  root.replaceChildren(screen);
  document.title = 'Entrar · Projetos Dinâmicos';
}

/* --------------------------- Bloqueio por inatividade --------------------- */
function setupIdleWatcher() {
  const reset = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
      if (!currentUser()) return;
      await logout('inatividade');
      toast('Sessão encerrada por inatividade.', 'warn');
      setTimeout(() => location.reload(), 900);
    }, IDLE_LIMIT_MS);
  };
  ['click', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach((eventName) => {
    document.addEventListener(eventName, reset, { passive: true });
  });
  reset();
}

/* -------------------------------- Erros globais --------------------------- */
function fatal(message, detail = '') {
  root.replaceChildren(el('div', { class: 'fatal' },
    el('div', { class: 'fatal-card' },
      el('div', { class: 'fatal-icon' }, icon('alert', 30)),
      el('h1', { text: message }),
      detail ? el('p', { text: detail }) : null,
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, 'Recarregar'),
        el('a', { class: 'btn ghost', href: 'index.html' }, 'Voltar ao site')),
      el('p', { class: 'muted small', text: 'Se o problema persistir, verifique se a página está sendo servida por HTTP (não file://) e se vendor/sql.js está presente.' }))));
}

window.addEventListener('error', (event) => {
  console.error(event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
  const message = event.reason?.message || String(event.reason || '');
  if (/WebCrypto|sql\.js|esquema|IndexedDB/i.test(message)) {
    toast(message, 'danger', 7000);
  }
});

/* ------------------------------- Inicialização ---------------------------- */
async function main() {
  root.replaceChildren(el('div', { class: 'boot' },
    el('div', { class: 'boot-mark' }, icon('sparkles', 30)),
    el('h1', {}, 'Projetos ', el('em', {}, 'Dinâmicos')),
    el('div', { class: 'boot-bar' }, el('span', {})),
    el('p', { class: 'muted small', text: 'Abrindo o banco local seguro…' })));

  try {
    await DB.init();
  } catch (error) {
    console.error(error);
    fatal('Não foi possível abrir o banco local', error.message || String(error));
    return;
  }

  try {
    const user = await restoreSession();
    if (user) bootShell();
    else bootAuth();
  } catch (error) {
    console.error(error);
    fatal('Falha ao restaurar a sessão', error.message || String(error));
  }

  /* Outra aba alterou o banco: oferece recarregar para refletir. */
  globalThis.addEventListener('pd:external-change', () => {
    const bar = el('div', { class: 'external-change' },
      icon('refresh', 15),
      el('span', { text: 'Os dados foram atualizados em outra aba.' }),
      el('button', {
        class: 'btn sm', type: 'button',
        onclick: () => location.reload(),
      }, 'Recarregar'));
    if (!document.querySelector('.external-change')) document.body.append(bar);
  });
}

main();
