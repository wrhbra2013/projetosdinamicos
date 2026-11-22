/* ============================================================================
   Modo demonstração — sugestões determinísticas quando a API /llm não responde.

   Os textos são hipóteses genéricas, não análise de mercado. A interface marca
   a fonte como "demo local" para não confundir com uma resposta do modelo.
   ========================================================================== */

const MODELOS = {
  online: 'Online',
  presencial: 'Presencial',
  hibrido: 'Híbrido',
  qualquer: 'Qualquer',
};

const rotularModelo = (valor) => MODELOS[valor] || 'Qualquer';

const faixa = (min, max) => `R$ ${min.toLocaleString('pt-BR')} – R$ ${max.toLocaleString('pt-BR')}`;

const capitalTexto = (valor) => {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0
    ? `R$ ${numero.toLocaleString('pt-BR')}`
    : 'um capital ainda não definido';
};

const IDEIAS = [
  {
    nome: 'Organização e produtividade para pequenos negócios',
    nicho: 'Serviços profissionais',
    modelo: 'hibrido',
    min: 300,
    max: 1500,
    prazo: '1 a 3 semanas',
    porque: 'Usa conhecimento já existente e não exige estoque nem ponto comercial.',
    mvp: 'Diagnóstico gratuito de 30 minutos e um plano de uma página para três clientes.',
    riscos: 'Depende de uma rede inicial de contatos para conseguir os primeiros casos.',
  },
  {
    nome: 'Conteúdo e social media para comércios de bairro',
    nicho: 'Marketing digital',
    modelo: 'online',
    min: 200,
    max: 900,
    prazo: '1 a 2 semanas',
    porque: 'Trabalha com o tempo disponível e pode começar com dois clientes.',
    mvp: 'Três posts e um roteiro de 15 segundos por semana para um comércio.',
    riscos: 'Exige disciplina de entrega e pode haver concorrência de preço.',
  },
  {
    nome: 'Assistência e manutenção residencial sob demanda',
    nicho: 'Serviços locais',
    modelo: 'presencial',
    min: 800,
    max: 3000,
    prazo: '2 a 4 semanas',
    porque: 'Demanda procura recorrente no bairro e permite começar com ferramentas básicas.',
    mvp: 'Atendimento de emergência em um raio de 3 km com orçamento por WhatsApp.',
    riscos: 'Rotina de deslocamento e sazonalidade da procura.',
  },
  {
    nome: 'Cuidados e passeio de pets no bairro',
    nicho: 'Serviços para pets',
    modelo: 'presencial',
    min: 300,
    max: 1200,
    prazo: '1 a 2 semanas',
    porque: 'Baixo capital, agenda previsível e possibilidade de crescer por indicação.',
    mvp: 'Pacote de três passeios com fotos e relatório simples para o tutor.',
    riscos: 'Depende de confiança, disponibilidade e cuidado com responsabilidade civil.',
  },
  {
    nome: 'Produto digital de apoio ao estudo',
    nicho: 'Educação digital',
    modelo: 'online',
    min: 100,
    max: 700,
    prazo: '2 a 4 semanas',
    porque: 'Sem estoque, com entrega escalável e foco em um público específico.',
    mvp: 'Um guia em PDF com checklist e dois exercícios resolvidos.',
    riscos: 'Demanda validação do tema antes de produzir o material completo.',
  },
  {
    nome: 'Revenda sob encomenda de itens de uso diário',
    nicho: 'Comércio enxuto',
    modelo: 'hibrido',
    min: 1000,
    max: 5000,
    prazo: '2 a 4 semanas',
    porque: 'Evita estoque parado e permite testar produtos com pedidos antecipados.',
    mvp: 'Catálogo de dez itens e pré-venda para um grupo fechado de clientes.',
    riscos: 'Prazos de fornecedor e margem apertada no início.',
  },
];

function pontuacao(item, perfil) {
  let nota = 58;

  const capital = Number(perfil?.capital);
  if (Number.isFinite(capital)) {
    if (capital >= item.max) nota += 18;
    else if (capital >= item.min) nota += 12;
    else nota -= 20;
  }

  const modelo = perfil?.modelo;
  if (modelo && modelo !== 'qualquer') {
    nota += item.modelo === modelo ? 14 : item.modelo === 'hibrido' ? 6 : -8;
  }

  const horas = String(perfil?.horas || '');
  if (horas.includes('até 5')) {
    nota += item.modelo === 'online' ? 8 : item.modelo === 'presencial' ? -6 : 0;
  } else if (horas.includes('20')) {
    nota += item.modelo === 'presencial' ? 6 : 0;
  }

  const objetivo = String(perfil?.objetivo || '');
  if (objetivo.includes('renda')) nota += item.min <= 1000 ? 8 : 0;
  if (objetivo.includes('escalar')) nota += item.modelo === 'online' ? 8 : 0;

  const ideia = String(perfil?.ideia || '').toLowerCase();
  const textoItem = `${item.nome} ${item.nicho}`.toLowerCase();
  if (ideia && textoItem.split(' ').some((palavra) => palavra.length > 4 && ideia.includes(palavra))) {
    nota += 10;
  }

  return Math.min(96, Math.max(35, Math.round(nota)));
}

