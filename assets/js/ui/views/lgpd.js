/* Central de privacidade e LGPD. */

import {
  el, fmtDate, fmtDateTime, relTime, download, setBusy,
} from '../../core/util.js';
import { currentUser, isAdmin, resetAuthState } from '../../core/auth.js';
import { audit } from '../../core/audit.js';
import {
  complianceReport, activeConsents, consentHistory, recordConsent, revokeConsent,
  CONSENT_PURPOSES, DSR_TYPES, createDsr, listDsr, updateDsr, retentionPolicies,
  applyRetention, processingActivities, updateProcessingActivity, dpoInfo, setDpo,
  listIncidents, createIncident, updateIncident, exportSubjectData, eraseSubjectData,
  POLICY_VERSION, getMeta,
} from '../../core/lgpd.js';
import {
  pageHead, badge, scoreRing, tabs, emptyState, modal, field, inputEl, selectEl,
  textareaEl, checkbox, toast, confirmDialog, sectionTitle, kv, loading,
} from '../components.js';
import { icon } from '../icons.js';
import { refresh } from '../router.js';

const TABS = [
  { id: 'visao', label: 'Visão geral' },
  { id: 'meus-dados', label: 'Meus dados' },
  { id: 'consentimentos', label: 'Consentimentos' },
  { id: 'solicitacoes', label: 'Solicitações' },
  { id: 'retencao', label: 'Retenção' },
  { id: 'inventario', label: 'Inventário' },
  { id: 'incidentes', label: 'Incidentes' },
  { id: 'governanca', label: 'Governança' },
];

export function lgpdView(params, ctx) {
  const user = currentUser();
  const admin = isAdmin();
  let active = TABS.some((t) => t.id === ctx?.query?.get('tab')) ? ctx.query.get('tab') : 'visao';

  const content = el('div', { class: 'lgpd-content' });
  let tabBar = tabs(TABS, active, (id) => { active = id; redraw(); });

  async function redraw() {
    tabBar.replaceWith(tabBar = tabs(TABS, active, (id) => { active = id; redraw(); }));
    content.replaceChildren(loading('Carregando…'));
    try {
      const node = await buildTab(active, user, admin);
      content.replaceChildren(node);
    } catch (err) {
      console.error(err);
      content.replaceChildren(emptyState({ iconName: 'alert', title: 'Não foi possível carregar', text: err.message }));
    }
  }

  const view = el('div', { class: 'view-lgpd' },
    pageHead({
      eyebrow: 'Privacidade',
      title: 'Central de LGPD',
      subtitle: 'Consentimentos, direitos do titular, retenção e conformidade — com evidências auditáveis.',
      actions: el('a', { class: 'btn sm', href: 'privacidade.html', target: '_blank', rel: 'noopener' },
        icon('external', 14), 'Política de Privacidade'),
    }),
    tabBar,
    content);

  redraw();
  return view;
}

async function buildTab(active, user, admin) {
  switch (active) {
    case 'meus-dados': return myDataTab(user);
    case 'consentimentos': return consentsTab(user);
    case 'solicitacoes': return dsrTab(user, admin);
    case 'retencao': return retentionTab(admin);
    case 'inventario': return ropaTab(admin);
    case 'incidentes': return incidentsTab(user, admin);
    case 'governanca': return governanceTab(user, admin);
    default: return overviewTab(user, admin);
  }
}

