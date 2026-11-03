# Bootstrap prompt (pt-BR)

Prompt para preparar o ambiente e começar um vídeo no fluxo inspirado no vídeo de referência, mas usando a estrutura do RoosterEdit. Cole no agente (OpenCode, Codex, Claude Code etc.) e ajuste os caminhos.

---

Quero editar meus vídeos com IA usando o RoosterEdit. Prepare este computador e este projeto:

1. Verifique e, se faltar, instale FFmpeg, Node.js LTS e Python 3. Peça minha permissão antes de cada instalação.
2. Instale o Whisper para transcrição local e gratuita e teste com um áudio curto.
3. Instale a skill HyperFrames:
   ```
   npx skills add heygen-com/hyperframes
   ```
4. Crie um workspace do RoosterEdit e o primeiro canal:
   ```
   node "<skill>/scripts/rooster.mjs" init
   node "<skill>/scripts/rooster.mjs" channel new meu-canal --language pt-BR --format 16:9 --profile minimal
   node "<skill>/scripts/rooster.mjs" new meu-video --channel meu-canal --duration 60
   node "<skill>/scripts/rooster.mjs" open meu-canal/meu-video
   ```
   Abra a pasta `assets/source/` para eu colocar meu vídeo bruto.
5. Leia meu guia de estilo em `rooster/channels/meu-canal/projects/meu-video/style.md` (se eu não tiver um, crie a partir das minhas referências).
6. Use o subagent `transcript-analyst` para transcrever e montar o mapa editorial:
   ```
   node "<skill>/scripts/rooster.mjs" transcribe meu-canal/meu-video --model small --language pt
   ```
   Ele grava `edit/transcript.json`, `edit/digest.md` e `edit/analysis.json` e devolve só duração, tópicos, beats e flags. Não leia a transcrição inteira no contexto principal.
7. Use o subagent `editor` para criar `edit/plan.json` a partir de `edit/analysis.json`, `style.md` e do brief, com:
   - cortes para pausas longas, repetições, falsos começos e retomadas;
   - o melhor take a manter;
   - letreiros, gráficos, listas, zooms e b-roll, com início, fim e descrição.
8. **Sempre me mostre o plano antes de criar qualquer coisa.** Só crie a timeline, os visuais ou o render depois do meu OK.
9. Depois do OK, use o subagent `engineer` para gerar o projeto e montar a timeline:
   ```bash
   node "<skill>/scripts/rooster.mjs" build meu-canal/meu-video --engine hyperframes
   ```
   Se eu escolher React, dados ou 3D, use Remotion:
   ```bash
   node "<skill>/scripts/rooster.mjs" build meu-canal/meu-video --engine remotion
   ```
10. Use `qa` para a revisão e `engineer` para o render final. No fim, me dê um resumo curto (até 8 linhas) do que foi feito e do próximo passo. Não escreva um guia longo.

---

## Observações

- Os papéis dos subagents estão em `agents/`. O agente principal deve passar caminhos, não conteúdo, e ler só o handoff de `work/handoffs/`.
- Se o ambiente não tiver Node/FFmpeg, não finja o render: gere o plano e explique que HyperFrames/Remotion precisam de Node.
- Não baixe conteúdo de terceiros sem autorização.
- Use `style.md` como fonte de verdade do visual; se houver um profile, ele complementa.
- O plano é o gate mais importante: nada de build antes da aprovação.
- Sem suporte a subagents, faça as etapas inline, mas continue gravando os arquivos e lendo só resumos.
