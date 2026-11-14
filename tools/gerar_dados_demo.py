#!/usr/bin/env python3
"""
Gera os dados de demonstracao do OpenFinancial.

Os numeros sao SINTETICOS: servem para validar o front-end e o contrato da API
antes de a CDN e a API reais estarem no ar. Cada arquivo carrega "fonte": "demo".

Saida (por padrao em ../assets/data):
  ativos.json
  mercado.json
  panorama.json
  series/<TICKER>.json
"""

from __future__ import annotations

import json
import math
import random
import statistics
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

SEED = 20261113
HOJE = date(2026, 11, 13)
ANOS = 5
PERIODOS = {"1m": 21, "3m": 63, "6m": 126, "1a": 252, "5a": 1260}
PERIODO_LABEL = {
    "1m": "1 mês",
    "3m": "3 meses",
    "6m": "6 meses",
    "1a": "1 ano",
    "5a": "5 anos",
}

ATIVOS = [
    # ticker, nome, setor, segmento, preço base
    ("PETR4", "Petrobras PN", "Petróleo e Gás", "Nível 2", 38.40),
    ("VALE3", "Vale ON", "Mineração", "Nível 1", 61.20),
    ("ITUB4", "Itaú Unibanco PN", "Bancos", "Nível 1", 34.80),
    ("BBDC4", "Bradesco PN", "Bancos", "Nível 1", 15.90),
    ("BBAS3", "Banco do Brasil ON", "Bancos", "Nível 1", 27.60),
    ("ABEV3", "Ambev ON", "Bebidas", "Novo Mercado", 13.10),
    ("WEGE3", "WEG ON", "Bens Industriais", "Novo Mercado", 52.30),
    ("MGLU3", "Magazine Luiza ON", "Varejo", "Novo Mercado", 9.40),
    ("RENT3", "Localiza ON", "Aluguel de Carros", "Novo Mercado", 46.70),
    ("SUZB3", "Suzano ON", "Papel e Celulose", "Novo Mercado", 54.90),
    ("GGBR4", "Gerdau PN", "Siderurgia", "Nível 1", 19.80),
    ("ELET3", "Eletrobras ON", "Energia Elétrica", "Novo Mercado", 42.10),
    ("RAIL3", "Rumo ON", "Transporte Ferroviário", "Novo Mercado", 25.60),
    ("RADL3", "Raia Drogasil ON", "Saúde", "Novo Mercado", 22.30),
    ("CPLE6", "Copel PNB", "Energia Elétrica", "Nível 2", 11.70),
    ("B3SA3", "B3 ON", "Serviços Financeiros", "Novo Mercado", 13.90),
]

SETOR_VOL = {
    "Petróleo e Gás": 0.011,
    "Mineração": 0.013,
    "Bancos": 0.009,
    "Bebidas": 0.007,
    "Bens Industriais": 0.010,
    "Varejo": 0.016,
    "Aluguel de Carros": 0.013,
    "Papel e Celulose": 0.012,
    "Siderurgia": 0.014,
    "Energia Elétrica": 0.009,
    "Transporte Ferroviário": 0.011,
    "Saúde": 0.008,
    "Serviços Financeiros": 0.012,
}

FONTES = [
    "B3 — séries históricas (demo)",
    "BCB — Relatório de Política Monetária (exemplo)",
    "IBGE — IPCA e atividade econômica (exemplo)",
    "CVM — informações periódicas (exemplo)",
]


def dias_uteis(fim: date, quantidade: int) -> list[date]:
    dias: list[date] = []
    atual = fim
    while len(dias) < quantidade:
        if atual.weekday() < 5:
            dias.append(atual)
        atual -= timedelta(days=1)
    return list(reversed(dias))


def normais(rng: random.Random, n: int) -> list[float]:
    return [rng.gauss(0.0, 1.0) for _ in range(n)]


