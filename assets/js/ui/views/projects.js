/* Lista de projetos com busca e filtros. */

import { el, truncate, fmtDate, relTime, daysBetween } from '../../core/util.js';
import { listProjects, PROJECT_STATUS, PROJECT_VISIBILITY } from '../../core/repo.js';
import {
  pageHead, statusBadge, badge, progress, emptyState, inputEl, selectEl, checkbox, toast,
} from '../components.js';
import { icon } from '../icons.js';
import { navigate, refresh } from '../router.js';
import { openProjectModal } from '../forms.js';

export function projectsView(params, ctx) {
  let projects = listProjects({ includeArchived: false });
  let showArchived = false;

  const grid = el('div', { class: 'project-grid' });
  const search = inputEl({ type: 'search', placeholder: 'Buscar por nome ou descrição…', class: 'input search-input' });
  const statusFilter = selectEl([
    { value: '', label: 'Todos os status' },
    ...Object.entries(PROJECT_STATUS).map(([value, label]) => ({ value, label })),
  ], '');
  const archivedToggle = checkbox('Mostrar arquivados', false, {
    onchange: (event) => { showArchived = event.target.checked; reload(); },
  });

  function reload() {
    projects = listProjects({ includeArchived: showArchived });
    draw();
  }

  function draw() {
    const term = search.value.trim().toLowerCase();
    const status = statusFilter.value;
    const filtered = projects.filter((p) => {
      const matchesTerm = !term || p.name.toLowerCase().includes(term)
        || (p.description || '').toLowerCase().includes(term)
        || (p.tags || []).some((t) => t.toLowerCase().includes(term));
      const matchesStatus = !status || p.status === status;
      return matchesTerm && matchesStatus;
    });

    if (!filtered.length) {
      grid.replaceChildren(el('div', { class: 'span-full' }, emptyState({
        iconName: 'folder',
        title: projects.length ? 'Nenhum projeto encontrado' : 'Nenhum projeto ainda',
        text: projects.length
          ? 'Tente ajustar a busca ou os filtros.'
          : 'Crie seu primeiro projeto e comece a coletar ideias da equipe.',
        action: el('button', {
          class: 'btn primary', type: 'button',
          onclick: () => openProjectModal({ onDone: onCreated }),
        }, icon('plus', 16), 'Criar projeto'),
      })));
      return;
    }
    grid.replaceChildren(...filtered.map(projectCard));
  }

  function onCreated(project) {
    toast('Projeto criado.', 'ok');
    navigate(`/projeto/${project.id}`);
  }

  search.addEventListener('input', draw);
  statusFilter.addEventListener('change', draw);

  const view = el('div', { class: 'view-projects' },
    pageHead({
      eyebrow: 'Portfólio',
      title: 'Projetos',
      subtitle: 'Todos os projetos que você coordena ou participa.',
      actions: el('button', {
        class: 'btn primary', type: 'button',
        onclick: () => openProjectModal({ onDone: onCreated }),
      }, icon('plus', 16), 'Novo projeto'),
    }),
    el('div', { class: 'toolbar' },
      el('div', { class: 'toolbar-left' },
        el('div', { class: 'search-wrap' }, icon('search', 16), search),
        statusFilter,
        archivedToggle),
      el('span', { class: 'muted small', id: 'projectCount' })),
    grid);

  draw();
  const count = view.querySelector('#projectCount');
  if (count) count.textContent = `${projects.length} projeto(s)`;

  if (ctx?.query?.get('novo') === '1') {
    setTimeout(() => openProjectModal({ onDone: onCreated }), 120);
    history.replaceState(null, '', '#/projetos');
  }

  return view;
}

function projectCard(project) {
  const due = project.due_date ? daysBetween(project.due_date) : null;
  const dueTone = due === null ? '' : due < 0 ? 'danger-text' : due <= 7 ? 'warn-text' : '';
  return el('a', { class: `project-card ${project.status === 'arquivado' ? 'archived' : ''}`, href: `#/projeto/${project.id}` },
    el('div', { class: 'project-card-head' },
      el('span', { class: 'project-icon' }, icon('folder', 20)),
      el('div', { class: 'project-badges' },
        statusBadge(PROJECT_STATUS, project.status),
        badge(PROJECT_VISIBILITY[project.visibility], project.visibility === 'publico' ? 'info' : 'neutral'))),
    el('h3', { text: project.name }),
    el('p', { class: 'project-desc', text: truncate(project.description || 'Sem descrição.', 150) }),
    project.tags?.length
      ? el('div', { class: 'tag-row' }, project.tags.slice(0, 4).map((tag) => badge(`#${tag}`, 'tag')))
      : null,
    el('div', { class: 'project-progress' },
      progress(project.done_count, project.task_count, { showLabel: true }),
      el('small', { text: `${project.task_count} tarefa(s)` })),
    el('div', { class: 'project-card-foot' },
      el('span', { title: 'Ideias' }, icon('bulb', 14), ` ${project.idea_count}`),
      el('span', { title: 'Membros' }, icon('users', 14), ` ${project.member_count}`),
      due !== null
        ? el('span', { class: dueTone, title: 'Prazo' }, icon('calendar', 14), ` ${fmtDate(project.due_date, { short: true })}`)
        : null,
      el('span', { class: 'project-owner', title: `Coordenado por ${project.owner_name}` },
        icon('target', 14), ` ${project.my_role === 'coordenador' ? 'Você coordena' : project.owner_name.split(' ')[0]}`),
      el('span', { class: 'project-updated', text: relTime(project.updated_at) })));
}
