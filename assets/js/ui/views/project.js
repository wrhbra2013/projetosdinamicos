/* Detalhe do projeto: visão geral, ideias, tarefas, equipe e histórico. */

import {
  el, fmtDate, fmtDateTime, relTime, truncate, daysBetween, setBusy,
} from '../../core/util.js';
import { currentUser, canProject, canEditIdea } from '../../core/auth.js';
import {
  getProject, getIdea, listIdeas, listTasks, listComments, projectMembers,
  changeMemberRole, removeMember, voteIdea, setIdeaStatus, deleteIdea, addComment,
  deleteComment, moveTask, deleteTask, archiveProject, deleteProject,
  IDEA_STATUS, IDEA_CATEGORY, TASK_STATUS, TASK_PRIORITY,
  PROJECT_STATUS, PROJECT_VISIBILITY, PROJECT_ROLES,
} from '../../core/repo.js';
import { auditForProject, actionLabel } from '../../core/audit.js';
import {
  pageHead, statusBadge, badge, avatar, progress, emptyState, tabs, modal,
  textareaEl, selectEl, toast, confirmDialog, sectionTitle, kv,
} from '../components.js';
import { icon } from '../icons.js';
import { navigate, refresh } from '../router.js';
import { openProjectModal, openIdeaModal, openTaskModal, openInviteModal } from '../forms.js';

export function projectView(params) {
  const project = getProject(params.id);
  if (!project) {
    return el('div', {}, pageHead({ title: 'Projeto não encontrado' }),
      emptyState({
        iconName: 'folder',
        title: 'Este projeto não existe ou foi excluído',
        action: el('a', { class: 'btn primary', href: '#/projetos' }, 'Voltar aos projetos'),
      }));
  }
  if (!canProject(project.id, 'view')) {
    return el('div', {}, pageHead({ title: 'Acesso restrito' }),
      emptyState({
        iconName: 'lock',
        title: 'Você não participa deste projeto',
        text: 'Peça a um coordenador para adicionar você à equipe.',
        action: el('a', { class: 'btn primary', href: '#/projetos' }, 'Voltar aos projetos'),
      }));
  }

  const tab = ['visao', 'ideias', 'tarefas', 'equipe', 'historico'].includes(params.tab)
    ? params.tab
    : 'visao';
  const ideas = listIdeas({ projectId: project.id });
  const tasks = listTasks({ projectId: project.id });
  const members = projectMembers(project.id);
  const canEdit = canProject(project.id, 'edit');
  const canManage = canProject(project.id, 'manage');
  const canTask = canProject(project.id, 'createTask');
  const isArchived = project.status === 'arquivado';

  const actions = el('div', { class: 'row wrap' },
    canEdit ? el('button', {
      class: 'btn ghost sm', type: 'button',
      onclick: () => openProjectModal({ project, onDone: () => refresh() }),
    }, icon('edit', 15), 'Editar') : null,
    canManage && !isArchived ? el('button', {
      class: 'btn ghost sm', type: 'button',
      onclick: async () => {
        if (await confirmDialog({
          title: 'Arquivar projeto?',
          message: 'O projeto sai da lista principal, mas continua disponível em "Mostrar arquivados".',
          confirmLabel: 'Arquivar',
        })) {
          await archiveProject(project.id, true);
          toast('Projeto arquivado.', 'ok');
          refresh();
        }
      },
    }, icon('archive', 15), 'Arquivar') : null,
    canManage && isArchived ? el('button', {
      class: 'btn ghost sm', type: 'button',
      onclick: async () => { await archiveProject(project.id, false); toast('Projeto restaurado.', 'ok'); refresh(); },
    }, icon('refresh', 15), 'Restaurar') : null,
    canManage ? el('button', {
      class: 'btn ghost sm danger-text', type: 'button',
      onclick: async () => {
        if (await confirmDialog({
          title: 'Excluir projeto?',
          message: 'O projeto e todo o seu conteúdo entram na lixeira e são eliminados definitivamente em 30 dias. '
            + 'A operação fica registrada na auditoria.',
          confirmLabel: 'Excluir projeto',
          danger: true,
        })) {
          await deleteProject(project.id);
          toast('Projeto movido para a lixeira.', 'ok');
          navigate('/projetos');
        }
      },
    }, icon('trash', 15), 'Excluir') : null,
    canEdit ? el('button', {
      class: 'btn primary sm', type: 'button',
      onclick: () => openIdeaModal({ projectId: project.id, onDone: () => refresh() }),
    }, icon('bulb', 15), 'Nova ideia') : null,
    canTask ? el('button', {
      class: 'btn primary sm', type: 'button',
      onclick: () => openTaskModal({ projectId: project.id, onDone: () => refresh() }),
    }, icon('plus', 15), 'Nova tarefa') : null);

  const dueDays = project.due_date ? daysBetween(project.due_date) : null;

  return el('div', { class: 'view-project' },
    el('div', { class: 'breadcrumbs' },
      el('a', { href: '#/projetos' }, icon('arrowLeft', 15), 'Projetos'),
      el('span', { text: '/' }),
      el('span', { text: truncate(project.name, 50) })),
    el('header', { class: 'project-hero' },
      el('div', { class: 'project-hero-main' },
        el('div', { class: 'row wrap center' },
          statusBadge(PROJECT_STATUS, project.status),
          badge(PROJECT_VISIBILITY[project.visibility], 'neutral'),
          el('span', { class: 'muted small', text: `criado ${relTime(project.created_at)}` })),
        el('h1', { text: project.name, 'data-title': project.name }),
        el('p', { class: 'project-hero-desc', text: project.description || 'Sem descrição.' }),
        el('div', { class: 'project-hero-meta' },
          el('span', {}, avatar(project.owner_name, 22), ` ${project.owner_name}`),
          project.due_date
            ? el('span', { class: dueDays < 0 ? 'danger-text' : dueDays <= 7 ? 'warn-text' : '' },
              icon('calendar', 14), ` Prazo ${fmtDate(project.due_date)}${dueDays < 0 ? ` (${Math.abs(dueDays)}d atrasado)` : ''}`)
            : null,
          project.tags?.length ? el('span', {}, icon('flag', 14), ` ${project.tags.join(' · ')}`) : null)),
      el('div', { class: 'project-hero-side' }, actions)),

    tabs([
      { id: 'visao', label: 'Visão geral' },
      { id: 'ideias', label: 'Ideias', count: ideas.length },
      { id: 'tarefas', label: 'Tarefas', count: tasks.length },
      { id: 'equipe', label: 'Equipe', count: members.length },
      { id: 'historico', label: 'Histórico' },
    ], tab, (next) => navigate(`/projeto/${project.id}/${next}`)),

    tab === 'visao' ? overviewTab(project, ideas, tasks, members)
      : tab === 'ideias' ? ideasTab(project, ideas, canEdit, canManage)
        : tab === 'tarefas' ? tasksTab(project, tasks, canTask)
          : tab === 'equipe' ? teamTab(project, members, canManage)
            : historyTab(project));
}