def gerar_series(rng: random.Random, dias: list[date]) -> dict[str, list[dict]]:
    n = len(dias)
    mercado = normais(rng, n)
    setores = {setor: normais(rng, n) for setor in SETOR_VOL}
    series: dict[str, list[dict]] = {}

    for ticker, nome, setor, segmento, base in ATIVOS:
        preco = base * rng.uniform(0.72, 1.05)
        vol_setor = SETOR_VOL[setor]
        drift_ativo = rng.uniform(-0.00038, 0.00046)
        pontos: list[dict] = []
        for i, dia in enumerate(dias):
            choque = 0.55 * mercado[i] + 0.45 * setores[setor][i]
            deriva = drift_ativo + 0.00008 * math.sin(i / 90.0)
            retorno = deriva + vol_setor * choque + 0.006 * rng.gauss(0.0, 1.0)
            preco = max(1.0, preco * math.exp(retorno))
            volume = int(abs(rng.lognormvariate(14.2, 0.45)))
            pontos.append(
                {
                    "data": dia.isoformat(),
                    "fechamento": round(preco, 2),
                    "volume": volume,
                }
            )
        series[ticker] = pontos

    return series


def numero_br(valor: float, casas: int = 1, sinal: bool = False) -> str:
    """Numero no padrao brasileiro, para os textos gerados."""
    texto = f"{abs(valor):.{casas}f}".replace(".", ",")
    if sinal:
        return ("+" if valor > 0 else "−" if valor < 0 else "") + texto
    return texto


def media(valores: list[float]) -> float:
    return sum(valores) / len(valores) if valores else 0.0


def sma(valores: list[float], janela: int) -> float:
    if not valores:
        return 0.0
    recorte = valores[-janela:]
    return media(recorte)


def ema(valores: list[float], janela: int) -> float:
    if not valores:
        return 0.0
    alpha = 2.0 / (janela + 1.0)
    saida = valores[0]
    for valor in valores[1:]:
        saida = alpha * valor + (1.0 - alpha) * saida
    return saida


def rsi(valores: list[float], janela: int = 14) -> float:
    if len(valores) < janela + 1:
        return 50.0
    ganhos = 0.0
    perdas = 0.0
    for i in range(len(valores) - janela, len(valores)):
        delta = valores[i] - valores[i - 1]
        if delta >= 0:
            ganhos += delta
        else:
            perdas -= delta
    if perdas == 0:
        return 100.0
    rs = (ganhos / janela) / (perdas / janela)
    return 100.0 - (100.0 / (1.0 + rs))


def macd(valores: list[float]) -> float:
    if len(valores) < 35:
        return 0.0
    linha = ema(valores, 12) - ema(valores, 26)
    sinal = ema([ema(valores[: i + 1], 12) - ema(valores[: i + 1], 26) for i in range(25, len(valores))], 9)
    return linha - sinal


def volatilidade(valores: list[float], janela: int = 21) -> float:
    if len(valores) < 3:
        return 0.02
    recorte = valores[-janela:]
    retornos = [
        math.log(recorte[i] / recorte[i - 1])
        for i in range(1, len(recorte))
        if recorte[i - 1] > 0
    ]
    if len(retornos) < 2:
        return 0.02
    return statistics.pstdev(retornos)


def retornos_cenarios(valores: list[float], horizonte: int) -> tuple[float, float]:
    # Simetria proposital: +/- 1 desvio-padrao do horizonte, sem depender de
    # suporte/resistencia (que zerava o cenario de baixa no minimo da janela).
    escala = volatilidade(valores) * math.sqrt(max(1, horizonte))
    escala = min(0.35, escala)
    return round(escala, 4), round(-escala, 4)


def probabilidades(score: float) -> dict[str, float]:
    # Softmax de tres classes com classe neutra explicita: evita que todo
    # ativo vire "alta" ou "baixa" quando o score se afasta pouco de zero.
    forca = math.exp(2.2 * score)
    fraca = math.exp(-2.2 * score)
    neutra = 1.4
    total = forca + fraca + neutra
    return {
        "alta": round(forca / total, 4),
        "lateral": round(neutra / total, 4),
        "baixa": round(fraca / total, 4),
    }


