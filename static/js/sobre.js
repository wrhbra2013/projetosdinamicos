document.addEventListener('DOMContentLoaded', function() {
    var container = document.getElementById('volunteersContainer');

    apiFetch('/voluntario')
      .then(function(r) { return r.json(); })
      .then(function(voluntarios) {
        if (!voluntarios || !voluntarios.length) {
          container.innerHTML = '<p class="text-center text-muted" style="width:100%;">Nenhum volunt\u00e1rio cadastrado.</p>';
          return;
        }
        var cores = ['var(--brand-teal)', 'var(--brand-coral)', 'var(--brand-purple)', 'var(--brand-blue)', 'var(--brand-green)', 'var(--brand-yellow)'];
        voluntarios.forEach(function(v, i) {
          var card = document.createElement('div');
          card.className = 'volunteer-card';
          var inicial = (v.nome || '?').charAt(0).toUpperCase();
          card.innerHTML =
            '<div class="volunteer-avatar" style="background:' + cores[i % cores.length] + ';">' + inicial + '</div>' +
            '<h3 class="volunteer-name">' + esc(v.nome) + '</h3>' +
            (v.localidade ? '<div class="volunteer-location"><i class="bi bi-geo-alt"></i> ' + esc(v.localidade) + '</div>' : '') +
            (v.habilidade ? '<div class="volunteer-skill"><strong>Habilidade:</strong> ' + esc(v.habilidade) + '</div>' : '') +
            (v.mensagem ? '<div class="volunteer-message">"' + esc(v.mensagem) + '"</div>' : '') +
            (v.origem ? '<div class="volunteer-date"><i class="bi bi-calendar-event me-1"></i> ' + new Date(v.origem).toLocaleDateString('pt-BR') + '</div>' : '');
          container.appendChild(card);
        });
      })
      .catch(function() {
        container.innerHTML = '<p class="text-center text-muted" style="width:100%;">Erro ao carregar volunt\u00e1rios.</p>';
      });

    var volunteerCards = function() { return container.querySelectorAll('.volunteer-card'); };

    function scrollVolunteers(direction) {
        var cards = volunteerCards();
        if (!container || cards.length === 0) return;
        var cardWidth = cards[0].offsetWidth;
        var gap = 25;
        var scrollAmount = cardWidth + gap;
        if (direction === 'prev') {
            container.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
        } else {
            container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        }
    }

    window.scrollVolunteers = scrollVolunteers;

    var autoScrollInterval;
    var isPaused = false;

    function startAutoScroll() {
        if (window.innerWidth > 768) return;
        autoScrollInterval = setInterval(function() {
            if (!isPaused && container) {
                var maxScroll = container.scrollWidth - container.clientWidth;
                if (container.scrollLeft >= maxScroll - 10) {
                    container.scrollTo({ left: 0, behavior: 'smooth' });
                } else {
                    container.scrollBy({ left: 200, behavior: 'smooth' });
                }
            }
        }, 3000);
    }

    if (container) {
        container.addEventListener('mouseenter', function() { isPaused = true; });
        container.addEventListener('mouseleave', function() { isPaused = false; });
    }

    startAutoScroll();

    window.addEventListener('beforeunload', function() {
        if (autoScrollInterval) clearInterval(autoScrollInterval);
    });
});

function esc(s) {
  if (!s) return '';
  var e = document.createElement('div');
  e.appendChild(document.createTextNode(s));
  return e.innerHTML;
}
