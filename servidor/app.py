import os
import random
import threading
import time
import math
import requests

from flask import Flask, jsonify, request, send_from_directory, abort

import mapa


RAIZ = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)

SRC = os.path.join(RAIZ, "SRC")

app = Flask(__name__)


# ==========================================================
# CONFIGURAÇÕES GERAIS
# ==========================================================

SIMULAR_SENSOR = False


# ==========================================================
# SUPABASE
# ==========================================================

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

SUPABASE_TABELA = "leituras_lixeiras"
SUPABASE_LIXEIRA_ID = "LIX001"

PONTO_SUPABASE = 1
ALTURA_LIXEIRA_CM = 16.5

ULTIMO_ID_SUPABASE = None


def buscar_ultima_leitura_supabase():

    if not SUPABASE_URL or not SUPABASE_KEY:
        return None

    url = (
        f"{SUPABASE_URL}/rest/v1/"
        f"{SUPABASE_TABELA}"
    )

    cabecalhos = {
        "apikey": SUPABASE_KEY
    }

    parametros = {
        "select": "id,lixeira_id,distancia_cm,status,created_at",
        "lixeira_id": f"eq.{SUPABASE_LIXEIRA_ID}",
        "order": "id.desc",
        "limit": "1"
    }

    try:
        resposta = requests.get(
            url,
            headers=cabecalhos,
            params=parametros,
            timeout=5
        )

        resposta.raise_for_status()

        dados = resposta.json()

        if not dados:
            return None

        return dados[0]

    except requests.RequestException as erro:
        print("Erro ao consultar Supabase:", erro)
        return None

    except (ValueError, TypeError) as erro:
        print("Erro ao interpretar resposta do Supabase:", erro)
        return None


def calcular_nivel(distancia):

    nivel = (
        (ALTURA_LIXEIRA_CM - distancia)
        / ALTURA_LIXEIRA_CM
    ) * 100

    return max(0, min(100, round(nivel)))


def atualizar_com_leitura_supabase(leitura):

    global ULTIMO_ID_SUPABASE

    if not leitura:
        return

    try:
        id_leitura = leitura["id"]
        distancia = float(leitura["distancia_cm"])

        if distancia < 0:
            return

        if distancia > ALTURA_LIXEIRA_CM:
            distancia = ALTURA_LIXEIRA_CM

    except (KeyError, TypeError, ValueError):
        print("Leitura inválida recebida do Supabase.")
        return

    if id_leitura == ULTIMO_ID_SUPABASE:
        return

    nivel = calcular_nivel(distancia)
    agora = time.time()

    with mapa.lock:

        if not mapa.sensor_ativo():
            return

        lixeira = mapa.achar(PONTO_SUPABASE)

        if not lixeira:

            pontos = mapa.estado.get(
                "pontos_selecionados", []
            )

            if PONTO_SUPABASE not in pontos:
                pontos.append(PONTO_SUPABASE)

            mapa.definir_pontos(
                mapa.estado,
                pontos
            )

            lixeira = mapa.achar(PONTO_SUPABASE)

        if not lixeira:
            print("Não foi possível localizar a lixeira no mapa.")
            return

        mapa.registrar_contato_esp32(
            PONTO_SUPABASE,
            nivel,
            distancia,
            agora
        )

        esvaziou = mapa.registrar_leitura_sensor(
            lixeira,
            nivel,
            agora
        )

        if esvaziou:
            tratar_esvaziamento_p1(agora)

        mapa.salvar(mapa.estado)

        ULTIMO_ID_SUPABASE = id_leitura

    print(
        f"Supabase | Leitura {id_leitura} | "
        f"Distância: {distancia:.2f} cm | "
        f"Ocupação: {nivel}%"
    )


# ==========================================================
# CAMINHÃO
# ==========================================================

CAMINHAO_PADRAO = {
    "estado": "base",
    "rota_ida": None,
    "coleta_confirmada": False,
    "x": 110,
    "y": 77
}

mapa.estado.setdefault(
    "caminhao",
    CAMINHAO_PADRAO.copy()
)

