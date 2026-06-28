window.API_BASE = 'https://api.projetosdinamicos.com.br/amoranimal';

window.getApiToken = function() {
  if (window.API_TOKEN) return window.API_TOKEN;
  var token = localStorage.getItem('amoranimal_token');
  var expiry = parseInt(localStorage.getItem('amoranimal_session_expiry') || '0', 10);
  if (token && Date.now() > expiry) {
    localStorage.removeItem('amoranimal_token');
    localStorage.removeItem('amoranimal_usuario');
    localStorage.removeItem('amoranimal_session_expiry');
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
