"""Simula o ESP32 enviando leituras para o site (para testar sem o hardware).

Uso:
    python ESP32/simular_esp32.py                 # enche a lixeira do ponto 1 e depois esvazia
    python ESP32/simular_esp32.py 3               # usa o ponto 3
    python ESP32/simular_esp32.py 1 https://lixeira-inteligente.onrender.com

Ele faz o mesmo POST que o ESP32: /api/leitura {"id": ponto, "nivel": %}.
"""
import json
import sys
import time
import urllib.request

PONTO = int(sys.argv[1]) if len(sys.argv) > 1 else 1
SERVIDOR = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:5000"
INTERVALO = 3  # segundos, igual ao ESP32

# Lixo aumentando até ficar cheia, um tempo cheia e depois esvaziada.
SEQUENCIA = [10, 25, 40, 55, 70, 85, 95, 95, 95, 4, 3, 3, 3]


def enviar(nivel):
    corpo = json.dumps({"id": PONTO, "nivel": nivel}).encode()
    pedido = urllib.request.Request(
        SERVIDOR + "/api/leitura",
        data=corpo,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(pedido, timeout=60) as resposta:
        return json.loads(resposta.read().decode())


print(f"Simulando ESP32 no ponto {PONTO} -> {SERVIDOR}")
for nivel in SEQUENCIA:
    r = enviar(nivel)
    aviso = "  <- ESVAZIADA! (o caminhão vai aparecer no site)" if r.get("esvaziou") else ""
    print(f"nível {nivel:3d}% enviado{aviso}")
    time.sleep(INTERVALO)

print("Fim. O sensor aparece como 'sem sinal' no site uns 30 s depois de parar.")
