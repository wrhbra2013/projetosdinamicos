document.addEventListener('DOMContentLoaded', function () {
  var BASE = window.API_BASE;
  fetchAndRender(BASE + '/eventos', renderEvents);
  fetchAndRender(BASE + '/castracoes', renderCastracoes);
  fetchAndRender(BASE + '/animais', renderAnimais);
  fetchAndRender(BASE + '/voluntarios', renderVoluntarios);
});

function fetchAndRender(url, renderFn) {
  fetch(url)
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { if (data && Array.isArray(data)) renderFn(data); })
    .catch(function () {});
}

function renderEvents(events) {
  var container = document.querySelector('.events-grid');
  if (!container) return;
  container.innerHTML = '';
  if (!events.length) {
    container.innerHTML = '<p class="text-center text-muted" style="grid-column:1/-1;">Nenhum evento cadastrado.</p>';
    return;
  }
  events.forEach(function (ev) {
    var card = document.createElement('div');
    card.className = 'event-card-hover';
    card.innerHTML =
      '<button class="btn-delete-evento admin-only" data-id="' + ev.id + '" title="Excluir evento"><i class="bi bi-x-lg"></i></button>' +
      '<div class="event-info">' +
        '<h3 class="event-titulo" style="margin-bottom:10px;">' + esc(ev.titulo) + '</h3>' +
        '<div class="event-meta">' +
          '<span><i class="bi bi-calendar-event"></i> ' + fmtDate(ev.data_evento) + '</span>' +
          '<span><i class="bi bi-geo-alt"></i> ' + esc(ev.local) + '</span>' +
        '</div>' +
        '<p class="event-descricao">' + esc(ev.descricao) + '</p>' +
      '</div>' +
      '<div class="event-fotos-area" style="display:flex;align-items:center;justify-content:center;background:#e2e8f0;color:#94a3b8;font-size:3rem;overflow:hidden;">' +
        (ev.fotos ? '<img src="' + BASE + '/uploads/eventos/' + ev.fotos + '" alt="' + esc(ev.titulo) + '" style="width:100%;height:100%;object-fit:cover;">' : '<i class="bi bi-calendar-event"></i>') +
      '</div>';
    container.appendChild(card);
  });
}

function renderCastracoes(castracoes) {
  var tbody = document.querySelector('.castracao-table table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!castracoes.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Nenhum agendamento de castração.</td></tr>';
    return;
  }
  castracoes.forEach(function (c) {
    var ticketNum = c.ticket || '';
    var isAtendido = c.status === 'Atendido' || c.status === 'atendido';
    var tr = document.createElement('tr');
    if (isAtendido) { tr.className = 'status-atendido'; tr.style.display = 'none'; }
    tr.setAttribute('data-ticket', ticketNum);
    tr.setAttribute('data-pet', c.nome_pet || '');
    tr.setAttribute('data-responsavel', c.nome || '');
    tr.setAttribute('data-especie', c.especie || '');
    tr.setAttribute('data-sexo', c.sexo || '');
    tr.setAttribute('data-porte', c.porte || '');
    tr.setAttribute('data-idade', c.idade || '');
    tr.setAttribute('data-clinica', c.clinica || '');
    tr.setAttribute('data-data', fmtDate(c.origem));
    tr.setAttribute('data-status', c.status || 'Pendente');
    tr.setAttribute('data-contato', c.tutor_telefone || '');
    tr.setAttribute('data-tipo', c.tipo || '');
    tr.setAttribute('data-dia', c.dia_semana || '');
    tr.setAttribute('data-cpf', c.tutor_cpf || '');
    tr.setAttribute('data-endereco', c.tutor_endereco || '');
    tr.setAttribute('data-numero', c.tutor_numero || '');
    tr.setAttribute('data-bairro', c.tutor_bairro || '');
    tr.setAttribute('data-cidade', c.tutor_cidade || '');
    tr.setAttribute('data-estado', c.tutor_estado || '');
    tr.setAttribute('data-cep', c.tutor_cep || '');
    var badgeCor = (c.especie || '').toLowerCase() === 'gato'
      ? '<span class="badge" style="background:#8b5cf6;color:#fff;">Gato</span>'
      : '<span class="badge badge-info">' + esc(c.especie) + '</span>';
    var statusHtml = isAtendido
      ? '<button class="btn-status-atendido" disabled><i class="bi bi-check-circle-fill"></i> Atendido</button>'
      : '<button class="btn-status-atender" onclick="atenderCastracao(this)" data-id="' + c.id + '"><i class="bi bi-check-lg"></i> Atender</button>';
    tr.innerHTML =
      '<td data-label="Ticket"><strong>' + esc(ticketNum) + '</strong></td>' +
      '<td data-label="Pet">' + esc(c.nome_pet) + '</td>' +
      '<td data-label="Respons\u00e1vel">' + esc(c.nome) + '</td>' +
      '<td data-label="Esp\u00e9cie">' + badgeCor + '</td>' +
      '<td data-label="Cl\u00ednica">' + esc(c.clinica) + '</td>' +
      '<td data-label="Data">' + fmtDate(c.origem) + '</td>' +
      '<td data-label="Status">' + statusHtml + '</td>' +
      '<td data-label="A\u00e7\u00f5es">' +
        '<button class="btn-comprovante" onclick="gerarComprovante(this)"><i class="bi bi-file-earmark-text"></i> Comprovante</button> ' +
        '<button class="btn-excluir-castracao admin-only" onclick="excluirCastracao(this)" data-id="' + c.id + '" title="Excluir"><i class="bi bi-trash"></i> Excluir</button>' +
      '</td>';
    tbody.appendChild(tr);
  });
}

