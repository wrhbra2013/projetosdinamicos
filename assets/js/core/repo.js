/* ============================================================================
   Repositórios — projetos, equipe, ideias, comentários, votos e tarefas.
   Toda escrita gera auditoria com base legal e finalidade explícitas.
   ========================================================================== */

import { queryAll, queryOne, scalar, run, tx, persist } from './db.js';
import { nowISO, uid, parseTags } from './util.js';
import { audit } from './audit.js';
import { currentUser, canProject, canEditIdea, projectRole } from './auth.js';

/* ------------------------------- Projetos -------------------------------- */
export const PROJECT_STATUS = {
  rascunho: 'Rascunho',
  em_analise: 'Em análise',
  ativo: 'Ativo',
  pausado: 'Pausado',
  concluido: 'Concluído',
  arquivado: 'Arquivado',
};

export const PROJECT_VISIBILITY = {
  privado: 'Privado',
  interno: 'Interno',
  publico: 'Público',
};

export const PROJECT_ROLES = {
  coordenador: 'Coordenador',
  colaborador: 'Colaborador',
  observador: 'Observador',
};

export function getProject(id) {
  return queryOne(
    `SELECT p.*, u.display_name AS owner_name,
            (SELECT COUNT(*) FROM project_members m
              WHERE m.project_id = p.id AND m.status = 'ativo') AS member_count
       FROM projects p JOIN users u ON u.id = p.owner_id
      WHERE p.id = ?`,
    [id],
  );
}

