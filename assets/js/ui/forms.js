/* Formulários em modal — projetos, ideias, tarefas e convites. */

import { el, dateInputValue, setBusy } from '../core/util.js';
import {
  createProject, updateProject, createIdea, updateIdea, createTask, updateTask,
  addMember, listIdeas, projectMembers, PROJECT_STATUS, PROJECT_VISIBILITY,
  IDEA_CATEGORY, TASK_STATUS, TASK_PRIORITY,
} from '../core/repo.js';
import { modal, field, inputEl, selectEl, textareaEl, toast } from './components.js';

function formError() {
  const box = el('div', { class: 'form-error hidden', role: 'alert' });
  return box;
}

function showError(box, err) {
  box.textContent = err.message || String(err);
  box.classList.remove('hidden');
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function optionsFrom(map) {
  return Object.entries(map).map(([value, label]) => ({ value, label }));
}

export function openProjectModal({ project = null, onDone = null } = {}) {
  const isEdit = Boolean(project);
  const name = inputEl({ value: project?.name || '', placeholder: 'Ex.: Horta comunitária do bairro', maxlength: 120 });
  const description = textareaEl({ value: project?.description || '', placeholder: 'Qual é o objetivo? Quem se beneficia?', rows: 4, maxlength: 4000 });
  const status = selectEl(optionsFrom(PROJECT_STATUS), project?.status || 'rascunho');
  const visibility = selectEl(optionsFrom(PROJECT_VISIBILITY), project?.visibility || 'privado');
  const tags = inputEl({ value: (project?.tags || []).join(', '), placeholder: 'comunidade, sustentabilidade' });
  const start = inputEl({ type: 'date', value: dateInputValue(project?.start_date) });
  const due = inputEl({ type: 'date', value: dateInputValue(project?.due_date) });
  const err = formError();

  const body = el('div', { class: 'form-grid' },
    field('Nome do projeto', name),
    field('Descrição', description),
    el('div', { class: 'form-row' },
      field('Status', status),
      field('Visibilidade', visibility)),
    field('Etiquetas', tags, 'Separe por vírgulas (até 8).'),
    el('div', { class: 'form-row' },
      field('Início', start),
      field('Prazo', due)),
    el('p', { class: 'muted small' },
      'Projetos privados são visíveis apenas para membros. Projetos internos ficam visíveis para toda a equipe.'),
    err);

  const submit = async (close) => {
    err.classList.add('hidden');
    try {
      const payload = {
        name: name.value,
        description: description.value,
        status: status.value,
        visibility: visibility.value,
        tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8),
        start_date: start.value || null,
        due_date: due.value || null,
      };
      const saved = isEdit
        ? await updateProject(project.id, payload)
        : await createProject(payload);
      toast(isEdit ? 'Projeto atualizado.' : 'Projeto criado.', 'ok');
      close();
      onDone?.(saved);
    } catch (error) {
      showError(err, error);
    }
  };

  const dialog = modal({
    title: isEdit ? 'Editar projeto' : 'Novo projeto',
    subtitle: isEdit ? 'As alterações ficam registradas na auditoria.' : 'Defina o objetivo e convide a equipe depois.',
    body,
    size: 'wide',
    actions: [
      { label: 'Cancelar', class: 'ghost', onClick: (close) => close() },
      {
        label: isEdit ? 'Salvar alterações' : 'Criar projeto',
        class: 'primary',
        busyLabel: 'Salvando…',
        onClick: async (close) => {
          await submit(close);
        },
      },
    ],
  });
  setTimeout(() => name.focus(), 80);
  return dialog;
}

export function openIdeaModal({ projectId, idea = null, onDone = null } = {}) {
  const isEdit = Boolean(idea);
  const title = inputEl({ value: idea?.title || '', placeholder: 'Uma frase que resume a ideia', maxlength: 140 });
  const bodyText = textareaEl({
    value: idea?.body || '',
    placeholder: 'Contexto, problema que resolve, como poderia ser executada…',
    rows: 7,
    maxlength: 20000,
  });
  const category = selectEl(optionsFrom(IDEA_CATEGORY), idea?.category || 'geral');
  const impact = selectEl([1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} — ${['muito baixo', 'baixo', 'médio', 'alto', 'muito alto'][n - 1]}` })), idea?.impact || 3);
  const effort = selectEl([1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} — ${['muito baixo', 'baixo', 'médio', 'alto', 'muito alto'][n - 1]}` })), idea?.effort || 3);
  const err = formError();

  const body = el('div', { class: 'form-grid' },
    field('Título da ideia', title),
    field('Descrição', bodyText),
    el('div', { class: 'form-row' },
      field('Categoria', category),
      field('Impacto esperado', impact),
      field('Esforço estimado', effort)),
    el('p', { class: 'muted small', text: 'Impacto alto com esforço baixo tende a subir na priorização.' }),
    err);

  const dialog = modal({
    title: isEdit ? 'Editar ideia' : 'Nova ideia',
    subtitle: 'Ideias podem ser votadas e comentadas por toda a equipe do projeto.',
    body,
    size: 'wide',
    actions: [
      { label: 'Cancelar', class: 'ghost', onClick: (close) => close() },
      {
        label: isEdit ? 'Salvar ideia' : 'Publicar ideia',
        class: 'primary',
        busyLabel: 'Salvando…',
        onClick: async (close) => {
          err.classList.add('hidden');
          try {
            const payload = {
              projectId,
              title: title.value,
              body: bodyText.value,
              category: category.value,
              impact: Number(impact.value),
              effort: Number(effort.value),
            };
            const saved = isEdit ? await updateIdea(idea.id, payload) : await createIdea(payload);
            toast(isEdit ? 'Ideia atualizada.' : 'Ideia publicada.', 'ok');
            close();
            onDone?.(saved);
          } catch (error) {
            showError(err, error);
          }
        },
      },
    ],
  });
  setTimeout(() => title.focus(), 80);
  return dialog;
}

