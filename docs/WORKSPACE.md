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
│       │       ├── style/proof/
│       │       ├── storyboard/
│       │       ├── assets/{source,generated,licensed}/
│       │       ├── edit/{transcript.json,digest.md,analysis.json,plan.json,plan.md,plan.html,edl.json,timeline.json,captions/,audio/,export/}
│       │       ├── engine/
│       │       │   ├── hyperframes/
│       │       │   ├── remotion/
│       │       │   └── filmcraft/
│       │       │       ├── <slug>.fcproj
│       │       │       ├── assets/
│       │       │       ├── hyperframes/
│       │       │       ├── remotion/
│       │       │       ├── elements/
│       │       │       └── archive/
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
├── profiles/       # compartilhados
├── library/{music,sfx,fonts,overlays,luts,broll,images}/
└── cache/          # inclui cache/elements/ (clipes ProRes 4444)
```

O workspace é criado com:

```bash
node scripts/rooster.mjs init
```

`init` cria um canal `default` para vídeos avulsos. Canais reais são criados depois.

## Canais

Um canal é o padrão de produção estável de uma marca/audiência/operação. Ele guarda:

- o que produz (`content`);
- idioma;
- formato default (`16:9`, `9:16`, `1:1` ou `auto`);
- perfil visual;
- política de assets;
- engine;
- autonomia;
- voz/TTS;
- brand kit;
- biblioteca própria.

```bash
node scripts/rooster.mjs channel new en-tech \
  --name "EN Tech" \
  --content "English tech explainers" \
  --language en \
  --format 16:9 \
  --profile tech-neon \
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

A duração é definida por vídeo, não pelo canal:

```bash
node scripts/rooster.mjs new video-x --channel en-tech --duration 60
node scripts/rooster.mjs open en-tech/video-x
```

O `open` mostra e abre `assets/source/` para você colocar os arquivos. O projeto herda o canal e pode sobrescrever:

```bash
node scripts/rooster.mjs new video-special --channel en-tech \
  --format 9:16 \
  --profile brutalist \
  --voice user
```

`new --target filmcraft` já cria o projeto com `timeline: "filmcraft"`; `--target hyperframes|remotion` fixa o engine criativo. Sem `--target`, o projeto herda o engine do canal.

`project.json` registra:

- `channel`;
- `profile`;
- `format`;
- `language`;
- `engine` (renderer criativo ou renderer dos elementos no FilmCraft);
- `timeline` (`none` ou `filmcraft`);
- `mode` (source, voice, style, autonomy);
- `assets` (estratégia, permissões, licença);
- `overrides` (o que veio do projeto, não do canal).

## Precedência

```text
projeto > canal > workspace/global > built-in
```

O projeto pode sobrescrever qualquer default do canal. Não existe camada de categoria.

## Subagents e handoffs

O agente principal não precisa carregar o material bruto. Cada etapa pesada pode rodar em um subagent definido em `agents/`; ele grava o detalhe em disco e devolve um handoff curto.

```text
work/
├── handoffs/   # um resumo por etapa, ex.: 03-transcript.md
├── logs/       # saída bruta de build, render, FFmpeg, transcrição
├── scratch/    # rascunhos e arquivos intermediários
└── notes/      # detalhe produzido pelos subagents para o próximo estágio
    └── feedback-<timestamp>.md  # rascunho de issue revisado
```

O principal lê os handoffs, vê o `plan.html` e 3–5 frames. A transcrição completa, o código gerado e os logs ficam fora do contexto principal. O protocolo está em [`references/subagents.md`](../references/subagents.md) e o contrato de retorno em [`agents/_handoff.md`](../agents/_handoff.md).

## Review e handoff

| Artefato | Comando | Uso |
|---|---|---|
| `style/proof/index.html` | `styleproof <slug>` | 3 frames de amostra do estilo antes do plano |
| `edit/plan.html` | `plan <slug> --show` | Plano com player, contexto da transcrição e textos para revisar |
| `preview/index.html` | `preview <slug>` | Player, timeline, validação, assets e checklist de QA |
| `qa/text-review.md` | `textcheck <slug>` | Todos os textos em tela com timecodes e alertas |
| `edit/export/` | `export <slug> --format both` | EDL/FCPXML para DaVinci ou Premiere |
| `engine/filmcraft/<slug>.fcproj` | `timeline <slug> --open` | Timeline editável no FilmCraft (opcional) |

O `preview` e o `styleproof` são arquivos HTML estáticos; funcionam sem servidor. O `export` é um handoff, não substitui `edit/plan.json`.

