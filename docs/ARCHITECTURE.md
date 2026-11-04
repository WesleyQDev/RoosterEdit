# Arquitetura do RoosterEdit

> Documento de planejamento. A skill em si (`SKILL.md`) e as referências internas ficam em inglês; esta documentação humana fica em português.

## 1. Visão

RoosterEdit é uma **camada de direção e organização** para produção de vídeo com agentes. Ela não tenta substituir Remotion, HyperFrames ou FFmpeg. Ela decide o que fazer, organiza os assets, escreve o plano, escolhe o motor, conduz a implementação, revisa o resultado e entrega o pacote final.

O modelo mental:

```text
Intenção + assets + restrições
            │
            ▼
      ┌─────────────┐
      │ RoosterEdit │  direção, organização, QA
      └─────────────┘
            │
   ┌────────┼──────────────┬──────────────┐
   ▼        ▼              ▼              ▼
Remotion  HyperFrames  FFmpeg   FilmCraft (opcional)
```

## 2. Decisões fechadas

| Decisão | Valor |
|---|---|
| Local da skill instalável | Raiz do repositório |
| Engine padrão | `auto` |
| Motores criativos | HyperFrames e Remotion; FFmpeg é utilitário de mídia |
| Timeline | Review unificado + estúdios nativos; FilmCraft é um alvo de timeline opcional |
| FilmCraft | Opt-in (`--target filmcraft`), nunca default; monta um `.fcproj` editável |
| Geração de mídia no v1 | Código + TTS + assets do usuário; image/video gen plugável |
| Idioma | `SKILL.md` e referências em inglês; docs humanos em pt-BR |
| Workspace local | `rooster/` no projeto |
| Biblioteca global | `~/.rooster/` (opcional) |
| Precedência | projeto > workspace > global > built-in |

## 2.1 Inspiração no vídeo de referência

O fluxo de 6 etapas do vídeo "Como editar vídeos com IA usando o Claude Code" (Marcos Lemos) inspira o **caminho rápido** do RoosterEdit: preparar ferramentas, organizar o material, criar um guia de estilo, transcrever com Whisper, montar um plano de edição, mostrar o plano para aprovação, criar os elementos visuais e montar no HyperFrames ou no Remotion. Opcionalmente, a timeline final pode ser entregue ao FilmCraft para edição.

O que **não** copiamos: os nomes das pastas e a estrutura rígida do vídeo. O RoosterEdit usa o workspace próprio:

| Vídeo de referência | RoosterEdit |
|---|---|
| `bruto/` | `channels/<canal>/projects/<slug>/assets/source/` |
| `estilo/ESTILO.md` | `channels/<canal>/projects/<slug>/style.md` + profile resolvido |
| `trabalho/transcricao.json` | `channels/<canal>/projects/<slug>/edit/transcript.json` |
| `trabalho/plano.json` | `channels/<canal>/projects/<slug>/edit/plan.json` |
| `final/` | `channels/<canal>/projects/<slug>/renders/` |

A sequência é parecida; a organização é nossa. O plano em `edit/plan.json` é o gate mais importante: nada de timeline, engine ou render antes da aprovação.

Detalhes em `references/video-pipeline.md` e `references/edit-plan.md`.

## 3. Estrutura do repositório

```text
RoosterEdit/
├── SKILL.md
├── references/
│   ├── workflow.md
│   ├── intake.md
│   ├── engines.md
│   ├── profiles.md
│   ├── timeline.md
│   ├── qa.md
│   ├── nle-handoff.md
│   ├── harness.md
│   └── schemas.md
├── scripts/
│   ├── rooster.mjs
│   ├── lib/
│   ├── features/
│   └── sync-skill.mjs
├── templates/
│   ├── profiles/
│   └── engines/
├── agents/
│   ├── _handoff.md
│   ├── producer.md
│   ├── researcher.md
│   ├── transcript-analyst.md
│   ├── scriptwriter.md
│   ├── art-director.md
│   ├── editor.md
│   ├── audio-director.md
│   ├── engineer.md
│   └── qa.md
├── docs/
├── examples/
├── evals/
└── .opencode/skills/rooster-edit/   # cópia gerada para descoberta local
```

### Por que a skill fica na raiz

