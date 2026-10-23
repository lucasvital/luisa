# Luísa · doses e espasmos

PWA para os pais registrarem doses e salvas de espasmos, com uma API para a agente. Um único `server.js` (Node 22.13+, zero dependências, SQLite embutido) serve o app e a API.

## Rodar

```sh
node server.js          # http://localhost:3000
node --test             # teste da API
```

No primeiro boot, o servidor cria um token por pessoa e mostra os links de acesso no terminal. Cada pessoa abre o próprio link uma vez no celular e depois usa "Adicionar à tela inicial".

| Variável | Padrão | Para quê |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:PORT` | base dos links impressos no boot |
| `PORT` | `3000` | |
| `DATA_DIR` | `./data` | banco (`luisa.db`) e vídeos |
| `USUARIOS` | `Lucas,Mãe,Agente` | um token por nome; nome novo na lista ganha token no próximo boot |
| `PINS` | (vazio) | código curto para entrar no app, ex. `Lucas:281200,Mãe:4321`. Só troca pelo token da pessoa; 10 erros em 15 min bloqueiam o código por 15 min |
| `TZ` | `America/Sao_Paulo` | todas as horas são gravadas no horário local |
| `WEBHOOK_URL` | (vazio) | se definido, recebe um POST a cada registro |
| `WEBHOOK_TOKEN` | (vazio) | vai como `Authorization: Bearer` no webhook |
| `ATALHO_ESPASMO_URL` / `ATALHO_DEI_URL` | (vazio) | links do iCloud dos atalhos; liga os botões "Instalar no iPhone" do app |

Na VPS (Coolify, Portainer ou `docker run`):

```sh
docker build -t luisa .
docker run -d --name luisa -p 3000:3000 -v luisa-data:/data -e PUBLIC_URL=https://luisa.seudominio.com luisa
docker logs luisa       # links de acesso
```

O app precisa de HTTPS para instalar no celular e funcionar offline. Coloque atrás do proxy com TLS (Traefik ou Caddy).

## Atalhos do iPhone (toque nas costas do celular)

- **2 toques nas costas = Espasmo:** o primeiro começa a salva e o segundo termina e grava a duração.
- **3 toques = Dei a dose:** registra a dose do momento. Avisa se ela já foi dada e recusa se a próxima for daqui a mais de 1h.

O passo a passo, as respostas e a solução de problemas estão em **[docs/iphone-atalhos.md](docs/iphone-atalhos.md)**. Esse guia foi escrito para a agente conseguir ajudar na configuração.

## Câmera do berço (vídeo automático da salva)

`camera/gravador.js` roda num PC de casa que fica ligado e precisa do ffmpeg. Ele grava a câmera sem parar e guarda só as últimas 2 horas. Quando uma salva é registrada (pelo app, pelo atalho ou pela agente), ele corta o trecho de 30 s antes do início até 30 s depois do fim e anexa na salva. Salva sem duração leva 5 minutos de vídeo.

1. No app Tapo: câmera → Configurações → Configurações avançadas → **Conta da câmera**. Crie um usuário e uma senha só com letras e números. O IP aparece em Configurações → Informações do dispositivo.
2. Preencha `camera/.env` (não vai pro GitHub): `CAMERA_URL=rtsp://usuario:senha@IP:554/stream1` e `CODIGO=` com o código de acesso do app (o curto de `PINS` ou o longo do link).
3. Rode uma vez `powershell -ExecutionPolicy Bypass -File camera\ligar-com-windows.ps1`. Ele cria uma tarefa no Windows que abre o gravador sem janela quando você entra no Windows e religa em até 5 min se ele parar. A saída vai para `camera/gravador.log`. O PC não pode entrar em suspensão.

## Telinha da casa (ESP32 + OLED)

`tela/tela.ino` mostra no OLED 0,96" a próxima dose, a última dose dada e os espasmos de hoje, trocando a cada 4 s. Ele lê `GET /api/hoje` a cada 30 s. Se tiver uma dose atrasada, a tela pisca nela. Das 22h às 7h o brilho fica no mínimo.

- **Ligação:** GND→GND, VCC→3V3, SCL→D22, SDA→D21.
- **`tela/segredos.h`** (não vai pro GitHub): `WIFI_NOME`, `WIFI_SENHA` e `CODIGO`, que é o código curto de `PINS`.
- **Gravar:** placa `esp32:esp32:esp32`, bibliotecas U8g2 e ArduinoJson.

## API (para a agente)

