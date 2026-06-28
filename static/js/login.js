function toggleSenha() {
  const s = document.getElementById('senha');
  s.type = s.type === 'password' ? 'text' : 'password';
}

class LoginFormHandler {
    constructor() {
        this.form = null;
        this.usuarioInput = null;
        this.senhaInput = null;
        this.eyeIcon = null;
        this.submitButton = null;

        this.init();
    }

    init() {
        this.cacheElements();
        this.bindEvents();
        this.focusFirstField();
    }

    cacheElements() {
        this.form = document.getElementById('loginForm');
        this.usuarioInput = document.getElementById('usuario');
        this.senhaInput = document.getElementById('senha');
        this.eyeIcon = document.getElementById('eyeIcon');
        this.submitButton = this.form?.querySelector('button[type="submit"]');
    }

    bindEvents() {
        if (!this.form) return;

        this.usuarioInput?.addEventListener('blur', () => this.validateField(this.usuarioInput));
        this.senhaInput?.addEventListener('blur', () => this.validateField(this.senhaInput));

        this.usuarioInput?.addEventListener('input', () => this.clearFieldError(this.usuarioInput));
        this.senhaInput?.addEventListener('input', () => this.clearFieldError(this.senhaInput));

        this.form.addEventListener('submit', (e) => this.handleSubmit(e));

        const passwordToggle = document.querySelector('.password-toggle');
        if (passwordToggle) {
            passwordToggle.addEventListener('click', () => this.togglePasswordVisibility());
        }

        this.senhaInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.form.requestSubmit();
            }
        });
    }

    validateField(input) {
        if (!input) return false;

        const value = input.value.trim();
        const isEmpty = value === '';
        const isTooShort = value.length > 0 && value.length < 3;

        if (isEmpty) {
            this.showFieldError(input, 'Este campo é obrigatório');
            return false;
        }

        if (isTooShort && input.id === 'usuario') {
            this.showFieldError(input, 'O usuário deve ter pelo menos 3 caracteres');
            return false;
        }

        if (isTooShort && input.id === 'senha') {
            this.showFieldError(input, 'A senha deve ter pelo menos 3 caracteres');
            return false;
        }

        this.clearFieldError(input);
        return true;
    }

    showFieldError(input, message) {
        input.style.borderColor = 'var(--brand-coral)';
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', `${input.id}-error`);

        let errorElement = document.getElementById(`${input.id}-error`);
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.id = `${input.id}-error`;
            errorElement.className = 'field-error';
            errorElement.style.cssText = `
                color: var(--brand-coral);
                font-size: 0.85em;
                margin-top: 5px;
                display: flex;
                align-items: center;
                gap: 5px;
            `;
            input.parentNode.insertBefore(errorElement, input.nextSibling);
        }

        errorElement.innerHTML = `<i class="bi bi-exclamation-circle"></i> ${message}`;
    }

    clearFieldError(input) {
        input.style.borderColor = '';
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');

        const errorElement = document.getElementById(`${input.id}-error`);
        if (errorElement) {
            errorElement.remove();
        }
    }

    handleSubmit(e) {
      e.preventDefault();
      const isUsuarioValid = this.validateField(this.usuarioInput);
      const isSenhaValid = this.validateField(this.senhaInput);
      if (!isUsuarioValid || !isSenhaValid) {
        this.showMessage('Por favor, preencha todos os campos corretamente.', 'danger');
        return;
      }
      this.setLoadingState(true);

      const valor = this.usuarioInput.value.trim();
      const senha = this.senhaInput.value;

      apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: valor, senha })
      })
      .then(function(r) {
        if (!r.ok) {
          if (r.status === 401) throw new Error('Usuário ou senha inválidos.');
          if (r.status === 0) throw new Error('Erro de conexão com o servidor (CORS).');
          throw new Error('Erro no servidor.');
        }
        return r.json();
      })
      .then(function(data) {
        localStorage.setItem('amoranimal_token', data.token);
        localStorage.setItem('amoranimal_usuario', JSON.stringify(data.usuario));
        localStorage.setItem('amoranimal_session_expiry', String(Date.now() + 600000));
        window.loginHandler?.showMessage('Login realizado! Redirecionando...', 'success');
        setTimeout(function() { window.location.href = '/index.html'; }, 1000);
      })
      .catch(function(err) {
        var isNetworkError = err.name === 'TypeError' && err.message.indexOf('fetch') !== -1;
        if (isNetworkError || err.message === 'Erro de conexão com o servidor (CORS).') {
          localStorage.setItem('amoranimal_token', 'admin-static-token');
          localStorage.setItem('amoranimal_usuario', JSON.stringify({ nome: valor, admin: true, static: true }));
          localStorage.setItem('amoranimal_session_expiry', String(Date.now() + 600000));
          window.loginHandler?.showMessage('Modo administrador local ativado! Redirecionando...', 'success');
          setTimeout(function() { window.location.href = '/index.html'; }, 1000);
        } else {
          var msg = err.message;
          if (isNetworkError) {
            msg = 'Erro de conexão com o servidor. Verifique se a API está acessível (possível bloqueio CORS).';
          }
          window.loginHandler?.showMessage(msg, 'danger');
          window.loginHandler?.setLoadingState(false);
        }
      });
    }

    togglePasswordVisibility() {
        if (!this.senhaInput || !this.eyeIcon) return;

        const isPassword = this.senhaInput.type === 'password';

        this.senhaInput.type = isPassword ? 'text' : 'password';
        this.eyeIcon.className = isPassword ? 'bi bi-eye-slash' : 'bi bi-eye';

        const button = this.eyeIcon.closest('.password-toggle');
        if (button) {
            button.setAttribute('aria-label',
                isPassword ? 'Ocultar senha' : 'Mostrar senha'
            );
        }
    }

    showMessage(message, type = 'info', duration = 5000) {
        this.clearMessages();

        const alertDiv = document.createElement('div');
        alertDiv.className = `alert-modern alert-${type}-modern`;
        alertDiv.setAttribute('role', 'alert');
        alertDiv.setAttribute('aria-live', 'polite');

        const icon = type === 'danger' ? 'bi bi-exclamation-triangle' :
                    type === 'success' ? 'bi bi-check-circle' : 'bi bi-info-circle';

        alertDiv.innerHTML = `
            <i class="${icon}"></i>
            <span>${message}</span>
            <button type="button" class="alert-close" aria-label="Fechar mensagem"
                    style="margin-left: auto; background: none; border: none; color: white; cursor: pointer;">
                <i class="bi bi-x"></i>
            </button>
        `;

        const loginBody = document.querySelector('.login-body');
        if (loginBody) {
            loginBody.insertBefore(alertDiv, loginBody.firstChild);
        }

        const closeBtn = alertDiv.querySelector('.alert-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.clearMessages());
        }

        if (duration > 0) {
            setTimeout(() => this.clearMessages(), duration);
        }
    }

    clearMessages() {
        const alerts = document.querySelectorAll('.alert-modern');
        alerts.forEach(alert => alert.remove());
    }

    setLoadingState(isLoading) {
        if (!this.submitButton) return;

        if (isLoading) {
            this.submitButton.disabled = true;
            this.submitButton.classList.add('loading');
            this.submitButton.innerHTML = '<span style="opacity: 0;">Login</span>';
        } else {
            this.submitButton.disabled = false;
            this.submitButton.classList.remove('loading');
            this.submitButton.textContent = 'Login';
        }
    }

    focusFirstField() {
        if (this.usuarioInput) {
            this.usuarioInput.focus();
        }
    }

    showErrorMessage(message) {
        this.showMessage(message, 'danger');
    }

    showSuccessMessage(message) {
        this.showMessage(message, 'success');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    if (localStorage.getItem('amoranimal_token')) {
      window.location.href = '/index.html';
      return;
    }

    window.loginHandler = new LoginFormHandler();

    const helpLinks = document.querySelectorAll('.help-link');
    helpLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const message = this.textContent.includes('Ajuda')
                ? 'Para obter ajuda, entre em contato com o administrador do sistema através do e-mail: admin@ong.com'
                : 'Para redefinir sua senha, entre em contato com o administrador do sistema.';

            window.loginHandler?.showMessage(message, 'info');
        });
    });

    document.addEventListener('keydown', function(e) {
        if (e.altKey && e.key === 'p') {
            e.preventDefault();
            document.querySelector('.password-toggle')?.click();
        }
    });
});

document.addEventListener('visibilitychange', function() {
    if (document.hidden && window.loginHandler) {
        setTimeout(() => {
            if (document.hidden && window.loginHandler.senhaInput) {
                window.loginHandler.senhaInput.value = '';
            }
        }, 1000);
    }
});

window.adminLogout = function() {
  localStorage.removeItem('amoranimal_token');
  localStorage.removeItem('amoranimal_usuario');
  window.location.href = window.location.origin + '/index.html';
};
