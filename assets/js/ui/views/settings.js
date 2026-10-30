/* Configurações — perfil, segurança, dados, sincronização e sobre. */

import {
  el, fmtDate, fmtDateTime, relTime, bytes, passwordStrength, setBusy,
} from '../../core/util.js';
import {
  currentUser, updateProfile, changePassword, listSessions, revokeSession, logout,
} from '../../core/auth.js';
import {
  createBackup, restoreBackup, exportSqliteFile, backupInfo,
} from '../../core/backup.js';
import {
  serverConfig, setServerConfig, clearServerConfig, testServer, push, pull, syncNow,
} from '../../core/sync.js';
import { demoLoaded, loadDemoData, removeDemoData } from '../../core/seed.js';
import { databaseSize, resetDatabase } from '../../core/db.js';
import { allMeta } from '../../core/meta.js';
import {
  activeConsents, recordConsent, revokeConsent, CONSENT_PURPOSES, POLICY_VERSION,
} from '../../core/lgpd.js';
import {
  pageHead, tabs, field, inputEl, selectEl, textareaEl, checkbox, toast,
  confirmDialog, sectionTitle, kv, badge, emptyState,
} from '../components.js';
import { icon } from '../icons.js';
import { refresh } from '../router.js';

const TABS = [
  { id: 'perfil', label: 'Perfil' },
  { id: 'seguranca', label: 'Segurança' },
  { id: 'dados', label: 'Dados e backup' },
  { id: 'sincronizacao', label: 'Sincronização' },
  { id: 'sobre', label: 'Sobre' },
];

export function settingsView(params, ctx) {
  let active = TABS.some((t) => t.id === ctx?.query?.get('tab')) ? ctx.query.get('tab') : 'perfil';
  const content = el('div', { class: 'settings-content' });
  let tabBar = tabs(TABS, active, (id) => { active = id; redraw(); });

  function redraw() {
    tabBar.replaceWith(tabBar = tabs(TABS, active, (id) => { active = id; redraw(); }));
    content.replaceChildren(buildTab(active));
    history.replaceState(null, '', `#/configuracoes?tab=${active}`);
  }

  const view = el('div', { class: 'view-settings' },
    pageHead({
      eyebrow: 'Sistema',
      title: 'Configurações',
      subtitle: 'Sua conta, a segurança dos dados e a sincronização opcional.',
    }),
    tabBar,
    content);

  redraw();
  return view;
}

function buildTab(active) {
  switch (active) {
    case 'seguranca': return securityTab();
    case 'dados': return dataTab();
    case 'sincronizacao': return syncTab();
    case 'sobre': return aboutTab();
    default: return profileTab();
  }
}

