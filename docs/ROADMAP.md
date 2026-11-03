# Roadmap

## Fase 1 — Fundação (em andamento)

- [x] `SKILL.md` draft em inglês.
- [x] Arquitetura e decisões documentadas.
- [x] Estrutura de workspace, canais e perfis.
- [x] CLI base: `doctor`, `init`, `new`, `list`, `check`.
- [x] Ingestão de links com `yt-dlp` (com gate de direitos).
- [x] Referências: workflow, intake, engines, perfis, timeline, QA, harness, schemas, link ingest.
- [x] Perfis iniciais: minimal, tech-neon, 3d-cartoon.
- [x] Templates built-in de perfis.
- [x] Sync local para OpenCode.
- [x] Detecção de Whisper e comando `transcribe`.
- [x] Schema e comando de validação do `edit/plan.json`.
- [x] Fluxo de 6 etapas inspirado no vídeo, adaptado à estrutura do RoosterEdit.
- [x] Prompt de bootstrap em pt-BR.
- [x] Onboarding por canal (`channel new/set`) e projetos com overrides.
- [x] CLI `channel`, `profile`, `digest`.
- [x] Estratégias de assets por canal/projeto.
- [x] `digest` para transcrição compacta e disciplina de tokens.
- [x] Papéis de subagents em `agents/` e protocolo de handoff por etapa.
- [ ] Validar a skill com o skill-creator.

## Fase 2 — Pipeline de mídia

- [x] Transcrição via HyperFrames/Whisper, testada com amostra pública.
- [x] `edit/plan.json` com validação e gate de aprovação.
- [ ] `cut-plan` automático: silêncios, filler words, rough cut.
- [ ] TTS adapter (provider-agnostic).
- [ ] Mix, loudness e ducking.
- [ ] Legendas: SRT/VTT, sync e burn-in.
- [ ] Manifest com hashes, licenças e proveniência completa.

## Fase 3 — Engines e timeline

- [x] Adapter HyperFrames (smoke test: init, check, render).
- [x] Adapter Remotion (smoke test: scaffold, still, render).
- [x] Build automático de `edit/plan.json` para HyperFrames/Remotion (v1: cortes, elementos e mídia base).
- [ ] Build mais rico: b-roll, gráficos, listas e 3D.
- [ ] Adapter FFmpeg (EDL → filtergraph).
- [x] Preview unificado com timeline e QA.
- [x] Handoff NLE com EDL/FCPXML.
- [x] Style proof de 3 frames e sample build de 3 elementos.
- [x] Text review e validação de corte no meio de palavra.
- [ ] `render` e `package`.

## Fase 4 — 3D e qualidade

- [ ] Starter 3D Three.js para Remotion.
- [ ] Starter 3D Three.js para HyperFrames.
- [ ] Mais perfis prontos: warm-documentary, brutalist, corporate-clean.
- [ ] Exemplos de projetos.
- [ ] Evals com baseline e iteração.
- [ ] Otimização da descrição da skill.
- [ ] Empacotamento.

## Fora de escopo no v1

- NLE completo no browser.
- Geração de vídeo por modelos (Veo/Kling/Runway) como core.
- Avatar/UGC gerado.
- Cloud render.
- Upload automático para YouTube/TikTok.
- Color grading avançado.
- Edição colaborativa em tempo real.
