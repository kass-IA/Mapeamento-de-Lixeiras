
import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js";

const TAMANHO_MAPA = 810;
const TAMANHO_CAMINHAO = 58;
const CORRECAO_ANGULO = Math.PI / 2;
// Versão leve (3 MB) gerada a partir de caminhao_verde.glb (67 MB).
const CAMINHO_MODELO = "images/caminhao_verde_leve.glb";

// Deita o modelo sobre o mapa.
const ROTACAO_MODELO_X = Math.PI / 2;

const mapa = document.getElementById("mapa");
const moldura = document.querySelector(".map-wrapper");

if (!mapa || !moldura) {
  console.error("Área do mapa não encontrada.");
} else {
  const cena = new THREE.Scene();

  const camera = new THREE.OrthographicCamera(
    -405, 405,
    405, -405,
    0.1, 1000
  );

  camera.position.set(405, 405, 500);
  camera.lookAt(405, 405, 0);
  camera.up.set(0, 1, 0);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true
  });

  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, 2)
  );

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.id = "caminhao-3d";

  Object.assign(renderer.domElement.style, {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "2"
  });

  moldura.style.position = "relative";
  moldura.appendChild(renderer.domElement);

  cena.add(new THREE.AmbientLight(0xffffff, 2));

  const luz = new THREE.DirectionalLight(0xffffff, 2.5);
  luz.position.set(100, 200, 300);
  cena.add(luz);

  // Controla a posição e a direção do caminhão.
  const pivo = new THREE.Group();
  cena.add(pivo);

  // Corrige a orientação original do modelo.
  const orientacao = new THREE.Group();
  orientacao.rotation.x = ROTACAO_MODELO_X;
  pivo.add(orientacao);

  let modelo = null;
  let posicao = { x: 110, y: 85 };
  let anguloAtual = 0;
  let renderPendente = false;

  function redimensionar() {
    const largura = moldura.clientWidth;
    const altura = moldura.clientHeight;

    if (!largura || !altura) return;

    renderer.setSize(largura, altura, false);

    const escala = Math.min(
      largura / TAMANHO_MAPA,
      altura / TAMANHO_MAPA
    );

    camera.left = -(largura / escala) / 2;
    camera.right = (largura / escala) / 2;
    camera.top = (altura / escala) / 2;
    camera.bottom = -(altura / escala) / 2;

    camera.updateProjectionMatrix();
    pedirRender();
  }

  const observador = new ResizeObserver(redimensionar);
  observador.observe(moldura);
  redimensionar();

  const loader = new GLTFLoader();

  loader.load(
    CAMINHO_MODELO,

    (resultado) => {
      modelo = resultado.scene;

      // Obtém o centro e as dimensões do modelo.
      const caixa = new THREE.Box3().setFromObject(modelo);
      const centro = caixa.getCenter(new THREE.Vector3());
      const tamanho = caixa.getSize(new THREE.Vector3());

      const maiorDimensao = Math.max(
        tamanho.x,
        tamanho.y,
        tamanho.z
      );

      if (!maiorDimensao) {
        console.error("Dimensões inválidas do caminhão.");
        modelo = null;
        return;
      }

      // Redimensiona sem deformar.
      const escalaModelo = TAMANHO_CAMINHAO / maiorDimensao;

      modelo.scale.setScalar(escalaModelo);

      // Centraliza o modelo antes da rotação.
      modelo.position.copy(centro)
        .multiplyScalar(-escalaModelo);

      modelo.traverse((objeto) => {
        if (objeto.isMesh) {
          objeto.frustumCulled = false;
        }
      });

      orientacao.add(modelo);

      atualizarPosicao(
        posicao.x,
        posicao.y,
        anguloAtual
      );

      console.log("Caminhão 3D carregado.");

      // Esconde o caminhão provisório (2D) agora que o 3D está pronto.
      document.body.classList.add("caminhao-3d-pronto");
    },

    (progresso) => {
      if (progresso.total) {
        const percentual = Math.round(
          (progresso.loaded / progresso.total) * 100
        );

        console.log(`Carregando caminhão: ${percentual}%`);
      }
    },

    (erro) => {
      console.error("Erro ao carregar o caminhão:", erro);
    }
  );

  function atualizarPosicao(x, y, angulo = anguloAtual) {
    posicao = { x, y };
    anguloAtual = angulo;

    // Converte as coordenadas do SVG para o mapa.
    pivo.position.set(
      x,
      TAMANHO_MAPA - y,
      1
    );

    pivo.rotation.z = anguloAtual + CORRECAO_ANGULO;

    pedirRender();
  }

  // API usada por script.js.
  window.moverCaminhao3D = atualizarPosicao;

  atualizarPosicao(
    posicao.x,
    posicao.y,
    0
  );

  // Desenha a cena só quando algo muda (caminhão andou/girou, tela mudou
  // de tamanho ou o modelo terminou de carregar). Antes desenhava 60x por
  // segundo o tempo todo, o que pesava o navegador mesmo com tudo parado.
  function pedirRender() {
    if (renderPendente) return;
    renderPendente = true;

    requestAnimationFrame(() => {
      renderPendente = false;
      renderer.render(cena, camera);
    });
  }

  pedirRender();
}