/* --------------------------------- Perfil --------------------------------- */
function profileTab() {
  const user = currentUser();
  const name = inputEl({ value: user.display_name, maxlength: 120 });
  const timezone = selectEl([
    { value: 'America/Sao_Paulo', label: 'Brasília / São Paulo (GMT−3)' },
    { value: 'America/Manaus', label: 'Manaus (GMT−4)' },
    { value: 'America/Belem', label: 'Belém (GMT−3)' },
    { value: 'America/Fortaleza', label: 'Fortaleza (GMT−3)' },
    { value: 'America/Rio_Branco', label: 'Rio Branco (GMT−5)' },
  ], user.timezone || 'America/Sao_Paulo');
  const locale = selectEl([
    { value: 'pt-BR', label: 'Português (Brasil)' },
    { value: 'en-US', label: 'English (US)' },
    { value: 'es-ES', label: 'Español' },
  ], user.locale || 'pt-BR');
  const consents = activeConsents(user.id);
  const marketing = Boolean(consents.marketing && consents.marketing.granted && !consents.marketing.revoked_at);
  const marketingBox = checkbox('Receber novidades e convites por e-mail (opcional)', marketing);
  const err = el('div', { class: 'form-error hidden' });
  const ok = el('div', { class: 'form-ok hidden' });

  const save = el('button', {
    class: 'btn primary', type: 'button',
    onclick: async (event) => {
      const button = event.currentTarget;
      err.classList.add('hidden');
      ok.classList.add('hidden');
      setBusy(button, true, 'Salvando…');
      try {
        await updateProfile({
          displayName: name.value,
          timezone: timezone.value,
          locale: locale.value,
          marketingOptIn: marketingBox.querySelector('input').checked,
        });
        ok.textContent = 'Perfil atualizado.';
        ok.classList.remove('hidden');
        toast('Perfil atualizado.', 'ok');
        refresh();
      } catch (error) {
        err.textContent = error.message;
        err.classList.remove('hidden');
      } finally {
        setBusy(button, false);
      }
    },
  }, icon('check', 15), 'Salvar alterações');

  return el('div', { class: 'settings-grid two' },
    el('section', { class: 'card' },
      sectionTitle('Dados do perfil'),
      el('div', { class: 'form-grid' },
        field('Nome completo', name),
        field('E-mail', inputEl({ value: user.email, disabled: true }), 'O e-mail identifica sua conta e não pode ser alterado por aqui.'),
        el('div', { class: 'form-row' },
          field('Fuso horário', timezone),
          field('Idioma', locale)),
        marketingBox,
        err, ok, save),
      el('p', { class: 'muted small', text: 'Alterações de perfil são registradas na trilha de auditoria com a data e o dispositivo.' })),

    el('section', { class: 'card' },
      sectionTitle('Conta'),
      el('div', { class: 'meta-grid' },
        kv('Papel', user.role),
        kv('Criada em', fmtDate(user.created_at)),
        kv('Último acesso', user.last_login_at ? relTime(user.last_login_at) : '—'),
        kv('Versão da política', POLICY_VERSION)),
      el('hr', { class: 'divider' }),
      el('p', { class: 'muted small', text: 'Para exportar ou eliminar seus dados, abra a central de privacidade.' }),
      el('div', { class: 'row wrap' },
        el('a', { class: 'btn sm', href: '#/lgpd?tab=meus-dados' }, icon('shield', 14), 'Meus dados'),
        el('a', { class: 'btn sm ghost', href: '#/lgpd?tab=consentimentos' }, icon('scale', 14), 'Consentimentos'))));
}