export function listProjects({ user = currentUser(), includeArchived = false, search = '' } = {}) {
  if (!user) return [];
  const where = ['p.deleted_at IS NULL'];
  const params = [user.id, user.id, user.id];
  if (!includeArchived) where.push("p.status <> 'arquivado'");
  if (search) {
    where.push('(p.name LIKE ? OR p.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const rows = queryAll(
    `SELECT v.*, u.display_name AS owner_name,
            (SELECT m.role FROM project_members m
              WHERE m.project_id = v.id AND m.user_id = ? AND m.status = 'ativo') AS member_role
       FROM v_project_stats v
       JOIN users u ON u.id = v.owner_id
      WHERE ${where.join(' AND ')}
        AND (v.owner_id = ?
             OR EXISTS (SELECT 1 FROM project_members m
                         WHERE m.project_id = v.id AND m.user_id = ? AND m.status = 'ativo')
             OR v.visibility IN ('publico','interno'))
      ORDER BY v.updated_at DESC`,
    params,
  );
  return rows.map((row) => ({
    ...row,
    my_role: row.owner_id === user.id ? 'coordenador' : (row.member_role || 'observador'),
    tags: parseTags(row.tags),
  }));
}

export async function createProject({
  name, description = '', visibility = 'privado', status = 'rascunho',
  tags = [], startDate = null, dueDate = null,
}) {
  const user = currentUser();
  if (!user) throw new Error('Faça login para criar projetos.');
  const cleanName = String(name || '').trim();
  if (cleanName.length < 3) throw new Error('O nome do projeto deve ter ao menos 3 caracteres.');
  const id = uid();
  const now = nowISO();
  const tagList = Array.isArray(tags) ? tags.filter(Boolean).slice(0, 8) : [];
  tx(() => {
    run(
      `INSERT INTO projects (id, name, description, status, visibility, owner_id, tags,
                             start_date, due_date, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, cleanName, String(description).slice(0, 4000), status, visibility, user.id,
        JSON.stringify(tagList), startDate || null, dueDate || null, now, now],
    );
    run(
      `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at, status)
       VALUES (?,?,'coordenador',?,?,'ativo')`,
      [id, user.id, user.id, now],
    );
  });
  await audit({
    action: 'project.create',
    entityType: 'project',
    entityId: id,
    projectId: id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    dataCategories: ['conteudo', 'metadados'],
    detail: { nome: cleanName, visibilidade: visibility, status },
  });
  return getProject(id);
}

const PROJECT_FIELDS = ['name', 'description', 'status', 'visibility', 'tags', 'start_date', 'due_date'];

export async function updateProject(id, fields) {
  const user = currentUser();
  const before = getProject(id);
  if (!before) throw new Error('Projeto não encontrado.');
  if (!canProject(id, 'edit')) throw new Error('Você não tem permissão para editar este projeto.');

  const changes = {};
  const values = [];
  const sets = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!PROJECT_FIELDS.includes(key)) continue;
    if (key === 'tags') {
      const tags = Array.isArray(value) ? value : parseTags(value);
      sets.push('tags = ?'); values.push(JSON.stringify(tags));
      changes.tags = tags;
    } else if (key === 'name') {
      const name = String(value || '').trim();
      if (name.length < 3) throw new Error('Nome do projeto muito curto.');
      sets.push('name = ?'); values.push(name); changes.name = name;
    } else {
      sets.push(`${key} = ?`); values.push(value); changes[key] = value;
    }
  }
  if (!sets.length) return before;
  sets.push('updated_at = ?'); values.push(nowISO());
  run(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
  await audit({
    action: 'project.update',
    entityType: 'project',
    entityId: id,
    projectId: id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    dataCategories: ['conteudo', 'metadados'],
    detail: { campos: Object.keys(changes), nome: changes.name || before.name },
  });
  persist();
  return getProject(id);
}

export async function archiveProject(id, archived = true) {
  if (!canProject(id, 'manage')) throw new Error('Apenas coordenadores podem arquivar projetos.');
  const now = nowISO();
  run(
    "UPDATE projects SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?",
    [archived ? 'arquivado' : 'ativo', archived ? now : null, now, id],
  );
  await audit({
    action: archived ? 'project.archive' : 'project.restore',
    entityType: 'project',
    entityId: id,
    projectId: id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    detail: { arquivado: archived },
  });
  persist();
}

export async function deleteProject(id) {
  if (!canProject(id, 'manage')) throw new Error('Apenas coordenadores podem excluir projetos.');
  const now = nowISO();
  run('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
  await audit({
    action: 'project.delete',
    entityType: 'project',
    entityId: id,
    projectId: id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    detail: { exclusao_logica: true, retencao_dias: 30 },
  });
  persist();
}

/* -------------------------------- Equipe --------------------------------- */
export function projectMembers(projectId) {
  return queryAll(
    `SELECT m.*, u.display_name, u.email, u.role AS account_role
       FROM project_members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = ? AND u.status = 'active'
      ORDER BY CASE m.role WHEN 'coordenador' THEN 0 WHEN 'colaborador' THEN 1 ELSE 2 END,
               u.display_name COLLATE NOCASE`,
    [projectId],
  );
}

export async function addMember(projectId, email, role = 'colaborador') {
  if (!canProject(projectId, 'manage')) throw new Error('Apenas coordenadores podem adicionar membros.');
  if (!PROJECT_ROLES[role]) throw new Error('Papel inválido.');
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = queryOne("SELECT * FROM users WHERE email = ? AND status = 'active'", [cleanEmail]);
  if (!user) throw new Error('Não encontramos uma conta ativa com este e-mail.');
  const existing = queryOne('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, user.id]);
  if (existing) throw new Error('Esta pessoa já participa do projeto.');
  run(
    `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at, status)
     VALUES (?,?,?,?,?,'ativo')`,
    [projectId, user.id, role, currentUser().id, nowISO()],
  );
  run('UPDATE projects SET updated_at = ? WHERE id = ?', [nowISO(), projectId]);
  await audit({
    action: 'member.add',
    entityType: 'project_member',
    entityId: `${projectId}:${user.id}`,
    projectId,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    dataCategories: ['identificacao', 'contato'],
    detail: { membro: user.display_name, papel: role },
  });
  persist();
  return projectMembers(projectId);
}

export async function changeMemberRole(projectId, userId, role) {
  if (!canProject(projectId, 'manage')) throw new Error('Apenas coordenadores podem alterar papéis.');
  if (!PROJECT_ROLES[role]) throw new Error('Papel inválido.');
  const project = getProject(projectId);
  if (project.owner_id === userId) throw new Error('O papel do proprietário não pode ser alterado.');
  const before = queryOne('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, userId]);
  if (!before) throw new Error('Membro não encontrado.');
  run('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?', [role, projectId, userId]);
  run('UPDATE projects SET updated_at = ? WHERE id = ?', [nowISO(), projectId]);
  await audit({
    action: 'member.role_change',
    entityType: 'project_member',
    entityId: `${projectId}:${userId}`,
    projectId,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    detail: { de: before.role, para: role },
  });
  persist();
}

export async function removeMember(projectId, userId) {
  if (!canProject(projectId, 'manage')) throw new Error('Apenas coordenadores podem remover membros.');
  const project = getProject(projectId);
  if (project.owner_id === userId) throw new Error('O proprietário do projeto não pode ser removido.');
  run("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", [projectId, userId]);
  run('UPDATE projects SET updated_at = ? WHERE id = ?', [nowISO(), projectId]);
  await audit({
    action: 'member.remove',
    entityType: 'project_member',
    entityId: `${projectId}:${userId}`,
    projectId,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    detail: { membro_id: userId },
  });
  persist();
}

/* -------------------------------- Ideias --------------------------------- */
export const IDEA_STATUS = {
  nova: 'Nova',
  em_discussao: 'Em discussão',
  aprovada: 'Aprovada',
  em_execucao: 'Em execução',
  concluida: 'Concluída',
  arquivada: 'Arquivada',
};

export const IDEA_CATEGORY = {
  geral: 'Geral',
  produto: 'Produto',
  processo: 'Processo',
  tecnologia: 'Tecnologia',
  design: 'Design',
  pesquisa: 'Pesquisa',
  comunidade: 'Comunidade',
  impacto: 'Impacto',
};

export function listIdeas({ projectId, search = '', status = '', category = '', sort = 'score' } = {}) {
  if (!projectId) return [];
  const where = ['i.project_id = ?', 'i.deleted_at IS NULL'];
  const params = [currentUser()?.id || '', projectId];
  if (search) {
    where.push('(i.title LIKE ? OR i.body LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status) { where.push('i.status = ?'); params.push(status); }
  if (category) { where.push('i.category = ?'); params.push(category); }
  const order = {
    score: 'score DESC, votes_up DESC, i.created_at DESC',
    recent: 'i.created_at DESC',
    impact: 'i.impact DESC, score DESC',
    effort: 'i.effort ASC, score DESC',
    title: 'i.title COLLATE NOCASE ASC',
  }[sort] || 'score DESC, i.created_at DESC';
  return queryAll(
    `SELECT v.*, u.display_name AS author_name, u.email AS author_email,
            (SELECT value FROM idea_votes WHERE idea_id = v.id AND user_id = ?) AS my_vote
       FROM v_idea_scores v JOIN users u ON u.id = v.author_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}`,
    params,
  );
}

export function getIdea(id) {
  return queryOne(
    `SELECT v.*, u.display_name AS author_name, u.email AS author_email,
            (SELECT value FROM idea_votes WHERE idea_id = v.id AND user_id = ?) AS my_vote
       FROM v_idea_scores v JOIN users u ON u.id = v.author_id
      WHERE v.id = ?`,
    [currentUser()?.id || '', id],
  );
}

export async function createIdea({
  projectId, title, body = '', category = 'geral', impact = 3, effort = 3,
}) {
  if (!canProject(projectId, 'edit')) throw new Error('Você não pode propor ideias neste projeto.');
  const cleanTitle = String(title || '').trim();
  if (cleanTitle.length < 4) throw new Error('O título da ideia deve ter ao menos 4 caracteres.');
  if (!IDEA_CATEGORY[category]) category = 'geral';
  const id = uid();
  const now = nowISO();
  run(
    `INSERT INTO ideas (id, project_id, author_id, title, body, category, status, impact,
                        effort, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'nova',?,?,?,?)`,
    [id, projectId, currentUser().id, cleanTitle, String(body).slice(0, 20_000), category,
      Number(impact) || 3, Number(effort) || 3, now, now],
  );
  run('UPDATE projects SET updated_at = ? WHERE id = ?', [now, projectId]);
  await audit({
    action: 'idea.create',
    entityType: 'idea',
    entityId: id,
    projectId,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    dataCategories: ['conteudo', 'metadados'],
    detail: { titulo: cleanTitle, categoria: category, impacto: impact, esforco: effort },
  });
  persist();
  return getIdea(id);
}

export async function updateIdea(id, fields) {
  const before = getIdea(id);
  if (!before) throw new Error('Ideia não encontrada.');
  if (!canEditIdea(before)) throw new Error('Você não pode editar esta ideia.');
  const allowed = ['title', 'body', 'category', 'impact', 'effort'];
  const sets = [];
  const values = [];
  const changed = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.includes(key)) continue;
    if (key === 'title') {
      const title = String(value || '').trim();
      if (title.length < 4) throw new Error('Título muito curto.');
      sets.push('title = ?'); values.push(title); changed.title = title;
    } else if (key === 'body') {
      sets.push('body = ?'); values.push(String(value).slice(0, 20_000)); changed.body = true;
    } else if (key === 'category') {
      if (!IDEA_CATEGORY[value]) continue;
      sets.push('category = ?'); values.push(value); changed.category = value;
    } else {
      sets.push(`${key} = ?`); values.push(Number(value)); changed[key] = Number(value);
    }
  }
  if (!sets.length) return before;
  sets.push('updated_at = ?'); values.push(nowISO());
  run(`UPDATE ideas SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
  await audit({
    action: 'idea.update',
    entityType: 'idea',
    entityId: id,
    projectId: before.project_id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    dataCategories: ['conteudo'],
    detail: { campos: Object.keys(changed) },
  });
  persist();
  return getIdea(id);
}

export async function setIdeaStatus(id, status) {
  if (!IDEA_STATUS[status]) throw new Error('Status inválido.');
  const before = getIdea(id);
  if (!before) throw new Error('Ideia não encontrada.');
  if (!canProject(before.project_id, 'edit')) throw new Error('Sem permissão para alterar o status.');
  run('UPDATE ideas SET status = ?, updated_at = ? WHERE id = ?', [status, nowISO(), id]);
  await audit({
    action: 'idea.status',
    entityType: 'idea',
    entityId: id,
    projectId: before.project_id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    detail: { de: before.status, para: status, titulo: before.title },
  });
  persist();
  return getIdea(id);
}

export async function deleteIdea(id) {
  const before = getIdea(id);
  if (!before) throw new Error('Ideia não encontrada.');
  if (!canEditIdea(before)) throw new Error('Sem permissão para excluir esta ideia.');
  run('UPDATE ideas SET deleted_at = ?, updated_at = ? WHERE id = ?', [nowISO(), nowISO(), id]);
  await audit({
    action: 'idea.delete',
    entityType: 'idea',
    entityId: id,
    projectId: before.project_id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    detail: { titulo: before.title, exclusao_logica: true },
  });
  persist();
}

export async function voteIdea(ideaId, value) {
  const idea = getIdea(ideaId);
  if (!idea) throw new Error('Ideia não encontrada.');
  if (!canProject(idea.project_id, 'vote')) throw new Error('Você não pode votar neste projeto.');
  const user = currentUser();
  const numeric = Number(value);
  if (numeric === 0) {
    run('DELETE FROM idea_votes WHERE idea_id = ? AND user_id = ?', [ideaId, user.id]);
  } else if (numeric === 1 || numeric === -1) {
    run(
      `INSERT INTO idea_votes (idea_id, user_id, value, created_at) VALUES (?,?,?,?)
       ON CONFLICT(idea_id, user_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
      [ideaId, user.id, numeric, nowISO()],
    );
  } else {
    throw new Error('Voto inválido.');
  }
  await audit({
    action: 'idea.vote',
    entityType: 'idea',
    entityId: ideaId,
    projectId: idea.project_id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    detail: { voto: numeric, titulo: idea.title },
  });
  persist();
  return getIdea(ideaId);
}

/* ------------------------------- Comentários ------------------------------ */
export function listComments(ideaId) {
  return queryAll(
    `SELECT c.*, u.display_name AS author_name,
            (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id AND r.deleted_at IS NULL) AS reply_count
       FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.idea_id = ? AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC`,
    [ideaId],
  );
}

export async function addComment(ideaId, body, parentId = null) {
  const idea = getIdea(ideaId);
  if (!idea) throw new Error('Ideia não encontrada.');
  if (!canProject(idea.project_id, 'comment')) throw new Error('Você não pode comentar neste projeto.');
  const text = String(body || '').trim();
  if (text.length < 1) throw new Error('Escreva um comentário.');
  if (text.length > 8000) throw new Error('Comentário muito longo.');
  const id = uid();
  run(
    `INSERT INTO comments (id, idea_id, author_id, body, parent_id, created_at)
     VALUES (?,?,?,?,?,?)`,
    [id, ideaId, currentUser().id, text, parentId || null, nowISO()],
  );
  run('UPDATE ideas SET updated_at = ? WHERE id = ?', [nowISO(), ideaId]);
  await audit({
    action: 'comment.create',
    entityType: 'comment',
    entityId: id,
    projectId: idea.project_id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    dataCategories: ['conteudo'],
    detail: { ideia: idea.title, resposta: Boolean(parentId) },
  });
  persist();
  return id;
}

export async function deleteComment(id) {
  const comment = queryOne('SELECT * FROM comments WHERE id = ?', [id]);
  if (!comment) throw new Error('Comentário não encontrado.');
  const idea = getIdea(comment.idea_id);
  if (comment.author_id !== currentUser()?.id && !canProject(idea.project_id, 'edit')) {
    throw new Error('Sem permissão para excluir este comentário.');
  }
  run('UPDATE comments SET deleted_at = ? WHERE id = ?', [nowISO(), id]);
  await audit({
    action: 'comment.delete',
    entityType: 'comment',
    entityId: id,
    projectId: idea.project_id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    detail: { exclusao_logica: true },
  });
  persist();
}

/* -------------------------------- Tarefas -------------------------------- */
export const TASK_STATUS = {
  a_fazer: 'A fazer',
  fazendo: 'Em andamento',
  revisao: 'Em revisão',
  concluido: 'Concluído',
};

export const TASK_PRIORITY = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  critica: 'Crítica',
};

export function listTasks({ projectId, assigneeId = '', status = '' } = {}) {
  const where = ['t.project_id = ?', 't.deleted_at IS NULL'];
  const params = [projectId];
  if (assigneeId) { where.push('t.assignee_id = ?'); params.push(assigneeId); }
  if (status) { where.push('t.status = ?'); params.push(status); }
  return queryAll(
    `SELECT t.*, u.display_name AS assignee_name, i.title AS idea_title
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       LEFT JOIN ideas i ON i.id = t.idea_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.position ASC, t.created_at ASC`,
    params,
  );
}

export function getTask(id) {
  return queryOne(
    `SELECT t.*, u.display_name AS assignee_name FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id WHERE t.id = ?`,
    [id],
  );
}

export async function createTask({
  projectId, title, description = '', status = 'a_fazer', priority = 'media',
  assigneeId = null, dueDate = null, ideaId = null,
}) {
  if (!canProject(projectId, 'createTask')) throw new Error('Sem permissão para criar tarefas.');
  const cleanTitle = String(title || '').trim();
  if (cleanTitle.length < 3) throw new Error('Título da tarefa muito curto.');
  const position = (scalar('SELECT MAX(position) FROM tasks WHERE project_id = ? AND status = ?', [projectId, status]) || 0) + 1;
  const id = uid();
  const now = nowISO();
  run(
    `INSERT INTO tasks (id, project_id, idea_id, title, description, status, priority,
                        assignee_id, due_date, position, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, projectId, ideaId, cleanTitle, String(description).slice(0, 8000), status, priority,
      assigneeId, dueDate || null, position, now, now],
  );
  run('UPDATE projects SET updated_at = ? WHERE id = ?', [now, projectId]);
  await audit({
    action: 'task.create',
    entityType: 'task',
    entityId: id,
    projectId,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    dataCategories: ['conteudo', 'metadados'],
    detail: { titulo: cleanTitle, status, prioridade: priority },
  });
  persist();
  return getTask(id);
}

export async function updateTask(id, fields) {
  const before = getTask(id);
  if (!before) throw new Error('Tarefa não encontrada.');
  if (!canProject(before.project_id, 'manageTask')) throw new Error('Sem permissão para editar tarefas.');
  const allowed = ['title', 'description', 'status', 'priority', 'assignee_id', 'due_date', 'idea_id'];
  const sets = [];
  const values = [];
  const changed = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.includes(key)) continue;
    sets.push(`${key} = ?`); values.push(value === '' ? null : value); changed.push(key);
  }
  if (!sets.length) return before;
  sets.push('updated_at = ?'); values.push(nowISO());
  run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
  await audit({
    action: 'task.update',
    entityType: 'task',
    entityId: id,
    projectId: before.project_id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    detail: { campos: changed },
  });
  persist();
  return getTask(id);
}

