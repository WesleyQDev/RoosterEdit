# Otimização de tokens

Vídeo gasta tokens naturalmente: transcrição, frames, plano, logs de render e código gerado. A ideia não é cortar qualidade; é tirar ruído do contexto e deixar tokens para decisões criativas.

## Os maiores ladrões

1. **Logs de render/check** — HyperFrames e Remotion imprimem milhares de linhas. Redirecione para arquivo e leia só o final.
2. **Transcrição completa com palavras** — use `digest` e leia só os segmentos.
3. **Plano JSON cru** — use `plan --show`.
4. **Referências inteiras** — leia só a seção necessária.
5. **Muitos frames** — 3 a 5 frames representativos bastam.
6. **Re-renderizar por mudança pequena** — use still/snapshot ou draft.

## Comandos

```bash
# Render barulhento
npx hyperframes render --quiet -o ../../renders/draft.mp4 > render.log 2>&1
tail -n 20 render.log

# Check
npx hyperframes check --json > check.json 2>&1
node -e "const d=require('./check.json'); console.log({ok:d.ok, errors:d.lint?.errorCount, warnings:d.lint?.warningCount})"

# Remotion
npx remotion render src/index.ts RoosterVideo out.mp4 --log=error

# FFmpeg
ffmpeg -v error -i input.mp4 ...

# Transcrição compacta
node "<skill>/scripts/rooster.mjs" digest meu-video --from 0 --to 60
```

## Regras de contexto

- Não cole logs no chat; leia o `Fix:` ou as últimas 30 linhas.
- Use `digest` em vez de `transcript.json`.
- Use `plan --show` em vez de `plan.json`; o comando também gera `edit/plan.html` para revisão.
- Leia só o reference da fase atual.
- Inspecione 3–5 frames por revisão.
- Renderize draft uma vez; final só depois da aprovação.
- Reuse transcrição, TTS e projetos; não refaça o que não mudou.
- Para transcrição longa, peça a um subagent um resumo compacto em JSON.
- Feche a tarefa em 5–10 linhas: resultado, caminhos e uma próxima pergunta. Detalhes ficam nos arquivos.

## O que não cortar

- Aprovação do plano.
- Inspeção visual de frames.
- Revisão editorial do resultado.
- Qualidade do render final.

Economize no ruído, não no julgamento.
