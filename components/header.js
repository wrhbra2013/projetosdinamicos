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
    '    <p>Bem-vindo ao Podcast Search & Player. Busque podcasts em múltiplas fontes e ouça direto no navegador.</p>' +
    '    <hr>' +
    '    <h5>Dúvidas comuns:</h5>' +
    '    <ul>' +
    '      <li><strong>Busca:</strong> Pesquise por nome do podcast, episódio ou palavra-chave.</li>' +
    '      <li><strong>Fontes:</strong> YouTube, Spotify, Archive.org, Podcast Index e RSS direto.</li>' +
    '      <li><strong>Player:</strong> Controle play/pause, volume, anterior/próximo direto na extensão.</li>' +
    '    </ul>' +
    '    <p><strong>Email:</strong> <a href="mailto:contato@projetosdinamicos.com.br">contato@projetosdinamicos.com.br</a></p>' +
    '  </div>' +
    '</div>' +
    '<header class="main-header">' +
    '  <div class="incubator-top-bar">' +
    '    <span class="incubator-badge"><i class="bi bi-headphones"></i> Chrome Extension — Podcast Search & Player</span>' +
    '  </div>' +
    '  <div class="nav-container">' +
    '    <div class="incubator-logo">' +
    '      <div class="incubator-logo-icon"><i class="bi bi-headphones"></i></div>' +
    '      <div class="incubator-logo-text">' +
    '        <strong>Podcast Search</strong>' +
    '        <span>Player & Agregador</span>' +
    '      </div>' +
    '    </div>' +
    '    <p style="margin:5px 0 0;font-size:0.9rem;color:var(--muted-color);text-align:center">Busque, ouça e organize seus podcasts favoritos em um só lugar</p>' +
    '  </div>' +
    '  <nav class="incubator-nav">' +
    '    <a href="' + ROOT + '/index.html"><i class="bi bi-house"></i> Home</a>' +
    '    <a href="' + ROOT + '/index.html#features"><i class="bi bi-stars"></i> Funcionalidades</a>' +
    '    <a href="' + ROOT + '/pages/planos.html"><i class="bi bi-card-list"></i> Planos</a>' +
    '    <a href="' + ROOT + '/pages/privacy.html"><i class="bi bi-shield-lock"></i> Privacidade</a>' +
    '    <a href="https://chrome.google.com/webstore" target="_blank" class="nav-cta"><i class="bi bi-download"></i> Instalar</a>' +
    '  </nav>' +
    '  <div class="search-wrapper">' +
    '    <div class="search-bar-row">' +
    '      <a href="' + ROOT + '/index.html" class="search-home-btn" aria-label="Ir para pagina inicial"><i class="bi bi-house-door-fill"></i></a>' +
    '    </div>' +
    '  </div>' +
    '</header>'
  );

  var PAGES = [
    { t:"Home", d:"Pagina inicial do Podcast Search & Player", k:"inicio home principal podcast search player extensao chrome", i:"bi bi-house", c:"#6366f1", u:"index.html" },
    { t:"Funcionalidades", d:"Recursos e funcionalidades da extensao", k:"funcionalidades features recursos busca podcast player", i:"bi bi-stars", c:"#06b6d4", u:"index.html#features" },
    { t:"Planos", d:"Planos gratuito e premium", k:"planos precos assinatura premium gratuito gratis", i:"bi bi-card-list", c:"#ec4899", u:"pages/planos.html" },
    { t:"Privacidade", d:"Politica de privacidade da extensao", k:"privacidade dados protecao LGPD policy", i:"bi bi-shield-lock", c:"#6b7280", u:"pages/privacy.html" },
    { t:"Instalar no Chrome", d:"Instale a extensao na Chrome Web Store", k:"instalar chrome extension store download", i:"bi bi-download", c:"#10b981", u:"https://chrome.google.com/webstore" }
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

  function searchPages(q) {
    var results = document.getElementById('search-results');
    if (!results) return;

    if (!q || q.length < 2) {
      results.innerHTML = '';
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
      if (score > 0) found.push({ page: p, score: score });
    }

    found.sort(function(a, b) { return b.score - a.score; });

    if (found.length === 0) {
      results.innerHTML = '<div class="sr-none">Nenhum resultado para <strong>' + escapeHtml(q) + '</strong></div>';
    } else {
      var html = '';
      for (var i = 0; i < found.length; i++) {
        var p = found[i].page;
        html += '<a href="' + ROOT + '/' + p.u + '" data-search-link="1" role="option" data-index="' + i + '">';
        html += '<span class="sr-icon" style="background:' + p.c + '"><i class="' + p.i + '"></i></span>';
        html += '<div><div class="sr-title">' + highlightText(p.t, q) + '</div><div class="sr-desc">' + highlightText(p.d, q) + '</div></div>';
        html += '</a>';
      }
      results.innerHTML = html;
    }
  }

  function initSearch() {
    var input = document.getElementById('site-search');
    var results = document.getElementById('search-results');
    if (!input || !results) return;

    var debounceTimer;
    input.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() { searchPages(input.value); }, 200);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      initSearch();
    });
  } else {
    initSearch();
  }
})();