export async function moveTask(id, status, position = null) {
  const before = getTask(id);
  if (!before) throw new Error('Tarefa não encontrada.');
  if (!canProject(before.project_id, 'manageTask')) throw new Error('Sem permissão para mover tarefas.');
  if (!TASK_STATUS[status]) throw new Error('Status inválido.');
  const pos = position ?? (scalar('SELECT MAX(position) FROM tasks WHERE project_id = ? AND status = ?', [before.project_id, status]) || 0) + 1;
  run('UPDATE tasks SET status = ?, position = ?, updated_at = ? WHERE id = ?', [status, pos, nowISO(), id]);
  await audit({
    action: 'task.move',
    entityType: 'task',
    entityId: id,
    projectId: before.project_id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    detail: { de: before.status, para: status, titulo: before.title },
  });
  persist();
  return getTask(id);
}

export async function deleteTask(id) {
  const before = getTask(id);
  if (!before) throw new Error('Tarefa não encontrada.');
  if (!canProject(before.project_id, 'manageTask')) throw new Error('Sem permissão para excluir tarefas.');
  run('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?', [nowISO(), nowISO(), id]);
  await audit({
    action: 'task.delete',
    entityType: 'task',
    entityId: id,
    projectId: before.project_id,
    legalBasis: 'contrato',
    purpose: 'prestacao_servico',
    detail: { titulo: before.title, exclusao_logica: true },
  });
  persist();
}

