# Primeira execução

Depois de instalar, o ideal é configurar o workspace criando **um canal**. O workspace é a pasta `rooster/` no diretório atual; você não precisa escolher onde ele fica.

A instalação termina com um resumo curto e uma pergunta: **“Quer configurar o workspace agora?”** Só depois do seu sim o agente cria a pasta `rooster/` e o primeiro canal. Se você disser não, nada é criado.

## O conceito

```text
Workspace → Canal → Projeto
```

- **Workspace** = a pasta `rooster/`. Infraestrutura e biblioteca compartilhada.
- **Canal** = padrão de produção estável para uma marca, audiência ou operação. Guarda conteúdo, idioma, formato, duração, perfil, assets, engine, autonomia e voz.
- **Perfil** = identidade visual.
- **Projeto** = um vídeo dentro de um canal. Herda os padrões e pode sobrescrever qualquer coisa.

Exemplo: canal **EN Tech** (inglês, 16:9, tech-neon, TTS) e canal **PT Criador** (pt-BR, 1:1, minimal, voz do usuário).

Não existe categoria separada. O campo `content` do canal registra o que ele produz, e cada projeto define a própria estrutura em `brief.md`, `script.md` e `edit/plan.json`.

## O que o agente pergunta

Depois do seu “sim” para configurar o workspace, o agente faz um setup rápido com **uma pergunta**:

> **“O que esse canal vai produzir? Uma frase basta — por exemplo: ‘shorts de tecnologia em português’ ou ‘entrevistas de 90s para o YouTube’.”**

Com essa frase, ele infere o resto: nome, idioma, formato, origem, perfil visual, assets, engine, autonomia e voz. Depois mostra um resumo curto:

> **“Vou criar `pt-tech` com: pt-BR · 9:16 · tech-neon · TTS · assets mixed · engine auto · guided. Está bom ou quer ajustar algo?”**

Se você confirmar, ele cria o canal e para. Se quiser mudar algo, é só dizer. Os campos avançados continuam disponíveis, mas não são perguntados de uma vez.

**Duração não é padrão do canal.** Cada vídeo define a sua quando o projeto é criado.

## Configuração avançada (só se você pedir)

Se quiser controlar tudo, o agente pergunta em grupos de no máximo três:

1. Identidade: nome, conteúdo e idioma.
2. Saída: formato e origem.
3. Visual e áudio: perfil, assets e voz.
4. Produção: engine, autonomia e assets de marca.

O agente grava com:

```bash
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" channel new en-tech \
  --name "EN Tech" \
  --content "English tech explainers" \
  --language en \
  --format 16:9 \
  --profile tech-neon \
  --source generated \
  --voice tts \
  --engine auto \
  --autonomy guided \
  --assets mixed
node "<skill>/scripts/rooster.mjs" channel show en-tech
```

Depois mostra o resumo e para. Não cria vídeo ainda.

## Criar um projeto dentro do canal

A duração é definida aqui, por vídeo. Se você vai fornecer seus próprios arquivos, o agente cria e abre a pasta `assets/source/`:

```bash
node "<skill>/scripts/rooster.mjs" new video-x --channel en-tech --duration 60
node "<skill>/scripts/rooster.mjs" open en-tech/video-x
```

Se o projeto for diferente do padrão do canal:

```bash
node "<skill>/scripts/rooster.mjs" new video-special --channel en-tech \
  --format 9:16 \
  --profile brutalist \
  --voice user
```

O `project.json` registra `channel` e `overrides`, então dá para ver o que veio do canal e o que foi decisão do projeto.

## Plano e progresso

Antes do plano, o agente pode rodar `styleproof <slug>` e abrir `style/proof/index.html` com três frames de amostra (hook, dado e legenda). Aprove o look nessa etapa: mudar cor e tipografia depois do build é caro.

Antes de criar a timeline, o agente grava `edit/plan.json` e roda `plan <slug>`, que gera `edit/plan.md`, `edit/plan.html` e `qa/plan-review.md`. Se o harness permitir exibir arquivos, ele abre o HTML no preview; se não, mostra o resumo no chat. O pedido de aprovação vem com o marcador de etapa, por exemplo: **"Etapa 4/8 - Plano pronto. Posso seguir com a timeline?"**

As oito etapas são: ambiente, intake, assets/transcrição, plano, timeline, build, preview/QA, render/entrega. O agente mostra a etapa atual e pergunta antes de avançar; timeline e render final não são aprovados na mesma pergunta. Comece em `guided` nos primeiros vídeos e mude para `auto` quando o estilo estiver estável.

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

- “Onde fica o rooster?” — o padrão é `./rooster`; só pergunte se o usuário quiser outro caminho.
- Um questionário com 12 campos — pergunte só o que o canal produz e infira o resto.
- Duração do canal — a duração é sempre do vídeo, não do canal.
- Categoria, preset ou receita — esse conceito não existe.
- As mesmas perguntas do canal em todo projeto — herde e confirme só o que mudou.

## Mudar depois

```bash
node "<skill>/scripts/rooster.mjs" channel set en-tech format 9:16
node "<skill>/scripts/rooster.mjs" channel set en-tech assets.strategy user
node "<skill>/scripts/rooster.mjs" channel use en-tech
```

Ou, por projeto, edite `project.json` e os overrides.
