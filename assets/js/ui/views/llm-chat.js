/* LLM Chat — interface simples para interagir com o modelo Llamafile */
import { el, fmtDate, truncate, setBusy, toast } from '../../core/util.js';
import { currentUser } from '../../core/auth.js';

/* API base configurável — por padrão usa /api que o nginx proxy encaminha
   para o servidor Flask/Llamafile. Em produção: http://api.projetosdinamicos.com.br/api */
const API_BASE = (() => {
  const meta = document.querySelector('meta[name="llm-api-base"]');
  return meta ? meta.getAttribute('content') : '/api';
})();

export function llmChatView() {
  const user = currentUser();
  // Histórico persistente no localStorage
  let history = JSON.parse(localStorage.getItem('llm-chat-history') || '[]');
  let messages = history;

  // Renderizar mensagens atuais
  function renderMessages() {
    return messages.map((msg) => {
      const cls = msg.role === 'user' ? 'llm-message user-message' : 'llm-message assistant-message';
      return el('div', { class: cls },
        el('div', { class: 'message-content' }, truncate(msg.content, 500)),
        el('div', { class: 'message-meta' }, fmtDate(new Date(msg.timestamp)))
      );
    });
  }

  async function sendMessage() {
    const inputEl = document.getElementById('llm-input');
    const text = inputEl ? inputEl.value.trim() : '';
    if (!text) return;

    // Adicionar mensagem do usuário imediatamente
    const userMsg = { role: 'user', content: text, timestamp: new Date().toISOString() };
    messages = [...messages, userMsg];
    localStorage.setItem('llm-chat-history', JSON.stringify(messages));
    renderOutput();
    if (inputEl) inputEl.value = '';

    try {
      setBusy(document.querySelector('.send-btn'), true);
      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text, context: history }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(`Erro ${response.status}: ${errData.detail || response.statusText}`);
      }

      const data = await response.json();
      const assistantMsg = {
        role: 'assistant',
        content: data.choices?.[0]?.message?.content || data.message || 'Sem resposta',
        timestamp: new Date().toISOString(),
      };

      // Adicionar resposta do assistente
      messages = [...messages, assistantMsg];
      localStorage.setItem('llm-chat-history', JSON.stringify(messages));
      renderOutput();
    } catch (error) {
      console.error('Erro ao chamar LLM:', error);
      toast('Não foi possível conectar ao modelo LLM. Verifique se o servidor está rodando.', 'danger');
      // Mostrar erro na interface
      const errorMsg = { role: 'system', content: `Erro: ${error.message}`, timestamp: new Date().toISOString() };
      messages = [...messages, errorMsg];
      localStorage.setItem('llm-chat-history', JSON.stringify(messages));
      renderOutput();
    } finally {
      setBusy(document.querySelector('.send-btn'), false);
    }
  }

  function renderOutput() {
    const messagesContainer = document.getElementById('llm-messages');
    if (messagesContainer) {
      messagesContainer.innerHTML = renderMessages().map((el) => el.outerHTML || '').join('');
    }
  }

  // Inicializar ao carregar
  renderOutput();

  return el('div', { class: 'view-llm-chat' },
    el('header', { class: 'page-header' },
      el('h1', { text: 'Assistente IA' }),
      el('p', { class: 'muted small', text: 'Conectado ao modelo LFM2.5-230M no seu dispositivo' })
    ),

    el('section', { id: 'llm-messages', class: 'llm-messages' }, renderMessages()),

    el('section', { class: 'llm-input-bar' },
      el('div', { class: 'input-wrapper' },
        el('input', {
          id: 'llm-input',
          type: 'text',
          placeholder: 'Digite uma mensagem...',
          onKeyDown: (e) => e.key === 'Enter' && sendMessage(),
          class: 'form-input',
          required: true,
        }),
        el('button', {
          type: 'button',
          class: 'btn primary send-btn',
          onclick: sendMessage,
        }, 'Enviar', el('svg', {
          viewBox: '0 0 24 24', width: '17', height: '17', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8',
          'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          el('path', { d: 'M5 12h14' }),
        }))
      )
    )
  );
}