/* -------------------------------- Segurança ------------------------------- */
function securityTab() {
  const currentPass = inputEl({ type: 'password', autocomplete: 'current-password', placeholder: 'Senha atual' });
  const newPass = inputEl({ type: 'password', autocomplete: 'new-password', placeholder: 'Nova senha' });
  const confirmPass = inputEl({ type: 'password', autocomplete: 'new-password', placeholder: 'Repita a nova senha' });
  const strength = el('div', { class: 'pw-strength' });
  const err = el('div', { class: 'form-error hidden' });
  const ok = el('div', { class: 'form-ok hidden' });

  newPass.addEventListener('input', () => {
    const info = passwordStrength(newPass.value);
    strength.replaceChildren(
      el('div', { class: `pw-bar s${info.score}` }, el('span', { style: { width: `${(info.score / 5) * 100}%` } })),
      el('small', { text: `Força: ${info.label}` }),
    );
  });

  const changeBtn = el('button', {
    class: 'btn primary', type: 'button',
    onclick: async (event) => {
      const button = event.currentTarget;
      err.classList.add('hidden');
      ok.classList.add('hidden');
      if (newPass.value !== confirmPass.value) {
        err.textContent = 'As senhas não coincidem.';
        err.classList.remove('hidden');
        return;
      }
      setBusy(button, true, 'Alterando…');
      try {
        await changePassword(currentPass.value, newPass.value);
        ok.textContent = 'Senha alterada. As outras sessões foram encerradas.';
        ok.classList.remove('hidden');
        toast('Senha alterada com sucesso.', 'ok');
        currentPass.value = ''; newPass.value = ''; confirmPass.value = '';
        strength.replaceChildren();
      } catch (error) {
        err.textContent = error.message;
        err.classList.remove('hidden');
      } finally {
        setBusy(button, false);
      }
    },
  }, icon('key', 15), 'Alterar senha');

  const sessions = listSessions();
  const sessionRows = sessions.map((session) => {
    const current = session.revoked_at === null && new Date(session.expires_at) > new Date();
    return el('tr', {},
      el('td', {}, el('div', { class: 'person' },
        icon(current ? 'shield' : 'lock', 17),
        el('div', {},
          el('strong', { text: session.device_label || 'Dispositivo não identificado' }),
          el('small', { text: `Criada em ${fmtDateTime(session.created_at)}` })))),
      el('td', { class: 'muted small', text: relTime(session.last_seen_at) }),
      el('td', { class: 'muted small', text: fmtDate(session.expires_at) }),
      el('td', {}, session.revoked_at
        ? badge('Revogada', 'neutral')
        : new Date(session.expires_at) <= new Date()
          ? badge('Expirada', 'warn')
          : badge('Ativa', 'ok')),
      el('td', {}, session.revoked_at ? null : el('button', {
        class: 'btn sm danger-text', type: 'button',
        onclick: async () => {
          if (!await confirmDialog({
            title: 'Revogar sessão?',
            message: 'O dispositivo precisará entrar novamente com e-mail e senha.',
            confirmLabel: 'Revogar',
            danger: true,
          })) return;
          try {
            await revokeSession(session.id);
            toast('Sessão revogada.', 'ok');
            refresh();
          } catch (error) { toast(error.message, 'danger'); }
        },
      }, 'Revogar')));
  });

  return el('div', { class: 'settings-grid two' },
    el('section', { class: 'card' },
      sectionTitle('Alterar senha'),
      el('p', { class: 'muted small', text: 'As senhas são derivadas com PBKDF2-SHA256 (210.000 iterações) e nunca armazenadas em texto puro.' }),
      el('div', { class: 'form-grid' },
        field('Senha atual', currentPass),
        field('Nova senha', newPass, 'Mínimo de 10 caracteres, com maiúsculas, minúsculas e números.'),
        strength,
        field('Confirmar nova senha', confirmPass),
        err, ok, changeBtn),
      el('p', { class: 'muted small', text: 'Ao trocar a senha, todas as outras sessões são revogadas automaticamente.' })),

    el('section', { class: 'card' },
      sectionTitle('Sessões ativas'),
      el('p', { class: 'muted small', text: 'Sessões expiram em 12 horas. Tokens são guardados apenas como hash.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'data-table' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'Dispositivo' }),
            el('th', { text: 'Último uso' }),
            el('th', { text: 'Expira' }),
            el('th', { text: 'Situação' }),
            el('th', { text: '' }))),
          el('tbody', {}, sessionRows.length ? sessionRows : el('tr', {}, el('td', { colspan: 5, class: 'muted small', text: 'Nenhuma sessão registrada.' }))))),
      el('hr', { class: 'divider' }),
      el('button', {
        class: 'btn danger-text', type: 'button',
        onclick: async () => {
          if (!await confirmDialog({
            title: 'Sair de todos os dispositivos?',
            message: 'Todas as sessões serão encerradas, inclusive esta.',
            confirmLabel: 'Sair de todos',
            danger: true,
          })) return;
          await logout('manual');
          location.reload();
        },
      }, icon('logout', 15), 'Encerrar todas as sessões')));
}

