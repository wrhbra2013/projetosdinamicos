(function(){
  var s = document.currentScript;
  if (!s) return;
  var ROOT = window.ROOT || '.';

  s.insertAdjacentHTML('afterend',
    '<input type="checkbox" id="search-panel-toggle" class="css-toggle-checkbox">' +
    '<input type="checkbox" id="contrast-toggle" class="css-toggle-checkbox">' +
    '<label for="contrast-toggle" class="contrast-label" aria-label="Alternar alto contraste"><i class="bi bi-eye"></i></label>' +
    '<input type="checkbox" id="help-toggle" class="help-checkbox">' +
    '<label for="help-toggle" class="help-label" aria-label="Ajuda"><i class="bi bi-info-circle"></i></label>' +
    '<div class="help-dropdown">' +
    '  <div class="help-content">' +
    '    <h4>Ajuda</h4>' +
    '    <p>Em caso de erros, d&uacute;vidas ou sugest&otilde;es entre em contato conosco.</p>' +
    '    <hr>' +
    '    <h5>Erros comuns:</h5>' +
    '    <ul>' +
    '      <li><strong>Pet n&atilde;o adicionado:</strong> Preencha Nome, Esp&eacute;cie e Sexo do pet.</li>' +
    '      <li><strong>Inscri&ccedil;&atilde;o n&atilde;o enviada:</strong> Verifique se todos os campos obrigat&oacute;rios est&atilde;o preenchidos.</li>' +
    '      <li><strong>Vagas esgotadas:</strong> O mutir&atilde;o atingiu o limite de vagas.</li>' +
    '      <li><strong>Mutir&atilde;o encerrado:</strong> As inscri&ccedil;&otilde;es foram encerradas ap&oacute;s a data do evento.</li>' +
    '    </ul>' +
    '    <p>E deixe o seu melhor contato.</p>' +
    '    <p><strong>Email:</strong> <a href="mailto:amoranimalmariliadev@gmail.com">amoranimalmariliadev@gmail.com</a></p>' +
    '  </div>' +
    '</div>' +
    '<header class="main-header">' +
    '  <main class="main-header-controls"></main>' +
    '  <div style="text-align:center;padding:10px 0 0">' +
    '    <span id="admin-access-area">' +
    '      <a href="' + ROOT + '/login/index.html" id="admin-login-link" style="color:var(--brand-teal);text-decoration:none;font-weight:600"><i class="bi bi-lock"></i> Acesso</a>' +
      '      <span id="admin-logged-in" style="display:none">' +
      '        <span id="admin-label" style="color:var(--brand-teal);font-weight:700;font-size:0.8rem;margin-right:8px;">ADMINISTRADOR</span>' +
      '        <a href="#" id="admin-logout-link" style="color:var(--brand-coral);text-decoration:none;font-weight:600" onclick="event.preventDefault();adminLogout()"><i class="bi bi-box-arrow-right"></i> Sair</a>' +
      '      </span>' +
    '    </span>' +
    '  </div>' +
    '  <div class="nav-container">' +
    '    <img src="' + ROOT + '/static/css/imagem/ong.jpg" alt="Logo ONG AMOR ANIMAL MARILIA" />' +
    '    <p style="margin:5px 0 0;font-size:0.9rem;color:var(--muted-color);text-align:center">Sistema de Gestao de Dados da ONG</p>' +
    '  </div>' +
    '  <div class="search-wrapper">' +
    '    <div class="search-bar-row">' +
    '      <a href="' + ROOT + '/index.html" class="search-home-btn" aria-label="Ir para pagina inicial"><i class="bi bi-house-door-fill"></i></a>' +
    '      <div class="search-inner">' +
    '        <input type="text" id="site-search" class="search-input" autocomplete="off" aria-label="Pesquisar" role="combobox" aria-expanded="false" aria-controls="search-results">' +
    '        <i class="bi bi-search search-icon"></i>' +
    '        <button type="button" id="search-clear" class="search-clear-btn" aria-label="Limpar pesquisa"><i class="bi bi-x-lg"></i></button>' +
    '      </div>' +
    '    </div>' +
    '    <div id="search-results" class="search-results-box" role="listbox"></div>' +
    '  </div>' +
    '</header>' +
    '<label for="search-panel-toggle" id="search-overlay" class="search-overlay"></label>' +
    '<div id="search-panel" class="search-panel">' +
    '  <div class="search-panel-header">' +
    '    <div class="search-panel-count" id="search-panel-count">Resultados da busca</div>' +
    '    <label for="search-panel-toggle" class="search-panel-close" aria-label="Fechar">&times;</label>' +
    '  </div>' +
    '  <div class="search-panel-results" id="search-panel-results" role="listbox"></div>' +
    '</div>'
  );

  var PAGES = [
    { t:"Inicio", d:"Pagina inicial da ONG Amor Animal", k:"inicio home principal ong amor animal marilia site entrada", i:"bi bi-house-door", c:"#14b8a6", u:"index.html" },
    { t:"Adocao", d:"Animais disponiveis para adocao responsavel", k:"adocao adotar adote adocao-responsavel pet cachorro gato cao caes felino filhote lar familia quero-adotar", i:"bi bi-paw", c:"#f59e0b", u:"pages/adocao.html" },
    { t:"Castracao", d:"Central de agendamento de castracao", k:"castracao castrar castracao-central cirurgia veterinario veterinaria animal animais esterilizar", i:"bi bi-person-heart", c:"#10b981", u:"pages/castracao.html" },
    { t:"Castracao Baixo Custo", d:"Castracao com valor social reduzido", k:"castracao castrar baixo-custo valor-social barato economico precos preco cirurgia veterinario castracao-preco", i:"bi bi-cash", c:"#059669", u:"pages/castracao_baixo_custo.html" },
    { t:"Mutirao de Castracao", d:"Mutiroes gratuitos de castracao", k:"castracao mutirao mutirao-castracao gratuito gratis castracao-gratuita evento castrar cirurgia coletivo inscricao", i:"bi bi-people", c:"#047857", u:"pages/castracao_mutirao.html" },
    { t:"Inscricao Mutirao", d:"Formulario de inscricao para mutirao de castracao", k:"castracao mutirao inscricao inscrever formulario cadastro vagas castracao-gratuita", i:"bi bi-pencil-square", c:"#065f46", u:"pages/castracao_mutirao_form.html" },
    { t:"Pets de Rua", d:"Castracao para animais de rua", k:"castracao pets-rua rua animal-anonimo comunidade cuidado veterinario", i:"bi bi-heart", c:"#dc2626", u:"pages/castracao_pets_rua.html" },
    { t:"Castracao Sucesso", d:"Confirmacao de inscricao de castracao", k:"castracao sucesso confirmacao inscricao realizada comprovante ticket protocolo", i:"bi bi-check-circle", c:"#16a34a", u:"pages/castracao_sucesso.html" },
    { t:"Procura-se", d:"Animais desaparecidos divulgacao", k:"procura-se perdido desaparecido busca sumido cachorro gato cao animal localizar encontrar", i:"bi bi-search", c:"#f97316", u:"pages/procura_se.html" },
    { t:"Anunciar Desaparecimento", d:"Cadastro de animal desaparecido", k:"procura-se cadastro anunciar desaparecimento perdido sumido divulgar busca animal cachorro gato", i:"bi bi-megaphone", c:"#ea580c", u:"pages/cadastro_procura_se.html" },
    { t:"Doacao", d:"Contribua com doacoes via PIX ou cartao", k:"doacao doar contribuir pix dinheiro ajuda financeira doe contribuicao cartao credito debito ajuda", i:"bi bi-gift", c:"#8b5cf6", u:"pages/doacao.html" },
    { t:"Parceria", d:"Seja um parceiro apoiador da ONG", k:"parceria parceiro empresa apoiar patrocinio apoio corporativo responsabilidade-social", i:"bi bi-handshake", c:"#14b8a6", u:"pages/parceria.html" },
    { t:"Voluntario", d:"Cadastro de voluntarios para ajudar a ONG", k:"voluntario voluntariado ajudar trabalho voluntario contribuir tempo doar", i:"bi bi-people-fill", c:"#ec4899", u:"pages/voluntario.html" },
    { t:"Sobre", d:"Conheca a historia e missao da ONG", k:"sobre nos historia missao quem-somos equipe fundacao resgate animais", i:"bi bi-info-circle", c:"#3b82f6", u:"pages/sobre.html" },
    { t:"Transparencia", d:"Prestacao de contas e documentos oficiais", k:"transparencia prestacao-contas contas documentos relatorio financeiro receitas despesas", i:"bi bi-file-text", c:"#6366f1", u:"pages/transparencia.html" },
    { t:"Eventos", d:"Eventos feiras e mutiroes da ONG", k:"eventos feira adocao mutirao castracao agenda calendario bazar beneficente", i:"bi bi-calendar-event", c:"#a855f7", u:"pages/eventos.html" },
    { t:"Politica de Privacidade", d:"Termos e politica de privacidade do site", k:"politica privacidade termos dados LGPD protecao informacao", i:"bi bi-shield-lock", c:"#6b7280", u:"pages/policy.html" },
    { t:"Admin", d:"Painel administrativo e login do sistema", k:"admin administrador login acesso gestao painel sistema entrar", i:"bi bi-lock", c:"#64748b", u:"login/index.html" }
  ];

  var API_SECTIONS = [
    { t:"Eventos na Landing", d:"Eventos cadastrados na pagina inicial", k:"evento agenda calendario programacao", i:"bi bi-calendar-event", c:"#a855f7", e:"eventos", f:"titulo" },
    { t:"Castracoes", d:"Agendamentos de castracao realizados", k:"castracao cirurgia castrar agendamento veterinario", i:"bi bi-person-heart", c:"#10b981", e:"castracao", f:"nome_pet" },
    { t:"Pets para Adocao", d:"Animais disponiveis para adocao", k:"pet cachorro gato cao felino adocao animal", i:"bi bi-paw", c:"#f59e0b", e:"adocao", f:"nome" },
    { t:"Voluntarios", d:"Voluntarios cadastrados no sistema", k:"voluntario voluntariado ajuda contribuir", i:"bi bi-people-fill", c:"#ec4899", e:"voluntario", f:"nome" },
    { t:"Parcerias", d:"Empresas parceiras da ONG", k:"parceria empresa patrocinio apoio parceiro", i:"bi bi-handshake", c:"#14b8a6", e:"parceria", f:"empresa" },
    { t:"Animais Perdidos", d:"Animais desaparecidos divulgacao", k:"procura-se perdido desaparecido sumido busca", i:"bi bi-search", c:"#f97316", e:"procura_se", f:"nome" }
  ];

  function highlightText(text, query) {
    if (!query) return text;
    var words = query.toLowerCase().split(/[\s,;\-]+/).filter(function(w){ return w.length > 0; });
    var result = text;
    for (var i = 0; i < words.length; i++) {
      var re = new RegExp('(' + words[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      result = result.replace(re, '<mark style="background:#fef08a;color:#333;padding:0 2px;border-radius:2px">$1</mark>');
    }
    return result;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  var API_SEARCH_MAP = {
    eventos: { i: 'bi bi-calendar-event', c: '#a855f7' },
    castracao: { i: 'bi bi-person-heart', c: '#10b981' },
    adocao: { i: 'bi bi-paw', c: '#f59e0b' },
    voluntario: { i: 'bi bi-people-fill', c: '#ec4899' },
    parceria: { i: 'bi bi-handshake', c: '#14b8a6' },
    procura_se: { i: 'bi bi-search', c: '#f97316' }
  };

  function apiSearch(q, callback) {
    var BASE = window.API_BASE || 'https://api.projetosdinamicos.com.br/amoranimal';
    fetch(BASE + '/search?q=' + encodeURIComponent(q))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var items = [];
        if (data.results) {
          for (var i = 0; i < data.results.length; i++) {
            var r = data.results[i];
            var m = API_SEARCH_MAP[r.tabela];
            if (m) {
              items.push({
                page: {
                  t: r.titulo || '',
                  d: r.descricao || '',
                  i: m.i,
                  c: m.c,
                  e: r.tabela
                },
                score: 5,
                api: true,
                apiData: true
              });
            }
          }
        }
        callback(items);
      })
      .catch(function() { callback([]); });
  }

  var searchCache = {};

  function searchPages(q) {
    var results = document.getElementById('search-results');
    var panelCount = document.getElementById('search-panel-count');
    var panelResults = document.getElementById('search-panel-results');
    var clearBtn = document.getElementById('search-clear');
    if (!results) return;

    if (clearBtn) {
      clearBtn.style.display = (q && q.length > 0) ? 'flex' : 'none';
    }

    if (!q || q.length < 2) {
      results.innerHTML = '';
      if (panelCount) panelCount.innerHTML = 'Resultados da busca';
      if (panelResults) panelResults.innerHTML = '';
      return;
    }

    var words = q.toLowerCase().split(/[\s,;\-]+/).filter(function(w){ return w.length > 0; });
    var found = [];

    for (var i = 0; i < PAGES.length; i++) {
      var p = PAGES[i];
      var text = (p.t + ' ' + p.d + ' ' + p.k).toLowerCase();
      var score = 0;
      for (var w = 0; w < words.length; w++) {
        if (text.indexOf(words[w]) !== -1) {
          score += 1;
          if (p.t.toLowerCase().indexOf(words[w]) !== -1) score += 2;
        }
      }
      if (score > 0) found.push({ page: p, score: score, api: false });
    }

    for (var i = 0; i < API_SECTIONS.length; i++) {
      var s = API_SECTIONS[i];
      var text = (s.t + ' ' + s.d + ' ' + s.k).toLowerCase();
      var score = 0;
      for (var w = 0; w < words.length; w++) {
        if (text.indexOf(words[w]) !== -1) {
          score += 1;
          if (s.t.toLowerCase().indexOf(words[w]) !== -1) score += 2;
        }
      }
      if (score > 0) found.push({ page: s, score: score, api: true });
    }

    found.sort(function(a, b) { return b.score - a.score; });

    renderDropdown(found, q);
    renderPanel(found, q);

    apiSearch(q, function(apiItems) {
      if (!apiItems.length) return;
      var seen = {};
      for (var i = 0; i < found.length; i++) {
        seen[found[i].page.t + '|' + found[i].page.d + '|' + (found[i].page.e || '')] = true;
      }
      for (var i = 0; i < apiItems.length; i++) {
        var key = apiItems[i].page.t + '|' + apiItems[i].page.d + '|' + apiItems[i].page.e;
        if (!seen[key]) {
          found.push(apiItems[i]);
          seen[key] = true;
        }
      }
      found.sort(function(a, b) { return b.score - a.score; });
      renderDropdown(found, q);
      renderPanel(found, q);
    });
  }

  function sectionUrl(s) {
    var map = {
      eventos: 'pages/eventos.html',
      castracao: 'pages/castracao.html',
      adocao: 'pages/adocao.html',
      voluntario: 'pages/voluntario.html',
      parceria: 'pages/parceria.html',
      procura_se: 'pages/procura_se.html'
    };
    return map[s.e] || 'index.html';
  }

  function renderDropdown(found, q) {
    var results = document.getElementById('search-results');
    if (!results) return;

    if (found.length === 0) {
      results.innerHTML = '<div class="sr-none">Nenhum resultado para <strong>' + escapeHtml(q) + '</strong></div>';
    } else {
      var html = '';
      for (var i = 0; i < found.length; i++) {
        var p = found[i].page;
        var url = found[i].api ? sectionUrl(p) : p.u;
        html += '<a href="' + ROOT + '/' + url + '" data-search-link="1" role="option" data-index="' + i + '">';
        html += '<span class="sr-icon" style="background:' + p.c + '"><i class="' + p.i + '"></i></span>';
        html += '<div><div class="sr-title">' + highlightText(p.t, q) + '</div><div class="sr-desc">' + highlightText(p.d, q) + '</div></div>';
        html += '</a>';
      }
      results.innerHTML = html;
    }
  }

  function renderPanel(found, q) {
    var panelResults = document.getElementById('search-panel-results');
    var panelCount = document.getElementById('search-panel-count');
    if (!panelResults) return;

    if (found.length === 0) {
      panelResults.innerHTML = '<div class="sr-none">Nenhum resultado encontrado para <strong>' + escapeHtml(q) + '</strong></div>';
      if (panelCount) panelCount.innerHTML = 'Nenhum resultado';
    } else {
      var html = '';
      for (var i = 0; i < found.length; i++) {
        var p = found[i].page;
        var url = found[i].api ? sectionUrl(p) : p.u;
        html += '<a href="' + ROOT + '/' + url + '" data-search-link="1" role="option" data-index="' + i + '">';
        html += '<span class="sr-icon" style="background:' + p.c + '"><i class="' + p.i + '"></i></span>';
        html += '<div><div class="sr-title">' + highlightText(p.t, q) + '</div><div class="sr-desc">' + highlightText(p.d, q) + '</div></div>';
        html += '</a>';
      }
      panelResults.innerHTML = html;
      if (panelCount) panelCount.innerHTML = '<strong>' + found.length + '</strong> resultado(s) para <strong>' + escapeHtml(q) + '</strong>';
    }
  }

  function trackPageVisit() {
    var page = location.pathname.replace('/projetosdinamicos/', '').replace(/^\//, '') || 'index.html';
    var key = 'page_visits';
    try {
      var visits = JSON.parse(localStorage.getItem(key) || '{}');
      visits[page] = (visits[page] || 0) + 1;
      localStorage.setItem(key, JSON.stringify(visits));
    } catch(e) {}
  }

  function updateSearchPlaceholder() {
    var input = document.getElementById('site-search');
    if (!input) return;

    var defaultText = 'Pesquisar em todo o site...';

    try {
      var visits = JSON.parse(localStorage.getItem('page_visits') || '{}');
      var entries = Object.keys(visits).map(function(k) { return { page: k, count: visits[k] }; });
      entries.sort(function(a, b) { return b.count - a.count; });
      var top4 = entries.slice(0, 4);
      var pageMap = {};
      PAGES.forEach(function(p) {
        var url = p.u.replace(/^\//, '');
        pageMap[url] = p.t;
      });
      var names = [];
      top4.forEach(function(e) {
        var title = pageMap[e.page];
        if (title) names.push(title);
      });
      if (names.length > 0) {
        input.placeholder = 'Pesquisar: ' + names.join(', ');
        return;
      }
    } catch(e) {}

    input.placeholder = defaultText;
  }

  function openPanel() {
    var toggle = document.getElementById('search-panel-toggle');
    if (toggle) toggle.checked = true;
    document.body.style.overflow = 'hidden';
  }

  function initSearch() {
    var input = document.getElementById('site-search');
    var results = document.getElementById('search-results');
    var panelResults = document.getElementById('search-panel-results');
    var toggle = document.getElementById('search-panel-toggle');
    var clearBtn = document.getElementById('search-clear');

    if (!input || !results) return;

    updateSearchPlaceholder();

    function onResultClick(e) {
      var link = e.target.closest('a[data-search-link]');
      if (link) {
        input.value = '';
        results.innerHTML = '';
        if (toggle) toggle.checked = false;
        document.body.style.overflow = '';
      }
    }
    results.addEventListener('click', onResultClick);
    if (panelResults) panelResults.addEventListener('click', onResultClick);

    if (toggle) {
      toggle.addEventListener('change', function() {
        document.body.style.overflow = toggle.checked ? 'hidden' : '';
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        input.value = '';
        results.innerHTML = '';
        input.focus();
      });
    }

    var debounceTimer;
    input.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() { searchPages(input.value); }, 200);
    });

    input.addEventListener('focus', function() {
      if (input.value.length >= 2) {
        searchPages(input.value);
      }
    });

    var selectedIndex = -1;
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        input.blur();
        if (toggle && toggle.checked) {
          toggle.checked = false;
          document.body.style.overflow = '';
        }
        return;
      }

      var links = results.querySelectorAll('a[data-search-link]');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, links.length - 1);
        updateSelection();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelection();
      } else if (e.key === 'Enter') {
        if (selectedIndex >= 0 && links[selectedIndex]) {
          e.preventDefault();
          window.location.href = links[selectedIndex].href;
        }
      } else {
        selectedIndex = -1;
      }

      function updateSelection() {
        links.forEach(function(link, i) {
          link.classList.toggle('selected', i === selectedIndex);
          link.setAttribute('aria-selected', i === selectedIndex ? 'true' : 'false');
          link.style.background = i === selectedIndex ? 'var(--bg-alt)' : '';
        });
      }
    });
  }

  function initAdminUI() {
    var token = localStorage.getItem('amoranimal_token');
    var expiry = parseInt(localStorage.getItem('amoranimal_session_expiry') || '0', 10);
    if (token && Date.now() > expiry) {
      localStorage.removeItem('amoranimal_token');
      localStorage.removeItem('amoranimal_usuario');
      localStorage.removeItem('amoranimal_session_expiry');
      token = null;
    }
    var loginLink = document.getElementById('admin-login-link');
    var loggedIn = document.getElementById('admin-logged-in');
    if (loginLink && loggedIn) {
      loginLink.style.display = token ? 'none' : 'inline';
      loggedIn.style.display = token ? 'inline' : 'none';
    }
    document.body.classList.toggle('admin-mode', !!token);
  }

  window.adminLogout = function() {
    localStorage.removeItem('amoranimal_token');
    localStorage.removeItem('amoranimal_usuario');
    localStorage.removeItem('amoranimal_session_expiry');
    window.location.href = window.location.origin + '/index.html';
  };

  function initContrast() {
    var t = document.getElementById('contrast-toggle');
    if (!t) return;
    if (localStorage.getItem('highContrast') === 'true') {
      document.body.classList.add('high-contrast');
      t.checked = true;
    }
    t.addEventListener('change', function() {
      if (t.checked) {
        document.body.classList.add('high-contrast');
        localStorage.setItem('highContrast', 'true');
      } else {
        document.body.classList.remove('high-contrast');
        localStorage.setItem('highContrast', 'false');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      trackPageVisit();
      initAdminUI();
      initSearch();
      initContrast();
    });
  } else {
    trackPageVisit();
    initAdminUI();
    initSearch();
    initContrast();
  }
})();
