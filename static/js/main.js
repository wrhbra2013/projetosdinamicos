/*!
 * Projetos Dinâmicos Incubadora - Main JavaScript
 */

document.addEventListener('DOMContentLoaded', function() {
    var fileInputs = document.querySelectorAll('input[type="file"]');
    fileInputs.forEach(function(input) {
        var id = input.id || '';
        var name = input.name || '';
        if (id === 'arquivo' || name === 'arquivo' || id === 'foto' || name === 'foto') {
            input.setAttribute('accept', 'image/*');
            input.setAttribute('capture', 'environment');
        }
    });

    var frame = document.getElementById('frame');
    var placeholder = document.getElementById('preview-placeholder');
    var fileInput = document.getElementById('arquivo');

    if (frame) {
        window.preview = function() {
            if (fileInput && fileInput.files && fileInput.files[0]) {
                var reader = new FileReader();
                reader.onload = function(e) {
                    frame.src = e.target.result;
                    frame.style.display = 'block';
                    if (placeholder) placeholder.style.display = 'none';
                };
                reader.readAsDataURL(fileInput.files[0]);
            }
        };

        window.clearPreview = function() {
            if (frame) {
                frame.src = '';
                frame.style.display = 'none';
            }
            if (placeholder) placeholder.style.display = 'block';
            if (fileInput) fileInput.value = null;
        };
    }

    var phoneInputs = document.querySelectorAll('.phone-input');
    phoneInputs.forEach(function(input) {
        var lastValue = '';
        input.addEventListener('input', function(e) {
            var currentValue = e.target.value;
            var cursorPosition = e.target.selectionStart;
            if (currentValue.length < lastValue.length) {
                lastValue = currentValue;
                return;
            }
            lastValue = phoneFormat(currentValue);
            e.target.value = lastValue;
            var newPosition = Math.min(cursorPosition + (lastValue.length - currentValue.length), lastValue.length);
            e.target.setSelectionRange(newPosition, newPosition);
        });
        input.addEventListener('blur', function(e) {
            e.target.classList.remove('phone-error');
        });
        input.addEventListener('focus', function(e) {
            e.target.classList.remove('phone-error');
        });
    });

    var cepInput = document.querySelector("input[name=cep]");
    if (cepInput) {
        cepInput.addEventListener('blur', function(e) {
            var value = cepInput.value.replace(/[^0-9]+/, '');
            if (value.length === 8) {
                fetch('https://viacep.com.br/ws/' + value + '/json/')
                    .then(function(response) { return response.json(); })
                    .then(function(json) {
                        if (json.logradouro) {
                            var endereco = document.querySelector('input[name=endereco]');
                            var bairro = document.querySelector('input[name=bairro]');
                            var cidade = document.querySelector('input[name=cidade]');
                            var estado = document.querySelector('input[name=estado]');
                            if (endereco) endereco.value = json.logradouro;
                            if (bairro) bairro.value = json.bairro;
                            if (cidade) cidade.value = json.localidade;
                            if (estado) estado.value = json.uf;
                        }
                    });
            }
        });
    }
});

function phoneFormat(input) {
    var digits = input.replace(/\D/g, '').substring(0, 11);
    if (digits.startsWith('55') && digits.length > 2) {
        digits = digits.substring(2);
    }
    if (digits.length === 0) return '';
    if (digits.length <= 2) return '(' + digits + ')';
    if (digits.length <= 6) return '(' + digits.slice(0, 2) + ') ' + digits.slice(2);
    if (digits.length <= 10) return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 6) + ' - ' + digits.slice(6);
    return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + ' - ' + digits.slice(7);
}

function phoneValidator(input) {
    var digits = input.replace(/\D/g, '');
    if (digits.startsWith('55')) digits = digits.substring(2);
    var validLengths = [8, 9, 10];
    if (!validLengths.includes(digits.length)) return false;
    var validDDDs = ['11','12','13','14','15','16','17','18','19','21','22','24','27','28','31','32','33','34','35','37','38','41','42','43','44','45','46','47','48','49','51','53','54','55','61','62','63','64','65','66','67','68','69','71','73','74','75','77','79','81','82','83','84','85','86','87','88','91','92','93','94','95','96','97','98','99'];
    return validDDDs.includes(digits.substring(0, 2));
}

(function() {
    var cookieBanner = document.getElementById('cookie-consent-banner');
    if (!cookieBanner) return;

    var stored = localStorage.getItem('cookiePreference');
    if (stored) {
        cookieBanner.style.display = 'none';
        return;
    }

    cookieBanner.style.display = 'block';

    function setPreference(level) {
        cookieBanner.style.display = 'none';
        localStorage.setItem('cookiePreference', JSON.stringify({ level: level, ts: Date.now() }));
    }

    var acceptEssential = document.getElementById('accept-essential-btn');
    var acceptAll = document.getElementById('accept-all-btn');
    var openPref = document.getElementById('open-preferences-btn');

    if (acceptEssential) acceptEssential.addEventListener('click', function() { setPreference('essential'); });
    if (acceptAll) acceptAll.addEventListener('click', function() { setPreference('all'); });
    if (openPref) openPref.addEventListener('click', function() { window.location.href = '/pages/policy.html'; });
})();
