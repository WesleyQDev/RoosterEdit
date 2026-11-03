# Workspace

O workspace é o estúdio local do usuário. Ele fica no projeto de vídeo, não no repositório da skill.

> **Caminho do CLI:** os comandos abaixo assumem que você está na raiz do repositório RoosterEdit. Ao usar a skill em um projeto de vídeo, rode a partir do projeto e resolva o script pelo diretório da skill: `node "<skill>/scripts/rooster.mjs" ...`.

```text
rooster/
├── workspace.json
├── config.json
├── README.md
├── projects/
│   └── <slug>/
│       ├── project.json
│       ├── brief.md
│       ├── script.md
│       ├── style.md
│       ├── storyboard/
│       ├── assets/
│       ├── edit/
│       ├── engine/
│       ├── preview/
│       ├── renders/
│       ├── qa/
│       └── review.md
├── profiles/
├── categories/
├── library/
└── cache/
```

## Criar

```bash
node scripts/rooster.mjs init
```

O comando cria a estrutura, o `workspace.json`, o `config.json` e copia os perfis/categorias built-in para o workspace.

## Criar um projeto

```bash
node scripts/rooster.mjs new meu-video \
  --category faceless-explainer \
  --profile tech-neon \
  --format 9:16 \
  --duration 45 \
  --voice tts
```

## Estrutura de um projeto

| Pasta/arquivo | Função |
|---|---|
| `project.json` | Configuração do projeto e overrides |
| `brief.md` | Objetivo, público, restrições |
| `script.md` | Roteiro, falas e texto na tela |
| `style.md` | Direção visual e sonora |
| `storyboard/` | Cenas, frames e durações |
| `assets/source/` | Material original do usuário |
| `assets/generated/` | Imagens, áudio e vídeo gerados |
| `assets/licensed/` | Stock e assets com licença |
| `assets/manifest.json` | Inventário, hashes, licenças e proveniência |
| `edit/transcript.json` | Transcrição com timestamps (Whisper) |
| `edit/plan.json` | Plano de edição: cortes e elementos, aprovado antes do build |
| `edit/timeline.json` | Timeline engine-agnostic |
| `edit/edl.json` | Lista de cortes para footage |
| `edit/captions/` | SRT/VTT |
| `edit/audio/` | Voiceover, música e SFX |
| `engine/` | Projeto do motor escolhido |
| `preview/` | Review page e screenshots |
| `renders/` | Drafts, final, thumbnail |
| `qa/` | Relatório e evidências |
| `review.md` | Decisões, feedback e lições |

## Perfis

Um perfil é a identidade visual/sonora reutilizável.

```text
profiles/<id>/
├── profile.json
├── STYLE.md
├── assets/
├── components/
└── examples/
```

Perfis podem ser:

- **project** — específico de um projeto;
- **workspace** — compartilhado entre projetos;
- **global** — compartilhado entre workspaces, em `~/.rooster/profiles`.

Precedência: projeto > workspace > global > built-in.

## Categorias

Uma categoria é a receita de conteúdo.

```text
categories/<id>/
├── category.json
├── PLAYBOOK.md
├── beats.json
├── components/
└── examples/
```

Categorias iniciais: `talking-head`, `faceless-explainer`, `3d-cartoon`.

## Biblioteca

A pasta `library/` guarda assets reutilizáveis:

```text
library/
├── music/
├── sfx/
├── fonts/
├── overlays/
├── luts/
├── broll/
└── images/
```

Cada asset deve ter licença e proveniência registradas. Não commitar mídia pesada no repositório da skill.

## Links de vídeo

Para usar um link autorizado como material:

```bash
node scripts/rooster.mjs ingest meu-video \
  --url "https://www.youtube.com/watch?v=..." \
  --confirm-rights
```

Leia `references/link-ingest.md` antes de baixar. O comando só funciona com `--confirm-rights`, para deixar explícito que o usuário tem direito de usar o conteúdo.

## Fluxo rápido (inspirado no vídeo)

O vídeo de referência usa `bruto/estilo/trabalho/final`; o RoosterEdit usa a estrutura própria acima. O fluxo é:

1. Instalar FFmpeg, Node, Python, Whisper e HyperFrames.
2. Criar o projeto e colocar o material em `assets/source/`.
3. Escrever `style.md` (ou resolver um profile).
4. Transcrever com Whisper ou HyperFrames:
   ```bash
   node "<skill>/scripts/rooster.mjs" transcribe meu-video --model small --language pt
   ```
   O comando tenta HyperFrames transcribe (Parakeet/whisper.cpp) e, se não estiver disponível, usa o Whisper CLI.
5. Criar `edit/plan.json` com cortes e elementos e mostrar o plano:
   ```bash
   node "<skill>/scripts/rooster.mjs" plan meu-video --show
   ```
6. Só depois da aprovação, criar a timeline, os visuais e o render.

O plano é o gate mais importante. Ele fica em `edit/plan.json` e segue o schema `rooster.plan/v1` documentado em `references/edit-plan.md`.

Depois da aprovação, gere o projeto do engine:

```bash
node "<skill>/scripts/rooster.mjs" build meu-video --engine hyperframes
# ou
node "<skill>/scripts/rooster.mjs" build meu-video --engine remotion
```

O `build` aplica os cortes com FFmpeg, remapeia os tempos dos elementos e cria o projeto pronto para preview/render.

## HyperFrames e Remotion

- **HyperFrames**: montagem automática a partir do plano, com HTML/CSS/GSAP e motion graphics.
  ```bash
  npx skills add heygen-com/hyperframes
  ```
- **Remotion**: React, cenas data-driven, componentes complexos e 3D com `@remotion/three`.
  ```bash
  npx create-video@latest
  ```
- **FFmpeg**: utilitário para probe, cortes, proxies, legendas e mix de áudio.