## Timeline FilmCraft (opcional)

O FilmCraft é um alvo de timeline opt-in. Ele não substitui HyperFrames ou Remotion e não é necessário para o fluxo normal.

```bash
node scripts/rooster.mjs build video-x --target filmcraft
node scripts/rooster.mjs timeline video-x --open
node scripts/rooster.mjs render video-x --draft
```

`timeline <slug> --json` imprime o caminho do `.fcproj`, a sequência e a contagem de elementos.

O build é híbrido:

- o FFmpeg monta o corte e o mix de áudio em `engine/filmcraft/assets/`;
- HyperFrames ou Remotion renderizam cada elemento em `engine/filmcraft/elements/` (MOV ProRes 4444 com alpha);
- o FilmCraft monta `<slug>.fcproj` com o source em V1 (só vídeo), o áudio mixado em A1 e os elementos em V2+, em faixas sem sobreposição.

`--engine hyperframes|remotion` escolhe o renderer dos elementos; `auto` usa Remotion quando há elemento 3D e HyperFrames nos outros casos. `work/filmcraft.json` guarda o estado (itens, clipes, hashes e janelas) para builds incrementais.

- `--if-needed` pula quando plano, base, renderer e formato não mudaram.
- Elementos inalterados são reaproveitados de `cache/elements/`.
- Elemento alterado usa `clip.replaceFromBin` quando a janela é a mesma; janela diferente apaga e reposiciona só aquele clipe.
- Base alterada reposiciona apenas V1/A1; clipes do usuário nas outras tracks são preservados.
- `--force` arquiva o `.fcproj` anterior em `engine/filmcraft/archive/` e reconstrói.
- `--rebuild-media` força o re-render da base e dos elementos.

Cuidados:

- `zoom` não vira clipe; aplica-se à base e é pulado com aviso.
- Markers e legendas são criados no primeiro build; builds seguintes preservam.
- O `.fcproj` guarda caminhos absolutos: mover a pasta quebra os links.
- Só um processo escreve por vez; feche o FilmCraft durante o `build`.
- ProRes 4444 ocupa espaço; o GC do cache se aplica.
- O export do FilmCraft é CPU-bound para grading/keys; o H.264 pode usar hardware.

O `export` de EDL/FCPXML continua disponível e é independente do FilmCraft.

`doctor --json` reporta `filmcraft: { installed, cli, app, source, version, mcp }`. `filmcraft status --json` mostra detecção, MCP e um prompt de onboarding (`prompt.kind`: `connect-mcp`, `install`, `install-cli` ou `ready`). `filmcraft setup [--client opencode|claude] [--write]` imprime o snippet e, com `--write`, mescla em `opencode.json` ou `.mcp.json`, criando um backup `.bak` quando o arquivo já existe; `filmcraft mcp-config [--client ...] [--json]` só mostra o snippet. Nada é instalado nem gravado sem permissão explícita. Link: https://getartcraft.com/apps/filmcraft.

Fluxo de onboarding (o agente pergunta, não decide sozinho):

- FilmCraft encontrado, MCP não registrado: "Encontrei o FilmCraft <versão> no seu PC. Deseja conectar o MCP agora? Depois de conectar, você precisará reiniciar o programa/agente para ele enxergar as tools." Opções: Conectar o MCP / Agora não.
- FilmCraft não encontrado: "Não encontrei o FilmCraft no seu PC. Quer continuar via HyperFrames/Remotion ou instalar o FilmCraft + conectar o MCP?" Opções: Continuar via HyperFrames/Remotion / Instalar FilmCraft + conectar MCP.
- App encontrado sem CLI: pedir para instalar o CLI ou definir `ROOSTER_FILMCRAFT_CLI`.
- MCP já registrado: avisar que ainda pode ser necessário reiniciar o agente.
- Nunca instalar nem escrever config de MCP sem permissão explícita.
- O prompt completo sai de `node "<skill>/scripts/rooster.mjs" filmcraft status --json`.

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
5. `transcribe` — gera `edit/transcript.json` (via `transcript-analyst`).
6. `digest` — lê a transcrição em partes; o principal recebe só o handoff.
7. `plan --show` — aprova o plano (via `editor`).
8. `build --target` — gera HyperFrames/Remotion (`--target hyperframes|remotion`) ou, opcionalmente, uma timeline FilmCraft (`--target filmcraft`), via `engineer`.
9. `preview`/`render` — revisão e entrega (via `qa` + `engineer`).