def score_tecnico(valores: list[float], volumes: list[int]) -> float:
    if len(valores) < 21:
        return 0.0
    vol = volatilidade(valores)
    base = valores[-min(22, len(valores))]
    momentum = valores[-1] / base - 1.0
    z = momentum / (vol * math.sqrt(min(21, len(valores))) + 1e-9)
    mm20 = sma(valores, 20)
    mm50 = sma(valores, min(50, len(valores)))
    mm200 = sma(valores, min(200, len(valores)))
    rsi14 = rsi(valores)
    macd_v = macd(valores)
    vol_medio = media([float(v) for v in volumes[-20:]]) or 1.0
    vol_z = (volumes[-1] / vol_medio - 1.0) if volumes else 0.0

    score = (
        0.36 * math.tanh(z)
        + 0.24 * math.tanh((mm20 / mm50 - 1.0) * 12.0)
        + 0.18 * math.tanh((rsi14 - 50.0) / 18.0)
        + 0.12 * math.tanh(macd_v / (valores[-1] * 0.01))
        + 0.10 * math.tanh(vol_z)
    )
    if mm200:
        score += 0.08 * math.tanh((valores[-1] / mm200 - 1.0) * 8.0)
    return max(-1.0, min(1.0, score))


def rotulo(probs: dict[str, float]) -> str:
    return max(probs, key=probs.get)


def resumo(ticker: str, nome: str, periodo: str, probs: dict[str, float], score: float,
           variacao: float, rsi14: float, mm20: float, mm50: float, confianca: float) -> str:
    tendencia = rotulo(probs)
    direcao = "acima" if mm20 >= mm50 else "abaixo"
    if tendencia == "alta":
        leitura = (
            f"Viés de alta no período de {PERIODO_LABEL[periodo]}: o preço está {direcao} da média curta, "
            f"o momentum acumulado é de {numero_br(variacao, 1, True)}% e o RSI em {rsi14:.0f}. "
            f"O cenário central projeta continuidade, com {probs['alta']*100:.0f}% de probabilidade de alta "
            f"contra {probs['baixa']*100:.0f}% de baixa."
        )
    elif tendencia == "baixa":
        leitura = (
            f"Viés de baixa no período de {PERIODO_LABEL[periodo]}: o preço está {direcao} da média curta, "
            f"o momentum acumulado é de {numero_br(variacao, 1, True)}% e o RSI em {rsi14:.0f}. "
            f"O cenário central projeta continuidade, com {probs['baixa']*100:.0f}% de probabilidade de baixa "
            f"contra {probs['alta']*100:.0f}% de alta."
        )
    else:
        leitura = (
            f"Cenário lateral no período de {PERIODO_LABEL[periodo]}: o preço está {direcao} da média curta, "
            f"o momentum acumulado é de {numero_br(variacao, 1, True)}% e o RSI em {rsi14:.0f}. "
            f"A probabilidade de alta ({probs['alta']*100:.0f}%) e de baixa ({probs['baixa']*100:.0f}%) "
            f"estão próximas, sem direção dominante."
        )
    return (
        f"{nome} ({ticker}). {leitura} "
        f"Confiança do modelo: {confianca*100:.0f}%. "
        "Leitura probabilística para fins informativos; não é recomendação de investimento."
    )


def sinais(valores: list[float], volumes: list[int]) -> list[str]:
    mm20 = sma(valores, 20)
    mm50 = sma(valores, 50)
    mm200 = sma(valores, 200)
    rsi14 = rsi(valores)
    macd_v = macd(valores)
    vol_medio = media([float(v) for v in volumes[-20:]]) or 1.0
    saida = []
    saida.append("Preço acima da MM20" if valores[-1] >= mm20 else "Preço abaixo da MM20")
    saida.append("MM20 acima da MM50" if mm20 >= mm50 else "MM20 abaixo da MM50")
    if mm200:
        saida.append("Preço acima da MM200" if valores[-1] >= mm200 else "Preço abaixo da MM200")
    if rsi14 >= 70:
        saida.append("RSI em sobrecompra")
    elif rsi14 <= 30:
        saida.append("RSI em sobrevenda")
    else:
        saida.append("RSI em zona neutra")
    saida.append("MACD positivo" if macd_v >= 0 else "MACD negativo")
    if volumes:
        variacao_volume = volumes[-1] / vol_medio - 1.0
        saida.append(f"Volume {variacao_volume*100:+.0f}% vs média de 20 sessões")
    return saida


