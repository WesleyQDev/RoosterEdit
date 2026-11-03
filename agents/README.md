# Agents

Prompts opcionais para subagents. O RoosterEdit funciona sem eles; quando o harness suporta subagents, estes papéis podem rodar em paralelo para acelerar research, roteiro, direção de arte e QA.

## Papéis planejados

| Arquivo | Papel |
|---|---|
| `producer.md` | Intake, brief, restrições e critérios de sucesso |
| `researcher.md` | Referências, fact-check, licenças e contexto |
| `scriptwriter.md` | Variantes de roteiro, hook, beats e CTA |
| `art-director.md` | Guia de estilo, paleta, tipografia, motion e storyboard |
| `editor.md` | Paper edit, EDL, ritmo, transições e b-roll |
| `audio-director.md` | TTS, música, SFX, mix e loudness |
| `qa.md` | Checklist técnico e editorial |
| `engineer.md` | Implementação no engine escolhido |

## Como usar

1. O agente principal lê o brief e as referências relevantes.
2. Para trabalho independente, spawna um subagent por papel.
3. Cada subagent recebe o brief, as restrições e o arquivo de referência do papel.
4. O agente principal consolida e toma a decisão criativa.
5. QA roda depois do preview, com os arquivos de saída.

## Importante

- Subagents não são obrigatórios.
- Não fingir paralelismo quando o harness não suporta.
- O agente principal mantém a narrativa e a timeline.
- Não delegar decisões de licença ou direitos a um subagent sem revisão.
