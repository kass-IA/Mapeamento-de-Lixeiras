/*
  LIXEIRA INTELIGENTE - ESP32 + sensor ultrassônico (HC-SR04)

  O que faz:
    1. Mede a distância da tampa até o lixo.
    2. Converte em porcentagem (0% = vazia, 100% = cheia).
    3. Envia para o site a cada poucos segundos, pelo Wi-Fi:
         POST <SERVIDOR>/api/leitura   {"id": 1, "nivel": 85, "distancia_cm": 6.2}

  O site faz o resto:
    - mostra a lixeira enchendo e "Cheia" quando passar de 80%;
    - quando vocês esvaziarem a lixeira, o caminhão aparece indo buscar.

  Ligação do HC-SR04 no ESP32:
    VCC  -> 5V (VIN)
    GND  -> GND
    TRIG -> GPIO 5
    ECHO -> GPIO 18  (ATENÇÃO: o ECHO sai com 5V. Use um divisor de tensão,
                      ex.: resistor de 1k em série + 2k para o GND,
                      para chegar ~3,3V no ESP32.)

  Placa na Arduino IDE: "ESP32 Dev Module". Bibliotecas: já vêm com o ESP32.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ====================== CONFIGURE AQUI ======================

// Wi-Fi (precisa ser 2.4 GHz; o ESP32 não conecta em 5 GHz)
const char* WIFI_NOME  = "NOME_DO_WIFI";
const char* WIFI_SENHA = "SENHA_DO_WIFI";

// Para onde enviar as leituras (escolha UM):
//  - Servidor no computador (mesmo Wi-Fi):  "http://192.168.18.20:5000"
//  - Site publicado:                        "https://lixeira-inteligente.onrender.com"
const char* SERVIDOR = "https://lixeira-inteligente.onrender.com";

// Em qual ponto do mapa esta lixeira está (1 a 5).
const int LIXEIRA_PONTO = 1;

// Medidas da lixeira (em centímetros), medidas a partir do sensor:
//  - DISTANCIA_VAZIA: do sensor até o FUNDO da lixeira vazia.
//  - DISTANCIA_CHEIA: do sensor até o lixo quando já está CHEIA
//                     (deixe uns 5 cm de folga, o sensor não lê muito perto).
const float DISTANCIA_VAZIA = 40.0;
const float DISTANCIA_CHEIA = 5.0;

// De quanto em quanto tempo enviar (milissegundos).
const unsigned long INTERVALO_ENVIO = 3000;

// Pinos do sensor
const int PINO_TRIG = 5;
const int PINO_ECHO = 18;

// LED da placa (pisca quando envia com sucesso)
const int PINO_LED = 2;

// ============================================================


// Mede uma vez. Retorna -1 se não houve eco (nada na frente / fora de alcance).
float medirUmaVez() {
  digitalWrite(PINO_TRIG, LOW);
  delayMicroseconds(3);
  digitalWrite(PINO_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PINO_TRIG, LOW);

  unsigned long duracao = pulseIn(PINO_ECHO, HIGH, 30000UL); // até ~5 m
  if (duracao == 0) return -1;

  return duracao * 0.0343 / 2.0; // cm
}

// Faz 7 medidas e usa a do meio (mediana): ignora leituras malucas.
float medirDistancia() {
  float leituras[7];
  int validas = 0;

  for (int i = 0; i < 7; i++) {
    float d = medirUmaVez();
    if (d > 0) leituras[validas++] = d;
    delay(40);
  }

  if (validas == 0) return -1;

  // ordena (poucos itens, ordenação simples serve)
  for (int i = 0; i < validas - 1; i++) {
    for (int j = i + 1; j < validas; j++) {
      if (leituras[j] < leituras[i]) {
        float t = leituras[i];
        leituras[i] = leituras[j];
        leituras[j] = t;
      }
    }
  }

  return leituras[validas / 2];
}

// Converte distância em porcentagem de lixo.
int distanciaParaNivel(float distancia) {
  float nivel = (DISTANCIA_VAZIA - distancia) / (DISTANCIA_VAZIA - DISTANCIA_CHEIA) * 100.0;
  if (nivel < 0) nivel = 0;
  if (nivel > 100) nivel = 100;
  return (int) round(nivel);
}

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("Conectando no Wi-Fi ");
  Serial.print(WIFI_NOME);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NOME, WIFI_SENHA);

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\nConectado! IP do ESP32: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nNão conectou. Confira nome/senha (e se o Wi-Fi é 2.4 GHz).");
  }
}

bool enviarLeitura(int nivel, float distancia) {
  String url = String(SERVIDOR) + "/api/leitura";
  String corpo = "{\"id\":" + String(LIXEIRA_PONTO) +
                 ",\"nivel\":" + String(nivel) +
                 ",\"distancia_cm\":" + String(distancia, 1) + "}";

  HTTPClient http;
  WiFiClient cliente;
  WiFiClientSecure clienteSeguro;
  bool ok;

  if (url.startsWith("https")) {
    clienteSeguro.setInsecure(); // sem conferir certificado (simples para o projeto)
    ok = http.begin(clienteSeguro, url);
  } else {
    ok = http.begin(cliente, url);
  }

  if (!ok) {
    Serial.println("Endereço do servidor inválido.");
    return false;
  }

  http.setTimeout(15000); // o site publicado pode demorar a "acordar"
  http.addHeader("Content-Type", "application/json");

  int codigo = http.POST(corpo);
  String resposta = http.getString();
  http.end();

  Serial.printf("Enviado: nivel=%d%% (%.1f cm) -> HTTP %d %s\n",
                nivel, distancia, codigo, resposta.c_str());

  // O site recebeu, mas a chave "Sensor ESP32" está desligada lá.
  if (resposta.indexOf("\"ignorado\":true") >= 0) {
    Serial.println("  -> Conectado ao site, mas o 'Sensor ESP32' está DESLIGADO no site. Ligue a chave.");
  }

  return codigo == 200;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== Lixeira Inteligente (ESP32) ===");

  pinMode(PINO_TRIG, OUTPUT);
  pinMode(PINO_ECHO, INPUT);
  pinMode(PINO_LED, OUTPUT);

  conectarWiFi();
}

void loop() {
  static unsigned long ultimoEnvio = 0;

  if (millis() - ultimoEnvio < INTERVALO_ENVIO) {
    delay(20);
    return;
  }
  ultimoEnvio = millis();

  conectarWiFi();

  float distancia = medirDistancia();
  if (distancia < 0) {
    Serial.println("Sensor sem leitura (confira os fios TRIG/ECHO e a alimentação 5V).");
    return;
  }

  int nivel = distanciaParaNivel(distancia);

  if (WiFi.status() == WL_CONNECTED && enviarLeitura(nivel, distancia)) {
    digitalWrite(PINO_LED, HIGH);
    delay(60);
    digitalWrite(PINO_LED, LOW);
  }
}
