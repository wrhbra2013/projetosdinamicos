/* ============================================================================
   Assistente de criação de negócios — camada de linguagem.

   Usa o cliente OpenAI-compatible em core/opencode.js (Bearer token salvo no
   navegador). Cada interação devolve JSON estruturado: primeiro nichos, depois
   o resumo do negócio. Nenhuma credencial é escrita neste arquivo.
   ========================================================================== */

import { chat, extractContent } from './core/opencode.js';

const meta = (name, fallback = '') => {
  const node = document.querySelector(`meta[name="${name}"]`);
  return (node?.getAttribute('content') || fallback).trim();
};

export const MODELO = meta('pd-modelo', 'opencode/big-pickle');

const SYSTEM_NICHOS = `Você é o assistente de criação de negócios da Projetos Dinâmicos.
Missão: transformar o filtro do usuário em 3 a 5 nichos viáveis no Brasil, priorizando operações enxutas, baixo capital e um primeiro MVP em até 30 dias.

Responda em português do Brasil. Responda APENAS com um objeto JSON válido, sem markdown, sem cercas de código, sem texto antes ou depois.

Formato obrigatório:
{"etapa":"nichos","titulo":"...","resumo":"...","sugestoes":[{"id":"n1","nome":"...","nicho":"...","adesao":0,"capitalEstimado":"R$ ...","prazo":"...","porque":"...","mvp":"...","riscos":"..."}],"pergunta":"..."}

Regras:
- "adesao" é inteiro de 0 a 100 e mede o encaixe com capital, tempo, modelo, habilidades e objetivo informados. Ordene do maior para o menor.
- "capitalEstimado" é uma FAIXA em reais, por exemplo "R$ 500 – R$ 2.000". Nunca prometa faturamento ou rentabilidade.
- "porque", "mvp" e "riscos": até 25 palavras cada, em linguagem simples.
- Respeite restrições explícitas. Se o capital for baixo, prefira serviços a operações com estoque.
- Se houver ajuste do usuário, use o histórico e traga opções diferentes das anteriores quando fizer sentido.
- Trate números de mercado como hipóteses; não invente leis, garantias ou dados oficiais.`;

const SYSTEM_RESUMO = `Você é o assistente de criação de negócios da Projetos Dinâmicos.
Missão: converter o nicho escolhido e o histórico da conversa em um resumo de negócio enxuto e executável, com foco em MVP, capital inicial e logística.

Responda em português do Brasil. Responda APENAS com um objeto JSON válido, sem markdown, sem cercas de código, sem texto antes ou depois.

Formato obrigatório:
{"etapa":"resumo","titulo":"...","resumo":"...","negocio":{"nome":"...","nicho":"...","publico":"...","propostaValor":"...","mvp":"...","capitalInicial":{"total":"R$ ...","itens":[{"item":"...","valor":"R$ ..."}]},"logistica":"...","canais":"...","precificacao":"...","riscos":"...","passos":["..."]},"premissas":["..."]}

Regras:
- Use o nicho escolhido pelo usuário como centro do plano; não troque o nicho sem avisar.
- "capitalInicial.total" é uma FAIXA em reais e não pode exigir mais que o capital informado no perfil sem explicar o motivo em "premissas".
- "mvp" descreve a menor oferta testável em até 30 dias, com entrega concreta.
- "logistica" cobre como o produto/serviço chega ao cliente: canais, ferramentas, prazos e rotina mínima.
- "passos" tem de 3 a 5 ações curtas, começando com verbos no infinitivo.
- "premissas" lista até 4 hipóteses que precisam ser validadas. Nunca prometa lucro.
- Se o usuário pediu um ajuste, altere o resumo anterior mantendo as seções do formato.`;

/* --------------------------------- JSON ------------------------------------ */

export function parseJson(text) {
  let bruto = String(text || '').trim();
  bruto = bruto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  const inicio = bruto.indexOf('{');
  const fim = bruto.lastIndexOf('}');
  if (inicio >= 0 && fim > inicio) bruto = bruto.slice(inicio, fim + 1);

  try {
    const dados = JSON.parse(bruto);
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
      throw new Error('topo nao e objeto');
    }
    return dados;
  } catch {
    throw new Error('A IA não retornou um JSON válido. Tente novamente.');
  }
}

