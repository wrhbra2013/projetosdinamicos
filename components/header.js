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
    '    <p>Bem-vindo à Projetos Dinâmicos Freelas. Conectamos profissionais de TI a projetos incríveis.</p>' +
    '    <hr>' +
    '    <h5>Dúvidas comuns:</h5>' +
    '    <ul>' +
    '      <li><strong>Cadastro:</strong> Crie seu perfil gratuitamente como freelancer ou contratante.</li>' +
    '      <li><strong>Projetos:</strong> Navegue por projetos disponíveis e candidate-se com um clique.</li>' +
    '      <li><strong>Compatibilidade:</strong> Nosso sistema匹配 suas habilidades aos requisitos do projeto.</li>' +
    '    </ul>' +
    '    <p><strong>Email:</strong> <a href="mailto:contato@projetosdinamicos.com.br">contato@projetosdinamicos.com.br</a></p>' +
    '  </div>' +
    '</div>' +
    '<header class="main-header">' +
    '  <div class="incubator-top-bar">' +
    '    <span class="incubator-badge"><i class="bi bi-code-slash"></i> Plataforma de Freelancers TI/Dev</span>' +
    '    <span id="admin-access-area">' +
    '      <a href="' + ROOT + '/login/index.html" id="admin-login-link" style="color:var(--nav-text);text-decoration:none;font-weight:500;font-size:0.85rem"><i class="bi bi-lock"></i> Acesso</a>' +
    '      <span id="admin-logged-in" style="display:none">' +
    '        <span id="admin-label" style="color:var(--brand-primary);font-weight:700;font-size:0.8rem;margin-right:8px;">ADMIN</span>' +
    '        <a href="#" id="admin-logout-link" style="color:var(--danger);text-decoration:none;font-weight:600" onclick="event.preventDefault();adminLogout()"><i class="bi bi-box-arrow-right"></i> Sair</a>' +
    '      </span>' +
    '    </span>' +
    '  </div>' +
    '  <div class="nav-container">' +
    '    <div class="incubator-logo">' +
    '      <div class="incubator-logo-icon"><i class="bi bi-code-slash"></i></div>' +
    '      <div class="incubator-logo-text">' +
    '        <strong>Projetos Dinâmicos</strong>' +
    '        <span>Freelas para TI/Dev</span>' +
    '      </div>' +
    '    </div>' +
    '    <p style="margin:5px 0 0;font-size:0.9rem;color:var(--muted-color);text-align:center">Conectando profissionais de tecnologia a projetos inovadores</p>' +
    '  </div>' +
    '  <nav class="incubator-nav">' +
    '    <a href="' + ROOT + '/index.html"><i class="bi bi-house"></i> Home</a>' +
    '    <a href="' + ROOT + '/pages/projetos.html"><i class="bi bi-briefcase"></i> Projetos</a>' +
    '    <a href="' + ROOT + '/pages/freelancers.html"><i class="bi bi-people"></i> Freelancers</a>' +
    '    <a href="' + ROOT + '/pages/cadastro_freela.html" class="nav-highlight"><i class="bi bi-person-plus"></i> Sou Freelancer</a>' +
    '    <a href="' + ROOT + '/pages/cadastro_cliente.html"><i class="bi bi-building"></i> Sou Cliente</a>' +
    '    <a href="' + ROOT + '/pages/planos.html"><i class="bi bi-card-list"></i> Planos</a>' +
    '    <a href="' + ROOT + '/pages/sobre.html"><i class="bi bi-info-circle"></i> Sobre</a>' +
    '    <a href="' + ROOT + '/pages/contato.html" class="nav-cta"><i class="bi bi-envelope"></i> Contato</a>' +
    '  </nav>' +
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
    { t:"Home", d:"Página inicial da plataforma de freelancers", k:"inicio home principal freelas projetos dinamicos ti dev", i:"bi bi-house", c:"#6366f1", u:"index.html" },
    { t:"Projetos", d:"Encontre projetos de TI e desenvolvimento", k:"projetos vagas trabalhos freelance ti desenvolvimento programacao", i:"bi bi-briefcase", c:"#10b981", u:"pages/projetos.html" },
    { t:"Freelancers", d:"Profissionais de tecnologia disponíveis", k:"freelancers profissionais ti dev programadores designers devops", i:"bi bi-people", c:"#8b5cf6", u:"pages/freelancers.html" },
    { t:"Sou Freelancer", d:"Cadastre-se como freelancer de TI", k:"cadastro freelancer inscrever profissional dev programador designer", i:"bi bi-person-plus", c:"#06b6d4", u:"pages/cadastro_freela.html" },
    { t:"Sou Cliente", d:"Cadastre-se como contratante", k:"cadastro cliente contratante empresa projeto contratar freelancer", i:"bi bi-building", c:"#f59e0b", u:"pages/cadastro_cliente.html" },
    { t:"Planos", d:"Planos e benefícios da plataforma", k:"planos precos beneficios assinatura premium comissao", i:"bi bi-card-list", c:"#ec4899", u:"pages/planos.html" },
    { t:"Sobre", d:"Conheça a plataforma Projetos Dinâmicos", k:"sobre nos historia missao quem-somos equipe plataforma", i:"bi bi-info-circle", c:"#0ea5e9", u:"pages/sobre.html" },
    { t:"Contato", d:"Entre em contato com a plataforma", k:"contato fale-conosco email telefone suporte", i:"bi bi-envelope", c:"#14b8a6", u:"pages/contato.html" },
    { t:"Parceria", d:"Seja um parceiro da plataforma", k:"parceria parceiro empresa apoiar anunciar divulgar", i:"bi bi-handshake", c:"#6366f1", u:"pages/parceria.html" },
    { t:"Politica de Privacidade", d:"Termos e política de privacidade", k:"politica privacidade termos dados LGPD protecao informacao", i:"bi bi-shield-lock", c:"#6b7280", u:"pages/policy.html" },
    { t:"Admin", d:"Painel administrativo da plataforma", k:"admin administrador login acesso gestao painel sistema entrar", i:"bi bi-lock", c:"#64748b", u:"login/index.html" }
  ];

  var API_SECTIONS = [
    { t:"Projetos", d:"Projetos disponíveis para freelancers", k:"projeto vaga trabalho freelance", i:"bi bi-briefcase", c:"#10b981", e:"projetos", f:"titulo" },
    { t:"Freelancers", d:"Profissionais cadastrados", k:"freelancer profissional dev programador", i:"bi bi-people", c:"#8b5cf6", e:"freelancers", f:"nome" },
    { t:"Clientes", d:"Empresas contratantes", k:"cliente empresa contratante", i:"bi bi-building", c:"#f59e0b", e:"clientes", f:"nome" },
    { t:"Eventos", d:"Eventos da comunidade", k:"evento workshop hackathon networking", i:"bi bi-calendar-event", c:"#f59e0b", e:"eventos", f:"titulo" },
    { t:"Parcerias", d:"Empresas parceiras", k:"parceria parceiro empresa investidor", i:"bi bi-handshake", c:"#6366f1", e:"parceria", f:"empresa" },
    { t:"Recursos", d:"Materiais educativos", k:"recurso guia template ebook ferramenta", i:"bi bi-book", c:"#ec4899", e:"recursos", f:"titulo" }
  ];

  function highlightText(text, query) {
    if (!query) return text;
    var words = query.toLowerCase().split(/[\s,;\-]+/).filter(function(w){ return w.length > 0; });
    var result = text;
    for (var i = 0; i < words.length; i++) {
      var re = new RegExp('(' + words[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      result = result.replace(re, '<mark style="background:#e0e7ff;color:#3730a3;padding:0 2px;border-radius:2px">$1</mark>');
    }
    return result;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  var API_SEARCH_MAP = {
    projetos: { i: 'bi bi-briefcase', c: '#10b981' },
    freelancers: { i: 'bi bi-people', c: '#8b5cf6' },
    clientes: { i: 'bi bi-building', c: '#f59e0b' },
    eventos: { i: 'bi bi-calendar-event', c: '#f59e0b' },
    parceria: { i: 'bi bi-handshake', c: '#6366f1' },
    recursos: { i: 'bi bi-book', c: '#ec4899' }
  };

  function apiSearch(q, callback) {
    var BASE = window.API_BASE || 'https://api.projetosdinamicos.com.br/freelas';
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
      projetos: 'pages/projetos.html',
      freelancers: 'pages/freelancers.html',
      clientes: 'pages/cadastro_cliente.html',
      eventos: 'pages/eventos.html',
      parceria: 'pages/parceria.html',
      recursos: 'pages/recursos.html'
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
    var key = 'freelas_page_visits';
    try {
      var visits = JSON.parse(localStorage.getItem(key) || '{}');
      visits[page] = (visits[page] || 0) + 1;
      localStorage.setItem(key, JSON.stringify(visits));
    } catch(e) {}
  }

  function updateSearchPlaceholder() {
    var input = document.getElementById('site-search');
    if (!input) return;

    var defaultText = 'Pesquisar na plataforma...';

    try {
      var visits = JSON.parse(localStorage.getItem('freelas_page_visits') || '{}');
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
    var token = localStorage.getItem('freelas_token');
    var expiry = parseInt(localStorage.getItem('freelas_session_expiry') || '0', 10);
    if (token && Date.now() > expiry) {
      localStorage.removeItem('freelas_token');
      localStorage.removeItem('freelas_usuario');
      localStorage.removeItem('freelas_session_expiry');
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
    localStorage.removeItem('freelas_token');
    localStorage.removeItem('freelas_usuario');
    localStorage.removeItem('freelas_session_expiry');
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
