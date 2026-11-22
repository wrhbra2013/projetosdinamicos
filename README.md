# Projetos Dinâmicos — assistente de criação de negócios

O site da raiz (`projetosdinamicos.com.br`) agora é um **assistente de criação de
negócios**. Em vez de um chat aberto, ele funciona como um filtro guiado: o
visitante informa capital, tempo, cidade, modelo de operação, habilidades e
restrições; a API `projetosdinamicos/llm` devolve sugestões de nichos; cada nova
interação refina as opções até gerar um **resumo de negócio** com MVP, capital
inicial, logística, canais, riscos e próximos passos.

```text
visitante ──► modal de filtro ──► POST /llm/v1/chat/completions
                                      │
                  JSON com 3 a 5 nichos (adesão, capital, MVP)
                                      │
                     escolha / ajuste por mensagem
                                      │
                  JSON com resumo: nicho, MVP, capital, logística
                                      │
                          dashboard + copiar resumo
```

O projeto continua estático, sem build, sem `npm` e sem bibliotecas externas.
A autenticação é o **Bearer token da API /llm, informado pelo próprio visitante
e salvo só no `localStorage` do navegador**. Sem token ou com falha na API, o
assistente usa sugestões determinísticas locais e sinaliza a fonte como
`demo local`.

## Fluxo do assistente

| Etapa | O que acontece | Saída |
| --- | --- | --- |
| 1. Filtro | Modal com capital, cidade, modelo, tempo, habilidades, público, objetivo e restrições. | Perfil exibido na coluna lateral. |
| 2. Nichos | O filtro vira prompt; o modelo devolve 3 a 5 nichos com aderência de 0 a 100. | Cartões com capital estimado, prazo, MVP e riscos. |
| 3. Resumo | Ao escolher um nicho (ou pedir um ajuste), o modelo devolve o plano estruturado. | Painel com MVP, capital inicial, logística, canais e passos. |

Botões do painel:

- **Refinar**: envia o texto digitado junto com o histórico recente. Se o resumo
  já existe, ele é reescrito; caso contrário, vêm novos nichos.
- **Outras sugestões**: pede ao modelo opções diferentes com o mesmo filtro.
- **Aprofundar este nicho**: seleciona o cartão e gera o resumo na hora.
- **Copiar resumo**: leva o plano em texto simples para a área de transferência.
- **Reiniciar**: limpa a sessão e mantém o token salvo.

## Páginas e arquivos

| Arquivo | Função |
| --- | --- |
| `index.html` | landing + dashboard do assistente + modais de filtro e token. |
| `assets/js/negocios.js` | estado da sessão, renderização do painel e orquestração das chamadas. |
| `assets/js/negocios-llm.js` | prompts, parsing JSON e normalização das respostas da API. |
| `assets/js/negocios-demo.js` | sugestões e resumo locais usados como fallback. |
| `assets/js/core/opencode.js` | cliente OpenAI-compatible: `/health`, `/v1/models`, `/v1/chat/completions`. |
| `assets/css/negocios.css` | layout do dashboard, cartões, modais e responsividade. |
| `termos.html`, `privacidade.html` | documentos legais. |
| `metodologia.html`, `ativo.html`, `busca.js`, `server/` | legado do antigo OpenFinancial (B3), mantidos no repositório. |
| `openchat.html` | redirecionamento antigo, mantido por compatibilidade de links. |

## API /llm

Base configurável pela meta tag `llm-api-base` (padrão
`https://api.projetosdinamicos.com.br/llm`) e modelo por `pd-modelo` (padrão
`opencode/big-pickle`).

| Método | Endpoint | Uso no site |
| --- | --- | --- |
| `GET` | `/health` | selo de status no topo. |
| `GET` | `/v1/models` | validação do token e contagem de modelos. |
| `POST` | `/v1/chat/completions` | sugestão de nichos e geração/ajuste do resumo. |

As respostas são pedidas como **JSON puro** e normalizadas antes de aparecer na
tela. O parser aceita também JSON dentro de cercas de código. O histórico
enviado é limitado às últimas seis mensagens e cada mensagem é truncada, para
evitar payloads grandes.

Contrato simplificado das respostas:

```jsonc
// nichos
{
  "etapa": "nichos",
  "titulo": "...",
  "resumo": "...",
  "sugestoes": [
    {
      "id": "n1", "nome": "...", "nicho": "...", "adesao": 82,
      "capitalEstimado": "R$ 500 – R$ 2.000", "prazo": "2 semanas",
      "porque": "...", "mvp": "...", "riscos": "..."
    }
  ],
  "pergunta": "..."
}

// resumo
{
  "etapa": "resumo",
  "titulo": "...",
  "resumo": "...",
  "negocio": {
    "nome": "...", "nicho": "...", "publico": "...", "propostaValor": "...",
    "mvp": "...",
    "capitalInicial": { "total": "R$ ...", "itens": [{ "item": "...", "valor": "R$ ..." }] },
    "logistica": "...", "canais": "...", "precificacao": "...", "riscos": "...",
    "passos": ["..."]
  },
  "premissas": ["..."]
}
```

## Rodando localmente

Requisitos: Python 3.10+ apenas para servir arquivos. Não há dependências de
frontend.

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Abra `http://localhost:8080/`. Clique em **Conectar API**, informe o Bearer
token e depois em **Abrir filtro**. Sem token, o fluxo funciona em
`demo local`, útil para testar layout e interações sem consumir cota.

> Módulos ES não funcionam em `file://`. Sirva a pasta por HTTP.

## Segurança e limites

- O token não é embutido no HTML, não vai para o repositório e não é enviado a
  outro domínio além do gateway configurado. Ainda assim, qualquer script da
  página com acesso ao `localStorage` poderia lê-lo: por isso o site usa CSP
  rígida e nenhuma dependência de terceiros. Para um público amplo, o próximo
  passo é trocar isso por um proxy server-side com o token em variável de
  ambiente.
- As faixas de capital e os MVPs são **hipóteses**, não orçamento, promessa de
  faturamento ou recomendação de investimento.
- O fallback local é determinístico e genérico; ele não consulta mercado, lei
  municipal ou disponibilidade de fornecedores.
- A API pode estar limitada por cota. Nesse caso o assistente avisa e cai no
  modo demonstração.
- Os textos legais e a metodologia ainda usam vocabulário do antigo
  OpenFinancial; a próxima revisão deve adaptá-los ao assistente de negócios.

## Implantação

O site é publicado no GitHub Pages a partir da branch `main`. O `CNAME` aponta
`www.projetosdinamicos.com.br`; a raiz `projetosdinamicos.com.br` deve ser
configurada no DNS/registrador para o mesmo destino. A API `/llm` é externa a
este repositório — este projeto apenas consome o gateway.
