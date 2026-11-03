# Testes do fluxo

Data: 2026-11-03

Ambiente: Windows, Node.js 24.14, FFmpeg 8.1, HyperFrames 0.9.8, Remotion 4.0.540, Python 3.13.

## 1. Transcrição com HyperFrames

Arquivo de teste: amostra pública `jfk.wav` do repositório whisper.cpp.

```bash
node "<skill>/scripts/rooster.mjs" transcribe demo --language en --model small
```

Resultado:

- `edit/transcript.json` com schema `rooster.transcript/v1`;
- 3 segmentos e 22 palavras com timestamps;
- `edit/captions/transcript.srt` gerado;
- engine usada: `hyperframes` (Parakeet);
- texto reconhecido: “And so, my fellow Americans, ask not what your country can do for you. Ask what you can do for your country.”

## 2. Plano de edição

`edit/plan.json` criado com:

- 1 corte (`long-pause`, 4.24–5.2s);
- 3 elementos (`letreiro`, `caption-emphasis`, `caption-emphasis`);
- 1 capítulo.

```bash
node "<skill>/scripts/rooster.mjs" plan demo --show
```

Resultado: `0 error(s), 0 warning(s)`. O comando mostra o resumo e lembra que o plano precisa de aprovação antes do build.

## 3. HyperFrames

```bash
npx hyperframes init demo-hf --non-interactive --skip-transcribe --skip-skills --resolution landscape
npx hyperframes check --json
npx hyperframes render --quality draft -o out.mp4
```

Resultado:

- composição de 10.64s, 1920×1080, 30 fps, com áudio;
- `check`: 0 erros, 0 warnings após ajustar o primeiro frame e o tamanho do rodapé;
- render: MP4 H.264/AAC, 10.66s, 1920×1080, ~599 KB;
- frames em 1s e 6s inspecionados visualmente.

## 4. Remotion

```bash
npx create-video@latest --yes --blank remotion-test
npx remotion still src/index.ts JFKTest out-still.png --frame=30
npx remotion render src/index.ts JFKTest out.mp4
```

Resultado:

- composição `JFKTest`, 320 frames, 30 fps, 1920×1080, com áudio;
- still em PNG inspecionado visualmente;
- render: MP4 H.264/AAC, 10.667s, 1920×1080, ~707 KB;
- frame em 6s inspecionado visualmente.

## 5. Build automático

```bash
node "<skill>/scripts/rooster.mjs" build demo --engine hyperframes --force
node "<skill>/scripts/rooster.mjs" build demo --engine remotion --force
```

Resultado:

- HyperFrames: 9.44s (o corte de 4.24–5.2s foi aplicado), 1920×1080, 30 fps, H.264/AAC, ~464 KB.
- Remotion: 9.472s, 1920×1080, 30 fps, H.264/AAC, ~546 KB.
- Os dois builds aplicaram os cortes com FFmpeg, remapearam os tempos dos elementos, geraram o projeto do engine e renderizaram frames inspecionados visualmente.
- O tema veio do profile `minimal` (fundo claro, tipografia escura, acento terracota).

## 6. Teste com vídeo real (pitch Momai)

Vídeo de entrada: `Boa 2910 01.mp4` (8:57, 1920×1080, 60 fps, 416 MB).

- Transcrição com faster-whisper `base` (o `small` estava trocando acentos por `?`): 74 segmentos.
- Plano inicial de highlight (88s) rejeitado pelo usuário: o painel cobria a tela e os cortes eram agressivos demais.
- Plano corrigido: vídeo completo (537.13s), sem cortes, apenas lower thirds pequenos nos momentos-chave.
- Render HyperFrames: 8:57.1, 1920×1080, 30 fps, H.264/AAC, ~86.4 MB.
- Áudio normalizado em pós-processamento: -14.07 LUFS, true peak -1.37 dBFS.
- `npx hyperframes check`: 0 erros, 0 warnings.
- Frames inspecionados: slide/timer originais visíveis, sem painel cobrindo; lower-thirds legíveis com fundo escuro.
- Tempo de render: ~11m55s com 6 workers.