function renderAnimais(animais) {
  var container = document.getElementById('petsGrid');
  if (!container) return;
  container.innerHTML = '';
  if (!animais.length) {
    container.innerHTML = '<p class="text-center text-muted" style="width:100%;">Nenhum pet dispon\u00edvel para ado\u00e7\u00e3o no momento.</p>';
    return;
  }
  function item(pet) {
    var d = document.createElement('div');
    d.className = 'pet-carousel-item';
    d.setAttribute('data-nome', pet.nome || '');
    d.setAttribute('data-especie', pet.especie || '');
    d.setAttribute('data-porte', pet.porte || '');
    d.setAttribute('data-idade', pet.idade || '');
    d.setAttribute('data-caracteristicas', pet.caracteristicas || '');
    d.setAttribute('onclick', 'abrirTermo(this)');
    d.innerHTML =
      '<div class="carousel-img-wrap" style="position:relative;width:100%;height:220px;overflow:hidden;">' +
        '<img src="' + esc(pet.foto_url || 'static/css/imagem/1.jpg') + '" alt="' + esc(pet.nome) + '" style="width:100%;height:100%;object-fit:cover;">' +
        '<span class="carousel-badge badge badge-success" style="position:absolute;top:10px;left:10px;border-radius:20px;">' + esc(pet.status || 'Dispon\u00edvel') + '</span>' +
      '</div>' +
      '<div class="carousel-info" style="padding:1rem;">' +
        '<div class="carousel-name" style="font-size:1.1rem;font-weight:700;color:var(--heading-color);margin-bottom:0.5rem;">' + esc(pet.nome) + '</div>' +
        '<div class="carousel-detail" style="font-size:0.85rem;color:var(--text-color);margin-bottom:0.25rem;"><span style="font-weight:600;">Idade:</span> ' + esc(pet.idade) + '</div>' +
        '<div class="carousel-detail" style="font-size:0.85rem;color:var(--text-color);margin-bottom:0.25rem;"><span style="font-weight:600;">Porte:</span> ' + esc(pet.porte) + '</div>' +
        '<div class="carousel-detail" style="font-size:0.85rem;color:var(--text-color);"><span style="font-weight:600;">Caracter\u00edsticas:</span> ' + esc(pet.caracteristicas) + '</div>' +
      '</div>';
    return d;
  }
  animais.forEach(function (p) { container.appendChild(item(p)); });
  animais.forEach(function (p) { container.appendChild(item(p)); });
}

function renderVoluntarios(voluntarios) {
  var container = document.querySelector('.voluntarios-carrossel');
  if (!container) return;
  container.innerHTML = '';
  if (!voluntarios.length) {
    container.innerHTML = '<p class="text-center text-muted" style="width:100%;">Nenhum volunt\u00e1rio cadastrado.</p>';
    return;
  }
  var cores = ['var(--brand-teal)', 'var(--brand-coral)', 'var(--brand-purple)', 'var(--brand-blue)', 'var(--brand-green)', 'var(--brand-yellow)'];
  voluntarios.forEach(function (v, i) {
    var card = document.createElement('div');
    card.className = 'voluntario-card';
    card.style.cssText = 'flex:0 0 280px;width:280px;';
    var inicial = (v.nome || '?').charAt(0).toUpperCase();
    card.innerHTML =
      '<div style="padding:1.25rem;text-align:center;">' +
        '<div style="width:60px;height:60px;border-radius:50%;background:' + cores[i % cores.length] + ';color:white;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:bold;margin:0 auto 10px;">' + inicial + '</div>' +
        '<div style="font-weight:bold;">' + esc(v.nome) + '</div>' +
        '<div style="font-size:0.85rem;color:var(--muted-color);">' + esc(v.localidade || v.habilidade || '') + '</div>' +
        '<div style="font-size:0.8rem;font-style:italic;margin-top:8px;">"' + esc(v.mensagem) + '"</div>' +
      '</div>';
    container.appendChild(card);
  });
}

function fmtDate(d) {
  if (!d) return '';
  var dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('pt-BR');
}

function esc(s) {
  if (!s) return '';
  var e = document.createElement('div');
  e.appendChild(document.createTextNode(s));
  return e.innerHTML;
}
