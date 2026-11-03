# RoosterEdit

**Um estúdio de vídeo para agentes.**

[![Status](https://img.shields.io/badge/status-alpha-orange)](#status)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![Engines](https://img.shields.io/badge/engines-HyperFrames%20%7C%20Remotion-blue)](#motores)
[![License](https://img.shields.io/badge/license-MIT-black)](LICENSE)

RoosterEdit é uma skill que planeja, edita e renderiza vídeos completos com agentes de IA. Ela organiza o workspace, transcreve o material, cria um plano de edição, aplica cortes, gera o projeto no motor escolhido, pré-visualiza no browser, faz QA e entrega o pacote final.

> **Status:** alpha (v0.1). O fluxo principal está testado com **HyperFrames** e **Remotion**; APIs e templates podem mudar.

## Status

- **Testado:** transcrição HyperFrames/Parakeet, `plan`, `build` HyperFrames, `build` Remotion, render real dos dois motores.
- **Em desenvolvimento:** build mais rico (b-roll, gráficos, listas, 3D), preview unificado e wrappers de render.
- **Fora do v1:** NLE completo, geração de vídeo por modelos, cloud render e upload automático.

## O que já funciona

- [x] Workspace com **canais**, projetos, perfis, categorias e biblioteca.
- [x] `doctor` detecta Node, FFmpeg, HyperFrames, Whisper, `yt-dlp`, browser e GPU.
- [x] Onboarding por **canal** (`channel new/set`) com idioma, formato, perfil, assets, engine e autonomia.
- [x] Projetos herdam o canal e podem sobrescrever qualquer padrão.
- [x] `profile` e `category` com `list`, `show` e `fork`.
- [x] Estratégias de assets: arquivos do usuário, links autorizados, biblioteca, gerado, nenhum ou misto.
- [x] `digest` para ler a transcrição em partes, sem carregar o JSON inteiro.
- [x] Transcrição via **HyperFrames/Parakeet** ou **Whisper** → `edit/transcript.json`.
- [x] Plano de edição `edit/plan.json` com cortes, elementos, capítulos e **gate de aprovação**.
- [x] `build` para **HyperFrames** e **Remotion**, aplicando cortes e remapeando os tempos.
- [x] Ingestão de links via `yt-dlp` com confirmação de direitos.
- [x] Perfis visuais reutilizáveis (`minimal`, `tech-neon`, `3d-cartoon`).
- [x] Categorias de conteúdo (`talking-head`, `faceless-explainer`, `3d-cartoon`).
- [x] Render real validado nos dois motores.

## Instalação

### Com um agente

Copie o prompt abaixo e cole no agente (OpenCode, Claude Code, Codex etc.):

```text
Instale a skill RoosterEdit neste projeto e valide o ambiente.

1. Clone o repositório na pasta de skills do projeto:
   git clone https://github.com/WesleyQDev/RoosterEdit.git .opencode/skills/rooster-edit

   Se você usa Claude Code/Codex em vez de OpenCode, clone em
   .claude/skills/rooster-edit ou .agents/skills/rooster-edit.

2. Confirme que existe .opencode/skills/rooster-edit/SKILL.md.
3. Rode:
   node .opencode/skills/rooster-edit/scripts/rooster.mjs doctor --json
4. Me mostre o resultado do doctor em linguagem simples.
5. Se faltar Node.js, FFmpeg ou FFprobe, me peça permissão antes de instalar
   qualquer coisa e explique o comando.
6. Não crie workspace, projeto ou vídeo ainda. Nesta etapa, só instale a skill
   e valide o ambiente.
7. No fim, me explique:
   - o que é a skill;
   - como pedir um vídeo;
   - quais comandos eu posso rodar sozinho;
   - o que ainda precisa ser instalado (Whisper, HyperFrames, etc.).
```

O prompt também está em [`templates/install-prompt.pt-BR.md`](templates/install-prompt.pt-BR.md). Instruções detalhadas em [`docs/INSTALL.md`](docs/INSTALL.md).

### Manual

```bash
# projeto local
git clone https://github.com/WesleyQDev/RoosterEdit.git .opencode/skills/rooster-edit

# global no OpenCode
git clone https://github.com/WesleyQDev/RoosterEdit.git ~/.config/opencode/skills/rooster-edit
```

Verifique:

```bash
node .opencode/skills/rooster-edit/scripts/rooster.mjs doctor --json
```

## Primeira execução

Depois de instalar, o ideal é configurar **um canal**, não o workspace inteiro. O workspace é `./rooster`; você não precisa escolher onde ele fica.

```bash
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" channel new en-tech \
  --name "EN Tech" \
  --language en \
  --format 16:9 \
  --profile tech-neon \
  --category faceless-explainer \
  --voice tts \
  --assets mixed
node "<skill>/scripts/rooster.mjs" channel list
```

O agente pergunta em um bloco (usando a tool de formulário do harness quando existir), grava os defaults do canal e para. Só cria um projeto quando você pedir. Guia completo em [`docs/FIRST-RUN.md`](docs/FIRST-RUN.md).

## Assets

| Estratégia | O que faz |
|---|---|
| `user` | Só arquivos que você fornece |
| `link` | Links autorizados baixados via `yt-dlp` |
| `library` | Música, SFX, fontes, overlays e b-roll do workspace/global |
| `generated` | Imagens/TTS/vídeo gerados por IA, com permissão |
| `none` | Sem assets externos; só texto e motion graphics |
| `mixed` | Tudo acima, com consentimento por ação |

Hoje a skill baixa links autorizados, mas **não busca stock automaticamente**. A política pode vir do canal (`channel.json`) ou ser sobrescrita no projeto (`project.json`). Detalhes em [`docs/ASSETS.md`](docs/ASSETS.md).

## Otimização de tokens

O trabalho de vídeo gasta tokens naturalmente. Para manter a qualidade sem inflar o contexto:

- redirecione logs de render/check para arquivo e leia só o final;
- use `digest` em vez do `transcript.json` completo;
- use `plan --show` em vez do JSON cru;
- inspecione 3–5 frames, não todos;
- renderize draft uma vez e o final só depois da aprovação.

Guia completo em [`docs/TOKEN-OPTIMIZATION.md`](docs/TOKEN-OPTIMIZATION.md).

## Quick start

```bash
# 1. workspace e canal
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" channel new en-tech \
  --language en \
  --format 16:9 \
  --profile tech-neon \
  --category faceless-explainer

# 2. crie o projeto dentro do canal
node "<skill>/scripts/rooster.mjs" new video-x --channel en-tech --duration 60

# 3. coloque o vídeo em rooster/channels/en-tech/projects/video-x/assets/source/
# 4. transcreva
node "<skill>/scripts/rooster.mjs" transcribe en-tech/video-x --model small --language en

# 5. crie edit/plan.json e mostre o plano
node "<skill>/scripts/rooster.mjs" plan en-tech/video-x --show

# 6. depois da aprovação, gere o projeto
node "<skill>/scripts/rooster.mjs" build en-tech/video-x --engine hyperframes
# ou
node "<skill>/scripts/rooster.mjs" build en-tech/video-x --engine remotion
```

Depois do build:

```bash
# HyperFrames
cd rooster/channels/en-tech/projects/video-x/engine/hyperframes
npx hyperframes check
npx hyperframes preview
npx hyperframes render --quality draft -o ../../renders/draft.mp4

# Remotion
cd rooster/channels/en-tech/projects/video-x/engine/remotion
npm install
npx remotion studio
npx remotion render src/index.ts RoosterVideo ../../renders/final.mp4
```

## Fluxo

```text
doctor → new → assets/source → transcribe → edit/transcript.json
      → edit/plan.json → aprovação → build → preview → QA → render
```

O **plano é o gate**. Nada de timeline, engine ou render antes do OK do usuário. O `build` aplica os cortes com FFmpeg, remapeia os tempos dos elementos e gera o projeto do motor escolhido.

## Motores

| Motor | Melhor para | Como usar |
|---|---|---|
| **HyperFrames** | HTML/CSS/GSAP, motion graphics, kinetic type, charts, maps, 3D em HTML, explainers e social | `build --engine hyperframes` + `npx hyperframes` |
| **Remotion** | React, componentes, dados, `@remotion/three`, 3D, Player e Lambda | `build --engine remotion` + `npx remotion` |
| **FFmpeg** | Utilitário de mídia: probe, cortes, legendas, mix e assembly | usado internamente pelo `build` e pelo pipeline |

Os dois motores criativos são HyperFrames e Remotion. FFmpeg não é um terceiro motor criativo.

## Canais, perfis e categorias

**Channel** = grupo estável de marca/audiência/operação. Guarda idioma, formato, perfil, categoria, assets, engine, autonomia e voz. Todo projeto vive dentro de um canal.

**Profile** = identidade visual/sonora reutilizável: cores, tipografia, motion, legendas, áudio, componentes.

**Category** = receita de conteúdo: beats, duração, aspect, voz, legendas, música, assets obrigatórios e QA.

Built-ins:

- Perfis: `minimal`, `tech-neon`, `3d-cartoon`.
- Categorias: `talking-head`, `faceless-explainer`, `3d-cartoon`.

Precedência: **projeto > canal > categoria (sugestão) > workspace > global (`~/.rooster`) > built-in**.

## Estrutura

```text
RoosterEdit/
├── SKILL.md                  # instruções da skill (inglês)
├── references/               # referências internas (inglês)
├── scripts/                  # CLI e sync
├── templates/                # perfis, categorias, prompts, plan example
├── agents/                   # papéis opcionais de subagents
├── docs/                     # documentação humana (pt-BR)
├── examples/                 # projetos de exemplo (planejado)
└── evals/                    # casos de teste
```

Workspace do usuário:

```text
rooster/
├── channels/<canal>/
│   ├── channel.json
│   ├── projects/<slug>/
│   │   ├── project.json
│   │   ├── brief.md
│   │   ├── style.md
│   │   ├── assets/{source,generated,licensed}/
│   │   ├── edit/{transcript.json,plan.json,edl.json,timeline.json,captions/}
│   │   ├── engine/{hyperframes|remotion}/
│   │   ├── preview/
│   │   ├── renders/
│   │   └── qa/
│   ├── profiles/
│   ├── categories/
│   ├── assets/
│   └── library/
├── profiles/       # compartilhados
├── categories/     # compartilhadas
└── library/{music,sfx,fonts,overlays,luts,broll,images}/
```

## Comandos

| Comando | O que faz |
|---|---|
| `doctor` | Detecta ambiente, engines, TTS, Whisper, yt-dlp e workspace |
| `init` | Cria o workspace e o canal `default` |
| `channel` | Cria, lista, mostra e configura canais |
| `new` | Cria um projeto dentro de um canal, com overrides opcionais |
| `ingest` | Copia arquivo local ou baixa link autorizado com `yt-dlp` |
| `transcribe` | Transcreve com HyperFrames/Parakeet, faster-whisper ou Whisper |
| `digest` | Mostra a transcrição em partes, sem carregar o JSON inteiro |
| `plan` | Valida e mostra `edit/plan.json` |
| `build` | Gera o projeto HyperFrames ou Remotion a partir do plano |
| `check` | Valida projeto, timeline, manifest e plano |
| `profile` | Lista, mostra e cria forks de perfis |
| `category` | Lista, mostra e cria forks de categorias |
| `preview` | Mostra o caminho/comando de preview do engine |
| `render` | Mostra o comando de render do engine |

Use `--help` para todas as opções.

## Desenvolvimento

```bash
npm run doctor     # ambiente
npm run validate   # SKILL.md + JSONs
npm run sync       # cópia local para .opencode/skills/rooster-edit
```

O repo não tem dependências de runtime além de Node, FFmpeg e dos motores. O CLI usa apenas módulos nativos do Node.

## Testado

O fluxo principal foi exercitado de ponta a ponta com uma amostra pública de áudio:

- **Transcrição** HyperFrames/Parakeet → 3 segmentos, 22 palavras com timestamps.
- **Plano** validado com `plan --show` → 0 erros.
- **Build HyperFrames** → MP4 9,44s, 1920×1080, 30 fps, H.264/AAC.
- **Build Remotion** → MP4 9,472s, 1920×1080, 30 fps, H.264/AAC.
- Cortes aplicados e tempos dos elementos remapeados nos dois motores.

Detalhes e limites em [`docs/TESTING.md`](docs/TESTING.md).

## Documentação

- [`docs/INSTALL.md`](docs/INSTALL.md) — instalação e troubleshooting.
- [`docs/FIRST-RUN.md`](docs/FIRST-RUN.md) — configuração inicial do workspace.
- [`docs/ASSETS.md`](docs/ASSETS.md) — estratégias de assets e direitos.
- [`docs/TOKEN-OPTIMIZATION.md`](docs/TOKEN-OPTIMIZATION.md) — como gastar menos contexto sem perder qualidade.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — arquitetura, fluxo e decisões.
- [`docs/WORKSPACE.md`](docs/WORKSPACE.md) — organização do workspace.
- [`docs/TESTING.md`](docs/TESTING.md) — resultados dos testes.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — próximas fases.

## Créditos

- [Como editar vídeos com IA usando o Claude Code](https://www.youtube.com/watch?v=EIj7WPiKmOE) — Marcos Lemos. Inspiração para o fluxo de 6 etapas: estilo, transcrição, plano, elementos, montagem e revisão.
- [Fábrica de animações 3D só com o Claude](https://www.youtube.com/watch?v=u6du22ySnC4) — diegokk. Inspiração para o pipeline 3D com Three.js.
- [HyperFrames](https://github.com/heygen-com/hyperframes) e [Remotion](https://www.remotion.dev) — motores de render.

O RoosterEdit não copia o conteúdo dos vídeos; ele sintetiza os fluxos em uma skill própria, com estrutura, perfis e categorias adaptados.

## Licença

MIT. Veja [`LICENSE`](LICENSE).
