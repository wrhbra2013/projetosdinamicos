/* Equipe — contas da instalação, papéis e administração. */

import { el, fmtDate, relTime, passwordStrength, setBusy } from '../../core/util.js';
import {
  listUsers, currentUser, isAdmin, isOwner, setUserRole, adminResetPassword,
} from '../../core/auth.js';
import { queryAll, scalar } from '../../core/db.js';
import {
  pageHead, avatar, badge, emptyState, modal, field, inputEl, selectEl, toast, statCard,
} from '../components.js';
import { icon } from '../icons.js';
import { refresh } from '../router.js';

const ROLE_LABEL = { owner: 'Proprietário', admin: 'Administrador', member: 'Membro', viewer: 'Observador' };
const ROLE_TONE = { owner: 'ok', admin: 'info', member: 'neutral', viewer: 'neutral' };

export function teamView() {
  const users = listUsers();
  const me = currentUser();
  const admin = isAdmin();
  const owner = isOwner();

  const ideaCounts = Object.fromEntries(queryAll(
    'SELECT author_id, COUNT(*) AS total FROM ideas WHERE deleted_at IS NULL GROUP BY author_id',
  ).map((row) => [row.author_id, row.total]));
  const taskCounts = Object.fromEntries(queryAll(
    "SELECT assignee_id, COUNT(*) AS total FROM tasks WHERE deleted_at IS NULL AND status <> 'concluido' GROUP BY assignee_id",
  ).map((row) => [row.assignee_id, row.total]));

  const rows = users.map((user) => el('tr', {},
    el('td', {}, el('div', { class: 'person' },
      avatar(user.display_name, 34),
      el('div', {},
        el('strong', {}, user.display_name,
          user.id === me.id ? el('span', { class: 'muted small' }, ' (você)') : null,
          user.is_demo ? badge('demo', 'tag') : null),
        el('small', { text: user.email })))),
    el('td', {},
      admin && user.id !== me.id && user.role !== 'owner'
        ? selectEl([
          ...(owner ? [{ value: 'admin', label: ROLE_LABEL.admin }] : []),
          { value: 'member', label: ROLE_LABEL.member },
          { value: 'viewer', label: ROLE_LABEL.viewer },
        ], user.role, {
          onchange: async (event) => {
            try {
              await setUserRole(user.id, event.target.value);
              toast('Papel atualizado.', 'ok');
              refresh();
            } catch (err) { toast(err.message, 'danger'); refresh(); }
          },
        })
        : badge(ROLE_LABEL[user.role], ROLE_TONE[user.role])),
    el('td', { class: 'muted small', text: String(ideaCounts[user.id] || 0) }),
    el('td', { class: 'muted small', text: String(taskCounts[user.id] || 0) }),
    el('td', { class: 'muted small', text: user.last_login_at ? relTime(user.last_login_at) : 'nunca' }),
    el('td', { class: 'muted small', text: fmtDate(user.created_at) }),
    el('td', {}, admin && user.id !== me.id ? el('button', {
      class: 'icon-btn small', type: 'button', title: 'Redefinir senha',
      onclick: () => openResetPassword(user),
    }, icon('key', 15)) : null)));

  return el('div', { class: 'view-team' },
    pageHead({
      eyebrow: 'Pessoas',
      title: 'Equipe',
      subtitle: 'Contas desta instalação. Os dados ficam no navegador e são compartilhados apenas entre perfis do mesmo dispositivo.',
    }),
    el('div', { class: 'stat-grid' },
      statCard({ label: 'Contas ativas', value: users.length, iconName: 'users' }),
      statCard({ label: 'Administradores', value: users.filter((u) => ['owner', 'admin'].includes(u.role)).length, iconName: 'shield' }),
      statCard({ label: 'Contas de demonstração', value: users.filter((u) => u.is_demo).length, iconName: 'sparkles' }),
      statCard({ label: 'Projetos', value: scalar('SELECT COUNT(*) FROM projects WHERE deleted_at IS NULL') || 0, iconName: 'folder' })),
    el('div', { class: 'table-wrap' },
      users.length
        ? el('table', { class: 'data-table' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'Pessoa' }),
            el('th', { text: 'Papel' }),
            el('th', { text: 'Ideias' }),
            el('th', { text: 'Tarefas abertas' }),
            el('th', { text: 'Último acesso' }),
            el('th', { text: 'Desde' }),
            el('th', { text: '' }))),
          el('tbody', {}, rows))
        : emptyState({ iconName: 'users', title: 'Nenhuma conta', text: 'Crie a primeira conta para começar.' })),
    el('div', { class: 'card note-card' },
      icon('info', 18),
      el('div', {},
        el('strong', { text: 'Como funciona a colaboração' }),
        el('p', { class: 'muted small', text: 'Cada navegador tem seu próprio banco SQLite. Para trabalhar com pessoas em outros dispositivos, '
          + 'instale o backend opcional (install_api.sh) e configure a sincronização em Configurações › Sincronização. '
          + 'Sem backend, use a exportação de backup para mover os dados entre dispositivos.' }))));
}

function openResetPassword(user) {
  const pass = inputEl({ type: 'password', autocomplete: 'new-password', placeholder: 'Nova senha' });
  const confirm = inputEl({ type: 'password', autocomplete: 'new-password', placeholder: 'Repita a nova senha' });
  const err = el('div', { class: 'form-error hidden' });
  const dialog = modal({
    title: `Redefinir senha de ${user.display_name}`,
    subtitle: 'A redefinição revoga todas as sessões dessa conta e fica registrada na auditoria.',
    body: el('div', { class: 'form-grid' },
      field('Nova senha', pass, 'Mínimo de 10 caracteres, com maiúsculas, minúsculas e números.'),
      field('Confirmar', confirm),
      err),
    actions: [
      { label: 'Cancelar', class: 'ghost', onClick: (close) => close() },
      {
        label: 'Redefinir',
        class: 'primary',
        busyLabel: 'Redefinindo…',
        onClick: async (close) => {
          err.classList.add('hidden');
          try {
            if (pass.value !== confirm.value) throw new Error('As senhas não coincidem.');
            if (!passwordStrength(pass.value).ok) throw new Error('A senha não atende aos requisitos mínimos.');
            await adminResetPassword(user.id, pass.value);
            toast('Senha redefinida. As sessões antigas foram encerradas.', 'ok');
            close();
          } catch (error) {
            err.textContent = error.message;
            err.classList.remove('hidden');
          }
        },
      },
    ],
  });
  setTimeout(() => pass.focus(), 80);
  return dialog;
}