O repositório inteiro é o pacote da skill. Isso simplifica a instalação e a publicação: quem copiar o repo para `~/.config/opencode/skills/rooster-edit` ou `.opencode/skills/rooster-edit` leva tudo junto. A pasta `.opencode/skills/rooster-edit` é apenas uma cópia de desenvolvimento, gerada por `scripts/sync-skill.mjs`, para o OpenCode descobrir a skill enquanto ela é editada.

## 3.1 Modelo de canais

O workspace é dividido em **canais**. Um canal é o padrão de produção estável de marca/audiência/operação e guarda os defaults criativos:

```json
{
  "schema": "rooster.channel/v1",
  "id": "en-tech",
  "name": "EN Tech",
  "content": "English tech explainers",
  "language": "en",
  "format": "16:9",
  "profile": "tech-neon",
  "source": "generated",
  "voice": "tts",
  "engine": "auto",
  "autonomy": "guided",
  "assets": {
    "strategy": "mixed",
    "allowDownload": true,
    "allowGenerate": false,
    "licensePolicy": "strict"
  }
}
```

Precedência: **projeto > canal > workspace/global > built-in**.

- **Canal**: conteúdo, idioma, formato default, perfil, assets, engine, autonomia, voz.
- **Projeto**: herda o canal, define a própria duração e registra apenas os overrides.

Não existe camada de categoria. O que o canal produz fica em `content`; a estrutura de cada vídeo fica no brief, no script e em `edit/plan.json`.

Todo projeto novo fica em `channels/<canal>/projects/<slug>/`. O `projects/` na raiz é legado.

## 4. Workspace do usuário

O workspace é criado no projeto onde o vídeo será produzido, não no repositório da skill. O desenho abaixo mostra a forma do workspace e de um projeto dentro de um canal.

```text
rooster/
├── workspace.json
├── config.json
├── README.md
├── channels/
│   └── <canal>/
│       ├── channel.json
│       ├── projects/
│       │   └── <slug>/
│       │       ├── project.json
│       │       ├── brief.md
│       │       ├── script.md
│       │       ├── style.md
│       │       ├── style/
│       │       │   └── proof/
│       │       ├── storyboard/
│       │       │   ├── storyboard.json
│       │       │   └── frames/
│       │       ├── assets/
│       │       │   ├── source/
│       │       │   ├── generated/
│       │       │   ├── licensed/
│       │       │   └── manifest.json
│       │       ├── edit/
│       │       │   ├── transcript.json
│       │       │   ├── digest.md
│       │       │   ├── analysis.json
│       │       │   ├── plan.json
│       │       │   ├── plan.md
│       │       │   ├── plan.html
│       │       │   ├── timeline.json
│       │       │   ├── edl.json
│       │       │   ├── captions/
│       │       │   ├── audio/
│       │       │   └── export/
│       │       ├── engine/
│       │       │   ├── hyperframes/
│       │       │   ├── remotion/
│       │       │   ├── filmcraft/
│       │       │   │   ├── <slug>.fcproj
│       │       │   │   ├── assets/
│       │       │   │   ├── hyperframes/
│       │       │   │   ├── remotion/
│       │       │   │   ├── elements/
│       │       │   │   └── archive/
│       │       │   └── ffmpeg/
│       │       ├── work/
│       │       │   ├── handoffs/
│       │       │   ├── logs/
│       │       │   ├── scratch/
│       │       │   ├── notes/
│       │       │   └── filmcraft.json
│       │       ├── preview/
│       │       ├── renders/
│       │       ├── qa/{report.md,text-review.md,frames/}
│       │       └── review.md
│       ├── profiles/
│       ├── assets/
│       └── library/
├── profiles/
│   └── <id>/
├── library/
│   ├── music/
│   ├── sfx/
│   ├── fonts/
│   ├── overlays/
│   ├── luts/
│   ├── broll/
│   └── images/
└── cache/          # inclui cache/elements/ (clipes de elemento)
```

### Biblioteca global

```text
~/.rooster/
├── config.json
├── profiles/
└── library/
```

A biblioteca global é opcional. Ela existe para o usuário reutilizar perfis, fontes, músicas e overlays entre projetos. A resolução é:

1. Overrides do projeto (`project.json`)
2. Perfis do workspace (`rooster/profiles`)
3. Perfis globais (`~/.rooster/profiles`)
4. Built-ins da skill (`templates/profiles`)

### Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `ROOSTER_WORKSPACE` | Caminho do workspace (default: `./rooster`) |
| `ROOSTER_HOME` | Caminho da biblioteca global (default: `~/.rooster`) |
| `ROOSTER_PROFILE` | Perfil default |
| `ROOSTER_ENGINE` | Engine default (`auto`, `hyperframes`, `remotion`, `ffmpeg`) |
| `ROOSTER_FILMCRAFT_CLI` | Caminho do `filmcraft-cli` (opcional) |
| `ROOSTER_TTS_PROVIDER` | Provider de TTS default |
| `ROOSTER_BROWSER` | `available` / `unavailable` / `unknown` |

## 5. Profiles

Um profile é a identidade visual e sonora reutilizável. Ele deve ser específico o suficiente para guiar decisões, mas genérico o suficiente para servir a vários vídeos.

```text
profiles/<id>/
├── profile.json
├── STYLE.md
├── assets/
│   ├── logo.svg
│   ├── fonts/
│   ├── textures/
│   └── luts/
├── components/
│   ├── remotion/
│   └── hyperframes/
└── examples/
```

Exemplo de `profile.json`:

```json
{
  "schema": "rooster.profile/v1",
  "id": "tech-neon",
  "name": "Tech Neon",
  "description": "Dark tech, cyan/magenta, grid, kinetic type",
  "extends": "base",
  "scope": "workspace",
  "tokens": {
    "colors": {
      "bg": "#060913",
      "fg": "#f8fafc",
      "muted": "#94a3b8",
      "accent": "#22d3ee",
      "accent2": "#f472b6"
    },
    "typography": {
      "display": { "family": "Space Grotesk", "weight": 700 },
      "body": { "family": "Inter", "weight": 400 },
      "mono": { "family": "JetBrains Mono", "weight": 500 }
    },
    "radius": 12,
    "spacing": 8,
    "motion": {
      "ease": "power3.out",
      "fast": 0.18,
      "normal": 0.35,
      "slow": 0.6
    }
  },
  "captions": {
    "mode": "burned",
    "font": "Inter",
    "weight": 700,
    "size": 42,
    "color": "#ffffff",
    "stroke": "#000000",
    "position": "bottom",
    "maxCharsPerLine": 32
  },
  "audio": {
    "loudnessLufs": -14,
    "music": "synthwave",
    "sfx": "digital"
  },
  "prompts": {
    "style": "dark tech, cyan and magenta rim light, volumetric fog, clean geometry",
    "negative": "clutter, warm tones, handwritten type"
  },
  "engines": {
    "preferred": "hyperframes",
    "supported": ["hyperframes", "remotion"]
  }
}
```

Regras:

- `extends` permite herdar de `base` ou de outro perfil.
- `scope` indica se o perfil é `project`, `workspace` ou `global`.
- `rooster profile fork <id> --as <novo>` cria uma cópia editável.
- Perfis nunca devem conter assets sem licença documentada.

## 6. Project

O projeto é a instância concreta. Ele combina channel + profile + overrides.

```json
{
  "schema": "rooster.project/v1",
  "slug": "meu-video",
  "name": "Meu Vídeo",
  "channel": "en-tech",
  "profile": "tech-neon",
  "engine": "auto",
  "timeline": "none",
  "language": "en",
  "overrides": ["format", "voice"],
  "mode": {
    "source": "generated",
    "voice": "tts",
    "style": "profile",
    "autonomy": "guided"
  },
  "format": {
    "aspect": "16:9",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "duration": 60
  },
  "audio": {
    "loudnessLufs": -14,
    "music": true
  },
  "captions": {
    "enabled": true,
    "mode": "burned"
  },
  "status": "intake",
  "createdAt": "2026-11-03T00:00:00.000Z"
}
```

Status possíveis: `intake`, `planning`, `assets`, `building`, `preview`, `qa`, `rendering`, `done`, `blocked`.

`timeline` aceita `none` ou `filmcraft`. Quando é `filmcraft`, `engine` registra o renderer dos elementos (`hyperframes` ou `remotion`), não um terceiro motor.

## 7. Fluxo de trabalho

### 7.0 Delegação por etapa

O agente principal é o diretor: mantém a conversa, o brief, as decisões e os gates. As etapas pesadas rodam em subagents com contexto descartável, definidos em `agents/` e coordenados por `references/subagents.md`.

