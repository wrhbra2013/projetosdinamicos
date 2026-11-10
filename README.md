# Projetos Dinâmicos — site estático + API ativa

Frontend estático que usa os serviços ativos da Projetos Dinâmicos para
autenticação e para o assistente de IA, mantendo projetos, ideias e tarefas no
SQLite do próprio navegador.

## Páginas

| Arquivo | Função |
| --- | --- |
| `index.html` | Painel LLM: login, cadastro, token Bearer e chat com anexos. |
| `app.html` | Aplicação completa (painel, projetos, ideias, tarefas, LGPD, configurações e Assistente IA). |
| `openchat.html` | Redireciona para `index.html` (o chat passou a ser a página inicial). |

## Serviços usados

| Serviço | Base padrão | Uso |
| --- | --- | --- |
| Auth | `https://api.projetosdinamicos.com.br/auth` | login, cadastro, sessão e perfil |
| LLM | `https://api.projetosdinamicos.com.br/llm` | assistente de IA (llamafile atrás do nginx) |

### Endpoints

```text
GET  {auth}/status            -> { registration_open, authenticated, user }
POST {auth}/register          { email, senha }
POST {auth}/login             { email, senha } -> token Bearer + cookie llm_session
GET  {auth}/me                (Authorization: Bearer ... ou cookie)
POST {auth}/logout

GET  {llm}/health             (protegido)
GET  {llm}/v1/models          (protegido)
POST {llm}/v1/chat/completions (protegido, compatível com OpenAI)
```

O login usa o campo **`senha`** (não `password`). O token devolvido pelo login é
guardado em `localStorage` (`pd.api_token`), e o cookie `llm_session` também é
enviado em todas as requisições (`credentials: 'include'`).

## Configuração

As bases podem ser trocadas sem alterar o JavaScript, via meta tags no `<head>`:

```html
<meta name="auth-api-base" content="https://api.projetosdinamicos.com.br/auth">
<meta name="llm-api-base" content="https://api.projetosdinamicos.com.br/llm">
```

Para desenvolvimento local, aponte para os serviços locais e ajuste o CSP:

```html
<meta name="auth-api-base" content="http://127.0.0.1:8090/auth">
<meta name="llm-api-base" content="http://127.0.0.1:3004">
```

O CSP já libera `http://localhost:3004`, `http://127.0.0.1:3004`,
`http://localhost:8090` e `http://127.0.0.1:8090`.

## Como a autenticação funciona

1. Ao abrir, o app tenta restaurar a sessão local (`sessionStorage`).
2. Sem sessão local, consulta `GET {auth}/status`; se `authenticated` for
   verdadeiro (cookie ou token salvo), busca o perfil em `GET {auth}/me`.
3. A API é a autoridade de login. O usuário remoto é espelhado na tabela
   `users` do SQLite local para que projetos e auditoria continuem
   funcionando. A primeira conta espelhada de uma instalação vira `owner`.
4. **API fora do ar (erro de rede ou HTTP 5xx):** o app usa o login local
   existente (modo local-first). Erros de credencial (401/403) **não** caem no
   fallback.
5. O cadastro respeita `registration_open` do serviço. Atualmente a produção
   informa `registration_open: false`, então novas contas precisam ser
   liberadas pelo administrador do serviço.

O token nunca fica embutido no HTML. Ele é digitado/salvo pelo usuário ou
obtido no login.

## Desenvolvimento

Não há build: os arquivos são servidos como estão. Use qualquer servidor
estático (não abra via `file://`, por causa de módulos ES e WebCrypto):

```bash
python3 -m http.server 8080
# abra http://localhost:8080/index.html
```

Para usar a API de produção, o navegador precisa estar na origem permitida
(`https://www.projetosdinamicos.com.br`) ou o serviço de auth precisa liberar
a origem local no CORS.

## Diagnóstico

- `index.html` mostra o estado de `/llm` e da conta no topo.
- `app.html` → **Configurações → API e serviços** permite verificar
  `/auth/status` e `/llm/health`, salvar um token manualmente e sair da API.
- Em caso de `401`, faça login novamente ou cole um token válido.
- Se o LLM responder `401 unauthorized`, o problema é sessão/credencial, não o
  modelo.

## Estrutura relevante

```text
assets/js/core/api.js          cliente único de auth + LLM (bases, token, erros, SSE)
assets/js/core/auth.js         login local/remoto, espelho do usuário, sessões
assets/js/ui/views/auth.js     tela de entrada/cadastro
assets/js/ui/views/llm-chat.js Assistente IA dentro do app
assets/js/ui/views/settings.js aba "API e serviços"
assets/js/llm-dashboard.js     comportamento de index.html
assets/css/llm.css             estilos do assistente
```
