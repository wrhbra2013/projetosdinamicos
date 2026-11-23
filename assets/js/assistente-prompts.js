/* ============================================================================
   Projetos Dinâmicos — prompts dos modos e respostas locais (sem API).

   O fallback existe para manter o assistente útil quando o gateway /llm não
   está alcançável (ou sem token). Ele é determinístico, roda no navegador e
   jamais finge ser uma resposta do modelo.
   ========================================================================== */

export const MODOS = [
  {
    id: 'geral',
    nome: 'Geral',
    descricao: 'Dúvidas, decisões e explicações.',
    placeholder: 'Pergunte o que quiser…',
    sugestoes: [
      'Explique este assunto em 5 tópicos simples',
      'Ajude-me a comparar duas opções',
    ],
    system: `Você é o assistente pessoal da Projetos Dinâmicos, executado por meio da API /llm com um modelo de linguagem pequeno (por padrão, Qwen 1B Instruct).
Responda em português do Brasil, de forma direta e prática. Prefira listas curtas a parágrafos longos.
Se a pergunta estiver ambígua, faça no máximo uma pergunta de esclarecimento. Nunca invente fatos, números, leis ou fontes; diga quando não sabe.
Use texto simples com marcadores "-" ou "1." (sem HTML). Contexto pessoal do usuário, quando existir, deve orientar o tom e os exemplos, sem ser repetido.`,
  },
  {
    id: 'escrita',
    nome: 'Escrita',
    descricao: 'E-mails, textos e rascunhos.',
    placeholder: 'O que quer escrever? Para quem?',
    sugestoes: [
      'Rascunhe um e-mail curto e cordial sobre…',
      'Reescreva este parágrafo de forma mais clara',
    ],
    system: `Você é um auxiliar de escrita do assistente pessoal da Projetos Dinâmicos.
Responda em português do Brasil. Escreva o texto pronto para uso, com tom cordial e linguagem simples, sem explicar a própria escrita.
Se faltar destinatário, objetivo ou tom, escolha uma opção razoável e diga qual premissa adotou. Não use HTML; apenas texto simples e quebras de linha.
Respeite o contexto pessoal informado pelo usuário. Não invente dados pessoais, nomes ou empresas.`,
  },
  {
    id: 'tarefas',
    nome: 'Tarefas',
    descricao: 'Organização e prioridades.',
    placeholder: 'Liste tarefas, prazos ou objetivos…',
    sugestoes: [
      'Organize minhas tarefas desta semana',
      'Transforme este objetivo em passos pequenos',
    ],
    system: `Você é um organizador pessoal do assistente da Projetos Dinâmicos.
Responda em português do Brasil. Converta pedidos em uma checklist numerada, com passos pequenos e verificáveis, ordenados por prioridade.
Separe "Agora", "Depois" e "Se sobrar tempo" quando fizer sentido. Indique o próximo passo único. Não use HTML.
Não presumir horas, prazos ou recursos que o usuário não informou; se precisar, pergunte. Contexto pessoal deve ajustar as sugestões.`,
  },
  {
    id: 'estudo',
    nome: 'Estudo',
    descricao: 'Planos de estudo e exercícios.',
    placeholder: 'Qual tema quer estudar?',
    sugestoes: [
      'Monte um plano de estudos de 7 dias sobre…',
      'Explique este tema como se eu fosse iniciante',
    ],
    system: `Você é um tutor pessoal do assistente da Projetos Dinâmicos.
Responda em português do Brasil. Comece pelo conceito mais simples, use analogias do cotidiano e termine com 3 perguntas de revisão e suas respostas curtas.
Para planos, divida em sessões curtas com objetivo, atividade e forma de verificar o aprendizado. Não use HTML.
Adapte o ritmo ao contexto pessoal informado. Não invente conteúdo de fontes específicas sem citar que é uma explicação geral.`,
  },
  {
    id: 'ideias',
    nome: 'Ideias',
    descricao: 'Brainstorm e alternativas.',
    placeholder: 'Quero ideias para…',
    sugestoes: [
      'Dê 5 ideias baratas para…',
      'Quais alternativas eu não estou considerando?',
    ],
    system: `Você é um parceiro de brainstorm do assistente da Projetos Dinâmicos.
Responda em português do Brasil. Entregue de 5 a 8 ideias distintas, numeradas, cada uma com uma frase de como testar em pequena escala.
Inclua ao menos uma ideia conservadora, uma ousada e uma que usa poucos recursos. Não use HTML. Não prometa resultado financeiro.
Use o contexto pessoal do usuário para tornar as ideias viáveis na rotina dele.`,
  },
];

const MODOS_POR_ID = new Map(MODOS.map((modo) => [modo.id, modo]));