| Etapa | Papel | O principal lê |
|---|---|---|
| Brief | `producer` | resumo + perguntas abertas |
| Pesquisa | `researcher` | achados + fontes + licenças |
| Transcrição/análise | `transcript-analyst` | handoff, nunca `transcript.json` |
| Roteiro | `scriptwriter` | hook + beats |
| Plano/timeline | `editor` | `plan.html` + riscos |
| Estilo/storyboard | `art-director` | tokens + cenas + assets |
| Áudio | `audio-director` | voz, música e mix |
| Build/render | `engineer` | status + caminhos + probe |
| QA | `qa` | veredito + evidências + frames |

Cada subagent grava o detalhe em disco e devolve um handoff curto em `work/handoffs/`; logs e rascunhos ficam em `work/logs/` e `work/scratch/`. O principal lê o handoff, vê o `plan.html` e 3–5 frames. Não lê transcrição bruta, código gerado, logs completos nem JSON gigante. Aprovação, licença e julgamento visual final continuam no principal.

O nome da ferramenta e do tipo de agente varia entre harnesses (OpenCode, Claude Code, Codex, etc.); o papel em `agents/` é o contrato. Sem agente com contexto novo, ou se o spawn falhar, a etapa roda inline com os mesmos arquivos.

Sem subagents, a etapa roda inline, mas os arquivos e o handoff continuam existindo. O protocolo completo está em `references/subagents.md`.

### 7.1 Doctor

`node scripts/rooster.mjs doctor --json` detecta:

- SO, arquitetura, Node, npm, Python, FFmpeg, FFprobe, Git, yt-dlp.
- Presença de HyperFrames, Remotion, Three.js no projeto.
- FilmCraft: CLI, app, versão, origem e registro do MCP (`filmcraft` no JSON).
- Browser disponível? (via `ROOSTER_BROWSER` ou convenção do harness)
- Subagents disponíveis? (o agente sabe; o CLI reporta `unknown`)
- Providers de TTS configurados (variáveis de ambiente e CLIs).
- GPU (NVIDIA via `nvidia-smi`).

O resultado é um objeto JSON estável, usado pela skill para escolher o caminho.

### 7.2 Intake

Perguntas que mudam o output:

1. Qual é o objetivo do vídeo?
2. Quem é o público?
3. Onde vai ser publicado? (YouTube, Shorts, Reels, TikTok, site, apresentação)
4. Qual a duração alvo?
5. Qual o formato? (16:9, 9:16, 1:1, custom)
6. Você tem footage real, quer gerar tudo ou um híbrido?
7. Você tem narração, quer TTS ou prefere sem fala?
8. Você tem assets próprios? (áudio, imagens, fontes, efeitos, logo, música)
9. Você tem um guia de estilo/perfil ou quer que a IA crie?
10. Qual o nível de autonomia? (auto, guided, manual)

Não perguntar tudo de uma vez. Perguntar só o que falta e o que muda a decisão.

### 7.3 Brief + script + beats

- `brief.md`: objetivo, público, plataforma, duração, tom, CTA, referências.
- `script.md` / `script.json`: falas, texto na tela, marcações de cena.
- `beats.json`: estrutura narrativa com timings.

### 7.4 Resolução de estilo

- `style: user` → usar guia/arquivos do usuário.
- `style: profile` → resolver perfil do workspace/global/built-in.
- `style: ai` → criar um guia novo a partir de referências e do brief.
- `style: reference` → extrair estilo de um vídeo/imagem de referência.

Gerar `style.md` com paleta, tipografia, motion, referências e prompts.

Depois de resolver o perfil, rodar `styleproof <slug>` para gerar `style/proof/index.html` com três frames (hook, dado, legenda/lower third). Aprovar o look antes do plano; mudar estilo depois do build é caro.

### 7.5 Assets

- Ingerir em `assets/source`, `assets/generated` ou `assets/licensed`.
- Gerar `assets/manifest.json` com hash, tipo, dimensões, duração, codec, licença e proveniência.
- Criar proxies e thumbnails para inspeção.
- Nunca apagar o original do usuário.

#### Ingestão de links (yt-dlp)

Quando o usuário manda um link de vídeo (YouTube, Vimeo, etc.) como material de origem, o RoosterEdit pode baixar o vídeo com `yt-dlp` para `assets/source/<slug>/`, junto com:

