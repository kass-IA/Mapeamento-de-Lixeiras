/*
  site_lixeira.h — liga o código de vocês ao site, sem mudar o resto.

  COMO USAR (3 linhas no código de vocês):

    1) Copie este arquivo para a MESMA PASTA do .ino de vocês.

    2) No topo do .ino:
         #include "site_lixeira.h"

    3) No final do setup():
         iniciarSite();

    4) No loop(), logo depois de calcular a porcentagem de lixo:
         enviarNivelSite(nivel);      // nivel = 0 a 100

  Pode chamar enviarNivelSite() quantas vezes quiser: ele mesmo só envia
  a cada INTERVALO_SITE (3 s) e não trava o código se o Wi-Fi cair.

  Se o código de vocês mede em CENTÍMETROS (e não em %), use:
         enviarDistanciaSite(distanciaCm);
  e ajuste DISTANCIA_VAZIA / DISTANCIA_CHEIA abaixo.
*/

#pragma once

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ====================== CONFIGURE AQUI ======================

// Wi-Fi (2.4 GHz)
const char* SITE_WIFI_NOME  = "NOME_DO_WIFI";
const char* SITE_WIFI_SENHA = "SENHA_DO_WIFI";

// Para onde enviar:
//  - Computador (mesmo Wi-Fi): "http://192.168.18.20:5000"
//  - Site publicado:           "https://lixeira-inteligente.onrender.com"
const char* SITE_SERVIDOR = "http://192.168.18.20:5000";

// Em qual ponto do mapa esta lixeira está (1 a 5)
const int SITE_PONTO = 1;

// De quanto em quanto tempo enviar (ms)
const unsigned long INTERVALO_SITE = 3000;

// Só se usar enviarDistanciaSite(): medidas da lixeira em cm
const float DISTANCIA_VAZIA = 40.0;  // sensor até o fundo (vazia)
const float DISTANCIA_CHEIA = 5.0;   // sensor até o lixo (cheia)

// ============================================================


static unsigned long _siteUltimoEnvio = 0;
static unsigned long _siteUltimaTentativaWifi = 0;

// Liga o Wi-Fi (chame no setup).
void iniciarSite() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(SITE_WIFI_NOME, SITE_WIFI_SENHA);
  Serial.print("[site] Conectando no Wi-Fi ");
  Serial.println(SITE_WIFI_NOME);
  _siteUltimaTentativaWifi = millis();
}

// Reconecta sem travar o loop (tenta de novo a cada 10 s).
static bool _siteWifiOk() {
  if (WiFi.status() == WL_CONNECTED) return true;

  if (millis() - _siteUltimaTentativaWifi > 10000) {
    _siteUltimaTentativaWifi = millis();
    Serial.println("[site] Wi-Fi caiu, tentando de novo...");
    WiFi.disconnect();
    WiFi.begin(SITE_WIFI_NOME, SITE_WIFI_SENHA);
  }
  return false;
}

// Envia a porcentagem de lixo (0 a 100) para o site.
void enviarNivelSite(int nivel) {
  if (millis() - _siteUltimoEnvio < INTERVALO_SITE) return;
  _siteUltimoEnvio = millis();

  if (!_siteWifiOk()) return;

  if (nivel < 0) nivel = 0;
  if (nivel > 100) nivel = 100;

  String url = String(SITE_SERVIDOR) + "/api/leitura";
  String corpo = "{\"id\":" + String(SITE_PONTO) + ",\"nivel\":" + String(nivel) + "}";

  HTTPClient http;
  WiFiClient cliente;
  WiFiClientSecure clienteSeguro;

  bool ok;
  if (url.startsWith("https")) {
    clienteSeguro.setInsecure();
    ok = http.begin(clienteSeguro, url);
  } else {
    ok = http.begin(cliente, url);
  }
  if (!ok) {
    Serial.println("[site] Endereço do servidor inválido.");
    return;
  }

  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  int codigo = http.POST(corpo);
  String resposta = http.getString();
  http.end();

  Serial.printf("[site] nivel=%d%% -> HTTP %d\n", nivel, codigo);

  if (resposta.indexOf("\"ignorado\":true") >= 0) {
    Serial.println("[site] Chegou no site, mas a chave 'Sensor ESP32' está DESLIGADA lá.");
  }
}

// Se o código de vocês mede em cm: converte e envia.
void enviarDistanciaSite(float distanciaCm) {
  if (distanciaCm <= 0) return; // leitura inválida
  float nivel = (DISTANCIA_VAZIA - distanciaCm) / (DISTANCIA_VAZIA - DISTANCIA_CHEIA) * 100.0;
  enviarNivelSite((int) round(nivel));
}
