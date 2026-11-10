/* Assistente IA — cliente do serviço LLM protegido (/llm). */

import { el, fmtDate, setBusy, toast } from '../../core/util.js';
import { currentUser } from '../../core/auth.js';
import {
  LLM_BASE, llmChat, llmModels, extractContent,
} from '../../core/api.js';
import { icon } from '../icons.js';

const SYSTEM_PROMPT = 'Você é o assistente da plataforma Projetos Dinâmicos. '
  + 'Responda em português do Brasil, de forma clara, direta e útil.';
const MAX_CONTEXT_MESSAGES = 24;

export function llmChatView() {
  const user = currentUser();
  const storageKey = `llm-chat-history:${user?.email || 'anon'}`;
  let messages = loadHistory(storageKey);
  let model = '';

  const statusEl = el('span', { class: 'llm-status', text: 'verificando…' });
  const listEl = el('section', { class: 'llm-messages', id: 'llm-messages' });
  const inputEl = el('input', {
    id: 'llm-input',
    type: 'text',
    class: 'form-input llm-input',
    placeholder: 'Digite uma mensagem…',
    autocomplete: 'off',
    required: true,
  });
  const sendBtn = el('button', {
    type: 'button',
    class: 'btn primary llm-send',
  }, 'Enviar', icon('arrowRight', 16));

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages.slice(-100)));
    } catch { /* cota cheia */ }
  }

  function scrollBottom() {
    listEl.scrollTop = listEl.scrollHeight;
  }

  function messageNode(message) {
    const role = message.role === 'assistant' ? 'assistant' : message.role === 'error' ? 'error' : 'user';
    return el('div', { class: `llm-message ${role}` },
      el('div', { class: 'llm-message-content', text: message.content }),
      el('div', { class: 'llm-message-meta', text: fmtDate(message.timestamp || new Date().toISOString(), { withTime: true }) }));
  }

  function render() {
    listEl.replaceChildren();
    if (!messages.length) {
      listEl.append(el('div', { class: 'llm-empty' },
        icon('sparkles', 34),
        el('strong', { text: 'Pergunte alguma coisa' }),
        el('p', { class: 'muted small', text: 'O modelo roda na infraestrutura da Projetos Dinâmicos e exige uma sessão autenticada.' })));
    } else {
      messages.forEach((message) => listEl.append(messageNode(message)));
    }
    scrollBottom();
  }

  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusEl.textContent = text;
  }

  async function detectModel() {
    try {
      const data = await llmModels();
      const first = data?.data?.[0] || data?.models?.[0];
      if (first?.id) {
        model = String(first.id);
        setStatus('online', 'online');
        return;
      }
      setStatus('online', 'online');
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        setStatus('auth', 'entre novamente');
      } else {
        setStatus('offline', 'offline');
      }
    }
  }

  async function sendMessage() {
    const text = String(inputEl.value || '').trim();
    if (!text) return;

    const userMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    messages = [...messages, userMessage];
    persist();
    render();
    inputEl.value = '';
    setBusy(sendBtn, true, 'Enviando…');

    const context = messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-MAX_CONTEXT_MESSAGES)
      .map((message) => ({ role: message.role, content: message.content }));

    try {
      const data = await llmChat({
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...context],
        model,
      });
      const content = extractContent(data) || data?.message || 'Sem resposta do modelo.';
      messages = [...messages, { role: 'assistant', content, timestamp: new Date().toISOString() }];
      setStatus('online', 'online');
    } catch (error) {
      const detail = error?.status === 401 || error?.status === 403
        ? 'Sua sessão na API expirou. Saia e entre novamente para usar o assistente.'
        : error?.status === 429
          ? 'Limite de requisições atingido. Aguarde alguns segundos e tente de novo.'
          : error?.message || 'Não foi possível falar com o serviço LLM.';
      messages = [...messages, { role: 'error', content: detail, timestamp: new Date().toISOString() }];
      if (error?.status === 401 || error?.status === 403) setStatus('auth', 'entre novamente');
      else setStatus('offline', 'offline');
      toast(detail, 'danger');
    } finally {
      persist();
      render();
      setBusy(sendBtn, false);
      inputEl.focus();
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) sendMessage();
  });

  const view = el('div', { class: 'view-llm-chat' },
    el('header', { class: 'page-header llm-header' },
      el('div', {},
        el('h1', { text: 'Assistente IA' }),
        el('p', { class: 'muted small', text: 'Conectado ao serviço LLM da Projetos Dinâmicos.' })),
      el('div', { class: 'llm-header-actions' },
        statusEl,
        el('button', {
          class: 'btn sm ghost', type: 'button',
          onclick: () => {
            messages = [];
            persist();
            render();
            inputEl.focus();
          },
        }, icon('refresh', 14), 'Nova conversa'))),

    listEl,

    el('section', { class: 'llm-input-area' },
      inputEl,
      sendBtn),

    el('p', { class: 'muted small llm-endpoint', text: `${LLM_BASE} · respostas geradas por IA podem conter erros.` }));

  render();
  detectModel();
  return view;
}

function loadHistory(storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter((message) => message
      && ['user', 'assistant', 'error'].includes(message.role)
      && typeof message.content === 'string');
  } catch {
    return [];
  }
}
