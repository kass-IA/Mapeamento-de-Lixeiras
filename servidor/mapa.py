

import json
import os
import threading

RAIZ = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)

ARQUIVO = os.path.join(
    RAIZ,
    "Banco_Dados",
    "SQL",
    "lixeiras.json"
)

lock = threading.Lock()


# Coordenadas dos cinco pontos no mapa 810x810.
PONTOS = {
    1: {"x": 740, "y": 142},
    2: {"x": 59,  "y": 321},
    3: {"x": 407, "y": 321},
    4: {"x": 750, "y": 321},
    5: {"x": 59,  "y": 489}
}


PADRAO = {
    "sala": {
        "largura": 810,
        "altura": 810
    },

    "base": {
        "x": 110,
        "y": 77
    },

    # Pontos do mapa que têm lixeira (pode ser mais de um).
    "pontos_selecionados": [],
    "lixeiras": []
}


def salvar(dados):
    os.makedirs(
        os.path.dirname(ARQUIVO),
        exist_ok=True
    )

    with open(ARQUIVO, "w", encoding="utf-8") as arquivo:
        json.dump(
            dados,
            arquivo,
            ensure_ascii=False,
            indent=2
        )


def nova_lixeira(ponto, anterior=None):
    """Cria (ou atualiza) a lixeira de um ponto.

    Cada ponto tem a sua lixeira, com id igual ao número do ponto.
    Se já existia uma lixeira nesse ponto, mantém o nível e o histórico.
    """
    anterior = anterior or {}
    nivel = max(0, min(100, int(anterior.get("nivel", 0))))

    return {
        "id": ponto,
        "nome": f"Lixeira Ponto {ponto}",
        "local": f"Ponto {ponto}",
        "x": PONTOS[ponto]["x"],
        "y": PONTOS[ponto]["y"],
        "ponto": ponto,
        "nivel": nivel,
        "historico": anterior.get("historico", [nivel])[-12:]
    }


def definir_pontos(dados, pontos):
    """Deixa uma lixeira em cada ponto escolhido (em ordem crescente)."""
    pontos = sorted({p for p in pontos if p in PONTOS})

    existentes = {
        l.get("ponto"): l
        for l in dados.get("lixeiras", [])
        if l.get("ponto") in PONTOS
    }

    dados["pontos_selecionados"] = pontos
    # Mantido para compatibilidade com versões antigas.
    dados["ponto_selecionado"] = pontos[0] if pontos else None
    dados["lixeiras"] = [
        nova_lixeira(p, existentes.get(p))
        for p in pontos
    ]


def carregar():
    if os.path.exists(ARQUIVO):
        with open(ARQUIVO, "r", encoding="utf-8") as arquivo:
            dados = json.load(arquivo)

        pontos = dados.get("pontos_selecionados")

        # Arquivo antigo: só tinha um ponto selecionado.
        if pontos is None:
            antigo = dados.get("ponto_selecionado")
            pontos = [antigo] if antigo in PONTOS else []

            # A lixeira antiga passa a ser a lixeira desse ponto.
            for lixeira in dados.get("lixeiras", []):
                if antigo in PONTOS:
                    lixeira["ponto"] = antigo

        dados["sala"] = {
            "largura": 810,
            "altura": 810
        }
        dados.setdefault("base", PADRAO["base"].copy())
        definir_pontos(dados, pontos)

        salvar(dados)
        return dados

    dados = json.loads(json.dumps(PADRAO))
    salvar(dados)
    return dados


estado = carregar()


def achar(id_):
    return next(
        (
            lixeira
            for lixeira in estado["lixeiras"]
            if lixeira["id"] == id_
        ),
        None
    )


def registrar_nivel(lixeira, nivel):
    nivel = max(0, min(100, int(nivel)))

    lixeira["nivel"] = nivel
    lixeira.setdefault("historico", []).append(nivel)
    lixeira["historico"] = lixeira["historico"][-12:]
