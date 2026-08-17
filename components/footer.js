(function(){
  var s = document.currentScript;
  if (!s) return;
  var ROOT = window.ROOT || '.';

  s.insertAdjacentHTML('afterend',
    '<footer>' +
    '  <div class="footer-content">' +
    '    <div class="footer-grid">' +
    '      <div class="footer-col">' +
    '        <h4><i class="bi bi-headphones"></i> Podcast Search & Player</h4>' +
    '        <p>Extensao para Chrome que agrega podcasts de multiplas fontes. Busque, ouca e organize seus episodios favoritos.</p>' +
    '      </div>' +
    '      <div class="footer-col">' +
    '        <h4>Links</h4>' +
    '        <ul>' +
    '          <li><a href="' + ROOT + '/index.html">Home</a></li>' +
    '          <li><a href="' + ROOT + '/index.html#features">Funcionalidades</a></li>' +
    '          <li><a href="' + ROOT + '/pages/planos.html">Planos</a></li>' +
    '          <li><a href="' + ROOT + '/pages/privacy.html">Politica de Privacidade</a></li>' +
    '        </ul>' +
    '      </div>' +
    '      <div class="footer-col">' +
    '        <h4>Fontes de Podcast</h4>' +
    '        <ul>' +
    '          <li><i class="bi bi-youtube"></i> YouTube</li>' +
    '          <li><i class="bi bi-spotify"></i> Spotify</li>' +
    '          <li><i class="bi bi-archive"></i> Archive.org</li>' +
    '          <li><i class="bi bi-rss"></i> RSS Direto</li>' +
    '        </ul>' +
    '      </div>' +
    '      <div class="footer-col">' +
    '        <h4>Contato</h4>' +
    '        <ul>' +
    '          <li><i class="bi bi-envelope"></i> <a href="mailto:contato@projetosdinamicos.com.br">contato@projetosdinamicos.com.br</a></li>' +
    '          <li><i class="bi bi-globe"></i> projetosdinamicos.com.br</li>' +
    '        </ul>' +
    '      </div>' +
    '    </div>' +
    '    <div class="footer-divider"></div>' +
    '    <div class="footer-bottom">' +
    '      <p class="footer-copyright">&copy; 2026 Projetos Dinamicos. Todos os direitos reservados.</p>' +
    '      <div class="footer-social">' +
    '        <a href="https://github.com" target="_blank" aria-label="GitHub"><i class="bi bi-github"></i></a>' +
    '      </div>' +
    '    </div>' +
    '  </div>' +
    '</footer>'
  );
})();