def projecao(valores: list[float], dias_futuros: int) -> dict[str, list[float | str]]:
    ultimo = valores[-1]
    vol = volatilidade(valores)
    drift = 0.00015
    datas: list[str] = []
    atual = HOJE
    while len(datas) < dias_futuros:
        atual += timedelta(days=1)
        if atual.weekday() < 5:
            datas.append(atual.isoformat())

    p10, p25, p50, p75, p90 = [], [], [], [], []
    for i in range(1, dias_futuros + 1):
        centro = ultimo * math.exp(drift * i)
        desvio = vol * math.sqrt(i)
        p50.append(round(centro, 2))
        p10.append(round(centro * math.exp(-1.2816 * desvio), 2))
        p25.append(round(centro * math.exp(-0.6745 * desvio), 2))
        p75.append(round(centro * math.exp(0.6745 * desvio), 2))
        p90.append(round(centro * math.exp(1.2816 * desvio), 2))

    return {"datas": datas, "p10": p10, "p25": p25, "p50": p50, "p75": p75, "p90": p90}


def analisar(ticker: str, nome: str, setor: str, segmento: str, pontos: list[dict],
             periodo: str) -> dict:
    janela = PERIODOS[periodo]
    recorte = pontos[-janela:]
    valores = [p["fechamento"] for p in recorte]
    volumes = [p["volume"] for p in recorte]
    score = score_tecnico(valores, volumes)
    probs = probabilidades(score)
    tendencia = rotulo(probs)
    variacao = (valores[-1] / valores[0] - 1.0) * 100.0 if valores else 0.0
    rsi14 = rsi(valores)
    mm20 = sma(valores, 20)
    mm50 = sma(valores, 50)
    confianca = min(0.92, 0.48 + 0.34 * abs(score) + 0.10 * min(1.0, len(valores) / 252.0))
    suporte = min(valores[-60:]) if len(valores) >= 60 else min(valores)
    resistencia = max(valores[-60:]) if len(valores) >= 60 else max(valores)
    horizonte = 21 if periodo in ("1m", "3m") else 42 if periodo == "6m" else 63

    retorno_alta, retorno_baixa = retornos_cenarios(valores, horizonte)
    cenarios = [
        {"nome": "alta", "probabilidade": probs["alta"], "retorno": retorno_alta},
        {"nome": "lateral", "probabilidade": probs["lateral"], "retorno": 0.0},
        {"nome": "baixa", "probabilidade": probs["baixa"], "retorno": retorno_baixa},
    ]

    return {
        "ticker": ticker,
        "nome": nome,
        "setor": setor,
        "segmento": segmento,
        "periodo": periodo,
        "periodoLabel": PERIODO_LABEL[periodo],
        "tendencia": tendencia,
        "score": round(score * 100.0, 1),
        "confianca": round(confianca, 3),
        "probabilidades": probs,
        "cenarios": cenarios,
        "variacaoPeriodo": round(variacao, 2),
        "preco": valores[-1],
        "indicadores": {
            "mm20": round(mm20, 2),
            "mm50": round(mm50, 2),
            "mm200": round(sma(valores, 200), 2),
            "rsi14": round(rsi14, 1),
            "macd": round(macd(valores), 3),
            "volatilidade": round(volatilidade(valores) * math.sqrt(252.0) * 100.0, 1),
        },
        "suporte": round(suporte, 2),
        "resistencia": round(resistencia, 2),
        "horizonteDias": horizonte,
        "projecao": projecao(valores, horizonte),
        "resumo": resumo(ticker, nome, periodo, probs, score, variacao, rsi14, mm20, mm50, confianca),
        "sinais": sinais(valores, volumes),
        "fontes": FONTES,
        "atualizadoEm": datetime(2026, 11, 13, 18, 30, tzinfo=timezone(timedelta(hours=-3))).isoformat(),
        "demo": True,
        "disclaimer": "Conteúdo informativo e probabilístico. Não constitui recomendação de investimento.",
    }


