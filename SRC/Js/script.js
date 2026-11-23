// ---------- Estado da aplicação ----------
let lixeiras = [];
let BASE = { x: 110, y: 85 };
let selecionada = null;
let offline = false;
let carregando = false;

const truck = {
  x: BASE.x,
  y: BASE.y,
  ocupado: false,
  iniciado: false
};

let caminhaoInfo = {
  estado: "base",
  rota_ida: null,
  coleta_confirmada: false,
  x: BASE.x,
  y: 77
};

const jaAvisou = {};

const STATUS = {
  normal: {
    classe: "normal",
    texto: "🟢 Normal",
    cor: "#3ddc84"
  },
  atencao: {
    classe: "atencao",
    texto: "🟡 Quase cheia",
    cor: "#ffc233"
  },
  cheia: {
    classe: "cheia",
    texto: "🔴 Coleta necessária",
    cor: "#ff5a52"
  }
};

const $ = id => document.getElementById(id);


// ---------- Regras de ocupação ----------

function status(nivel) {
  if (nivel >= 80) return "cheia";
  if (nivel >= 50) return "atencao";
  return "normal";
}

function limitarNivel(nivel) {
  return Math.max(0, Math.min(100, Number(nivel) || 0));
}

// P1 só é tratada como lixeira física quando a chave do sensor está
// ligada E o ESP32 está mandando leituras. Sem sinal, ela vira uma
// lixeira normal do mapa (o caminhão não fica preso esperando).
// Ponto da lixeira real (o ponto que o ESP32 informa).
function idFisica() {
  const ponto = Number(esp32Info?.ponto);
  return ponto >= 1 && ponto <= 5 ? ponto : 1;
}

function p1ComSensor() {
  const p1 = lixeiras.find(l => Number(l.id) === idFisica());

  return Boolean(
    esp32Info?.ativo &&
    p1?.sensor_online
  );
}

// Prioridade da coleta: se houver lixeiras cheias, vai só nelas.
// Se não houver nenhuma cheia, vai nas quase cheias.
function escolherAlvos(lista) {
  const cheias = lista.filter(
    l => status(limitarNivel(l.nivel)) === "cheia"
  );

  if (cheias.length) return cheias;

  return lista.filter(
    l => status(limitarNivel(l.nivel)) === "atencao"
  );
}

// Monta a viagem para as lixeiras escolhidas.
// Com o sensor online, a P1 tem viagem própria: o caminhão vai até ela
// e só volta quando o lixo for esvaziado de verdade.
function planoDaViagem(alvos) {
  if (p1ComSensor()) {

    const outras = alvos.filter(l => Number(l.id) !== idFisica());

    if (outras.length) return montarViagem(outras);

    if (alvos.length) return montarViagemFisicaIda();

    return null;
  }

  return montarViagem(alvos);
}

// Estima quanto falta para chegar a 100%, usando o histórico simulado.
function previsao(lixeira) {
  const historico = Array.isArray(lixeira.historico)
    ? lixeira.historico
    : [];

  const aumentos = [];

  for (let i = 1; i < historico.length; i++) {
    const diferenca = historico[i] - historico[i - 1];

    if (diferenca > 0) {
      aumentos.push(diferenca);
    }
  }

  if (lixeira.nivel >= 100) return "cheia agora";
  if (!aumentos.length) return "—";

  const media = aumentos.reduce(
    (soma, valor) => soma + valor,
    0
  ) / aumentos.length;

  return `~${Math.ceil((100 - lixeira.nivel) / media)} min (simulado)`;
}


// ---------- Mapa e ícones ----------

const ESCALA_ICONE = 36 / 380;

function desenharMapa() {
  const camada = $("camada-lixeiras");

  if (!camada) return;

  const html = lixeiras.map(lixeira => {
    const nivel = limitarNivel(lixeira.nivel);
    const estado = status(nivel);

    const vazia = faixa(nivel) === "vazia";
    const cheiaVisual = estado === "cheia" || vazia;

    const classeSelecionada =
      lixeira.id === selecionada ? "selecionada" : "";

    const nome = String(
      lixeira.nome || `Lixeira ${lixeira.id}`
    );

    return `
      <g
        class="lixeira ${estado} ${vazia ? "vazia" : ""} ${classeSelecionada}"
        role="button"
        tabindex="0"
        aria-label="${nome}: ${nivel}%"
        onclick="abrirLixeira(${Number(lixeira.id)})"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();abrirLixeira(${Number(lixeira.id)})}"
      >

        <circle
          class="area-clique"
          cx="${lixeira.x}"
          cy="${lixeira.y}"
          r="20"
          fill="transparent"
        ></circle>

        <g
          class="icone-lixeira"
          transform="translate(${lixeira.x - 367.5 * ESCALA_ICONE},${lixeira.y - 367.5 * ESCALA_ICONE}) scale(${ESCALA_ICONE})"
        >
          <clipPath id="clip-lixeira-${Number(lixeira.id)}">
            <path d="M242 292 L242 517 Q242 557 282 557 L453 557 Q493 557 493 517 L493 292 Z"/>
          </clipPath>

          <path class="corpo-lixeira"
            d="M242 292 L242 517 Q242 557 282 557 L453 557 Q493 557 493 517 L493 292 Z"/>

          <rect class="lixo"
            clip-path="url(#clip-lixeira-${Number(lixeira.id)})"
            x="230"
            y="${557 - 265 * (cheiaVisual ? 100 : nivel) / 100}"
            width="275"
            height="${265 * (cheiaVisual ? 100 : nivel) / 100 + 5}"/>

          <g class="contorno-lixeira" fill="none" stroke-width="26"
             stroke-linecap="round" stroke-linejoin="round">
            <rect class="tampa" x="318" y="178" width="100" height="50" rx="14"/>
            <rect class="tampa" x="217" y="229" width="301" height="50" rx="25"/>
            <path d="M242 292 L242 517 Q242 557 282 557 L453 557 Q493 557 493 517 L493 292"/>
            <path class="listras" d="M305 355V505M368 355V505M431 355V505"/>
          </g>
        </g>

      </g>
    `;
  }).join("");

  if (camada._html !== html) {
    camada._html = html;
    camada.innerHTML = html;
  }
}


// ---------- Indicadores do painel principal ----------

