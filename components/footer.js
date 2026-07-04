(function(){
  var s = document.currentScript;
  if (!s) return;
  var ROOT = window.ROOT || '.';

  s.insertAdjacentHTML('afterend',
    '<script src="' + ROOT + '/static/js/main.js"><\/script>' +
    '<footer>' +
    '  <div class="footer-content">' +
    '    <div class="footer-grid">' +
    '      <div class="footer-col">' +
    '        <h4><i class="bi bi-code-slash"></i> Projetos Dinâmicos</h4>' +
    '        <p>Plataforma de freelancers de tecnologia que conecta profissionais de TI a projetos inovadores. Grátis para freelancers.</p>' +
    '      </div>' +
    '      <div class="footer-col">' +
    '        <h4>Plataforma</h4>' +
    '        <ul>' +
    '          <li><a href="' + ROOT + '/pages/projetos.html">Projetos</a></li>' +
    '          <li><a href="' + ROOT + '/pages/freelancers.html">Freelancers</a></li>' +
    '          <li><a href="' + ROOT + '/pages/planos.html">Planos</a></li>' +
    '          <li><a href="' + ROOT + '/pages/sobre.html">Sobre Nós</a></li>' +
    '        </ul>' +
    '      </div>' +
    '      <div class="footer-col">' +
    '        <h4>Para Freelancers</h4>' +
    '        <ul>' +
    '          <li><a href="' + ROOT + '/pages/cadastro_freela.html">Cadastre-se Grátis</a></li>' +
    '          <li><a href="' + ROOT + '/pages/projetos.html">Ver Projetos</a></li>' +
    '          <li><a href="' + ROOT + '/pages/recursos.html">Recursos</a></li>' +
    '          <li><a href="' + ROOT + '/pages/eventos.html">Eventos</a></li>' +
    '        </ul>' +
    '      </div>' +
    '      <div class="footer-col">' +
    '        <h4>Contato</h4>' +
    '        <ul>' +
    '          <li><i class="bi bi-envelope"></i> <a href="mailto:contato@projetosdinamicos.com.br">contato@projetosdinamicos.com.br</a></li>' +
    '          <li><i class="bi bi-geo-alt"></i> Marília, SP</li>' +
    '          <li><i class="bi bi-clock"></i> Seg-Sex: 9h às 18h</li>' +
    '        </ul>' +
    '      </div>' +
    '    </div>' +
    '    <div class="footer-divider"></div>' +
    '    <div class="footer-bottom">' +
    '      <p class="footer-copyright">&copy; 2026 Projetos Dinâmicos Freelas. Todos os direitos reservados.</p>' +
    '      <div class="footer-social">' +
    '        <a href="https://www.linkedin.com" target="_blank" aria-label="LinkedIn"><i class="bi bi-linkedin"></i></a>' +
    '        <a href="https://www.instagram.com" target="_blank" aria-label="Instagram"><i class="bi bi-instagram"></i></a>' +
    '        <a href="https://www.youtube.com" target="_blank" aria-label="YouTube"><i class="bi bi-youtube"></i></a>' +
    '        <a href="https://github.com" target="_blank" aria-label="GitHub"><i class="bi bi-github"></i></a>' +
    '      </div>' +
    '    </div>' +
    '  </div>' +
    '</footer>'
  );
})();
