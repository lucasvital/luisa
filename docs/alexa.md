# Alexa: guia de configuração (para o Lucas e para a agente)

É uma skill **particular**, que não vai para a loja da Alexa. Ela funciona só nos Echos da conta Amazon que a criou e conversa com o servidor do painel.

O app **só registra**. A Alexa não sugere nem calcula dose.

## O que dá para falar

| Fale | A Alexa faz | Exemplo de resposta |
|---|---|---|
| "Alexa, **espasmo**" | 1ª vez: começa a salva. 2ª vez (em até 15 min): termina e grava a duração | "Salva iniciada às 11:23. Diga espasmo de novo quando acabar." / "Salva encerrada: 2 minutos e 27 segundos. Complete a contagem no app." |
| "Alexa, **dei o remédio**" | Registra a dose do momento | "Levetiracetam das 07:00 marcada como dada. Próxima: Prednisolona às 10:15." |
| "Alexa, **próxima dose**" | Diz a próxima dose | "A próxima dose é Prednisolona, 2 ml, às 13:00, daqui a 35 minutos." |
| "Alexa, **espasmos hoje**" | Resumo do dia | "Hoje foram 34 espasmos em 3 salvas. A última foi há 1 hora e 2 minutos. Doses: 3 de 5 registradas." |

Essas frases curtas funcionam por causa das **rotinas** (passo 6). Sem rotina, a frase é mais longa: "Alexa, peça para diário da luísa registrar espasmo".

- **Quem registrou:** tudo que entra pela Alexa aparece no app como **"Alexa"**, porque ela não sabe quem falou.
- **Dose repetida:** se a dose já foi dada, ela avisa quem deu e não registra de novo.
- **Dose muito adiantada:** se a próxima for daqui a mais de 1h, ela recusa.

## Pré-requisitos

1. **O app no ar com HTTPS**, por exemplo `https://luisa.seudominio.com`. Daqui em diante, `DOMINIO`.
2. **O token do usuário "Alexa"**, que aparece nos logs do servidor como `Alexa  https://DOMINIO/?t=TOKEN_ALEXA`.
   - Se o servidor subiu antes desta versão e o "Alexa" não aparece, é só reiniciar: o usuário é criado no boot.
3. **Uma conta Amazon:** a mesma dos Echos de casa.

## Passo a passo (uma vez, ~15 min)

### 1. Criar a skill
1. Entre em **developer.amazon.com/alexa/console/ask** com a conta Amazon dos Echos. O console é em inglês.
2. Clique em **Create Skill** e preencha:
   - **Name:** `Diário da Luísa`
   - **Primary locale:** **Portuguese (BR)**
   - **Type of experience:** Other
   - **Model:** **Custom**
   - **Hosting:** **Provision your own**
   - **Template:** **Start from Scratch**
3. Clique em **Create Skill** e espere ela abrir.

### 2. Colar os comandos
1. No menu da esquerda, abra **Interaction Model → JSON Editor**.
2. Apague tudo e cole o conteúdo de [`docs/alexa-modelo.json`](alexa-modelo.json).
3. Clique em **Save** e depois em **Build skill**. Espere uns 30 segundos até aparecer "Build Successful".