export function modoPorId(id) {
  return MODOS_POR_ID.get(id) || MODOS[0];
}

export function systemPrompt(modoId, preferencias = '') {
  const modo = modoPorId(modoId);
  const contexto = String(preferencias || '').trim().slice(0, 900);
  if (!contexto) return modo.system;
  return `${modo.system}\n\nContexto pessoal informado pelo usuário (use apenas se for relevante):\n${contexto}`;
}

/* ------------------------------ Fallback local ----------------------------- */

const STOPWORDS = new Set([
  'aquele', 'aquela', 'aqueles', 'aquelas', 'isso', 'isso', 'este', 'esta', 'esses', 'essas',
  'sobre', 'para', 'para', 'com', 'como', 'mais', 'muito', 'pelo', 'pela', 'dos', 'das',
  'uma', 'umas', 'uns', 'dos', 'que', 'qual', 'quais', 'onde', 'quando', 'porque', 'entao',
  'sao', 'tem', 'ter', 'uma', 'pode', 'deve', 'seus', 'suas', 'seu', 'sua', 'nosso', 'nossa',
  'meu', 'minha', 'esse', 'essa', 'pelo', 'pela', 'acho', 'quero', 'preciso', 'ajuda',
  'fazer', 'coisa', 'coisas', 'tambem', 'ainda', 'porem', 'mas', 'por', 'sem', 'sob',
]);

const AVISO_LOCAL = '\n\n— Resposta local, gerada sem a API /llm. Conecte o token para usar o Qwen 1B Instruct.';

function extrairTema(texto) {
  const limpo = String(texto || '')
    .replace(/^\s*(oi|ol[aá]|bom dia|boa tarde|boa noite|por favor|pode|poderia|me ajude a|preciso de|quero|fale sobre|explique|resuma|resumo|crie|faça|gere|organize|planeje|monte|d[eê])\b[:\s]*/i, '')
    .replace(/[.!?,;:]+$/, '')
    .trim();
  return limpo.slice(0, 90) || 'o assunto';
}

function intencao(texto) {
  const t = String(texto || '').toLowerCase();
  if (/(resum|resumo|s[ií]ntese|destaque os pontos)/.test(t)) return 'resumo';
  if (/(tarefa|checklist|organiz|prioriz|agenda|planejar o dia|cronograma)/.test(t)) return 'tarefas';
  if (/(ideia|brainstorm|sugira op[cç][oõ]es|alternativas|o que fazer)/.test(t)) return 'ideias';
  if (/(estud|aprender|plano de estudos|explicar como|iniciante)/.test(t)) return 'estudo';
  if (/(escrev|redig|rascunho|e-?mail|texto|post|par[aá]grafo)/.test(t)) return 'escrita';
  if (/(decid|escolh|pr[oó]s e contras|comparar op[cç][oõ]es)/.test(t)) return 'decisao';
  return 'geral';
}

function resumirLocal(texto) {
  const bruto = String(texto || '')
    .replace(/^\s*(resuma|resumo|fa[cç]a um resumo de|resumir)\s*[:\-]?\s*/i, '')
    .trim();
  const frases = bruto
    .split(/[.!?]+\s*|\n+/)
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 15);

  if (frases.length < 2) {
    return 'Envie um texto com pelo menos duas frases para eu destacar os pontos principais.\n\nDica: cole o texto completo e escreva "resuma".';
  }

  const palavras = bruto.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [];
  const frequencia = new Map();
  for (const palavra of palavras) {
    if (!STOPWORDS.has(palavra)) frequencia.set(palavra, (frequencia.get(palavra) || 0) + 1);
  }

  const pontuadas = frases.map((frase, indice) => {
    const termos = frase.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [];
    const pontos = termos.reduce((total, termo) => total + (frequencia.get(termo) || 0), 0);
    return { frase, indice, pontos };
  });

  const destaques = [pontuadas[0], ...pontuadas.slice(1).sort((a, b) => b.pontos - a.pontos).slice(0, 2)]
    .sort((a, b) => a.indice - b.indice);

  return 'Resumo local — trechos mais informativos:\n\n'
    + destaques.map((item, indice) => `${indice + 1}. ${item.frase}.`).join('\n');
}