/* -------------------------------- Visão geral ----------------------------- */
async function overviewTab(user, admin) {
  const report = await complianceReport();
  const dpo = dpoInfo();
  const overdue = listDsr({ actor: user, all: admin })
    .filter((d) => ['recebida', 'em_analise'].includes(d.status) && new Date(d.due_at) < new Date()).length;

  return el('div', { class: 'lgpd-grid' },
    el('section', { class: 'card score-card' },
      scoreRing(report.score, 132),
      el('div', {},
        el('div', { class: 'eyebrow', text: 'Índice de conformidade' }),
        el('h2', { text: report.score >= 80 ? 'Conformidade sólida' : report.score >= 50 ? 'Conformidade em evolução' : 'Atenção necessária' }),
        el('p', { class: 'muted small', text: `${report.checks.filter((c) => c.status === 'ok').length} de ${report.checks.length} controles atendidos. `
          + 'O índice considera LGPD, boas práticas da ANPD e segurança da informação.' }),
        el('div', { class: 'row wrap' },
          el('button', {
            class: 'btn sm', type: 'button',
            onclick: async () => {
              download(`relatorio-lgpd-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({
                _meta: { formato: 'projetos-dinamicos/relatorio-lgpd', versao: 1, gerado_em: new Date().toISOString(), politica: POLICY_VERSION },
                ...report,
              }, null, 2));
              await audit({ action: 'lgpd.report', entityType: 'relatorio', legalBasis: 'obrigacao_legal', purpose: 'cumprimento_legal', detail: { score: report.score } });
              toast('Relatório exportado.', 'ok');
            },
          }, icon('download', 14), 'Exportar relatório'),
          el('a', { class: 'btn sm ghost', href: '#/lgpd?tab=governanca' }, 'Governança')))),

    el('section', { class: 'card' },
      sectionTitle('Checklist de conformidade'),
      el('div', { class: 'check-list full' }, report.checks.map((check) => el('div', { class: `check-item ${check.status}` },
        icon(check.status === 'ok' ? 'check' : check.status === 'atencao' ? 'alert' : 'x', 16),
        el('div', {},
          el('strong', { text: check.label }),
          el('small', { text: check.detail }))))) ),

    el('section', { class: 'card' },
      sectionTitle('Encarregado (DPO)'),
      dpo.name
        ? el('div', {},
          el('p', {}, el('strong', { text: dpo.name })),
          el('p', { class: 'muted small' }, icon('mail', 14), ` ${dpo.email}`),
          el('p', { class: 'muted small', text: `Atualizado em ${fmtDate(dpo.updatedAt)}.` }))
        : el('div', {},
          el('p', { class: 'muted small', text: 'Nenhum encarregado definido. A LGPD (art. 41) exige a indicação de um encarregado pelo tratamento de dados pessoais.' }),
          el('a', { class: 'btn primary sm', href: '#/lgpd?tab=governanca' }, 'Definir encarregado')),
      el('hr', { class: 'divider' }),
      el('div', { class: 'mini-stats' },
        el('div', {}, el('strong', { text: String(listDsr({ actor: user, all: admin }).length) }), el('small', { text: 'solicitações' })),
        el('div', { class: overdue ? 'danger-text' : '' }, el('strong', { text: String(overdue) }), el('small', { text: 'fora do prazo' })),
        el('div', {}, el('strong', { text: getMeta('policy_version', '—') }), el('small', { text: 'versão da política' })))),

    el('section', { class: 'card' },
      sectionTitle('Seus direitos'),
      el('p', { class: 'muted small', text: 'Você pode acessar, corrigir, exportar ou eliminar seus dados a qualquer momento.' }),
      el('div', { class: 'rights-grid' },
        rightLink('Acessar e exportar', 'Portabilidade em JSON', 'download', '#/lgpd?tab=meus-dados'),
        rightLink('Revogar consentimentos', 'Marketing e comunicações', 'x', '#/lgpd?tab=consentimentos'),
        rightLink('Solicitar exclusão', 'Anonimização ou eliminação', 'trash', '#/lgpd?tab=meus-dados'),
        rightLink('Abrir solicitação', 'Prazo legal de 15 dias', 'mail', '#/lgpd?tab=solicitacoes'))),

    el('section', { class: 'card principles' },
      sectionTitle('Princípios aplicados'),
      el('div', { class: 'principle-grid' },
        principle('Finalidade', 'Cada tratamento tem propósito declarado no inventário.'),
        principle('Minimização', 'Coletamos apenas o necessário para operar a plataforma.'),
        principle('Transparência', 'Trilha de auditoria legível e exportável pelo titular.'),
        principle('Segurança', 'PBKDF2, AES-GCM, sessões expiráveis e hash encadeado.'),
        principle('Prestação de contas', 'Evidências verificáveis de cada operação.'),
        principle('Não discriminação', 'Sem perfilamento publicitário ou decisões automatizadas.'))));
}

function rightLink(title, subtitle, iconName, href) {
  return el('a', { class: 'right-card', href },
    el('span', { class: 'right-icon' }, icon(iconName, 18)),
    el('div', {}, el('strong', { text: title }), el('small', { text: subtitle })));
}

function principle(title, text) {
  return el('div', { class: 'principle' }, el('strong', { text: title }), el('p', { class: 'muted small', text }));
}

/* -------------------------------- Meus dados ------------------------------ */
function myDataTab(user) {
  const consents = activeConsents(user.id);
  const marketing = Boolean(consents.marketing && consents.marketing.granted && !consents.marketing.revoked_at);

  return el('div', { class: 'lgpd-grid two' },
    el('section', { class: 'card' },
      sectionTitle('Seus dados nesta instalação'),
      el('div', { class: 'meta-grid' },
        kv('Nome', user.display_name),
        kv('E-mail', user.email),
        kv('Papel', user.role),
        kv('Conta criada em', fmtDate(user.created_at)),
        kv('Fuso horário', user.timezone),
        kv('Marketing', marketing ? 'autorizado' : 'não autorizado')),
      el('p', { class: 'muted small', text: 'Além disso, guardamos as ideias, comentários, votos e tarefas que você criar, '
        + 'os consentimentos que concedeu e os eventos de auditoria das suas ações.' }),
      el('div', { class: 'row wrap' },
        el('button', {
          class: 'btn primary', type: 'button',
          onclick: async (event) => {
            const button = event.currentTarget;
            setBusy(button, true, 'Gerando…');
            try {
              const data = exportSubjectData(user.id);
              download(`meus-dados-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
              await audit({
                action: 'lgpd.export',
                entityType: 'user',
                entityId: user.id,
                legalBasis: 'consentimento',
                purpose: 'atendimento_titular',
                dataCategories: ['identificacao', 'conteudo', 'metadados'],
                detail: { formato: 'json', portabilidade: true },
              });
              toast('Seus dados foram exportados.', 'ok');
            } catch (err) { toast(err.message, 'danger'); }
            finally { setBusy(button, false); }
          },
        }, icon('download', 15), 'Exportar meus dados'),
        el('button', {
          class: 'btn danger-text', type: 'button',
          onclick: () => openEraseAccount(user),
        }, icon('trash', 15), 'Eliminar minha conta'))),

    el('section', { class: 'card' },
      sectionTitle('O que acontece ao eliminar'),
      el('ul', { class: 'bullets' },
        el('li', {}, 'Você escolhe entre anonimizar (preserva a contribuição coletiva, remove sua identidade) ou excluir também o conteúdo que criou.'),
        el('li', {}, 'Consentimentos são revogados e sessões encerradas imediatamente.'),
        el('li', {}, 'Registros de auditoria são mantidos por obrigação legal (LGPD art. 16, II e art. 37), com acesso restrito.'),
        el('li', {}, 'A solicitação e a execução ficam registradas com protocolo e data.')),
      el('div', { class: 'warning-box' },
        icon('alert', 17),
        el('span', { text: 'A exclusão é definitiva. Gere um backup antes, se precisar guardar uma cópia.' }))));
}

function openEraseAccount(user) {
  const mode = selectEl([
    { value: 'anonimizar', label: 'Anonimizar — mantém o conteúdo, remove minha identidade' },
    { value: 'excluir', label: 'Excluir tudo — remove também ideias e comentários que criei' },
  ], 'anonimizar');
  const confirm = inputEl({ placeholder: 'Digite EXCLUIR para confirmar', autocomplete: 'off' });
  const err = el('div', { class: 'form-error hidden' });

  modal({
    title: 'Eliminar minha conta',
    subtitle: 'Esta ação atende ao direito de eliminação (LGPD art. 18, VI).',
    body: el('div', { class: 'form-grid' },
      field('Modo de eliminação', mode),
      field('Confirmação', confirm),
      err,
      el('p', { class: 'muted small', text: 'Se você for o único administrador, promova outra pessoa antes de continuar.' })),
    actions: [
      { label: 'Cancelar', class: 'ghost', onClick: (close) => close() },
      {
        label: 'Eliminar definitivamente',
        class: 'danger-solid',
        busyLabel: 'Eliminando…',
        onClick: async (close) => {
          err.classList.add('hidden');
          try {
            if (confirm.value.trim().toUpperCase() !== 'EXCLUIR') {
              throw new Error('Digite EXCLUIR para confirmar.');
            }
            await eraseSubjectData({
              userId: user.id,
              mode: mode.value,
              performedBy: user.id,
              actor: { id: user.id, label: user.display_name, role: user.role },
            });
            toast('Sua conta foi eliminada. Você será desconectado.', 'ok');
            close();
            resetAuthState();
            setTimeout(() => { location.hash = '#/painel'; location.reload(); }, 700);
          } catch (error) {
            err.textContent = error.message;
            err.classList.remove('hidden');
          }
        },
      },
    ],
  });
}

/* ------------------------------ Consentimentos ---------------------------- */
function consentsTab(user) {
  const latest = activeConsents(user.id);
  const history = consentHistory(user.id);

  const rows = Object.entries(CONSENT_PURPOSES).map(([purpose, label]) => {
    const consent = latest[purpose];
    const granted = Boolean(consent && consent.granted && !consent.revoked_at);
    const essential = ['termos_de_uso', 'politica_privacidade'].includes(purpose);
    return el('tr', {},
      el('td', {}, el('strong', { text: label }), el('small', { class: 'block muted', text: purpose })),
      el('td', {}, badge(granted ? 'Autorizado' : 'Não autorizado', granted ? 'ok' : 'neutral')),
      el('td', { class: 'muted small', text: consent ? `v${consent.policy_version}` : '—' }),
      el('td', { class: 'muted small', text: consent ? fmtDate(consent.created_at) : '—' }),
      el('td', {}, essential
        ? el('span', { class: 'muted small', text: 'Essencial para o serviço' })
        : granted
          ? el('button', {
            class: 'btn sm danger-text', type: 'button',
            onclick: async () => {
              await revokeConsent(user.id, purpose);
              toast('Consentimento revogado.', 'ok');
              refresh();
            },
          }, 'Revogar')
          : el('button', {
            class: 'btn sm', type: 'button',
            onclick: async () => {
              await recordConsent({ userId: user.id, purpose, granted: true, legalBasis: 'consentimento', source: 'central-lgpd' });
              toast('Consentimento registrado.', 'ok');
              refresh();
            },
          }, 'Autorizar')));
  });

  return el('div', { class: 'lgpd-grid' },
    el('section', { class: 'card' },
      sectionTitle('Consentimentos ativos'),
      el('p', { class: 'muted small', text: 'O consentimento deve ser livre, informado e específico (LGPD art. 8º). '
        + 'Você pode revogá-lo a qualquer momento, sem prejuízo ao uso dos recursos essenciais.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'data-table' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'Finalidade' }),
            el('th', { text: 'Situação' }),
            el('th', { text: 'Versão' }),
            el('th', { text: 'Data' }),
            el('th', { text: '' }))),
          el('tbody', {}, rows)))),
    el('section', { class: 'card' },
      sectionTitle('Histórico de consentimentos'),
      el('p', { class: 'muted small', text: 'Cada concessão e revogação é um evento imutável na trilha de auditoria.' }),
      history.length
        ? el('div', { class: 'table-wrap' },
          el('table', { class: 'data-table' },
            el('thead', {}, el('tr', {},
              el('th', { text: 'Finalidade' }),
              el('th', { text: 'Evento' }),
              el('th', { text: 'Quando' }),
              el('th', { text: 'Versão' }))),
            el('tbody', {}, history.map((row) => el('tr', {},
              el('td', { text: CONSENT_PURPOSES[row.purpose] || row.purpose }),
              el('td', {}, badge(row.revoked_at ? 'Revogado' : row.granted ? 'Concedido' : 'Negado', row.revoked_at ? 'warn' : row.granted ? 'ok' : 'neutral')),
              el('td', { class: 'muted small', text: fmtDateTime(row.created_at) }),
              el('td', { class: 'muted small', text: row.policy_version }))))))
        : emptyState({ iconName: 'shield', title: 'Nenhum consentimento registrado' })));
}

