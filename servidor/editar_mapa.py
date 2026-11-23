import json
import sys
import urllib.request


URL = "http://localhost:5000"


def chamar(caminho, metodo="GET", corpo=None):

    dados = (
        json.dumps(corpo).encode()
        if corpo
        else None
    )

    requisicao = urllib.request.Request(
        URL + caminho,
        data=dados,
        method=metodo,
        headers={
            "Content-Type": "application/json"
        }
    )

    with urllib.request.urlopen(requisicao) as resposta:

        texto = resposta.read().decode()

        return (
            json.loads(texto)
            if texto
            else None
        )


# ==========================================================
# COMANDOS
# ==========================================================

cmd, *args = sys.argv[1:] or ["listar"]


# ----------------------------------------------------------
# LISTAR
# ----------------------------------------------------------

if cmd == "listar":

    mapa = chamar("/api/mapa")

    for lixeira in mapa["lixeiras"]:

        print(
            f'{lixeira["id"]}: '
            f'{lixeira["nome"]} '
            f'({lixeira["local"]}) '
            f'x={lixeira["x"]} '
            f'y={lixeira["y"]} '
            f'nivel={lixeira["nivel"]}%'
        )


# ----------------------------------------------------------
# ADICIONAR
# ----------------------------------------------------------

elif cmd == "adicionar":

    nome, local, x, y = args

    resultado = chamar(
        "/api/lixeiras",
        "POST",
        {
            "nome": nome,
            "local": local,
            "x": int(x),
            "y": int(y)
        }
    )

    print("Criada:", resultado)


# ----------------------------------------------------------
# MOVER
# ----------------------------------------------------------

elif cmd == "mover":

    id_, x, y = args

    resultado = chamar(
        f"/api/lixeiras/{id_}",
        "PUT",
        {
            "x": int(x),
            "y": int(y)
        }
    )

    print("Movida:", resultado)


# ----------------------------------------------------------
# REMOVER
# ----------------------------------------------------------

elif cmd == "remover":

    id_ = args[0]

    chamar(
        f"/api/lixeiras/{id_}",
        "DELETE"
    )

    print("Removida.")


# ----------------------------------------------------------
# COMANDO INVÁLIDO
# ----------------------------------------------------------

else:

    print(
        """
Comandos disponíveis:

listar

adicionar "Nome" "Local" X Y

mover ID X Y

remover ID
"""
    )