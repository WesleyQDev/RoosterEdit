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

- [x] Workspace com projetos, perfis, categorias e biblioteca.
- [x] `doctor` detecta Node, FFmpeg, HyperFrames, Whisper, `yt-dlp`, browser e GPU.
- [x] Onboarding de workspace com `config set` para idioma, formato, perfil, assets, engine e autonomia.
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

Depois de instalar, o ideal é configurar o workspace **antes** do primeiro vídeo:

```bash
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" config set defaults.language pt-BR
node "<skill>/scripts/rooster.mjs" config set defaults.aspect 16:9
node "<skill>/scripts/rooster.mjs" config set defaults.profile minimal
node "<skill>/scripts/rooster.mjs" config set defaults.autonomy guided
node "<skill>/scripts/rooster.mjs" config set assets.strategy mixed
node "<skill>/scripts/rooster.mjs" config set assets.allowDownload true
node "<skill>/scripts/rooster.mjs" config set assets.allowGenerate false
node "<skill>/scripts/rooster.mjs" config show
```

O agente pergunta em um bloco, grava os defaults e para. Só cria um projeto quando você pedir. Guia completo em [`docs/FIRST-RUN.md`](docs/FIRST-RUN.md).

## Assets

| Estratégia | O que faz |
|---|---|
| `user` | Só arquivos que você fornece |
| `link` | Links autorizados baixados via `yt-dlp` |
| `library` | Música, SFX, fontes, overlays e b-roll do workspace/global |
| `generated` | Imagens/TTS/vídeo gerados por IA, com permissão |
| `none` | Sem assets externos; só texto e motion graphics |
| `mixed` | Tudo acima, com consentimento por ação |

Hoje a skill baixa links autorizados, mas **não busca stock automaticamente**. O usuário pode trocar a estratégia a qualquer momento com `config set assets.strategy ...` ou editar `project.json`. Detalhes em [`docs/ASSETS.md`](docs/ASSETS.md).

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
# 1. workspace e projeto
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" new meu-video \
  --category talking-head \
  --profile minimal

# 2. coloque o vídeo em rooster/projects/meu-video/assets/source/
# 3. transcreva
node "<skill>/scripts/rooster.mjs" transcribe meu-video --model small --language pt

# 4. crie edit/plan.json e mostre o plano
node "<skill>/scripts/rooster.mjs" plan meu-video --show

# 5. depois da aprovação, gere o projeto
node "<skill>/scripts/rooster.mjs" build meu-video --engine hyperframes
# ou
node "<skill>/scripts/rooster.mjs" build meu-video --engine remotion
```

Depois do build:

```bash
# HyperFrames
cd rooster/projects/meu-video/engine/hyperframes
npx hyperframes check
npx hyperframes preview
npx hyperframes render --quality draft -o ../../renders/draft.mp4

# Remotion
cd rooster/projects/meu-video/engine/remotion
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

## Perfis e categorias

**Profile** = identidade visual/sonora reutilizável: cores, tipografia, motion, legendas, áudio, componentes.

**Category** = receita de conteúdo: beats, duração, aspect, voz, legendas, música, assets obrigatórios e QA.

Built-ins:

- Perfis: `minimal`, `tech-neon`, `3d-cartoon`.
- Categorias: `talking-head`, `faceless-explainer`, `3d-cartoon`.

Precedência: **projeto > workspace > global (`~/.rooster`) > built-in**.

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
├── projects/<slug>/
│   ├── project.json
│   ├── brief.md
│   ├── style.md
│   ├── assets/{source,generated,licensed}/
│   ├── edit/{transcript.json,plan.json,edl.json,timeline.json,captions/}
│   ├── engine/{hyperframes|remotion}/
│   ├── preview/
│   ├── renders/
│   └── qa/
├── profiles/
├── categories/
└── library/{music,sfx,fonts,overlays,luts,broll,images}/
```

## Comandos

| Comando | O que faz |
|---|---|
| `doctor` | Detecta ambiente, engines, TTS, Whisper, yt-dlp e workspace |
| `init` | Cria o workspace |
| `new` | Cria um projeto com categoria, perfil e formato |
| `ingest` | Copia arquivo local ou baixa link autorizado com `yt-dlp` |
| `transcribe` | Transcreve com HyperFrames/Parakeet ou Whisper |
| `plan` | Valida e mostra `edit/plan.json` |
| `build` | Gera o projeto HyperFrames ou Remotion a partir do plano |
| `check` | Valida projeto, timeline, manifest e plano |
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
