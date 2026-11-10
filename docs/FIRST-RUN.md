# Primeira execução

Depois de instalar, o ideal é criar **um canal**. A pasta `rooster/` é criada junto com ele; você não precisa escolher onde ela fica nem configurar o workspace antes.

A instalação termina com um resumo curto e uma pergunta que já explica o que é o canal e pede as duas coisas necessárias: **o nome e o que ele vai produzir**. Só depois do seu sim o agente cria a pasta `rooster/` e o canal. Se você disser não, nada é criado.

## O conceito

```text
Workspace → Canal → Projeto
```

- **Workspace** = a pasta `rooster/`. Infraestrutura e biblioteca compartilhada. É criado implicitamente.
- **Canal** = a pasta daquele projeto, marca ou cliente. Guarda os vídeos, o estilo, os arquivos e os padrões daquele grupo.
- **Perfil** = identidade visual e sonora.
- **Projeto** = um vídeo dentro de um canal. Herda os padrões e pode sobrescrever qualquer coisa.

Exemplo: canal **Studio A** (pt-BR, 16:9, perfil próprio, TTS) e canal **Cliente B** (inglês, 1:1, minimal, voz do usuário).

Não existe categoria separada. O campo `content` do canal registra o que ele produz, e cada projeto define a própria estrutura em `brief.md`, `script.md` e `edit/plan.json`.

Na prática, o canal é a pasta que agrupa os vídeos daquela marca ou cliente:

```text
rooster/                      workspace (tudo)
└── channels/
    └── <canal>/              marca, cliente ou projeto
        ├── channel.json
        ├── projects/
        │   └── <video>/      um vídeo
        ├── profiles/
        │   └── <canal>/      visual e som
        ├── assets/
        └── library/
```

Canal não é canal do YouTube. É a pasta que separa, por exemplo, os vídeos de uma marca, de um cliente ou de um programa.

## O que o agente pergunta

Depois do seu “sim”, o agente faz **uma pergunta simples**, sem jargão:

> **“Quer criar o primeiro canal agora? Pensa nele como a pasta daquele projeto: dentro dela ficam os vídeos, o estilo e os arquivos da marca ou cliente. Se sim, me diga o nome do canal e o que ele vai produzir?”**

O assunto é seu. O agente não deve sugerir “shorts de tecnologia”, “entrevistas” ou “promos” como resposta. Se você der só o conteúdo, ele propõe um nome curto e confirma; se der só o nome, ele pergunta o que o canal produz.

Com a sua resposta, ele infere o resto (idioma, formato, voz, etc.) e mostra um resumo curto:

> **“Vou criar `studio-a`: português, 16:9, visual minimal e voz TTS. Está bom ou quer ajustar algo?”**

Se você confirmar, ele cria o canal. Se quiser mudar algo, é só dizer. Os campos avançados continuam disponíveis, mas não são perguntados de uma vez.

## Identidade do canal

Depois de criar o canal, o agente pergunta em um bloco só:

1. **Paleta:** você tem cores de marca? Se não, como descreveria o clima visual?
2. **Tipografia:** alguma fonte ou estilo em mente?
3. **Motion e áudio:** como devem ser o motion, a música e os SFX?

Com as respostas, ele cria um perfil do próprio canal:

```bash
node "<skill>/scripts/rooster.mjs" channel design studio-a \
  --from minimal \
  --bg "#0b0f19" \
  --fg "#f8fafc" \
  --accent "#22d3ee" \
  --display Inter \
  --body Inter \
  --motion calm \
  --music ambient \
  --sfx subtle \
  --style "clean editorial, generous negative space" \
  --negative "clutter, heavy gradients"
```

Isso grava `channels/studio-a/profiles/studio-a/profile.json` e `STYLE.md`, e aponta `channel.profile` para ele. Se você não tiver preferência, o perfil base é mantido e dá para mudar depois com `channel design studio-a --force`.

Antes do primeiro plano, o agente pode rodar `styleproof <slug>` e abrir `style/proof/index.html` com três frames de amostra (hook, dado e legenda). Aprove o look nessa etapa: mudar cor e tipografia depois do build é caro.

## Duração

Duração **não é padrão do canal nem do projeto**. Cortar silêncio, remover vícios de fala e encurtar o bruto muda o tamanho final; a duração é o resultado da edição.

O agente não pergunta duração por padrão. A flag `--duration` só existe para um alvo que você declarou explicitamente, por exemplo “quero exatamente 30 segundos”. Sem alvo declarado, o plano e a mídia definem o comprimento.

## Configuração avançada (só se você pedir)

Se quiser controlar tudo, o agente pergunta em grupos de no máximo três:

1. Identidade: nome, conteúdo e idioma.
2. Saída: formato e origem.
3. Visual e áudio: perfil, assets e voz.
4. Produção: engine, autonomia e assets de marca.

A duração não faz parte desse formulário.

O agente grava com:

```bash
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" channel new studio-a \
  --name "Studio A" \
  --content "<a sua frase>" \
  --language pt-BR \
  --format 16:9 \
  --profile minimal \
  --source generated \
  --voice tts \
  --engine auto \
  --autonomy guided \
  --assets mixed
node "<skill>/scripts/rooster.mjs" channel design studio-a --from minimal --accent "#22d3ee"
node "<skill>/scripts/rooster.mjs" channel show studio-a
```

