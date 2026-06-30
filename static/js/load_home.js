var BASE = window.API_BASE;

document.addEventListener('DOMContentLoaded', function () {
  apiFetch('/eventos')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { if (data && Array.isArray(data)) renderEvents(data); })
    .catch(function () {});
  Promise.all([
    apiFetch('/castracao').then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).catch(function () { return []; }),
    apiFetch('/mutirao_inscricao').then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).catch(function () { return []; }),
    apiFetch('/mutirao_pet').then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).catch(function () { return []; }),
    apiFetch('/calendario_mutirao').then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).catch(function () { return []; })
  ]).then(function (results) {
    renderCastracoes(mergeCastracoes(results[0], results[1], results[2], results[3]));
  });
  apiFetch('/adocao')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { if (data && Array.isArray(data)) renderAnimais(data); })
    .catch(function () {});
  apiFetch('/voluntario')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { if (data && Array.isArray(data)) renderVoluntarios(data); })
    .catch(function () {});
});

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
          '<span><i class="bi bi-geo-alt"></i> ' + esc(ev.local || ev.endereco || '') + '</span>' +
        '</div>' +
        '<p class="event-descricao">' + esc(ev.descricao) + '</p>' +
      '</div>' +
      '<div class="event-fotos-area" style="display:flex;align-items:center;justify-content:center;background:#e2e8f0;color:#94a3b8;font-size:3rem;overflow:hidden;">' +
        (ev.fotos || ev.arquivo ? '<img src="' + imgUrl(ev.fotos || ev.arquivo, 'eventos') + '" alt="' + esc(ev.titulo) + '" style="width:100%;height:100%;object-fit:cover;">' : '<i class="bi bi-calendar-event"></i>') +
      '</div>';
    container.appendChild(card);
  });
}