function atualizarDashboard() {
  const contagem = {
    normal: 0,
    atencao: 0,
    cheia: 0
  };

  lixeiras.forEach(lixeira => {
    contagem[status(limitarNivel(lixeira.nivel))]++;
  });

  if ($("d-total")) {
    $("d-total").textContent = lixeiras.length;
  }

  if ($("d-normal")) {
    $("d-normal").textContent = contagem.normal;
  }

  if ($("d-atencao")) {
    $("d-atencao").textContent = contagem.atencao;
  }

  if ($("d-cheia")) {
    $("d-cheia").textContent = contagem.cheia;
  }

  if ($("d-media")) {
    const media = lixeiras.length
      ? Math.round(
          lixeiras.reduce(
            (soma, lixeira) =>
              soma + limitarNivel(lixeira.nivel),
            0
          ) / lixeiras.length
        )
      : 0;

    $("d-media").textContent = `${media}%`;
  }

  if ($("atualizacao")) {
    $("atualizacao").textContent =
      `Última atualização: ${new Date().toLocaleTimeString("pt-BR")}`;
  }
}


// A fila sempre mostra primeiro as lixeiras mais cheias.
function desenharFila() {
  const fila = $("fila");

  if (!fila) return;

  const html = [...lixeiras]
    .sort(
      (a, b) =>
        limitarNivel(b.nivel) - limitarNivel(a.nivel)
    )
    .map(lixeira => {
      const nivel = limitarNivel(lixeira.nivel);
      const cor = STATUS[status(nivel)].cor;

      return `
        <div class="item-fila"
             role="button"
             tabindex="0"
             onclick="abrirLixeira(${Number(lixeira.id)})"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();abrirLixeira(${Number(lixeira.id)})}">
          <span>${String(
            lixeira.nome || `Lixeira ${lixeira.id}`
          ).slice(-1)}</span>

          <div class="barra">
            <div style="width:${nivel}%;background:${cor}"></div>
          </div>

          <span>${nivel}%</span>
        </div>`;
    }).join("");

  if (fila._html !== html) {
    fila._html = html;
    fila.innerHTML = html;
  }
}


// Mantém somente as seis mensagens mais recentes.
function log(mensagem) {
  const lista = $("log");

  if (!lista) return;

  const item = document.createElement("li");

  item.textContent =
    `${new Date().toLocaleTimeString("pt-BR")} — ${mensagem}`;

  lista.prepend(item);

  while (lista.children.length > 6) {
    lista.lastElementChild.remove();
  }
}


// ---------- Painel de detalhes ----------

function abrirLixeira(id) {
  selecionada = id;
  desenharPainel();
  desenharMapa();
}

function desenharPainel() {
  const painel = $("detalhes");

  if (!painel) return;

  const lixeira = lixeiras.find(
    item => item.id === selecionada
  );

  if (!lixeira) {
    painel.innerHTML =
      "<p>Selecione uma lixeira no mapa para ver os detalhes.</p>";
    return;
  }

  const nivel = limitarNivel(lixeira.nivel);
  const estado = status(nivel);
  const info = STATUS[estado];

  const historico = Array.isArray(lixeira.historico)
    ? lixeira.historico
    : [];

  const barras = historico
    .map(
      valor =>
        `<span style="height:${limitarNivel(valor)}%"
                title="${limitarNivel(valor)}%"></span>`
    )
    .join("");

  const p1Fisica =
    Number(lixeira.id) === idFisica() &&
    p1ComSensor();

  const botaoColeta = estado === "cheia"
    ? `<div class="alerta">Coleta necessária!${p1Fisica ? " O caminhão espera a lixeira ser esvaziada de verdade." : ""}</div>
       <button onclick="despachar([${Number(lixeira.id)}])">
         Iniciar coleta
       </button>`
    : "";

  painel.innerHTML = `
    <h2>${lixeira.nome || `Lixeira ${lixeira.id}`} · ID ${lixeira.id}</h2>

    <p>
      Local: ${lixeira.local || "Não informado"}<br>
      Ocupação: <b>${nivel}%</b> — ${info.texto}
    </p>

    <div class="barra">
      <div style="width:${nivel}%;background:${info.cor}"></div>
    </div>

    <small>
      Enche em: ${previsao({ ...lixeira, nivel })}<br>
      Última leitura: ${new Date().toLocaleTimeString("pt-BR")}
    </small>

    <p><small>Histórico de nível:</small></p>

    <div class="historico">${barras}</div>

    ${botaoColeta}`;
}


// ---------- Movimento e despacho do caminhão ----------


// ---------- Rede de ruas e rotas ----------

function trechoBase() {
  return [
    { x: BASE.x, y: 77 },
    { x: 272, y: 77 },
    { x: 285, y: 82 },
    { x: 289, y: 95 },
    { x: 289, y: 125 },
    { x: 293, y: 137 },
    { x: 305, y: 142 },
    { x: 407, y: 142 }
  ];
}

const NOS = {
  J1: { x: 407, y: 142, pai: null },
  P1: { x: 740, y: 142, pai: "J1" },
  J2: { x: 407, y: 321, pai: "J1" },
  P2: { x: 59, y: 321, pai: "J2" },
  P3: { x: 407, y: 321, pai: "J2" },
  P4: { x: 750, y: 321, pai: "J2" },
  J3: { x: 407, y: 489, pai: "J2" },
  P5: { x: 59, y: 489, pai: "J3" }
};

const ORDEM_VISITA = [1, 2, 3, 4, 5];

function ancestrais(no) {
  const lista = [];

  while (no) {
    lista.push(no);
    no = NOS[no].pai;
  }

  return lista;
}

function caminhoEntre(origem, destino) {
  const subida = ancestrais(origem);
  const descida = ancestrais(destino);

  const comum = subida.find(no => descida.includes(no));

  const nos = [
    ...subida.slice(0, subida.indexOf(comum) + 1),
    ...descida.slice(0, descida.indexOf(comum)).reverse()
  ];

  return nos.map(no => ({
    x: NOS[no].x,
    y: NOS[no].y
  }));
}

function semRepetidos(pontos) {
  return pontos.filter((p, i) =>
    i === 0 ||
    p.x !== pontos[i - 1].x ||
    p.y !== pontos[i - 1].y
  );
}


// Monta a viagem normal: base → paradas → base.
function planejarViagem(alvos) {
  const paradas = alvos
    .filter(l => NOS[`P${Number(l.ponto)}`])
    .sort((a, b) =>
      ORDEM_VISITA.indexOf(Number(a.ponto)) -
      ORDEM_VISITA.indexOf(Number(b.ponto))
    );

  let atual = "J1";

  const trechos = paradas.map(lixeira => {
    const destino = `P${Number(lixeira.ponto)}`;
    const trecho = caminhoEntre(atual, destino).slice(1);

    atual = destino;

    return { lixeira, trecho };
  });

  const volta = semRepetidos([
    ...caminhoEntre(atual, "J1"),
    ...trechoBase().reverse(),
    { x: BASE.x, y: BASE.y }
  ]).slice(1);

  return {
    paradas,
    trechos,
    volta
  };
}


// ---------- Viagem ao vivo ----------

const PAUSA_COLETA = 700;
const TEMPO_GIRO = 500;

