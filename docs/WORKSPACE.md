# Workspace

O workspace é o estúdio local do usuário. Ele fica no projeto de vídeo, não no repositório da skill.

> **Caminho do CLI:** os comandos abaixo assumem que você está na raiz do repositório RoosterEdit. Ao usar a skill em um projeto de vídeo, rode a partir do projeto e resolva o script pelo diretório da skill: `node "<skill>/scripts/rooster.mjs" ...`.

## Estrutura

```text
rooster/
├── workspace.json
├── config.json
├── channels/
│   └── <canal>/
│       ├── channel.json
│       ├── projects/
│       │   └── <slug>/
│       │       ├── project.json
│       │       ├── brief.md
│       │       ├── script.md
│       │       ├── style.md
│       │       ├── storyboard/
│       │       ├── assets/{source,generated,licensed}/
│       │       ├── edit/{transcript.json,plan.json,edl.json,timeline.json,captions/,audio/}
│       │       ├── engine/{hyperframes|remotion}/
│       │       ├── preview/
│       │       ├── renders/
│       │       ├── qa/
│       │       └── review.md
│       ├── profiles/
│       ├── categories/
│       ├── assets/
│       └── library/
├── profiles/       # compartilhados
├── categories/     # compartilhadas
├── library/{music,sfx,fonts,overlays,luts,broll,images}/
└── cache/
```

O workspace é criado com:

```bash
node scripts/rooster.mjs init
```

`init` cria um canal `default` para vídeos avulsos. Canais reais são criados depois.

## Canais

Um canal é o grupo estável de marca/audiência/operação. Ele guarda:

- idioma;
- formato default (`16:9`, `9:16`, `1:1` ou `auto`);
- perfil visual;
- categoria default;
- política de assets;
- engine;
- autonomia;
- voz/TTS;
- brand kit;
- biblioteca própria.

```bash
node scripts/rooster.mjs channel new en-tech \
  --language en \
  --format 16:9 \
  --profile tech-neon \
  --category faceless-explainer \
  --voice tts \
  --assets mixed
```

```bash
node scripts/rooster.mjs channel list
node scripts/rooster.mjs channel show en-tech
node scripts/rooster.mjs channel set en-tech format 9:16
node scripts/rooster.mjs channel use en-tech
```

## Criar um projeto

```bash
node scripts/rooster.mjs new video-x --channel en-tech --duration 60
```

O projeto herda o canal e pode sobrescrever:

```bash
node scripts/rooster.mjs new video-special --channel en-tech \
  --format 9:16 \
  --profile brutalist \
  --voice user
```

`project.json` registra:

- `channel`;
- `category`;
- `profile`;
- `format`;
- `mode` (source, voice, style, autonomy);
- `assets` (estratégia, permissões, licença);
- `overrides` (o que veio do projeto, não do canal).

## Precedência

```text
projeto > canal > categoria (sugestão) > workspace/global > built-in
```

O canal ganha da categoria. O projeto ganha de todos.

## Perfis

```text
profiles/<id>/
├── profile.json
├── STYLE.md
├── assets/
├── components/
└── examples/
```

Perfis podem ser:

- **channel** — dentro de `channels/<canal>/profiles`;
- **workspace** — compartilhado em `rooster/profiles`;
- **global** — `~/.rooster/profiles`;
- **built-in** — `templates/profiles`.

```bash
node scripts/rooster.mjs profile list
node scripts/rooster.mjs profile show minimal
node scripts/rooster.mjs profile fork minimal --as minha-marca
```

## Categorias

```text
categories/<id>/
├── category.json
├── PLAYBOOK.md
├── beats.json
├── components/
└── examples/
```

```bash
node scripts/rooster.mjs category list
node scripts/rooster.mjs category fork faceless-explainer --as meu-explainer
```

## Biblioteca

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

Cada asset deve ter licença e proveniência. Não commitar mídia pesada no repositório da skill.

## Links de vídeo

```bash
node scripts/rooster.mjs ingest en-tech/video-x \
  --url "https://www.youtube.com/watch?v=..." \
  --confirm-rights
```

Leia `references/link-ingest.md` antes de baixar. O comando só funciona com `--confirm-rights`, e respeita `assets.allowDownload` do canal/workspace.

## Fluxo rápido

1. `init` — cria workspace + canal `default`.
2. `channel new` — cria o canal real.
3. `new --channel` — cria o projeto.
4. `ingest` — adiciona assets.
5. `transcribe` — gera `edit/transcript.json`.
6. `digest` — lê a transcrição em partes.
7. `plan --show` — aprova o plano.
8. `build --engine` — gera HyperFrames/Remotion.
9. `preview`/`render` — revisão e entrega.