def serie_probabilidades(pontos: list[dict], periodo: str) -> list[dict]:
    janela = PERIODOS[periodo]
    recorte = pontos[-janela:]
    passo = {"1m": 1, "3m": 1, "6m": 2, "1a": 4, "5a": 10}[periodo]
    saida: list[dict] = []
    suave = None
    inicio = min(60, max(10, len(recorte) // 4))
    for i in range(inicio, len(recorte), passo):
        trecho = recorte[: i + 1]
        valores = [p["fechamento"] for p in trecho]
        volumes = [p["volume"] for p in trecho]
        score = score_tecnico(valores, volumes)
        probs = probabilidades(score)
        if suave is None:
            suave = probs
        else:
            suave = {
                "alta": 0.72 * probs["alta"] + 0.28 * suave["alta"],
                "lateral": 0.72 * probs["lateral"] + 0.28 * suave["lateral"],
                "baixa": 0.72 * probs["baixa"] + 0.28 * suave["baixa"],
            }
            total = sum(suave.values())
            suave = {k: v / total for k, v in suave.items()}
        saida.append(
            {
                "data": trecho[-1]["data"],
                "alta": round(suave["alta"], 4),
                "lateral": round(suave["lateral"], 4),
                "baixa": round(suave["baixa"], 4),
            }
        )
    return saida


def eventos(periodo: str, dias: list[date]) -> list[dict]:
    janela = PERIODOS[periodo]
    datas = dias[-janela:]
    modelos = [
        ("Copom mantém a Selic e reforça cautela com a inflação", "BCB", "neutro"),
        ("IBGE: IPCA fica dentro do intervalo esperado pelo mercado", "IBGE", "positivo"),
        ("B3 registra volume financeiro acima da média de 20 sessões", "B3", "positivo"),
        ("Relatório oficial aponta desaceleração moderada da atividade", "BCB", "negativo"),
        ("CVM divulga calendário de divulgações trimestrais", "CVM", "neutro"),
        ("Balanço comercial sustenta expectativa para o câmbio", "BCB", "positivo"),
        ("Agências internacionais revisam projeção de crescimento do Brasil", "FMI", "neutro"),
    ]
    quantidade = min(len(modelos), max(3, len(datas) // 30))
    passo = max(1, len(datas) // (quantidade + 1))
    saida = []
    for i in range(quantidade):
        idx = min(len(datas) - 1, passo * (i + 1))
        titulo, fonte, impacto = modelos[i % len(modelos)]
        saida.append(
            {
                "data": datas[idx].isoformat(),
                "titulo": titulo,
                "fonte": fonte,
                "impacto": impacto,
                "url": None,
                "demo": True,
            }
        )
    return saida


def resumo_panorama(periodo: str, distribuicao: dict[str, int], variacao: float) -> str:
    total = sum(distribuicao.values()) or 1
    dominante = max(distribuicao, key=distribuicao.get)
    nomes = {"alta": "de alta", "lateral": "lateral", "baixa": "de baixa"}
    return (
        f"No período de {PERIODO_LABEL[periodo]}, o Ibovespa acumula {numero_br(variacao, 1, True)}%. "
        f"Entre os ativos acompanhados, {distribuicao['alta']} de {total} ({distribuicao['alta']/total*100:.0f}%) "
        f"estão em viés de alta, {distribuicao['lateral']} em lateralidade e {distribuicao['baixa']} em baixa. "
        f"O viés dominante é {nomes[dominante]}. "
        "Leitura probabilística; não é recomendação de investimento."
    )


def main() -> None:
    raiz = Path(__file__).resolve().parent.parent
    destino = raiz / "assets" / "data"
    (destino / "series").mkdir(parents=True, exist_ok=True)

    rng = random.Random(SEED)
    dias = dias_uteis(HOJE, ANOS * 252)
    series = gerar_series(rng, dias)

    atualizado = datetime(2026, 11, 13, 18, 30, tzinfo=timezone(timedelta(hours=-3))).isoformat()

    ativos = []
    for ticker, nome, setor, segmento, _base in ATIVOS:
        pontos = series[ticker]
        valores = [p["fechamento"] for p in pontos]
        variacoes = {}
        for periodo, janela in PERIODOS.items():
            recorte = valores[-janela:]
            variacoes[periodo] = round((recorte[-1] / recorte[0] - 1.0) * 100.0, 2)
        ativos.append(
            {
                "ticker": ticker,
                "nome": nome,
                "setor": setor,
                "segmento": segmento,
                "preco": valores[-1],
                "variacaoDia": round((valores[-1] / valores[-2] - 1.0) * 100.0, 2),
                "variacaoPeriodo": variacoes,
                "volume": pontos[-1]["volume"],
                "sparkline": [round(v, 2) for v in valores[-30:]],
                "atualizadoEm": atualizado,
            }
        )

    ativos.sort(key=lambda a: a["ticker"])
    with (destino / "ativos.json").open("w", encoding="utf-8") as fh:
        json.dump(
            {"fonte": "demo", "moeda": "BRL", "atualizadoEm": atualizado, "ativos": ativos},
            fh,
            ensure_ascii=False,
            separators=(",", ":"),
        )

    for ticker, _nome, _setor, _segmento, _base in ATIVOS:
        with (destino / "series" / f"{ticker}.json").open("w", encoding="utf-8") as fh:
            json.dump(
                {"ticker": ticker, "fonte": "demo", "serie": series[ticker]},
                fh,
                ensure_ascii=False,
                separators=(",", ":"),
            )

    # Ibovespa sintetico: carteira igualmente ponderada dos ativos demo.
    # Assim o indice e a amplitude do mercado contam a mesma historia.
    ibov = []
    nivel = 100000.0
    for i, dia in enumerate(dias):
        if i > 0:
            retornos = [
                series[t][i]["fechamento"] / series[t][i - 1]["fechamento"] - 1.0
                for t, _n, _s, _sg, _b in ATIVOS
            ]
            nivel *= 1.0 + sum(retornos) / len(retornos)
        ibov.append({"data": dia.isoformat(), "fechamento": round(nivel, 2)})
    ibov_valores = [p["fechamento"] for p in ibov]
    mercado = {
        "fonte": "demo",
        "atualizadoEm": atualizado,
        "indices": [
            {
                "codigo": "IBOV",
                "nome": "Ibovespa",
                "tipo": "indice",
                "valor": ibov_valores[-1],
                "variacaoDia": round((ibov_valores[-1] / ibov_valores[-2] - 1.0) * 100.0, 2),
                "variacaoPeriodo": {
                    p: round((ibov_valores[-1] / ibov_valores[-j] - 1.0) * 100.0, 2)
                    for p, j in PERIODOS.items()
                },
                "sparkline": ibov_valores[-30:],
            },
            {
                "codigo": "USD/BRL",
                "nome": "Dólar comercial",
                "tipo": "moeda",
                "valor": 5.42,
                "variacaoDia": -0.18,
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
        ],
        "breadth": {"alta": 0, "lateral": 0, "baixa": 0},
    }

    panorama = {
        "fonte": "demo",
        "geradoEm": atualizado,
        "modelo": "opencode/big-pickle",
        "disclaimer": "Conteúdo informativo e probabilístico. Não constitui recomendação de investimento.",
        "periodos": {},
    }

    for periodo, janela in PERIODOS.items():
        analises = [
            analisar(ticker, nome, setor, segmento, series[ticker], periodo)
            for ticker, nome, setor, segmento, _base in ATIVOS
        ]
        analises.sort(key=lambda a: a["ticker"])
        distribuicao = {"alta": 0, "lateral": 0, "baixa": 0}
        for analise in analises:
            distribuicao[analise["tendencia"]] += 1
        variacao_ibov = (ibov_valores[-1] / ibov_valores[-janela] - 1.0) * 100.0

        panorama["periodos"][periodo] = {
            "periodo": periodo,
            "periodoLabel": PERIODO_LABEL[periodo],
            "atualizadoEm": atualizado,
            "resumo": resumo_panorama(periodo, distribuicao, variacao_ibov),
            "distribuicao": distribuicao,
            "serieProbabilidades": serie_probabilidades(series["PETR4"], periodo),
            "eventos": eventos(periodo, dias),
            "ativos": analises,
        }

    mercado["breadth"] = panorama["periodos"]["6m"]["distribuicao"]

    with (destino / "mercado.json").open("w", encoding="utf-8") as fh:
        json.dump(mercado, fh, ensure_ascii=False, separators=(",", ":"))

    with (destino / "panorama.json").open("w", encoding="utf-8") as fh:
        json.dump(panorama, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"OK: dados demo gerados em {destino}")
    print(f"Ativos: {len(ativos)} | Periodos: {', '.join(PERIODOS)}")


if __name__ == "__main__":
    main()