const relogio = {
  diferenca: 0,
  atraso: Infinity
};

function agoraServidor() {
  return Date.now() + relogio.diferenca;
}

function acertarRelogio(
  agoraMsServidor,
  enviadoEm,
  recebidoEm
) {
  if (!agoraMsServidor) return;

  const atraso = recebidoEm - enviadoEm;

  relogio.atraso += 20;

  if (atraso <= relogio.atraso) {
    relogio.atraso = atraso;

    relogio.diferenca =
      agoraMsServidor - (enviadoEm + recebidoEm) / 2;
  }
}


// Transforma a rota normal em pontos com horário.
function montarViagem(alvos) {
  const { paradas, trechos, volta } = planejarViagem(alvos);

  if (!paradas.length) return null;

  const pontos = [
    { x: BASE.x, y: BASE.y, t: 0 }
  ];

  let t = 0;

  const andar = lista => lista.forEach(p => {
    const ultimo = pontos[pontos.length - 1];

    const distancia = Math.hypot(
      p.x - ultimo.x,
      p.y - ultimo.y
    );

    if (distancia < 0.001) return;

    t += distancia * 9 + 100;

    pontos.push({
      x: p.x,
      y: p.y,
      t: Math.round(t)
    });
  });

  andar(trechoBase());

  const paradasComHora = trechos.map(({ lixeira, trecho }) => {
    andar(trecho);

    const chegada = Math.round(t);

    t += PAUSA_COLETA;

    const ultimo = pontos[pontos.length - 1];

    pontos.push({
      x: ultimo.x,
      y: ultimo.y,
      t: Math.round(t)
    });

    return {
      id: lixeira.id,
      t: chegada
    };
  });

  const fimRota = pontos.length - 1;

  andar(volta);

  return {
    pontos,
    paradas: paradasComHora,
    duracao: Math.round(t + TEMPO_GIRO),
    fim_rota: fimRota
  };
}


// ---------- Viagem física exclusiva da P1 ----------

function montarViagemFisicaIda() {
  const pontos = [
    { x: BASE.x, y: BASE.y, t: 0 }
  ];

  let t = 0;

  const andar = lista => lista.forEach(p => {
    const ultimo = pontos[pontos.length - 1];

    const distancia = Math.hypot(
      p.x - ultimo.x,
      p.y - ultimo.y
    );

    if (distancia < 0.001) return;

    t += distancia * 9 + 100;

    pontos.push({
      x: p.x,
      y: p.y,
      t: Math.round(t)
    });
  });

  andar(trechoBase());

  andar(
    caminhoEntre("J1", `P${idFisica()}`).slice(1)
  );

  return {
    pontos,
    paradas: [],
    duracao: Math.round(t + TEMPO_GIRO),
    fim_rota: pontos.length - 1,
    tipo: "fisica_ida"
  };
}


// Viagem que está sendo mostrada agora.
let viagem = null;
let viagensPendentes = 0;


// Prepara a viagem recebida do servidor.
function receberViagem(dados) {
  const pontos = dados.pontos;

  const angulos = [];
  const direcoes = [];

  let angulo = 0;
  let direcao = -1;

  for (let i = 0; i < pontos.length - 1; i++) {
    const dx = pontos[i + 1].x - pontos[i].x;
    const dy = pontos[i + 1].y - pontos[i].y;

    if (Math.hypot(dx, dy) >= 0.001) {
      angulo = Math.atan2(-dy, dx);
      direcao = dx >= 0 ? -1 : 1;
    }

    angulos.push(angulo);
    direcoes.push(direcao);
  }

  const decorrido = agoraServidor() - dados.inicio;

  return {
    ...dados,
    angulos,
    direcoes,
    anguloFinal: angulo,

    avisadas: new Set(
      dados.paradas
        .filter(p => decorrido >= p.t)
        .map(p => p.id)
    ),

    nomes: Object.fromEntries(
      dados.paradas.map(p => {
        const l = lixeiras.find(x => x.id === p.id);

        return [
          p.id,
          l ? l.nome : `Lixeira ${p.id}`
        ];
      })
    )
  };
}


// Recebe o estado do servidor.
function sincronizarViagem(
  dadosViagem,
  pendentes,
  agoraMsServidor,
  infoCaminhao
) {
  if (typeof pendentes === "number") {
    viagensPendentes = pendentes;
  }

  if (infoCaminhao) {
    caminhaoInfo = infoCaminhao;
  }

  if (dadosViagem) {

    if (!viagem || viagem.id !== dadosViagem.id) {

      const nova = receberViagem(dadosViagem);

      const decorrido = agoraServidor() - nova.inicio;

      if (nova.tipo === "fisica_ida") {

        log(`Caminhão a caminho da lixeira real P${idFisica()}.`);

      } else if (nova.tipo === "fisica_volta") {

        log("Esvaziamento confirmado. Caminhão retornando à base.");

      } else {

        const n = nova.paradas.length;

        if (decorrido < 3000) {

          log(
            n === 1
              ? `Caminhão a caminho de ${nova.nomes[nova.paradas[0].id]}.`
              : `Caminhão saiu para ${n} coletas: ` +
                nova.paradas.map(p => nova.nomes[p.id]).join(" → ") + "."
          );

        } else {

          log("Caminhão em rota (acompanhando ao vivo).");

        }
      }

      viagem = nova;

      truck.ocupado = true;

      atualizarBotoes();

      requestAnimationFrame(animarViagem);
    }

  } else {

    if (viagem) {

      if (
        agoraMsServidor &&
        agoraMsServidor < viagem.criada
      ) {
        return;
      }

      if (
        viagem.tipo === "fisica_ida" &&
        caminhaoInfo.estado === "aguardando_p1"
      ) {

        const ultimo =
          viagem.pontos[viagem.pontos.length - 1];

        posicionarCaminhao(
          ultimo.x,
          ultimo.y,
          viagem.anguloFinal,
          viagem.direcoes[viagem.direcoes.length - 1] || -1
        );

        viagem = null;

        truck.ocupado = true;

        desenharRotaRestante(null);

        log(`Caminhão estacionado em P${idFisica()}. Aguardando esvaziamento.`);

      } else {

        // O servidor não tem mais viagem: encerra a que está na tela.
        terminarViagem();

      }
    }

    // Caminhão parado na P1 esperando o esvaziamento real.
    if (
      !viagem &&
      caminhaoInfo.estado === "aguardando_p1"
    ) {
      truck.ocupado = true;

      const x = Number(caminhaoInfo.x);
      const y = Number(caminhaoInfo.y);

      if (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        (truck.x !== x || truck.y !== y)
      ) {
        posicionarCaminhao(x, y, truck.angulo || 0, -1);
      }
    }

    // Caminhão de volta na base.
    if (
      caminhaoInfo.estado === "base" &&
      !viagem
    ) {
      if (truck.ocupado) {
        posicionarCaminhao(BASE.x, BASE.y, 0, -1);
      }

      truck.ocupado = false;
    }
  }

  atualizarBotoes();
}