for _chave, _valor in CAMINHAO_PADRAO.items():
    mapa.estado["caminhao"].setdefault(_chave, _valor)

# Se o servidor reiniciou no meio de uma ida/volta sem viagem salva,
# o caminhão volta para a base em vez de ficar preso.
if (
    not mapa.estado.get("viagem")
    and mapa.estado["caminhao"]["estado"] in ("indo_p1", "voltando")
):
    mapa.estado["caminhao"].update(CAMINHAO_PADRAO.copy())


def p1_sensor_online(agora):
    """P1 só é tratada como lixeira física se o ESP32 estiver mandando leituras."""
    p1 = mapa.achar(1)
    return bool(p1) and mapa.sensor_online(p1, agora)


def liberar_caminhao_sem_sensor(agora):
    """Se o sensor da P1 parar de responder (ou for desligado no site),
    o caminhão não fica preso esperando na P1: ele volta para a base.
    O nível da lixeira não é zerado, porque não houve esvaziamento real."""
    caminhao = mapa.estado["caminhao"]

    if caminhao.get("estado") != "aguardando_p1":
        return False

    if p1_sensor_online(agora):
        return False

    print("Sensor da P1 sem sinal. Caminhão voltando à base sem esvaziar.")

    if not iniciar_retorno_fisico(agora):
        caminhao.update(CAMINHAO_PADRAO.copy())

    return True


def agora_ms():
    return int(time.time() * 1000)


def iniciar_retorno_fisico(agora):

    caminhao = mapa.estado["caminhao"]

    rota_original = caminhao.get("rota_ida")

    if not rota_original:
        return False

    rota_invertida = list(reversed(rota_original))

    pontos = [
        {
            "x": float(rota_invertida[0]["x"]),
            "y": float(rota_invertida[0]["y"]),
            "t": 0
        }
    ]

    tempo = 0

    for ponto in rota_invertida[1:]:

        anterior = pontos[-1]

        distancia = math.hypot(
            float(ponto["x"]) - anterior["x"],
            float(ponto["y"]) - anterior["y"]
        )

        if distancia < 0.001:
            continue

        tempo += distancia * 9 + 100

        pontos.append({
            "x": float(ponto["x"]),
            "y": float(ponto["y"]),
            "t": round(tempo)
        })

    if len(pontos) < 2:
        return False

    duracao = round(tempo + 500)
    criada = agora_ms()

    mapa.estado["viagem"] = {
        "id": f"{criada}-{random.randint(1000, 9999)}",
        "criada": criada,
        "inicio": criada + 800,
        "pontos": pontos,
        "paradas": [],
        "duracao": duracao,
        "fim_rota": len(pontos) - 1,
        "tipo": "fisica_volta"
    }

    caminhao["estado"] = "voltando"

    caminhao["x"] = pontos[0]["x"]
    caminhao["y"] = pontos[0]["y"]

    print("P1 esvaziada. Caminhão retornando à base.")

    return True


def tratar_esvaziamento_p1(agora):

    caminhao = mapa.estado["caminhao"]

    if caminhao["estado"] == "aguardando_p1":

        iniciar_retorno_fisico(agora)

    elif caminhao["estado"] == "indo_p1":

        caminhao["coleta_confirmada"] = True

        print(
            "Esvaziamento de P1 confirmado. "
            "Caminhão retornará após chegar ao destino."
        )


# ==========================================================
# SITE
# ==========================================================

@app.route("/")
def index():
    return send_from_directory(SRC, "Index.html")


@app.route("/<path:arquivo>")
def estaticos(arquivo):

    caminho = os.path.join(SRC, arquivo)

    if not os.path.isfile(caminho):
        abort(404)

    return send_from_directory(SRC, arquivo)


# ==========================================================
# VIAGEM DO CAMINHÃO
# ==========================================================

ANTECEDENCIA_MS = 800
MAX_PONTOS_ROTA = 300
MAX_DURACAO_MS = 10 * 60 * 1000
MAX_PENDENTES = 20


