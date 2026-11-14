#!/usr/bin/env python3
"""API de referencia do OpenFinancial.

Servidor HTTP com a biblioteca padrao do Python. Entrega o panorama
probabilistico, ativos, series, mercado, eventos e analises por ticker a partir
de arquivos JSON gerados por `ingest.py`.

Endpoints:
  GET /health
  GET /v1/panorama?periodo=6m
  GET /v1/ativos?setor=Bancos&busca=PETR
  GET /v1/ativos/PETR4?periodo=6m
  GET /v1/ativos/PETR4/serie?periodo=6m
  GET /v1/mercado?periodo=6m
  GET /v1/eventos?periodo=6m
  GET /v1/analises/PETR4?periodo=6m
  GET /v1/analises/PETR4/narrativa?periodo=6m   (LLM opcional, server-side)

O token do provedor de LLM fica em OPENFIN_LLM_TOKEN. Ele nunca e enviado ao
navegador. Sem token, a narrativa cai no texto deterministico do motor.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import threading
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

RAIZ = Path(__file__).resolve().parent.parent
VERSAO = "1.0.0"
PERIODOS = {"1m": 21, "3m": 63, "6m": 126, "1a": 252, "5a": 1260}
PERIODO_PADRAO = "6m"
TICKER_RE = re.compile(r"^[A-Za-z0-9]{3,12}$")


class ApiError(Exception):
    def __init__(self, status: int, mensagem: str, codigo: str = "erro") -> None:
        super().__init__(mensagem)
        self.status = status
        self.mensagem = mensagem
        self.codigo = codigo


class DataStore:
    """Leitura de JSON com cache invalidado por mtime."""

    def __init__(self, raiz: Path) -> None:
        self.raiz = raiz
        self._cache: dict[str, tuple[int, Any]] = {}
        self._lock = threading.Lock()

    def caminho(self, relativo: str) -> Path:
        return self.raiz / relativo

    def json(self, relativo: str, obrigatorio: bool = True) -> Any:
        caminho = self.caminho(relativo)
        if not caminho.exists():
            if obrigatorio:
                raise ApiError(503, f"Base de dados indisponivel: {relativo}", "sem_dados")
            return None
        mtime = caminho.stat().st_mtime_ns
        with self._lock:
            cache = self._cache.get(relativo)
            if cache and cache[0] == mtime:
                return cache[1]
        try:
            with caminho.open("r", encoding="utf-8") as fh:
                dados = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            raise ApiError(500, "Falha ao ler a base de dados.", "dados_invalidos") from exc
        with self._lock:
            self._cache[relativo] = (mtime, dados)
        return dados

    def etag(self, relativo: str, variacao: str = "") -> str | None:
        """ETag do arquivo, com a variacao da consulta (periodo, filtros).

        O mesmo arquivo responde a recortes diferentes; sem incluir a consulta,
        um cache intermediario poderia devolver o recorte errado para um 304.
        """
        caminho = self.caminho(relativo)
        if not caminho.exists():
            return None
        stat = caminho.stat()
        base = f"{stat.st_mtime_ns}-{stat.st_size}"
        if variacao:
            digest = hashlib.md5(variacao.encode("utf-8")).hexdigest()[:12]
            base = f"{base}-{digest}"
        return f'W/"{base}"'

    def panorama(self) -> dict:
        dados = self.json("panorama.json")
        if not isinstance(dados, dict) or not isinstance(dados.get("periodos"), dict):
            raise ApiError(503, "Panorama indisponivel.", "sem_dados")
        return dados

    def periodo(self, query: dict[str, list[str]], padrao: str = PERIODO_PADRAO) -> str:
        valor = (query.get("periodo") or [padrao])[0]
        if valor not in PERIODOS:
            raise ApiError(
                400,
                f"Periodo invalido: {valor}. Use {', '.join(PERIODOS)}.",
                "periodo_invalido",
            )
        return valor

    def ticker(self, bruto: str) -> str:
        ticker = unquote(bruto or "").strip().upper()
        if not TICKER_RE.fullmatch(ticker):
            raise ApiError(400, "Ticker invalido.", "ticker_invalido")
        return ticker

    def serie(self, ticker: str, obrigatoria: bool = True) -> dict:
        # Ausência de arquivo é 404 (ticker sem série), não 503 (base fora do ar).
        dados = self.json(f"series/{ticker}.json", obrigatorio=False)
        if dados is None and obrigatoria:
            raise ApiError(404, f"Serie nao encontrada para {ticker}.", "nao_encontrado")
        return dados or {}


def texto(valor: Any) -> str:
    return str(valor or "").strip()


def filtrar_ativos(lista: list[dict], query: dict[str, list[str]]) -> list[dict]:
    setor = texto((query.get("setor") or [""])[0]).lower()
    busca = texto((query.get("busca") or [""])[0]).lower()
    saida = []
    for ativo in lista:
        if setor and setor not in texto(ativo.get("setor")).lower():
            continue
        if busca:
            alvo = " ".join(
                texto(ativo.get(campo)).lower() for campo in ("ticker", "nome", "setor")
            )
            if busca not in alvo:
                continue
        saida.append(ativo)
    return saida


def analise_do_periodo(panorama: dict, ticker: str, periodo: str) -> dict | None:
    bloco = (panorama.get("periodos") or {}).get(periodo) or {}
    for analise in bloco.get("ativos") or []:
        if texto(analise.get("ticker")).upper() == ticker:
            return analise
    return None


def recortar_serie(pontos: list[dict], periodo: str) -> list[dict]:
    return pontos[-PERIODOS[periodo] :]


def narrativa_deterministica(analise: dict) -> str:
    return texto(analise.get("resumo")) or (
        f"{analise.get('ticker')}: leitura probabilistica indisponivel no momento."
    )


def chamar_llm(analise: dict, periodo: str) -> tuple[str, str]:
    """Chama a ponte OpenAI-compatible no servidor. Retorna (texto, modelo)."""
    base = os.environ.get("OPENFIN_LLM_BASE", "https://api.projetosdinamicos.com.br/llm").rstrip("/")
    token = os.environ.get("OPENFIN_LLM_TOKEN", "").strip()
    modelo = os.environ.get("OPENFIN_LLM_MODEL", "opencode/big-pickle")
    if not token:
        raise ApiError(503, "Narrativa por LLM desativada: token ausente.", "llm_desativado")

    contexto = {
        "ticker": analise.get("ticker"),
        "nome": analise.get("nome"),
        "periodo": periodo,
        "preco": analise.get("preco"),
        "variacaoPeriodo": analise.get("variacaoPeriodo"),
        "tendencia": analise.get("tendencia"),
        "confianca": analise.get("confianca"),
        "probabilidades": analise.get("probabilidades"),
        "cenarios": analise.get("cenarios"),
        "indicadores": analise.get("indicadores"),
        "sinais": analise.get("sinais"),
        "fontes": analise.get("fontes"),
    }
    sistema = (
        "Voce escreve leituras de mercado em portugues do Brasil para o OpenFinancial. "
        "Regras obrigatorias: (1) use apenas os dados fornecidos; (2) nunca afirme certeza; "
        "(3) mantenha os tres cenarios visiveis, inclusive o lateral; (4) cite as fontes; "
        "(5) nao recomende compra, venda ou manutencao; (6) termine com um aviso curto de que "
        "o conteudo e informativo e probabilistico. Escreva no maximo 140 palavras, sem listas."
    )
    corpo = {
        "model": modelo,
        "messages": [
            {"role": "system", "content": sistema},
            {
                "role": "user",
                "content": "Dados da analise em JSON:\n" + json.dumps(contexto, ensure_ascii=False),
            },
        ],
        "temperature": 0.3,
        "max_tokens": 380,
    }
    requisicao = urllib.request.Request(
        f"{base}/v1/chat/completions",
        data=json.dumps(corpo).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "OpenFinancial-API/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(requisicao, timeout=30) as resposta:
            dados = json.loads(resposta.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        raise ApiError(502, f"Provedor de LLM indisponivel ({type(exc).__name__}).", "llm_indisponivel") from exc

    try:
        return dados["choices"][0]["message"]["content"].strip(), modelo
    except (KeyError, IndexError, TypeError) as exc:
        raise ApiError(502, "Resposta inesperada do provedor de LLM.", "llm_invalido") from exc


class OpenFinancialHandler(BaseHTTPRequestHandler):
    server_version = f"OpenFinancial/{VERSAO}"
    protocol_version = "HTTP/1.1"

    store: DataStore
    cors_origin = "*"
    cache_segundos = 60

    # ------------------------------------------------------------------ HTTP
    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.enviar_cabecalhos(comprimento=0, cache="no-store")
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        # Mesmo roteamento do GET; responder_json omite o corpo em HEAD.
        self.do_GET()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        caminho = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query, keep_blank_values=True)

        try:
            status, payload, etag = self.rotear(caminho, query)
        except ApiError as exc:
            status = exc.status
            payload = {
                "erro": exc.codigo,
                "mensagem": exc.mensagem,
                "hora": datetime.now(timezone.utc).isoformat(),
            }
            etag = None
        except Exception as exc:  # pragma: no cover - protecao de borda
            self.log_error("Erro inesperado em %s: %s", caminho, type(exc).__name__)
            status = 500
            payload = {
                "erro": "interno",
                "mensagem": "Erro interno ao processar a requisicao.",
                "hora": datetime.now(timezone.utc).isoformat(),
            }
            etag = None

        if etag and self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.enviar_cabecalhos(comprimento=0, cache=self.cache_controle(status), etag=etag)
            self.end_headers()
            return

        self.responder_json(payload, status=status, etag=etag)

    # --------------------------------------------------------------- Rotas
    def rotear(self, caminho: str, query: dict[str, list[str]]) -> tuple[int, Any, str | None]:
        if caminho == "/":
            return 200, {
                "servico": "OpenFinancial API",
                "versao": VERSAO,
                "documentacao": "server/README.md",
                "endpoints": [
                    "/health",
                    "/v1/panorama?periodo=6m",
                    "/v1/ativos",
                    "/v1/ativos/{ticker}?periodo=6m",
                    "/v1/ativos/{ticker}/serie?periodo=6m",
                    "/v1/mercado?periodo=6m",
                    "/v1/eventos?periodo=6m",
                    "/v1/analises/{ticker}?periodo=6m",
                    "/v1/analises/{ticker}/narrativa?periodo=6m",
                ],
            }, None

        if caminho == "/health":
            try:
                panorama = self.store.panorama()
                fonte = panorama.get("fonte")
                gerado = panorama.get("geradoEm")
            except ApiError:
                fonte = None
                gerado = None
            return 200, {
                "status": "ok",
                "servico": "openfinancial-api",
                "versao": VERSAO,
                "hora": datetime.now(timezone.utc).isoformat(),
                "periodos": list(PERIODOS),
                "fonte": fonte,
                "geradoEm": gerado,
            }, None

        if caminho == "/v1/panorama":
            panorama = self.store.panorama()
            if "periodo" in query:
                periodo = self.store.periodo(query)
                bloco = (panorama.get("periodos") or {}).get(periodo)
                if not bloco:
                    raise ApiError(404, f"Periodo sem dados: {periodo}.", "nao_encontrado")
                saida = {
                    chave: valor for chave, valor in panorama.items() if chave != "periodos"
                }
                saida["periodos"] = {periodo: bloco}
            else:
                saida = panorama
            escopo = periodo if "periodo" in query else "todos"
            return 200, saida, self.store.etag("panorama.json", escopo)

        if caminho == "/v1/ativos":
            dados = self.store.json("ativos.json")
            lista = dados.get("ativos") or []
            filtrados = filtrar_ativos(lista, query)
            return 200, {
                "fonte": dados.get("fonte"),
                "moeda": dados.get("moeda", "BRL"),
                "atualizadoEm": dados.get("atualizadoEm"),
                "total": len(filtrados),
                "ativos": filtrados,
            }, self.store.etag(
                "ativos.json",
                f"{(query.get('setor') or [''])[0]}|{(query.get('busca') or [''])[0]}",
            )

        if caminho == "/v1/mercado":
            periodo = self.store.periodo(query)
            dados = self.store.json("mercado.json")
            panorama = self.store.panorama()
            bloco = (panorama.get("periodos") or {}).get(periodo) or {}
            saida = dict(dados)
            saida["periodo"] = periodo
            saida["periodoLabel"] = bloco.get("periodoLabel")
            saida["breadth"] = bloco.get("distribuicao") or dados.get("breadth")
            return 200, saida, self.store.etag("mercado.json", periodo)

        if caminho == "/v1/eventos":
            periodo = self.store.periodo(query)
            panorama = self.store.panorama()
            bloco = (panorama.get("periodos") or {}).get(periodo) or {}
            ticker = None
            if query.get("ticker"):
                ticker = self.store.ticker((query.get("ticker") or [""])[0])
            eventos = bloco.get("eventos") or []
            return 200, {
                "fonte": panorama.get("fonte"),
                "periodo": periodo,
                "ticker": ticker,
                "total": len(eventos),
                "eventos": eventos,
            }, self.store.etag("panorama.json", f"{periodo}|{ticker or ''}")

        casamento = re.fullmatch(r"/v1/ativos/([^/]+)/serie", caminho)
        if casamento:
            ticket = self.store.ticker(casamento.group(1))
            periodo = self.store.periodo(query)
            dados = self.store.serie(ticket)
            pontos = dados.get("serie") or dados.get("series") or []
            if texto((query.get("todos") or [""])[0]) in ("1", "true", "sim"):
                selecionados = pontos
            else:
                selecionados = recortar_serie(pontos, periodo)
            return 200, {
                "ticker": ticket,
                "fonte": dados.get("fonte"),
                "periodo": periodo,
                "total": len(selecionados),
                "serie": selecionados,
            }, self.store.etag(
                f"series/{ticket}.json",
                f"{periodo}|{(query.get('todos') or [''])[0]}",
            )

        casamento = re.fullmatch(r"/v1/ativos/([^/]+)", caminho)
        if casamento:
            ticket = self.store.ticker(casamento.group(1))
            periodo = self.store.periodo(query)
            panorama = self.store.panorama()
            analise = analise_do_periodo(panorama, ticket, periodo)
            if not analise:
                raise ApiError(404, f"Ativo {ticket} sem analise em {periodo}.", "nao_encontrado")
            ativos = self.store.json("ativos.json", obrigatorio=False) or {}
            metadados = next(
                (a for a in ativos.get("ativos", []) if texto(a.get("ticker")).upper() == ticket),
                {},
            )
            return 200, {
                "fonte": panorama.get("fonte"),
                "periodo": periodo,
                "ativo": metadados,
                "analise": analise,
            }, None

        casamento = re.fullmatch(r"/v1/analises/([^/]+)/narrativa", caminho)
        if casamento:
            ticket = self.store.ticker(casamento.group(1))
            periodo = self.store.periodo(query)
            panorama = self.store.panorama()
            analise = analise_do_periodo(panorama, ticket, periodo)
            if not analise:
                raise ApiError(404, f"Ativo {ticket} sem analise em {periodo}.", "nao_encontrado")

            if os.environ.get("OPENFIN_LLM_TOKEN", "").strip():
                try:
                    conteudo, modelo = chamar_llm(analise, periodo)
                    return 200, {
                        "ticker": ticket,
                        "periodo": periodo,
                        "fonte": "llm",
                        "modelo": modelo,
                        "narrativa": conteudo,
                        "geradoEm": datetime.now(timezone.utc).isoformat(),
                    }, None
                except ApiError as exc:
                    self.log_message("LLM indisponivel: %s", exc.codigo)

            return 200, {
                "ticker": ticket,
                "periodo": periodo,
                "fonte": "motor",
                "modelo": panorama.get("modelo"),
                "narrativa": narrativa_deterministica(analise),
                "geradoEm": panorama.get("geradoEm"),
            }, None

        casamento = re.fullmatch(r"/v1/analises/([^/]+)", caminho)
        if casamento:
            ticket = self.store.ticker(casamento.group(1))
            periodo = self.store.periodo(query)
            panorama = self.store.panorama()
            analise = analise_do_periodo(panorama, ticket, periodo)
            if not analise:
                raise ApiError(404, f"Ativo {ticket} sem analise em {periodo}.", "nao_encontrado")
            saida = dict(analise)
            saida["fonte"] = panorama.get("fonte")
            saida["periodo"] = periodo
            return 200, saida, None

        raise ApiError(404, f"Rota nao encontrada: {caminho}.", "nao_encontrado")

    # ------------------------------------------------------------ Respostas
    def cache_controle(self, status: int) -> str:
        if status >= 400:
            return "no-store"
        return f"public, max-age={self.cache_segundos}"

    def enviar_cabecalhos(
        self,
        comprimento: int,
        cache: str,
        etag: str | None = None,
    ) -> None:
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(comprimento))
        self.send_header("Cache-Control", cache)
        self.send_header("Access-Control-Allow-Origin", self.cors_origin)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type, If-None-Match")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if etag:
            self.send_header("ETag", etag)
        self.send_header("Vary", "Origin, Accept-Encoding")

    def responder_json(self, payload: Any, status: int = 200, etag: str | None = None) -> None:
        corpo = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.enviar_cabecalhos(len(corpo), self.cache_controle(status), etag)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(corpo)

    def log_message(self, formato: str, *args: Any) -> None:
        agora = datetime.now().strftime("%H:%M:%S")
        sys.stderr.write(f"[{agora}] {self.address_string()} {formato % args}\n")


class OpenFinancialServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    parser = argparse.ArgumentParser(description="API de referencia do OpenFinancial.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8096)
    parser.add_argument("--data", type=Path, default=RAIZ / "assets" / "data")
    parser.add_argument("--cors", default=os.environ.get("OPENFIN_CORS_ORIGIN", "*"))
    parser.add_argument("--cache", type=int, default=60, help="Cache-Control em segundos.")
    args = parser.parse_args()

    if not args.data.exists():
        raise SystemExit(f"Diretorio de dados nao encontrado: {args.data}")
    if not (args.data / "panorama.json").exists():
        raise SystemExit(
            f"panorama.json nao encontrado em {args.data}. Rode server/ingest.py antes."
        )

    OpenFinancialHandler.store = DataStore(args.data)
    OpenFinancialHandler.cors_origin = args.cors
    OpenFinancialHandler.cache_segundos = max(0, args.cache)

    servidor = OpenFinancialServer((args.host, args.port), OpenFinancialHandler)
    print(f"OpenFinancial API {VERSAO} em http://{args.host}:{args.port}")
    print(f"Dados: {args.data}")
    print(f"CORS: {args.cors} | cache: {args.cache}s")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando.")
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