function mergeCastracoes(castracoes, inscricoes, pets, calendarios) {
  var calMap = {};
  if (Array.isArray(calendarios)) calendarios.forEach(function (c) { calMap[c.id] = c; });
  var petsByIns = {};
  if (Array.isArray(pets)) pets.forEach(function (p) {
    var k = p.mutirao_inscricao_id;
    if (!petsByIns[k]) petsByIns[k] = [];
    petsByIns[k].push(p);
  });
  var all = [];
  if (Array.isArray(castracoes)) castracoes.forEach(function (c) {
    all.push({ _origem: 'castracao', _raw: c, id: c.id,
      ticket: c.ticket, pet_nome: c.nome_pet || c.pet_nome, tutor_nome: c.nome || c.tutor_nome,
      especie: c.especie || c.pet_especie, sexo: c.sexo || c.pet_sexo, porte: c.porte || c.pet_porte,
      idade: c.idade || c.pet_idade, clinica: c.clinica, data: c.origem || c.created_at,
      status: c.status, contato: c.contato || c.tutor_telefone, tipo: c.tipo || '',
      cpf: c.tutor_cpf || '', endereco: c.tutor_endereco || '', numero: c.tutor_numero || '',
      bairro: c.tutor_bairro || '', cidade: c.tutor_cidade || '', estado: c.tutor_estado || '',
      cep: c.tutor_cep || '', agenda: c.dia_semana || c.agenda || '' });
  });
  if (Array.isArray(inscricoes)) inscricoes.forEach(function (ins) {
    var cal = calMap[ins.calendario_mutirao_id] || {};
    var lista = petsByIns[ins.id] || [];
    if (!lista.length) {
      all.push({ _origem: 'mutirao', _raw: ins, id: 'mutirao_' + ins.id,
        ticket: ins.ticket, pet_nome: '', tutor_nome: ins.nome_responsavel,
        especie: '', sexo: '', porte: '', idade: '',
        clinica: cal.clinica || '', data: cal.data || ins.created_at,
        status: ins.status, contato: ins.contato || '', tipo: 'Mutirão',
        cpf: ins.cpf || '', endereco: ins.endereco || '', numero: ins.numero || '',
        bairro: ins.bairro || '', cidade: ins.cidade || '', estado: ins.estado || '',
        cep: ins.cep || '', agenda: cal.data || '' });
    } else {
      lista.forEach(function (pet) {
        all.push({ _origem: 'mutirao', _raw: { ins: ins, pet: pet }, id: 'mutirao_' + ins.id + '_' + pet.id,
          ticket: pet.ticket || ins.ticket, pet_nome: pet.nome, tutor_nome: ins.nome_responsavel,
          especie: pet.especie, sexo: pet.sexo, porte: '', idade: pet.idade,
          clinica: cal.clinica || '', data: cal.data || ins.created_at,
          status: ins.status, contato: ins.contato || '', tipo: 'Mutirão',
          cpf: ins.cpf || '', endereco: ins.endereco || '', numero: ins.numero || '',
          bairro: ins.bairro || '', cidade: ins.cidade || '', estado: ins.estado || '',
          cep: ins.cep || '', agenda: cal.data || '' });
      });
    }
  });
  all.sort(function (a, b) { return (b.data || '') > (a.data || '') ? 1 : -1; });
  return all;
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
    var isAtendido = (c.status || '').toLowerCase() === 'atendido';
    var tr = document.createElement('tr');
    if (isAtendido) { tr.className = 'status-atendido'; tr.style.display = 'none'; }
    tr.setAttribute('data-ticket', ticketNum);
    tr.setAttribute('data-pet', c.pet_nome || '');
    tr.setAttribute('data-responsavel', c.tutor_nome || '');
    tr.setAttribute('data-especie', c.especie || '');
    tr.setAttribute('data-sexo', c.sexo || '');
    tr.setAttribute('data-porte', c.porte || '');
    tr.setAttribute('data-idade', c.idade || '');
    tr.setAttribute('data-clinica', c.clinica || '');
    tr.setAttribute('data-data', fmtDate(c.data));
    tr.setAttribute('data-status', c.status || 'Pendente');
    tr.setAttribute('data-contato', c.contato || '');
    tr.setAttribute('data-tipo', c.tipo || '');
    tr.setAttribute('data-dia', c.agenda || '');
    tr.setAttribute('data-cpf', c.cpf || '');
    tr.setAttribute('data-endereco', c.endereco || '');
    tr.setAttribute('data-numero', c.numero || '');
    tr.setAttribute('data-bairro', c.bairro || '');
    tr.setAttribute('data-cidade', c.cidade || '');
    tr.setAttribute('data-estado', c.estado || '');
    tr.setAttribute('data-cep', c.cep || '');
    var badgeCor = (c.especie || '').toLowerCase() === 'gato'
      ? '<span class="badge" style="background:#8b5cf6;color:#fff;">Gato</span>'
      : '<span class="badge badge-info">' + esc(c.especie) + '</span>';
    var statusHtml = isAtendido
      ? '<button class="btn-status-atendido" disabled><i class="bi bi-check-circle-fill"></i> Atendido</button>'
      : (c._origem === 'castracao'
        ? '<button class="btn-status-atender" onclick="atenderCastracao(this)" data-id="' + c.id + '"><i class="bi bi-check-lg"></i> Atender</button>'
        : '<button class="btn-status-atendido" disabled style="opacity:0.5;"><i class="bi bi-check-circle-fill"></i> ' + esc(c.status) + '</button>');
    tr.innerHTML =
      '<td data-label="Ticket"><strong>' + esc(ticketNum) + '</strong></td>' +
      '<td data-label="Pet">' + esc(c.pet_nome) + '</td>' +
      '<td data-label="Respons\u00e1vel">' + esc(c.tutor_nome) + '</td>' +
      '<td data-label="Esp\u00e9cie">' + badgeCor + '</td>' +
      '<td data-label="Cl\u00ednica">' + esc(c.clinica) + '</td>' +
      '<td data-label="Data">' + fmtDate(c.data) + '</td>' +
      '<td data-label="Status">' + statusHtml + '</td>' +
      '<td data-label="A\u00e7\u00f5es">' +
        '<button class="btn-comprovante" onclick="gerarComprovante(this)"><i class="bi bi-file-earmark-text"></i> Comprovante</button> ' +
        (c._origem === 'castracao'
          ? '<button class="btn-excluir-castracao admin-only" onclick="excluirCastracao(this)" data-id="' + c.id + '" title="Excluir"><i class="bi bi-trash"></i> Excluir</button>'
          : '') +
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
    var sp = ({'canino':'Cachorro','felino':'Gato'})[pet.especie] || pet.especie;
    var nm = pet.nome || (pet.caracteristicas ? pet.caracteristicas.split(',')[0].replace(/^Atende pelo nome\s*/i,'').trim() : '');
    d.setAttribute('data-nome', nm);
    d.setAttribute('data-especie', sp);
    d.setAttribute('data-porte', pet.porte || '');
    d.setAttribute('data-idade', pet.idade || '');
    d.setAttribute('data-caracteristicas', pet.caracteristicas || '');
    d.setAttribute('onclick', 'abrirTermo(this)');
    d.innerHTML =
      '<div class="carousel-img-wrap" style="position:relative;width:100%;height:220px;overflow:hidden;">' +
        '<button class="btn-delete-pet admin-only" data-id="' + pet.id + '" title="Excluir pet"><i class="bi bi-x-lg"></i></button>' +
        '<img src="' + imgUrl(pet.foto_url || pet.arquivo, 'adocao') + '" alt="' + esc(nm) + '" style="width:100%;height:100%;object-fit:cover;">' +
        '<span class="carousel-badge badge badge-success" style="position:absolute;top:10px;left:10px;border-radius:20px;">' + esc(pet.status || 'Dispon\u00edvel') + '</span>' +
      '</div>' +
      '<div class="carousel-info" style="padding:1rem;">' +
        '<div class="carousel-name" style="font-size:1.1rem;font-weight:700;color:var(--heading-color);margin-bottom:0.5rem;">' + esc(nm) + '</div>' +
        '<div class="carousel-detail" style="font-size:0.85rem;color:var(--text-color);margin-bottom:0.25rem;"><span style="font-weight:600;">Idade:</span> ' + esc(pet.idade) + '</div>' +
        '<div class="carousel-detail" style="font-size:0.85rem;color:var(--text-color);margin-bottom:0.25rem;"><span style="font-weight:600;">Porte:</span> ' + esc(pet.porte) + '</div>' +
        '<div class="carousel-detail" style="font-size:0.85rem;color:var(--text-color);"><span style="font-weight:600;">Caracter\u00edsticas:</span> ' + esc(pet.caracteristicas) + '</div>' +
      '</div>';
    return d;
  }
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
      '<button class="btn-delete-voluntario admin-only" data-id="' + v.id + '" title="Excluir volunt\u00e1rio"><i class="bi bi-x-lg"></i></button>' +
      '<div style="padding:1.25rem;text-align:center;">' +
        '<div style="width:60px;height:60px;border-radius:50%;background:' + cores[i % cores.length] + ';color:white;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:bold;margin:0 auto 10px;">' + inicial + '</div>' +
        '<div style="font-weight:bold;">' + esc(v.nome) + '</div>' +
        '<div style="font-size:0.85rem;color:var(--muted-color);">' + esc(v.localidade || v.habilidade || '') + '</div>' +
        '<div style="font-size:0.8rem;font-style:italic;margin-top:8px;">"' + esc(v.mensagem) + '"</div>' +
      '</div>';
    container.appendChild(card);
  });
}

function imgUrl(f, pasta) {
  if (!f) return '/static/css/imagem/1.jpg';
  if (f.indexOf('://') !== -1 || f.indexOf('data:') === 0) return f;
  return BASE + '/uploads/' + pasta + '/' + f;
}

function fmtDate(d) {
  if (!d) return '';
  if (d.match(/^\d{2}\/\d{2}\/\d{4}$/)) return d;
  var partes = d.split('T')[0].split('-');
  if (partes.length === 3 && partes[0].length === 4) return partes[2] + '/' + partes[1] + '/' + partes[0];
  var dt = new Date(d);
  if (!isNaN(dt.getTime())) {
    return String(dt.getUTCDate()).padStart(2,'0') + '/' + String(dt.getUTCMonth()+1).padStart(2,'0') + '/' + dt.getUTCFullYear();
  }
  return d;
}

function esc(s) {
  if (!s) return '';
  var e = document.createElement('div');
  e.appendChild(document.createTextNode(s));
  return e.innerHTML;
}