def avancar_viagem(agora):

    viagem = mapa.estado.get("viagem")

    if not viagem:
        return liberar_caminhao_sem_sensor(agora)

    decorrido = agora * 1000 - viagem["inicio"]

    tipo = viagem.get("tipo", "normal")

    mudou = False

    # ------------------------------------------------------
    # VIAGEM NORMAL: P2, P3, P4 E P5
    # ------------------------------------------------------

    if tipo == "normal":

        for parada in viagem["paradas"]:

            if (
                not parada.get("coletada")
                and decorrido >= parada["t"]
            ):

                lixeira = mapa.achar(parada["id"])

                if lixeira:
                    mapa.registrar_nivel(lixeira, 0)

                parada["coletada"] = True
                mudou = True

        if decorrido >= viagem["duracao"]:

            mapa.estado["viagem"] = None
            mudou = True

        return mudou

    # ------------------------------------------------------
    # VIAGEM DE IDA: BASE ATÉ P1
    # ------------------------------------------------------

    if tipo == "fisica_ida":

        if decorrido >= viagem["duracao"]:

            ultimo_ponto = viagem["pontos"][-1]

            mapa.estado["viagem"] = None

            caminhao = mapa.estado["caminhao"]

            caminhao["estado"] = "aguardando_p1"

            caminhao["x"] = ultimo_ponto["x"]
            caminhao["y"] = ultimo_ponto["y"]

            mudou = True

            print(
                "Caminhão chegou à P1. "
                "Aguardando confirmação de esvaziamento."
            )

            if caminhao.get("coleta_confirmada"):

                iniciar_retorno_fisico(agora)

            else:

                liberar_caminhao_sem_sensor(agora)

        return mudou

    # ------------------------------------------------------
    # VIAGEM DE VOLTA: P1 ATÉ A BASE
    # ------------------------------------------------------

    if tipo == "fisica_volta":

        if decorrido >= viagem["duracao"]:

            mapa.estado["viagem"] = None

            caminhao = mapa.estado["caminhao"]

            caminhao["estado"] = "base"
            caminhao["rota_ida"] = None
            caminhao["coleta_confirmada"] = False

            caminhao["x"] = 110
            caminhao["y"] = 77

            mudou = True

            print("Caminhão retornou à base.")

        return mudou

    return False


def ler_rota(dados):

    pontos = dados.get("pontos")
    paradas = dados.get("paradas")
    tipo = dados.get("tipo", "normal")

    if not isinstance(pontos, list):
        return None

    if not isinstance(paradas, list):
        return None

    if tipo not in ("normal", "fisica_ida"):
        return None

    if not 2 <= len(pontos) <= MAX_PONTOS_ROTA:
        return None

    if tipo == "normal" and not paradas:
        return None

    if tipo == "fisica_ida" and paradas:
        return None

    try:

        pontos = [
            {
                "x": float(p["x"]),
                "y": float(p["y"]),
                "t": int(p["t"])
            }
            for p in pontos
        ]

        paradas = [
            {
                "id": int(p["id"]),
                "t": int(p["t"])
            }
            for p in paradas
        ]

        duracao = int(dados["duracao"])

        fim_rota = int(
            dados.get("fim_rota", len(pontos) - 1)
        )

    except (TypeError, ValueError, KeyError):
        return None

    tempos = [p["t"] for p in pontos]

    if tempos[0] != 0 or tempos != sorted(tempos):
        return None

    if not tempos[-1] <= duracao <= MAX_DURACAO_MS:
        return None

    if not 0 <= fim_rota < len(pontos):
        return None

    return pontos, paradas, duracao, fim_rota, tipo


