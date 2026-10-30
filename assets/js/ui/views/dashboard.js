/* Painel inicial — visão geral do trabalho e da conformidade. */

import { el, fmtDate, relTime, daysBetween, truncate, setBusy } from '../../core/util.js';
import { currentUser } from '../../core/auth.js';
import {
  dashboardStats, listProjects, myTasks, recentIdeas, moveTask,
  PROJECT_STATUS, TASK_PRIORITY,
} from '../../core/repo.js';
import { complianceReport } from '../../core/lgpd.js';
import {
  pageHead, statCard, statusBadge, progress, emptyState, scoreRing,
  sectionTitle, avatar, toast,
} from '../components.js';
import { icon } from '../icons.js';
import { navigate, refresh } from '../router.js';

export async function dashboardView() {
  const user = currentUser();
  const stats = dashboardStats(user);
  const projects = listProjects({ user }).slice(0, 4);
  const tasks = myTasks(user, 6);
  const ideas = recentIdeas(user, 5);
  const report = await complianceReport();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const firstName = user.display_name.split(' ')[0];

  const pendingChecks = report.checks.filter((c) => c.status !== 'ok').slice(0, 3);

  return el('div', { class: 'view-dashboard' },
    pageHead({
      eyebrow: new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date()),
      title: `${greeting}, ${firstName}`,
      subtitle: stats.projects
        ? 'Aqui está o que está acontecendo nos seus projetos hoje.'
        : 'Comece criando seu primeiro projeto ou explore os dados de demonstração.',
      actions: [
        el('button', {
          class: 'btn primary', type: 'button',
          onclick: () => navigate('/projetos?novo=1'),
        }, icon('plus', 16), 'Novo projeto'),
      ],
    }),

    el('div', { class: 'stat-grid' },
      statCard({ label: 'Projetos ativos', value: stats.projects, iconName: 'folder', hint: 'que você participa', href: '#/projetos' }),
      statCard({ label: 'Ideias registradas', value: stats.ideas, iconName: 'bulb', hint: 'em todos os projetos', href: '#/ideias' }),
      statCard({ label: 'Tarefas abertas', value: stats.openTasks, iconName: 'checkSquare', hint: 'em andamento', href: '#/tarefas' }),
      statCard({ label: 'Prazos em 7 dias', value: stats.dueSoon, iconName: 'clock', hint: 'atenção necessária', tone: stats.dueSoon ? 'warn' : '', href: '#/tarefas' })),

    stats.projects === 0
      ? el('section', { class: 'card onboarding' },
        el('div', { class: 'onboarding-copy' },
          el('div', { class: 'eyebrow', text: 'Primeiros passos' }),
          el('h2', { text: 'Transforme uma ideia em projeto hoje' }),
          el('p', { text: 'Crie um projeto, convide pessoas e registre as primeiras ideias. '
            + 'Cada ação fica registrada em uma trilha de auditoria imutável.' }),
          el('ol', { class: 'onboarding-steps' },
            el('li', {}, el('b', {}, '1.'), ' Crie um projeto e defina o objetivo.'),
            el('li', {}, el('b', {}, '2.'), ' Convide a equipe e colete ideias.'),
            el('li', {}, el('b', {}, '3.'), ' Priorize, transforme em tarefas e acompanhe.')),
          el('div', { class: 'row' },
            el('button', { class: 'btn primary', type: 'button', onclick: () => navigate('/projetos?novo=1') },
              icon('plus', 16), 'Criar projeto'),
            el('button', {
              class: 'btn ghost', type: 'button',
              onclick: () => navigate('/configuracoes?tab=dados'),
            }, icon('sparkles', 16), 'Carregar demonstração'))),
        el('div', { class: 'onboarding-art' },
          icon('sparkles', 88),
          el('span', { text: 'ideias → projetos → impacto' })))
      : el('div', { class: 'dashboard-grid' },
        el('div', { class: 'dashboard-main' },
          sectionTitle('Seus projetos', el('a', { class: 'link', href: '#/projetos' }, 'Ver todos', icon('arrowRight', 14))),
          el('div', { class: 'project-mini-grid' },
            projects.map((project) => projectMini(project))),

          sectionTitle('Minhas tarefas', el('a', { class: 'link', href: '#/tarefas' }, 'Ver todas', icon('arrowRight', 14))),
          tasks.length
            ? el('div', { class: 'task-list' }, tasks.map((task) => taskRow(task)))
            : emptyState({
              iconName: 'check',
              title: 'Nenhuma tarefa atribuída a você',
              text: 'Quando alguém atribuir uma tarefa, ela aparece aqui.',
            })),

        el('aside', { class: 'dashboard-side' },
          el('section', { class: 'card compliance-card' },
            el('div', { class: 'card-head' },
              el('div', {},
                el('div', { class: 'eyebrow', text: 'Conformidade' }),
                el('h3', { text: 'LGPD em dia' })),
              scoreRing(report.score, 78)),
            el('p', { class: 'muted small', text: `${report.checks.filter((c) => c.status === 'ok').length} de ${report.checks.length} controles atendidos.` }),
            pendingChecks.length
              ? el('ul', { class: 'check-list' }, pendingChecks.map((check) => el('li', {},
                icon(check.status === 'pendente' ? 'alert' : 'info', 15),
                el('span', { text: check.label }))))
              : el('p', { class: 'ok-line' }, icon('check', 15), 'Todos os controles essenciais estão atendidos.'),
            el('a', { class: 'btn ghost full sm', href: '#/lgpd' }, 'Abrir central de privacidade')),

          sectionTitle('Ideias recentes', el('a', { class: 'link', href: '#/ideias' }, 'Ver todas', icon('arrowRight', 14))),
          ideas.length
            ? el('div', { class: 'idea-mini-list' }, ideas.map((idea) => el('a', {
              class: 'idea-mini', href: `#/projeto/${idea.project_id}/ideias?ideia=${idea.id}`,
            },
            el('div', { class: 'idea-mini-top' },
              statusBadge({ nova: 'Nova', em_discussao: 'Em discussão', aprovada: 'Aprovada', em_execucao: 'Em execução', concluida: 'Concluída', arquivada: 'Arquivada' }, idea.status),
              el('span', { class: 'idea-score', text: `▲ ${idea.score}` })),
            el('strong', { text: idea.title }),
            el('small', { text: `${idea.project_name} · ${idea.author_name}` }))))
            : emptyState({
              iconName: 'bulb',
              title: 'Nenhuma ideia ainda',
              text: 'Abra um projeto e registre a primeira ideia.',
            }))));
}