/* ------------------------------- Visão geral ------------------------------ */
function overviewTab(project, ideas, tasks, members) {
  const done = tasks.filter((t) => t.status === 'concluido').length;
  const approved = ideas.filter((i) => ['aprovada', 'em_execucao', 'concluida'].includes(i.status)).length;
  const recent = [...ideas].sort((a, b) => b.score - a.score).slice(0, 4);
  const history = auditForProject(project.id, 8);

  return el('div', { class: 'tab-panel overview-grid' },
    el('div', { class: 'overview-main' },
      el('section', { class: 'card' },
        sectionTitle('Sobre o projeto'),
        el('p', { class: 'long-text', text: project.description || 'Sem descrição.' }),
        el('div', { class: 'meta-grid' },
          kv('Coordenador', project.owner_name),
          kv('Visibilidade', PROJECT_VISIBILITY[project.visibility]),
          kv('Início', project.start_date ? fmtDate(project.start_date) : '—'),
          kv('Prazo', project.due_date ? fmtDate(project.due_date) : '—'),
          kv('Criado em', fmtDate(project.created_at)),
          kv('Atualizado', relTime(project.updated_at)))),

      sectionTitle('Ideias em destaque', el('a', { class: 'link', href: `#/projeto/${project.id}/ideias` }, 'Ver todas', icon('arrowRight', 14))),
      recent.length
        ? el('div', { class: 'idea-mini-list' }, recent.map((idea) => el('button', {
          class: 'idea-mini', type: 'button', onclick: () => openIdeaDetail(idea.id, () => refresh()),
        },
        el('div', { class: 'idea-mini-top' },
          statusBadge(IDEA_STATUS, idea.status),
          el('span', { class: 'idea-score', text: `▲ ${idea.score}` })),
        el('strong', { text: idea.title }),
        el('small', { text: `${idea.author_name} · ${idea.comment_count} comentário(s)` }))))
        : emptyState({ iconName: 'bulb', title: 'Nenhuma ideia ainda', text: 'Proponha a primeira ideia deste projeto.' })),

    el('aside', { class: 'overview-side' },
      el('section', { class: 'card' },
        sectionTitle('Progresso'),
        el('div', { class: 'big-progress' },
          el('strong', { text: `${tasks.length ? Math.round((done / tasks.length) * 100) : 0}%` }),
          el('span', { class: 'muted', text: 'tarefas concluídas' })),
        progress(done, tasks.length),
        el('div', { class: 'mini-stats' },
          el('div', {}, el('strong', { text: ideas.length }), el('small', { text: 'ideias' })),
          el('div', {}, el('strong', { text: approved }), el('small', { text: 'aprovadas' })),
          el('div', {}, el('strong', { text: tasks.length - done }), el('small', { text: 'em aberto' })),
          el('div', {}, el('strong', { text: members.length }), el('small', { text: 'pessoas' })))),

      sectionTitle('Equipe'),
      el('div', { class: 'member-stack' },
        members.slice(0, 6).map((m) => el('div', { class: 'member-line' },
          avatar(m.display_name, 28),
          el('div', {}, el('strong', { text: m.display_name }), el('small', { text: PROJECT_ROLES[m.role] })))),
        el('a', { class: 'link', href: `#/projeto/${project.id}/equipe` }, 'Gerenciar equipe', icon('arrowRight', 14))),

      sectionTitle('Atividade recente', el('a', { class: 'link', href: `#/auditoria?projeto=${project.id}` }, 'Auditoria', icon('arrowRight', 14))),
      el('div', { class: 'timeline' }, history.length
        ? history.map((row) => el('div', { class: 'timeline-item' },
          el('span', { class: `timeline-dot ${row.outcome}` }),
          el('div', {},
            el('strong', { text: actionLabel(row.action) }),
            el('small', { text: `${row.actor_label} · ${relTime(row.occurred_at)}` }))))
        : el('p', { class: 'muted small', text: 'Nenhuma atividade registrada.' }))));
}