Todas as chamadas levam `Authorization: Bearer <token da Agente>`. As horas aceitam `13:00` (hoje), `2026-10-21T13:00` (hora local) ou ISO com fuso. As respostas usam hora local, sem fuso.

| Rota | O que faz |
|---|---|
| `GET /api/hoje` | doses do dia (cada uma com `status`: `dada`, `dada_atrasada`, `pendente` ou `atrasada`), `proxima` dose, salvas de hoje e resumo |
| `GET /api/medicacoes` | remédios com `horarios`, `inicio` e `fim`. Os lembretes devem ler os horários daqui |
| `POST /api/doses` | `{ "remedio": "levetiracetam", "hora": "07:05", "quem": "Lucas" }`. Casa com o horário previsto mais próximo (até 3h) |
| `DELETE /api/doses/:id` | desfaz um registro |
| `POST /api/espasmos` | `{ "hora": "11:23", "fortes": 4, "medios": 3, "fracos": 3, "duracao_seg": 147, "acordou": "~10 min", "nota": "...", "quem": "Lucas" }`. Sem intensidade, use `"total": 15`. Com `id`, atualiza a salva. O contador do app manda também `toques`: os segundos desde o início em que cada espasmo aconteceu (`[0, 4.2, 9]`) |
| `POST /api/espasmos/:id/video` | corpo binário do vídeo, `Content-Type: video/mp4` (ou `quicktime`, `webm`, `3gpp`) |
| `DELETE /api/espasmos/:id` | apaga a salva |
| `GET /api/resumo?de=2026-10-19&ate=2026-10-21` | por dia: espasmos, intensidades, salvas, doses previstas, dadas, atrasadas e não registradas. Traz também as listas completas e a `analise` (abaixo) |
| `GET /api/eventos?desde=2026-10-21T08:00` | o que foi registrado ou alterado desde um instante (para polling) |
| `GET /api/ao-vivo` | fluxo ao vivo (Server-Sent Events): uma linha `data: {"tipo","acao"}` a cada registro. É o que o app usa para atualizar na hora |

**Dose duplicada:** se a dose daquele horário já foi registrada, o `POST /api/doses` devolve **409** com quem deu e quando. A mensagem é algo como `essa dose (Prednisolona 10:15) já foi dada por Mãe às 10:20`, e o JSON traz a `dose` existente. A agente deve repassar isso em vez de registrar de novo.

**Análise (`analise` no resumo):** são os números da aba Padrões e do PDF. Servem para a agente responder perguntas como "o remédio está funcionando?". Os dias antes do primeiro registro não contam, e o dia de hoje conta só a parte que já passou.

| Campo | O que é |
|---|---|
| `remedios[]` | para cada remédio (ou fase de dose): `antes` = espasmos e salvas por dia nos 7 dias antes de começar; `depois` = nos 7 dias mais recentes dele (ou desde o início, se faz menos tempo). `null` se não há registro |
| `semanas[]` | blocos de 7 dias contados a partir de `ate`: espasmos/dia, salvas/dia, espasmos por salva, % de fortes |
| `salvas` | média de espasmos e de fortes por salva, % de fortes, duração média |
| `entre_salvas` | do fim de uma salva ao começo da próxima: mediana e média em minutos, e o maior período sem crise (`maior_desde` → `maior_ate`) |
| `dentro` | segundos entre um espasmo e o próximo, medidos pelos toques do contador. `comeco_seg` e `fim_seg` comparam a primeira e a segunda metade da salva. `intervalo_estimado_seg` = duração ÷ (espasmos − 1) para as salvas sem toques |
| `horarios` / `acordou` | salvas por período do dia (madrugada 0–6h, manhã, tarde, noite) e em relação ao sono |
| `dose[]` | para cada remédio, quantas salvas começaram logo depois da dose, no meio do intervalo ou perto da próxima (pelos horários previstos). Sem relação com a dose, fica perto de 1/3 em cada |
| `falhas` | espasmos/dia nos dias com dose atrasada ou sem registro × nos dias com todas no horário (sem contar hoje) |

São só números do que foi registrado. A agente deve repassá-los, não tirar conclusão médica.

**Webhook:** quando `WEBHOOK_URL` está definido, cada registro gera um `POST` com `{ "tipo": "dose" | "espasmo" | "medicacao", "acao": "criada" | "criado" | "atualizada" | "atualizado" | "removida" | "removido" | "video", "dados": {...} }`. Assim, se a mãe marcou no app, a agente fica sabendo e não cobra.

O app só registra o que foi prescrito. Quem muda dose é o médico. Desmame é uma nova fase do remédio, com outra dose, criada a partir de uma data.
