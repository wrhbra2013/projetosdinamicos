# OpenFinancial

Panorama probabilístico dos ativos da B3. Em vez de um palpite de alta ou baixa,
cada ativo recebe **três probabilidades que somam 100%** — alta, lateral e baixa —
por cinco horizontes (1 mês, 3 meses, 6 meses, 1 ano e 5 anos).

O site é estático, sem etapa de build, sem cadastro e sem bibliotecas de gráfico
externas. Os dados de mercado chegam por CDN; as análises, por API.

```text
                         ┌─────────────────────────────────────────┐
  visitante ── HTTPS ──► │  site estático (GitHub Pages)           │
                         │  index.html · ativo.html · metodologia  │
                         └───────────────┬─────────────────────────┘
                                         │
              ┌──────────────────────────┴──────────────────────────┐
              ▼                                                     ▼
  cdn.projetosdinamicos.com.br/b3                    api.projetosdinamicos.com.br
  ativos.json · mercado.json · panorama.json          /v1/panorama · /v1/analises/...
  series/<TICKER>.json                                (motor + LLM server-side)
              │                                                     │
              └────────────────► assets/data/ (fallback demo) ◄──────┘
```

A ordem de tentativa é **API → CDN → demo** para análises e **CDN → demo** para
ativos e séries. No console de busca, o selo de fonte mostra qual motor respondeu:
API, gateway de IA ou demo local.

A página inicial é um **console de busca**: o termo digitado vira
`GET /v1/ativos?busca=<termo>`; se a API não responder, o cliente tenta o gateway
`/llm/v1` com o catálogo local como contexto e, por último, filtra a cópia demo em
`assets/data/ativos.json`. A comparação ignora maiúsculas e acentos (`itau` encontra
`Itaú`), e o resultado é exibido em texto simples no textarea.

## Páginas

| Arquivo | Função |
| --- | --- |
| `index.html` | busca: filtro por ticker, nome ou setor, com os resultados em um textarea (API → IA → demo). |
| `ativo.html` | detalhe do ativo: preço com médias e projeção, probabilidades, cenários, indicadores e fontes. |
| `metodologia.html` | fontes, fórmula do score, controle de viés, períodos, contrato da API e limites. |
| `termos.html` | Termos de Uso. |
| `privacidade.html` | Política de Privacidade (LGPD). |
| `openchat.html` | Redireciona para `index.html` (links antigos do OpenChat). |

## Como a probabilidade é calculada

O motor parte de um **score técnico** `S` entre −1 e +1, combinando momentum
ajustado por volatilidade, MM20 × MM50, RSI 14, MACD, volume e preço × MM200.
O score vira distribuição por uma softmax de três classes com âncora neutra:

```text
Z = e^(2,2·S) + e^(−2,2·S) + 1,4
p_alta    = e^(2,2·S) / Z
p_baixa   = e^(−2,2·S) / Z
p_lateral = 1,4 / Z
```

Com `S = 0`, a leitura é aproximadamente **29,4% alta / 41,2% lateral / 29,4%
baixa**. A classe lateral não é resíduo: ela tem peso próprio e domina quando os
sinais são fracos. Alta e baixa são simétricas em módulo — não existe penalidade
assimétrica para o otimismo. Esse é o controle explícito do viés pessimista
comum em análises econômicas, descrito em `metodologia.html#vies`.

A **confiança** exibida ao lado da leitura combina a magnitude do score com o
tamanho da amostra; não é probabilidade de acerto.

## Dados

| Camada | Fonte padrão | Conteúdo |
| --- | --- | --- |
| Mercado | `https://cdn.projetosdinamicos.com.br/b3` | `ativos.json`, `mercado.json`, `series/<TICKER>.json` |
| Análises | `https://api.projetosdinamicos.com.br` | `/v1/panorama`, `/v1/analises/<TICKER>`, `/v1/eventos` |
| Fallback | `assets/data/` | cópia local marcada com `fonte: "demo"` |

A CDN e os endpoints de dados da API de produção ainda não estão publicados. O
gateway `/llm/v1` responde, mas pode estar limitado por cota. Por isso o repositório
inclui uma cesta sintética de **16 ativos da B3**, gerada com semente fixa
`20261113` e data-base `2026-11-13`, além de cinco anos de sessões diárias,
projeções e eventos. Todos os payloads de demonstração carregam
`fonte: "demo"` e a interface sinaliza isso.

```bash
python3 tools/gerar_dados_demo.py     # regenera assets/data/
python3 server/ingest.py              # recalcula as análises sobre as séries
```

## Rodando localmente

Requisitos: Python 3.10+. Não há `npm`, bundler ou dependências externas.

