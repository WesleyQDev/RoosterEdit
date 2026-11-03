# Agents

Os arquivos desta pasta são os papéis dos subagents do RoosterEdit. Eles não são agentes nativos do harness: são prompts operacionais que o agente principal passa por caminho para um subagent genérico. Assim funcionam em OpenCode, Claude Code, Codex e qualquer harness com uma ferramenta de subagent.

O protocolo completo está em [`references/subagents.md`](../references/subagents.md). O contrato de retorno está em [`_handoff.md`](_handoff.md).

## Papéis

| Arquivo | Etapa | Papel |
|---|---|---|
| `producer.md` | 02 Intake | Transforma a conversa em `brief.md` e critérios de sucesso |
| `researcher.md` | 02 Research | Referências, fact-check e candidatos de licença |
| `transcript-analyst.md` | 03 Assets | Transcrição, digest, beats, cortes e b-roll |
| `scriptwriter.md` | 04 Script | Hook, falas, texto na tela e beats |
| `editor.md` | 04 Plan | Plano de edição, EDL e timeline |
| `art-director.md` | 05 Style | Perfil, `style.md` e storyboard |
| `audio-director.md` | 05 Audio | Voz, TTS, música, SFX e mix |
| `engineer.md` | 06 Build / 08 Render | Build, correções, render e entrega |
| `qa.md` | 07 QA | Inspeção técnica, editorial e evidências |

## Como usar

1. O agente principal mantém a conversa, as decisões e os gates de aprovação.
2. Para uma etapa pesada, ele spawna um subagent e passa: caminho do papel, caminho do projeto, tarefa, arquivos de entrada e restrições.
3. O subagent lê o papel e os arquivos, faz o trabalho, grava o detalhe em disco e devolve só o handoff.
4. O agente principal lê o handoff, verifica os artefatos e decide. Não lê o material bruto.
5. Em etapa criativa, o subagent propõe; o agente principal e o usuário aprovam.

Exemplo de prompt:

```text
RoosterEdit subagent: transcript-analyst.
Project: C:\video\rooster\channels\en-tech\projects\video-x
Workspace: C:\video\rooster
Skill: C:\video\.opencode\skills\rooster-edit
Handoff: work/handoffs/03-transcript.md

Read C:\video\.opencode\skills\rooster-edit\agents\transcript-analyst.md and follow it. Paths under references/ and agents/ resolve against that skill folder.
Task: transcribe the source and produce the editorial map.
Inputs: assets/source/interview.mp4, brief.md, project.json
Constraints: pt-BR, target 90s, keep the original audio.
Return only the handoff template. Do not paste logs, transcript text, or JSON.
```

## Regras

- O handoff é a única coisa que entra no contexto principal: no máximo 15 linhas (25 para plano, QA e entrega).
- Caminhos de artefato precisam existir. "Planejado" não conta.
- Decisão criativa, de licença ou de custo que muda o resultado volta como `needs-decision`.
- Não delegar a conversa com o usuário nem o gate de aprovação.
- Não fingir paralelismo. O padrão é uma etapa por vez; paralelize só trabalho independente e de leitura.
- O nome da ferramenta e do tipo de agente varia entre harnesses (OpenCode, Claude Code, Codex, etc.). Use o agente genérico do harness, com permissão de escrita quando a etapa escreve arquivos. O papel é o contrato, não o nome do tool.
- Sem suporte a agente com contexto novo, ou se o spawn falhar duas vezes, faça a etapa inline, mas continue gravando handoff e mantendo o material bruto em `work/`.