/* ------------------------------- Solicitações ----------------------------- */
function dsrTab(user, admin) {
  let showAll = admin;
  const listBox = el('div');

  const type = selectEl(Object.entries(DSR_TYPES).map(([value, label]) => ({ value, label })), 'acesso');
  const details = textareaEl({ rows: 3, placeholder: 'Descreva o que você precisa (opcional).' });

  function draw() {
    const rows = listDsr({ actor: user, all: showAll });
    if (!rows.length) {
      listBox.replaceChildren(emptyState({ iconName: 'mail', title: 'Nenhuma solicitação', text: 'Abra uma solicitação ao lado.' }));
      return;
    }
    listBox.replaceChildren(el('div', { class: 'dsr-list' }, rows.map((row) => {
      const overdue = ['recebida', 'em_analise'].includes(row.status) && new Date(row.due_at) < new Date();
      return el('article', { class: 'dsr-card' },
        el('div', { class: 'dsr-head' },
          el('div', {},
            el('strong', { text: DSR_TYPES[row.request_type] || row.request_type }),
            el('small', { class: 'block muted', text: `Protocolo ${row.protocol}` })),
          badge(row.status, row.status === 'concluida' ? 'ok' : row.status === 'recusada' ? 'danger' : overdue ? 'danger' : 'warn')),
        el('p', { class: 'muted small', text: row.details || 'Sem detalhes adicionais.' }),
        el('div', { class: 'dsr-meta' },
          el('span', {}, icon('calendar', 13), ` Aberta em ${fmtDate(row.created_at)}`),
          el('span', { class: overdue ? 'danger-text' : '' }, icon('clock', 13), ` Prazo ${fmtDate(row.due_at)}${overdue ? ' (atrasada)' : ''}`),
          row.completed_at ? el('span', {}, icon('check', 13), ` Concluída em ${fmtDate(row.completed_at)}`) : null,
          admin ? el('span', {}, icon('users', 13), ` Titular: ${row.subject_email || row.subject_key}`) : null),
        row.response ? el('div', { class: 'response-box' }, el('strong', { text: 'Resposta' }), el('p', { text: row.response })) : null,
        admin && row.status !== 'concluida' && row.status !== 'recusada'
          ? el('button', {
            class: 'btn sm', type: 'button',
            onclick: () => openDsrResponse(row, () => draw()),
          }, 'Responder')
          : null);
    })));
  }

  const createButton = el('button', {
    class: 'btn primary', type: 'button',
    onclick: async (event) => {
      const button = event.currentTarget;
      setBusy(button, true, 'Enviando…');
      try {
        const row = await createDsr({
          userId: user.id,
          email: user.email,
          type: type.value,
          details: details.value,
          origin: 'central-lgpd',
        });
        toast(`Solicitação registrada. Protocolo ${row.protocol}.`, 'ok');
        details.value = '';
        draw();
      } catch (err) { toast(err.message, 'danger'); }
      finally { setBusy(button, false); }
    },
  }, icon('mail', 15), 'Abrir solicitação');

  const allToggle = admin ? checkbox('Ver solicitações de todas as pessoas', showAll, {
    onchange: (event) => { showAll = event.target.checked; draw(); },
  }) : null;

  draw();

  return el('div', { class: 'lgpd-grid two' },
    el('section', { class: 'card' },
      sectionTitle('Abrir uma solicitação'),
      el('p', { class: 'muted small', text: 'A LGPD garante resposta em até 15 dias (art. 19). '
        + 'Pedidos de acesso, correção, portabilidade, oposição ou eliminação podem ser feitos por aqui.' }),
      el('div', { class: 'form-grid' },
        field('Tipo de solicitação', type),
        field('Detalhes', details),
        createButton)),
    el('section', { class: 'card' },
      el('div', { class: 'section-title' },
        el('h2', { text: showAll ? 'Todas as solicitações' : 'Minhas solicitações' }),
        allToggle),
      listBox));
}