/* --------------------------------- Ideias --------------------------------- */
function ideasTab(project, ideas, canEdit, canManage) {
  let sort = 'score';
  let statusFilter = '';
  const list = el('div', { class: 'idea-list' });

  const search = el('input', { class: 'input search-input', type: 'search', placeholder: 'Buscar ideias…' });
  const sortSelect = selectEl([
    { value: 'score', label: 'Mais votadas' },
    { value: 'recent', label: 'Mais recentes' },
    { value: 'impact', label: 'Maior impacto' },
    { value: 'effort', label: 'Menor esforço' },
    { value: 'title', label: 'Título (A–Z)' },
  ], sort);
  const statusSelect = selectEl([
    { value: '', label: 'Todos os status' },
    ...Object.entries(IDEA_STATUS).map(([value, label]) => ({ value, label })),
  ], '');

  function draw() {
    const rows = listIdeas({
      projectId: project.id,
      search: search.value.trim(),
      status: statusFilter,
      sort,
    });
    if (!rows.length) {
      list.replaceChildren(emptyState({
        iconName: 'bulb',
        title: 'Nenhuma ideia encontrada',
        text: ideas.length ? 'Ajuste os filtros ou a busca.' : 'Comece registrando a primeira ideia do projeto.',
        action: canEdit ? el('button', {
          class: 'btn primary', type: 'button',
          onclick: () => openIdeaModal({ projectId: project.id, onDone: () => refresh() }),
        }, icon('plus', 15), 'Nova ideia') : null,
      }));
      return;
    }
    list.replaceChildren(...rows.map((idea) => ideaCard(idea, canEdit, canManage)));
  }

  search.addEventListener('input', draw);
  sortSelect.addEventListener('change', () => { sort = sortSelect.value; draw(); });
  statusSelect.addEventListener('change', () => { statusFilter = statusSelect.value; draw(); });

  const panel = el('div', { class: 'tab-panel' },
    el('div', { class: 'toolbar' },
      el('div', { class: 'toolbar-left' },
        el('div', { class: 'search-wrap' }, icon('search', 16), search),
        sortSelect,
        statusSelect),
      canEdit ? el('button', {
        class: 'btn primary sm', type: 'button',
        onclick: () => openIdeaModal({ projectId: project.id, onDone: () => refresh() }),
      }, icon('plus', 15), 'Nova ideia') : null),
    list);
  draw();
  return panel;
}