const texto = (valor, limite = 600) => String(valor ?? '').trim().slice(0, limite);
const numero = (valor, fallback = 0) => {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
};

function historicoResumido(historico) {
  if (!Array.isArray(historico)) return [];
  return historico.slice(-6).map((item) => ({
    role: item.role === 'user' ? 'user' : 'assistant',
    content: texto(item.text, 420),
  }));
}

async function completar(system, payload) {
  const resposta = await chat({
    model: MODELO,
    temperature: 0.5,
    max_tokens: 1800,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  });
  const conteudo = extractContent(resposta);
  if (!conteudo) throw new Error('A IA retornou uma resposta vazia. Tente novamente.');
  return parseJson(conteudo);
}

/* -------------------------------- Chamadas -------------------------------- */

function normalizarNichos(dados) {
  const sugestoes = (Array.isArray(dados.sugestoes) ? dados.sugestoes : [])
    .filter((item) => item && typeof item === 'object')
    .slice(0, 6)
    .map((item, indice) => ({
      id: texto(item.id, 24) || `n${indice + 1}`,
      nome: texto(item.nome, 120) || 'Nicho sugerido',
      nicho: texto(item.nicho, 100) || 'Serviços',
      adesao: numero(item.adesao, 60),
      capitalEstimado: texto(item.capitalEstimado, 80) || 'A definir',
      prazo: texto(item.prazo, 80) || 'A definir',
      porque: texto(item.porque, 320),
      mvp: texto(item.mvp, 320),
      riscos: texto(item.riscos, 320),
    }))
    .sort((a, b) => b.adesao - a.adesao);

  if (!sugestoes.length) throw new Error('A IA não sugeriu nichos. Tente novamente.');

  return {
    titulo: texto(dados.titulo, 140) || 'Nichos sugeridos para o seu perfil',
    resumo: texto(dados.resumo, 900) || 'Escolha um nicho para aprofundar o plano.',
    pergunta: texto(dados.pergunta, 300),
    sugestoes,
  };
}

function itensCapital(valor) {
  const itens = Array.isArray(valor?.itens) ? valor.itens : [];
  return itens
    .filter((item) => item && typeof item === 'object')
    .slice(0, 6)
    .map((item) => ({ item: texto(item.item, 120), valor: texto(item.valor, 80) }));
}

function normalizarResumo(dados) {
  const negocio = dados.negocio && typeof dados.negocio === 'object' ? dados.negocio : {};
  const passos = Array.isArray(negocio.passos)
    ? negocio.passos.slice(0, 6).map((item) => texto(item, 240)).filter(Boolean)
    : [];
  const premissas = Array.isArray(dados.premissas)
    ? dados.premissas.slice(0, 5).map((item) => texto(item, 240)).filter(Boolean)
    : [];

  return {
    titulo: texto(dados.titulo, 140) || 'Resumo do negócio',
    resumo: texto(dados.resumo, 1200),
    negocio: {
      nome: texto(negocio.nome, 120),
      nicho: texto(negocio.nicho, 140),
      publico: texto(negocio.publico, 400),
      propostaValor: texto(negocio.propostaValor, 500),
      mvp: texto(negocio.mvp, 700),
      capitalInicial: {
        total: texto(negocio.capitalInicial?.total, 100) || 'A definir',
        itens: itensCapital(negocio.capitalInicial),
      },
      logistica: texto(negocio.logistica, 700),
      canais: texto(negocio.canais, 500),
      precificacao: texto(negocio.precificacao, 500),
      riscos: texto(negocio.riscos, 500),
      passos,
    },
    premissas,
  };
}

export async function sugerirNichos({ perfil, historico = [], mensagem = '' }) {
  const dados = await completar(SYSTEM_NICHOS, {
    acao: 'sugerir_nichos',
    perfil,
    ajuste: texto(mensagem, 600),
    historico: historicoResumido(historico),
  });
  return normalizarNichos(dados);
}

export async function gerarResumo({ perfil, selecionada, historico = [], mensagem = '' }) {
  const dados = await completar(SYSTEM_RESUMO, {
    acao: 'gerar_resumo',
    perfil,
    nichoEscolhido: selecionada,
    ajuste: texto(mensagem, 600),
    historico: historicoResumido(historico),
  });
  return normalizarResumo(dados);
}
