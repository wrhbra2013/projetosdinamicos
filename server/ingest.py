#!/usr/bin/env python3
"""Ingestao de referencia do OpenFinancial.

Le as series historicas (JSON por ticker), recalcula as analises de todos os
periodos e publica:

  ativos.json
  mercado.json
  panorama.json

As series nao sao alteradas. O diretorio de saida padrao e `assets/data`, o
mesmo usado pelo fallback do site. Em producao, aponte `--out` para a pasta
publicada na CDN e rode o servico da API sobre o mesmo diretorio.

Uso:
  python3 server/ingest.py
  python3 server/ingest.py --out /var/lib/openfinancial/data --fonte b3
  python3 server/ingest.py --eventos server/eventos.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from motor_probabilidades import (  # noqa: E402
    DISCLAIMER,
    FONTES_PADRAO,
    PERIODOS,
    PERIODO_LABEL,
    analisar,
    resumo_panorama,
    serie_probabilidades,
)

RAIZ = Path(__file__).resolve().parent.parent
MOEDA = "BRL"

EVENTOS_DEMO = [
    ("Copom mantém a Selic e reforça cautela com a inflação", "BCB", "neutro"),
    ("IBGE: IPCA fica dentro do intervalo esperado pelo mercado", "IBGE", "positivo"),
    ("B3 registra volume financeiro acima da média de 20 sessões", "B3", "positivo"),
    ("Relatório oficial aponta desaceleração moderada da atividade", "BCB", "negativo"),
    ("CVM divulga calendário de divulgações trimestrais", "CVM", "neutro"),
    ("Balanço comercial sustenta expectativa para o câmbio", "BCB", "positivo"),
    ("Agências internacionais revisam projeção de crescimento do Brasil", "FMI", "neutro"),
]

INDICES_PADRAO = [
    {
        "codigo": "USD/BRL",
        "nome": "Dólar comercial",
        "tipo": "moeda",
        "valor": 5.42,
        "variacaoDia": 0.0,
        "variacaoPeriodo": {"1m": 0.4, "3m": 1.8, "6m": -0.6, "1a": 3.2, "5a": 24.1},
        "sparkline": [5.31, 5.35, 5.38, 5.40, 5.39, 5.42, 5.44, 5.43, 5.41, 5.42],
    },
    {
        "codigo": "SELIC",
        "nome": "Selic meta",
        "tipo": "taxa",
        "valor": 12.25,
        "variacaoDia": 0.0,
        "variacaoPeriodo": {"1m": 0.0, "3m": 0.0, "6m": 0.5, "1a": 2.0, "5a": 9.25},
        "sparkline": [12.25, 12.25, 12.25, 12.25, 12.25],
    },
    {
        "codigo": "IPCA",
        "nome": "IPCA 12 meses",
        "tipo": "inflacao",
        "valor": 4.18,
        "variacaoDia": 0.0,
        "variacaoPeriodo": {"1m": 0.1, "3m": -0.2, "6m": -0.4, "1a": -0.9, "5a": 1.7},
        "sparkline": [4.5, 4.4, 4.3, 4.25, 4.2, 4.18],
    },
]


def ler_json(caminho: Path, padrao: Any = None) -> Any:
    if not caminho.exists():
        return padrao
    with caminho.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def escrever_json(caminho: Path, dados: Any) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    fd, temporario = tempfile.mkstemp(dir=str(caminho.parent), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(dados, fh, ensure_ascii=False, separators=(",", ":"))
            fh.write("\n")
        os.replace(temporario, caminho)
    finally:
        if os.path.exists(temporario):
            os.unlink(temporario)


def normalizar_pontos(bruto: Any) -> list[dict]:
    if isinstance(bruto, dict):
        bruto = bruto.get("serie") or bruto.get("series") or bruto.get("data") or []
    if not isinstance(bruto, list):
        return []
    por_data: dict[str, dict] = {}
    for ponto in bruto:
        if not isinstance(ponto, dict):
            continue
        data = ponto.get("data") or ponto.get("date")
        fechamento = ponto.get("fechamento", ponto.get("close", ponto.get("preco")))
        if not data or fechamento is None:
            continue
        try:
            valor = float(fechamento)
        except (TypeError, ValueError):
            continue
        por_data[str(data)[:10]] = {
            "data": str(data)[:10],
            "fechamento": round(valor, 4),
            "volume": int(ponto.get("volume") or 0),
        }
    return [por_data[d] for d in sorted(por_data)]


def carregar_series(diretorio: Path) -> dict[str, list[dict]]:
    if not diretorio.exists():
        raise SystemExit(f"Diretorio de series nao encontrado: {diretorio}")
    series: dict[str, list[dict]] = {}
    for arquivo in sorted(diretorio.glob("*.json")):
        ticker = arquivo.stem.upper()
        pontos = normalizar_pontos(ler_json(arquivo, {}))
        if len(pontos) >= 21:
            series[ticker] = pontos
    if not series:
        raise SystemExit(f"Nenhuma serie valida em {diretorio}")
    return series


def carregar_metadados(caminho: Path) -> dict[str, dict]:
    bruto = ler_json(caminho, {})
    lista = bruto.get("ativos", bruto) if isinstance(bruto, dict) else bruto
    if not isinstance(lista, list):
        return {}
    saida: dict[str, dict] = {}
    for item in lista:
        ticker = str(item.get("ticker") or "").upper()
        if ticker:
            saida[ticker] = item
    return saida


def eventos_do_periodo(
    pontos: list[dict],
    periodo: str,
    personalizados: list[dict] | None,
) -> list[dict]:
    janela = PERIODOS[periodo]
    recorte = pontos[-janela:]
    datas = [p["data"] for p in recorte]
    inicio = datas[0] if datas else ""
    fim = datas[-1] if datas else ""

    if personalizados:
        filtrados = [
            evento
            for evento in personalizados
            if inicio <= str(evento.get("data", ""))[:10] <= fim
        ]
        if filtrados:
            return [
                {
                    "data": str(evento.get("data"))[:10],
                    "titulo": evento.get("titulo") or evento.get("title") or "",
                    "fonte": evento.get("fonte") or evento.get("source") or "",
                    "impacto": (evento.get("impacto") or "neutro").lower(),
                    "url": evento.get("url"),
                    "demo": bool(evento.get("demo", False)),
                }
                for evento in filtrados
            ]

    quantidade = min(len(EVENTOS_DEMO), max(3, len(datas) // 30))
    if quantidade <= 0 or not datas:
        return []
    passo = max(1, len(datas) // (quantidade + 1))
    saida = []
    for i in range(quantidade):
        indice = min(len(datas) - 1, passo * (i + 1))
        titulo, fonte, impacto = EVENTOS_DEMO[i % len(EVENTOS_DEMO)]
        saida.append(
            {
                "data": datas[indice],
                "titulo": titulo,
                "fonte": fonte,
                "impacto": impacto,
                "url": None,
                "demo": True,
            }
        )
    return saida


def serie_ibov(series: dict[str, list[dict]]) -> list[dict]:
    """Indice igualmente ponderado, para que a amplitude conte a mesma historia."""
    mapas = {
        ticker: {p["data"]: p["fechamento"] for p in pontos}
        for ticker, pontos in series.items()
    }
    datas = sorted(set.intersection(*(set(mapa) for mapa in mapas.values()))) if mapas else []
    saida: list[dict] = []
    nivel = 100000.0
    anterior: dict[str, float] = {}
    for data in datas:
        if anterior:
            retornos = [
                mapas[ticker][data] / anterior[ticker] - 1.0
                for ticker in mapas
                if anterior.get(ticker)
            ]
            if retornos:
                nivel *= 1.0 + sum(retornos) / len(retornos)
        saida.append({"data": data, "fechamento": round(nivel, 2)})
        anterior = {ticker: mapas[ticker][data] for ticker in mapas}
    return saida


def variacoes_por_periodo(valores: list[float]) -> dict[str, float]:
    saida = {}
    for periodo, janela in PERIODOS.items():
        if len(valores) < 2:
            saida[periodo] = 0.0
            continue
        base = valores[-min(janela, len(valores))]
        saida[periodo] = round((valores[-1] / base - 1.0) * 100.0, 2) if base else 0.0
    return saida


def montar_mercado(
    series: dict[str, list[dict]],
    panorama: dict,
    mercado_antigo: dict,
    atualizado_em: str,
    fonte: str,
) -> dict:
    ibov = serie_ibov(series)
    valores = [p["fechamento"] for p in ibov]
    indice_ibov = {
        "codigo": "IBOV",
        "nome": "Ibovespa",
        "tipo": "indice",
        "valor": valores[-1] if valores else 0.0,
        "variacaoDia": round((valores[-1] / valores[-2] - 1.0) * 100.0, 2)
        if len(valores) >= 2
        else 0.0,
        "variacaoPeriodo": variacoes_por_periodo(valores),
        "sparkline": valores[-30:],
    }

    antigos = {
        str(item.get("codigo")): item
        for item in (mercado_antigo.get("indices") or [])
        if item.get("codigo") not in (None, "IBOV")
    }
    indices = [indice_ibov]
    for padrao in INDICES_PADRAO:
        indices.append(antigos.get(padrao["codigo"], padrao))

    return {
        "fonte": fonte,
        "atualizadoEm": atualizado_em,
        "indices": indices,
        "breadth": panorama["periodos"]["6m"]["distribuicao"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Recalcula o panorama do OpenFinancial.")
    parser.add_argument("--series-dir", type=Path, default=RAIZ / "assets" / "data" / "series")
    parser.add_argument("--ativos", type=Path, default=RAIZ / "assets" / "data" / "ativos.json")
    parser.add_argument("--mercado", type=Path, default=RAIZ / "assets" / "data" / "mercado.json")
    parser.add_argument("--eventos", type=Path, default=None, help="JSON com lista de eventos.")
    parser.add_argument("--out", type=Path, default=RAIZ / "assets" / "data")
    parser.add_argument("--fonte", default="demo", help="Valor do campo fonte (ex.: demo, b3, cdn).")
    parser.add_argument("--modelo", default=os.environ.get("OPENFIN_MODEL", "opencode/big-pickle"))
    parser.add_argument(
        "--agora",
        default=None,
        help="Timestamp ISO para reproducao (padrao: agora em UTC).",
    )
    args = parser.parse_args()

    series = carregar_series(args.series_dir)
    metadados = carregar_metadados(args.ativos)
    eventos_personalizados = None
    if args.eventos:
        bruto = ler_json(args.eventos, [])
        eventos_personalizados = bruto.get("eventos", bruto) if isinstance(bruto, dict) else bruto

    atualizado_em = args.agora or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    fontes = FONTES_PADRAO if args.fonte == "demo" else ["B3 — séries históricas", "CVM — informações periódicas"]

    ativos_saida: list[dict] = []
    for ticker, pontos in series.items():
        meta = metadados.get(ticker, {})
        nome = meta.get("nome") or ticker
        setor = meta.get("setor") or "Não informado"
        segmento = meta.get("segmento") or ""
        valores = [p["fechamento"] for p in pontos]
        ativos_saida.append(
            {
                "ticker": ticker,
                "nome": nome,
                "setor": setor,
                "segmento": segmento,
                "preco": valores[-1],
                "variacaoDia": round((valores[-1] / valores[-2] - 1.0) * 100.0, 2)
                if len(valores) >= 2
                else 0.0,
                "variacaoPeriodo": variacoes_por_periodo(valores),
                "volume": pontos[-1]["volume"],
                "sparkline": valores[-30:],
                "atualizadoEm": atualizado_em,
            }
        )
    ativos_saida.sort(key=lambda item: item["ticker"])

    panorama: dict[str, Any] = {
        "fonte": args.fonte,
        "geradoEm": atualizado_em,
        "modelo": args.modelo,
        "disclaimer": DISCLAIMER,
        "periodos": {},
    }

    ibov = serie_ibov(series)
    ibov_valores = [p["fechamento"] for p in ibov]

    for periodo in PERIODOS:
        analises = [
            analisar(
                ticker,
                metadados.get(ticker, {}).get("nome") or ticker,
                metadados.get(ticker, {}).get("setor") or "Não informado",
                metadados.get(ticker, {}).get("segmento") or "",
                pontos,
                periodo,
                fonte=args.fonte,
                atualizado_em=atualizado_em,
                fontes=fontes,
            )
            for ticker, pontos in series.items()
        ]
        analises.sort(key=lambda item: item["ticker"])

        distribuicao = {"alta": 0, "lateral": 0, "baixa": 0}
        for analise in analises:
            distribuicao[analise["tendencia"]] += 1

        if ibov_valores:
            base = ibov_valores[-min(PERIODOS[periodo], len(ibov_valores))]
            variacao_ibov = (ibov_valores[-1] / base - 1.0) * 100.0 if base else 0.0
        else:
            variacao_ibov = 0.0

        panorama["periodos"][periodo] = {
            "periodo": periodo,
            "periodoLabel": PERIODO_LABEL[periodo],
            "atualizadoEm": atualizado_em,
            "resumo": resumo_panorama(periodo, distribuicao, variacao_ibov),
            "distribuicao": distribuicao,
            "serieProbabilidades": serie_probabilidades(
                series[next(iter(series))], periodo
            ),
            "eventos": eventos_do_periodo(
                series[next(iter(series))], periodo, eventos_personalizados
            ),
            "ativos": analises,
        }

    mercado = montar_mercado(
        series,
        panorama,
        ler_json(args.mercado, {}),
        atualizado_em,
        args.fonte,
    )

    escrever_json(
        args.out / "ativos.json",
        {
            "fonte": args.fonte,
            "moeda": MOEDA,
            "atualizadoEm": atualizado_em,
            "ativos": ativos_saida,
        },
    )
    escrever_json(args.out / "mercado.json", mercado)
    escrever_json(args.out / "panorama.json", panorama)

    resumo = ", ".join(
        f"{periodo}: {panorama['periodos'][periodo]['distribuicao']}"
        for periodo in PERIODOS
    )
    print(f"OK: {len(series)} ativos, {len(PERIODOS)} periodos, saida em {args.out}")
    print(f"Distribuicao -> {resumo}")


if __name__ == "__main__":
    main()