function ideaCard(idea, canEdit, canManage) {
  const user = currentUser();
  const up = el('button', {
    class: `vote-btn ${idea.my_vote === 1 ? 'active' : ''}`,
    type: 'button',
    title: idea.my_vote === 1 ? 'Remover voto' : 'Votar a favor',
    onclick: async (event) => {
      event.stopPropagation();
      try {
        await voteIdea(idea.id, idea.my_vote === 1 ? 0 : 1);
        refresh();
      } catch (err) { toast(err.message, 'danger'); }
    },
  }, icon('thumbsUp', 15), el('span', { text: String(idea.votes_up) }));
  const down = el('button', {
    class: `vote-btn down ${idea.my_vote === -1 ? 'active' : ''}`,
    type: 'button',
    title: 'Votar contra',
    onclick: async (event) => {
      event.stopPropagation();
      try {
        await voteIdea(idea.id, idea.my_vote === -1 ? 0 : -1);
        refresh();
      } catch (err) { toast(err.message, 'danger'); }
    },
  }, icon('thumbsDown', 15), el('span', { text: String(idea.votes_down) }));

  return el('article', {
    class: 'idea-card',
    onclick: () => openIdeaDetail(idea.id, () => refresh()),
  },
  el('div', { class: 'idea-vote' }, up, el('strong', { class: 'idea-total', text: String(idea.score) }), down),
  el('div', { class: 'idea-body' },
    el('div', { class: 'idea-head' },
      statusBadge(IDEA_STATUS, idea.status),
      badge(IDEA_CATEGORY[idea.category] || idea.category, 'tag'),
      el('span', { class: 'muted small', text: `por ${idea.author_name} · ${relTime(idea.created_at)}` })),
    el('h3', { text: idea.title }),
    el('p', { text: truncate(idea.body || 'Sem descrição.', 220) }),
    el('div', { class: 'idea-foot' },
      el('span', {}, icon('message', 14), ` ${idea.comment_count}`),
      el('span', { title: 'Impacto' }, icon('target', 14), ` impacto ${idea.impact}/5`),
      el('span', { title: 'Esforço' }, icon('barChart', 14), ` esforço ${idea.effort}/5`),
      canManage ? el('select', {
        class: 'input mini-select',
        value: idea.status,
        onclick: (event) => event.stopPropagation(),
        onchange: async (event) => {
          event.stopPropagation();
          try { await setIdeaStatus(idea.id, event.target.value); toast('Status atualizado.', 'ok'); refresh(); }
          catch (err) { toast(err.message, 'danger'); }
        },
      }, Object.entries(IDEA_STATUS).map(([value, label]) => el('option', {
        value, selected: value === idea.status, text: label,
      }))) : null,
      canEditIdea(idea, user?.id) ? el('button', {
        class: 'icon-btn small', type: 'button', title: 'Editar ideia',
        onclick: (event) => {
          event.stopPropagation();
          openIdeaModal({ projectId: idea.project_id, idea, onDone: () => refresh() });
        },
      }, icon('edit', 14)) : null)));
}

