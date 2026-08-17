(function(){
  var s = document.currentScript;
  if (!s) return;

  var base = window.ROOT || '.';

  var navHtml =
    '<header class="main-header">' +
    '  <div class="incubator-top-bar">' +
    '    <span class="incubator-badge"><i class="bi bi-headphones"></i> Chrome Extension</span>' +
    '  </div>' +
    '  <div class="nav-container">' +
    '    <div class="incubator-logo">' +
    '      <div class="incubator-logo-icon"><i class="bi bi-headphones"></i></div>' +
    '      <div class="incubator-logo-text">' +
    '        <strong>Podcast Search</strong>' +
    '        <span>Player & Agregador</span>' +
    '      </div>' +
    '    </div>' +
    '  </div>' +
    '  <nav class="incubator-nav">' +
    '    <a href="' + base + '/index.html"><i class="bi bi-house"></i> Home</a>' +
    '    <a href="' + base + '/index.html#features"><i class="bi bi-stars"></i> Funcionalidades</a>' +
    '    <a href="' + base + '/pages/planos.html"><i class="bi bi-card-list"></i> Planos</a>' +
    '    <a href="' + base + '/pages/privacy.html"><i class="bi bi-shield-lock"></i> Privacidade</a>' +
    '    <a href="https://chrome.google.com/webstore" target="_blank" class="nav-cta"><i class="bi bi-download"></i> Instalar</a>' +
    '  </nav>' +
    '</header>';

  s.insertAdjacentHTML('afterend', navHtml);

  var navLinks = document.querySelectorAll('.incubator-nav a');
  var currentPath = window.location.pathname;
  var currentHash = window.location.hash;

  navLinks.forEach(function(link) {
    var href = link.getAttribute('href') || '';
    var isActive = false;

    if (currentHash && href.indexOf(currentHash) !== -1) {
      isActive = true;
    } else if (!currentHash) {
      var linkPath = href.replace(/^https?:\/\/[^\/]+/, '');
      if (linkPath === currentPath || linkPath === currentPath.replace(/\/$/, '') + '/index.html') {
        isActive = true;
      }
    }

    if (isActive) {
      link.style.background = 'var(--brand-primary)';
      link.style.color = '#fff';
    }
  });
})();