function projectMini(project) {
  const due = project.due_date ? daysBetween(project.due_date) : null;
  return el('a', { class: 'project-mini', href: `#/projeto/${project.id}` },
    el('div', { class: 'project-mini-head' },
      el('span', { class: 'project-mini-icon' }, icon('folder', 17)),
      statusBadge(PROJECT_STATUS, project.status)),
    el('h3', { text: project.name }),
    el('p', { text: truncate(project.description || 'Sem descrição.', 90) }),
    progress(project.done_count, project.task_count, { showLabel: true }),
    el('div', { class: 'project-mini-foot' },
      el('span', {}, icon('bulb', 13), ` ${project.idea_count}`),
      el('span', {}, icon('users', 13), ` ${project.member_count}`),
      due !== null
        ? el('span', { class: due < 0 ? 'danger-text' : due <= 7 ? 'warn-text' : '' },
          icon('calendar', 13), ` ${fmtDate(project.due_date, { short: true })}`)
        : null));
}

function taskRow(task) {
  const due = task.due_date ? daysBetween(task.due_date) : null;
  const done = el('button', {
    class: 'task-check', type: 'button', title: 'Concluir tarefa',
    onclick: async (event) => {
      const button = event.currentTarget;
      setBusy(button, true);
      try {
        await moveTask(task.id, 'concluido');
        toast('Tarefa concluída.', 'ok');
        refresh();
      } catch (err) {
        toast(err.message, 'danger');
        setBusy(button, false);
      }
    },
  }, icon('check', 14));
  return el('div', { class: 'task-row' },
    done,
    el('div', { class: 'task-row-main' },
      el('strong', { text: task.title }),
      el('small', { text: task.project_name })),
    el('span', { class: `priority ${task.priority}`, text: TASK_PRIORITY[task.priority] }),
    due !== null
      ? el('span', { class: `due ${due < 0 ? 'late' : due <= 3 ? 'soon' : ''}`, text: due < 0 ? `${Math.abs(due)}d atrasada` : due === 0 ? 'hoje' : `em ${due}d` })
      : null,
    task.assignee_name ? avatar(task.assignee_name, 24) : null);
}