/* ------------------------------ Dados e backup ---------------------------- */
function dataTab() {
  const info = backupInfo();
  const passphrase = inputEl({ type: 'password', autocomplete: 'new-password', placeholder: 'Frase secreta (opcional)' });
  const restorePassphrase = inputEl({ type: 'password', autocomplete: 'off', placeholder: 'Frase secreta do backup (se cifrado)' });
  const fileInput = inputEl({ type: 'file', accept: '.json,.sqlite,.pdb', class: 'input file-input' });
  const err = el('div', { class: 'form-error hidden' });
  const ok = el('div', { class: 'form-ok hidden' });
  const demo = demoLoaded();

  return el('div', { class: 'settings-grid two' },
    el('section', { class: 'card' },
      sectionTitle('Backup e portabilidade'),
      el('div', { class: 'meta-grid' },
        kv('Tamanho do banco', info.size),
        kv('Último backup', info.lastBackupAt ? fmtDateTime(info.lastBackupAt) : 'nenhum'),
        kv('Formato', 'SQLite / JSON')),
      el('p', { class: 'muted small', text: 'O backup contém todo o banco local. Use uma frase secreta para cifrar com AES-256-GCM antes de guardar em nuvem ou enviar por e-mail.' }),
      el('div', { class: 'form-grid' },
        field('Frase secreta (opcional)', passphrase, 'Se informada, o arquivo só poderá ser restaurado com ela. Não há recuperação.'),
        el('div', { class: 'row wrap' },
          el('button', {
            class: 'btn primary', type: 'button',
            onclick: async (event) => {
              const button = event.currentTarget;
              setBusy(button, true, 'Gerando…');
              try {
                const result = await createBackup({ passphrase: passphrase.value });
                toast(`Backup gerado (${result.size}${result.encrypted ? ', cifrado' : ''}).`, 'ok');
                refresh();
              } catch (error) { toast(error.message, 'danger'); }
              finally { setBusy(button, false); }
            },
          }, icon('download', 15), 'Gerar backup'),
          el('button', {
            class: 'btn', type: 'button',
            onclick: async (event) => {
              const button = event.currentTarget;
              setBusy(button, true, 'Exportando…');
              try {
                await exportSqliteFile();
                toast('Arquivo SQLite exportado.', 'ok');
              } catch (error) { toast(error.message, 'danger'); }
              finally { setBusy(button, false); }
            },
          }, icon('database', 15), 'Exportar .sqlite'))),
      el('hr', { class: 'divider' }),
      sectionTitle('Restaurar backup'),
      el('p', { class: 'muted small', text: 'A restauração substitui integralmente o banco local. Gere um backup do estado atual antes de continuar.' }),
      el('div', { class: 'form-grid' },
        field('Arquivo', fileInput, 'Aceita .pdb.json (cifrado ou não) e .sqlite.'),
        field('Frase secreta do arquivo', restorePassphrase),
        err, ok,
        el('button', {
          class: 'btn', type: 'button',
          onclick: async (event) => {
            const button = event.currentTarget;
            err.classList.add('hidden'); ok.classList.add('hidden');
            const file = fileInput.files?.[0];
            if (!file) {
              err.textContent = 'Escolha um arquivo de backup.';
              err.classList.remove('hidden');
              return;
            }
            if (!await confirmDialog({
              title: 'Restaurar backup?',
              message: 'Todos os dados atuais deste navegador serão substituídos pelo conteúdo do arquivo. Esta ação não pode ser desfeita.',
              confirmLabel: 'Restaurar agora',
              danger: true,
            })) return;
            setBusy(button, true, 'Restaurando…');
            try {
              const result = await restoreBackup(file, { passphrase: restorePassphrase.value });
              ok.textContent = `Backup restaurado (${result.size}). A auditoria está ${result.chainOk ? 'íntegra' : 'comprometida'}.`;
              ok.classList.remove('hidden');
              toast('Backup restaurado. Faça login novamente.', 'ok');
              setTimeout(() => { location.hash = '#/painel'; location.reload(); }, 900);
            } catch (error) {
              err.textContent = error.message;
              err.classList.remove('hidden');
            } finally { setBusy(button, false); }
          },
        }, icon('upload', 15), 'Restaurar arquivo'))),

    el('section', { class: 'card' },
      sectionTitle('Dados de demonstração'),
      el('p', { class: 'muted small', text: demo
        ? 'Os dados de demonstração estão carregados. Você pode removê-los a qualquer momento; apenas os registros de demonstração são apagados.'
        : 'Carregue projetos, ideias e tarefas fictícios para explorar a plataforma sem compromisso. Nenhum dado real é afetado.' }),
      el('div', { class: 'row wrap' },
        demo
          ? el('button', {
            class: 'btn danger-text', type: 'button',
            onclick: async () => {
              if (!await confirmDialog({
                title: 'Remover dados de demonstração?',
                message: 'Projetos, ideias, comentários, tarefas e contas fictícias serão removidos. Seus dados reais permanecem.',
                confirmLabel: 'Remover',
                danger: true,
              })) return;
              const result = await removeDemoData();
              toast(`Demonstração removida (${result.removed} conta(s)).`, 'ok');
              refresh();
            },
          }, icon('trash', 15), 'Remover demonstração')
          : el('button', {
            class: 'btn primary', type: 'button',
            onclick: async (event) => {
              const button = event.currentTarget;
              setBusy(button, true, 'Carregando…');
              try {
                await loadDemoData(currentUser());
                toast('Dados de demonstração carregados.', 'ok');
                refresh();
              } catch (error) { toast(error.message, 'danger'); }
              finally { setBusy(button, false); }
            },
          }, icon('sparkles', 15), 'Carregar demonstração'),
        el('a', { class: 'btn ghost sm', href: '#/lgpd?tab=meus-dados' }, icon('shield', 14), 'Meus dados')),

      el('hr', { class: 'divider' }),
      sectionTitle('Zona de risco'),
      el('div', { class: 'warning-box' },
        icon('alert', 17),
        el('span', { text: 'Reiniciar o banco apaga contas, projetos, ideias, tarefas e toda a auditoria deste navegador. Não há como recuperar sem um backup.' })),
      el('button', {
        class: 'btn danger-solid', type: 'button',
        onclick: async () => {
          const first = await confirmDialog({
            title: 'Reiniciar banco local?',
            message: 'Esta ação apaga tudo neste navegador, inclusive a trilha de auditoria. Gere um backup antes.',
            confirmLabel: 'Continuar',
            danger: true,
          });
          if (!first) return;
          const second = await confirmDialog({
            title: 'Tem certeza absoluta?',
            message: 'Digite sua decisão confirmando abaixo. O banco será recriado vazio e você voltará à tela de primeiro acesso.',
            confirmLabel: 'Apagar tudo',
            danger: true,
          });
          if (!second) return;
          await resetDatabase();
          toast('Banco local reiniciado.', 'ok');
          setTimeout(() => { location.hash = '#/painel'; location.reload(); }, 500);
        },
      }, icon('trash', 15), 'Reiniciar banco local')));
}

