"""Motor de probabilidades do OpenFinancial.

Implementacao de referencia, sem dependencias externas. O mesmo contrato e usado
pelo gerador de dados demo (`tools/gerar_dados_demo.py`) e pela API.

Ideia central: um score tecnico entre -1 e +1 vira uma distribuicao de tres
classes com ancora neutra explicita. A classe lateral nao e residuo: ela tem
peso proprio, o que evita o vies de forcar alta ou baixa quando o sinal e fraco.
"""

from __future__ import annotations

import math
import statistics
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Sequence

PERIODOS: dict[str, int] = {"1m": 21, "3m": 63, "6m": 126, "1a": 252, "5a": 1260}
PERIODO_LABEL: dict[str, str] = {
    "1m": "1 mês",
    "3m": "3 meses",
    "6m": "6 meses",
    "1a": "1 ano",
    "5a": "5 anos",
}
HORIZONTE: dict[str, int] = {"1m": 21, "3m": 21, "6m": 42, "1a": 63, "5a": 63}
PASSO_SERIE: dict[str, int] = {"1m": 1, "3m": 1, "6m": 2, "1a": 4, "5a": 10}

FONTES_PADRAO = [
    "B3 — séries históricas",
    "BCB — Relatório de Política Monetária",
    "IBGE — IPCA e atividade econômica",
    "CVM — informações periódicas",
]

DISCLAIMER = (
    "Conteúdo informativo e probabilístico. Não constitui recomendação de "
    "investimento."
)


def numero_br(valor: float, casas: int = 1, sinal: bool = False) -> str:
    """Numero no padrao brasileiro, para os textos gerados."""
    texto = f"{abs(valor):.{casas}f}".replace(".", ",")
    if sinal:
        return ("+" if valor > 0 else "−" if valor < 0 else "") + texto
    return texto


def media(valores: Sequence[float]) -> float:
    return sum(valores) / len(valores) if valores else 0.0


def sma(valores: Sequence[float], janela: int) -> float:
    if not valores:
        return 0.0
    recorte = valores[-min(janela, len(valores)) :]
    return media(recorte)


def ema(valores: Sequence[float], janela: int) -> float:
    if not valores:
        return 0.0
    alpha = 2.0 / (janela + 1.0)
    saida = valores[0]
    for valor in valores[1:]:
        saida = alpha * valor + (1.0 - alpha) * saida
    return saida


def rsi(valores: Sequence[float], janela: int = 14) -> float:
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


def macd(valores: Sequence[float]) -> float:
    if len(valores) < 35:
        return 0.0
    linha = ema(valores, 12) - ema(valores, 26)
    serie_sinal = [
        ema(valores[: i + 1], 12) - ema(valores[: i + 1], 26)
        for i in range(25, len(valores))
    ]
    sinal = ema(serie_sinal, 9)
    return linha - sinal


def volatilidade(valores: Sequence[float], janela: int = 21) -> float:
    if len(valores) < 3:
        return 0.02
    recorte = valores[-min(janela, len(valores)) :]
    retornos = [
        math.log(recorte[i] / recorte[i - 1])
        for i in range(1, len(recorte))
        if recorte[i - 1] > 0 and recorte[i] > 0
    ]
    if len(retornos) < 2:
        return 0.02
    return statistics.pstdev(retornos)


def retornos_cenarios(valores: Sequence[float], horizonte: int) -> tuple[float, float]:
    """Retornos simetricos de +/- 1 desvio-padrao para o horizonte.

    A escala vem da volatilidade diaria recente e da raiz do horizonte. Nao usa
    suporte/resistencia: assim o cenario de baixa nao zera quando o preco esta
    no minimo da janela, e alta/baixa permanecem simetricos.
    """
    escala = volatilidade(valores) * math.sqrt(max(1, horizonte))
    escala = min(0.35, escala)
    return round(escala, 4), round(-escala, 4)


