# Projetos Dinâmicos — dashboard OpenChat com Qwen

A raiz do site é agora um **dashboard simples de chat**: o frontend fala com o
Qwen 2.5 0.5B Instruct rodando como llamafile, diretamente
(`http://127.0.0.1:8080`) ou pelo gateway
`https://api.projetosdinamicos.com.br/llm`.

Não há build, `npm` ou dependências externas: HTML + CSS + módulos ES. O painel
é uma PWA leve (shell em cache) e mantém nome de usuário, modelo preferido e
histórico curto no `localStorage`.

```text
usuário ──► dashboard (index.html) ──► POST /llm/v1/chat/completions ──► Qwen 2.5 0.5B
                 │                        header X-Usuario
                 ├── GET /llm/health, /llm/v1/models
                 └── POST /auth/register { usuario }  (cadastro livre)
```

## Autenticação (mudou em relação ao Bearer token)

O gateway **não usa mais Bearer token**. Ele exige o header `X-Usuario` em
todas as rotas `/llm`, inclusive `/health`. O cadastro é livre:

```bash
curl -s -X POST https://api.projetosdinamicos.com.br/auth/register \
  -H 'Content-Type: application/json' -d '{"usuario":"debian"}'
```

- `201` → usuário criado; `409` (`usuario_exists`) → nome já existe e pode ser usado.
- Com um nome cadastrado: `curl -H 'X-Usuario: debian' .../llm/health` → `{"status":"ok"}`.
- Sem nome ou com nome desconhecido: `401` com `{"error":"unauthorized", ...}`.

O dashboard abre um diálogo pedindo o nome, cadastra/valida em `/auth/register`
e guarda o nome no navegador (`pd.qwen.usuario`). O llamafile local aceita
qualquer id de modelo (ou nenhum) e **não exige** `X-Usuario`.

## API

| Método | Endpoint | Uso no painel |
| --- | --- | --- |
| `POST` | `/auth/register` | cadastrar/validar o nome de usuário. |
| `GET` | `/llm/health` | selo de status no topo. |
| `GET` | `/llm/v1/models` | detectar o ID real do Qwen. |
| `POST` | `/llm/v1/chat/completions` | enviar a conversa (`stream: false`). |

Corpo enviado no chat (contexto curto de propósito: o modelo tem `n_ctx = 1024`):

```json
{
  "model": "/zip/qwen2.5-0.5b-instruct-q4_k_m.gguf",
  "messages": [
    { "role": "system", "content": "Você é o assistente do OpenChat…" },
    { "role": "user", "content": "…últimas 6 mensagens + mensagem atual…" }
  ],
  "stream": false,
  "temperature": 0.6,
  "max_tokens": 256
}
```

As bases são configuráveis por meta tag em `index.html`, sem mexer no JS:

```html
<meta name="llm-api-base"  content="https://api.projetosdinamicos.com.br/llm">
<meta name="auth-api-base" content="https://api.projetosdinamicos.com.br/auth">
```

Para desenvolver/testar direto no llamafile, troque apenas a primeira para
`http://127.0.0.1:8080`. A CSP da página já libera essa origem.

## Arquivos usados pelo dashboard

| Arquivo | Função |
| --- | --- |
| `index.html` | painel de chat, meta tags das bases e CSP. |
| `assets/js/dashboard.js` | estado, renderização, conexão, envio e histórico. |
| `assets/js/core/qwen.js` | cliente `/health`, `/v1/models`, `/chat/completions`, `/register` com `X-Usuario`. |
| `assets/css/dashboard.css` | layout do painel e estados de conexão. |
| `assets/css/base.css`, `landing.css` | tokens visuais, cabeçalho e rodapé compartilhados. |
| `manifest.webmanifest`, `sw.js`, `assets/icons/` | instalação e cache da PWA. |
| `termos.html`, `privacidade.html` | documentos legais. |
| `openchat.html` | redirecionamento mantido por compatibilidade. |

Os arquivos do assistente anterior (`assistente*.js`, `assistente.css`,
`core/opencode.js`, `llm-dashboard.js`, páginas e scripts de negócios/OpenFinancial)
permanecem no repositório como **legado**, mas não são mais carregados pela raiz.

## Rodando localmente

Requisito: Python 3.10+ para servir arquivos estáticos.

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Abra `http://127.0.0.1:8080/`. Para usar o gateway público basta informar um
nome de usuário no diálogo "Conectar". Para falar com o llamafile local, ajuste a
meta tag `llm-api-base` para `http://127.0.0.1:8080` (o servidor de arquivos
deve usar outra porta, por exemplo `python3 -m http.server 8000`).

> Módulos ES e service workers não funcionam em `file://`: sirva por HTTP.

## Servidor (llamafile + auth)

Serviços em `debian@projetosdinamicos`: `qwen-llamafile` (porta 8080) e
`qwen-auth` (porta 8090). Variáveis em `/var/www/llm/.env`: modelo
`Qwen2.5-0.5B-Instruct-Q4_K_M`, `CONTEXT_SIZE=1024`, `THREADS=2`,
`AUTH_CADASTRO_LIVRE=1`. O nginx publica `/llm/` e `/auth/` em
`api.projetosdinamicos.com.br` com CORS liberando `Content-Type` e `X-Usuario`.

```bash
sudo systemctl status qwen-llamafile qwen-auth
sudo systemctl restart qwen-llamafile
journalctl -u qwen-llamafile -n 50 --no-pager
```

> **Nunca** versionar `API_TOKEN` ou qualquer segredo do `.env` no frontend.
> Nenhuma credencial do servidor é necessária no navegador: a identidade é o
> nome de usuário enviado em `X-Usuario`.

## Limites

- Modelo de 0,5B: respostas rápidas, mas alucinações e contexto de 1024 tokens.
  O painel limita o histórico enviado e o tamanho da resposta (`max_tokens=256`).
- Sem usuário cadastrado (gateway) ou sem rede, o painel informa o erro; não há
  gerador local de fallback.
- Conversas e nome ficam no dispositivo. Limpar os dados do site apaga tudo.