function openDsrResponse(row, onDone) {
  const status = selectEl([
    { value: 'em_analise', label: 'Em análise' },
    { value: 'concluida', label: 'Concluída' },
    { value: 'recusada', label: 'Recusada (com justificativa)' },
  ], 'em_analise');
  const response = textareaEl({ rows: 5, placeholder: 'Resposta ao titular e fundamento, quando aplicável.' });
  const err = el('div', { class: 'form-error hidden' });
  modal({
    title: `Responder ${row.protocol}`,
    subtitle: `${DSR_TYPES[row.request_type]} · aberta em ${fmtDate(row.created_at)}`,
    body: el('div', { class: 'form-grid' },
      field('Status', status),
      field('Resposta', response),
      err),
    actions: [
      { label: 'Cancelar', class: 'ghost', onClick: (close) => close() },
      {
        label: 'Registrar resposta',
        class: 'primary',
        busyLabel: 'Salvando…',
        onClick: async (close) => {
          err.classList.add('hidden');
          try {
            if (status.value === 'recusada' && response.value.trim().length < 10) {
              throw new Error('Explique o motivo da recusa.');
            }
            await updateDsr(row.id, { status: status.value, response: response.value }, currentUser().id);
            toast('Resposta registrada.', 'ok');
            close();
            onDone?.();
          } catch (error) {
            err.textContent = error.message;
            err.classList.remove('hidden');
          }
        },
      },
    ],
  });
}

