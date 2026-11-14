# OpenFinancial API — referência

API de leitura para o panorama probabilístico da B3. O servidor usa apenas a
biblioteca padrão do Python (3.10+) e serve JSON pré-calculado por
`ingest.py`. Não há banco de dados, login ou escrita em tempo de requisição.

```text
site estático (GitHub Pages)
        │
        ├── GET cdn.../b3/ativos.json, mercado.json, series/*.json
        │        (dados de mercado, cacheáveis)
        │
        └── GET api.../v1/panorama, /v1/analises/...
                 (análises probabilísticas)
```

O site tenta **API → CDN → demo** para análises e **CDN → demo** para ativos e
séries. Quando a CDN ou a API não respondem, o fallback local em
`assets/data/` mantém a interface funcionando e os selos da página indicam
`demo local`.

## Conteúdo desta pasta

| Arquivo | Função |
| --- | --- |
| `motor_probabilidades.py` | score técnico, softmax de três classes, indicadores, projeções e textos. |
| `ingest.py` | lê as séries, recalcula tudo e grava `ativos.json`, `mercado.json` e `panorama.json`. |
| `openfinancial_api.py` | servidor HTTP de referência, com CORS, ETag e cache. |
| `nginx-openfinancial.conf` | exemplo de virtual host para `api.projetosdinamicos.com.br`. |
| `openfinancial-api.service` | unidade systemd da API. |
| `openfinancial-ingest.service` / `.timer` | recálculo periódico dos JSON. |

## Rodando localmente

```bash
# 1. gerar os dados de demonstração (semente fixa, sem rede)
python3 tools/gerar_dados_demo.py

# 2. recalcular as análises
python3 server/ingest.py

# 3. subir a API
python3 server/openfinancial_api.py --host 127.0.0.1 --port 8096

# 4. em outro terminal, servir o site
python3 -m http.server 8080 --bind 127.0.0.1
```

Abra `http://localhost:8080/`. Em `localhost` ou `127.0.0.1`, o `config.js`
troca automaticamente a base de produção por `http://127.0.0.1:8096`, então a
API local é usada sem editar HTML. As páginas já liberam esse endereço na CSP.
Se a API local não estiver no ar, o cliente cai no demo local.

## Contrato

Todos os endpoints são `GET`, respondem `application/json; charset=utf-8` e
enviam CORS. Erros usam o mesmo formato:

```json
{
  "erro": "periodo_invalido",
  "mensagem": "Periodo invalido: xx. Use 1m, 3m, 6m, 1a, 5a.",
  "hora": "2026-11-13T14:56:11.591416+00:00"
}
```

Períodos aceitos: `1m` (21 sessões), `3m` (63), `6m` (126), `1a` (252) e
`5a` (1.260). O padrão é `6m`.

| Endpoint | Parâmetros | Retorno |
| --- | --- | --- |
| `GET /` | — | índice de endpoints e versão |
| `GET /health` | — | status, versão, períodos, fonte e horário de geração |
| `GET /v1/panorama` | `periodo` | panorama do período: resumo, distribuição, série de probabilidades, eventos e ativos |
| `GET /v1/ativos` | `setor`, `busca` | lista de ativos com preço e variações |
| `GET /v1/ativos/{ticker}` | `periodo` | metadados e análise do ativo |
| `GET /v1/ativos/{ticker}/serie` | `periodo`, `todos` | série OHLC simplificada (`data`, `fechamento`, `volume`) |
| `GET /v1/mercado` | `periodo` | índices, câmbio, juros, inflação e amplitude |
| `GET /v1/eventos` | `periodo`, `ticker` | eventos com fonte, impacto e URL opcional |
| `GET /v1/analises/{ticker}` | `periodo` | probabilidades, cenários, indicadores, projeção e sinais |
| `GET /v1/analises/{ticker}/narrativa` | `periodo` | narrativa por LLM (server-side) ou texto determinístico |

Exemplos:

