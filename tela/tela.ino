// Telinha da Luísa: ESP32 + OLED 0,96" (SSD1306, I2C) mostrando a próxima dose, a última e os espasmos de hoje.
// Lê GET /api/hoje a cada 30 s. Dose atrasada faz a tela piscar. De 22h às 7h o brilho cai.
// Ligação: GND→GND, VCC→3V3, SCL→D22, SDA→D21.
// segredos.h (não vai pro GitHub):  #define WIFI_NOME "..."   #define WIFI_SENHA "..."   #define CODIGO "281200"
// Bibliotecas: U8g2 e ArduinoJson. Placa: esp32:esp32:esp32.
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <U8g2lib.h>
#include "segredos.h"
#include "raizes.h"

const char* APP = "https://c.devital.com.br";
U8G2_SSD1306_128X64_NONAME_F_HW_I2C tela(U8G2_R0, U8X8_PIN_NONE);
WiFiClientSecure tls;
String token, erro = "Conectando no Wi-Fi…";
unsigned long lidoEm, proximaLeitura;

struct {
  bool ok;
  String agora;                                // hora do servidor na última leitura
  String proxNome, proxDose, proxPrevisto;     // próxima dose
  String ultNome, ultQuem, ultEm;              // última dose dada hoje
  String atrNome, atrPrevisto;                 // dose atrasada (não registrada), se houver
  int espasmos, salvas;
  String ultimaSalva;
} d;

// ---------- tempo: tudo em hora local, como o app ("2026-10-23T19:00") ----------
long dias(int y, int m, int dd) { // dias desde 1970-01-01
  y -= m <= 2;
  long era = y / 400, ano = y - era * 400, nd = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + dd - 1;
  return era * 146097 + ano * 365 + ano / 4 - ano / 100 + nd - 719468;
}
long minutos(const String& s) {
  if (s.length() < 16) return 0;
  return dias(s.substring(0, 4).toInt(), s.substring(5, 7).toInt(), s.substring(8, 10).toInt()) * 1440
       + s.substring(11, 13).toInt() * 60 + s.substring(14, 16).toInt();
}
// relógio = hora do servidor + o que passou desde a leitura (dispensa NTP)
long agora() { return minutos(d.agora) + (d.agora.substring(17, 19).toInt() + (millis() - lidoEm) / 1000) / 60; }
String hm(long min) { char b[6]; snprintf(b, sizeof b, "%02ld:%02ld", min / 60 % 24, min % 60); return b; }
String duracao(long min) {
  if (min < 60) return String(min) + " min";
  char b[12]; snprintf(b, sizeof b, "%ldh%02ld", min / 60, min % 60); return b;
}

// ---------- app ----------
int entrar() { // troca o código curto pelo token, como o app faz no login
  HTTPClient h;
  h.begin(tls, String(APP) + "/api/entrar");
  h.addHeader("Content-Type", "application/json");
  int c = h.POST(String("{\"codigo\":\"") + CODIGO + "\"}");
  if (c == 200) { JsonDocument j; deserializeJson(j, h.getString()); token = j["token"] | ""; }
  h.end();
  return c;
}

int ler() {
  HTTPClient h;
  h.useHTTP10(true); // sem "chunked", pra ler o JSON direto do stream
  h.setTimeout(15000);
  h.begin(tls, String(APP) + "/api/hoje");
  h.addHeader("Authorization", "Bearer " + token);
  int c = h.GET();
  if (c == 200) {
    JsonDocument f; // só o que a tela usa: as anotações das salvas não cabem na memória
    f["agora"] = true;
    f["resumo"] = true;
    for (const char* k : {"nome", "dose", "previsto"}) f["proxima"][k] = true;
    for (const char* k : {"nome", "previsto", "status"}) f["doses"][0][k] = true;
    for (const char* k : {"dada_em", "quem"}) f["doses"][0]["dose_registrada"][k] = true;
    JsonDocument j;
    if (deserializeJson(j, h.getStream(), DeserializationOption::Filter(f))) c = -100;
    else {
      d.ok = true; d.agora = j["agora"] | ""; lidoEm = millis();
      d.proxNome = j["proxima"]["nome"] | ""; d.proxDose = j["proxima"]["dose"] | ""; d.proxPrevisto = j["proxima"]["previsto"] | "";
      d.ultEm = d.atrNome = "";
      for (JsonObject x : j["doses"].as<JsonArray>()) {
        String em = x["dose_registrada"]["dada_em"] | "";
        if (em > d.ultEm) { d.ultEm = em; d.ultNome = x["nome"] | ""; d.ultQuem = x["dose_registrada"]["quem"] | ""; }
        if (d.atrNome == "" && String(x["status"] | "") == "atrasada") { d.atrNome = x["nome"] | ""; d.atrPrevisto = x["previsto"] | ""; }
      }
      d.espasmos = j["resumo"]["espasmos"] | 0; d.salvas = j["resumo"]["salvas"] | 0; d.ultimaSalva = j["resumo"]["ultima_salva"] | "";
    }
  }
  h.end();
  return c;
}