/* -------------------------------- Retenção -------------------------------- */
function retentionTab(admin) {
  const policies = retentionPolicies();
  return el('div', { class: 'lgpd-grid' },
    el('section', { class: 'card' },
      sectionTitle('Políticas de retenção e descarte'),
      el('p', { class: 'muted small', text: 'Dados são mantidos apenas pelo tempo necessário (LGPD art. 15 e 16). '
        + 'A trilha de auditoria é imutável por design e deve ser arquivada por exportação ao final do prazo.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'data-table' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'Entidade' }),
            el('th', { text: 'Descrição' }),
            el('th', { text: 'Prazo' }),
            el('th', { text: 'Ação' }),
            el('th', { text: 'Última execução' }))),
          el('tbody', {}, policies.map((policy) => el('tr', {},
            el('td', { class: 'mono small', text: policy.entity }),
            el('td', { text: policy.description }),
            el('td', { text: `${policy.retention_days} dias` }),
            el('td', {}, badge(policy.action, policy.action === 'excluir' ? 'danger' : 'neutral')),
            el('td', { class: 'muted small', text: policy.last_run_at ? relTime(policy.last_run_at) : 'nunca' })))))),
      admin ? el('div', { class: 'row wrap' },
        el('button', {
          class: 'btn primary', type: 'button',
          onclick: async () => {
            if (!await confirmDialog({
              title: 'Executar rotina de retenção?',
              message: 'Sessões expiradas e conteúdo na lixeira há mais de 30 dias serão eliminados definitivamente. '
                + 'A execução fica registrada na auditoria.',
              confirmLabel: 'Executar agora',
            })) return;
            const counts = await applyRetention();
            toast(`Retenção aplicada: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}.`, 'ok');
            refresh();
          },
        }, icon('play', 15), 'Executar retenção agora')) : null),
    el('section', { class: 'card' },
      sectionTitle('Como funciona a eliminação'),
      el('ul', { class: 'bullets' },
        el('li', {}, 'Exclusões de projetos, ideias, comentários e tarefas são lógicas (soft delete) por 30 dias, permitindo recuperação.'),
        el('li', {}, 'Após o prazo, a rotina remove definitivamente os registros e o conteúdo relacionado.'),
        el('li', {}, 'Consentimentos revogados, solicitações de titulares e incidentes são preservados como prova de conformidade.'),
        el('li', {}, 'A auditoria não pode ser alterada nem apagada; ao final do prazo, exporte e arquive o banco.'))));
}

