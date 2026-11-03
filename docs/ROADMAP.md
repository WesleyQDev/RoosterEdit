# Roadmap

## Fase 1 — Fundação (em andamento)

- [x] `SKILL.md` draft em inglês.
- [x] Arquitetura e decisões documentadas.
- [x] Estrutura de workspace, perfis e categorias.
- [x] CLI base: `doctor`, `init`, `new`, `list`, `check`.
- [x] Ingestão de links com `yt-dlp` (com gate de direitos).
- [x] Referências: workflow, intake, engines, perfis/categorias, timeline, QA, harness, schemas, link ingest.
- [x] Playbooks iniciais: talking-head, faceless-explainer, 3d-cartoon.
- [x] Templates built-in de perfis e categorias.
- [x] Sync local para OpenCode.
- [x] Detecção de Whisper e comando `transcribe`.
- [x] Schema e comando de validação do `edit/plan.json`.
- [x] Fluxo de 6 etapas inspirado no vídeo, adaptado à estrutura do RoosterEdit.
- [x] Prompt de bootstrap em pt-BR.
- [x] Onboarding de workspace (`config set`) e estratégias de assets.
- [x] CLI `profile` e `category` (list/show/fork).
- [x] `digest` para transcrição compacta e disciplina de tokens.
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
- [ ] Preview unificado com timeline e QA.
- [ ] `render` e `package`.

## Fase 4 — 3D e qualidade

- [ ] Starter 3D Three.js para Remotion.
- [ ] Starter 3D Three.js para HyperFrames.
- [ ] Categorias completas: product-promo, tutorial, social-short, documentary, music-video.
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