// Posição do caminhão num instante da viagem.
function posicaoNaViagem(v, decorrido) {
  const p = v.pontos;

  if (decorrido <= 0) {
    return {
      x: p[0].x,
      y: p[0].y,
      angulo: 0,
      direcao: -1,
      trecho: -1
    };
  }

  const ultimo = p.length - 1;

  if (decorrido >= p[ultimo].t) {

    // Na ida para P1, o caminhão estaciona no destino.
    if (v.tipo === "fisica_ida") {

      return {
        x: p[ultimo].x,
        y: p[ultimo].y,
        angulo: v.anguloFinal,
        direcao: v.direcoes[ultimo - 1] || -1,
        trecho: ultimo
      };
    }

    // Nas demais viagens, mantém a orientação de chegada à base.
    const progresso = Math.min(
      1,
      (decorrido - p[ultimo].t) / TEMPO_GIRO
    );

    let delta = 0 - v.anguloFinal;

    delta = Math.atan2(
      Math.sin(delta),
      Math.cos(delta)
    );

    const angulo = v.anguloFinal + delta * progresso;

    return {
      x: p[ultimo].x,
      y: p[ultimo].y,
      angulo,
      direcao: progresso >= 1
        ? -1
        : v.direcoes[ultimo - 1],
      trecho: ultimo
    };
  }

  let i = 0;

  while (
    i < ultimo - 1 &&
    decorrido >= p[i + 1].t
  ) {
    i++;
  }

  const duracao = p[i + 1].t - p[i].t;

  const progresso = duracao > 0
    ? (decorrido - p[i].t) / duracao
    : 1;

  return {
    x: p[i].x + (p[i + 1].x - p[i].x) * progresso,
    y: p[i].y + (p[i + 1].y - p[i].y) * progresso,
    angulo: v.angulos[i],
    direcao: v.direcoes[i],
    trecho: i
  };
}


function posicionarCaminhao(x, y, angulo, direcao) {
  truck.x = x;
  truck.y = y;
  truck.angulo = angulo;

  $("caminhao")?.setAttribute(
    "transform",
    `translate(${x},${y}) scale(${direcao},1)`
  );

  if (typeof window.moverCaminhao3D === "function") {
    window.moverCaminhao3D(x, y, angulo);
  }
}


// Linha azul da posição atual até a última lixeira.
function desenharRotaRestante(v, pos) {
  const linha = $("rota");

  if (!linha) return;

  if (!v || pos.trecho >= v.fim_rota) {
    linha.setAttribute("points", "");
    return;
  }

  const pontos = semRepetidos([
    { x: pos.x, y: pos.y },
    ...v.pontos.slice(
      pos.trecho + 1,
      v.fim_rota + 1
    )
  ]);

  linha.setAttribute(
    "points",
    pontos.map(p => `${p.x},${p.y}`).join(" ")
  );
}


// ---------- Animação da viagem ----------

function animarViagem() {
  const v = viagem;

  if (!v) return;

  const decorrido = agoraServidor() - v.inicio;

  const pos = posicaoNaViagem(v, decorrido);

  posicionarCaminhao(
    pos.x,
    pos.y,
    pos.angulo,
    pos.direcao
  );

  desenharRotaRestante(v, pos);

  // Avisa cada coleta quando o caminhão chega à lixeira.
  v.paradas.forEach((parada, i) => {

    if (
      decorrido >= parada.t &&
      !v.avisadas.has(parada.id)
    ) {

      v.avisadas.add(parada.id);

      log(
        `${v.nomes[parada.id]} coletada ` +
        `(${i + 1}/${v.paradas.length}).`
      );

      const lixeira = lixeiras.find(
        l => l.id === parada.id
      );

      if (lixeira) {
        lixeira.nivel = 0;
      }

      atualizarTudo();

      setTimeout(carregar, 300);
    }
  });

  if (decorrido >= v.duracao) {

    // Ida física: estaciona em P1 e espera o servidor confirmar
    // o esvaziamento pelo ESP32.
    if (v.tipo === "fisica_ida") {

      const ultimo =
        v.pontos[v.pontos.length - 1];

      posicionarCaminhao(
        ultimo.x,
        ultimo.y,
        v.anguloFinal,
        v.direcoes[v.direcoes.length - 1] || -1
      );

      viagem = null;

      truck.ocupado = true;

      caminhaoInfo.estado = "aguardando_p1";

      desenharRotaRestante(null);

      log(`Caminhão estacionado em P${idFisica()}. Aguardando esvaziamento.`);

      atualizarTudo();
      atualizarBotoes();

      return;
    }

    terminarViagem();

    return;
  }

  requestAnimationFrame(animarViagem);
}


function terminarViagem() {
  if (!viagem) return;

  viagem = null;

  truck.ocupado = false;

  posicionarCaminhao(
    BASE.x,
    BASE.y,
    0,
    -1
  );

  desenharRotaRestante(null);

  log("Caminhão voltou para a base.");

  atualizarTudo();
  atualizarBotoes();

  carregar();
}


// ---------- Despacho ----------

// automatico = true quando chamado pelo despacho automático.
// chave = identifica o pedido para evitar duplicidade.
let enviandoDespacho = false;


async function despachar(ids, automatico = false, chave) {

  if (automatico && truck.ocupado) return;

  if (enviandoDespacho) return;

  // Quais lixeiras entram na viagem:
  // - botão de uma lixeira: só ela;
  // - automático: só as cheias;
  // - botão Despachar: cheias primeiro; se não houver, as quase cheias.
  let alvos;

  if (ids) {
    alvos = lixeiras.filter(l => ids.includes(l.id));
  } else if (automatico) {
    alvos = lixeiras.filter(l => status(limitarNivel(l.nivel)) === "cheia");
  } else {
    alvos = escolherAlvos(lixeiras);
  }

  const plano = planoDaViagem(alvos);

  if (!plano && !truck.ocupado) {

    if (!automatico) {

      log(
        lixeiras.length
          ? "Nenhuma lixeira cheia ou quase cheia para coletar agora."
          : "Nenhuma lixeira posicionada. Marque um ou mais pontos."
      );

      sacudir($("btn-despachar"));
      sacudir($("dock-despachar"));
    }

    return;
  }

  const fisica = plano?.tipo === "fisica_ida";

  await pedirViagem({
    ...(plano || {}),
    ids: fisica ? [idFisica()] : (ids || null),
    automatico,
    chave: chave || (fisica ? `p1-fisica-${Date.now()}` : undefined)
  });
}