/* -------------------------------- Consultas ------------------------------- */
export function allTasks({
  user = currentUser(), assigneeId = '', status = '', priority = '', projectId = '', limit = 200,
} = {}) {
  if (!user) return [];
  const where = ['t.deleted_at IS NULL', 'p.deleted_at IS NULL'];
  const params = [user.id, user.id];
  if (assigneeId) { where.push('t.assignee_id = ?'); params.push(assigneeId); }
  if (status) { where.push('t.status = ?'); params.push(status); }
  if (priority) { where.push('t.priority = ?'); params.push(priority); }
  if (projectId) { where.push('t.project_id = ?'); params.push(projectId); }
  return queryAll(
    `SELECT t.*, p.name AS project_name, u.display_name AS assignee_name
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
      WHERE ${where.join(' AND ')}
        AND (p.owner_id = ? OR EXISTS (SELECT 1 FROM project_members m
              WHERE m.project_id = p.id AND m.user_id = ? AND m.status = 'ativo')
             OR p.visibility IN ('publico','interno'))
      ORDER BY CASE t.priority WHEN 'critica' THEN 0 WHEN 'alta' THEN 1
                               WHEN 'media' THEN 2 ELSE 3 END,
               t.due_date IS NULL, t.due_date ASC
      LIMIT ?`,
    [...params, user.id, user.id, limit],
  );
}