/* -------------------------------- Inventário ------------------------------ */
function ropaTab(admin) {
  const activities = processingActivities();
  return el('div', { class: 'lgpd-grid' },
    el('section', { class: 'card' },
      sectionTitle('Inventário de operações de tratamento (ROPA)'),
      el('p', { class: 'muted small', text: 'Registro das atividades de tratamento, conforme LGPD art. 37 e Resolução CD/ANPD nº 2/2022.' }),
      el('div', { class: 'ropa-grid' }, activities.map((activity) => {
        let categories = [];
        try { categories = JSON.parse(activity.data_categories || '[]'); } catch { categories = []; }
        return el('article', { class: 'ropa-card' },
          el('div', { class: 'ropa-head' },
            el('h3', { text: activity.name }),
            admin ? el('button', {
              class: 'icon-btn small', type: 'button', title: 'Editar atividade',
              onclick: () => openRopaEdit(activity, () => refresh()),
            }, icon('edit', 14)) : null),
          el('div', { class: 'meta-grid' },
            kv('Finalidade', activity.purpose),
            kv('Base legal', activity.legal_basis),
            kv('Titulares', activity.data_subjects),
            kv('Retenção', activity.retention),
            kv('Compartilhamento', activity.recipients || 'Nenhum'),
            kv('Transferência internacional', activity.international_transfer ? 'Sim' : 'Não')),
          el('div', { class: 'tag-row' }, categories.map((cat) => badge(cat, 'tag'))),
          el('p', { class: 'muted small' }, icon('shield', 13), ` ${activity.security_measures}`));
      }))));
}

