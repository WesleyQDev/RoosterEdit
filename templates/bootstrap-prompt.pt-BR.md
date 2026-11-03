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
   node "<skill>/scripts/rooster.mjs" new meu-video --channel meu-canal
   ```
   Coloque meu vídeo bruto em `rooster/channels/meu-canal/projects/meu-video/assets/source/`.
5. Leia meu guia de estilo em `rooster/channels/meu-canal/projects/meu-video/style.md` (se eu não tiver um, crie a partir das minhas referências).
6. Transcreva o vídeo com Whisper:
   ```
   node "<skill>/scripts/rooster.mjs" transcribe meu-canal/meu-video --model small --language pt
   ```
7. Leia `rooster/channels/meu-canal/projects/meu-video/edit/transcript.json` e o `style.md`, entenda o assunto e crie `rooster/channels/meu-canal/projects/meu-video/edit/plan.json` com:
   - cortes para pausas longas, repetições, falsos começos e retomadas;
   - o melhor take a manter;
   - letreiros, gráficos, listas, zooms e b-roll, com início, fim e descrição.
8. **Sempre me mostre o plano antes de criar qualquer coisa.** Só crie a timeline, os visuais ou o render depois do meu OK.
9. Depois do OK, gere o projeto e monte a timeline:
   ```bash
   node "<skill>/scripts/rooster.mjs" build meu-canal/meu-video --engine hyperframes
   ```
   Se eu escolher React, dados ou 3D, use Remotion:
   ```bash
   node "<skill>/scripts/rooster.mjs" build meu-canal/meu-video --engine remotion
   ```
10. No fim, me dê um resumo curto (até 8 linhas) do que foi instalado e do próximo passo. Não escreva um guia longo.

---

## Observações

- Se o ambiente não tiver Node/FFmpeg, não finja o render: gere o plano e explique que HyperFrames/Remotion precisam de Node.
- Não baixe conteúdo de terceiros sem autorização.
- Use `style.md` como fonte de verdade do visual; se houver um profile, ele complementa.
- O plano é o gate mais importante: nada de build antes da aprovação.