Depois mostra o resumo breve e para. Não cria vídeo ainda.

## Criar um projeto dentro do canal

A duração vem da edição. Só passe `--duration` se você tiver declarado um alvo:

```bash
node "<skill>/scripts/rooster.mjs" new video-x --channel studio-a
# opcional, apenas com alvo declarado
node "<skill>/scripts/rooster.mjs" new video-x --channel studio-a --duration 30
node "<skill>/scripts/rooster.mjs" open studio-a/video-x
```

Se você vai fornecer seus próprios arquivos, o agente cria e abre a pasta `assets/source/`.

Se o projeto for diferente do padrão do canal:

```bash
node "<skill>/scripts/rooster.mjs" new video-special --channel studio-a \
  --format 9:16 \
  --profile studio-a \
  --voice user
```

O `project.json` registra `channel` e `overrides`, então dá para ver o que veio do canal e o que foi decisão do projeto. `format.duration` fica `null` até você declarar um alvo ou até o plano/mídia definir o comprimento.

## Plano e progresso

Antes de criar a timeline, o agente grava `edit/plan.json` e roda `plan <slug>`, que gera `edit/plan.md`, `edit/plan.html` e `qa/plan-review.md`. Se o harness permitir exibir arquivos, ele abre o HTML no preview; se não, mostra o resumo no chat. O pedido de aprovação vem com o marcador de etapa, por exemplo: **"Etapa 4/8 - Plano pronto. Posso seguir com a timeline?"**

Por padrão o plano usa `editMode: "cleanup"`: mantém o vídeo inteiro e corta só silêncio, vícios de fala, falsos começos e retakes abandonados. O comando `tighten <slug>` propõe esses cortes a partir do áudio, mantém um respiro natural de 0,4 s, deixa 100 ms antes da próxima fala e respeita `plan.protect`. O `silence <slug>` continua como fallback quando o áudio não pode ser analisado. Uma versão encurtada (`condensed`, com `keeps`) só acontece se você pedir explicitamente.

As oito etapas são: ambiente, intake, assets/transcrição, plano, timeline, build, preview/QA, render/entrega. O agente mostra a etapa atual e pergunta antes de avançar; timeline e render final não são aprovados na mesma pergunta. Comece em `guided` nos primeiros vídeos e mude para `auto` quando o estilo estiver estável.

Na etapa 6, antes de criar o projeto do engine, o agente pergunta como montar: **HyperFrames** (padrão, já pronto), **Remotion** (React/3D; precisa de `npm install` com a sua permissão) ou **FilmCraft** (timeline editável; precisa conectar o MCP e reiniciar o agente). Se você já escolheu um engine, ele só confirma; se você disse "auto", ele decide e explica. Nada é instalado nem configurado sem a sua autorização.

O plano precisa incluir a camada criativa: elementos visuais, b-roll e música, ou uma justificativa explícita para omitir. **Só corte não conta como vídeo final.** O `build` recusa um plano só de corte ou sem decisão de música; registre a exceção em `notes` ou use `--allow-cut-only` / `--allow-no-music` quando for intencional.

Antes do build completo, peça `build <slug> --sample 3`: o agente gera só três elementos representativos para você aprovar o motion e a tipografia. Depois do OK, rode o build completo com `--force`.

Na revisão final, abra `preview/index.html` (rode `preview <slug>`) e rode `textcheck <slug>` para listar todos os textos em tela. Assista ao draft inteiro uma vez e confira os cortes de áudio antes do render final.

As camadas avançadas — legendas, motion, áudio, reframe, entrega, cor, b-roll, gráficos, TTS e multicâmera — estão indexadas em [`references/professional-elements.md`](../references/professional-elements.md). O `SKILL.md` só aponta para esse índice.

## Precedência

```text
projeto > canal > workspace/global > built-in
```

O projeto manda em tudo. O canal é o contexto estável; não há camada de categoria.

## O que não perguntar

- “Onde fica o rooster?” — o padrão é `./rooster`; a pasta é criada junto com o canal.
- “Quer configurar o workspace agora?” — o workspace é detalhe de implementação; pergunte pelo canal.
- Perguntar só o que o canal produz — peça o nome e o conteúdo juntos, na mesma mensagem que explica a pasta.
- Exemplos ou opções prontas de assunto na pergunta do canal — deixe o usuário descrever.
- Um questionário com 12 campos — pergunte só o que o canal produz e infira o resto.
- Duração do canal ou duração padrão do projeto — a duração é resultado da edição.
- Transformar o vídeo em um highlight sem você pedir — o padrão é limpeza (só silêncio e vícios).
- Categoria, preset ou receita — esse conceito não existe.
- As mesmas perguntas do canal em todo projeto — herde e confirme só o que mudou.

## Mudar depois

```bash
node "<skill>/scripts/rooster.mjs" channel set studio-a format 9:16
node "<skill>/scripts/rooster.mjs" channel set studio-a assets.strategy user
node "<skill>/scripts/rooster.mjs" channel design studio-a --force --accent "#e4572e"
node "<skill>/scripts/rooster.mjs" channel use studio-a
```

Ou, por projeto, edite `project.json` e os overrides.
