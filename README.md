# OpenChat — Projetos Dinâmicos

Site estático do **OpenChat**, uma interface de chat que consome a API
OpenAI-compatible publicada pelo `install_opencode.sh`. Não há login nem
cadastro: o usuário informa o **Bearer token** gerado na instalação e ele fica
salvo apenas no navegador.

## Páginas

| Arquivo | Função |
| --- | --- |
| `index.html` | OpenChat: token, status da API, modelos e chat com anexos. |
| `openchat.html` | Redireciona para `index.html` (compatibilidade com links antigos). |
| `termos.html` | Termos de Uso. |
| `privacidade.html` | Política de Privacidade. |

## API usada

| Serviço | Base padrão | Uso |
| --- | --- | --- |
| OpenCode | `https://api.projetosdinamicos.com.br/llm` | ponte OpenAI-compatible do `install_opencode.sh` |

```text
GET  {llm}/health               -> { status: "ok" }            (público)
GET  {llm}/v1/models            -> lista de modelos            (Bearer)
POST {llm}/v1/chat/completions  -> resposta OpenAI-compatible  (Bearer)
```

O `install_opencode.sh` publica a ponte atrás do nginx em `/llm/` e imprime no
fim da instalação uma linha como:

```text
Bearer token: <token>
```

Esse é o valor pedido pelo OpenChat. Ele é enviado como
`Authorization: Bearer <token>` em `/v1/models` e `/v1/chat/completions`.

O modelo é definido no servidor (`OPENCODE_PROVIDER` / `OPENCODE_MODEL`, por
padrão `opencode/big-pickle`). O campo `model` enviado pelo navegador é aceito
pela ponte, mas ignorado.

### Como o token é guardado

O token fica em `localStorage`, na chave `pd.opencode_token`. Ele nunca é
embutido no HTML e pode ser removido pelo botão **Limpar**.

As chamadas usam `credentials: 'omit'`: a ponte responde CORS com `*` e não usa
cookie de sessão, então o Bearer token é a única credencial.

## Configuração

A base pode ser trocada sem alterar o JavaScript, via meta tag no `<head>` de
`index.html`:

```html
<meta name="llm-api-base" content="https://api.projetosdinamicos.com.br/llm">
```

Para desenvolvimento local, aponte para a ponte do instalador (porta 8095):

```html
<meta name="llm-api-base" content="http://127.0.0.1:8095">
```

O CSP já libera `https:` e `http://127.0.0.1:8095` / `http://localhost:8095`.

## Desenvolvimento

Não há build: os arquivos são servidos como estão. Use um servidor estático
(não abra via `file://`, por causa de módulos ES):

```bash
python3 -m http.server 8080
# abra http://localhost:8080/
```

## Diagnóstico

- **API online / sem token**: a API responde, mas falta informar o Bearer token.
- **token inválido**: `/v1/models` respondeu 401/403; confira o token impresso
  no fim da instalação.
- **API offline**: falha de rede ou `/llm/health` fora do ar; verifique o nginx
  e os serviços `opencode-serve` / `opencode-bridge`.
- **429**: cota gratuita do modelo esgotada; aguarde e tente novamente.

Comandos úteis no servidor:

```bash
sudo bash install_opencode.sh status
sudo bash install_opencode.sh logs
sudo bash install_opencode.sh restart
```

## Estrutura

```text
index.html                     página do OpenChat
openchat.html                  redirect para index.html
termos.html                    Termos de Uso
privacidade.html               Política de Privacidade
CNAME                          domínio publicado
favicon.svg                    ícone
assets/css/base.css            tokens, reset, tipografia, botões e componentes
assets/css/landing.css         header, menu e footer compartilhados
assets/css/dashboard.css       layout e componentes do OpenChat
assets/css/legal.css           estilos das páginas legais
assets/js/core/opencode.js     cliente da ponte OpenCode (base, token, erros)
assets/js/llm-dashboard.js     comportamento do index.html
```

## Segurança

O CORS `*` permite que qualquer site chame a API **se tiver o token**. Portanto:

- não embuta o token no HTML/JS público;
- trate o Bearer token como segredo e revogue-o se vazar;
- se o site precisar oferecer o chat a visitantes sem token, use um proxy no
  servidor que guarde o token — não exponha o token no navegador.
