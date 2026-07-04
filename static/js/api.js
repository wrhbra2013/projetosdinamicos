window.API_BASE = 'https://api.projetosdinamicos.com.br/freelas';

window.getApiToken = function() {
  if (window.API_TOKEN) return window.API_TOKEN;
  var token = localStorage.getItem('freelas_token');
  var expiry = parseInt(localStorage.getItem('freelas_session_expiry') || '0', 10);
  if (token && Date.now() > expiry) {
    localStorage.removeItem('freelas_token');
    localStorage.removeItem('freelas_usuario');
    localStorage.removeItem('freelas_session_expiry');
    return null;
  }
  return token || null;
};

window.apiFetch = function(url, options) {
  options = options || {};
  options.headers = options.headers || {};
  var token = window.getApiToken();
  if (token) {
    options.headers['Authorization'] = 'Bearer ' + token;
  }
  return fetch(window.API_BASE + url, options);
};