```bash
# terminal 1 — site estático
python3 -m http.server 8080 --bind 127.0.0.1

# terminal 2 — API de referência (opcional)
python3 server/openfinancial_api.py --host 127.0.0.1 --port 8096
```

Abra `http://localhost:8080/`. Em `localhost` ou `127.0.0.1`, o cliente usa
automaticamente a API em `http://127.0.0.1:8096` — a CSP já libera esse
endereço. Sem a API, ele usa o fallback local e mostra `demo local` nos selos.

> Módulos ES não funcionam em `file://`. Sirva a pasta por HTTP.

## API de referência

| Endpoint | Parâmetros | Retorno |
| --- | --- | --- |
| `GET /health` | — | status, versão, períodos, fonte e horário |
| `GET /v1/panorama` | `periodo` | resumo, distribuição, série de probabilidades, eventos e ativos |
| `GET /v1/ativos` | `setor`, `busca` | lista de ativos com preço e variações |
| `GET /v1/ativos/{ticker}` | `periodo` | metadados e análise do ativo |
| `GET /v1/ativos/{ticker}/serie` | `periodo`, `todos` | série OHLC simplificada |
| `GET /v1/mercado` | `periodo` | índices, câmbio, juros, inflação e amplitude |
| `GET /v1/eventos` | `periodo`, `ticker` | eventos com fonte e impacto |
| `GET /v1/analises/{ticker}` | `periodo` | probabilidades, cenários, indicadores e projeção |
| `GET /v1/analises/{ticker}/narrativa` | `periodo` | narrativa por LLM (server-side) ou texto do motor |

Períodos: `1m`, `3m`, `6m`, `1a`, `5a` (padrão `6m`). O contrato completo,
exemplos de `curl`, variáveis de ambiente e implantação com nginx/systemd estão
em [`server/README.md`](server/README.md).

A narrativa por LLM é opcional e acontece **no servidor**: o token fica em
variável de ambiente e nunca chega ao navegador. Sem token, a API devolve o
texto determinístico do motor e o site continua funcionando.

## Estrutura

```text
index.html, ativo.html, metodologia.html, termos.html, privacidade.html
assets/
  css/base.css, landing.css, openfinancial.css, legal.css
  js/
    core/config.js        bases de CDN/API, timeout e metadados
    core/b3-client.js     carregamento API → CDN → demo e normalização
    core/charts.js        SVG: preço, área empilhada, sparkline
    core/format.js        números, percentuais, datas e classes
    busca.js              console de busca (API → IA → demo)
    ativo.js              comportamento da página do ativo
    panorama.js           painel antigo (não usado pela busca)
    llm-dashboard.js      experimento antigo de painel (não usado pela busca)
  data/                   dados demo + séries históricas
server/
  motor_probabilidades.py modelo compartilhado
  ingest.py               ingestão e recálculo
  openfinancial_api.py    servidor HTTP de referência
  README.md, nginx, systemd
tools/
  gerar_dados_demo.py     gerador determinístico
```

## Implantação

1. O site é publicado no GitHub Pages a partir da branch `main` (há um `CNAME`
   para `www.projetosdinamicos.com.br`).
2. A API roda atrás do nginx em `api.projetosdinamicos.com.br`, com o serviço
   `openfinancial-api` e o recálculo periódico `openfinancial-ingest.timer`.
3. A CDN publica os JSON de `/var/www/openfinancial/data` em
   `https://cdn.projetosdinamicos.com.br/b3/`.

Passo a passo, checklist e configurações: [`server/README.md`](server/README.md).

## Limitações

- Modelo estatístico, não causal: não lê fundamentos, governança ou valuation.
- Projeções são faixas de incerteza calibradas pelo passado recente, não previsões.
- Cenários de alta e baixa usam ±1 desvio-padrão do horizonte; suporte e resistência
  são apenas níveis de referência e não definem esses retornos.
- Dados demo são sintéticos; use os selos de fonte para saber o que está na tela.
- Eventos corporativos (desdobramentos, dividendos, mudanças de índice) exigem
  ajuste da série antes da ingestão.
- Nada aqui é recomendação de investimento. Confirme informações nos canais
  oficiais da B3, CVM, BCB e das companhias.

## Licença e contato

Código e textos do projeto pertencem aos responsáveis pelo OpenFinancial. Dados
de mercado podem pertencer à B3, às companhias ou aos órgãos que os publicam e
seguem suas próprias condições de uso.

- Conteúdo e correções: <contato@projetosdinamicos.com.br>
- Privacidade e LGPD: <dpo@projetosdinamicos.com.br>
