/* ============================================================================
   Dados de demonstração — permitem explorar a plataforma sem cadastrar nada
   além da conta local. Podem ser removidos em Configurações › Dados.
   ========================================================================== */

import { queryAll, queryOne, run, tx, persist } from './db.js';
import { uid, nowISO } from './util.js';
import { hashPassword, randomHex } from './crypto.js';
import { getMeta, setMeta } from './meta.js';
import { audit } from './audit.js';

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

export function demoLoaded() {
  return getMeta('demo_seeded', '') === '1';
}

export async function loadDemoData(owner) {
  if (!owner) throw new Error('É preciso estar autenticado.');
  if (demoLoaded()) return { skipped: true };

  const passwordHash = await hashPassword(randomHex(24));
  const people = [
    { id: uid(), name: 'Ana Ribeiro', email: 'ana.ribeiro@exemplo.test', role: 'member' },
    { id: uid(), name: 'Bruno Lima', email: 'bruno.lima@exemplo.test', role: 'member' },
    { id: uid(), name: 'Carla Souza', email: 'carla.souza@exemplo.test', role: 'member' },
    { id: uid(), name: 'Diego Alves', email: 'diego.alves@exemplo.test', role: 'member' },
  ];

  const projects = [
    {
      id: uid(),
      name: 'Horta Comunitária do Bairro',
      description: 'Transformar o terreno ao lado da associação de moradores em uma horta comunitária '
        + 'com compostagem, oficinas abertas e gestão compartilhada entre vizinhos.',
      status: 'ativo',
      visibility: 'interno',
      tags: ['comunidade', 'sustentabilidade', 'voluntariado'],
      start: daysAgo(24),
      due: daysAhead(64),
      members: [people[0].id, people[1].id, people[3].id],
    },
    {
      id: uid(),
      name: 'Caronas Solidárias',
      description: 'Aplicativo leve para organizar caronas entre colegas de trabalho e vizinhos, '
        + 'com foco em segurança, rotas recorrentes e redução de emissões.',
      status: 'em_analise',
      visibility: 'privado',
      tags: ['mobilidade', 'produto', 'impacto'],
      start: daysAgo(12),
      due: daysAhead(120),
      members: [people[1].id, people[2].id],
    },
    {
      id: uid(),
      name: 'Mutirão de Reforma da Escola',
      description: 'Projeto concluído de revitalização da quadra e da biblioteca da escola municipal, '
        + 'com escala de voluntários, doações e prestação de contas aberta.',
      status: 'concluido',
      visibility: 'publico',
      tags: ['educação', 'voluntariado'],
      start: daysAgo(120),
      due: daysAgo(20),
      members: [people[0].id, people[2].id, people[3].id],
    },
  ];

  const ideas = [
    {
      project: 0, author: people[0].id, title: 'Oficinas de compostagem para moradores',
      body: 'Encontros mensais para ensinar a separar resíduos e manter as composteiras. '
        + 'Cada família participante leva uma composteira doméstica simples.',
      category: 'comunidade', status: 'aprovada', impact: 5, effort: 2, created: daysAgo(20),
      votes: [[people[1].id, 1], [people[2].id, 1], [people[3].id, 1]],
      comments: [
        [people[1].id, 'Podemos começar com duas oficinas piloto e medir a adesão.', daysAgo(18)],
        [owner.id, 'Gostei. Vou reservar o espaço da associação para o primeiro encontro.', daysAgo(17)],
      ],
    },
    {
      project: 0, author: people[1].id, title: 'Irrigação com garrafa PET',
      body: 'Sistema de gotejamento de baixo custo usando garrafas PET furadas. Reduz o consumo de água '
        + 'e permite que cada canteiro tenha autonomia por alguns dias.',
      category: 'tecnologia', status: 'em_discussao', impact: 4, effort: 2, created: daysAgo(15),
      votes: [[people[0].id, 1], [people[3].id, 1]],
      comments: [[people[2].id, 'Já testei em casa e funciona bem. Posso trazer o modelo.', daysAgo(14)]],
    },
    {
      project: 0, author: people[3].id, title: 'Feira de trocas mensal',
      body: 'Um sábado por mês para trocar mudas, ferramentas, livros e alimentos sem dinheiro envolvido. '
        + 'A ideia é fortalecer os laços entre as famílias.',
      category: 'comunidade', status: 'nova', impact: 4, effort: 1, created: daysAgo(6),
      votes: [[people[0].id, 1]],
      comments: [],
    },
    {
      project: 0, author: owner.id, title: 'Painel solar para o galpão',
      body: 'Instalar painéis fotovoltaicos para abastecer a bomba de água e a iluminação do galpão. '
        + 'Precisamos avaliar custo, retorno e linhas de financiamento coletivo.',
      category: 'tecnologia', status: 'aprovada', impact: 5, effort: 5, created: daysAgo(9),
      votes: [[people[0].id, 1], [people[1].id, 1], [people[2].id, 1]],
      comments: [[people[1].id, 'Posso pedir orçamento com duas empresas da região.', daysAgo(8)]],
    },
    {
      project: 1, author: people[1].id, title: 'Verificação por e-mail institucional',
      body: 'Permitir cadastro apenas com e-mails de empresas parceiras ou universidades, reduzindo '
        + 'o risco de perfis falsos e aumentando a confiança entre os participantes.',
      category: 'produto', status: 'em_discussao', impact: 5, effort: 3, created: daysAgo(10),
      votes: [[people[2].id, 1], [owner.id, 1]],
      comments: [[people[2].id, 'Precisamos pensar em quem não tem e-mail institucional.', daysAgo(9)]],
    },
    {
      project: 1, author: people[2].id, title: 'Rotas recorrentes e horários fixos',
      body: 'Cadastrar uma rota recorrente (casa → trabalho) com horário e dias da semana. '
        + 'O app sugere matches com quem faz o mesmo trajeto.',
      category: 'produto', status: 'aprovada', impact: 4, effort: 3, created: daysAgo(8),
      votes: [[people[1].id, 1], [owner.id, 1]],
      comments: [],
    },
    {
      project: 1, author: people[1].id, title: 'Painel de impacto de CO₂ evitado',
      body: 'Estimar emissões evitadas por carona e exibir um painel coletivo. '
        + 'Pode virar um diferencial para parcerias com empresas.',
      category: 'produto', status: 'nova', impact: 3, effort: 2, created: daysAgo(3),
      votes: [], comments: [],
    },
    {
      project: 2, author: people[3].id, title: 'Vaquinha transparente de materiais',
      body: 'Lista pública de materiais, valores arrecadados e notas fiscais. '
        + 'Cada doação recebe um recibo e um código de acompanhamento.',
      category: 'processo', status: 'concluida', impact: 5, effort: 2, created: daysAgo(100),
      votes: [[people[0].id, 1], [people[2].id, 1]],
      comments: [[people[2].id, 'A prestação de contas foi elogiada pela direção da escola.', daysAgo(30)]],
    },
    {
      project: 2, author: people[0].id, title: 'Escala de voluntários por turno',
      body: 'Organizar os voluntários em turnos de 3 horas, com um coordenador por turno e '
        + 'checklist de segurança.',
      category: 'processo', status: 'concluida', impact: 4, effort: 1, created: daysAgo(95),
      votes: [[people[3].id, 1]],
      comments: [],
    },
    {
      project: 2, author: people[2].id, title: 'Galeria antes e depois',
      body: 'Registrar fotos da quadra e da biblioteca antes e depois da reforma. '
        + 'Com autorização de imagem de todos que aparecem.',
      category: 'design', status: 'concluida', impact: 4, effort: 2, created: daysAgo(90),
      votes: [[people[0].id, 1], [people[1].id, 1]],
      comments: [],
    },
  ];

  const tasks = [
    [0, 'Mapear espaço e testar o solo', 'fazendo', 'alta', people[0].id, daysAhead(4), 1],
    [0, 'Comprar sementes e mudas', 'a_fazer', 'media', people[1].id, daysAhead(10), 2],
    [0, 'Montar duas composteiras piloto', 'revisao', 'alta', people[3].id, daysAhead(2), 1],
    [0, 'Criar grupo de avisos no mensageiro', 'concluido', 'baixa', owner.id, daysAgo(5), 1],
    [1, 'Entrevistar 10 possíveis usuários', 'fazendo', 'critica', people[1].id, daysAhead(7), 1],
    [1, 'Desenhar fluxo de cadastro verificado', 'a_fazer', 'alta', people[2].id, daysAhead(14), 2],
    [1, 'Pesquisar requisitos da LGPD para localização', 'a_fazer', 'alta', owner.id, daysAhead(9), 3],
    [2, 'Fechar prestação de contas final', 'concluido', 'media', people[0].id, daysAgo(22), 1],
  ];

  const counts = { users: people.length, projects: projects.length, ideas: ideas.length, tasks: tasks.length };

  tx(() => {
    const now = nowISO();
    for (const person of people) {
      run(
        `INSERT INTO users (id, email, display_name, password_hash, role, status, is_demo,
                            created_at, updated_at)
         VALUES (?,?,?,?,?,'active',1,?,?)`,
        [person.id, person.email, person.name, passwordHash, person.role, daysAgo(140), now],
      );
    }

    for (const project of projects) {
      run(
        `INSERT INTO projects (id, name, description, status, visibility, owner_id, tags,
                               start_date, due_date, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [project.id, project.name, project.description, project.status, project.visibility,
          owner.id, JSON.stringify(project.tags), project.start, project.due,
          daysAgo(30), daysAgo(1)],
      );
      run(
        `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at, status)
         VALUES (?,?,'coordenador',?,?,'ativo')`,
        [project.id, owner.id, owner.id, daysAgo(30)],
      );
      for (const memberId of project.members) {
        run(
          `INSERT OR IGNORE INTO project_members (project_id, user_id, role, invited_by, joined_at, status)
           VALUES (?,?,'colaborador',?,?,'ativo')`,
          [project.id, memberId, owner.id, daysAgo(25)],
        );
      }
    }

    const ideaIds = [];
    for (const idea of ideas) {
      const id = uid();
      ideaIds.push(id);
      const project = projects[idea.project];
      run(
        `INSERT INTO ideas (id, project_id, author_id, title, body, category, status, impact,
                            effort, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, project.id, idea.author, idea.title, idea.body, idea.category, idea.status,
          idea.impact, idea.effort, idea.created, idea.created],
      );
      for (const [userId, value] of idea.votes) {
        run(
          'INSERT OR IGNORE INTO idea_votes (idea_id, user_id, value, created_at) VALUES (?,?,?,?)',
          [id, userId, value, idea.created],
        );
      }
      for (const [authorId, body, when] of idea.comments) {
        run(
          `INSERT INTO comments (id, idea_id, author_id, body, created_at)
           VALUES (?,?,?,?,?)`,
          [uid(), id, authorId, body, when],
        );
      }
    }

    let position = 1;
    for (const [projectIndex, title, status, priority, assignee, due, pos] of tasks) {
      run(
        `INSERT INTO tasks (id, project_id, title, description, status, priority, assignee_id,
                            due_date, position, created_at, updated_at)
         VALUES (?,?,?,'',?,?,?,?,?,?,?)`,
        [uid(), projects[projectIndex].id, title, status, priority, assignee,
          due, pos || position++, daysAgo(10), daysAgo(2)],
      );
    }
  });

  setMeta('demo_seeded', '1');
  setMeta('demo_seeded_at', nowISO());
  setMeta('demo_project_ids', JSON.stringify(projects.map((p) => p.id)));
  persist();

  await audit({
    action: 'demo.seed',
    entityType: 'sistema',
    entityId: 'demo',
    legalBasis: 'consentimento',
    purpose: 'prestacao_servico',
    dataCategories: ['conteudo', 'metadados'],
    detail: { ...counts, observacao: 'dados fictícios para demonstração' },
  });

  return counts;
}