export function openIdeaDetail(ideaId, onChange) {
  const dialog = modal({
    title: 'Ideia',
    size: 'wide',
    body: el('div', { class: 'idea-detail' }),
    actions: [{ label: 'Fechar', class: 'ghost', onClick: (close) => close() }],
  });

  const render = () => {
    const idea = getIdea(ideaId);
    if (!idea) {
      dialog.body.replaceChildren(emptyState({ iconName: 'alert', title: 'Ideia não encontrada' }));
      return;
    }
    const user = currentUser();
    const canManage = canProject(idea.project_id, 'manage');
    const canComment = canProject(idea.project_id, 'comment');
    const comments = listComments(ideaId);

    const commentInput = textareaEl({ rows: 3, placeholder: 'Escreva um comentário construtivo…' });
    const commentButton = el('button', {
      class: 'btn primary sm', type: 'button',
      onclick: async (event) => {
        const button = event.currentTarget;
        setBusy(button, true, 'Enviando…');
        try {
          await addComment(ideaId, commentInput.value);
          toast('Comentário publicado.', 'ok');
          onChange?.();
          render();
        } catch (err) {
          toast(err.message, 'danger');
        } finally { setBusy(button, false); }
      },
    }, icon('message', 14), 'Comentar');

    dialog.panel.querySelector('.modal-head h2').textContent = idea.title;
    dialog.body.replaceChildren(
      el('div', { class: 'idea-detail-meta' },
        statusBadge(IDEA_STATUS, idea.status),
        badge(IDEA_CATEGORY[idea.category] || idea.category, 'tag'),
        el('span', { class: 'muted small', text: `por ${idea.author_name} · ${fmtDateTime(idea.created_at)}` }),
        el('span', { class: 'idea-score big', text: `▲ ${idea.score}` })),
      el('p', { class: 'long-text', text: idea.body || 'Sem descrição.' }),
      el('div', { class: 'idea-detail-stats' },
        el('span', {}, icon('thumbsUp', 14), ` ${idea.votes_up} a favor`),
        el('span', {}, icon('thumbsDown', 14), ` ${idea.votes_down} contra`),
        el('span', {}, icon('target', 14), ` impacto ${idea.impact}/5`),
        el('span', {}, icon('barChart', 14), ` esforço ${idea.effort}/5`)),
      el('div', { class: 'row wrap' },
        el('button', {
          class: 'btn sm', type: 'button',
          onclick: async () => {
            await voteIdea(idea.id, idea.my_vote === 1 ? 0 : 1);
            onChange?.(); render();
          },
        }, icon('thumbsUp', 14), idea.my_vote === 1 ? 'Remover voto' : 'Votar a favor'),
        canManage ? selectEl(Object.entries(IDEA_STATUS).map(([value, label]) => ({ value, label })), idea.status, {
          onchange: async (event) => {
            await setIdeaStatus(idea.id, event.target.value);
            toast('Status atualizado.', 'ok');
            onChange?.(); render();
          },
        }) : null,
        canEditIdea(idea, user?.id) ? el('button', {
          class: 'btn sm', type: 'button',
          onclick: () => {
            dialog.close();
            openIdeaModal({ projectId: idea.project_id, idea, onDone: () => { onChange?.(); refresh(); } });
          },
        }, icon('edit', 14), 'Editar') : null,
        canEditIdea(idea, user?.id) ? el('button', {
          class: 'btn sm danger-text', type: 'button',
          onclick: async () => {
            if (await confirmDialog({
              title: 'Excluir ideia?',
              message: 'A ideia vai para a lixeira e será eliminada em 30 dias.',
              confirmLabel: 'Excluir',
              danger: true,
            })) {
              await deleteIdea(idea.id);
              toast('Ideia excluída.', 'ok');
              dialog.close();
              onChange?.(); refresh();
            }
          },
        }, icon('trash', 14), 'Excluir') : null),

      el('hr', { class: 'divider' }),
      sectionTitle(`Comentários (${comments.length})`),
      el('div', { class: 'comment-list' }, comments.length
        ? comments.map((comment) => el('div', { class: 'comment' },
          avatar(comment.author_name, 28),
          el('div', { class: 'comment-main' },
            el('div', { class: 'comment-head' },
              el('strong', { text: comment.author_name }),
              el('span', { class: 'muted small', text: relTime(comment.created_at) }),
              (comment.author_id === user?.id || canManage) ? el('button', {
                class: 'icon-btn small', type: 'button', title: 'Excluir comentário',
                onclick: async () => {
                  if (await confirmDialog({ title: 'Excluir comentário?', message: 'Esta ação não pode ser desfeita.', confirmLabel: 'Excluir', danger: true })) {
                    await deleteComment(comment.id);
                    onChange?.(); render();
                  }
                },
              }, icon('trash', 13)) : null),
            el('p', { text: comment.body }))))
        : el('p', { class: 'muted small', text: 'Seja a primeira pessoa a comentar.' })),
      canComment ? el('div', { class: 'comment-form' }, commentInput, commentButton) : null,
    );
  };

  render();
  return dialog;
}

