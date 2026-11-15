


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

 // Estima quanto falta para chegar a 100%, usando o histórico simulado.
 function previsao(lixeira) {
   const historico = Array.isArray(lixeira.historico)
     ? lixeira.historico
     : [];

   const aumentos = [];

   for (let i = 1; i < historico.length; i++) {
     const diferenca = historico[i] - historico[i - 1];
     if (diferenca > 0) aumentos.push(diferenca);
   }

   if (lixeira.nivel >= 100) return "cheia agora";
   if (!aumentos.length) return "—";

   const media = aumentos.reduce((soma, valor) => soma + valor, 0)
     / aumentos.length;

   return `~${Math.ceil((100 - lixeira.nivel) / media)} min (simulado)`;
 }

 // ---------- Mapa e ícones ----------

function desenharMapa() {
  const camada = $("camada-lixeiras");

  if (!camada) return;

  const html = lixeiras.map(lixeira => {
    const nivel = limitarNivel(lixeira.nivel);
    const estado = status(nivel);

    const classeSelecionada =
      lixeira.id === selecionada ? "selecionada" : "";

    const nome = String(
      lixeira.nome || `Lixeira ${lixeira.id}`
    );

    return `
      <g
        class="lixeira ${estado} ${classeSelecionada}"
        role="button"
        tabindex="0"
        aria-label="${nome}: ${nivel}%"
        onclick="abrirLixeira(${Number(lixeira.id)})"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();abrirLixeira(${Number(lixeira.id)})}"
      >

        <!-- Círculo branco atrás da lixeira -->
        <circle
          cx="${lixeira.x}"
          cy="${lixeira.y}"
          r="20"
          fill="#ffffff"
          stroke="#ffffff"
          stroke-width="3"
        ></circle>

        <!-- Ícone preto, ampliado -->
        <image
          class="icone-lixeira"
          href="images/lixeira.svg"
          x="${lixeira.x - 22}"
          y="${lixeira.y - 22}"
          width="44"
          height="44"
          preserveAspectRatio="xMidYMid meet"
        ></image>

      </g>
    `;
  }).join("");

  // Só redesenha se algo mudou (evita perder cliques).
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

   // Só redesenha se algo mudou (evita perder cliques).
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

   const botaoColeta = estado === "cheia"
     ? `<div class="alerta">Coleta necessária!</div>
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


function mover(x, y) {
  return new Promise(resolve => {
    const inicioX = truck.x;
    const inicioY = truck.y;

    const distancia = Math.hypot(
      x - inicioX,
      y - inicioY
    );

    if (distancia < 0.001) {
      resolve();
      return;
    }

    const duracao = distancia * 9 + 100;
    const inicioTempo = performance.now();

    const angulo = Math.atan2(
      -(y - inicioY),
      x - inicioX
    );

    truck.angulo = angulo;

    const direcao = x >= inicioX ? -1 : 1;

    function animar(tempoAtual) {
      const progresso = Math.min(
        1,
        (tempoAtual - inicioTempo) / duracao
      );

      truck.x = inicioX + (x - inicioX) * progresso;
      truck.y = inicioY + (y - inicioY) * progresso;

      const caminhao = $("caminhao");

      if (caminhao) {
        caminhao.setAttribute(
          "transform",
          `translate(${truck.x},${truck.y}) scale(${direcao},1)`
        );
      }

      if (typeof window.moverCaminhao3D === "function") {
        window.moverCaminhao3D(truck.x, truck.y, angulo);
      }

      if (progresso < 1) {
        requestAnimationFrame(animar);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(animar);
  });
}


// Gira o caminhão parado até o ângulo indicado (0 = virado para a direita).
function girar(alvo) {
  return new Promise(resolve => {
    const inicio = truck.angulo || 0;

    // Gira pelo menor caminho.
    let delta = alvo - inicio;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));

    if (Math.abs(delta) < 0.001) {
      truck.angulo = alvo;
      resolve();
      return;
    }

    const duracao = 500;
    const inicioTempo = performance.now();

    function animar(tempoAtual) {
      const progresso = Math.min(1, (tempoAtual - inicioTempo) / duracao);
      truck.angulo = inicio + delta * progresso;

      if (typeof window.moverCaminhao3D === "function") {
        window.moverCaminhao3D(truck.x, truck.y, truck.angulo);
      }

      if (progresso < 1) {
        requestAnimationFrame(animar);
      } else {
        truck.angulo = alvo;

        // Caminhão provisório (2D) também fica virado para a direita.
        $("caminhao")?.setAttribute(
          "transform",
          `translate(${truck.x},${truck.y}) scale(${Math.cos(alvo) >= 0 ? -1 : 1},1)`
        );
        resolve();
      }
    }

    requestAnimationFrame(animar);
  });
}

// Move o caminhão por vários pontos da rua.
async function moverPelaRota(pontos) {
  for (const ponto of pontos) {
    await mover(ponto.x, ponto.y);
  }
}

// ---------- Rede de ruas e rotas ----------
// Todas as coordenadas seguem o meio das pistas (linha tracejada do desenho).

// Trecho fixo da base até o cruzamento principal (J1):
// Rua da base (y=77) → curva (x=289) → Rua 1 (y=142) → avenida vertical (x=407).
function trechoBase() {
  return [
    { x: BASE.x, y: 77 },
    { x: 272,    y: 77 },
    { x: 285,    y: 82 },
    { x: 289,    y: 95 },
    { x: 289,    y: 125 },
    { x: 293,    y: 137 },
    { x: 305,    y: 142 },
    { x: 407,    y: 142 }
  ];
}

// As ruas formam uma "árvore" a partir de J1. Cada nó sabe quem é o pai.
// J = cruzamento, P = ponto de lixeira.
const NOS = {
  J1: { x: 407, y: 142, pai: null },
  P1: { x: 740, y: 142, pai: "J1" },  // Rua 1, lado direito
  J2: { x: 407, y: 321, pai: "J1" },  // cruzamento da Rua 2
  P2: { x: 59,  y: 321, pai: "J2" },  // Rua 2, esquerda
  P3: { x: 407, y: 321, pai: "J2" },  // no próprio cruzamento
  P4: { x: 750, y: 321, pai: "J2" },  // Rua 2, direita
  J3: { x: 407, y: 489, pai: "J2" },  // cruzamento da Rua 3
  P5: { x: 59,  y: 489, pai: "J3" }   // Rua 3, esquerda
};

// Ordem de visita que percorre a árvore sem ir e voltar à toa.
const ORDEM_VISITA = [1, 2, 3, 4, 5];

function ancestrais(no) {
  const lista = [];
  while (no) {
    lista.push(no);
    no = NOS[no].pai;
  }
  return lista;
}

// Caminho pelas ruas entre dois nós (sobe até o cruzamento comum e desce).
function caminhoEntre(origem, destino) {
  const subida = ancestrais(origem);
  const descida = ancestrais(destino);
  const comum = subida.find(no => descida.includes(no));

  const nos = [
    ...subida.slice(0, subida.indexOf(comum) + 1),
    ...descida.slice(0, descida.indexOf(comum)).reverse()
  ];

  return nos.map(no => ({ x: NOS[no].x, y: NOS[no].y }));
}

// Remove pontos repetidos seguidos (ex.: P3 fica em cima de J2).
function semRepetidos(pontos) {
  return pontos.filter((p, i) =>
    i === 0 || p.x !== pontos[i - 1].x || p.y !== pontos[i - 1].y
  );
}

// Monta a viagem completa: base → cada parada em ordem → base.
function planejarViagem(alvos) {
  const paradas = alvos
    .filter(l => NOS[`P${Number(l.ponto)}`])
    .sort((a, b) =>
      ORDEM_VISITA.indexOf(Number(a.ponto)) - ORDEM_VISITA.indexOf(Number(b.ponto))
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

  return { paradas, trechos, volta };
}

// Desenha a linha azul da posição atual do caminhão até a última parada.
function desenharRotaRestante(trechos) {
  const linha = $("rota");
  if (!linha) return;

  const pontos = semRepetidos([
    { x: truck.x, y: truck.y },
    ...trechos.flatMap(t => t.trecho)
  ]);

  linha.setAttribute(
    "points",
    trechos.length ? pontos.map(p => `${p.x},${p.y}`).join(" ") : ""
  );
}

// automatico = true quando chamado pelo despacho automático
// (não repete avisos no histórico a cada 2 segundos).
// Viagens pedidas enquanto o caminhão estava em rota.
let viagensPendentes = 0;

async function despachar(ids, automatico = false) {
  if (truck.ocupado) {
    if (!automatico) {
      // Guarda o pedido: o caminhão sai de novo assim que voltar.
      viagensPendentes++;
      log(`Nova coleta agendada (${viagensPendentes} na fila). O caminhão sai assim que voltar.`);
      atualizarBotoes();
    }
    return;
  }

  // Manual: vai em todas as lixeiras posicionadas, com qualquer nível.
  // Automático: só nas que chegaram a 80%.
  const alvos = lixeiras.filter(lixeira =>
    ids
      ? ids.includes(lixeira.id)
      : automatico
        ? limitarNivel(lixeira.nivel) >= 80
        : true
  );

  const { paradas, trechos, volta } = planejarViagem(alvos);

  if (!paradas.length) {
    if (!automatico) {
      log("Nenhuma lixeira posicionada. Marque um ou mais pontos.");
      sacudir($("btn-despachar"));
    }
    return;
  }

  truck.ocupado = true;
  atualizarBotoes();

  try {
    log(
      paradas.length === 1
        ? `Caminhão a caminho de ${paradas[0].nome}.`
        : `Caminhão saiu para ${paradas.length} coletas: ` +
          paradas.map(l => `Ponto ${l.ponto}`).join(" → ") + "."
    );

    // Base → cruzamento principal.
    const saida = trechoBase();
    desenharRotaRestante([{ trecho: saida }, ...trechos]);
    await moverPelaRota(saida);

    // Uma parada de cada vez, coletando em cada ponto.
    for (let i = 0; i < trechos.length; i++) {
      const { lixeira, trecho } = trechos[i];

      desenharRotaRestante(trechos.slice(i));
      await moverPelaRota(trecho);

      await api(`/api/coletar/${lixeira.id}`, "POST");
      await carregar();

      log(`${lixeira.nome} coletada (${i + 1}/${trechos.length}).`);
    }

    // Volta para a base pelas ruas.
    desenharRotaRestante([]);
    await moverPelaRota(volta);

    // Na base, vira o caminhão de frente para a rua (direita),
    // pronto para sair andando em linha reta.
    await girar(0);

    log("Caminhão voltou para a base.");
  } catch (erro) {
    log("Não foi possível concluir a coleta. Confira a conexão com o servidor.");
    console.error("Erro durante a coleta:", erro);
  } finally {
    desenharRotaRestante([]);
    truck.ocupado = false;
    atualizarTudo();
    atualizarBotoes();

    // Se pediram mais coletas durante a rota, sai de novo.
    if (viagensPendentes > 0) {
      viagensPendentes--;
      despachar();
    }
  }
}

// ---------- Botões ----------

// Mostra o estado de "carregando" num botão e impede cliques repetidos.
function botaoOcupado(botao, ocupado) {
  if (!botao) return;
  botao.classList.toggle("carregando", ocupado);
  botao.disabled = ocupado;
  botao.setAttribute("aria-busy", ocupado ? "true" : "false");
}

// Pequena animação quando a ação não pode ser feita agora.
function sacudir(botao) {
  if (!botao) return;
  botao.classList.remove("sacudir");
  void botao.offsetWidth; // reinicia a animação
  botao.classList.add("sacudir");
}

// O botão Despachar mostra quando o caminhão está em rota.
function atualizarBotoes() {
  const botao = $("btn-despachar");
  const legenda = $("btn-despachar-sub");

  // Não deixa trocar os pontos com o caminhão no meio da viagem.
  const seletor = $("seletor-pontos");
  if (seletor) {
    seletor.disabled = truck.ocupado;
    seletor.title = truck.ocupado ? "Aguarde o caminhão voltar para mudar os pontos." : "";
  }

  // Painel do mapa (celular/tela cheia).
  const dockDespachar = $("dock-despachar");
  if (dockDespachar) {
    dockDespachar.classList.toggle("em-rota", truck.ocupado);
    $("dock-despachar-texto").textContent = truck.ocupado ? "Em rota" : "Despachar";

    const fila = $("dock-fila");
    fila.hidden = viagensPendentes === 0;
    fila.textContent = `+${viagensPendentes}`;
  }

  $("dock-pontos")?.querySelectorAll("button").forEach(b => {
    b.disabled = truck.ocupado;
  });

  if (!botao) return;

  botao.classList.toggle("em-rota", truck.ocupado);
  if (legenda) {
    legenda.textContent = !truck.ocupado
      ? "Enviar caminhão"
      : viagensPendentes > 0
        ? `Em rota · +${viagensPendentes} na fila`
        : "Em rota · clique para agendar outra";
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

  // Com várias lixeiras, a legenda mostra a mais cheia.
  const nivel = lixeiras.length
    ? Math.max(...lixeiras.map(l => limitarNivel(l.nivel)))
    : null;
  const atual = nivel === null ? null : faixa(nivel);

  legenda.querySelectorAll(".legend-item").forEach(item => {
    item.classList.toggle("ativa", item.dataset.faixa === atual);
  });

  legenda.dataset.faixa = atual || "";

  const barra = $("legenda-barra");
  if (barra) {
    barra.style.width = `${nivel ?? 0}%`;
    barra.style.background = atual ? CORES_FAIXA[atual] : "transparent";
  }

  const valor = $("legenda-valor");
  if (valor) {
    valor.textContent = nivel === null ? "--%" : `${nivel}%`;
    valor.style.color = atual ? CORES_FAIXA[atual] : "";
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

 // Se já houver uma consulta em andamento, espera ela terminar e
 // consulta de novo, para que um clique nunca seja "perdido".
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
     const dados = await api("/api/mapa");

     lixeiras = Array.isArray(dados.lixeiras)
       ? dados.lixeiras
       : [];

     BASE = dados.base || BASE;

     sincronizarPontos(dados.pontos_selecionados);

     configurarSala(dados.sala || {});

     offline = false;
     atualizarTudo();
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

 // Aciona a simulação de enchimento pelo Python.
 let simulando = false;

 async function encherUma() {
   // Botão do painel lateral e botão do painel do mapa (celular/tela cheia).
   const botoes = [$("btn-simular"), $("dock-simular")];
   if (simulando) return;

   simulando = true;
   botoes.forEach(b => botaoOcupado(b, true));

   try {
     if (!lixeiras.length) {
       log("Marque pelo menos um ponto para simular lixo.");
       botoes.forEach(sacudir);
       return;
     }

     const resposta = await api("/api/simular", "POST");
     const simuladas = Array.isArray(resposta) ? resposta : [resposta];
     await carregar();

     log(
       "Lixo simulado: " +
       simuladas.map(l => `P${l.ponto} ${limitarNivel(l.nivel)}%`).join(", ") +
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
 }, 2000);

 console.log(
   "Lixeira Inteligente: JavaScript carregado."
 );

 // ---------- Seleção dos pontos com lixeira (vários) ----------

const seletorPontos = $("seletor-pontos");
let enviandoPontos = false;

function caixasPontos() {
  return seletorPontos
    ? [...seletorPontos.querySelectorAll('input[type="checkbox"]')]
    : [];
}

function pontosMarcados() {
  return caixasPontos().filter(c => c.checked).map(c => Number(c.value));
}

function atualizarResumoPontos() {
  desenharDock();

  // Botão "Todos" fica destacado quando os 5 estão marcados.
  const caixas = caixasPontos();
  seletorPontos?.querySelector(".pontos-todos")?.setAttribute(
    "aria-pressed",
    caixas.length && caixas.every(c => c.checked) ? "true" : "false"
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
    caixa.checked = pontos.includes(Number(caixa.value));
  });
  atualizarResumoPontos();
}

async function enviarPontos() {
  const pontos = pontosMarcados();
  atualizarResumoPontos();
  enviandoPontos = true;

  try {
    await api("/api/ponto", "POST", { pontos });
    enviandoPontos = false;
    await carregar();

    log(
      pontos.length
        ? `Lixeiras nos pontos: ${pontos.join(", ")}.`
        : "Nenhuma lixeira posicionada."
    );
  } catch (erro) {
    console.error("Erro ao mudar os pontos:", erro);
    log("Não foi possível mudar os pontos das lixeiras.");
  } finally {
    enviandoPontos = false;
  }
}

if (seletorPontos) {
  seletorPontos.addEventListener("change", enviarPontos);

  seletorPontos.addEventListener("click", evento => {
    const acao = evento.target.closest("[data-acao]")?.dataset.acao;
    if (!acao) return;

    // "Todos": se já estão todos marcados, desmarca; senão, marca todos.
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

// ---------- Painel rápido junto ao mapa (celular e tela cheia) ----------

// Sensores (nível de cada lixeira), pontos marcados e botão Auto.
function desenharDock() {
  const sensores = $("dock-sensores");

  if (sensores) {
    // Uma barra só representando todas as lixeiras:
    // cada pedaço é uma lixeira, que enche e muda de cor pelo seu nível.
    let html = `<span class="sensor-vazio">Marque um ponto abaixo</span>`;

    if (lixeiras.length) {
      const soma = lixeiras.reduce((s, l) => s + limitarNivel(l.nivel), 0);
      const media = Math.round(soma / lixeiras.length);

      const pedacos = lixeiras.map(l => {
        const nivel = limitarNivel(l.nivel);
        return `
          <div class="seg f-${faixa(nivel)}" title="${l.nome}: ${nivel}%">
            <span style="width:${nivel}%"></span>
          </div>`;
      }).join("");

      const rotulos = lixeiras.map(l =>
        `<span>P${l.ponto} · ${limitarNivel(l.nivel)}%</span>`
      ).join("");

      html = `
        <div class="sensor-total f-${faixa(media)}" title="Ocupação geral: ${media}% (soma ${soma}% de ${lixeiras.length * 100}%)">
          <div class="sensor-total-linha">
            <div class="barra-segmentos">${pedacos}</div>
            <em class="sensor-total-valor">${media}%</em>
          </div>
          <div class="seg-rotulos">${rotulos}</div>
        </div>`;
    }

    if (sensores._html !== html) {
      sensores._html = html;
      sensores.innerHTML = html;
    }
  }

  const marcados = typeof pontosMarcados === "function" ? pontosMarcados() : [];
  $("dock-pontos")?.querySelectorAll("button").forEach(b => {
    b.setAttribute("aria-pressed", marcados.includes(Number(b.dataset.ponto)) ? "true" : "false");
  });

  const auto = $("dock-auto");
  if (auto) {
    auto.setAttribute("aria-pressed", $("auto")?.checked ? "true" : "false");
  }
}

// P1..P5 do painel do mapa marcam as mesmas caixas do painel lateral.
$("dock-pontos")?.addEventListener("click", evento => {
  const botao = evento.target.closest("button[data-ponto]");
  if (!botao || botao.disabled) return;

  const caixa = caixasPontos().find(c => c.value === botao.dataset.ponto);
  if (!caixa) return;

  caixa.checked = !caixa.checked;
  enviarPontos();
});

// Botão Auto do painel do mapa liga/desliga o mesmo "Despacho automático".
$("dock-auto")?.addEventListener("click", () => {
  const auto = $("auto");
  if (!auto) return;

  auto.checked = !auto.checked;
  auto.dispatchEvent(new Event("change", { bubbles: true }));
});

$("auto")?.addEventListener("change", () => {
  desenharDock();
  log($("auto").checked ? "Despacho automático ligado." : "Despacho automático desligado.");
});


// ---------- Tela cheia do mapa ----------

const painelMapa = document.querySelector(".map-panel");
const botaoTelaCheia = $("btn-tela-cheia");

function definirTelaCheia(ativo) {
  if (!painelMapa) return;

  painelMapa.classList.toggle("tela-cheia", ativo);
  document.body.classList.toggle("sem-rolagem", ativo);

  if (botaoTelaCheia) {
    botaoTelaCheia.setAttribute("aria-label", ativo ? "Sair da tela cheia" : "Abrir mapa em tela cheia");
    botaoTelaCheia.title = ativo ? "Sair da tela cheia (Esc)" : "Tela cheia";
  }

  // Tela cheia "de verdade" quando o navegador permite (desktop e Android).
  // No iPhone, que não permite, fica só o modo pela CSS (ocupa a tela toda igual).
  const elementoCheio = document.fullscreenElement || document.webkitFullscreenElement;

  if (ativo && !elementoCheio) {
    const pedir = painelMapa.requestFullscreen || painelMapa.webkitRequestFullscreen;
    if (pedir) {
      Promise.resolve(pedir.call(painelMapa)).catch(() => {});
    }
  } else if (!ativo && elementoCheio) {
    const sair = document.exitFullscreen || document.webkitExitFullscreen;
    if (sair) {
      Promise.resolve(sair.call(document)).catch(() => {});
    }
  }
}

botaoTelaCheia?.addEventListener("click", () => {
  definirTelaCheia(!painelMapa.classList.contains("tela-cheia"));
});

// Se o usuário sair pelo Esc do navegador, volta ao layout normal.
["fullscreenchange", "webkitfullscreenchange"].forEach(evento => {
  document.addEventListener(evento, () => {
    const elementoCheio = document.fullscreenElement || document.webkitFullscreenElement;
    if (!elementoCheio && painelMapa?.classList.contains("tela-cheia")) {
      definirTelaCheia(false);
    }
  });
});

document.addEventListener("keydown", evento => {
  if (evento.key === "Escape" && painelMapa?.classList.contains("tela-cheia")) {
    definirTelaCheia(false);
  }
});


// ---------- App instalável (PWA) ----------
// Registra o service worker para o site poder ser instalado no celular
// (só funciona em https ou em localhost; nos outros casos é ignorado).
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(erro => {
      console.warn("Service worker não registrado:", erro);
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

  // Quem já está usando o app instalado não precisa do botão.
  if (jaInstalado()) {
    botao.hidden = true;
    return;
  }

  // Abre já na aba do aparelho da pessoa.
  const ehIphone = /iphone|ipad|ipod/i.test(navigator.userAgent);

  function mostrarAba(aba) {
    janela.querySelectorAll("[data-aba]").forEach(b => {
      b.setAttribute("aria-selected", b.dataset.aba === aba ? "true" : "false");
    });
    janela.querySelectorAll("[data-painel]").forEach(p => {
      p.hidden = p.dataset.painel !== aba;
    });
  }

  botao.addEventListener("click", () => {
    mostrarAba(ehIphone ? "iphone" : "android");
    if (typeof janela.showModal === "function") {
      janela.showModal();
    } else {
      janela.setAttribute("open", "");
    }
  });

  janela.addEventListener("click", evento => {
    const aba = evento.target.closest("[data-aba]");
    if (aba) mostrarAba(aba.dataset.aba);

    // Fecha no X ou tocando fora da caixa.
    if (evento.target.closest("[data-fechar]") || evento.target === janela) {
      janela.close?.();
      janela.removeAttribute("open");
    }
  });

  // Android/Chrome: guarda o pedido de instalação para o botão "Instalar agora".
  let pedidoInstalacao = null;

  window.addEventListener("beforeinstallprompt", evento => {
    evento.preventDefault();
    pedidoInstalacao = evento;
    if (instalarAgora) instalarAgora.hidden = false;
  });

  instalarAgora?.addEventListener("click", async () => {
    if (!pedidoInstalacao) return;
    pedidoInstalacao.prompt();
    const { outcome } = await pedidoInstalacao.userChoice;
    pedidoInstalacao = null;
    instalarAgora.hidden = true;
    if (outcome === "accepted") {
      janela.close?.();
      log("App instalado! Procure o ícone “Lixeiras” na tela inicial.");
    }
  });

  window.addEventListener("appinstalled", () => {
    botao.hidden = true;
  });
})();