```bash
curl -s http://127.0.0.1:8096/health
curl -s "http://127.0.0.1:8096/v1/panorama?periodo=6m"
curl -s "http://127.0.0.1:8096/v1/ativos?setor=bancos&busca=ITUB"
curl -s "http://127.0.0.1:8096/v1/ativos/PETR4/serie?periodo=1a"
curl -s "http://127.0.0.1:8096/v1/analises/PETR4?periodo=6m"
curl -s "http://127.0.0.1:8096/v1/analises/PETR4/narrativa?periodo=6m"
```

### Payload de análise

```json
{
  "ticker": "PETR4",
  "nome": "Petrobras PN",
  "setor": "Petróleo e gás",
  "periodo": "6m",
  "tendencia": "baixa",
  "score": -68.1,
  "confianca": 0.762,
  "probabilidades": { "alta": 0.0366, "lateral": 0.2296, "baixa": 0.7338 },
  "cenarios": [
    { "nome": "alta", "probabilidade": 0.0366, "retorno": 0.0428 },
    { "nome": "lateral", "probabilidade": 0.2296, "retorno": 0.0 },
    { "nome": "baixa", "probabilidade": 0.7338, "retorno": -0.0428 }
  ],
  "indicadores": { "mm20": 32.51, "mm50": 33.42, "mm200": 34.02, "rsi14": 29.6, "macd": -0.108, "volatilidade": 10.5 },
  "projecao": { "datas": ["..."], "p10": [], "p25": [], "p50": [], "p75": [], "p90": [] },
  "sinais": ["Preco abaixo da MM20", "MACD negativo"],
  "fontes": ["B3 - series historicas", "CVM - informacoes periodicas"],
  "demo": true,
  "disclaimer": "Conteudo informativo e probabilistico. Nao constitui recomendacao de investimento."
}
```

As probabilidades sempre somam 1 (com arredondamento). A classe `lateral` tem
peso próprio na softmax: com score zero ela fica em torno de 41,2%, e alta e
baixa ficam simétricas em torno de 29,4% cada. É o controle explícito do viés
pessimista descrito em `metodologia.html`.

## Ingestão

`ingest.py` não altera as séries. Ele lê `series/*.json`, recalcula os cinco
períodos e grava os três arquivos de saída de forma atômica (arquivo temporário
+ `os.replace`).

```bash
python3 server/ingest.py \
  --series-dir /var/lib/openfinancial/series \
  --out /var/www/openfinancial/data \
  --fonte b3 \
  --modelo opencode/big-pickle

# eventos próprios (opcional)
python3 server/ingest.py --eventos /etc/openfinancial/eventos.json
```

Formato aceito para série: lista de objetos com `data` (ISO), `fechamento`
(ou `close`/`preco`) e `volume`. Também aceita `{ "serie": [...] }`.
Tickers com menos de 21 pontos são ignorados.

Formato aceito para eventos:

```json
{
  "eventos": [
    {
      "data": "2026-11-12",
      "titulo": "Copom mantém a Selic",
      "fonte": "BCB",
      "impacto": "neutro",
      "url": "https://www.bcb.gov.br/",
      "demo": false
    }
  ]
}
```

O Ibovespa do arquivo `mercado.json` é um índice **igualmente ponderado** da
cesta acompanhada. Isso mantém índice e amplitude do mercado contando a mesma
história; em produção, troque essa série pela série oficial do Ibovespa.

## Narrativa por LLM

`/v1/analises/{ticker}/narrativa` é o único endpoint que pode chamar um modelo
de linguagem, e a chamada acontece **no servidor**. O navegador nunca recebe
token.

| Variável | Padrão | Uso |
| --- | --- | --- |
| `OPENFIN_LLM_BASE` | `https://api.projetosdinamicos.com.br/llm` | base OpenAI-compatible |
| `OPENFIN_LLM_TOKEN` | vazio | Bearer token; sem ele, a narrativa cai no motor |
| `OPENFIN_LLM_MODEL` | `opencode/big-pickle` | modelo usado na narrativa |
| `OPENFIN_MODEL` | `opencode/big-pickle` | modelo declarado no panorama |

