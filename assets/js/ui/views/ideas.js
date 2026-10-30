/* Mural de ideias de todos os projetos acessíveis. */

import { el, truncate, relTime } from '../../core/util.js';
import { allIdeas, listProjects, voteIdea, IDEA_STATUS, IDEA_CATEGORY } from '../../core/repo.js';
import {
  pageHead, statusBadge, badge, emptyState, selectEl, inputEl, toast,
} from '../components.js';
import { icon } from '../icons.js';
import { refresh } from '../router.js';
import { openIdeaDetail } from './project.js';

export function ideasView() {
  const projects = listProjects();
  const list = el('div', { class: 'idea-list' });
  const search = inputEl({ type: 'search', placeholder: 'Buscar em todas as ideias…', class: 'input search-input' });
  const statusSelect = selectEl([
    { value: '', label: 'Todos os status' },
    ...Object.entries(IDEA_STATUS).map(([value, label]) => ({ value, label })),
  ], '');
  const categorySelect = selectEl([
    { value: '', label: 'Todas as categorias' },
    ...Object.entries(IDEA_CATEGORY).map(([value, label]) => ({ value, label })),
  ], '');
  const projectSelect = selectEl([
    { value: '', label: 'Todos os projetos' },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ], '');
  const sortSelect = selectEl([
    { value: 'recent', label: 'Mais recentes' },
    { value: 'score', label: 'Mais votadas' },
    { value: 'impact', label: 'Maior impacto' },
  ], 'recent');

  function draw() {
    const rows = allIdeas({
      search: search.value.trim(),
      status: statusSelect.value,
      category: categorySelect.value,
      projectId: projectSelect.value,
      sort: sortSelect.value,
    });
    if (!rows.length) {
      list.replaceChildren(emptyState({
        iconName: 'bulb',
        title: 'Nenhuma ideia encontrada',
        text: 'Ajuste os filtros ou registre uma ideia em um projeto.',
        action: el('a', { class: 'btn primary', href: '#/projetos' }, 'Ir para projetos'),
      }));
      return;
    }
    list.replaceChildren(...rows.map(ideaCard));
  }

  [search].forEach((node) => node.addEventListener('input', draw));
  [statusSelect, categorySelect, projectSelect, sortSelect].forEach((node) => node.addEventListener('change', draw));

  draw();

  return el('div', { class: 'view-ideas' },
    pageHead({
      eyebrow: 'Colaboração',
      title: 'Ideias',
      subtitle: 'Tudo o que a equipe propôs, em todos os projetos que você acessa.',
    }),
    el('div', { class: 'toolbar' },
      el('div', { class: 'toolbar-left' },
        el('div', { class: 'search-wrap' }, icon('search', 16), search),
        statusSelect,
        categorySelect,
        projectSelect,
        sortSelect)),
    list);
}

function ideaCard(idea) {
  const up = el('button', {
    class: `vote-btn ${idea.my_vote === 1 ? 'active' : ''}`,
    type: 'button', title: 'Votar a favor',
    onclick: async (event) => {
      event.stopPropagation();
      try { await voteIdea(idea.id, idea.my_vote === 1 ? 0 : 1); refresh(); }
      catch (err) { toast(err.message, 'danger'); }
    },
  }, icon('thumbsUp', 15), el('span', { text: String(idea.votes_up) }));
  const down = el('button', {
    class: `vote-btn down ${idea.my_vote === -1 ? 'active' : ''}`,
    type: 'button', title: 'Votar contra',
    onclick: async (event) => {
      event.stopPropagation();
      try { await voteIdea(idea.id, idea.my_vote === -1 ? 0 : -1); refresh(); }
      catch (err) { toast(err.message, 'danger'); }
    },
  }, icon('thumbsDown', 15), el('span', { text: String(idea.votes_down) }));

  return el('article', { class: 'idea-card', onclick: () => openIdeaDetail(idea.id, () => refresh()) },
    el('div', { class: 'idea-vote' }, up, el('strong', { class: 'idea-total', text: String(idea.score) }), down),
    el('div', { class: 'idea-body' },
      el('div', { class: 'idea-head' },
        statusBadge(IDEA_STATUS, idea.status),
        badge(IDEA_CATEGORY[idea.category] || idea.category, 'tag'),
        el('a', { class: 'muted small', href: `#/projeto/${idea.project_id}`, onclick: (e) => e.stopPropagation() },
          idea.project_name)),
      el('h3', { text: idea.title }),
      el('p', { text: truncate(idea.body || 'Sem descrição.', 200) }),
      el('div', { class: 'idea-foot' },
        el('span', { text: `${idea.author_name} · ${relTime(idea.created_at)}` }),
        el('span', {}, icon('message', 14), ` ${idea.comment_count}`),
        el('span', {}, icon('target', 14), ` impacto ${idea.impact}/5`))));
}