Lição: para footage real com slide estático, não cobrir a tela com um painel. Usar apenas lower-thirds/captions pequenos e deixar o vídeo contínuo. O `layout: speaker-left-panel` continua disponível para casos em que o usuário pedir explicitamente.

## 7. Handoff de subagent (smoke test)

Teste em workspace temporário, com o papel `agents/producer.md`:

- o subagent leu o papel e escreveu `brief.md` e `work/handoffs/02-producer.md`;
- devolveu um handoff de 17 linhas, sem transcrição, log ou JSON;
- apontou uma inconsistência real: o intake pedia TTS pt-BR, mas `project.json` tinha `mode.voice: none`;
- o agente principal recebeu só o handoff e o caminho do artefato.

O teste confirma o contrato de retorno e o isolamento de contexto. Ainda falta testar a cadeia completa (transcript → plan → build → QA → render) com subagents em um projeto real.

## 8. Style proof, preview, textcheck, export e sample build

Teste em projeto temporário de 10s, com um corte e quatro elementos:

- `styleproof` gerou `style/proof/index.html` com os três frames e `proof.json`.
- `preview` gerou `preview/index.html` com player, plano, timeline, validação, assets e checklist.
- `textcheck` gerou `qa/text-review.md` com 4 textos e 0 alertas; ao adicionar um storyboard com texto duplicado, gerou 1 alerta.
- `export` gerou `edit/export/cuts.edl` e `timeline.fcpxml`; o FCPXML passou no parser XML do Python.
- `check` avisou que o corte começava no meio da palavra "importante".
- `build --sample 3` gerou 3 dos 4 elementos; o HyperFrames check passou.
- `build --force` gerou o projeto completo; o check passou.
- `paths` mostrou a visão bruto/estilo/trabalho/final.

Ainda falta testar em um projeto real, com mídia longa, legendas queimadas e importação do FCPXML no DaVinci.

## O que funcionou

- `doctor` detecta Node, FFmpeg, yt-dlp, HyperFrames CLI e Whisper (quando instalado).
- `transcribe` usa HyperFrames/Parakeet e normaliza o resultado para `edit/transcript.json`.
- `plan` valida `edit/plan.json` e mostra cortes, elementos e capítulos.
- `build` gera projetos HyperFrames e Remotion a partir do plano, aplica cortes e copia os assets.
- HyperFrames renderiza um MP4 real a partir de uma composição HTML/GSAP.
- Remotion renderiza um MP4 real a partir de uma composição React.

## O que ainda não foi testado

- Transcrição em português com whisper.cpp: o ambiente usou Parakeet (inglês). Para português, é preciso instalar whisper.cpp ou o Whisper CLI.
- Download de link do YouTube com `yt-dlp`: o YouTube bloqueia este ambiente com bot check. O código e o gate de direitos estão implementados, mas o download real precisa ser testado em uma máquina/rede autorizada.
- Build v1 cobre letreiros, caption-emphasis, cards e cortes. B-roll, gráficos ricos, listas e 3D ainda precisam de templates mais específicos.
- Preview unificado no browser e render wrapper do CLI.

## Reproduzir

1. Crie um workspace e um canal:
   ```bash
   node "<skill>/scripts/rooster.mjs" init
   node "<skill>/scripts/rooster.mjs" channel new demo --language pt-BR --format 16:9 --profile minimal
   node "<skill>/scripts/rooster.mjs" new meu-video --channel demo
   ```
2. Coloque um áudio/vídeo em `rooster/channels/demo/projects/meu-video/assets/source/`.
3. Rode `transcribe`, crie `edit/plan.json` e rode `plan --show`.
4. Use `npx hyperframes` ou `npx remotion` para montar e renderizar.
