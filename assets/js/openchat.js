/* ============================================================================
   OpenChat — cliente estático da API LLM (llamafile atrás do nginx)
   Endpoints usados:
     GET  {base}/health
     GET  {base}/v1/models
     POST {base}/v1/chat/completions   (stream: true)
     Auth: /auth/login, /auth/register, /auth/logout, /auth/status, /auth/me
   ========================================================================== */

import {
  LLM_BASE,
  authLogin,
  authRegister,
  authLogout,
  authStatus,
  authMe,
  getToken,
  setToken,
  clearApiSession,
  apiUser,
} from './core/api.js';

(function () {
  'use strict';

  var DEFAULT_API_BASE = LLM_BASE;
  var STORAGE_CONFIG = 'openchat:config';
  var STORAGE_HISTORY = 'openchat:history';
  var MAX_HISTORY = 200;
  var SYSTEM_PROMPT = 'Você é o OpenChat, assistente da plataforma Projetos Dinâmicos. ' +
    'Responda em português do Brasil, de forma clara e direta.';

  /* ----------------------------- Estado ---------------------------------- */

  var config = loadConfig();
  var messages = loadHistory();       // [{role, content}]
  var controller = null;              // AbortController da requisição atual
  var streaming = false;
  var detectedModel = '';
  var runId = 0;                      // descarta respostas de conversas já trocadas
  var authUser = apiUser();
  var authBusy = false;
  var registrationOpen = false;
  var accountMode = 'login';

  /* ----------------------------- DOM ------------------------------------- */

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    status: $('oc-status'),
    statusText: $('oc-status-text'),
    newChat: $('oc-new'),
    accountOpen: $('oc-account-open'),
    registerOpen: $('oc-register-open'),
    settingsOpen: $('oc-settings-open'),
    messages: $('oc-messages'),
    empty: $('oc-empty'),
    form: $('oc-form'),
    input: $('oc-input'),
    send: $('oc-send'),
    stop: $('oc-stop'),
    dialog: $('oc-settings'),
    dialogForm: $('oc-settings-form'),
    dialogClose: $('oc-settings-close'),
    dialogCancel: $('oc-settings-cancel'),
    apiBase: $('oc-api-base'),
    apiToken: $('oc-api-token'),
    model: $('oc-model'),
    dialogMsg: $('oc-settings-msg'),
    accountDialog: $('oc-account'),
    accountForm: $('oc-account-form'),
    accountClose: $('oc-account-close'),
    accountTitle: $('oc-account-title'),
    accountState: $('oc-account-state'),
    accountEmail: $('oc-account-email'),
    accountPassword: $('oc-account-password'),
    accountConfirm: $('oc-account-confirm'),
    confirmField: $('oc-confirm-field'),
    accountMsg: $('oc-account-msg'),
    accountSubmit: $('oc-account-submit'),
    accountLogout: $('oc-account-logout'),
    tabLogin: $('oc-tab-login'),
    tabRegister: $('oc-tab-register'),
    registerNote: $('oc-register-note'),
    termsNote: $('oc-terms-note')
  };

  if (!els.form || !els.messages) return;

  /* ----------------------------- Config ---------------------------------- */

  function loadConfig() {
    var base = { apiBase: DEFAULT_API_BASE, token: '', model: '' };
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_CONFIG) || '{}');
      if (saved && typeof saved === 'object') {
        if (typeof saved.apiBase === 'string' && saved.apiBase.trim()) base.apiBase = saved.apiBase.trim();
        if (typeof saved.token === 'string') base.token = saved.token;
        if (typeof saved.model === 'string') base.model = saved.model;
      }
    } catch (e) { /* localStorage indisponível ou JSON inválido */ }
    base.apiBase = base.apiBase.replace(/\/+$/, '');
    return base;
  }

  function saveConfig(next) {
    config = next;
    try { localStorage.setItem(STORAGE_CONFIG, JSON.stringify(config)); } catch (e) { /* ignora */ }
  }

  function loadHistory() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_HISTORY) || '[]');
      if (!Array.isArray(saved)) return [];
      return saved.filter(function (m) {
        return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
      }).slice(-MAX_HISTORY);
    } catch (e) {
      return [];
    }
  }

  function persistHistory() {
    try {
      localStorage.setItem(STORAGE_HISTORY, JSON.stringify(messages.slice(-MAX_HISTORY)));
    } catch (e) { /* cota cheia: conversa continua em memória */ }
  }

  /* ----------------------------- HTTP ------------------------------------ */

  function bearerToken() {
    return getToken() || config.token || '';
  }

  function headers(extra) {
    var h = { 'Accept': 'application/json' };
    var token = bearerToken();
    if (token) h['Authorization'] = 'Bearer ' + token;
    if (extra) {
      Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    }
    return h;
  }

  function credentials() {
    return 'include';
  }

  function friendlyError(err) {
    if (err && err.name === 'AbortError') return 'Geração interrompida.';
    var msg = (err && err.message) ? err.message : String(err);
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      return 'Não foi possível falar com a API. Verifique a URL em Config e se ' +
        config.apiBase + ' está no ar (CORS/HTTPS).';
    }
    return msg;
  }

  function readError(res) {
    if (res.status === 401 || res.status === 403) {
      setStatus('auth', 'entrar');
      return Promise.reject(new Error(
        'Faça login para usar a API. Abra “Entrar” no topo da página.'
      ));
    }
    if (res.status === 429) {
      return Promise.reject(new Error(
        'Muitas requisições (limite por IP). Aguarde alguns segundos e tente de novo.'
      ));
    }
    return res.text().then(function (text) {
      var detail = text;
      try {
        var json = JSON.parse(text);
        detail = (json.error && (json.error.message || json.error)) || json.message || text;
        if (typeof detail === 'object') detail = JSON.stringify(detail);
      } catch (e) { /* mantém texto puro */ }
      detail = String(detail || '').slice(0, 300).trim();
      throw new Error('HTTP ' + res.status + (detail ? ' — ' + detail : ''));
    });
  }

  /* ----------------------------- Status ---------------------------------- */

  function setStatus(state, text) {
    if (!els.status) return;
    els.status.setAttribute('data-state', state);
    if (els.statusText) els.statusText.textContent = text;
  }

  function checkHealth() {
    setStatus('checking', 'verificando…');
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 8000);

    fetch(config.apiBase + '/health', {
      method: 'GET',
      headers: headers(),
      credentials: credentials(),
      signal: ctrl.signal,
      cache: 'no-store'
    }).then(function (res) {
      clearTimeout(timer);
      if (res.status === 401 || res.status === 403) {
        setStatus('auth', 'entrar');
        resolveAuth();
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      setStatus('online', 'online');
      detectModel();
    }).catch(function () {
      clearTimeout(timer);
      setStatus('offline', 'offline');
    });
  }

  function detectModel() {
    fetch(config.apiBase + '/v1/models', {
      method: 'GET',
      headers: headers(),
      credentials: credentials(),
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      var list = (json && json.data) || [];
      if (list.length && list[0] && list[0].id) {
        detectedModel = String(list[0].id);
        if (els.model && !els.model.value) els.model.placeholder = detectedModel;
      }
    }).catch(function () { /* /v1/models é opcional */ });
  }

  function activeModel() {
    return (config.model || detectedModel || '').trim();
  }

  /* ----------------------------- Markdown -------------------------------- */

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inline(text) {
    var out = escapeHtml(text);
    // `código`
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    // **negrito**
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // *itálico* (evita colidir com **)
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    // links http(s) — só depois do escape, então o href é seguro
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
      '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    return out;
  }

  function renderMarkdown(text) {
    var lines = String(text).replace(/\r\n/g, '\n').split('\n');
    var html = '';
    var paragraph = [];
    var listType = null;
    var inCode = false;
    var codeLang = '';
    var code = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      html += '<p>' + inline(paragraph.join(' ')) + '</p>';
      paragraph = [];
    }

    function closeList() {
      if (!listType) return;
      html += listType === 'ol' ? '</ol>' : '</ul>';
      listType = null;
    }

    function flushCode() {
      html += '<pre><code' + (codeLang ? ' class="language-' +
        escapeHtml(codeLang) + '"' : '') + '>' +
        escapeHtml(code.join('\n')) + '</code></pre>';
      code = [];
      codeLang = '';
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (/^```/.test(line.trim())) {
        if (inCode) {
          flushCode();
          inCode = false;
        } else {
          flushParagraph();
          closeList();
          inCode = true;
          codeLang = line.trim().slice(3).trim();
        }
        continue;
      }

      if (inCode) {
        code.push(line);
        continue;
      }

      if (!line.trim()) {
        flushParagraph();
        closeList();
        continue;
      }

      var heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        flushParagraph();
        closeList();
        var level = Math.min(heading[1].length + 2, 6);
        html += '<h' + level + '>' + inline(heading[2]) + '</h' + level + '>';
        continue;
      }

      var bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      if (bullet) {
        flushParagraph();
        if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
        html += '<li>' + inline(bullet[1]) + '</li>';
        continue;
      }

      var numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (numbered) {
        flushParagraph();
        if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
        html += '<li>' + inline(numbered[1]) + '</li>';
        continue;
      }

      if (/^>\s?/.test(line)) {
        flushParagraph();
        closeList();
        html += '<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>';
        continue;
      }

      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
        flushParagraph();
        closeList();
        html += '<hr>';
        continue;
      }

      closeList();
      paragraph.push(line.trim());
    }

    if (inCode) flushCode();
    flushParagraph();
    closeList();
    return html;
  }

  /* ----------------------------- Mensagens -------------------------------- */

  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function hideEmpty() {
    if (els.empty) els.empty.classList.add('hidden');
  }

  function showEmpty() {
    if (!els.empty) return;
    if (messages.length) els.empty.classList.add('hidden');
    else els.empty.classList.remove('hidden');
  }

  function buildMessage(role, content, extraClass) {
    var row = document.createElement('div');
    row.className = 'oc-msg oc-msg-' + role + (extraClass ? ' ' + extraClass : '');

    var avatar = document.createElement('span');
    avatar.className = 'oc-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = role === 'user' ? 'EU' : 'IA';

    var bubble = document.createElement('div');
    bubble.className = 'oc-bubble';

    var body = document.createElement('div');
    body.className = 'oc-bubble-content';
    bubble.appendChild(body);

    row.appendChild(avatar);
    row.appendChild(bubble);
    els.messages.appendChild(row);
    return { row: row, bubble: bubble, body: body };
  }

  function appendMessage(role, content) {
    hideEmpty();
    var node = buildMessage(role, content);
    node.body.innerHTML = renderMarkdown(content);
    scrollToBottom();
    return node;
  }

  function renderAll() {
    Array.prototype.slice.call(els.messages.querySelectorAll('.oc-msg'))
      .forEach(function (n) { n.parentNode.removeChild(n); });
    messages.forEach(function (m) { appendMessage(m.role, m.content); });
    showEmpty();
    scrollToBottom();
  }

  function setBusy(busy) {
    streaming = busy;
    if (els.send) els.send.disabled = busy;
    if (els.stop) els.stop.classList.toggle('hidden', !busy);
    if (els.input) els.input.disabled = false; // permite escrever durante a resposta
  }

  /* ----------------------------- Envio ------------------------------------ */

  function addNotice(text) {
    hideEmpty();
    var row = document.createElement('div');
    row.className = 'oc-msg oc-msg-assistant';
    var bubble = document.createElement('div');
    bubble.className = 'oc-bubble';
    var err = document.createElement('p');
    err.className = 'oc-error';
    err.textContent = text;
    bubble.appendChild(err);
    row.appendChild(bubble);
    els.messages.appendChild(row);
    scrollToBottom();
  }

  function send(text) {
    text = String(text || '').trim();
    if (!text || streaming) return;

    messages.push({ role: 'user', content: text });
    persistHistory();
    appendMessage('user', text);
    if (els.input) {
      els.input.value = '';
      autoresize();
    }

    var myRun = ++runId;
    var stale = function () { return myRun !== runId; };

    var assistant = buildMessage('assistant', '');
    var typing = document.createElement('span');
    typing.className = 'oc-typing';
    typing.innerHTML = '<i></i><i></i><i></i>';
    assistant.body.appendChild(typing);
    hideEmpty();
    scrollToBottom();

    setBusy(true);
    controller = new AbortController();

    var payload = {
      messages: [{ role: 'system', content: SYSTEM_PROMPT }].concat(
        messages.map(function (m) { return { role: m.role, content: m.content }; })
      ),
      stream: true,
      temperature: 0.7,
      max_tokens: 1024
    };
    var model = activeModel();
    if (model) payload.model = model;

    var buffered = '';
    var answer = '';
    var rendered = false;

    fetch(config.apiBase + '/v1/chat/completions', {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      credentials: credentials(),
      body: JSON.stringify(payload),
      signal: controller.signal
    }).then(function (res) {
      if (!res.ok) return readError(res);
      if (!res.body || !res.body.getReader) {
        return res.json().then(function (json) {
          answer = extractContent(json);
          paint();
        });
      }
      return readStream(res.body.getReader());
    }).then(function () {
      if (stale()) return;
      paint();
      if (!answer.trim()) {
        throw new Error('A API respondeu sem conteúdo.');
      }
      messages.push({ role: 'assistant', content: answer });
      persistHistory();
    }).catch(function (err) {
      if (stale()) return;
      if (err && err.name === 'AbortError') {
        if (answer.trim()) {
          messages.push({ role: 'assistant', content: answer });
          persistHistory();
        }
        paint();
        return;
      }
      if (rendered) {
        var note = document.createElement('p');
        note.className = 'oc-error';
        note.textContent = friendlyError(err);
        assistant.bubble.appendChild(note);
      } else {
        assistant.row.parentNode.removeChild(assistant.row);
        addNotice(friendlyError(err));
      }
    }).then(function () {
      if (stale()) return;
      controller = null;
      setBusy(false);
      scrollToBottom();
    });

    function paint() {
      if (stale()) return;
      typing.parentNode && typing.parentNode.removeChild(typing);
      assistant.body.innerHTML = answer ? renderMarkdown(answer) : '';
      rendered = true;
      scrollToBottom();
    }

    function readStream(reader) {
      var decoder = new TextDecoder('utf-8');
      var done = false;

      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) {
            processBuffer(true);
            return;
          }
          buffered += decoder.decode(chunk.value, { stream: true });
          processBuffer(false);
          paint();
          return pump();
        }).then(function () {
          if (!done && reader.cancel) {
            done = true;
            try { reader.cancel(); } catch (e) { /* ignora */ }
          }
        });
      }

      function processBuffer(final) {
        var lines = buffered.split('\n');
        buffered = final ? '' : lines.pop();
        lines.forEach(function (raw) {
          var line = raw.replace(/\r$/, '');
          if (!line || line.charAt(0) === ':') return; // comentário/keep-alive
          if (line.indexOf('data:') !== 0) return;
          var data = line.slice(5).trim();
          if (!data || data === '[DONE]') { done = true; return; }
          try {
            var json = JSON.parse(data);
            var delta = extractContent(json, true);
            if (delta) answer += delta;
          } catch (e) {
            // JSON parcial: devolve ao buffer para completar no próximo chunk
            if (!final) buffered = data + '\n' + buffered;
          }
        });
      }

      return pump();
    }

    function extractContent(json, isDelta) {
      var choice = json && json.choices && json.choices[0];
      if (!choice) return '';
      var part = isDelta ? (choice.delta || choice.message) : (choice.message || choice.delta);
      if (!part) return '';
      if (typeof part.content === 'string') return part.content;
      if (Array.isArray(part.content)) {
        return part.content.map(function (c) {
          return (c && (c.text || c.content)) || '';
        }).join('');
      }
      return '';
    }
  }

  /* ----------------------------- Textarea -------------------------------- */

  function autoresize() {
    if (!els.input) return;
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
  }

  /* ----------------------------- Eventos --------------------------------- */

  els.form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    send(els.input ? els.input.value : '');
  });

  if (els.input) {
    els.input.addEventListener('input', autoresize);
    els.input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        send(els.input.value);
      }
    });
  }

  if (els.stop) {
    els.stop.addEventListener('click', function () {
      if (controller) controller.abort();
    });
  }

  if (els.newChat) {
    els.newChat.addEventListener('click', function () {
      runId++;                       // invalida respostas pendentes
      if (controller) controller.abort();
      controller = null;
      messages = [];
      persistHistory();
      renderAll();
      setBusy(false);
      if (els.input) { els.input.value = ''; autoresize(); els.input.focus(); }
    });
  }

  Array.prototype.slice.call(document.querySelectorAll('.oc-suggestion'))
    .forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (els.input) els.input.value = btn.getAttribute('data-prompt') || btn.textContent;
        send(els.input ? els.input.value : '');
      });
    });

  /* ------------------------------ Conta ---------------------------------- */

  function setAuthMessage(text, tone) {
    if (!els.accountMsg) return;
    els.accountMsg.textContent = text || '';
    els.accountMsg.classList.toggle('is-ok', tone === 'ok');
  }

  function setAccountMode(mode) {
    accountMode = mode === 'register' ? 'register' : 'login';
    var isRegister = accountMode === 'register';

    if (els.tabLogin) {
      els.tabLogin.classList.toggle('active', !isRegister);
      els.tabLogin.setAttribute('aria-selected', String(!isRegister));
    }
    if (els.tabRegister) {
      els.tabRegister.classList.toggle('active', isRegister);
      els.tabRegister.setAttribute('aria-selected', String(isRegister));
      els.tabRegister.disabled = !registrationOpen;
      els.tabRegister.title = registrationOpen ? '' : 'Cadastro fechado';
    }
    if (els.confirmField) els.confirmField.classList.toggle('hidden', !isRegister);
    if (els.termsNote) els.termsNote.classList.toggle('hidden', !isRegister);
    if (els.accountSubmit) {
      els.accountSubmit.textContent = isRegister ? 'Criar conta' : 'Entrar';
      els.accountSubmit.disabled = authBusy || (isRegister && !registrationOpen);
    }
    if (els.accountPassword) {
      els.accountPassword.setAttribute('autocomplete', isRegister ? 'new-password' : 'current-password');
    }
    if (els.accountTitle) {
      els.accountTitle.textContent = isRegister ? 'Criar conta na API' : 'Conta da API';
    }
    if (els.registerNote) {
      els.registerNote.classList.toggle('hidden', !isRegister);
      els.registerNote.classList.toggle('is-warn', isRegister && !registrationOpen);
      els.registerNote.textContent = isRegister
        ? (registrationOpen
          ? 'O primeiro cadastro cria a conta administradora da API. Depois disso, novos cadastros podem ser fechados.'
          : 'O cadastro está fechado porque a conta administradora já foi criada. Entre com sua conta ou peça acesso ao administrador.')
        : '';
    }
    setAuthMessage('', '');
  }

  function setAuthUi(user) {
    authUser = user || null;
    if (els.accountOpen) {
      els.accountOpen.textContent = authUser
        ? (authUser.display_name || authUser.email || 'Conta')
        : 'Entrar';
      els.accountOpen.title = authUser ? (authUser.email || 'Conta da API') : 'Entrar na conta da API';
    }
    if (els.registerOpen) {
      els.registerOpen.classList.toggle('hidden', Boolean(authUser) || !registrationOpen);
    }
    if (els.accountLogout) els.accountLogout.classList.toggle('hidden', !authUser);
    if (els.accountEmail && authUser && authUser.email && !els.accountEmail.value) {
      els.accountEmail.value = authUser.email;
    }
    if (els.accountState) {
      els.accountState.textContent = authUser
        ? 'Conectado como ' + (authUser.email || 'usuário da API')
        : (getToken() ? 'Token salvo, mas a sessão não foi validada.' : 'Nenhuma conta conectada.');
      els.accountState.classList.toggle('is-online', Boolean(authUser));
      els.accountState.classList.toggle('is-offline', !authUser);
    }
  }

  function applyRegistrationState(status) {
    registrationOpen = Boolean(status && status.registration_open);
    if (!registrationOpen && accountMode === 'register') setAccountMode('login');
    else setAccountMode(accountMode);
    if (els.registerOpen) {
      els.registerOpen.classList.toggle('hidden', Boolean(authUser) || !registrationOpen);
    }
  }

  function refreshRegistrationState() {
    return authStatus().then(function (status) {
      applyRegistrationState(status);
      return status;
    }).catch(function () {
      applyRegistrationState(null);
      return null;
    });
  }

  function resolveAuth() {
    return authMe()
      .then(function (user) { setAuthUi(user); return user; })
      .catch(function () {
        return authStatus().then(function (status) {
          applyRegistrationState(status);
          if (status && status.authenticated) {
            return authMe().then(function (user) {
              setAuthUi(user);
              return user;
            }).catch(function () { setAuthUi(null); return null; });
          }
          setAuthUi(null);
          return null;
        }).catch(function () { setAuthUi(null); return null; });
      });
  }

  function authError(err) {
    if (err && err.status === 403 && /cadastro|registration/i.test(err.message || '')) {
      return 'O cadastro está fechado. A conta administradora já foi criada — entre com sua conta ou peça acesso ao administrador.';
    }
    return (err && err.message) ? err.message : 'Não foi possível concluir a operação.';
  }

  function setAuthBusy(busy) {
    authBusy = busy;
    if (els.accountSubmit) {
      els.accountSubmit.disabled = busy || (accountMode === 'register' && !registrationOpen);
    }
    if (els.accountLogout) els.accountLogout.disabled = busy;
  }

  function doLogin() {
    var email = els.accountEmail ? els.accountEmail.value.trim() : '';
    var senha = els.accountPassword ? els.accountPassword.value : '';
    if (!email || !senha) {
      setAuthMessage('Informe e-mail e senha.', 'error');
      return;
    }
    setAuthBusy(true);
    setAuthMessage('Entrando…', '');
    authLogin(email, senha).then(function (user) {
      setAuthUi(user);
      config.token = getToken() || config.token;
      if (els.apiToken) els.apiToken.value = getToken() || '';
      saveConfig(config);
      if (els.accountPassword) els.accountPassword.value = '';
      setAuthMessage('Sessão iniciada como ' + (user.email || email) + '.', 'ok');
      closeAccount();
      checkHealth();
    }).catch(function (err) {
      setAuthMessage(authError(err), 'error');
      setStatus('auth', 'entrar');
    }).finally(function () { setAuthBusy(false); });
  }

  function doRegister() {
    var email = els.accountEmail ? els.accountEmail.value.trim() : '';
    var senha = els.accountPassword ? els.accountPassword.value : '';
    var confirm = els.accountConfirm ? els.accountConfirm.value : '';

    if (!registrationOpen) {
      setAuthMessage('O cadastro está fechado. Entre com sua conta ou peça acesso ao administrador.', 'error');
      return;
    }
    if (!email || !senha) {
      setAuthMessage('Informe e-mail e senha para criar a conta.', 'error');
      return;
    }
    if (senha.length < 8) {
      setAuthMessage('A senha deve ter ao menos 8 caracteres.', 'error');
      return;
    }
    if (senha !== confirm) {
      setAuthMessage('As senhas não coincidem.', 'error');
      return;
    }

    setAuthBusy(true);
    setAuthMessage('Criando conta…', '');
    authRegister({ email: email, senha: senha }).then(function () {
      if (getToken()) return resolveAuth();
      return authLogin(email, senha);
    }).then(function (user) {
      setAuthUi(user);
      registrationOpen = false;
      config.token = getToken() || config.token;
      if (els.apiToken) els.apiToken.value = getToken() || '';
      saveConfig(config);
      if (els.accountPassword) els.accountPassword.value = '';
      if (els.accountConfirm) els.accountConfirm.value = '';
      setAuthMessage('Conta criada e sessão iniciada.', 'ok');
      closeAccount();
      checkHealth();
    }).catch(function (err) {
      setAuthMessage(authError(err), 'error');
    }).finally(function () { setAuthBusy(false); });
  }

  function doLogout() {
    setAuthBusy(true);
    authLogout().finally(function () {
      clearApiSession();
      config.token = '';
      if (els.apiToken) els.apiToken.value = '';
      saveConfig(config);
      setAuthUi(null);
      setAuthMessage('Sessão encerrada.', 'ok');
      setStatus('auth', 'entrar');
      setAuthBusy(false);
      refreshRegistrationState();
    });
  }

  function openAccount(mode) {
    if (!els.accountDialog) return;
    var requested = mode === 'register' ? 'register' : 'login';

    if (els.accountEmail && authUser && authUser.email) els.accountEmail.value = authUser.email;
    if (els.accountPassword) els.accountPassword.value = '';
    if (els.accountConfirm) els.accountConfirm.value = '';
    setAccountMode(requested);
    setAuthUi(authUser);

    if (typeof els.accountDialog.showModal === 'function') els.accountDialog.showModal();
    else els.accountDialog.setAttribute('open', '');

    setTimeout(function () {
      if (els.accountEmail) els.accountEmail.focus();
    }, 60);

    refreshRegistrationState().then(function () {
      setAccountMode(requested);
      if (els.accountPassword) els.accountPassword.value = '';
      if (els.accountConfirm) els.accountConfirm.value = '';
    });
  }

  function closeAccount() {
    if (!els.accountDialog) return;
    if (typeof els.accountDialog.close === 'function') els.accountDialog.close();
    else els.accountDialog.removeAttribute('open');
  }

  if (els.accountOpen) {
    els.accountOpen.addEventListener('click', function () { openAccount('login'); });
  }
  if (els.registerOpen) {
    els.registerOpen.addEventListener('click', function () { openAccount('register'); });
  }
  if (els.tabLogin) els.tabLogin.addEventListener('click', function () { setAccountMode('login'); });
  if (els.tabRegister) {
    els.tabRegister.addEventListener('click', function () {
      if (!registrationOpen) {
        setAuthMessage('O cadastro está fechado. Entre com sua conta ou peça acesso ao administrador.', 'error');
        return;
      }
      setAccountMode('register');
    });
  }
  if (els.accountClose) els.accountClose.addEventListener('click', closeAccount);
  if (els.accountLogout) els.accountLogout.addEventListener('click', doLogout);
  if (els.accountForm) {
    els.accountForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (authBusy) return;
      if (accountMode === 'register') doRegister();
      else doLogin();
    });
  }
  if (els.accountDialog) {
    els.accountDialog.addEventListener('click', function (ev) {
      if (ev.target === els.accountDialog) closeAccount();
    });
  }

  /* ----------------------------- Dialog ---------------------------------- */

  function openSettings() {
    if (!els.dialog) return;
    els.apiBase.value = config.apiBase;
    els.apiToken.value = getToken() || config.token;
    els.model.value = config.model;
    els.dialogMsg.textContent = '';
    if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
    else els.dialog.setAttribute('open', '');
  }

  function closeSettings() {
    if (!els.dialog) return;
    if (typeof els.dialog.close === 'function') els.dialog.close();
    else els.dialog.removeAttribute('open');
  }

  if (els.settingsOpen) els.settingsOpen.addEventListener('click', openSettings);
  if (els.dialogClose) els.dialogClose.addEventListener('click', closeSettings);
  if (els.dialogCancel) {
    els.dialogCancel.addEventListener('click', function (ev) {
      ev.preventDefault();
      closeSettings();
    });
  }

  if (els.dialogForm) {
    els.dialogForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var base = (els.apiBase.value || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(base)) {
        els.dialogMsg.textContent = 'Informe uma URL começando com http:// ou https://.';
        return;
      }
      var tokenValue = els.apiToken.value.trim();
      if (tokenValue) setToken(tokenValue);
      saveConfig({
        apiBase: base,
        token: tokenValue,
        model: els.model.value.trim()
      });
      els.dialogMsg.textContent = '';
      closeSettings();
      checkHealth();
      if (els.input) els.input.focus();
    });
  }

  if (els.dialog) {
    els.dialog.addEventListener('click', function (ev) {
      if (ev.target === els.dialog) closeSettings();
    });
  }

  /* ----------------------------- Boot ------------------------------------ */

  renderAll();
  if (els.empty) showEmpty();
  setAuthUi(authUser);
  setAccountMode('login');
  refreshRegistrationState();
  resolveAuth().then(function () { checkHealth(); });
  setInterval(checkHealth, 60000);
})();
