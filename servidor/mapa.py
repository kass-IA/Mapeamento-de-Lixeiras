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
    2: {"x": 59, "y": 321},
    3: {"x": 407, "y": 321},
    4: {"x": 750, "y": 321},
    5: {"x": 59, "y": 489}
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


# Campos exclusivos das lixeiras com sensor ESP32.
CAMPOS_SENSOR = (
    "sensor",
    "ultima_leitura",
    "pico",
    "baixas_seguidas",
    "coletas_sensor"
)

# Regras para confirmar o esvaziamento:
# A lixeira precisa ter atingido pelo menos 50%.
# Depois, precisa receber duas leituras consecutivas abaixo de 15%.
ESVAZIAR_DE = 50
ESVAZIAR_ATE = 15
LEITURAS_CONFIRMACAO = 2

# Sem leitura há mais que isso (segundos) = sensor offline.
SENSOR_OFFLINE_APOS = 30


def nova_lixeira(ponto, anterior=None):
    """Cria ou atualiza a lixeira de um ponto."""
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
        "historico": anterior.get("historico", [nivel])[-12:],

        **{
            chave: anterior[chave]
            for chave in CAMPOS_SENSOR
            if chave in anterior
        }
    }


def definir_pontos(dados, pontos):
    """Deixa uma lixeira em cada ponto escolhido."""
    pontos = sorted({p for p in pontos if p in PONTOS})

    existentes = {
        l.get("ponto"): l
        for l in dados.get("lixeiras", [])
        if l.get("ponto") in PONTOS
    }

    dados["pontos_selecionados"] = pontos
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

        # Compatibilidade com arquivos antigos.
        if pontos is None:
            antigo = dados.get("ponto_selecionado")
            pontos = [antigo] if antigo in PONTOS else []

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


def registrar_leitura_sensor(lixeira, nivel, agora):
    """
    Registra uma leitura do ESP32.

    Confirma o esvaziamento somente depois de duas leituras
    consecutivas estritamente abaixo de 15%.
    """
    nivel = max(0, min(100, int(nivel)))

    lixeira["sensor"] = True
    lixeira["ultima_leitura"] = agora
    lixeira["pico"] = max(
        int(lixeira.get("pico", 0)),
        nivel
    )

    esvaziou = False

    if (
        lixeira["pico"] >= ESVAZIAR_DE
        and nivel < ESVAZIAR_ATE
    ):
        lixeira["baixas_seguidas"] = (
            int(lixeira.get("baixas_seguidas", 0)) + 1
        )

        if lixeira["baixas_seguidas"] >= LEITURAS_CONFIRMACAO:
            esvaziou = True

            lixeira["coletas_sensor"] = (
                int(lixeira.get("coletas_sensor", 0)) + 1
            )

            lixeira["pico"] = nivel
            lixeira["baixas_seguidas"] = 0

    else:
        lixeira["baixas_seguidas"] = 0

    registrar_nivel(lixeira, nivel)

    return esvaziou


def sensor_ativo():
    """Chave Sensor ESP32 do site."""
    return bool(estado.get("sensor_ativo", False))


def sensor_online(lixeira, agora):
    """Verifica se a lixeira está recebendo leituras."""
    ultima = lixeira.get("ultima_leitura")

    return (
        sensor_ativo()
        and bool(ultima)
        and (agora - float(ultima)) <= SENSOR_OFFLINE_APOS
    )


def registrar_contato_esp32(id_, nivel, distancia, agora):
    """Guarda o último contato do ESP32."""
    estado["esp32"] = {
        "ultimo_contato": agora,
        "ponto": id_,
        "nivel": nivel,
        "distancia_cm": distancia
    }


def resumo_esp32(agora):
    """Situação do ESP32 para mostrar no site."""
    contato = estado.get("esp32") or {}

    ultimo = contato.get("ultimo_contato")
    segundos = None if not ultimo else int(
        agora - float(ultimo)
    )

    return {
        "ativo": sensor_ativo(),
        "online": (
            segundos is not None
            and segundos <= SENSOR_OFFLINE_APOS
        ),
        "segundos": segundos,
        "ponto": contato.get("ponto"),
        "nivel": contato.get("nivel"),
        "distancia_cm": contato.get("distancia_cm")
    }