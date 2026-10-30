/* Tarefas — visão pessoal e visão de todos os projetos acessíveis. */

import { el, fmtDate, daysBetween, setBusy } from '../../core/util.js';
import { currentUser } from '../../core/auth.js';
import {
  myTasks, allTasks, listProjects, moveTask, TASK_STATUS, TASK_PRIORITY,
} from '../../core/repo.js';
import {
  pageHead, statusBadge, badge, avatar, emptyState, selectEl, chip, toast,
} from '../components.js';
import { icon } from '../icons.js';
import { refresh } from '../router.js';
import { openTaskModal } from '../forms.js';

export function tasksView() {
  const projects = listProjects();
  let scope = 'minhas';
  let status = '';
  let priority = '';
  let projectId = '';

  const list = el('div', { class: 'task-table' });
  const projectSelect = selectEl([
    { value: '', label: 'Todos os projetos' },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ], '');
  const statusSelect = selectEl([
    { value: '', label: 'Todos os status' },
    ...Object.entries(TASK_STATUS).map(([value, label]) => ({ value, label })),
  ], '');
  const prioritySelect = selectEl([
    { value: '', label: 'Todas as prioridades' },
    ...Object.entries(TASK_PRIORITY).map(([value, label]) => ({ value, label })),
  ], '');

  function draw() {
    const user = currentUser();
    const rows = scope === 'minhas'
      ? myTasks(user, 200).filter((t) => (!status || t.status === status)
        && (!priority || t.priority === priority)
        && (!projectId || t.project_id === projectId))
      : allTasks({ user, status, priority, projectId, limit: 300 });

    if (!rows.length) {
      list.replaceChildren(emptyState({
        iconName: 'checkSquare',
        title: scope === 'minhas' ? 'Nenhuma tarefa atribuída a você' : 'Nenhuma tarefa encontrada',
        text: scope === 'minhas'
          ? 'Quando alguém atribuir uma tarefa a você, ela aparece aqui.'
          : 'Ajuste os filtros ou crie uma tarefa dentro de um projeto.',
        action: projectId ? el('button', {
          class: 'btn primary', type: 'button',
          onclick: () => openTaskModal({ projectId, onDone: () => refresh() }),
        }, icon('plus', 15), 'Nova tarefa') : el('a', { class: 'btn', href: '#/projetos' }, 'Ir para projetos'),
      }));
      return;
    }

    list.replaceChildren(
      el('div', { class: 'task-table-head' },
        el('span', {}, 'Tarefa'),
        el('span', {}, 'Status'),
        el('span', {}, 'Prioridade'),
        el('span', {}, 'Responsável'),
        el('span', {}, 'Prazo'),
        el('span', {}, '')),
      ...rows.map(taskRow));
  }

  function taskRow(task) {
    const due = task.due_date ? daysBetween(task.due_date) : null;
    const dueTone = due === null ? '' : due < 0 ? 'danger-text' : due <= 3 ? 'warn-text' : '';
    return el('div', { class: 'task-table-row' },
      el('div', { class: 'task-title-cell' },
        el('button', {
          class: 'task-check', type: 'button', title: 'Concluir tarefa',
          onclick: async (event) => {
            const button = event.currentTarget;
            setBusy(button, true);
            try {
              await moveTask(task.id, 'concluido');
              toast('Tarefa concluída.', 'ok');
              refresh();
            } catch (err) { toast(err.message, 'danger'); setBusy(button, false); }
          },
        }, icon('check', 14)),
        el('div', {},
          el('strong', { text: task.title }),
          el('a', { class: 'muted small', href: `#/projeto/${task.project_id}/tarefas` }, task.project_name))),
      el('span', {}, statusBadge(TASK_STATUS, task.status)),
      el('span', {}, badge(TASK_PRIORITY[task.priority], task.priority === 'critica' ? 'danger' : task.priority === 'alta' ? 'warn' : 'neutral')),
      el('span', {}, task.assignee_name
        ? el('span', { class: 'person-inline' }, avatar(task.assignee_name, 22), task.assignee_name.split(' ')[0])
        : el('span', { class: 'muted small', text: '—' })),
      el('span', { class: dueTone }, due !== null
        ? (due < 0 ? `${Math.abs(due)}d atrasada` : due === 0 ? 'hoje' : `${fmtDate(task.due_date, { short: true })}`)
        : '—'),
      el('span', {}, el('a', {
        class: 'icon-btn small', href: `#/projeto/${task.project_id}/tarefas`, title: 'Abrir no projeto',
      }, icon('external', 14))));
  }

  const scopeChips = el('div', { class: 'chip-row' },
    chip('Minhas tarefas', { active: true, iconName: 'users', onClick: () => setScope('minhas') }),
    chip('Todos os projetos', { active: false, iconName: 'folder', onClick: () => setScope('todas') }));

  function setScope(next) {
    scope = next;
    [...scopeChips.children].forEach((node, index) => node.classList.toggle('active', (index === 0) === (next === 'minhas')));
    draw();
  }

  projectSelect.addEventListener('change', () => { projectId = projectSelect.value; draw(); });
  statusSelect.addEventListener('change', () => { status = statusSelect.value; draw(); });
  prioritySelect.addEventListener('change', () => { priority = prioritySelect.value; draw(); });

  draw();

  return el('div', { class: 'view-tasks' },
    pageHead({
      eyebrow: 'Execução',
      title: 'Tarefas',
      subtitle: 'Acompanhe o que está em andamento e o que precisa de atenção.',
      actions: projectId ? el('button', {
        class: 'btn primary', type: 'button',
        onclick: () => openTaskModal({ projectId, onDone: () => refresh() }),
      }, icon('plus', 15), 'Nova tarefa') : null,
    }),
    el('div', { class: 'toolbar' },
      el('div', { class: 'toolbar-left' }, scopeChips, projectSelect, statusSelect, prioritySelect)),
    list);
}