### 3. Apontar para o servidor
1. No menu da esquerda, abra **Endpoint** e marque **HTTPS**.
2. Em **Default Region**, cole: `https://DOMINIO/api/alexa/TOKEN_ALEXA`
3. No tipo de certificado, escolha **"My development endpoint has a certificate from a trusted certificate authority"** (Let's Encrypt é aceito).
4. Clique em **Save**.

### 4. Travar a skill no servidor (recomendado)
1. No topo da página **Endpoint**, copie o **Skill ID** (começa com `amzn1.ask.skill.`).
2. No servidor, crie a variável `ALEXA_SKILL_ID=amzn1.ask.skill....` e faça o redeploy.

Com isso, o servidor só aceita pedidos vindos da sua skill.

### 5. Testar no navegador
1. Abra a aba **Test**, no topo, e mude "Skill testing is enabled in" para **Development**.
2. Digite `abrir diario da luisa`. A resposta deve ser "Diário da Luísa. Você pode dizer: …".
3. Digite `peça para diario da luisa qual a próxima dose`.

A skill já fica ativa nos Echos da mesma conta. Não precisa publicar.

Ela **não aparece na busca de skills** do app Alexa, porque é particular. Para vê-la no celular, abra **Mais → Skills e Jogos → Suas Skills → aba Dev**. Não é preciso que ela apareça ali para funcionar: se o Echo responde a "Alexa, abrir diário da luísa", está tudo certo.

### 6. Rotinas para falar curto (no app Alexa do celular)
Abra **Mais → Rotinas → +** e crie uma rotina para cada linha:

| Nome | Quando: **Voz**, você diz… | Ação: **Personalizado** (a Alexa vai "ouvir"…) |
|---|---|---|
| Espasmo | `espasmo` | `peça para diário da luísa registrar espasmo` |
| Dei o remédio | `dei o remédio` | `peça para diário da luísa dei o remédio` |
| Próxima dose | `próxima dose` | `pergunte ao diário da luísa qual a próxima dose` |
| Espasmos hoje | `espasmos hoje` | `pergunte ao diário da luísa quantos espasmos hoje` |

Em cada rotina, escolha em **De:** os Echos da casa e salve. Depois é só falar "Alexa, espasmo".

## Problemas comuns

| A Alexa diz… | Causa | Solução |
|---|---|---|
| "Houve um problema com a resposta da skill solicitada" | Servidor fora do ar, endpoint errado ou token errado | Abrir `https://DOMINIO` no navegador. Conferir o endpoint (passo 3) e o token do usuário "Alexa". |
| A mesma mensagem, logo depois de definir `ALEXA_SKILL_ID` | O Skill ID copiado está diferente | Copiar de novo o Skill ID do console e fazer o redeploy. |
| "Desculpe, não sei sobre isso" | A frase não chegou na skill | Testar no console (passo 5). Na rotina, conferir se a ação **Personalizado** começa com "peça para diário da luísa…". |
| Funciona no console, mas não no Echo | O Echo está em outra conta ou em outro idioma | O Echo precisa estar na mesma conta Amazon e em **Português (Brasil)**. O mesmo e-mail pode ter duas contas Amazon separadas. Se o e-mail do console e o do app Alexa não forem a mesma conta, recrie a skill logado com a conta dos Echos. |
| A skill não aparece no app Alexa do celular | Skill particular não entra na busca da loja | Procurar em **Mais → Skills e Jogos → Suas Skills → aba Dev**. Se não estiver lá, conferir o teste em **Development** (passo 5), o idioma **Portuguese (BR)** no console e a conta. |
| "Salva iniciada" quando queriam terminar | Passaram mais de 15 min, ou o servidor reiniciou | Corrigir a duração da salva no app e apagar a salva extra. |

## Para a agente: conferir se a Alexa registrou

```sh
curl -s "https://DOMINIO/api/eventos?desde=2026-10-21T08:00" -H "Authorization: Bearer TOKEN_AGENTE"
```

Os registros feitos pela Alexa vêm com `"quem": "Alexa"`. Também dá para simular a Alexa sem falar. As perguntas (`ProximaDoseIntent` e `ResumoHojeIntent`) só leem. Já `EspasmoIntent` e `DeiIntent` **criam registro de verdade**, então apague depois:

```sh
curl -s -X POST "https://DOMINIO/api/alexa/TOKEN_ALEXA" -H "Content-Type: application/json" \
  -d '{"request":{"type":"IntentRequest","intent":{"name":"ProximaDoseIntent"}}}'
```

Se `ALEXA_SKILL_ID` estiver definido, inclua `"session":{"application":{"applicationId":"amzn1.ask.skill...."}}` no JSON.
