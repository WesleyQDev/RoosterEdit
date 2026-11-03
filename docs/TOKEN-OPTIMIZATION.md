# Otimização de tokens

Vídeo gasta tokens naturalmente: transcrição, frames, plano, logs de render e código gerado. A ideia não é cortar qualidade; é tirar ruído do contexto e deixar tokens para decisões criativas.

## Os maiores ladrões

1. **Logs de render/check** — HyperFrames e Remotion imprimem milhares de linhas. Redirecione para arquivo e leia só o final.
2. **Transcrição completa com palavras** — use `digest` e leia só os segmentos.
3. **Plano JSON cru** — use `plan --show`.
4. **Referências inteiras** — leia só a seção necessária.
5. **Muitos frames** — 3 a 5 frames representativos bastam.
6. **Re-renderizar por mudança pequena** — use still/snapshot ou draft.

## A maior economia: subagents por etapa

Cortar log e usar `digest` ajuda, mas o ganho grande vem de não trazer o material bruto para o agente principal. Ele dirige: fala com o usuário, guarda o brief, toma as decisões e abre os gates. Cada etapa pesada roda em um subagent com contexto próprio, que morre no fim da etapa. O subagent lê a transcrição, roda o build, varre o QA e devolve um handoff de 15–25 linhas. A transcrição e a análise ficam em `edit/`; logs e rascunhos ficam em `work/`, fora do contexto principal.

| Etapa | Subagent | O que o principal recebe |
|---|---|---|
| Brief | `producer` | um parágrafo + perguntas abertas |
| Pesquisa | `researcher` | 5 achados + fontes + licenças |
| Transcrição | `transcript-analyst` | duração, tópicos, beats, flags |
| Roteiro | `scriptwriter` | hook + resumo dos beats |
| Plano | `editor` | resumo do plano + riscos |
| Estilo/storyboard | `art-director` | tokens + cenas + assets |
| Timeline | `editor` | duração + markers + riscos |
| Áudio | `audio-director` | voz, música e mix |
| Build | `engineer` | status + caminhos + bloqueio |
| QA | `qa` | veredito + evidências + frames |
| Render | `engineer` | caminho final + probe |

A regra prática: se a etapa lê ou produz mais de uma tela de material bruto, delegue. Não delegue a conversa de intake, o gate de aprovação, a decisão de licença ou o julgamento visual final. O principal lê o handoff, vê o `plan.html` e 3–5 frames; nunca a transcrição inteira, o código gerado ou o log de render.

O protocolo completo, o template de spawn e o contrato de handoff estão em [`references/subagents.md`](../references/subagents.md) e nos papéis em [`agents/`](../agents/README.md).

Isso é uma capacidade, não um nome de ferramenta: cada harness chama o subagent de um jeito (OpenCode, Claude Code, Codex, etc.). Se o harness não tiver agente com contexto novo, ou se o spawn falhar, rode a etapa inline e mantenha os arquivos; não bloqueie o projeto esperando delegação.

## Comandos

```bash
# Render barulhento
npx hyperframes render --quiet -o ../../renders/draft.mp4 > ../../work/logs/render.log 2>&1
tail -n 20 ../../work/logs/render.log

# Check
npx hyperframes check --json > ../../work/logs/check.json 2>&1
node -e "const d=require('../../work/logs/check.json'); console.log({ok:d.ok, errors:d.lint?.errorCount, warnings:d.lint?.warningCount})"

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
- Para transcrição longa, use `transcript-analyst`: ele grava `edit/analysis.json` e devolve só os beats e as flags.
- Para build e render, use `engineer`: os logs ficam em `work/logs/` e o principal recebe só status e caminhos.
- Feche a tarefa em 5–10 linhas: resultado, caminhos e uma próxima pergunta. Detalhes ficam nos arquivos.

## O que não cortar

- Aprovação do plano.
- Inspeção visual de frames.
- Revisão editorial do resultado.
- Qualidade do render final.

Economize no ruído, não no julgamento.