@app.post("/api/despachar")
def despachar():

    dados = request.get_json(silent=True) or {}

    automatico = bool(dados.get("automatico"))
    da_fila = bool(dados.get("fila"))

    chave = dados.get("chave")
    chave = str(chave)[:80] if chave else None

    ids = dados.get("ids")

    if ids is not None:

        try:
            ids = [int(i) for i in ids]

        except (TypeError, ValueError):
            return jsonify({"erro": "ids inválidos"}), 400

    agora = time.time()

    with mapa.lock:

        if avancar_viagem(agora):
            mapa.salvar(mapa.estado)

        pendentes = mapa.estado.setdefault(
            "viagens_pendentes", []
        )

        chaves = mapa.estado.setdefault(
            "chaves_despacho", []
        )

        caminhao = mapa.estado["caminhao"]

        def responder(resultado, **extra):

            return jsonify({
                "resultado": resultado,
                "viagem": mapa.estado.get("viagem"),
                "viagens_pendentes": len(pendentes),
                "agora_ms": agora_ms(),
                "caminhao": caminhao,
                **extra
            })

        if chave and chave in chaves:
            return responder("duplicada")

        # --------------------------------------------------
        # CAMINHÃO OCUPADO OU AGUARDANDO P1
        # --------------------------------------------------

        ocupado = (
            mapa.estado.get("viagem")
            or caminhao["estado"] != "base"
        )

        if ocupado:

            if automatico or da_fila:
                return responder("ocupado")

            if len(pendentes) >= MAX_PENDENTES:
                return responder("ocupado")

            pendentes.append({"ids": ids})

            if chave:
                chaves.append(chave)
                del chaves[:-50]

            mapa.salvar(mapa.estado)

            return responder("agendada")

        # --------------------------------------------------
        # RETIRAR VIAGEM DA FILA
        # --------------------------------------------------

        if da_fila:

            if not pendentes:
                return responder("ocupado")

            pendentes.pop(0)

        # --------------------------------------------------
        # VALIDAR ROTA
        # --------------------------------------------------

        rota = ler_rota(dados)

        if not rota:

            mapa.salvar(mapa.estado)

            return responder("vazia")

        pontos, paradas, duracao, fim_rota, tipo = rota

        # --------------------------------------------------
        # VIAGEM FÍSICA PARA P1
        # --------------------------------------------------

        if tipo == "fisica_ida":

            if ids is None or 1 not in ids:
                return responder("invalida")

            if not p1_sensor_online(agora):
                return responder("sensor_desligado")

            caminhao["estado"] = "indo_p1"
            caminhao["rota_ida"] = pontos
            caminhao["coleta_confirmada"] = False

            caminhao["x"] = 110
            caminhao["y"] = 77

        # --------------------------------------------------
        # CRIAR VIAGEM
        # --------------------------------------------------

        criada = agora_ms()

        mapa.estado["viagem"] = {
            "id": f"{criada}-{random.randint(1000, 9999)}",
            "criada": criada,
            "inicio": criada + ANTECEDENCIA_MS,
            "pontos": pontos,
            "paradas": paradas,
            "duracao": duracao,
            "fim_rota": fim_rota,
            "tipo": tipo
        }

        if chave:

            chaves.append(chave)
            del chaves[:-50]

        mapa.salvar(mapa.estado)

        return responder("iniciada")


@app.post("/api/fila/limpar")
def limpar_fila():

    with mapa.lock:

        pendentes = mapa.estado.get(
            "viagens_pendentes"
        ) or []

        removidas = len(pendentes)

        mapa.estado["viagens_pendentes"] = []

        mapa.salvar(mapa.estado)

    return jsonify({
        "removidas": removidas,
        "viagens_pendentes": 0
    })


# ==========================================================
# MAPA
# ==========================================================

@app.get("/api/mapa")
def get_mapa():

    agora = time.time()

    with mapa.lock:

        if avancar_viagem(agora):
            mapa.salvar(mapa.estado)

        for lixeira in mapa.estado["lixeiras"]:

            lixeira["sensor_online"] = mapa.sensor_online(
                lixeira,
                agora
            )

        resposta = dict(mapa.estado)

        resposta.pop("chaves_despacho", None)

        resposta["viagens_pendentes"] = len(
            mapa.estado.get("viagens_pendentes") or []
        )

        resposta["esp32"] = mapa.resumo_esp32(agora)

        resposta["agora_ms"] = agora_ms()

        resposta["caminhao"] = mapa.estado["caminhao"]

        return jsonify(resposta)