function tarefasLocal(texto, tema) {
  let itens = String(texto || '')
    .split(/\n+/)
    .map((linha) => linha.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

  if (itens.length < 2) {
    itens = String(texto || '').split(/[,;]+/).map((parte) => parte.trim()).filter((parte) => parte.length > 3);
  }
  if (itens.length < 2) {
    itens = [
      `Definir o resultado esperado de ${tema}`,
      `Reunir as informações necessárias sobre ${tema}`,
      `Executar a primeira ação de ${tema} e registrar o resultado`,
    ];
  }

  const urgentes = itens.filter((item) => /hoje|agora|urgente|prazo|at[eé]|importante/i.test(item));
  const restantes = itens.filter((item) => !urgentes.includes(item));
  const ordenados = [...urgentes, ...restantes].slice(0, 10);

  return `Plano local para "${tema}":\n\n`
    + ordenados.map((item, indice) => `${indice + 1}. [ ] ${item}${urgentes.includes(item) ? ' (prioridade)' : ''}`).join('\n')
    + '\n\nEscolha um único item para começar e defina um horário fixo para ele.';
}

function ideiasLocal(tema) {
  const ideias = [
    `Simples: reduzir ${tema} ao menor passo que ainda entrega valor.`,
    `Combinar: juntar ${tema} com uma rotina que você já faz.`,
    `Substituir: trocar a parte mais cara ou demorada de ${tema} por uma alternativa gratuita.`,
    `Adaptar: copiar uma ideia de outro contexto e ajustá-la ao seu.`,
    `Inverter: perguntar o que faria o oposto de ${tema} e extrair o aprendizado.`,
    `Remover: eliminar uma etapa de ${tema} sem perder o resultado.`,
  ];
  return `Ideias locais para "${tema}":\n\n`
    + ideias.map((ideia, indice) => `${indice + 1}. ${ideia}`).join('\n')
    + '\n\nTeste uma ideia por vez, com o menor esforço possível, antes de decidir.';
}

function estudoLocal(tema) {
  const dias = [
    'Ler uma visão geral e anotar 3 termos desconhecidos.',
    'Explicar os 3 termos com palavras suas, sem consultar.',
    'Ver um exemplo prático e anotar cada etapa.',
    'Repetir o exemplo sem olhar e comparar o resultado.',
    'Resolver 3 exercícios ou responder 3 perguntas simples.',
    'Ensinar o tema em 5 minutos para outra pessoa (ou em voz alta).',
    'Revisar os erros e escrever um resumo de uma página.',
  ];
  return `Plano de estudos local — ${tema} (7 dias):\n\n`
    + dias.map((tarefa, indice) => `Dia ${indice + 1}: ${tarefa}`).join('\n')
    + '\n\nAjuste a duração de cada sessão à sua rotina; regularidade vale mais que volume.';
}

function escritaLocal(tema) {
  return `Rascunho local sobre "${tema}":\n\n`
    + 'Assunto: [escreva um título curto e específico]\n\n'
    + `Olá,\n\nEscrevo sobre ${tema}. O ponto principal é [objetivo em uma frase].\n\n`
    + 'Contexto: [uma ou duas frases com o que a outra pessoa precisa saber].\n\n'
    + 'Pedido: [o que você espera que a pessoa faça e até quando].\n\n'
    + 'Se precisar, posso adaptar o tom — basta dizer se é formal, informal ou urgente.';
}

function decisaoLocal(tema) {
  return `Comparação local para "${tema}":\n\n`
    + 'Opção A\n- A favor: [requer menos tempo ou dinheiro]\n- Contra: [limitação principal]\n\n'
    + 'Opção B\n- A favor: [entrega mais valor no longo prazo]\n- Contra: [custo ou esforço adicional]\n\n'
    + 'Critério de decisão: escolha a opção que melhor atende sua prioridade atual e liste o que faria mudar essa escolha.';
}

function geralLocal(texto, tema) {
  const trecho = String(texto || '').trim().slice(0, 180);
  return `Recebi: "${trecho}${String(texto || '').length > 180 ? '…' : ''}".\n\n`
    + `Sem a API /llm, consigo ajudar de forma estruturada com ${tema}:\n`
    + '- transformar isso em checklist de tarefas;\n'
    + '- montar um resumo dos pontos principais;\n'
    + '- gerar ideias ou um plano de estudos.\n\n'
    + 'Escreva "organize", "resuma", "ideias" ou "estude" seguido do assunto.';
}

export function respostaLocal({ texto = '', modoId = 'geral' } = {}) {
  const tema = extrairTema(texto);
  const detectada = intencao(texto);

  let resposta;
  switch (detectada) {
    case 'resumo': resposta = resumirLocal(texto); break;
    case 'tarefas': resposta = tarefasLocal(texto, tema); break;
    case 'ideias': resposta = ideiasLocal(tema); break;
    case 'estudo': resposta = estudoLocal(tema); break;
    case 'escrita': resposta = escritaLocal(tema); break;
    case 'decisao': resposta = decisaoLocal(tema); break;
    default: resposta = modoPorId(modoId).id === 'ideias'
      ? ideiasLocal(tema)
      : modoPorId(modoId).id === 'tarefas'
        ? tarefasLocal(texto, tema)
        : geralLocal(texto, tema);
  }

  return resposta + AVISO_LOCAL;
}
