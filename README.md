# Projetos Dinâmicos — assistente pessoal offline

O site da raiz (`projetosdinamicos.com.br`) é agora uma **plataforma de assistente
pessoal com IA**. O modelo roda de forma local/privada atrás do gateway
`https://api.projetosdinamicos.com.br/llm` (compatível com a API da OpenAI) e é
usado para conversas, escrita, organização, estudo e brainstorm.

O projeto é estático: **sem build, sem `npm` e sem dependências externas**. É uma
PWA — instala como aplicativo, abre com a interface em cache e responde mesmo sem
rede, usando geradores locais determinísticos. Conversas, memória e preferências
ficam no `localStorage` do navegador.

```text
usuário ──► chat (PWA) ──► POST /llm/v1/chat/completions ──► Qwen 1B Instruct
                 │                                              │
                 ├── GET /llm/health, /llm/v1/models            │
                 │                                              ▼
                 └── sem token / sem rede / falha ──► resposta local + aviso
                                                       │
                                                       ▼
                                          histórico salvo no navegador
```

## O que mudou em relação à versão anterior

| Antes | Agora |
| --- | --- |
| Fluxo guiado de criação de negócios (filtro → nichos → resumo) | Chat pessoal livre com 5 modos de especialização |
| Modelo padrão `opencode/big-pickle` | Qwen 1B Instruct (ID detectado em `/v1/models`) |
| Página dependente da rede | PWA com cache offline e fallback local |
| Sessão apenas em memória | Até 20 conversas persistidas no navegador |

Os arquivos do assistente de negócios e do antigo OpenFinancial seguem no
repositório como **legado** (documentados mais adiante), sem serem carregados
pela página principal.

## Recursos

- **Chat contínuo** com histórico recente enviado ao modelo (últimas 20 mensagens).
- **Modos**: Geral, Escrita, Tarefas, Estudo e Ideias — cada um com prompt próprio
  e sugestões de abertura.
- **Memória local**: um campo de contexto pessoal opcional, enviado ao modelo e
  editável/apagável a qualquer momento.
- **Anexos de texto** (`.txt`, `.md`, `.csv`, `.json`, até 60 KB) incorporados à
  mensagem enviada.
- **Múltiplas conversas**: criar, alternar, excluir e limpar mensagens.
- **Seletor de modelo**: preenche a lista devolvida por `/v1/models`, priorizando
  modelos Qwen 1B/1,5B/1,8B com `Instruct`/`Chat` no nome.
- **Indicadores honestos**: a resposta informa se veio da API /llm ou do gerador
  local; o badge do topo mostra o estado da conexão.

## Funcionamento offline

1. O `sw.js` guarda o shell da aplicação (HTML, CSS, módulos JS, manifesto,
   ícones e páginas legais) em um cache do Cache Storage.
2. Navegações usam rede primeiro e caem no `index.html` cacheado; arquivos
   estáticos são servidos do cache.
3. Requisições ao gateway **não** são interceptadas pelo service worker. Sem
   token, com `navigator.onLine === false` ou com falha de rede/HTTP, quem decide
   é a aplicação: ela registra um aviso na conversa e usa
   `assistente-prompts.js` para gerar uma resposta local (resumo extrativo,
   checklist, plano de estudos, ideias, rascunho ou comparação).
4. Ao voltar a conexão, o evento `online` dispara uma nova verificação de
   `/health` e `/v1/models`.

> O service worker só é registrado em HTTPS ou `localhost` — limite do navegador.

## API /llm

A base é configurável pela meta tag `llm-api-base` (padrão
`https://api.projetosdinamicos.com.br/llm`). O cliente OpenAI-compatible está em
`assets/js/core/opencode.js`.

| Método | Endpoint | Uso |
| --- | --- | --- |
| `GET` | `/health` | selo de status no topo. |
| `GET` | `/v1/models` | validar token, listar modelos e detectar o Qwen. |
| `POST` | `/v1/chat/completions` | enviar conversa (`stream: false`). |

O ID inicial vem da meta tag `pd-modelo` (padrão `qwen1b-instruct`). Com token
válido, a lista de `/v1/models` substitui esse valor pelo ID real publicado pelo
gateway; a escolha do usuário tem prioridade e é lembrada no navegador. Para
fixar outro modelo, edite a meta tag em `index.html`.

Exemplo do corpo enviado:

```json
{
  "model": "qwen1b-instruct",
  "messages": [
    { "role": "system", "content": "…prompt do modo + memória local…" },
    { "role": "user", "content": "…mensagem atual…" }
  ],
  "stream": false,
  "temperature": 0.6,
  "max_tokens": 900
}
```

## Arquivos

| Arquivo | Função |
| --- | --- |
| `index.html` | interface do assistente, PWA, modais de token. |
| `assets/js/assistente.js` | estado, renderização, envio, sessões, conexão e offline. |
| `assets/js/assistente-prompts.js` | prompts dos modos e respostas locais. |
| `assets/js/assistente-storage.js` | leitura/escrita validada do `localStorage`. |
| `assets/js/core/opencode.js` | cliente `/health`, `/v1/models`, `/v1/chat/completions`. |
| `assets/css/assistente.css` | layout do chat e estados de conexão. |
| `manifest.webmanifest`, `sw.js`, `assets/icons/` | instalação e cache da PWA. |
| `assets/css/base.css`, `landing.css` | tokens visuais, cabeçalho e rodapé compartilhados. |
| `termos.html`, `privacidade.html` | documentos legais do assistente. |
| `negocios*.js`, `negocios.css`, `llm-dashboard.js`, `metodologia.html`, `ativo.html`, `busca.js`, `server/`, `tools/` | legado do assistente de negócios/OpenFinancial; mantidos no repositório, não usados pela raiz. |
| `openchat.html` | redirecionamento antigo, mantido por compatibilidade. |

## Rodando localmente

Requisito: Python 3.10+ apenas para servir arquivos estáticos.

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Abra `http://localhost:8080/`. Clique em **Conectar API**, informe o Bearer token
e envie uma mensagem. Sem token, o assistente responde em modo local — útil para
testar a interface sem consumir cota.

> Módulos ES e service workers não funcionam em `file://`. Sirva a pasta por HTTP.

## Privacidade e limites

- O token **não** é embutido no HTML nem enviado a outro domínio além do gateway.
  Qualquer script da página com acesso ao `localStorage` poderia lê-lo: por isso
  a CSP é rígida e o projeto não carrega dependências de terceiros.
- Conversas e memória ficam no dispositivo. Limpar os dados do site apaga tudo.
- A resposta local é determinística, genérica e sinalizada como tal. Ela não
  consulta fontes externas, não sabe legislação e não substitui revisão humana.
- Modelos pequenos (1B) podem alucinar, perder contexto longo e errar em tarefas
  complexas. Prefira pedidos curtos e verifique informações relevantes.
- A API pode ter cota limitada. Nesse caso o assistente avisa e cai no modo local.

## Implantação

Publicação via GitHub Pages na branch `main`. O `CNAME` aponta
`www.projetosdinamicos.com.br`; a raiz deve apontar para o mesmo destino no
registrador. A API `/llm` é externa a este repositório: aqui ela é apenas
consumida. Após publicar, incrementar `CACHE` em `sw.js` força a atualização do
cache dos usuários.