void atualizar() {
  proximaLeitura = millis() + 30000;
  if (WiFi.status() != WL_CONNECTED) { erro = d.ok ? "Sem Wi-Fi" : "Conectando no Wi-Fi…"; proximaLeitura = millis() + 2000; return; }
  if (token == "") {
    int c = entrar();
    if (c == 401 || c == 429) { // insistir com código errado bloqueia o código pra todo mundo
      erro = "Código recusado"; proximaLeitura = millis() + 15 * 60000; return;
    }
    if (token == "") { erro = "Sem conexão com o app"; return; }
  }
  int c = ler();
  if (c == 401) token = "";
  erro = c == 200 ? "" : "Sem conexão com o app";
  Serial.printf("leitura: %d  espasmos hoje: %d  próxima: %s %s\n", c, d.espasmos, d.proxNome.c_str(), d.proxPrevisto.c_str());
}

// ---------- tela: faixa amarela em cima (16 px), azul embaixo ----------
void cabecalho(const char* titulo) {
  tela.setFont(u8g2_font_helvB08_tf);
  tela.drawUTF8(0, 11, titulo);
  String dir = erro != "" ? "sem rede" : hm(agora());
  tela.drawUTF8(128 - tela.getUTF8Width(dir.c_str()), 11, dir.c_str());
}
// número grande à esquerda, texto ao lado e uma linha embaixo
void corpo(const String& grande, const String& lado, const String& baixo) {
  tela.setFont(u8g2_font_logisoso24_tn);
  tela.drawUTF8(0, 44, grande.c_str());
  int x = tela.getUTF8Width(grande.c_str()) + 6;
  tela.setFont(u8g2_font_helvB10_tf);
  tela.drawUTF8(x, 44, lado.c_str());
  tela.setFont(u8g2_font_helvR08_tf);
  tela.drawUTF8(0, 62, baixo.c_str());
}
String nomeDose(const String& nome, const String& dose) { return dose == "" ? nome : nome + " · " + dose; }

void desenhar() {
  tela.clearBuffer();
  long t = agora();
  if (!d.ok) {
    cabecalho("LUÍSA");
    tela.setFont(u8g2_font_helvB10_tf);
    tela.drawUTF8(0, 40, erro.c_str());
  } else if (d.atrNome != "") { // dose atrasada: fica nessa tela, piscando
    cabecalho("DOSE ATRASADA");
    corpo(hm(minutos(d.atrPrevisto)), "há " + duracao(t - minutos(d.atrPrevisto)), d.atrNome + " · não registrada");
    if (millis() / 700 % 2) { tela.setDrawColor(2); tela.drawBox(0, 0, 128, 64); tela.setDrawColor(1); }
  } else {
    switch (millis() / 4000 % 3) { // troca de tela a cada 4 s
      case 0:
        cabecalho("PRÓXIMA DOSE");
        if (d.proxPrevisto == "") corpo("", "nenhuma", "sem doses previstas");
        else corpo(hm(minutos(d.proxPrevisto)), "em " + duracao(max(0L, minutos(d.proxPrevisto) - t)), nomeDose(d.proxNome, d.proxDose));
        break;
      case 1:
        cabecalho("ÚLTIMA DOSE");
        if (d.ultEm == "") corpo("", "nenhuma hoje", "");
        else corpo(hm(minutos(d.ultEm)), d.ultQuem, d.ultNome + " · há " + duracao(t - minutos(d.ultEm)));
        break;
      default:
        cabecalho("ESPASMOS HOJE");
        corpo(String(d.espasmos), d.salvas == 1 ? "1 salva" : String(d.salvas) + " salvas",
              d.ultimaSalva == "" ? "nenhuma salva registrada" : "última salva há " + duracao(t - minutos(d.ultimaSalva)));
    }
  }
  long h = t / 60 % 24;
  tela.setContrast(d.ok && (h >= 22 || h < 7) ? 1 : 255); // de noite, baixinho
  tela.sendBuffer();
}

void setup() {
  Serial.begin(115200);
  tela.setBusClock(400000);
  tela.begin();
  tela.enableUTF8Print();
  tls.setCACert(RAIZES);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_NOME, WIFI_SENHA);
}

void loop() {
  if ((long)(millis() - proximaLeitura) >= 0) atualizar();
  desenhar();
  delay(100);
}