export function myTasks(user = currentUser(), limit = 50) {  if (!user) return [];
  return queryAll(
    `SELECT t.*, p.name AS project_name, u.display_name AS assignee_name
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.assignee_id = ? AND t.deleted_at IS NULL AND p.deleted_at IS NULL
        AND t.status <> 'concluido'
      ORDER BY CASE t.priority WHEN 'critica' THEN 0 WHEN 'alta' THEN 1
                               WHEN 'media' THEN 2 ELSE 3 END,
               t.due_date IS NULL, t.due_date ASC
      LIMIT ?`,
    [user.id, limit],
  );
}

export function recentIdeas(user = currentUser(), limit = 8) {
  if (!user) return [];
  return queryAll(
    `SELECT v.*, u.display_name AS author_name, p.name AS project_name
       FROM v_idea_scores v
       JOIN users u ON u.id = v.author_id
       JOIN projects p ON p.id = v.project_id
      WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL
        AND (p.owner_id = ? OR EXISTS (SELECT 1 FROM project_members m
              WHERE m.project_id = p.id AND m.user_id = ? AND m.status = 'ativo')
             OR p.visibility IN ('publico','interno'))
      ORDER BY v.created_at DESC LIMIT ?`,
    [user.id, user.id, limit],
  );
}

export function allIdeas({
  user = currentUser(), search = '', status = '', category = '', projectId = '', sort = 'recent',
} = {}) {
  if (!user) return [];
  const where = ['v.deleted_at IS NULL', 'p.deleted_at IS NULL'];
  const params = [user.id, user.id];
  if (search) {
    where.push('(v.title LIKE ? OR v.body LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status) { where.push('v.status = ?'); params.push(status); }
  if (category) { where.push('v.category = ?'); params.push(category); }
  if (projectId) { where.push('v.project_id = ?'); params.push(projectId); }
  const order = {
    recent: 'v.created_at DESC',
    score: 'v.score DESC, v.votes_up DESC',
    impact: 'v.impact DESC, v.score DESC',
  }[sort] || 'v.created_at DESC';
  return queryAll(
    `SELECT v.*, u.display_name AS author_name, p.name AS project_name
       FROM v_idea_scores v
       JOIN users u ON u.id = v.author_id
       JOIN projects p ON p.id = v.project_id
      WHERE ${where.join(' AND ')}
        AND (p.owner_id = ? OR EXISTS (SELECT 1 FROM project_members m
              WHERE m.project_id = p.id AND m.user_id = ? AND m.status = 'ativo')
             OR p.visibility IN ('publico','interno'))
      ORDER BY ${order}`,
    [...params, user.id, user.id],
  );
}

export function dashboardStats(user = currentUser()) {
  if (!user) return { projects: 0, ideas: 0, openTasks: 0, dueSoon: 0, members: 0 };
  const projectIds = queryAll(
    `SELECT id FROM projects WHERE deleted_at IS NULL
      AND (owner_id = ? OR EXISTS (SELECT 1 FROM project_members m
            WHERE m.project_id = projects.id AND m.user_id = ? AND m.status = 'ativo')
           OR visibility IN ('publico','interno'))`,
    [user.id, user.id],
  ).map((r) => r.id);
  if (!projectIds.length) return { projects: 0, ideas: 0, openTasks: 0, dueSoon: 0, members: 0 };
  const placeholders = projectIds.map(() => '?').join(',');
  const ideas = scalar(`SELECT COUNT(*) FROM ideas WHERE deleted_at IS NULL AND project_id IN (${placeholders})`, projectIds) || 0;
  const openTasks = scalar(
    `SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND status <> 'concluido' AND project_id IN (${placeholders})`,
    projectIds,
  ) || 0;
  const dueSoon = scalar(
    `SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND status <> 'concluido'
       AND due_date IS NOT NULL AND due_date <= ? AND project_id IN (${placeholders})`,
    [new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), ...projectIds],
  ) || 0;
  const members = scalar(
    `SELECT COUNT(DISTINCT user_id) FROM project_members WHERE project_id IN (${placeholders})`,
    projectIds,
  ) || 0;
  return { projects: projectIds.length, ideas, openTasks, dueSoon, members };
}

export function projectRoleFor(projectId) {
  return projectRole(projectId);
}