export async function removeDemoData() {
  const demoUsers = queryAll("SELECT id FROM users WHERE is_demo = 1");
  const demoIds = demoUsers.map((u) => u.id);
  const projectIds = JSON.parse(getMeta('demo_project_ids', '[]') || '[]');
  let removed = 0;

  tx(() => {
    if (projectIds.length) {
      const projectMarks = projectIds.map(() => '?').join(',');
      run(`DELETE FROM projects WHERE id IN (${projectMarks})`, projectIds);
    }
    if (demoIds.length) {
      const placeholders = demoIds.map(() => '?').join(',');
      run(`DELETE FROM ideas WHERE author_id IN (${placeholders})`, demoIds);
      run(`DELETE FROM comments WHERE author_id IN (${placeholders})`, demoIds);
      run(`DELETE FROM idea_votes WHERE user_id IN (${placeholders})`, demoIds);
      run(`DELETE FROM project_members WHERE user_id IN (${placeholders})`, demoIds);
      run(`UPDATE tasks SET assignee_id = NULL WHERE assignee_id IN (${placeholders})`, demoIds);
      run(`DELETE FROM sessions WHERE user_id IN (${placeholders})`, demoIds);
      removed = run(`DELETE FROM users WHERE id IN (${placeholders})`, demoIds);
    }
  });

  setMeta('demo_seeded', '0');
  setMeta('demo_project_ids', '[]');
  persist();
  await audit({
    action: 'data.reset',
    entityType: 'sistema',
    entityId: 'demo',
    legalBasis: 'consentimento',
    purpose: 'prestacao_servico',
    detail: { usuarios_demo_removidos: removed, projetos_demo_removidos: projectIds.length },
  });
  return { removed, projects: projectIds.length };
}