# ==========================================================
# SENSOR ESP32
# ==========================================================

@app.post("/api/sensor")
def ligar_sensor():

    dados = request.get_json(silent=True) or {}

    if not isinstance(dados.get("ativo"), bool):

        return jsonify({
            "erro": "Envie {\"ativo\": true/false}"
        }), 400

    with mapa.lock:

        mapa.estado["sensor_ativo"] = dados["ativo"]

        if dados["ativo"]:

            for lixeira in mapa.estado["lixeiras"]:

                lixeira["baixas_seguidas"] = 0

                lixeira["pico"] = lixeira.get("nivel", 0)

        mapa.salvar(mapa.estado)

        return jsonify(
            mapa.resumo_esp32(time.time())
        )


# ==========================================================
# SELEÇÃO DE PONTOS
# ==========================================================

@app.post("/api/ponto")
def selecionar_ponto():

    dados = request.get_json(silent=True) or {}

    if "pontos" in dados:

        pontos = dados.get("pontos") or []

    else:

        ponto = dados.get("ponto")

        pontos = [] if ponto is None else [ponto]

    if not isinstance(pontos, list):

        return jsonify({
            "erro": "Envie uma lista de pontos"
        }), 400

    try:

        pontos = [int(p) for p in pontos]

    except (TypeError, ValueError):

        return jsonify({
            "erro": "Ponto inválido"
        }), 400

    if any(p not in mapa.PONTOS for p in pontos):

        return jsonify({
            "erro": "Ponto inexistente"
        }), 400

    with mapa.lock:

        avancar_viagem(time.time())

        caminhao = mapa.estado["caminhao"]

        if mapa.estado.get("viagem"):

            return jsonify({
                "erro": "Aguarde o caminhão retornar à base para mudar os pontos."
            }), 409

        # Caminhão parado esperando a P1: a P1 continua no mapa.
        if caminhao["estado"] != "base" and 1 not in pontos:
            pontos.append(1)

        mapa.definir_pontos(
            mapa.estado,
            pontos
        )

        mapa.salvar(mapa.estado)

    return jsonify(mapa.estado)


# ==========================================================
# RECEBIMENTO DIRETO DE LEITURA
# ==========================================================

@app.post("/api/leitura")
def leitura():

    dados = request.get_json(silent=True) or {}

    if "nivel" not in dados:

        return jsonify({
            "erro": "Nível não informado"
        }), 400

    try:

        nivel = int(
            round(float(dados["nivel"]))
        )

    except (TypeError, ValueError):

        return jsonify({
            "erro": "Nível inválido"
        }), 400

    agora = time.time()

    try:

        distancia = (
            float(dados["distancia_cm"])
            if "distancia_cm" in dados
            else None
        )

    except (TypeError, ValueError):

        distancia = None

    with mapa.lock:

        lixeiras = mapa.estado["lixeiras"]

        mapa.registrar_contato_esp32(
            dados.get("id"),
            nivel,
            distancia,
            agora
        )

        if not mapa.sensor_ativo():

            return jsonify({
                "ok": True,
                "ativo": False,
                "ignorado": True,
                "mensagem": "Sensor desligado no site."
            })

        if "id" in dados:

            try:
                id_ = int(dados["id"])

            except (TypeError, ValueError):

                return jsonify({
                    "erro": "id inválido"
                }), 400

            lixeira = mapa.achar(id_)

            if not lixeira and id_ in mapa.PONTOS:

                pontos = mapa.estado.get(
                    "pontos_selecionados", []
                ) + [id_]

                mapa.definir_pontos(
                    mapa.estado,
                    pontos
                )

                lixeira = mapa.achar(id_)

        else:

            lixeira = lixeiras[0] if lixeiras else None

        if not lixeira:

            return jsonify({
                "erro": "Lixeira não encontrada"
            }), 404

        esvaziou = mapa.registrar_leitura_sensor(
            lixeira,
            nivel,
            agora
        )

        # Só P1 controla o retorno do caminhão físico.
        if esvaziou and int(lixeira["id"]) == 1:

            tratar_esvaziamento_p1(agora)

        mapa.salvar(mapa.estado)

        return jsonify({
            "ok": True,
            "ativo": True,
            "id": lixeira["id"],
            "nivel": lixeira["nivel"],
            "esvaziou": esvaziou,
            "caminhao": mapa.estado["caminhao"],
            "viagem": mapa.estado.get("viagem")
        })


