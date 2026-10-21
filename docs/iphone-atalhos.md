# Atalhos do iPhone: guia para a agente

Este guia é para a agente que ajuda o Lucas e a esposa a configurar e usar os atalhos do iPhone do painel da Luísa. Ele traz o que cada atalho faz, o passo a passo para montar, o que cada resposta significa e como resolver os problemas comuns.

O app **só registra**. Ele não calcula nem sugere dose. Quem muda dose é o médico. Se perguntarem algo de dosagem, a agente não responde e encaminha para o neuro.

## O que existe

| Atalho | Gesto sugerido | O que faz |
|---|---|---|
| **Espasmo** | 2 toques nas costas do iPhone | 1º toque: começa uma salva com a hora de agora. 2º toque (em até 15 min): termina a salva e grava a duração. A contagem (forte/médio/fraco), o "acordou há" e o vídeo se completam depois no app. |
| **Dei a dose** | 3 toques nas costas do iPhone | Registra a dose do momento: a atrasada das últimas 3h ou, se não houver, a próxima. Recusa se a próxima for daqui a mais de 1h, para evitar toque sem querer. |

Os dois chamam o servidor e mostram a resposta como notificação.

## Pré-requisitos

1. **O app no ar com HTTPS**, por exemplo `https://luisa.seudominio.com`. Daqui em diante, `DOMINIO`.
2. **O token de cada pessoa.** Ele aparece nos logs do servidor (`docker logs luisa`) como `https://DOMINIO/?t=TOKEN`. É o texto depois de `?t=`.
   - **Cada pessoa usa o próprio token.** É por ele que o app sabe quem registrou ("Lucas", "Mãe").
   - O token da **Agente** é só da agente. Não vai em iPhone.
3. **iPhone 8 ou mais novo**, porque o Toque Traseiro não existe antes disso.

## Endpoints

```
POST https://DOMINIO/api/atalho/espasmo?t=TOKEN
POST https://DOMINIO/api/atalho/dei?t=TOKEN
```

- Não têm corpo. O token vai na URL.
- A resposta é **texto puro** (`text/plain`), pronto para virar notificação.

## Instalação em 1 toque (recomendado)

No app, em **Relatório → Atalhos do iPhone**, há os botões **Instalar "Espasmo"** e **Instalar "Dei a dose"**. Cada botão faz duas coisas:
1. Copia o código da pessoa.
2. Abre o atalho pronto no iPhone.

A pessoa toca em **Adicionar Atalho**, cola o código quando o iPhone pedir e liga o Toque Traseiro (veja "Ligar o gesto nas costas", mais abaixo).

Para os botões aparecerem, o Lucas precisa criar os atalhos **compartilháveis uma única vez** e colocar os links no servidor.

### Criar os atalhos compartilháveis (só o Lucas, uma vez)
O iPhone não aceita atalho gerado por site: ele precisa sair de um iPhone ou de um Mac. O código de cada pessoa entra por uma **pergunta de importação**.

1. No app **Atalhos**, toque em **+** e adicione a ação **Texto**. Escreva `COLE_SEU_CODIGO`.
   - ⚠️ **Não** coloque o seu código de verdade: o texto vai junto no link compartilhado.
2. Adicione a ação **Obter Conteúdo do URL**.
   - No URL, escreva `https://DOMINIO/api/atalho/espasmo?t=` e, logo depois, insira a variável **Texto** (aparece acima do teclado).
   - Abra as opções pela setinha (›) e mude **Método** para **POST**.
3. Adicione **Mostrar Notificação** com o texto **Conteúdo do URL**.
4. Dê o nome **Espasmo**.
5. Configure a pergunta de importação:
   - Abra os detalhes do atalho: o **ⓘ** embaixo, ou toque no nome dele no topo.
   - Procure **Configuração** / **Perguntas de Importação** e adicione uma pergunta para o campo da ação **Texto**.
   - Pergunta sugerida: "Cole o seu código de acesso (o app copiou para você)".
6. Toque em **Compartilhar → Copiar Link do iCloud**.
7. Repita tudo para **Dei a dose**, com `.../api/atalho/dei?t=`.
8. No servidor, crie as variáveis `ATALHO_ESPASMO_URL` e `ATALHO_DEI_URL` com os dois links do iCloud e faça o redeploy. Os botões aparecem no app.

Se o domínio do servidor mudar, refaça os links.

## Passo a passo manual (alternativa, uma vez por aparelho)

### Atalho "Espasmo"
1. Abra o app **Atalhos** e toque em **+**, no canto de cima.
2. Toque em **Adicionar Ação**, busque **Obter Conteúdo do URL** e toque nela.
3. No campo do URL, cole `https://DOMINIO/api/atalho/espasmo?t=TOKEN` (com o token da pessoa).
4. Toque na **setinha (›)** da ação para abrir as opções e mude **Método** de GET para **POST**. Não precisa adicionar cabeçalhos nem corpo.
5. Busque e adicione a ação **Mostrar Notificação**. No texto, apague o que vier e toque em **Conteúdo do URL**, nas sugestões de variável acima do teclado.
6. Toque no nome do atalho, no topo, escolha **Renomear** e coloque **Espasmo**. Se quiser, escolha um ícone e uma cor.
7. Toque em **OK** para salvar.