function openRopaEdit(activity, onDone) {
  const name = inputEl({ value: activity.name });
  const purpose = textareaEl({ value: activity.purpose, rows: 3 });
  const legal = selectEl([
    { value: 'consentimento', label: 'Consentimento' },
    { value: 'contrato', label: 'Execução de contrato' },
    { value: 'obrigacao_legal', label: 'Obrigação legal' },
    { value: 'legitimo_interesse', label: 'Legítimo interesse' },
    { value: 'exercicio_direitos', label: 'Exercício regular de direitos' },
  ], activity.legal_basis);
  const retention = inputEl({ value: activity.retention });
  const recipients = inputEl({ value: activity.recipients });
  const measures = textareaEl({ value: activity.security_measures, rows: 3 });
  const err = el('div', { class: 'form-error hidden' });

  modal({
    title: 'Editar atividade de tratamento',
    size: 'wide',
    body: el('div', { class: 'form-grid' },
      field('Nome', name),
      field('Finalidade', purpose),
      el('div', { class: 'form-row' }, field('Base legal', legal), field('Retenção', retention)),
      field('Compartilhamento', recipients),
      field('Medidas de segurança', measures),
      err),
    actions: [
      { label: 'Cancelar', class: 'ghost', onClick: (close) => close() },
      {
        label: 'Salvar',
        class: 'primary',
        onClick: async (close) => {
          try {
            await updateProcessingActivity(activity.id, {
              name: name.value,
              purpose: purpose.value,
              legal_basis: legal.value,
              retention: retention.value,
              recipients: recipients.value,
              security_measures: measures.value,
            });
            toast('Atividade atualizada.', 'ok');
            close();
            onDone?.();
          } catch (error) {
            err.textContent = error.message;
            err.classList.remove('hidden');
          }
        },
      },
    ],
  });
}

/* -------------------------------- Incidentes ------------------------------ */
function incidentsTab(user, admin) {
  const incidents = listIncidents();
  return el('div', { class: 'lgpd-grid' },
    el('section', { class: 'card' },
      el('div', { class: 'section-title' },
        el('h2', { text: 'Incidentes de segurança' }),
        admin ? el('button', {
          class: 'btn primary sm', type: 'button',
          onclick: () => openIncidentCreate(() => refresh()),
        }, icon('plus', 15), 'Registrar incidente') : null),
      el('p', { class: 'muted small', text: 'A LGPD (art. 48) e a Resolução CD/ANPD nº 15/2024 exigem comunicação de incidentes '
        + 'que possam acarretar risco ou dano relevante aos titulares.' }),
      incidents.length
        ? el('div', { class: 'incident-list' }, incidents.map((incident) => el('article', { class: 'incident-card' },
          el('div', { class: 'incident-head' },
            el('strong', { text: incident.title }),
            el('div', { class: 'row' },
              badge(incident.severity, incident.severity === 'critica' || incident.severity === 'alta' ? 'danger' : incident.severity === 'media' ? 'warn' : 'neutral'),
              badge(incident.status, incident.status === 'encerrado' ? 'ok' : incident.status === 'aberto' ? 'danger' : 'warn'))),
          el('p', { class: 'muted small', text: incident.description }),
          el('div', { class: 'dsr-meta' },
            el('span', {}, icon('calendar', 13), ` Detectado ${fmtDateTime(incident.detected_at)}`),
            el('span', {}, icon('users', 13), ` ${incident.affected_subjects} titular(es) afetado(s)`),
            incident.contained_at ? el('span', {}, icon('shield', 13), ` Contido ${fmtDate(incident.contained_at)}`) : null,
            incident.notified_at ? el('span', {}, icon('mail', 13), ` Notificado ${fmtDate(incident.notified_at)}`) : null),
          admin ? selectEl([
            { value: 'aberto', label: 'Aberto' },
            { value: 'contido', label: 'Contido' },
            { value: 'notificado', label: 'Notificado à ANPD/titulares' },
            { value: 'encerrado', label: 'Encerrado' },
          ], incident.status, {
            onchange: async (event) => {
              await updateIncident(incident.id, {
                status: event.target.value,
                containedAt: ['contido', 'notificado', 'encerrado'].includes(event.target.value) ? (incident.contained_at || new Date().toISOString()) : null,
                notifiedAt: ['notificado', 'encerrado'].includes(event.target.value) ? (incident.notified_at || new Date().toISOString()) : null,
              });
              toast('Incidente atualizado.', 'ok');
              refresh();
            },
          }) : null)))
        : emptyState({ iconName: 'shield', title: 'Nenhum incidente registrado', text: 'Registre e acompanhe incidentes de segurança para manter a prestação de contas.' })));
}

