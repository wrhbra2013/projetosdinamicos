(function(){
  var s = document.currentScript;
  if (!s) return;
  var ROOT = window.ROOT || '.';

  var footerHtml =
    '<footer>' +
    '  <div class="footer-content">' +
    '    <div class="footer-grid">' +
    '      <div class="footer-col">' +
    '        <h4><i class="bi bi-headphones"></i> Podcast Search & Player</h4>' +
    '        <p>Extensao para Chrome que buscou e reproduz podcasts de multiplas fontes em um so lugar.</p>' +
    '      </div>' +
    '      <div class="footer-col">' +
    '        <h4>Navegacao</h4>' +
    '        <ul>' +
    '          <li><a href="' + ROOT + '/index.html">Home</a></li>' +
    '          <li><a href="' + ROOT + '/index.html#features">Funcionalidades</a></li>' +
    '          <li><a href="' + ROOT + '/pages/planos.html">Planos</a></li>' +
    '          <li><a href="' + ROOT + '/pages/privacy.html">Politica de Privacidade</a></li>' +
    '        </ul>' +
    '      </div>' +
    '      <div class="footer-col">' +
    '        <h4>Fontes Suportadas</h4>' +
    '        <ul>' +
    '          <li><i class="bi bi-youtube"></i> YouTube</li>' +
    '          <li><i class="bi bi-spotify"></i> Spotify</li>' +
    '          <li><i class="bi bi-archive"></i> Archive.org</li>' +
    '          <li><i class="bi bi-rss"></i> RSS Direto</li>' +
    '          <li><i class="bi bi-podcast"></i> Podcast Index</li>' +
    '        </ul>' +
    '      </div>' +
    '      <div class="footer-col">' +
    '        <h4>Contato</h4>' +
    '        <ul>' +
    '          <li><i class="bi bi-envelope"></i> <a href="mailto:contato@projetosdinamicos.com.br">contato@projetosdinamicos.com.br</a></li>' +
    '        </ul>' +
    '      </div>' +
    '    </div>' +
    '    <div class="footer-divider"></div>' +
    '    <div class="footer-bottom">' +
    '      <p class="footer-copyright">&copy; 2026 Projetos Dinamicos. Todos os direitos reservados.</p>' +
    '    </div>' +
    '  </div>' +
    '</footer>';

  s.insertAdjacentHTML('afterend', footerHtml);
})();