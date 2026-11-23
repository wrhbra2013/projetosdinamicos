/* ============================================================================
   Service worker do assistente pessoal.

   - Navegação: rede primeiro, cache como fallback (index.html).
   - Arquivos estáticos: cache primeiro, rede para preencher o cache.
   - Requisições para api.projetosdinamicos.com.br NÃO são interceptadas:
     a aplicação detecta a falha e usa o fallback local.
   ========================================================================== */

const CACHE = 'pd-assistente-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './assets/icons/assistente.svg',
  './assets/css/base.css',
  './assets/css/landing.css',
  './assets/css/assistente.css',
  './assets/css/legal.css',
  './assets/js/assistente.js',
  './assets/js/assistente-prompts.js',
  './assets/js/assistente-storage.js',
  './assets/js/core/opencode.js',
  './termos.html',
  './privacidade.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        chaves.filter((chave) => chave !== CACHE).map((chave) => caches.delete(chave))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const requisicao = event.request;
  if (requisicao.method !== 'GET') return;

  let url;
  try { url = new URL(requisicao.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  if (requisicao.mode === 'navigate') {
    event.respondWith(
      fetch(requisicao)
        .then((resposta) => {
          if (resposta.ok) {
            const copia = resposta.clone();
            caches.open(CACHE).then((cache) => cache.put('./index.html', copia));
          }
          return resposta;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(requisicao).then((cacheado) => cacheado || fetch(requisicao).then((resposta) => {
      if (resposta.ok) {
        const copia = resposta.clone();
        caches.open(CACHE).then((cache) => cache.put(requisicao, copia));
      }
      return resposta;
    }))
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