/* ------------------------------ Sincronização ----------------------------- */
function syncTab() {
  const config = serverConfig();
  const url = inputEl({ value: config.url, placeholder: 'https://api.exemplo.com', autocomplete: 'off' });
  const token = inputEl({ type: 'password', value: config.token, placeholder: 'Token de acesso da API', autocomplete: 'off' });
  const err = el('div', { class: 'form-error hidden' });
  const ok = el('div', { class: 'form-ok hidden' });
  const status = el('div', { class: 'sync-status' },
    icon(config.url ? 'link' : 'info', 17),
    el('div', {},
      el('strong', { text: config.url ? 'Servidor configurado' : 'Nenhum servidor configurado' }),
      el('small', { text: config.url
        ? `${config.url}${config.lastSyncAt ? ` · última sincronização ${relTime(config.lastSyncAt)}` : ''}`
        : 'A plataforma funciona 100% offline. A sincronização é opcional.' })));

  const save = el('button', {
    class: 'btn primary', type: 'button',
    onclick: async (event) => {
      const button = event.currentTarget;
      err.classList.add('hidden'); ok.classList.add('hidden');
      setBusy(button, true, 'Testando…');
      try {
        const result = await testServer({ url: url.value, token: token.value });
        setServerConfig({ url: url.value, token: token.value });
        ok.textContent = `Conexão estabelecida com ${result.service || 'o servidor'} (${result.version || 'v1'}).`;
        ok.classList.remove('hidden');
        toast('Servidor configurado.', 'ok');
        refresh();
      } catch (error) {
        err.textContent = error.message;
        err.classList.remove('hidden');
      } finally { setBusy(button, false); }
    },
  }, icon('link', 15), 'Testar e salvar');

  return el('div', { class: 'settings-grid two' },
    el('section', { class: 'card' },
      sectionTitle('Backend opcional'),
      el('p', { class: 'muted small', text: 'Instale o backend SQLite com o script install_api.sh para compartilhar dados entre dispositivos. '
        + 'Sem ele, tudo continua funcionando localmente neste navegador.' }),
      status,
      el('div', { class: 'form-grid' },
        field('URL da API', url, 'Endereço HTTPS do servidor instalado.'),
        field('Token de acesso', token, 'Definido no arquivo .env do servidor (API_TOKEN).'),
        err, ok, save),
      el('div', { class: 'row wrap' },
        el('button', {
          class: 'btn sm', type: 'button',
          onclick: async (event) => {
            const button = event.currentTarget;
            setBusy(button, true, 'Enviando…');
            try {
              const result = await push();
              toast(`Envio concluído${result?.stats ? `: ${JSON.stringify(result.stats)}` : ''}.`, 'ok');
              refresh();
            } catch (error) { toast(error.message, 'danger'); }
            finally { setBusy(button, false); }
          },
        }, icon('upload', 14), 'Enviar dados'),
        el('button', {
          class: 'btn sm', type: 'button',
          onclick: async (event) => {
            const button = event.currentTarget;
            setBusy(button, true, 'Recebendo…');
            try {
              const result = await pull();
              toast(`Recebido: ${JSON.stringify(result)}.`, 'ok');
              refresh();
            } catch (error) { toast(error.message, 'danger'); }
            finally { setBusy(button, false); }
          },
        }, icon('download', 14), 'Receber dados'),
        el('button', {
          class: 'btn sm ghost', type: 'button',
          onclick: async (event) => {
            const button = event.currentTarget;
            setBusy(button, true, 'Sincronizando…');
            try {
              const result = await syncNow();
              toast(`Sincronização concluída: ${JSON.stringify(result)}.`, 'ok');
              refresh();
            } catch (error) { toast(error.message, 'danger'); }
            finally { setBusy(button, false); }
          },
        }, icon('refresh', 14), 'Sincronizar agora')),
      el('button', {
        class: 'btn danger-text sm', type: 'button',
        onclick: async () => {
          if (!await confirmDialog({
            title: 'Remover servidor?',
            message: 'A configuração de sincronização será apagada deste navegador. Os dados locais permanecem.',
            confirmLabel: 'Remover',
            danger: true,
          })) return;
          clearServerConfig();
          toast('Servidor removido.', 'ok');
          refresh();
        },
      }, icon('x', 14), 'Remover configuração')),

    el('section', { class: 'card' },
      sectionTitle('Como funciona'),
      el('ul', { class: 'bullets' },
        el('li', {}, 'O envio cria um snapshot das tabelas de trabalho (projetos, ideias, votos, comentários e tarefas).'),
        el('li', {}, 'O recebimento aplica o snapshot com resolução last-write-wins pelo campo updated_at.'),
        el('li', {}, 'Credenciais nunca são sincronizadas: contas remotas não podem fazer login neste dispositivo.'),
        el('li', {}, 'Cada operação de sincronização é registrada na auditoria com a URL do servidor.')),
      el('div', { class: 'info-box' },
        icon('shield', 17),
        el('span', { text: 'Para conformidade, use sempre HTTPS e um token longo. O backend mantém a própria trilha de auditoria imutável.' }))));
}

