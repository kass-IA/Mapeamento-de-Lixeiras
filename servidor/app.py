
import os
import random
import threading
import time

from flask import Flask, jsonify, request, send_from_directory, abort

import mapa

RAIZ = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)

SRC = os.path.join(RAIZ, "SRC")

app = Flask(__name__)

# Ative quando o ESP32 estiver enviando leituras reais.
SIMULAR_SENSOR = True


# Site
@app.route("/")
def index():
    return send_from_directory(SRC, "Index.html")


@app.route("/<path:arquivo>")
def estaticos(arquivo):
    caminho = os.path.join(SRC, arquivo)

    if not os.path.isfile(caminho):
        abort(404)

    return send_from_directory(SRC, arquivo)


# Mapa
@app.get("/api/mapa")
def get_mapa():
    agora = time.time()

    with mapa.lock:
        for lixeira in mapa.estado["lixeiras"]:
            lixeira["sensor_online"] = mapa.sensor_online(lixeira, agora)

        resposta = dict(mapa.estado)
        resposta["esp32"] = mapa.resumo_esp32(agora)
        return jsonify(resposta)


# Liga/desliga o uso do sensor ESP32 no site.
# Corpo: {"ativo": true} ou {"ativo": false}
@app.post("/api/sensor")
def ligar_sensor():
    dados = request.get_json(silent=True) or {}

    if not isinstance(dados.get("ativo"), bool):
        return jsonify({"erro": "Envie {\"ativo\": true/false}"}), 400

    with mapa.lock:
        mapa.estado["sensor_ativo"] = dados["ativo"]

        # Ao ligar, começa a contagem de "esvaziou" do zero, para não
        # disparar o caminhão por causa de leituras antigas.
        if dados["ativo"]:
            for lixeira in mapa.estado["lixeiras"]:
                lixeira["baixas_seguidas"] = 0
                lixeira["pico"] = lixeira.get("nivel", 0)

        mapa.salvar(mapa.estado)
        return jsonify(mapa.resumo_esp32(time.time()))


# Escolhe em quais pontos há lixeira (um ou vários).
# Aceita {"pontos": [1, 3, 5]} ou, no formato antigo, {"ponto": 2}.
@app.post("/api/ponto")
def selecionar_ponto():
    dados = request.get_json(silent=True) or {}

    if "pontos" in dados:
        pontos = dados.get("pontos") or []
    else:
        ponto = dados.get("ponto")
        pontos = [] if ponto is None else [ponto]

    if not isinstance(pontos, list):
        return jsonify({"erro": "Envie uma lista de pontos"}), 400

    try:
        pontos = [int(p) for p in pontos]
    except (TypeError, ValueError):
        return jsonify({"erro": "Ponto inválido"}), 400

    if any(p not in mapa.PONTOS for p in pontos):
        return jsonify({"erro": "Ponto inexistente"}), 400

    with mapa.lock:
        mapa.definir_pontos(mapa.estado, pontos)
        mapa.salvar(mapa.estado)

    return jsonify(mapa.estado)


# Recebe a leitura do ESP32.
# Corpo: {"id": 1, "nivel": 85}  -> id = número do ponto onde a lixeira está.
# Opcional: "distancia_cm" (só para aparecer no histórico/depuração).
@app.post("/api/leitura")
def leitura():
    dados = request.get_json(silent=True) or {}

    if "nivel" not in dados:
        return jsonify({"erro": "Nível não informado"}), 400

    try:
        nivel = int(round(float(dados["nivel"])))
    except (TypeError, ValueError):
        return jsonify({"erro": "Nível inválido"}), 400

    agora = time.time()

    try:
        distancia = float(dados["distancia_cm"]) if "distancia_cm" in dados else None
    except (TypeError, ValueError):
        distancia = None

    with mapa.lock:
        lixeiras = mapa.estado["lixeiras"]

        # Sempre anota que o ESP32 falou com o site (para o botão mostrar
        # "conectado"), mas só usa a leitura se a chave estiver ligada.
        mapa.registrar_contato_esp32(dados.get("id"), nivel, distancia, agora)

        if not mapa.sensor_ativo():
            return jsonify({
                "ok": True,
                "ativo": False,
                "ignorado": True,
                "mensagem": "Sensor desligado no site. Ligue a chave 'Sensor ESP32'."
            })

        if "id" in dados:
            try:
                id_ = int(dados["id"])
            except (TypeError, ValueError):
                return jsonify({"erro": "id inválido"}), 400

            lixeira = mapa.achar(id_)

            # O sensor está num ponto que ainda não foi marcado no site:
            # marca sozinho para a lixeira física aparecer no mapa.
            if not lixeira and id_ in mapa.PONTOS:
                pontos = mapa.estado.get("pontos_selecionados", []) + [id_]
                mapa.definir_pontos(mapa.estado, pontos)
                lixeira = mapa.achar(id_)
        else:
            # Sem "id": vai para a primeira lixeira marcada.
            lixeira = lixeiras[0] if lixeiras else None

        if not lixeira:
            return jsonify({"erro": "Lixeira não encontrada"}), 404

        esvaziou = mapa.registrar_leitura_sensor(lixeira, nivel, agora)
        mapa.salvar(mapa.estado)

    return jsonify({
        "ok": True,
        "ativo": True,
        "id": lixeira["id"],
        "nivel": lixeira["nivel"],
        "esvaziou": esvaziou
    })


# Confirma a coleta
@app.post("/api/coletar/<int:id_>")
def coletar(id_):
    with mapa.lock:
        lixeira = mapa.achar(id_)

        if not lixeira:
            abort(404)

        mapa.registrar_nivel(lixeira, 0)
        mapa.salvar(mapa.estado)

    return jsonify(lixeira)


# Simula o enchimento
@app.post("/api/simular")
def simular():
    with mapa.lock:
        lixeiras = mapa.estado["lixeiras"]

        if not lixeiras:
            return jsonify({"erro": "Nenhuma lixeira posicionada"}), 404

        # Enche as lixeiras posicionadas (as com sensor ligado usam o valor real).
        agora = time.time()
        for lixeira in lixeiras:
            if not mapa.sensor_online(lixeira, agora):
                mapa.registrar_nivel(lixeira, lixeira["nivel"] + 25)

        mapa.salvar(mapa.estado)

    return jsonify(lixeiras)


# Edita os dados da lixeira
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


# Mantém apenas uma lixeira física
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


# Atualiza a leitura simulada
def simulador():
    while True:
        time.sleep(5)

        if SIMULAR_SENSOR:
            with mapa.lock:
                # Cada lixeira enche num ritmo diferente.
                agora = time.time()
                for lixeira in mapa.estado["lixeiras"]:
                    # Lixeira com sensor ligado: o nível vem do ESP32.
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
    """Liga o simulador de enchimento uma única vez."""
    global _simulador_iniciado

    if _simulador_iniciado:
        return

    _simulador_iniciado = True
    threading.Thread(
        target=simulador,
        daemon=True
    ).start()


# Na hospedagem (Render), o servidor é iniciado pelo gunicorn,
# que importa este arquivo em vez de executá-lo direto.
if os.environ.get("RENDER") or os.environ.get("INICIAR_SIMULADOR"):
    iniciar_simulador()


# Inicia o servidor (no computador: python servidor/app.py)
if __name__ == "__main__":
    iniciar_simulador()

    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000))
    )