- `info.json` — título, autor, duração, capítulos, descrição, thumbnail;
- `thumbnail.jpg` — capa;
- `subtitles/*.srt` ou `.vtt` — legendas existentes e automáticas, quando disponíveis;
- `video.mp4` — arquivo principal, preferindo H.264/AAC para compatibilidade.

O fluxo deve:

1. Verificar se `yt-dlp` está instalado (`doctor`).
2. Perguntar/confirmar que o usuário tem direito de usar o conteúdo.
3. Baixar com limite de resolução e formato compatível.
4. Registrar URL, autor, licença declarada e data de download no manifest.
5. Nunca versionar cookies, tokens ou arquivos baixados no repositório da skill.

Comandos de referência (detalhes em `references/link-ingest.md`):

```bash
yt-dlp \
  --format "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/best" \
  --merge-output-format mp4 \
  --write-info-json \
  --write-thumbnail \
  --write-subs --write-auto-subs \
  --sub-langs "pt.*,en.*" \
  --sub-format srt \
  --output "assets/source/%(title)s/%(title)s.%(ext)s" \
  "<url>"
```

Para cortes específicos, usar `--download-sections "*00:01:20-00:02:10"` com moderação; alguns sites só entregam o arquivo completo. Para ambientes bloqueados, usar `--cookies-from-browser` localmente, nunca commitar o cookies.txt.

**Direitos e limites:** baixar apenas conteúdo próprio, com permissão, licença aberta ou domínio público. Não contornar DRM, paywall, login ou controle de acesso. Respeitar os termos da plataforma e as leis de copyright. O RoosterEdit não deve ser usado para reupload de conteúdo de terceiros.

### 7.6 Storyboard + timeline

- `storyboard/storyboard.json`: cenas, frames, duração, transições, overlays.
- `edit/timeline.json`: tracks, clips, scenes, captions, áudio e markers.
- O storyboard é aprovado antes do build.

### 7.7 Build

- Escolher o alvo: `build <slug> --target auto|hyperframes|remotion|filmcraft` (o default vem do projeto/canal).
- HyperFrames/Remotion: scaffold do projeto, cenas/componentes, 3D determinístico com Three.js e footage via EDL + FFmpeg.
- FilmCraft (`--target filmcraft`): build híbrido. O FFmpeg monta o corte e o mix de áudio; HyperFrames ou Remotion renderizam cada elemento visual como clipe separado com alpha; o FilmCraft monta o `.fcproj` editável.
- No FilmCraft, `--engine hyperframes|remotion` escolhe o renderer dos elementos; `auto` usa Remotion quando há elemento 3D e HyperFrames nos outros casos.

### 7.8 Preview

- `node scripts/rooster.mjs preview <slug>` escreve `preview/index.html` com player, plano, timeline, legendas, áudio, assets faltando e checklist de QA.
- Estúdios nativos: Remotion Studio ou HyperFrames preview.
- Com timeline FilmCraft, o `preview` aponta para `engine/filmcraft/<slug>.fcproj`; `timeline <slug> --open` abre no FilmCraft.
- Browser agents podem abrir, tirar screenshot e inspecionar console.

### 7.9 QA

Checklist técnico e editorial em `references/qa.md`:

- resolução, aspect, fps, duração;
- black frames, freeze frames;
- loudness, clipping, silêncio;
- cortes no meio de palavras;
- legendas: sync, leitura, safe area;
- textos em tela (`textcheck` e `qa/text-review.md`);
- safe areas: 90% action, 80% title;
- licenças e assets faltando;
- hook, ritmo, clareza, CTA, consistência de marca;
- assistir ao draft inteiro uma vez.

### 7.10 Render + entrega

- Draft rápido para revisão.
- Final em alta qualidade.
- Validar com FFprobe.
- Entregar MP4, SRT/VTT, thumbnail, metadata e arquivo do projeto.
- Com timeline FilmCraft, `render <slug> --draft|--final` exporta H.264 pelo FilmCraft; draft usa escala 0.5 e final usa o tamanho cheio.
- `export <slug>` para EDL/FCPXML quando o usuário quiser finalizar no DaVinci ou Premiere. Esse caminho continua independente do FilmCraft.

### 7.11 Learn

- Salvar perfil/componente reutilizável.
- Registrar decisões e feedback no `review.md`.
- Promover perfil local para global se o usuário quiser.

## 8. Engines

Os dois motores criativos são **HyperFrames** e **Remotion**. O FFmpeg é utilitário de mídia: probe, corte, legendas, mix e assembly. O FilmCraft é um alvo de timeline opcional, não um terceiro motor criativo.

