# Instalação

O repositório inteiro é a skill. Não há build step: basta clonar/copiar para uma pasta de skills que o agente já descubra.

## Requisitos

- Node.js 20+ (recomendado 22/24)
- FFmpeg e FFprobe
- Um browser (para preview/render do HyperFrames e Remotion)
- Opcional: Whisper local, `yt-dlp`, GPU

O `doctor` verifica tudo:

```bash
node scripts/rooster.mjs doctor --json
```

## Com um agente

Se você quer que o agente instale e valide tudo, o prompt pronto está no [README](../README.md). As seções abaixo cobrem a instalação manual.

## OpenCode — projeto local

Na raiz do projeto de vídeo:

```bash
git clone https://github.com/WesleyQDev/RoosterEdit.git .opencode/skills/rooster-edit
```

Se a pasta já existir e você quiser atualizar:

```bash
cd .opencode/skills/rooster-edit
git pull
```

O OpenCode descobre automaticamente `.opencode/skills/rooster-edit/SKILL.md`.

## OpenCode — global

```bash
git clone https://github.com/WesleyQDev/RoosterEdit.git ~/.config/opencode/skills/rooster-edit
```

No Windows, o caminho padrão é:

```powershell
git clone https://github.com/WesleyQDev/RoosterEdit.git "$env:USERPROFILE\.config\opencode\skills\rooster-edit"
```

## Claude Code / Codex / compatibilidade

Além de `.opencode/skills`, o OpenCode e outros agentes também leem `.claude/skills` e `.agents/skills`. Clone ou copie para um desses diretórios:

```bash
git clone https://github.com/WesleyQDev/RoosterEdit.git .claude/skills/rooster-edit
# ou
git clone https://github.com/WesleyQDev/RoosterEdit.git .agents/skills/rooster-edit
```

No Windows, se preferir não duplicar, crie um junction:

```powershell
New-Item -ItemType Junction -Path ".claude\skills\rooster-edit" -Target ".opencode\skills\rooster-edit"
```

## Verificar a instalação

```bash
node .opencode/skills/rooster-edit/scripts/rooster.mjs doctor --json
```

Você deve ver Node, FFmpeg, FFprobe, HyperFrames CLI e o workspace (se existir).

## Primeiro uso

Depois de instalar, crie o primeiro **canal** com o agente:
- nome, o que ele produz, idioma, formato e perfil padrão;
- modo de origem (live, generated ou hybrid);
- política de assets;
- engine e autonomia;
- voz/TTS.

O guia está em [`docs/FIRST-RUN.md`](FIRST-RUN.md). O agente grava os defaults do canal e só cria um projeto quando você pedir. A pergunta inicial é “Vamos criar a pasta do seu primeiro canal?” — um padrão de produção local, não um canal no YouTube.

```bash
node .opencode/skills/rooster-edit/scripts/rooster.mjs init
node .opencode/skills/rooster-edit/scripts/rooster.mjs channel new meu-canal \
  --language pt-BR \
  --format 16:9 \
  --profile minimal
node .opencode/skills/rooster-edit/scripts/rooster.mjs channel list
```

Crie o projeto dentro do canal:

```bash
node .opencode/skills/rooster-edit/scripts/rooster.mjs new meu-video --channel meu-canal
```

Coloque o vídeo em `rooster/channels/meu-canal/projects/meu-video/assets/source/` e peça ao agente:

> Transcreva o vídeo, leia meu `style.md`, monte `edit/plan.json` e me mostre o plano antes de criar qualquer coisa.

Depois da aprovação:

```bash
node .opencode/skills/rooster-edit/scripts/rooster.mjs build meu-canal/meu-video --engine hyperframes
```

## Atualizar

```bash
cd .opencode/skills/rooster-edit
git pull
```

O OpenCode recarrega skills quando os arquivos mudam. Se não aparecer, use `/reload`.

## Problemas comuns

| Problema | Solução |
|---|---|
| Skill não aparece | Confirme que o arquivo é `.opencode/skills/rooster-edit/SKILL.md` e que a pasta não está vazia |
| `node` não encontrado | Instale Node.js LTS e reabra o terminal |
| `ffmpeg` não encontrado | Instale FFmpeg e adicione ao PATH |
| HyperFrames lento na primeira execução | `npx hyperframes` baixa o pacote/Chrome na primeira vez; depois usa cache |
| Remotion não renderiza | Rode `npm install` dentro de `engine/remotion` |
| Transcrição em português falha | Instale whisper.cpp ou `openai-whisper`; o Parakeet cobre inglês |
| YouTube bloqueia download | Use `--cookies-from-browser` ou baixe o arquivo manualmente, respeitando os direitos |