def probabilidades(score: float) -> dict[str, float]:
    """Softmax de tres classes com ancora neutra.

    Com score 0: alta = baixa ~= 29,4% e lateral ~= 41,2%.
    A simetria entre alta e baixa e proposital: o modelo nao pende para o
    pessimismo nem para o otimismo.
    """
    forca = math.exp(2.2 * score)
    fraca = math.exp(-2.2 * score)
    neutra = 1.4
    total = forca + fraca + neutra
    return {
        "alta": round(forca / total, 4),
        "lateral": round(neutra / total, 4),
        "baixa": round(fraca / total, 4),
    }


def score_tecnico(valores: Sequence[float], volumes: Sequence[int]) -> float:
    if len(valores) < 21:
        return 0.0

    vol = volatilidade(valores)
    base = valores[-min(22, len(valores))]
    momentum = valores[-1] / base - 1.0 if base else 0.0
    z = momentum / (vol * math.sqrt(min(21, len(valores))) + 1e-9)
    mm20 = sma(valores, 20)
    mm50 = sma(valores, 50)
    mm200 = sma(valores, 200)
    rsi14 = rsi(valores)
    macd_v = macd(valores)
    vol_medio = media([float(v) for v in volumes[-20:]]) or 1.0
    vol_z = (volumes[-1] / vol_medio - 1.0) if volumes else 0.0

    score = (
        0.36 * math.tanh(z)
        + 0.24 * math.tanh((mm20 / mm50 - 1.0) * 12.0 if mm50 else 0.0)
        + 0.18 * math.tanh((rsi14 - 50.0) / 18.0)
        + 0.12 * math.tanh(macd_v / (valores[-1] * 0.01) if valores[-1] else 0.0)
        + 0.10 * math.tanh(vol_z)
    )
    if mm200:
        score += 0.08 * math.tanh((valores[-1] / mm200 - 1.0) * 8.0)
    return max(-1.0, min(1.0, score))


def confianca(score: float, amostra: int) -> float:
    return min(0.92, 0.48 + 0.34 * abs(score) + 0.10 * min(1.0, amostra / 252.0))


def rotulo(probs: dict[str, float]) -> str:
    return max(probs, key=probs.get)


def sinais(valores: Sequence[float], volumes: Sequence[int]) -> list[str]:
    mm20 = sma(valores, 20)
    mm50 = sma(valores, 50)
    mm200 = sma(valores, 200)
    rsi14 = rsi(valores)
    macd_v = macd(valores)
    vol_medio = media([float(v) for v in volumes[-20:]]) or 1.0
    saida = [
        "Preço acima da MM20" if valores[-1] >= mm20 else "Preço abaixo da MM20",
        "MM20 acima da MM50" if mm20 >= mm50 else "MM20 abaixo da MM50",
    ]
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


def projecao(valores: Sequence[float], dias_futuros: int, base: date) -> dict[str, list]:
    """Banda probabilistica a frente, calibrada pela volatilidade recente."""
    ultimo = valores[-1]
    vol = volatilidade(valores)
    drift = 0.00015
    datas: list[str] = []
    atual = base
    while len(datas) < dias_futuros:
        atual += timedelta(days=1)
        if atual.weekday() < 5:
            datas.append(atual.isoformat())

    p10: list[float] = []
    p25: list[float] = []
    p50: list[float] = []
    p75: list[float] = []
    p90: list[float] = []
    for i in range(1, dias_futuros + 1):
        centro = ultimo * math.exp(drift * i)
        desvio = vol * math.sqrt(i)
        p50.append(round(centro, 2))
        p10.append(round(centro * math.exp(-1.2816 * desvio), 2))
        p25.append(round(centro * math.exp(-0.6745 * desvio), 2))
        p75.append(round(centro * math.exp(0.6745 * desvio), 2))
        p90.append(round(centro * math.exp(1.2816 * desvio), 2))

    return {"datas": datas, "p10": p10, "p25": p25, "p50": p50, "p75": p75, "p90": p90}


def resumo(
    ticker: str,
    nome: str,
    periodo: str,
    probs: dict[str, float],
    variacao: float,
    rsi14: float,
    mm20: float,
    mm50: float,
    conf: float,
) -> str:
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
        f"{nome} ({ticker}). {leitura} Confiança do modelo: {conf*100:.0f}%. "
        f"{DISCLAIMER}"
    )


