# Melhorias a partir do vídeo de referência

Vídeo: [Como editar vídeos com IA usando o Claude Code](https://www.youtube.com/watch?v=EIj7WPiKmOE), de Marcos Lemos.

Transcrição analisada: legendas automáticas pt-BR (16:55). O vídeo valida o nosso fast path de 6 etapas e o gate do plano; os itens abaixo cobrem o que ele faz melhor ou que ainda falta na nossa base.

## Checklist

### 1. Style proof + sample build

- [x] Comando `styleproof <slug>` gera `style/proof/index.html` com 3 frames (hook, dado, legenda/lower third) usando o profile.
- [x] `build <slug> --sample 3` gera só 3 elementos representativos antes do build completo.
- [x] `style/proof/` entra no contrato do workspace.
- [x] `art-director` e `engineer` documentam o gate de estilo e o sample build.
- [x] `SKILL.md` e docs atualizados.
- [x] Teste em workspace temporário.

### 2. Preview unificado

- [x] `preview <slug>` escreve `preview/index.html` com player, plano, timeline, legendas, áudio, assets faltando e checklist de QA.
- [x] Timecodes clicáveis no player.
- [x] Mantém o atalho para o preview nativo do engine.
- [x] `references/timeline.md` e `SKILL.md` atualizados.
- [x] Teste em workspace temporário.

### 3. Handoff NLE

- [x] Comando `export <slug> --format edl|fcpxml|both` gera `edit/export/`.
- [x] EDL CMX 3600 com cortes e nomes de clipe.
- [x] FCPXML com tracks/asset clips para DaVinci/Premiere.
- [x] `edit/export/README.md` com instruções de importação e limitações.
- [x] Reference `references/nle-handoff.md` e índice de camadas.
- [x] Teste em workspace temporário.

### 4. Plano + QA de texto/áudio

- [x] `plan.html` mostra contexto da transcrição por corte/elemento, player e lista de textos para revisar.
- [x] Comando `textcheck <slug>` gera `qa/text-review.md` com textos, timecodes e alertas.
- [x] `check` avisa quando um corte começa/termina no meio de uma palavra.
- [x] QA exige assistir ao draft inteiro e revisar texto/áudio.
- [x] Docs atualizados.
- [x] Teste em workspace temporário.

### 5. Onboarding + custos

- [x] Comando `paths <slug>` mostra a visão simples (`bruto`, `estilo`, `trabalho`, `final`).
- [x] `docs/COSTS.md` com custos obrigatórios, opcionais e gratuitos.
- [x] Prompt de setup único: skill + dependências + workspace, com permissão.
- [x] README: “você não precisa rodar comandos”, link de custos, `guided` → `auto`, style proof.
- [x] Docs atualizados.
- [x] Teste de ajuda/comandos.

## O que não vamos copiar

- Dependência de Claude Code ou de um NLE pago.
- Timeline escondida e sem inspeção visual.
- Plano como lista solta, sem JSON/timeline.
- Usuário gerenciando pastas e comandos manualmente.
- MCP como requisito para editar.

## Status

Os cinco itens foram implementados no CLI e na documentação: `styleproof`, `build --sample`, `preview`, `textcheck`, `export` e `paths`. O teste de fumaça está em [`docs/TESTING.md`](TESTING.md).