/* -------------------------------- Tarefas --------------------------------- */
function tasksTab(project, tasks, canTask) {
  const board = el('div', { class: 'kanban' });

  for (const [status, label] of Object.entries(TASK_STATUS)) {
    const columnTasks = tasks.filter((task) => task.status === status);
    const column = el('div', { class: 'kanban-col', dataset: { status } });

    column.addEventListener('dragover', (event) => {
      if (!canTask) return;
      event.preventDefault();
      column.classList.add('drag-over');
    });
    column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
    column.addEventListener('drop', async (event) => {
      event.preventDefault();
      column.classList.remove('drag-over');
      if (!canTask) return;
      const id = event.dataTransfer.getData('text/plain');
      if (!id) return;
      try {
        await moveTask(id, status);
        toast('Tarefa movida.', 'ok');
        refresh();
      } catch (err) { toast(err.message, 'danger'); }
    });

    column.append(
      el('div', { class: 'kanban-head' },
        el('span', { text: label }),
        el('span', { class: 'kanban-count', text: String(columnTasks.length) })),
      el('div', { class: 'kanban-cards' },
        columnTasks.length
          ? columnTasks.map((task) => taskCard(task, canTask))
          : el('p', { class: 'muted small empty-col', text: 'Nenhuma tarefa' })));
    board.append(column);
  }

  return el('div', { class: 'tab-panel' },
    el('div', { class: 'toolbar' },
      el('div', { class: 'toolbar-left' },
        el('span', { class: 'muted small' },
          icon('info', 14), ' Arraste os cartões entre as colunas para atualizar o status.')),
      canTask ? el('button', {
        class: 'btn primary sm', type: 'button',
        onclick: () => openTaskModal({ projectId: project.id, onDone: () => refresh() }),
      }, icon('plus', 15), 'Nova tarefa') : null),
    board);
}

function taskCard(task, canTask) {
  const due = task.due_date ? daysBetween(task.due_date) : null;
  const dueTone = due === null ? '' : due < 0 ? 'danger-text' : due <= 3 ? 'warn-text' : '';
  const card = el('article', {
    class: `task-card priority-${task.priority}`,
    draggable: canTask ? 'true' : null,
    ondragstart: (event) => {
      if (!canTask) return;
      event.dataTransfer.setData('text/plain', task.id);
      event.dataTransfer.effectAllowed = 'move';
    },
    onclick: () => {
      if (canTask) openTaskModal({ projectId: task.project_id, task, onDone: () => refresh() });
    },
  },
  el('div', { class: 'task-card-head' },
    badge(TASK_PRIORITY[task.priority], task.priority === 'critica' ? 'danger' : task.priority === 'alta' ? 'warn' : 'neutral'),
    canTask ? el('button', {
      class: 'icon-btn small', type: 'button', title: 'Excluir tarefa',
      onclick: async (event) => {
        event.stopPropagation();
        if (await confirmDialog({
          title: 'Excluir tarefa?',
          message: 'A tarefa vai para a lixeira e será eliminada em 30 dias.',
          confirmLabel: 'Excluir',
          danger: true,
        })) {
          await deleteTask(task.id);
          toast('Tarefa excluída.', 'ok');
          refresh();
        }
      },
    }, icon('trash', 13)) : null),
  el('strong', { text: task.title }),
  task.description ? el('p', { text: truncate(task.description, 90) }) : null,
  task.idea_title ? el('small', { class: 'task-idea' }, icon('bulb', 12), ` ${truncate(task.idea_title, 40)}`) : null,
  el('div', { class: 'task-card-foot' },
    task.assignee_name
      ? el('span', { class: 'task-assignee' }, avatar(task.assignee_name, 22), el('span', { text: task.assignee_name.split(' ')[0] }))
      : el('span', { class: 'muted small', text: 'Sem responsável' }),
    due !== null ? el('span', { class: `due ${dueTone}`, text: due < 0 ? `${Math.abs(due)}d atrasada` : due === 0 ? 'hoje' : `em ${due}d` }) : null));
  return card;
}

