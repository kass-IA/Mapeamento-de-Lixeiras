// Service worker do app "Lixeira Inteligente".
// - Permite instalar o site como app no celular.
// - Sempre tenta buscar a versão mais nova na rede; se estiver sem
//   internet, abre a última versão salva.
// - Os dados das lixeiras (/api/...) nunca são guardados: são sempre ao vivo.

const VERSAO = "lixeiras-v7";

const ARQUIVOS = [
  "/",
  "/css/style.css",
  "/Js/script.js",
  "/Js/caminhao3d.js",
  "/images/mapa_base.svg",
  "/images/lixeira.svg",
  "/images/parque-lixeira.png",
  "/images/caminhao_verde_leve.glb",
  "/images/app/icon-192.png",
  "/images/app/icon-512.png",
  "/manifest.json"
];

self.addEventListener("install", evento => {
  evento.waitUntil(
    caches.open(VERSAO)
      .then(cache => cache.addAll(ARQUIVOS))
      .catch(() => {}) // se algum arquivo falhar, o app funciona mesmo assim
  );
  self.skipWaiting();
});

self.addEventListener("activate", evento => {
  // Apaga versões antigas do cache.
  evento.waitUntil(
    caches.keys().then(chaves =>
      Promise.all(chaves.filter(c => c !== VERSAO).map(c => caches.delete(c)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", evento => {
  const pedido = evento.request;
  const url = new URL(pedido.url);

  // Só cuida de GET do próprio site; a API fica sempre ao vivo.
  if (
    pedido.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  // Rede primeiro; sem rede, usa o que estiver salvo.
  evento.respondWith(
    fetch(pedido)
      .then(resposta => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(VERSAO).then(cache => cache.put(pedido, copia));
        }
        return resposta;
      })
      .catch(() =>
        caches.match(pedido).then(salvo => salvo || caches.match("/"))
      )
  );
});