// Apaga as viagens agendadas para todos.
async function limparFila() {
  const botoes = [
    $("btn-limpar-fila"),
    $("dock-limpar")
  ];

  botoes.forEach(b => botaoOcupado(b, true));

  try {

    const resposta = await api(
      "/api/fila/limpar",
      "POST"
    );

    viagensPendentes = 0;

    log(
      resposta.removidas
        ? `Fila zerada: ${resposta.removidas} ${resposta.removidas === 1 ? "viagem cancelada" : "viagens canceladas"}.`
        : "A fila já estava vazia."
    );

  } catch (erro) {

    log("Não foi possível limpar a fila.");

    console.error(erro);

  } finally {

    botoes.forEach(b => botaoOcupado(b, false));

    atualizarBotoes();
  }
}


// A viagem acabou e havia coletas agendadas.
async function despacharDaFila() {

  if (enviandoDespacho || truck.ocupado) return;

  if (caminhaoInfo.estado !== "base") return;

  const plano = planoDaViagem(escolherAlvos(lixeiras));

  await pedirViagem({
    ...(plano || {}),
    ...(plano?.tipo === "fisica_ida" ? { ids: [idFisica()] } : {}),
    fila: true
  });
}


async function pedirViagem(corpo) {
  enviandoDespacho = true;

  try {

    const enviadoEm = Date.now();

    const resposta = await api(
      "/api/despachar",
      "POST",
      corpo
    );

    acertarRelogio(
      resposta.agora_ms,
      enviadoEm,
      Date.now()
    );

    if (resposta.resultado === "agendada") {

      log(
        `Nova coleta agendada (${resposta.viagens_pendentes} na fila). O caminhão sai assim que voltar.`
      );

    } else if (
      resposta.resultado === "vazia" &&
      !corpo.automatico &&
      !corpo.fila
    ) {

      log("Nenhuma lixeira posicionada. Marque um ou mais pontos.");

      sacudir($("btn-despachar"));

    } else if (resposta.resultado === "sensor_desligado") {

      log("O sensor ESP32 precisa estar ligado para despachar até P1.");

    } else if (resposta.resultado === "ocupado") {

      if (!corpo.automatico) {
        log("O caminhão está ocupado ou aguardando o esvaziamento de P1.");
      }
    }

    sincronizarViagem(
      resposta.viagem,
      resposta.viagens_pendentes,
      resposta.agora_ms,
      resposta.caminhao
    );

  } catch (erro) {

    if (!corpo.automatico) {

      log(
        "Não foi possível despachar o caminhão. Confira a conexão com o servidor."
      );
    }

    console.error("Erro ao despachar:", erro);

  } finally {

    enviandoDespacho = false;
  }
}


// ---------- Botões ----------

function botaoOcupado(botao, ocupado) {
  if (!botao) return;

  botao.classList.toggle("carregando", ocupado);

  botao.disabled = ocupado;

  botao.setAttribute(
    "aria-busy",
    ocupado ? "true" : "false"
  );
}

function sacudir(botao) {
  if (!botao) return;

  botao.classList.remove("sacudir");

  void botao.offsetWidth;

  botao.classList.add("sacudir");
}


function atualizarBotoes() {
  const botao = $("btn-despachar");
  const legenda = $("btn-despachar-sub");

  const seletor = $("seletor-pontos");

  if (seletor) {

    seletor.disabled = Boolean(viagem);

    seletor.title = viagem
      ? "Aguarde o caminhão voltar para mudar os pontos."
      : "";
  }

  const dockDespachar = $("dock-despachar");

  if (dockDespachar) {

    dockDespachar.classList.toggle(
      "em-rota",
      truck.ocupado
    );

    $("dock-despachar-texto").textContent =
      truck.ocupado ? "Em rota" : "Despachar";

    const fila = $("dock-fila");

    fila.hidden = viagensPendentes === 0;

    fila.textContent = `+${viagensPendentes}`;
  }

  const temFila = viagensPendentes > 0;

  if ($("btn-limpar-fila")) {

    $("btn-limpar-fila").hidden = !temFila;

    $("btn-limpar-fila-n").textContent =
      viagensPendentes;
  }

  if ($("dock-limpar")) {
    $("dock-limpar").hidden = !temFila;
  }

  // Os pontos só ficam travados com o caminhão andando.
  $("dock-pontos")?.querySelectorAll("button").forEach(b => {
    b.disabled = Boolean(viagem);
  });

  if (!botao) return;

  botao.classList.toggle(
    "em-rota",
    truck.ocupado
  );

  if (legenda) {

    if (caminhaoInfo.estado === "aguardando_p1") {

      legenda.textContent = `Aguardando esvaziamento da P${idFisica()}`;

    } else if (caminhaoInfo.estado === "voltando") {

      legenda.textContent = "Retornando à base";

    } else {

      legenda.textContent = !truck.ocupado
        ? "Enviar caminhão"
        : viagensPendentes > 0
          ? `Em rota · +${viagensPendentes} na fila`
          : "Em rota · clique para agendar outra";
    }
  }
}


// ---------- Legenda interativa ----------

const CORES_FAIXA = {
  vazia: "#3988dc",
  normal: "#31965a",
  atencao: "#e6a626",
  cheia: "#e34d4d"
};

function faixa(nivel) {
  if (nivel >= 80) return "cheia";
  if (nivel >= 50) return "atencao";
  if (nivel >= 20) return "normal";

  return "vazia";
}

function atualizarLegenda() {
  const legenda = $("legenda");

  if (!legenda) return;

  const nivel = lixeiras.length
    ? Math.max(
        ...lixeiras.map(l => limitarNivel(l.nivel))
      )
    : null;

  const atual = nivel === null
    ? null
    : faixa(nivel);

  legenda.querySelectorAll(".legend-item").forEach(item => {
    item.classList.toggle(
      "ativa",
      item.dataset.faixa === atual
    );
  });

  legenda.dataset.faixa = atual || "";

  const barra = $("legenda-barra");

  if (barra) {

    barra.style.width = `${nivel ?? 0}%`;

    barra.style.background = atual
      ? CORES_FAIXA[atual]
      : "transparent";
  }

  const valor = $("legenda-valor");

  if (valor) {

    valor.textContent =
      nivel === null ? "--%" : `${nivel}%`;

    valor.style.color =
      atual ? CORES_FAIXA[atual] : "";
  }
}


// ---------- Comunicação com o servidor Python ----------

async function api(url, metodo = "GET", corpo) {

  const resposta = await fetch(url, {

    method: metodo,

    headers: {
      "Content-Type": "application/json"
    },

    body: corpo === undefined
      ? undefined
      : JSON.stringify(corpo)
  });

  if (!resposta.ok) {

    throw new Error(
      `Erro HTTP ${resposta.status} em ${url}`
    );
  }

  return resposta.json();
}