| Engine | Melhor para | Evitar |
|---|---|---|
| HyperFrames | HTML/CSS/GSAP, motion graphics, kinetic type, charts, maps, 3D via Three.js, preview rápido | Projetos que já são React |
| Remotion | React, componentes complexos, dados, `@remotion/three`, Player, Lambda | Vídeos simples que só precisam de corte |
| FFmpeg | Corte de footage real, legendas queimadas, mix, assembly (utilitário) | Motion graphics complexo |

### FilmCraft (timeline opcional)

O FilmCraft não substitui HyperFrames nem Remotion e não é escolhido pelo `auto` por conta própria. Ele só é usado com `--target filmcraft` ou quando o projeto já registra `timeline: "filmcraft"`. O build é híbrido:

1. O FFmpeg monta o corte e o mix de áudio da base.
2. HyperFrames ou Remotion renderizam cada elemento visual como um clipe separado (MOV ProRes 4444 com alpha). O Remotion exige um `npm install` único em `engine/filmcraft/remotion`; o build informa esse caminho quando o CLI não está instalado.
3. O FilmCraft monta um `.fcproj` editável com o source em V1, o áudio mixado em A1, os elementos em V2+ e markers de capítulos, elementos e cortes.

O CLI é usado para builds determinísticos. O MCP/bridge serve para edição interativa e não é necessário para `build`. O FilmCraft é MIT/Apache-2.0, nativo em Windows/macOS/Linux, mas ainda alpha; o README do projeto reporta ~86% de cobertura de funcionalidades e ~56% de prontidão para uso real, e o Windows é menos testado.

### Regra de decisão (`auto`)

1. Se o usuário pediu um engine, use.
2. Se o projeto tem footage real e o corte é o núcleo, `ffmpeg` ou `remotion`.
3. Se o projeto é 3D/data-driven e já tem React, `remotion`.
4. Se o projeto é HTML/GSAP/motion graphics, `hyperframes`.
5. Se o ambiente não tem Node/FFmpeg, produza o plano e explique que o render precisa de Node/FFmpeg.
6. Se houver dúvida, prefira `hyperframes` para motion e `ffmpeg` para corte.
7. FilmCraft nunca é escolhido pelo `auto`; só entra por pedido explícito (`--target filmcraft`) ou projeto já configurado para ele.

## 9. Timeline

O `timeline.json` é engine-agnostic e serve para revisão, QA e geração de código.

```json
{
  "schema": "rooster.timeline/v1",
  "format": { "width": 1920, "height": 1080, "fps": 30, "duration": 60 },
  "tracks": [
    {
      "id": "v1",
      "kind": "video",
      "clips": [
        {
          "id": "clip-1",
          "src": "assets/source/entrevista.mp4",
          "in": 12.4,
          "out": 18.2,
          "start": 0,
          "end": 5.8,
          "speed": 1,
          "transitionIn": "cut"
        }
      ]
    },
    { "id": "ov1", "kind": "overlay", "clips": [] },
    { "id": "cap1", "kind": "captions", "clips": [] },
    { "id": "a1", "kind": "audio", "clips": [] },
    { "id": "m1", "kind": "music", "clips": [] }
  ],
  "scenes": [],
  "markers": []
}
```

### FilmCraft

`build --target filmcraft` grava `engine/filmcraft/<slug>.fcproj` e mantém `edit/timeline.json` como visão engine-agnostic. No `.fcproj`:

| Track | Conteúdo |
|---|---|
| V1 | source de vídeo, só vídeo (sem áudio); ausente quando o projeto é só áudio |
| A1 | áudio mixado pelo FFmpeg |
| V2+ | um clipe por elemento, em faixas sem sobreposição |
| markers | capítulos, elementos e cortes |
| captions | importadas de SRT/VTT em `edit/captions/` quando existem |

O estado fica em `work/filmcraft.json`. `--if-needed` compara plano, base, renderer e formato e pula quando nada mudou. Clipes inalterados vêm de `cache/elements/`; um elemento alterado usa `clip.replaceFromBin` quando a janela de tempo é a mesma; se a janela mudou, só aquele clipe é apagado e reposicionado. Uma base nova reposiciona apenas V1/A1 e preserva clipes do usuário nas outras tracks. `--force` arquiva o `.fcproj` anterior em `engine/filmcraft/archive/`; `--rebuild-media` força base e elementos.

