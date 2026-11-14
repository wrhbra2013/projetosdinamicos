/* OpenFinancial — configuracao de fontes.
   Tudo pode ser trocado por meta tags no <head>, sem alterar o JavaScript. */

const meta = (name, fallback = '') => {
  const el = document.querySelector(`meta[name="${name}"]`);
  return (el?.content || fallback).trim();
};

const trimBase = (value) => value.replace(/\/+$/, '');

const API_PADRAO = 'https://api.projetosdinamicos.com.br';
const apiConfigurada = trimBase(meta('of-api-base', API_PADRAO));
const hostLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);

export const CONFIG = {
  siteName: meta('of-site-name', 'OpenFinancial'),
  cdnBase: trimBase(meta('of-cdn-base', 'https://cdn.projetosdinamicos.com.br/b3')),
  // Em desenvolvimento, usa a API local quando a meta nao foi personalizada.
  apiBase:
    hostLocal && apiConfigurada === API_PADRAO ? 'http://127.0.0.1:8096' : apiConfigurada,
  demoMode: meta('of-demo', 'auto'),
  timeout: Number(meta('of-timeout', '4500')) || 4500,
};

export const SOURCES = {
  cdn: (path) => (CONFIG.cdnBase ? `${CONFIG.cdnBase}/${path}` : null),
  api: (path) => `${CONFIG.apiBase}/${path.replace(/^\/+/, '')}`,
  local: (path) => `assets/data/${path.replace(/^\/+/, '')}`,
};
