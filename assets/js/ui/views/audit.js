/* Auditoria — consulta, verificação de integridade e exportação. */

import {
  el, fmtDateTime, relTime, toCsv, download,
} from '../../core/util.js';
import { currentUser, isAdmin } from '../../core/auth.js';
import {
  listAudit, auditStats, verifyChain, actionLabel, exportAuditRows, ACTION_LABELS, audit,
} from '../../core/audit.js';
import { listProjects } from '../../core/repo.js';
import { POLICY_VERSION } from '../../core/lgpd.js';
import {
  pageHead, badge, statCard, inputEl, selectEl, emptyState, modal, toast, kv, sectionTitle,
} from '../components.js';
import { icon } from '../icons.js';
import { refresh } from '../router.js';

const ENTITY_TYPES = [
  'user', 'session', 'project', 'project_member', 'idea', 'comment', 'task', 'consent',
  'dsr', 'backup', 'sync', 'retention', 'incident', 'config', 'sistema',
];

export function auditView(params, ctx) {
  const user = currentUser();
  const all = isAdmin();
  const projects = listProjects({ user });
  const stats = auditStats();

  let offset = 0;
  const limit = 25;
  let lastResult = { rows: [], total: 0 };
  let chainState = null;

  const search = inputEl({ type: 'search', placeholder: 'Buscar por ator, ação, entidade ou detalhe…', class: 'input search-input' });
  const actionSelect = selectEl([
    { value: '', label: 'Todas as ações' },
    ...Object.entries(ACTION_LABELS).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
      .map(([value, label]) => ({ value, label })),
  ], '');
  const outcomeSelect = selectEl([
    { value: '', label: 'Todos os resultados' },
    { value: 'sucesso', label: 'Sucesso' },
    { value: 'falha', label: 'Falha' },
    { value: 'negado', label: 'Negado' },
  ], '');
  const entitySelect = selectEl([
    { value: '', label: 'Todas as entidades' },
    ...ENTITY_TYPES.map((value) => ({ value, label: value })),
  ], '');
  const projectSelect = selectEl([
    { value: '', label: 'Todos os projetos' },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ], ctx?.query?.get('projeto') || '');
  const fromInput = inputEl({ type: 'date' });
  const toInput = inputEl({ type: 'date' });

  const tableBody = el('tbody');
  const countLabel = el('span', { class: 'muted small' });
  const chainBox = el('div', { class: 'chain-box' },
    icon('shield', 18),
    el('div', {},
      el('strong', { text: 'Integridade não verificada' }),
      el('small', { text: 'Use o botão "Verificar integridade" para recalcular a cadeia de hashes.' })));

  function filters() {
    return {
      actor: user,
      all,
      search: search.value.trim(),
      action: actionSelect.value,
      entityType: entitySelect.value,
      projectId: projectSelect.value,
      outcome: outcomeSelect.value,
      from: fromInput.value,
      to: toInput.value,
    };
  }

  function load() {
    lastResult = listAudit({ ...filters(), limit, offset });
    tableBody.replaceChildren(...(lastResult.rows.length
      ? lastResult.rows.map((row) => el('tr', {
        class: 'clickable',
        onclick: () => openDetail(row),
      },
      el('td', { class: 'muted small mono', text: `#${row.seq}` }),
      el('td', { class: 'muted small', title: fmtDateTime(row.occurred_at), text: relTime(row.occurred_at) }),
      el('td', {}, el('div', { class: 'person' },
        el('div', {}, el('strong', { text: row.actor_label }),
          el('small', { text: row.actor_role || '—' })))),
      el('td', {}, actionLabel(row.action), el('small', { class: 'block muted', text: row.entity_type })),
      el('td', {}, badge(row.outcome, row.outcome === 'sucesso' ? 'ok' : 'danger')),
      el('td', { class: 'mono small muted', title: row.hash, text: `${row.hash.slice(0, 10)}…` }),
      el('td', {}, icon('chevronRight', 14))))
      : [el('tr', {}, el('td', { colspan: 7 }, emptyState({
        iconName: 'search',
        title: 'Nenhum evento encontrado',
        text: 'Ajuste os filtros ou o período.',
      })))]));

    countLabel.textContent = lastResult.total
      ? `${offset + 1}–${Math.min(offset + limit, lastResult.total)} de ${lastResult.total} evento(s)`
      : 'Nenhum evento';
  }

  function openDetail(row) {
    let detail = {};
    try { detail = JSON.parse(row.detail || '{}'); } catch { detail = { raw: row.detail }; }
    modal({
      title: actionLabel(row.action),
      subtitle: `Evento #${row.seq} · ${fmtDateTime(row.occurred_at)}`,
      size: 'wide',
      body: el('div', { class: 'audit-detail' },
        el('div', { class: 'meta-grid' },
          kv('Ator', `${row.actor_label} (${row.actor_role || '—'})`),
          kv('Resultado', row.outcome),
          kv('Entidade', `${row.entity_type}${row.entity_id ? ` · ${row.entity_id}` : ''}`),
          kv('Projeto', row.project_id || '—'),
          kv('Base legal', row.legal_basis),
          kv('Finalidade', row.purpose),
          kv('Dispositivo', row.device_id || '—'),
          kv('Categorias', row.data_categories)),
        el('h3', { class: 'mini-title', text: 'Detalhe (dados sensíveis redigidos)' }),
        el('pre', { class: 'json-block', text: JSON.stringify(detail, null, 2) }),
        el('h3', { class: 'mini-title', text: 'Cadeia de integridade' }),
        el('div', { class: 'hash-row' },
          el('span', { text: 'Hash anterior' }),
          el('code', { text: row.prev_hash })),
        el('div', { class: 'hash-row' },
          el('span', { text: 'Hash deste evento' }),
          el('code', { text: row.hash })),
        el('p', { class: 'muted small', text: 'O hash cobre todos os campos acima. Qualquer alteração invalida a cadeia.' })),
      actions: [{ label: 'Fechar', class: 'ghost' }],
    });
  }

  async function checkChain() {
    const result = await verifyChain();
    chainState = result;
    chainBox.replaceChildren(
      icon(result.ok ? 'shield' : 'alert', 18),
      el('div', {},
        el('strong', { text: result.ok ? 'Cadeia íntegra' : 'Cadeia comprometida' }),
        el('small', { text: result.ok
          ? `${result.total} eventos verificados em ${fmtDateTime(result.checkedAt)}.`
          : `Inconsistência no evento #${result.brokenAt} (${result.reason}).` })));
    chainBox.classList.toggle('ok', result.ok);
    chainBox.classList.toggle('bad', !result.ok);
    toast(result.ok ? 'Auditoria íntegra: nenhuma alteração detectada.' : 'Atenção: a cadeia de auditoria foi comprometida.', result.ok ? 'ok' : 'danger');
    await audit({
      action: 'audit.verify',
      entityType: 'audit',
      legalBasis: 'obrigacao_legal',
      purpose: 'auditoria',
      outcome: result.ok ? 'sucesso' : 'falha',
      detail: { eventos: result.total, integra: result.ok, quebra: result.brokenAt || null },
    });
  }

  function exportRows() {
    return exportAuditRows({ ...filters() });
  }

  async function exportCsv() {
    const rows = exportRows();
    const csv = toCsv(rows, [
      { label: 'seq', key: 'seq' },
      { label: 'ocorrido_em', key: 'occurred_at' },
      { label: 'ator', key: 'actor_label' },
      { label: 'papel', key: 'actor_role' },
      { label: 'acao', key: 'action' },
      { label: 'entidade', key: 'entity_type' },
      { label: 'entidade_id', key: 'entity_id' },
      { label: 'projeto_id', key: 'project_id' },
      { label: 'resultado', key: 'outcome' },
      { label: 'base_legal', key: 'legal_basis' },
      { label: 'finalidade', key: 'purpose' },
      { label: 'categorias', key: 'data_categories' },
      { label: 'detalhe', key: 'detail' },
      { label: 'hash_anterior', key: 'prev_hash' },
      { label: 'hash', key: 'hash' },
    ]);
    download(`auditoria-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
    await audit({
      action: 'audit.export',
      entityType: 'audit',
      legalBasis: 'obrigacao_legal',
      purpose: 'auditoria',
      detail: { formato: 'csv', eventos: rows.length },
    });
    toast(`${rows.length} evento(s) exportados em CSV.`, 'ok');
  }

  async function exportJson() {
    const rows = exportRows();
    const chain = await verifyChain();
    const payload = {
      _meta: {
        formato: 'projetos-dinamicos/auditoria',
        versao: 1,
        exportado_em: new Date().toISOString(),
        versao_politica: POLICY_VERSION,
        filtros: { ...filters(), actor: user.id, all },
        integridade: chain,
      },
      eventos: rows,
    };
    download(`auditoria-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
    await audit({
      action: 'audit.export',
      entityType: 'audit',
      legalBasis: 'obrigacao_legal',
      purpose: 'auditoria',
      detail: { formato: 'json', eventos: rows.length, integra: chain.ok },
    });
    toast(`${rows.length} evento(s) exportados em JSON.`, 'ok');
  }

  search.addEventListener('input', () => { offset = 0; load(); });
  [actionSelect, entitySelect, outcomeSelect, projectSelect, fromInput, toInput]
    .forEach((node) => node.addEventListener('change', () => { offset = 0; load(); }));

  load();

  const view = el('div', { class: 'view-audit' },
    pageHead({
      eyebrow: 'Conformidade',
      title: 'Auditoria',
      subtitle: all
        ? 'Trilha completa de operações de tratamento desta instalação.'
        : 'Você vê os eventos das suas ações e dos projetos em que participa.',
      actions: el('div', { class: 'row wrap' },
        el('button', { class: 'btn sm', type: 'button', onclick: checkChain }, icon('shield', 15), 'Verificar integridade'),
        el('button', { class: 'btn sm', type: 'button', onclick: exportCsv }, icon('download', 15), 'CSV'),
        el('button', { class: 'btn sm', type: 'button', onclick: exportJson }, icon('download', 15), 'JSON')),
    }),
    el('div', { class: 'stat-grid' },
      statCard({ label: 'Eventos registrados', value: stats.total, iconName: 'activity' }),
      statCard({ label: 'Últimas 24 horas', value: stats.last24h, iconName: 'clock' }),
      statCard({ label: 'Falhas e negações', value: stats.failures, iconName: 'alert', tone: stats.failures ? 'warn' : '' }),
      el('div', { class: 'stat chain-stat' }, chainBox)),
    el('div', { class: 'toolbar audit-filters' },
      el('div', { class: 'toolbar-left' },
        el('div', { class: 'search-wrap' }, icon('search', 16), search),
        actionSelect, entitySelect, outcomeSelect, projectSelect,
        el('label', { class: 'date-filter' }, el('span', { text: 'De' }), fromInput),
        el('label', { class: 'date-filter' }, el('span', { text: 'Até' }), toInput))),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'data-table audit-table' },
        el('thead', {}, el('tr', {},
          el('th', { text: '#' }),
          el('th', { text: 'Quando' }),
          el('th', { text: 'Quem' }),
          el('th', { text: 'Ação' }),
          el('th', { text: 'Resultado' }),
          el('th', { text: 'Hash' }),
          el('th', { text: '' }))),
        tableBody)),
    el('div', { class: 'pagination' },
      countLabel,
      el('div', { class: 'row' },
        el('button', {
          class: 'btn sm', type: 'button', disabled: offset === 0,
          onclick: () => { offset = Math.max(0, offset - limit); load(); },
        }, icon('chevronLeft', 14), 'Anterior'),
        el('button', {
          class: 'btn sm', type: 'button', disabled: offset + limit >= lastResult.total,
          onclick: () => { offset += limit; load(); },
        }, 'Próxima', icon('chevronRight', 14)))));
  return view;
}