### Atalho "Dei a dose"
Repita os passos acima mudando duas coisas:
- URL: `https://DOMINIO/api/atalho/dei?t=TOKEN`
- Nome: **Dei a dose**

### Primeiro teste (obrigatório)
1. Toque uma vez em cada atalho, dentro do app Atalhos.
2. O iPhone pergunta se o atalho pode se conectar ao domínio. Responda **Sempre Permitir**. Sem isso, o gesto nas costas falha em silêncio.
3. O "Espasmo" de teste abre uma salva. Toque nele de novo para fechar e depois apague essa salva no app.

### Ligar o gesto nas costas
**Ajustes → Acessibilidade → Toque → Toque Traseiro**
- **Toque Duplo** → **Espasmo**
- **Toque Triplo** → **Dei a dose**

### Extras opcionais
- **Siri:** funciona pelo nome do atalho, como "E aí Siri, espasmo" ou "E aí Siri, dei a dose".
- **Botão de Ação** (iPhone 15 Pro e mais novos): **Ajustes → Botão de Ação → Atalho → Espasmo**.
- **Apple Watch:** os atalhos aparecem no app Atalhos do relógio e dá para colocar como complicação.
- **Tela bloqueada:** em **Personalizar → Widgets → Atalhos**, coloque o "Espasmo" para tocar sem desbloquear.

## O que cada resposta significa

| Notificação | Significado | O que fazer |
|---|---|---|
| `Salva iniciada às 11:23. Toque de novo quando acabar.` | Salva aberta com a hora de agora. | Ao fim da crise, repetir o gesto. |
| `Salva encerrada: 2:27. Complete a contagem no app.` | Salva fechada e duração gravada. | Abrir o app → Linha do dia → tocar na salva e preencher forte/médio/fraco, acordou há e vídeo. |
| `Levetiracetam das 07:00 marcada como dada. Próxima: Prednisolona às 10:15.` | Dose registrada em nome da pessoa. | Nada. |
| `Essa dose (Prednisolona 10:15) já foi dada por Mãe às 10:20.` | A outra pessoa já registrou. **Não dar de novo.** | Avisar e conferir com quem deu. |
| `A próxima dose (Levetiracetam 19:00) é só daqui a 5h56. Se deu antes, registre pelo app.` | Toque sem querer, ou dose dada muito antes do horário. Nada foi registrado. | Se deu mesmo, registrar pelo app, no card da dose → "Dei" → hora certa. |
| `Nenhuma dose pendente agora.` | Não há remédio cadastrado para hoje ou amanhã. | Conferir a tela Remédios no app. |
| `{"erro":"token inválido"}` | O token da URL está errado ou incompleto. | Recopiar o token dos logs e editar a URL do atalho. |

**Regra da salva:** o 2º toque só fecha a salva se vier **em até 15 minutos**. Depois disso, o toque abre uma salva nova. Se esqueceram de fechar, a duração se corrige no app. Se o servidor reiniciar no meio de uma salva, o próximo toque também abre uma nova.

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| O gesto não faz nada | Permissão de rede negada no 1º uso | Rodar o atalho pelo app Atalhos e escolher **Sempre Permitir**. |
| Roda, mas não aparece notificação | Notificações do app Atalhos desligadas | **Ajustes → Notificações → Atalhos** → permitir. |
| "Não foi possível conectar ao servidor" | App fora do ar, domínio errado ou sem HTTPS | Abrir `https://DOMINIO` no Safari. Se não abrir, o problema é no servidor. |
| Toque Traseiro dispara pouco | Capinha grossa ou toque fraco | Tocar com mais firmeza na parte de cima das costas. Capinhas muito grossas atrapalham. |
| Registro saiu com o nome errado | O atalho usa o token de outra pessoa | Trocar o token na URL do atalho daquele iPhone. |
| Dose registrada sem querer | Toque triplo acidental | No app: Linha do dia → tocar na dose → **Apagar este registro**. |

## Como a agente confere pela API

Com o **token da Agente** (cabeçalho `Authorization: Bearer TOKEN_AGENTE`):

```sh
# o que aconteceu hoje (doses com status, salvas, próxima dose)
curl -s https://DOMINIO/api/hoje -H "Authorization: Bearer TOKEN_AGENTE"

# o que mudou desde um horário (para conferir se o atalho registrou)
curl -s "https://DOMINIO/api/eventos?desde=2026-10-21T08:00" -H "Authorization: Bearer TOKEN_AGENTE"
```

Para testar um atalho em nome de alguém, rode `curl -X POST "https://DOMINIO/api/atalho/espasmo?t=TOKEN_DA_PESSOA"`. **Isso cria registro de verdade**, então apague depois pelo app.

A API completa (doses, espasmos, resumo, webhook) está no [README](../README.md#api-para-a-agente).

## Segurança

- **O token é a senha da pessoa.** Não postar em grupo nem mandar para terceiros.
- Se um token vazar, o Lucas pede para o Claude Code trocar. Ele fica na tabela `usuarios` do banco.