// Se já houver uma consulta em andamento, espera ela terminar.
let consultaAtual = null;
let consultarDeNovo = false;

function carregar() {

  if (consultaAtual) {

    consultarDeNovo = true;

    return consultaAtual;
  }

  consultaAtual = (async () => {

    do {

      consultarDeNovo = false;

      await consultarServidor();

    } while (consultarDeNovo);

  })().finally(() => {

    consultaAtual = null;
  });

  return consultaAtual;
}


async function consultarServidor() {
  carregando = true;

  try {

    const enviadoEm = Date.now();

    const dados = await api("/api/mapa");

    acertarRelogio(
      dados.agora_ms,
      enviadoEm,
      Date.now()
    );

    lixeiras = Array.isArray(dados.lixeiras)
      ? dados.lixeiras
      : [];

    BASE = dados.base || BASE;

    sincronizarPontos(dados.pontos_selecionados);

    configurarSala(dados.sala || {});

    offline = false;

    atualizarTudo();

    atualizarChaveSensor(dados.esp32);

    sincronizarViagem(
      dados.viagem,
      dados.viagens_pendentes,
      dados.agora_ms,
      dados.caminhao
    );

    verificarSensores();

    // Só despacha a fila quando o caminhão está na base.
    if (
      !dados.viagem &&
      dados.viagens_pendentes > 0 &&
      dados.caminhao?.estado === "base"
    ) {

      despacharDaFila();
    }

  } catch (erro) {

    if (!offline) {

      log(
        "Servidor Python desconectado. Execute: python servidor/app.py"
      );
    }

    offline = true;

    console.error(
      "Falha ao carregar o mapa:",
      erro
    );

  } finally {

    carregando = false;
  }
}


function configurarSala(sala) {

  if (sala.largura && sala.altura && $("mapa")) {

    $("mapa").setAttribute(
      "viewBox",
      `0 0 ${sala.largura} ${sala.altura}`
    );
  }

  if (sala.largura && $("sala")) {

    $("sala").setAttribute(
      "width",
      sala.largura - 8
    );
  }

  if (sala.altura && $("sala")) {

    $("sala").setAttribute(
      "height",
      sala.altura - 8
    );
  }

  if ($("porta")) {
    $("porta").setAttribute("y", BASE.y - 25);
  }

  if ($("rotulo-base")) {

    $("rotulo-base").setAttribute(
      "y",
      BASE.y - 32
    );
  }

  if (!truck.iniciado) {

    truck.x = BASE.x;
    truck.y = BASE.y;

    truck.iniciado = true;

    if ($("caminhao")) {

      $("caminhao").setAttribute(
        "transform",
        `translate(${BASE.x},${BASE.y}) scale(-1,1)`
      );
    }
  }
}


// ---------- Simulação de enchimento ----------

let simulando = false;

async function encherUma() {

  const botoes = [
    $("btn-simular"),
    $("dock-simular")
  ];

  if (simulando) return;

  simulando = true;

  botoes.forEach(b => botaoOcupado(b, true));

  try {

    if (!lixeiras.length) {

      log("Marque pelo menos um ponto para simular lixo.");

      botoes.forEach(sacudir);

      return;
    }

    const resposta = await api(
      "/api/simular",
      "POST"
    );

    const simuladas = Array.isArray(resposta)
      ? resposta
      : [resposta];

    await carregar();

    log(
      "Lixo simulado: " +
      simuladas.map(
        l => `P${l.ponto} ${limitarNivel(l.nivel)}%`
      ).join(", ") +
      "."
    );

    if ($("auto")?.checked) {
      despachar(undefined, true);
    }

  } catch (erro) {

    log("Não foi possível simular o enchimento.");

    console.error(erro);

  } finally {

    simulando = false;

    botoes.forEach(b => botaoOcupado(b, false));
  }
}


// Atualiza avisos, mapa, indicadores, fila e painel.
function atualizarTudo() {

  lixeiras.forEach(lixeira => {

    const cheia =
      status(limitarNivel(lixeira.nivel)) === "cheia";

    if (cheia && !jaAvisou[lixeira.id]) {

      log(`${lixeira.nome} precisa de coleta.`);

      jaAvisou[lixeira.id] = true;

    } else if (!cheia) {

      jaAvisou[lixeira.id] = false;
    }
  });

  desenharMapa();

  atualizarLegenda();

  desenharDock();

  atualizarDashboard();

  desenharFila();

  desenharPainel();
}


// ---------- Inicialização e atualização automática ----------

carregar();

setInterval(async () => {

  await carregar();

  if ($("auto")?.checked) {
    despachar(undefined, true);
  }

}, 1000);

console.log(
  "Lixeira Inteligente: JavaScript carregado."
);


// ---------- Seleção dos pontos com lixeira ----------

const seletorPontos = $("seletor-pontos");

let enviandoPontos = false;

function caixasPontos() {

  return seletorPontos
    ? [...seletorPontos.querySelectorAll('input[type="checkbox"]')]
    : [];
}

function pontosMarcados() {

  return caixasPontos()
    .filter(c => c.checked)
    .map(c => Number(c.value));
}

function atualizarResumoPontos() {

  desenharDock();

  const caixas = caixasPontos();

  seletorPontos?.querySelector(".pontos-todos")?.setAttribute(
    "aria-pressed",
    caixas.length && caixas.every(c => c.checked)
      ? "true"
      : "false"
  );

  const resumo = $("pontos-resumo");

  if (!resumo) return;

  const marcados = pontosMarcados();

  resumo.textContent = !marcados.length
    ? "Escolha um ou mais"
    : marcados.length === 1
      ? "1 ponto selecionado"
      : `${marcados.length} pontos · 1 viagem`;
}


// Deixa as caixas iguais ao que está salvo no servidor.
function sincronizarPontos(pontos) {

  if (enviandoPontos || !Array.isArray(pontos)) return;

  caixasPontos().forEach(caixa => {

    caixa.checked = pontos.includes(
      Number(caixa.value)
    );
  });

  atualizarResumoPontos();
}


async function enviarPontos() {

  const pontos = pontosMarcados();

  atualizarResumoPontos();

  enviandoPontos = true;

  try {

    await api(
      "/api/ponto",
      "POST",
      { pontos }
    );

    enviandoPontos = false;

    await carregar();

    log(
      pontos.length
        ? `Lixeiras nos pontos: ${pontos.join(", ")}.`
        : "Nenhuma lixeira posicionada."
    );

  } catch (erro) {

    console.error(
      "Erro ao mudar os pontos:",
      erro
    );

    log(
      truck.ocupado
        ? "Aguarde o caminhão voltar para mudar os pontos."
        : "Não foi possível mudar os pontos das lixeiras."
    );

    enviandoPontos = false;

    carregar();

  } finally {

    enviandoPontos = false;
  }
}


