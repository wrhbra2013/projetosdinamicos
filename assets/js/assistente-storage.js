/* ============================================================================
   Persistência local do assistente.

   Conversas, preferências e modelo ficam apenas no localStorage do navegador.
   Nada é enviado a terceiros além do gateway /llm quando o usuário envia uma
   mensagem. O token continua em core/opencode.js.
   ========================================================================== */

const CHAVES = {
  sessoes: 'pd.assistente.sessoes.v1',
  ativa: 'pd.assistente.sessao-ativa.v1',
  preferencias: 'pd.assistente.preferencias.v1',
  modo: 'pd.assistente.modo.v1',
  modelo: 'pd.assistente.modelo.v1',
};

const MAX_SESSOES = 20;
const MAX_MENSAGENS = 120;

function ler(chave, fallback) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto == null ? fallback : JSON.parse(bruto);
  } catch {
    return fallback;
  }
}

function salvar(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

function textoSeguro(valor, limite = 8000) {
  return String(valor ?? '').slice(0, limite);
}

function mensagemSegura(item) {
  if (!item || typeof item !== 'object') return null;
  const role = ['user', 'assistant', 'note'].includes(item.role) ? item.role : 'note';
  const text = textoSeguro(item.text, 8000);
  if (!text) return null;
  const meta = item.meta && typeof item.meta === 'object' ? item.meta : null;
  return meta ? { role, text, meta } : { role, text };
}

function sessaoSegura(item) {
  if (!item || typeof item !== 'object' || !item.id) return null;
  const mensagens = Array.isArray(item.mensagens)
    ? item.mensagens.map(mensagemSegura).filter(Boolean).slice(-MAX_MENSAGENS)
    : [];
  return {
    id: textoSeguro(item.id, 80),
    titulo: textoSeguro(item.titulo, 90) || 'Nova conversa',
    criadoEm: Number(item.criadoEm) || Date.now(),
    atualizadoEm: Number(item.atualizadoEm) || Date.now(),
    modo: textoSeguro(item.modo, 30) || 'geral',
    mensagens,
  };
}

export function criarId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* ambiente sem crypto */ }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function lerSessoes() {
  const dados = ler(CHAVES.sessoes, []);
  if (!Array.isArray(dados)) return [];
  return dados.map(sessaoSegura).filter(Boolean).slice(0, MAX_SESSOES);
}

export function salvarSessoes(sessoes) {
  const lista = Array.isArray(sessoes) ? sessoes.map(sessaoSegura).filter(Boolean).slice(0, MAX_SESSOES) : [];
  salvar(CHAVES.sessoes, lista);
  return lista;
}

export function lerSessaoAtiva() {
  return textoSeguro(ler(CHAVES.ativa, ''), 80);
}

export function salvarSessaoAtiva(id) {
  salvar(CHAVES.ativa, textoSeguro(id, 80));
}

export function novaSessao(modo = 'geral') {
  const agora = Date.now();
  return {
    id: criarId(),
    titulo: 'Nova conversa',
    criadoEm: agora,
    atualizadoEm: agora,
    modo: textoSeguro(modo, 30) || 'geral',
    mensagens: [],
  };
}

export function lerPreferencias() {
  return textoSeguro(ler(CHAVES.preferencias, ''), 1200);
}

export function salvarPreferencias(valor) {
  const texto = textoSeguro(valor, 1200);
  salvar(CHAVES.preferencias, texto);
  return texto;
}

export function lerModo() {
  return textoSeguro(ler(CHAVES.modo, 'geral'), 30) || 'geral';
}

export function salvarModo(id) {
  salvar(CHAVES.modo, textoSeguro(id, 30));
}

export function lerModelo() {
  return textoSeguro(ler(CHAVES.modelo, ''), 120);
}

export function salvarModelo(id) {
  salvar(CHAVES.modelo, textoSeguro(id, 120));
}
