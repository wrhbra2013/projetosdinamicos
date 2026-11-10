/* Tela de entrada, criação da primeira conta e cadastro. */

import { el, passwordStrength, setBusy } from '../../core/util.js';
import { login, register, userCount, remoteAuthStatus } from '../../core/auth.js';
import { AUTH_BASE } from '../../core/api.js';
import { loadDemoData } from '../../core/seed.js';
import { icon } from '../icons.js';
import { field, inputEl, checkbox, toast } from '../components.js';

export async function renderAuth({ onSuccess }) {
  let remoteStatus = null;
  try { remoteStatus = await remoteAuthStatus(); } catch { /* API offline: decide localmente */ }

  // Só oferece "primeiro acesso" se o serviço /auth ainda aceitar cadastro.
  const registrationOpen = remoteStatus ? Boolean(remoteStatus.registration_open) : false;
  const firstRun = remoteStatus
    ? registrationOpen && !remoteStatus.authenticated
    : userCount() === 0;
  let mode = firstRun ? 'setup' : 'login';

  const root = el('div', { class: 'auth-layout' });
  const aside = el('aside', { class: 'auth-aside' },
    el('a', { class: 'brand auth-brand', href: 'index.html' },
      el('span', { class: 'brand-mark' }, icon('sparkles', 20)),
      el('span', { class: 'brand-text' },
        el('strong', {}, 'Projetos ', el('em', {}, 'Dinâmicos')),
        el('small', { text: 'ideias colaborativas' }))),
    el('div', { class: 'auth-pitch' },
      el('div', { class: 'eyebrow' }, 'Plataforma local-first'),
      el('h1', {}, 'Ideias que viram ', el('span', {}, 'projetos.')),
      el('p', { text: 'Organize projetos, colete ideias da equipe e acompanhe a execução — '
        + 'com auditoria completa e privacidade desde a primeira linha de código.' }),
      el('ul', { class: 'auth-points' },
        el('li', {}, icon('shield', 17), el('span', {}, el('b', {}, 'Conta protegida pela API'), ' — login, sessão e token Bearer.')),
        el('li', {}, icon('database', 17), el('span', {}, el('b', {}, 'SQLite no navegador'), ' — seus projetos ficam com você.')),
        el('li', {}, icon('activity', 17), el('span', {}, el('b', {}, 'Auditoria imutável'), ' — cada ação registrada com hash encadeado.')))),
    el('div', { class: 'auth-aside-foot', text: 'www.projetosdinamicos.com.br' }));

  const panel = el('section', { class: 'auth-panel' });
  root.append(aside, panel);

  function setMode(next) {
    mode = next;
    render();
  }

  function errorBox() {
    const box = el('div', { class: 'form-error hidden', role: 'alert' });
    return box;
  }

  function render() {
    panel.replaceChildren();
    const isSetup = mode === 'setup';
    const isRegister = mode === 'register';
    const err = errorBox();

    const nameInput = inputEl({ name: 'name', autocomplete: 'name', placeholder: 'Como devemos chamar você?' });
    const emailInput = inputEl({ name: 'email', type: 'email', autocomplete: 'email', placeholder: 'voce@exemplo.com', required: true });
    const passInput = inputEl({ name: 'password', type: 'password', autocomplete: isSetup || isRegister ? 'new-password' : 'current-password', placeholder: 'Sua senha', required: true });
    const confirmInput = inputEl({ name: 'confirm', type: 'password', autocomplete: 'new-password', placeholder: 'Repita a senha' });
    const strength = el('div', { class: 'pw-strength' });

    passInput.addEventListener('input', () => {
      if (!(isSetup || isRegister)) return;
      const info = passwordStrength(passInput.value);
      strength.replaceChildren(
        el('div', { class: `pw-bar s${info.score}` }, el('span', { style: { width: `${(info.score / 5) * 100}%` } })),
        el('small', { text: `Força: ${info.label}` }),
      );
    });

    const terms = checkbox('Li e aceito os Termos de Uso', false, { name: 'terms' });
    const privacy = checkbox('Li e aceito a Política de Privacidade', false, { name: 'privacy' });
    const marketing = checkbox('Quero receber novidades por e-mail (opcional)', false, { name: 'marketing' });
    const demo = checkbox('Incluir dados de demonstração para explorar', true, { name: 'demo' });

    const submit = el('button', { class: 'btn primary full', type: 'submit' },
      isSetup ? 'Criar conta do proprietário' : isRegister ? 'Criar minha conta' : 'Entrar',
      icon('arrowRight', 16));

    const form = el('form', { class: 'auth-form', novalidate: true },
      (isSetup || isRegister) ? field('Nome completo', nameInput) : null,
      field('E-mail', emailInput),
      field('Senha', passInput, (isSetup || isRegister) ? 'Mínimo de 10 caracteres, com maiúsculas, minúsculas e números.' : ''),
      (isSetup || isRegister) ? strength : null,
      (isSetup || isRegister) ? field('Confirmar senha', confirmInput) : null,
      (isSetup || isRegister) ? el('div', { class: 'terms-box' }, terms, privacy,
        el('p', { class: 'terms-note' }, 'Leia os ',
          el('a', { href: 'termos.html', target: '_blank', rel: 'noopener' }, 'Termos de Uso'),
          ' e a ',
          el('a', { href: 'privacidade.html', target: '_blank', rel: 'noopener' }, 'Política de Privacidade'), '.'),
        marketing) : null,
      isSetup ? demo : null,
      err,
      submit);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      err.classList.add('hidden');
      setBusy(submit, true, 'Aguarde…');
      try {
        if (isSetup || isRegister) {
          if (passInput.value !== confirmInput.value) throw new Error('As senhas não coincidem.');
          if (!terms.querySelector('input').checked || !privacy.querySelector('input').checked) {
            throw new Error('Aceite os Termos de Uso e a Política de Privacidade para continuar.');
          }
          const user = await register({
            name: nameInput.value,
            email: emailInput.value,
            password: passInput.value,
            acceptTerms: true,
            acceptPrivacy: true,
            marketing: marketing.querySelector('input').checked,
          });
          if (isSetup && demo.querySelector('input').checked) {
            try { await loadDemoData(user); } catch (demoErr) { console.warn(demoErr); }
          }
          toast(`Bem-vindo(a), ${user.display_name.split(' ')[0]}!`, 'ok');
        } else {
          const user = await login(emailInput.value, passInput.value);
          toast(`Olá de novo, ${user.display_name.split(' ')[0]}!`, 'ok');
        }
        onSuccess();
      } catch (submitErr) {
        err.textContent = submitErr.message || String(submitErr);
        err.classList.remove('hidden');
        panel.querySelector('.auth-form')?.classList.add('shake');
        setTimeout(() => panel.querySelector('.auth-form')?.classList.remove('shake'), 400);
      } finally {
        setBusy(submit, false);
      }
    });

    panel.append(
      el('div', { class: 'auth-panel-head' },
        el('div', { class: 'eyebrow', text: isSetup ? 'Primeiro acesso' : isRegister ? 'Nova conta' : 'Bem-vindo de volta' }),
        el('h2', { text: isSetup ? 'Crie a conta do proprietário' : isRegister ? 'Crie sua conta' : 'Entrar na plataforma' }),
        el('p', { text: isSetup
          ? 'A primeira conta administra esta instalação. A autenticação é feita pelo serviço da Projetos Dinâmicos.'
          : isRegister
            ? 'Sua conta é criada na API de serviços. Os dados de trabalho continuam no SQLite deste navegador.'
            : 'Acesse seus projetos, ideias e tarefas com a conta da API.' })),
      form,
      el('div', { class: 'auth-switch' },
        isSetup ? el('span', { class: 'muted', text: 'Já existe uma conta? ' }) : null,
        isSetup ? el('button', { class: 'link-btn', type: 'button', onclick: () => setMode('login') }, 'Entrar') : null,
        !isSetup && !isRegister
          ? el('span', {}, el('span', { class: 'muted', text: 'Ainda não tem conta? ' }),
            el('button', { class: 'link-btn', type: 'button', onclick: () => setMode('register') }, 'Criar agora'))
          : null,
        isRegister ? el('span', {}, el('span', { class: 'muted', text: 'Já tem conta? ' }),
          el('button', { class: 'link-btn', type: 'button', onclick: () => setMode('login') }, 'Entrar')) : null),
      el('div', { class: 'auth-local-note' },
        icon(remoteStatus ? 'shield' : 'info', 15),
        el('span', {
          text: remoteStatus
            ? `Serviço de autenticação online: ${AUTH_BASE}`
            : 'Serviço de autenticação indisponível. O acesso local continua funcionando.',
        })),
      registrationOpen
        ? el('p', { class: 'muted small', text: 'O primeiro cadastro cria a conta proprietária da API. Depois disso, novos cadastros podem ser fechados pelo administrador.' })
        : null,
      el('div', { class: 'auth-links' },
        el('a', { href: 'privacidade.html' }, 'Privacidade'),
        el('span', { text: '·' }),
        el('a', { href: 'termos.html' }, 'Termos'),
        el('span', { text: '·' }),
        el('a', { href: 'index.html' }, 'Voltar ao site')));

    setTimeout(() => (isSetup || isRegister ? nameInput : emailInput).focus(), 60);
  }

  render();
  return root;
}