def analisar(
    ticker: str,
    nome: str,
    setor: str,
    segmento: str,
    pontos: Sequence[dict],
    periodo: str,
    *,
    fonte: str = "demo",
    atualizado_em: str | None = None,
    fontes: Iterable[str] | None = None,
) -> dict:
    if periodo not in PERIODOS:
        raise ValueError(f"Periodo invalido: {periodo}")
    janela = PERIODOS[periodo]
    recorte = list(pontos[-janela:])
    if not recorte:
        raise ValueError(f"Sem pontos para {ticker} em {periodo}")

    valores = [float(p["fechamento"]) for p in recorte]
    volumes = [int(p.get("volume") or 0) for p in recorte]
    score = score_tecnico(valores, volumes)
    probs = probabilidades(score)
    tendencia = rotulo(probs)
    variacao = (valores[-1] / valores[0] - 1.0) * 100.0 if valores[0] else 0.0
    rsi14 = rsi(valores)
    mm20 = sma(valores, 20)
    mm50 = sma(valores, 50)
    conf = confianca(score, len(valores))
    suporte = min(valores[-60:]) if len(valores) >= 60 else min(valores)
    resistencia = max(valores[-60:]) if len(valores) >= 60 else max(valores)
    horizonte = HORIZONTE[periodo]

    retorno_alta, retorno_baixa = retornos_cenarios(valores, horizonte)
    cenarios = [
        {
            "nome": "alta",
            "probabilidade": probs["alta"],
            "retorno": retorno_alta,
        },
        {"nome": "lateral", "probabilidade": probs["lateral"], "retorno": 0.0},
        {
            "nome": "baixa",
            "probabilidade": probs["baixa"],
            "retorno": retorno_baixa,
        },
    ]

    ultima_data = date.fromisoformat(str(recorte[-1]["data"])[:10])
    timestamp = atualizado_em or datetime.now(timezone.utc).isoformat()

    return {
        "ticker": ticker,
        "nome": nome,
        "setor": setor,
        "segmento": segmento,
        "periodo": periodo,
        "periodoLabel": PERIODO_LABEL[periodo],
        "tendencia": tendencia,
        "score": round(score * 100.0, 1),
        "confianca": round(conf, 3),
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
        "projecao": projecao(valores, horizonte, ultima_data),
        "resumo": resumo(ticker, nome, periodo, probs, variacao, rsi14, mm20, mm50, conf),
        "sinais": sinais(valores, volumes),
        "fontes": list(fontes or FONTES_PADRAO),
        "atualizadoEm": timestamp,
        "demo": fonte == "demo",
        "disclaimer": DISCLAIMER,
    }


def serie_probabilidades(pontos: Sequence[dict], periodo: str) -> list[dict]:
    if periodo not in PERIODOS:
        raise ValueError(f"Periodo invalido: {periodo}")
    recorte = list(pontos[-PERIODOS[periodo] :])
    passo = PASSO_SERIE[periodo]
    inicio = min(60, max(10, len(recorte) // 4))
    saida: list[dict] = []
    suave: dict[str, float] | None = None

    for i in range(inicio, len(recorte), passo):
        trecho = recorte[: i + 1]
        valores = [float(p["fechamento"]) for p in trecho]
        volumes = [int(p.get("volume") or 0) for p in trecho]
        probs = probabilidades(score_tecnico(valores, volumes))
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


def resumo_panorama(periodo: str, distribuicao: dict[str, int], variacao: float) -> str:
    total = sum(distribuicao.values()) or 1
    dominante = max(distribuicao, key=distribuicao.get)
    rotulo_dominante = {"alta": "de alta", "lateral": "lateral", "baixa": "de baixa"}[dominante]
    return (
        f"No período de {PERIODO_LABEL[periodo]}, o índice de referência acumula {numero_br(variacao, 1, True)}%. "
        f"Entre os ativos acompanhados, {distribuicao['alta']} de {total} "
        f"({distribuicao['alta']/total*100:.0f}%) estão em viés de alta, "
        f"{distribuicao['lateral']} em lateralidade e {distribuicao['baixa']} em baixa. "
        f"O viés dominante é {rotulo_dominante}. {DISCLAIMER}"
    )