if (seletorPontos) {

  seletorPontos.addEventListener(
    "change",
    enviarPontos
  );

  seletorPontos.addEventListener("click", evento => {

    const acao = evento.target
      .closest("[data-acao]")
      ?.dataset.acao;

    if (!acao) return;

    const caixas = caixasPontos();

    const marcar = acao === "alternar"
      ? !caixas.every(c => c.checked)
      : acao === "todos";

    caixas.forEach(caixa => {
      caixa.checked = marcar;
    });

    enviarPontos();
  });
}


// ---------- Painel rápido junto ao mapa ----------

function desenharDock() {

  const sensores = $("dock-sensores");

  if (sensores) {

    let html = `
      <span class="sensor-vazio">
        Marque um ponto abaixo
      </span>
    `;

    if (lixeiras.length) {

      const soma = lixeiras.reduce(
        (s, l) => s + limitarNivel(l.nivel),
        0
      );

      const media = Math.round(
        soma / lixeiras.length
      );

      const pedacos = lixeiras.map(l => {

        const nivel = limitarNivel(l.nivel);

        return `
          <div class="seg f-${faixa(nivel)}"
               title="${l.nome}: ${nivel}%">
            <span style="width:${nivel}%"></span>
          </div>
        `;
      }).join("");

      const rotulos = lixeiras.map(l => {

        return `
          <span>
            ${l.sensor_online ? "📡 " : ""}
            P${l.ponto} · ${limitarNivel(l.nivel)}%
          </span>
        `;
      }).join("");

      html = `
        <div class="sensor-total f-${faixa(media)}"
             title="Ocupação geral: ${media}% (soma ${soma}% de ${lixeiras.length * 100}%)">

          <div class="sensor-total-linha">
            <div class="barra-segmentos">
              ${pedacos}
            </div>

            <em class="sensor-total-valor">
              ${media}%
            </em>
          </div>

          <div class="seg-rotulos">
            ${rotulos}
          </div>

        </div>
      `;
    }

    if (sensores._html !== html) {

      sensores._html = html;

      sensores.innerHTML = html;
    }
  }

  const marcados = typeof pontosMarcados === "function"
    ? pontosMarcados()
    : [];

  $("dock-pontos")?.querySelectorAll("button").forEach(b => {

    b.setAttribute(
      "aria-pressed",
      marcados.includes(Number(b.dataset.ponto))
        ? "true"
        : "false"
    );
  });

  const auto = $("dock-auto");

  if (auto) {

    auto.setAttribute(
      "aria-pressed",
      $("auto")?.checked ? "true" : "false"
    );
  }
}


// P1..P5 do painel do mapa marcam as mesmas caixas.
$("dock-pontos")?.addEventListener("click", evento => {

  const botao = evento.target.closest(
    "button[data-ponto]"
  );

  if (!botao || botao.disabled) return;

  const caixa = caixasPontos().find(
    c => c.value === botao.dataset.ponto
  );

  if (!caixa) return;

  caixa.checked = !caixa.checked;

  enviarPontos();
});


// Botão Auto do painel do mapa.
$("dock-auto")?.addEventListener("click", () => {

  const auto = $("auto");

  if (!auto) return;

  auto.checked = !auto.checked;

  auto.dispatchEvent(
    new Event("change", { bubbles: true })
  );
});


$("auto")?.addEventListener("change", () => {

  desenharDock();

  log(
    $("auto").checked
      ? "Despacho automático ligado."
      : "Despacho automático desligado."
  );
});


// ---------- Tela cheia do mapa ----------

const painelMapa = document.querySelector(".map-panel");

const botaoTelaCheia = $("btn-tela-cheia");


function definirTelaCheia(ativo) {

  if (!painelMapa) return;

  painelMapa.classList.toggle(
    "tela-cheia",
    ativo
  );

  document.body.classList.toggle(
    "sem-rolagem",
    ativo
  );

  if (botaoTelaCheia) {

    botaoTelaCheia.setAttribute(
      "aria-label",
      ativo
        ? "Sair da tela cheia"
        : "Abrir mapa em tela cheia"
    );

    botaoTelaCheia.title = ativo
      ? "Sair da tela cheia (Esc)"
      : "Tela cheia";
  }

  const elementoCheio =
    document.fullscreenElement ||
    document.webkitFullscreenElement;

  if (ativo && !elementoCheio) {

    const pedir =
      painelMapa.requestFullscreen ||
      painelMapa.webkitRequestFullscreen;

    if (pedir) {
      Promise.resolve(
        pedir.call(painelMapa)
      ).catch(() => {});
    }

  } else if (!ativo && elementoCheio) {

    const sair =
      document.exitFullscreen ||
      document.webkitExitFullscreen;

    if (sair) {
      Promise.resolve(
        sair.call(document)
      ).catch(() => {});
    }
  }
}


botaoTelaCheia?.addEventListener("click", () => {

  definirTelaCheia(
    !painelMapa.classList.contains("tela-cheia")
  );
});


["fullscreenchange", "webkitfullscreenchange"].forEach(evento => {

  document.addEventListener(evento, () => {

    const elementoCheio =
      document.fullscreenElement ||
      document.webkitFullscreenElement;

    if (
      !elementoCheio &&
      painelMapa?.classList.contains("tela-cheia")
    ) {

      definirTelaCheia(false);
    }
  });
});


document.addEventListener("keydown", evento => {

  if (
    evento.key === "Escape" &&
    painelMapa?.classList.contains("tela-cheia")
  ) {

    definirTelaCheia(false);
  }
});


// ---------- App instalável (PWA) ----------

if (
  "serviceWorker" in navigator &&
  window.isSecureContext
) {

  window.addEventListener("load", () => {

    navigator.serviceWorker
      .register("/sw.js")
      .catch(erro => {

        console.warn(
          "Service worker não registrado:",
          erro
        );
      });
  });
}


// ---------- Tutorial "Instalar o app" ----------