Cuidados: `zoom` não vira clipe (aplica-se à base e é pulado com aviso); markers e legendas são criados no primeiro build e preservados depois; edições manuais em um clipe gerenciado (V1, A1 ou clipe de elemento) são sobrescritas quando aquele clipe muda, mas edições em outras tracks/clipes são preservadas; V1 e A1 são gerenciados em par, então recortar V1 à mão não move o mix de A1 (mude o plano e rebuild, ou remixe no FilmCraft); o `.fcproj` guarda caminhos absolutos, então mover a pasta quebra os links; só um processo deve escrever por vez (feche o FilmCraft durante o build); ProRes 4444 ocupa espaço e o GC do cache se aplica.

### Preview v1

- Página de review com:
  - player do engine (iframe ou player nativo);
  - timeline com tracks e playhead;
  - storyboard;
  - checklist de QA;
  - status do render.
- Endpoints JSON para agentes: `/api/project`, `/api/timeline`, `/api/status`.
- Atributos `data-testid` para automação.
- Modo `--static` para gerar HTML standalone em ambientes headless.

### v2

- Drag/trim no browser.
- Edição de propriedades de clip.
- Histórico de undo/redo.
- Colaboração.

## 10. Harness

A skill deve funcionar em ambientes muito diferentes. O `doctor` e a seção de harness definem o caminho.

| Capacidade | Com | Sem |
|---|---|---|
| Subagents | Isolar as etapas pesadas e devolver só handoffs | Rodar inline e manter o material bruto em arquivos |
| Browser | Preview, screenshots, console | Renderizar frames e ler imagens |
| Node | Remotion/HyperFrames | FFmpeg (cortes/áudio); sem render de motion |
| FFmpeg | Probe, corte, mix, render | Plano apenas; instalar FFmpeg ou usar outro ambiente |
| yt-dlp | Baixar links autorizados como material de origem | Pedir o arquivo ao usuário ou instalar com permissão |
| TTS | Gerar narração | Voz do usuário, legendas ou silêncio |
| GPU | 3D/render mais rápido | Render em CPU, reduzir qualidade |
| FilmCraft | Timeline editável + export H.264, opcional | Continuar em HyperFrames/Remotion |

## 11. Segurança e licenças

- Não executar comandos destrutivos sem confirmação.
- Não apagar assets originais.
- Registrar licença e proveniência de cada asset.
- Não usar músicas/fontes sem licença.
- Não baixar conteúdo protegido sem autorização.
- Não contornar DRM, paywall, login ou controle de acesso.
- Não commitar cookies, tokens ou arquivos baixados de terceiros.
- Não fazer upload automático para plataformas.
- Não baixar conteúdo protegido sem autorização.
- Respeitar limites de API e custos.

## 12. Fases

### Fase 1 — Fundação

- `SKILL.md` draft.
- Workspace, canais e profiles.
- CLI `doctor`, `init`, `new`, `list`, `check`.
- Schemas e docs.
- Sync local para OpenCode.

### Fase 2 - Pipeline de mídia

- `ingest` (arquivos e links via yt-dlp), `probe`, `transcribe`, `cut-plan`.
- `transcribe` implementado e testado com HyperFrames/Parakeet; falta o cut-plan automático.
- TTS adapter.
- Mix e loudness.
- Legendas.

### Fase 3 - Engines e timeline

- HyperFrames adapter (smoke test: init, check, render).
- Remotion adapter (smoke test: scaffold, still, render).
- Build automático de `edit/plan.json` para HyperFrames/Remotion (v1).
- Build mais rico: b-roll, gráficos, listas e 3D.
- FFmpeg adapter.
- FilmCraft como alvo opcional de timeline (`build --target filmcraft`, `timeline`, `render`).
- `preview` unificado.
- `render` e `package`.

### Fase 4 — 3D e qualidade

- Starter 3D (Three.js).
- Perfis completos.
- Exemplos.
- Evals e iteração com skill-creator.
- Empacotamento.

## 13. Fora de escopo no v1

- NLE completo no browser.
- Geração de vídeo por modelos (Veo/Kling/Runway) como core.
- Avatar/UGC gerado.
- Cloud render.
- Upload automático para YouTube/TikTok.
- Color grading avançado.
- Edição colaborativa em tempo real.