export function openTaskModal({ projectId, task = null, onDone = null } = {}) {
  const isEdit = Boolean(task);
  const members = projectMembers(projectId);
  const ideas = listIdeas({ projectId, sort: 'recent' });
  const title = inputEl({ value: task?.title || '', placeholder: 'O que precisa ser feito?', maxlength: 160 });
  const description = textareaEl({ value: task?.description || '', rows: 4, placeholder: 'Detalhes, critérios de aceite, links…' });
  const status = selectEl(optionsFrom(TASK_STATUS), task?.status || 'a_fazer');
  const priority = selectEl(optionsFrom(TASK_PRIORITY), task?.priority || 'media');
  const assignee = selectEl([
    { value: '', label: 'Sem responsável' },
    ...members.map((m) => ({ value: m.user_id, label: `${m.display_name}${m.role === 'coordenador' ? ' (coord.)' : ''}` })),
  ], task?.assignee_id || '');
  const due = inputEl({ type: 'date', value: dateInputValue(task?.due_date) });
  const idea = selectEl([
    { value: '', label: 'Sem vínculo' },
    ...ideas.map((i) => ({ value: i.id, label: i.title })),
  ], task?.idea_id || '');
  const err = formError();

  const body = el('div', { class: 'form-grid' },
    field('Título da tarefa', title),
    field('Descrição', description),
    el('div', { class: 'form-row' },
      field('Status', status),
      field('Prioridade', priority)),
    el('div', { class: 'form-row' },
      field('Responsável', assignee),
      field('Prazo', due)),
    field('Ideia relacionada', idea),
    err);

  const dialog = modal({
    title: isEdit ? 'Editar tarefa' : 'Nova tarefa',
    subtitle: 'Tarefas aparecem no quadro do projeto e no painel de quem for responsável.',
    body,
    size: 'wide',
    actions: [
      { label: 'Cancelar', class: 'ghost', onClick: (close) => close() },
      {
        label: isEdit ? 'Salvar tarefa' : 'Criar tarefa',
        class: 'primary',
        busyLabel: 'Salvando…',
        onClick: async (close) => {
          err.classList.add('hidden');
          try {
            const payload = {
              projectId,
              title: title.value,
              description: description.value,
              status: status.value,
              priority: priority.value,
              assigneeId: assignee.value || null,
              dueDate: due.value || null,
              ideaId: idea.value || null,
            };
            const saved = isEdit
              ? await updateTask(task.id, {
                title: payload.title,
                description: payload.description,
                status: payload.status,
                priority: payload.priority,
                assignee_id: payload.assigneeId,
                due_date: payload.dueDate,
                idea_id: payload.ideaId,
              })
              : await createTask(payload);
            toast(isEdit ? 'Tarefa atualizada.' : 'Tarefa criada.', 'ok');
            close();
            onDone?.(saved);
          } catch (error) {
            showError(err, error);
          }
        },
      },
    ],
  });
  setTimeout(() => title.focus(), 80);
  return dialog;
}

export function openInviteModal({ projectId, onDone = null } = {}) {
  const email = inputEl({ type: 'email', placeholder: 'pessoa@exemplo.com', autocomplete: 'off' });
  const role = selectEl([
    { value: 'colaborador', label: 'Colaborador — cria ideias, comenta e executa tarefas' },
    { value: 'observador', label: 'Observador — apenas visualiza' },
    { value: 'coordenador', label: 'Coordenador — administra o projeto' },
  ], 'colaborador');
  const err = formError();

  const body = el('div', { class: 'form-grid' },
    field('E-mail da pessoa', email, 'A pessoa precisa já ter uma conta nesta instalação.'),
    field('Papel no projeto', role),
    el('p', { class: 'muted small', text: 'O convite é registrado na auditoria com a base legal de execução de contrato.' }),
    err);

  const dialog = modal({
    title: 'Adicionar membro',
    subtitle: 'Compartilhe o projeto com alguém da equipe.',
    body,
    actions: [
      { label: 'Cancelar', class: 'ghost', onClick: (close) => close() },
      {
        label: 'Adicionar',
        class: 'primary',
        busyLabel: 'Adicionando…',
        onClick: async (close) => {
          err.classList.add('hidden');
          try {
            await addMember(projectId, email.value, role.value);
            toast('Membro adicionado ao projeto.', 'ok');
            close();
            onDone?.();
          } catch (error) {
            showError(err, error);
          }
        },
      },
    ],
  });
  setTimeout(() => email.focus(), 80);
  return dialog;
}