function openIncidentCreate(onDone) {
  const title = inputEl({ placeholder: 'Resumo do incidente' });
  const severity = selectEl([
    { value: 'baixa', label: 'Baixa' },
    { value: 'media', label: 'Média' },
    { value: 'alta', label: 'Alta' },
    { value: 'critica', label: 'Crítica' },
  ], 'media');
  const description = textareaEl({ rows: 4, placeholder: 'O que aconteceu, quando foi detectado e quais dados podem ter sido afetados.' });
  const affected = inputEl({ type: 'number', min: 0, value: 0 });
  const err = el('div', { class: 'form-error hidden' });
  modal({
    title: 'Registrar incidente de segurança',
    body: el('div', { class: 'form-grid' },
      field('Título', title),
      el('div', { class: 'form-row' }, field('Severidade', severity), field('Titulares afetados', affected)),
      field('Descrição', description),
      err),
    actions: [
      { label: 'Cancelar', class: 'ghost', onClick: (close) => close() },
      {
        label: 'Registrar',
        class: 'primary',
        onClick: async (close) => {
          try {
            await createIncident({
              title: title.value,
              severity: severity.value,
              description: description.value,
              affected: Number(affected.value) || 0,
            });
            toast('Incidente registrado.', 'ok');
            close();
            onDone?.();
          } catch (error) {
            err.textContent = error.message;
            err.classList.remove('hidden');
          }
        },
      },
    ],
  });
}

/* -------------------------------- Governança ------------------------------ */
function governanceTab(user, admin) {
  const dpo = dpoInfo();
  const name = inputEl({ value: dpo.name, placeholder: 'Nome do encarregado' });
  const email = inputEl({ type: 'email', value: dpo.email, placeholder: 'dpo@exemplo.com' });
  const err = el('div', { class: 'form-error hidden' });

  return el('div', { class: 'lgpd-grid two' },
    el('section', { class: 'card' },
      sectionTitle('Encarregado pelo tratamento (DPO)'),
      el('p', { class: 'muted small', text: 'A indicação e a publicidade do encarregado são exigidas pela LGPD (art. 41) e pela Resolução CD/ANPD nº 18/2024.' }),
      admin
        ? el('div', { class: 'form-grid' },
          field('Nome', name),
          field('E-mail de contato', email),
          err,
          el('button', {
            class: 'btn primary', type: 'button',
            onclick: async () => {
              err.classList.add('hidden');
              try {
                await setDpo({ name: name.value, email: email.value });
                toast('Encarregado atualizado.', 'ok');
                refresh();
              } catch (error) {
                err.textContent = error.message;
                err.classList.remove('hidden');
              }
            },
          }, 'Salvar encarregado'))
        : el('div', {},
          el('p', {}, el('strong', { text: dpo.name || 'Não definido' })),
          el('p', { class: 'muted small', text: dpo.email || '—' }))),

    el('section', { class: 'card' },
      sectionTitle('Documentos e evidências'),
      el('div', { class: 'doc-list' },
        docLink('Política de Privacidade', `versão ${getMeta('policy_version', POLICY_VERSION)}`, 'privacidade.html'),
        docLink('Termos de Uso', 'regras da plataforma', 'termos.html'),
        docLink('Inventário de tratamentos', 'ROPA', '#/lgpd?tab=inventario'),
        docLink('Políticas de retenção', 'prazos e descarte', '#/lgpd?tab=retencao'),
        docLink('Trilha de auditoria', 'verificável e exportável', '#/auditoria')),
      el('hr', { class: 'divider' }),
      el('div', { class: 'meta-grid' },
        kv('Versão da política', getMeta('policy_version', '—')),
        kv('Algoritmo de auditoria', getMeta('audit_algorithm', 'SHA-256 encadeado')),
        kv('Último backup', getMeta('last_backup_at', '—') ? fmtDate(getMeta('last_backup_at')) : 'nenhum'),
        kv('Banco', 'SQLite local (IndexedDB)')),
      el('div', { class: 'row wrap' },
        el('a', { class: 'btn sm', href: '#/configuracoes?tab=dados' }, icon('database', 14), 'Backup e restauração'),
        el('a', { class: 'btn sm ghost', href: '#/auditoria' }, icon('activity', 14), 'Abrir auditoria'))));
}

function docLink(title, subtitle, href) {
  return el('a', { class: 'doc-link', href, target: href.endsWith('.html') ? '_blank' : null, rel: 'noopener' },
    icon('external', 15),
    el('div', {}, el('strong', { text: title }), el('small', { text: subtitle })));
}