# ==========================================================
# COLETA
# ==========================================================

@app.post("/api/coletar/<int:id_>")
def coletar(id_):

    with mapa.lock:

        lixeira = mapa.achar(id_)

        if not lixeira:
            abort(404)

        # P1 é controlada pelo sensor físico.
        if id_ == 1 and mapa.sensor_online(lixeira, time.time()):

            return jsonify({
                "erro": "A lixeira física P1 só pode ser esvaziada pela confirmação do sensor."
            }), 409

        mapa.registrar_nivel(lixeira, 0)

        mapa.salvar(mapa.estado)

    return jsonify(lixeira)


# ==========================================================
# SIMULAÇÃO
# ==========================================================

@app.post("/api/simular")
def simular():

    with mapa.lock:

        lixeiras = mapa.estado["lixeiras"]

        if not lixeiras:

            return jsonify({
                "erro": "Nenhuma lixeira posicionada"
            }), 404

        agora = time.time()

        for lixeira in lixeiras:

            # A lixeira com sensor online (P1 física) usa o valor real.

            if not mapa.sensor_online(lixeira, agora):

                mapa.registrar_nivel(
                    lixeira,
                    lixeira["nivel"] + 25
                )

        mapa.salvar(mapa.estado)

    return jsonify(lixeiras)


# ==========================================================
# EDIÇÃO DE LIXEIRA
# ==========================================================

@app.put("/api/lixeiras/<int:id_>")
def editar(id_):

    dados = request.get_json(silent=True) or {}

    with mapa.lock:

        lixeira = mapa.achar(id_)

        if not lixeira:
            abort(404)

        for campo in ("nome", "local", "x", "y"):

            if campo in dados:
                lixeira[campo] = dados[campo]

        mapa.salvar(mapa.estado)

    return jsonify(lixeira)


@app.post("/api/lixeiras")
def adicionar():

    return jsonify({
        "erro": "O sistema utiliza uma única lixeira física."
    }), 409


@app.delete("/api/lixeiras/<int:id_>")
def remover(id_):

    return jsonify({
        "erro": "A lixeira física não pode ser removida."
    }), 409


# ==========================================================
# SIMULADOR EM SEGUNDO PLANO
# ==========================================================

def simulador():

    while True:

        time.sleep(5)

        with mapa.lock:

            if avancar_viagem(time.time()):
                mapa.salvar(mapa.estado)

        if SIMULAR_SENSOR:

            with mapa.lock:

                agora = time.time()

                for lixeira in mapa.estado["lixeiras"]:

                    # Lixeira com sensor online recebe dados só do ESP32.
                    if mapa.sensor_online(lixeira, agora):
                        continue

                    aumento = random.randint(0, 4)

                    mapa.registrar_nivel(
                        lixeira,
                        lixeira["nivel"] + aumento
                    )

                if mapa.estado["lixeiras"]:
                    mapa.salvar(mapa.estado)


_simulador_iniciado = False


def iniciar_simulador():

    global _simulador_iniciado

    if _simulador_iniciado:
        return

    _simulador_iniciado = True

    threading.Thread(
        target=simulador,
        daemon=True
    ).start()


# ==========================================================
# INICIALIZAÇÃO
# ==========================================================

if os.environ.get("RENDER") or os.environ.get("INICIAR_SIMULADOR"):

    iniciar_simulador()


if __name__ == "__main__":

    iniciar_simulador()

    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000))
    )