(() => {

  const botao = $("btn-instalar");

  const janela = $("tutorial-instalar");

  const instalarAgora = $("btn-instalar-agora");

  if (!botao || !janela) return;

  const jaInstalado = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (jaInstalado()) {

    botao.hidden = true;

    return;
  }

  const ehIphone =
    /iphone|ipad|ipod/i.test(navigator.userAgent);


  function mostrarAba(aba) {

    janela.querySelectorAll("[data-aba]").forEach(b => {

      b.setAttribute(
        "aria-selected",
        b.dataset.aba === aba ? "true" : "false"
      );
    });

    janela.querySelectorAll("[data-painel]").forEach(p => {

      p.hidden = p.dataset.painel !== aba;
    });
  }


  botao.addEventListener("click", () => {

    mostrarAba(
      ehIphone ? "iphone" : "android"
    );

    if (typeof janela.showModal === "function") {

      janela.showModal();

    } else {

      janela.setAttribute("open", "");
    }
  });


  janela.addEventListener("click", evento => {

    const aba = evento.target.closest("[data-aba]");

    if (aba) {
      mostrarAba(aba.dataset.aba);
    }

    if (
      evento.target.closest("[data-fechar]") ||
      evento.target === janela
    ) {

      janela.close?.();

      janela.removeAttribute("open");
    }
  });


  let pedidoInstalacao = null;

  window.addEventListener(
    "beforeinstallprompt",
    evento => {

      evento.preventDefault();

      pedidoInstalacao = evento;

      if (instalarAgora) {
        instalarAgora.hidden = false;
      }
    }
  );


  instalarAgora?.addEventListener(
    "click",
    async () => {

      if (!pedidoInstalacao) return;

      pedidoInstalacao.prompt();

      const { outcome } =
        await pedidoInstalacao.userChoice;

      pedidoInstalacao = null;

      instalarAgora.hidden = true;

      if (outcome === "accepted") {

        janela.close?.();

        log(
          "App instalado! Procure o ícone “Lixeiras” na tela inicial."
        );
      }
    }
  );


  window.addEventListener("appinstalled", () => {

    botao.hidden = true;
  });

})();


// ---------- Sensor físico (ESP32) ----------

const coletasVistas = {};

const sensorEstavaOnline = {};

let primeiraLeituraSensores = true;


function verificarSensores() {

  lixeiras.forEach(l => {

    if (!l.sensor) return;

    const id = l.id;

    const coletas = Number(l.coletas_sensor) || 0;

    const online = Boolean(l.sensor_online);

    if (
      !primeiraLeituraSensores &&
      esp32Info?.ativo &&
      sensorEstavaOnline[id] !== undefined &&
      sensorEstavaOnline[id] !== online
    ) {

      log(
        online
          ? `📡 Sensor da lixeira P${l.ponto} conectado.`
          : `⚠️ Sensor da lixeira P${l.ponto} sem sinal.`
      );
    }

    sensorEstavaOnline[id] = online;

    if (coletasVistas[id] === undefined) {

      coletasVistas[id] = coletas;

    } else if (coletas > coletasVistas[id]) {

      coletasVistas[id] = coletas;

      if (Number(id) === idFisica()) {

        log(
          `🧹 P${idFisica()} foi esvaziada pelo sensor. ` +
          "O caminhão está retornando à base."
        );

      } else {

        log(
          `🧹 Lixeira P${l.ponto} foi esvaziada (sensor).`
        );
      }
    }
  });

  primeiraLeituraSensores = false;
}


// ---------- Chave "Sensor ESP32" ----------

let esp32Info = null;

let enviandoSensor = false;


function textoTempo(segundos) {

  if (segundos < 60) {
    return `${segundos}s`;
  }

  if (segundos < 3600) {
    return `${Math.floor(segundos / 60)} min`;
  }

  return `${Math.floor(segundos / 3600)} h`;
}


function atualizarChaveSensor(info) {

  if (info) {
    esp32Info = info;
  }

  const e = esp32Info;

  if (!e) return;

  let estado, texto, curto;

  if (!e.ativo) {

    estado = "desligado";

    texto = e.online
      ? `Desligado · ESP32 enviando dados (P${e.ponto})`
      : "Desligado";

    curto = "ESP32";

  } else if (e.online) {

    estado = "conectado";

    texto = `Conectado · P${e.ponto} · ${e.nivel}%`;

    curto = "Online";

  } else if (e.segundos == null) {

    estado = "aguardando";

    texto = "Ligado · aguardando o ESP32…";

    curto = "Aguard.";

  } else {

    estado = "sem-sinal";

    texto = `Ligado · sem sinal há ${textoTempo(e.segundos)}`;

    curto = "Sem sinal";
  }

  const card = $("sensor-card");

  const chave = $("sensor-esp32");

  const statusElemento = $("sensor-status");

  const dock = $("dock-esp32");

  if (card) {
    card.dataset.estado = estado;
  }

  if (statusElemento) {
    statusElemento.textContent = texto;
  }

  if (chave && !enviandoSensor) {
    chave.checked = e.ativo;
  }

  if (dock) {

    dock.dataset.estado = estado;

    dock.setAttribute(
      "aria-pressed",
      e.ativo ? "true" : "false"
    );

    dock.title = `Sensor ESP32: ${texto}`;

    $("dock-esp32-texto").textContent = curto;
  }
}


async function definirSensor(ativo) {

  if (enviandoSensor) return;

  enviandoSensor = true;

  atualizarChaveSensor({
    ...(esp32Info || {}),
    ativo,
    segundos: esp32Info?.segundos ?? null
  });

  try {

    const info = await api(
      "/api/sensor",
      "POST",
      { ativo }
    );

    enviandoSensor = false;

    atualizarChaveSensor(info);

    log(
      ativo
        ? (
            info.online
              ? "📡 Sensor ESP32 ligado e conectado."
              : "📡 Sensor ESP32 ligado. Aguardando o ESP32…"
          )
        : "Sensor ESP32 desligado. As lixeiras voltam para a simulação."
    );

    await carregar();

  } catch (erro) {

    console.error(
      "Erro ao ligar/desligar o sensor:",
      erro
    );

    log(
      "Não foi possível mudar o sensor ESP32. Confira a conexão com o servidor."
    );

    if ($("sensor-esp32")) {
      $("sensor-esp32").checked = !ativo;
    }

  } finally {

    enviandoSensor = false;

    atualizarChaveSensor();
  }
}


$("sensor-esp32")?.addEventListener(
  "change",
  evento => {
    definirSensor(evento.target.checked);
  }
);


$("dock-esp32")?.addEventListener("click", () => {

  definirSensor(
    !(esp32Info && esp32Info.ativo)
  );
});


// ---------- Sem zoom acidental no celular ----------

(function bloquearZoomCelular() {

  ["gesturestart", "gesturechange", "gestureend"].forEach(evento => {

    document.addEventListener(
      evento,
      e => e.preventDefault(),
      { passive: false }
    );
  });


  document.addEventListener(
    "touchmove",
    e => {

      if (e.touches.length > 1) {
        e.preventDefault();
      }
    },
    { passive: false }
  );


  let ultimoToque = 0;

  document.addEventListener(
    "touchend",
    e => {

      const agora = Date.now();

      if (
        agora - ultimoToque < 350 &&
        e.changedTouches.length === 1
      ) {

        e.preventDefault();

        e.target.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window
          })
        );
      }

      ultimoToque = agora;

    },
    { passive: false }
  );

})();