export function sugerirNichosDemo(perfil, _mensagem = '', offset = 0) {
  const rotacao = Math.abs(Number(offset) || 0) % IDEIAS.length;
  const ordenadas = [...IDEIAS]
    .map((item, indice) => ({ item, indice }))
    .sort((a, b) => pontuacao(b.item, perfil) - pontuacao(a.item, perfil))
    .map(({ item }) => item);

  const escolhidas = [];
  for (let passo = 0; passo < 4; passo += 1) {
    escolhidas.push(ordenadas[(rotacao + passo) % ordenadas.length]);
  }

  const sugestoes = escolhidas.map((item, indice) => ({
    id: `d${rotacao + indice + 1}`,
    nome: item.nome,
    nicho: item.nicho,
    adesao: pontuacao(item, perfil),
    capitalEstimado: faixa(item.min, item.max),
    prazo: item.prazo,
    porque: item.porque,
    mvp: item.mvp,
    riscos: item.riscos,
  }));

  return {
    titulo: 'Nichos sugeridos para o seu perfil',
    resumo: perfil?.ideia
      ? `Partindo da ideia "${perfil.ideia}", estas opções tentam equilibrar ${capitalTexto(perfil?.capital)} com o tempo disponível.`
      : 'Estas opções equilibram baixo capital, tempo disponível e modelo de operação. Escolha uma para aprofundar.',
    pergunta: 'Qual destas opções você quer transformar em um resumo de negócio?',
    sugestoes,
  };
}

const logisticaPorModelo = (modelo, cidade) => {
  const local = cidade ? ` em ${cidade}` : '';
  if (modelo === 'online') {
    return 'Atendimento por WhatsApp e videochamada, com entrega de arquivos em nuvem. Reserve duas manhãs por semana para produção e uma tarde para contato com clientes.';
  }
  if (modelo === 'presencial') {
    return `Atendimento local${local} com agenda por WhatsApp, deslocamento limitado a um raio definido e registro simples de cada visita em planilha.`;
  }
  return `Operação mista${local}: prospecção e divulgação online, entrega presencial em blocos de horários. Use uma planilha única para pedidos, prazos e pagamentos.`;
};

export function gerarResumoDemo(perfil, selecionada) {
  const escolha = selecionada || sugerirNichosDemo(perfil).sugestoes[0];
  const capital = Math.max(0, Number(perfil?.capital) || 0);
  const limite = Math.max(capital, 300);
  const ferramentas = Math.round(limite * 0.4);
  const divulgacao = Math.round(limite * 0.2);
  const reserva = Math.max(0, limite - ferramentas - divulgacao);

  return {
    titulo: `Plano enxuto — ${escolha.nome}`,
    resumo: `Um primeiro teste para ${escolha.nicho.toLowerCase()} com foco em validar demanda antes de ampliar. A proposta usa operação ${rotularModelo(perfil?.modelo).toLowerCase()} e mantém o custo inicial dentro da faixa informada.`,
    negocio: {
      nome: escolha.nome,
      nicho: escolha.nicho,
      publico: perfil?.publico
        ? `${perfil.publico}${perfil?.cidade ? `, em ${perfil.cidade}` : ''}.`
        : `Pessoas e pequenos negócios${perfil?.cidade ? ` em ${perfil.cidade}` : ''} com necessidade recorrente.`,
      propostaValor: escolha.porque,
      mvp: escolha.mvp,
      capitalInicial: {
        total: faixa(Math.min(limite, ferramentas + divulgacao), limite),
        itens: [
          { item: 'Ferramentas e materiais básicos', valor: faixa(Math.round(ferramentas * 0.6), ferramentas) },
          { item: 'Divulgação local e material', valor: faixa(Math.round(divulgacao * 0.5), divulgacao) },
          { item: 'Reserva para imprevistos', valor: faixa(0, reserva) },
        ],
      },
      logistica: logisticaPorModelo(perfil?.modelo, perfil?.cidade),
      canais: 'WhatsApp, indicação de conhecidos e um perfil simples em rede social. Registre a origem de cada contato.',
      precificacao: 'Comece com um preço de teste por entrega e reajuste depois de cinco clientes, comparando tempo gasto e custo direto.',
      riscos: escolha.riscos,
      passos: [
        'Listar 20 contatos ou locais com o problema descrito.',
        'Oferecer o MVP para três pessoas com condição de teste.',
        'Registrar tempo, custo e feedback de cada atendimento.',
        'Ajustar a oferta com base nas objeções mais ouvidas.',
        'Decidir entre repetir o teste ou trocar o ângulo do nicho.',
      ],
    },
    premissas: [
      'Existe demanda recorrente suficiente no público escolhido.',
      'O tempo semanal informado comporta os primeiros atendimentos.',
      'O capital disponível cobre ferramentas e divulgação iniciais.',
    ],
  };
}