/* --------------------------------- Equipe --------------------------------- */
function teamTab(project, members, canManage) {
  const rows = members.map((member) => {
    const isOwner = member.user_id === project.owner_id;
    return el('tr', {},
      el('td', {}, el('div', { class: 'person' },
        avatar(member.display_name, 32),
        el('div', {},
          el('strong', { text: member.display_name }),
          el('small', { text: member.email })))),
      el('td', {},
        isOwner
          ? badge('Proprietário', 'ok')
          : canManage
            ? selectEl([
              { value: 'coordenador', label: PROJECT_ROLES.coordenador },
              { value: 'colaborador', label: PROJECT_ROLES.colaborador },
              { value: 'observador', label: PROJECT_ROLES.observador },
            ], member.role, {
              onchange: async (event) => {
                try {
                  await changeMemberRole(project.id, member.user_id, event.target.value);
                  toast('Papel atualizado.', 'ok');
                  refresh();
                } catch (err) { toast(err.message, 'danger'); }
              },
            })
            : badge(PROJECT_ROLES[member.role], member.role === 'coordenador' ? 'info' : 'neutral')),
      el('td', { class: 'muted small', text: fmtDate(member.joined_at) }),
      el('td', {}, isOwner ? null : canManage ? el('button', {
        class: 'icon-btn small danger-text', type: 'button', title: 'Remover do projeto',
        onclick: async () => {
          if (await confirmDialog({
            title: 'Remover membro?',
            message: `${member.display_name} perderá o acesso a este projeto. O conteúdo criado por essa pessoa é preservado.`,
            confirmLabel: 'Remover',
            danger: true,
          })) {
            try {
              await removeMember(project.id, member.user_id);
              toast('Membro removido.', 'ok');
              refresh();
            } catch (err) { toast(err.message, 'danger'); }
          }
        },
      }, icon('x', 15)) : null));
  });

  return el('div', { class: 'tab-panel' },
    el('div', { class: 'toolbar' },
      el('div', { class: 'toolbar-left' },
        el('span', { class: 'muted small' },
          icon('shield', 14), ' Apenas dados necessários são exibidos (minimização — LGPD art. 6º, III).')),
      canManage ? el('button', {
        class: 'btn primary sm', type: 'button',
        onclick: () => openInviteModal({ projectId: project.id, onDone: () => refresh() }),
      }, icon('userPlus', 15), 'Adicionar membro') : null),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'data-table' },
        el('thead', {}, el('tr', {},
          el('th', { text: 'Pessoa' }),
          el('th', { text: 'Papel' }),
          el('th', { text: 'Desde' }),
          el('th', { text: '' }))),
        el('tbody', {}, rows))));
}

/* -------------------------------- Histórico ------------------------------- */
function historyTab(project) {
  const rows = auditForProject(project.id, 100);
  return el('div', { class: 'tab-panel' },
    el('div', { class: 'toolbar' },
      el('div', { class: 'toolbar-left' },
        el('span', { class: 'muted small' },
          icon('activity', 14), ` ${rows.length} evento(s) mais recentes deste projeto.`)),
      el('a', { class: 'btn sm', href: `#/auditoria?projeto=${project.id}` },
        icon('external', 14), 'Abrir auditoria completa')),
    rows.length
      ? el('div', { class: 'table-wrap' },
        el('table', { class: 'data-table audit-table' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'Quando' }),
            el('th', { text: 'Quem' }),
            el('th', { text: 'Ação' }),
            el('th', { text: 'Resultado' }),
            el('th', { text: '' }))),
          el('tbody', {}, rows.map((row) => el('tr', {
            class: 'clickable',
            onclick: () => modal({
              title: actionLabel(row.action),
              subtitle: `${fmtDateTime(row.occurred_at)} · ${row.actor_label}`,
              body: el('div', { class: 'audit-detail' },
                el('div', { class: 'meta-grid' },
                  kv('Evento', `#${row.seq}`),
                  kv('Entidade', `${row.entity_type}${row.entity_id ? ` · ${row.entity_id.slice(0, 8)}…` : ''}`),
                  kv('Base legal', row.legal_basis),
                  kv('Finalidade', row.purpose),
                  kv('Resultado', row.outcome)),
                el('pre', { class: 'json-block', text: JSON.stringify(JSON.parse(row.detail || '{}'), null, 2) }),
                el('p', { class: 'muted small', text: `Hash: ${row.hash}` })),
              actions: [{ label: 'Fechar', class: 'ghost' }],
            }),
          },
          el('td', { class: 'muted small', text: relTime(row.occurred_at) }),
          el('td', { text: row.actor_label }),
          el('td', {}, actionLabel(row.action)),
          el('td', {}, badge(row.outcome, row.outcome === 'sucesso' ? 'ok' : 'danger')),
          el('td', {}, icon('chevronRight', 14)))))))
      : emptyState({
        iconName: 'activity',
        title: 'Nenhum evento registrado',
        text: 'As próximas ações neste projeto aparecerão aqui.',
      }));
}