/* ---------------------------------- Sobre --------------------------------- */
function aboutTab() {
  const meta = allMeta();
  const size = databaseSize();

  return el('div', { class: 'settings-grid two' },
    el('section', { class: 'card' },
      sectionTitle('Projetos Dinâmicos'),
      el('p', { class: 'muted small', text: 'Plataforma de desenvolvimento colaborativo de projetos: ideias, votos, comentários, tarefas e governança de privacidade — tudo em uma página estática com SQLite no navegador.' }),
      el('div', { class: 'meta-grid' },
        kv('Versão', '1.0.0'),
        kv('Esquema', meta.schema_version || '1'),
        kv('Versão da política', meta.policy_version || POLICY_VERSION),
        kv('Banco local', bytes(size)),
        kv('Algoritmo de auditoria', meta.audit_algorithm || 'SHA-256 encadeado'),
        kv('Armazenamento', 'IndexedDB + sql.js (WebAssembly)')),
      el('div', { class: 'row wrap' },
        el('a', { class: 'btn sm', href: 'privacidade.html', target: '_blank', rel: 'noopener' }, icon('shield', 14), 'Política de Privacidade'),
        el('a', { class: 'btn sm', href: 'termos.html', target: '_blank', rel: 'noopener' }, icon('scale', 14), 'Termos de Uso'),
        el('a', { class: 'btn sm ghost', href: 'index.html' }, icon('home', 14), 'Página inicial'))),

    el('section', { class: 'card' },
      sectionTitle('Tecnologia e privacidade'),
      el('ul', { class: 'bullets' },
        el('li', {}, 'SQLite compilado para WebAssembly (sql.js), persistido no IndexedDB.'),
        el('li', {}, 'Sem cookies de rastreamento, sem analytics de terceiros e sem chamadas externas.'),
        el('li', {}, 'Senhas com PBKDF2-SHA256 e 210.000 iterações; sessões com token hasheado e expiração de 12 horas.'),
        el('li', {}, 'Auditoria append-only com encadeamento SHA-256, protegida por triggers no banco.'),
        el('li', {}, 'Consentimentos versionados, portabilidade em JSON e eliminação com anonimização.')),
      el('div', { class: 'info-box' },
        icon('info', 17),
        el('span', { text: 'Este é um ambiente local-first. Os dados existem apenas neste navegador até que você gere um backup ou configure a sincronização.' }))));
}