O prompt exige: usar apenas os dados fornecidos, não afirmar certeza, manter os
três cenários visíveis, citar as fontes, não recomendar compra/venda e encerrar
com aviso de conteúdo informativo. Se o provedor falhar, a API responde `200`
com `fonte: "motor"` e o texto determinístico — o site não quebra e não inventa
notícias.

## Cache e ETag

- Respostas de sucesso: `Cache-Control: public, max-age=60` (ajustável com
  `--cache`).
- Erros: `no-store`.
- `ETag` é derivado do `mtime`/tamanho do arquivo **e da consulta** (período,
  filtros, ticker), então um `304` nunca devolve o recorte errado.
- `OPTIONS` responde `204` com os cabeçalhos de CORS.

## Implantação

Premissas dos exemplos: código em `/srv/openfinancial`, dados publicados em
`/var/www/openfinancial/data`, serviço rodando como usuário `openfinancial`.

```bash
sudo useradd --system --home /var/lib/openfinancial --shell /usr/sbin/nologin openfinancial
sudo mkdir -p /srv/openfinancial /var/lib/openfinancial/series /var/www/openfinancial/data
sudo chown -R openfinancial:openfinancial /var/lib/openfinancial /var/www/openfinancial
```

1. Copie o repositório para `/srv/openfinancial`.
2. Copie as séries oficiais para `/var/lib/openfinancial/series`.
3. Instale `server/openfinancial-api.service` em `/etc/systemd/system/`.
4. Ajuste `server/nginx-openfinancial.conf` e instale em
   `/etc/nginx/sites-available/`, criando o link em `sites-enabled/`.
5. `sudo systemctl daemon-reload && sudo systemctl enable --now openfinancial-api`.
6. `sudo systemctl enable --now openfinancial-ingest.timer`.
7. Emita o certificado (`certbot --nginx -d api.projetosdinamicos.com.br`).

A CDN deve publicar o conteúdo de `/var/www/openfinancial/data` em
`https://cdn.projetosdinamicos.com.br/b3/`. Os nomes precisam ser exatamente
`ativos.json`, `mercado.json`, `panorama.json` e `series/<TICKER>.json`.

### Checklist de produção

- [ ] `https://api.projetosdinamicos.com.br/health` responde `status: ok`.
- [ ] `https://api.projetosdinamicos.com.br/v1/panorama?periodo=6m` responde JSON.
- [ ] `https://cdn.projetosdinamicos.com.br/b3/ativos.json` responde JSON.
- [ ] `fonte` não é `demo` nos payloads de produção.
- [ ] CORS restrito ao domínio do site (`OPENFIN_CORS_ORIGIN`).
- [ ] Token do LLM apenas em `EnvironmentFile` com permissão `600`.
- [ ] `openfinancial-ingest.timer` rodando e logs sem erro.
- [ ] Cabeçalhos `Content-Security-Policy` do site liberam apenas API e CDN.

## Segurança

- Não exponha `OPENFIN_LLM_TOKEN` no HTML, no JavaScript ou em repositório.
- Rode a API atrás do nginx; o servidor de referência não termina TLS.
- Restrinja CORS ao domínio do site em produção:

  ```bash
  OPENFIN_CORS_ORIGIN=https://www.projetosdinamicos.com.br \
    python3 server/openfinancial_api.py --host 127.0.0.1 --port 8096
  ```

- O servidor só lê arquivos sob `--data`; tickers passam por validação
  `^[A-Za-z0-9]{3,12}$`.
- Não há escrita, upload ou execução de conteúdo enviado pelo cliente.

## Limitações conhecidas

- Modelo estatístico, não causal; não lê fundamentos nem valuation.
- Projeção é faixa de incerteza calibrada pelo passado recente, não previsão.
- Dados de demonstração são sintéticos e reproduzíveis pela semente `20261113`.
- A CDN de produção ainda precisa ser publicada; o front-end cai no demo local
  enquanto isso.
