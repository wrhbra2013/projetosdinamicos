function filterVolunteers() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const availabilityFilter = document.getElementById('availabilityFilter').value.toLowerCase();
    const cards = document.querySelectorAll('.voluntario-card');
    
    cards.forEach(card => {
        const nome = card.dataset.nome;
        const localidadede = card.dataset.localidade;
        const habilidades = card.dataset.habilidades;
        const disponibilidade = card.dataset.disponibilidade;
        
        const matchesSearch = nome.includes(searchTerm) || 
                             localidadede.includes(searchTerm) || 
                             habilidades.includes(searchTerm);
        
        const matchesAvailability = !availabilityFilter || 
                                    disponibilidade.includes(availabilityFilter);
        
        if (matchesSearch && matchesAvailability) {
            card.style.display = '';
            card.style.animation = 'fadeIn 0.3s ease';
        } else {
            card.style.display = 'none';
        }
    });
    
    updateEmptyState();
}

function resetFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('availabilityFilter').value = '';
    filterVolunteers();
}

function updateEmptyState() {
    const visibleCards = document.querySelectorAll('.voluntario-card:not([style*="display: none"])');
    const grid = document.getElementById('voluntariosGrid');
    
    if (visibleCards.length === 0 && grid) {
        if (!document.getElementById('noResults')) {
            const noResults = document.createElement('div');
            noResults.id = 'noResults';
            noResults.className = 'empty-state';
            noResults.innerHTML = `
                <div class="empty-icon">
                    <i class="bi bi-search"></i>
                </div>
                <h2 class="empty-title">Nenhum Voluntário Encontrado</h2>
                <p class="empty-description">
                    Tente ajustar os filtros de busca para encontrar voluntários.
                </p>
            `;
            grid.appendChild(noResults);
        }
    } else {
        const noResults = document.getElementById('noResults');
        if (noResults) {
            noResults.remove();
        }
    }
}

function confirmDelete(id, nome) {
    if (confirm(`Tem certeza que deseja excluir o volunt\u00e1rio "${nome}"?\n\nEsta a\u00e7\u00e3o n\u00e3o poder\u00e1 ser desfeita.`)) {
        apiFetch('/voluntario/' + id, { method: 'DELETE' })
            .then(function(r) {
                if (!r.ok) throw new Error('Erro ao excluir');
                if (typeof carregarVoluntarios === 'function') carregarVoluntarios();
                else location.reload();
            })
            .catch(function(err) {
                alert('Erro ao excluir: ' + err.message);
            });
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.focus();
    }
});
