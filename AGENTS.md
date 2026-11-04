# AGENTS.md

Regras para agentes que editam o repositório **RoosterEdit**. Leia este arquivo antes de qualquer mudança.

Ordem de precedência em caso de conflito:

1. `AGENTS.md` — processo e limites do repositório.
2. `SKILL.md` + `references/` — contrato da skill (em inglês).
3. Código em `scripts/` — comportamento real.
4. `docs/` — documentação humana (em pt-BR).

Se o código contradiz a documentação, o código vence para descrever o comportamento; corrija a documentação ou registre a divergência.

---

## 1. O que é este repositório

- A raiz do repositório **é o pacote da skill**. Não é um workspace de vídeo.
- `scripts/rooster.mjs` é o CLI (Node.js, ESM, zero dependências de runtime).
- `scripts/lib/` guarda infraestrutura: cache, exec async, capabilities, engines, media, ASR, build, render.
- `scripts/features/` guarda helpers puros (args de FFmpeg, legendas, gráficos, áudio, motion).
- `scripts/test/` guarda testes com `node:test` (zero dependências).
- `references/` e `agents/` fazem parte da skill instalável e são escritos em inglês.
- `docs/` é documentação humana durável, em pt-BR.
- `.opencode/skills/rooster-edit/` é uma **cópia gerada** por `scripts/sync-skill.mjs`. Nunca edite essa cópia; edite a raiz e rode o sync.
- `rooster/` é o workspace padrão de vídeo do usuário. É ignorado pelo git e não deve ser criado na raiz para testes.

## 2. O que ler antes de trabalhar

| Tarefa | Leia primeiro |
|---|---|
| Qualquer mudança | `AGENTS.md` (este arquivo) |
| Skill, fluxo, comandos | `SKILL.md` |
| Edição, plano, timeline, QA | o reference específico em `references/` |
| Arquitetura e decisões | `docs/ARCHITECTURE.md` |
| Workspace, canais, perfis | `docs/WORKSPACE.md` |
| Testes já feitos | `docs/TESTING.md` |
| Custo e licenças | `docs/COSTS.md`, `references/assets.md` |

Não leia o repositório inteiro por padrão. Leia só o reference da fase atual.

## 3. Idioma

- `SKILL.md`, `references/`, `agents/` e comentários de código: **inglês**.
- `README.md`, `docs/` e este `AGENTS.md`: **pt-BR**.
- Respostas ao usuário: no idioma da conversa.
- Não traduza nomes de comandos, campos de JSON, schemas ou paths.

## 4. Durable vs temporal (regra dura)

`docs/` é somente para documentação **durável**, que deve sobreviver a releases e ser mantida.

**Não coloque em `docs/`:**

- auditorias;
- benchmarks e medições de uma tarefa;
- relatórios de uma sessão;
- rascunhos, análises exploratórias, listas de ideias;
- resultados gerados, logs, frames, contact sheets;
- qualquer arquivo que comece com data ou nome de projeto.

**Coloque em `.scratch/`** (ignorado pelo git), com prefixo de data:

```text
.scratch/2026-11-03-performance-audit.md
.scratch/2026-11-05-render-bench.json
.scratch/2026-11-07-ideias-de-ux.md
```

Regras:

- `.scratch/` é descartável. Pode apagar sem aviso quando o assunto morrer.
- Não linke `.scratch/` no README nem em `docs/`.
- Se um achado virar regra permanente, destile-o no lugar certo (`docs/`, `references/` ou `ROADMAP.md`) e apague o scratch.
- Logs de execução de um projeto de vídeo ficam em `work/logs/` dentro do workspace do projeto, não no repositório.
- Benchmarks de uma máquina não viram documentação oficial sem protocolo reproduzível e data.

## 5. Dados do usuário e segurança

- Nunca apague ou sobrescreva mídia original do usuário.
- Não rode comandos destrutivos (`rm -rf`, `Remove-Item -Recurse`, `--force`) fora de diretórios de teste.
- Para testes, use `ROOSTER_WORKSPACE` apontando para um diretório temporário e limpe depois.
- Não commite `.env`, chaves, cookies, tokens, mídia, renders, caches ou logs.
- Não chame API paga, TTS pago ou render em nuvem sem permissão explícita.
- Não faça upload de mídia do usuário.
- Respeite licenças e proveniência de assets; não invente licença.

## 6. Regras de código

- Node.js `>=20`, ESM (`import`/`export`), zero dependências de runtime.
- Não adicione pacote npm sem pedido explícito; prefira a biblioteca padrão.
- Mantenha o padrão de helpers existente: `run`, `readJson`, `writeJson`, `writeText`, `ensureDir`, `fail`, `probeMedia`, `linkOrCopy`.
- Lógica pura de features fica em `scripts/features/`; infraestrutura com I/O/processos fica em `scripts/lib/`; o CLI e o dispatcher ficam em `scripts/rooster.mjs`.
- Testes automatizados ficam em `scripts/test/` e usam `node:test`; não crie dependências de teste.
- Evite refatorações grandes não pedidas. O arquivo principal é grande de propósito; mexer nele exige cuidado.
- Compatibilidade com Windows: paths com `path.join`, spawn de `.cmd` via `cmd.exe`, sem comandos bash-only.
- `spawnSync` é o padrão atual. Se precisar de paralelismo, introduza um helper isolado e não mude o comportamento existente sem teste.
- Saída humana no stdout; `--json` estável e parseável para agentes.
- Erros devem dizer o que falhou e como corrigir; use `fail()` para encerrar com código 1.
- Não esconda falha atrás de fallback silencioso. Se degradar, avise.

## 7. Mudou o CLI? Checklist

Toda mudança de comportamento precisa atualizar os pontos abaixo, quando aplicável:

1. Implementação em `scripts/rooster.mjs` ou `scripts/features/`.
2. Texto de ajuda/usage no próprio CLI.
3. `SKILL.md` (comandos rápidos e contrato), se for comando ou comportamento de usuário.
4. Reference correspondente em `references/` (ex.: `edit-plan.md`, `engines.md`, `schemas.md`).
5. `templates/` se o schema de plano/perfil mudou.
6. `docs/` apenas se for conhecimento durável.
7. `npm run validate`.
8. Smoke test em workspace temporário.
9. `node scripts/sync-skill.mjs` se quiser testar a descoberta local no OpenCode (a cópia é gerada; não commite).

Não anuncie um comando como pronto sem rodá-lo. Se não deu para testar, diga o que falta.

## 8. Documentação

- `docs/` é durável: precisa de propósito claro e manutenção.
- Não duplique `SKILL.md`; linke.
- Mantenha o índice de documentação do `README.md` atualizado ao adicionar um doc durável.
- Comandos devem ser copiáveis, usando `<skill>` para o caminho da skill.
- Números de performance só entram em doc durável se tiverem protocolo reproduzível.
- Relatórios temporários vão para `.scratch/` (ver seção 4).

## 9. Testes e validação

- `npm run validate` é obrigatório antes de concluir.
- `npm test` roda os testes unitários (`node --test scripts/test/*.test.mjs`) e também é obrigatório quando a mudança toca `scripts/lib/`, `scripts/features/` ou schemas.
- Smoke test mínimo do CLI:

```bash
node scripts/rooster.mjs --help
node scripts/rooster.mjs doctor --json
```

- Para mudanças de fluxo, teste em workspace temporário:

```bash
$env:ROOSTER_WORKSPACE = "$env:TEMP\rooster-test"
node scripts/rooster.mjs init
node scripts/rooster.mjs channel new demo --language pt-BR --format 16:9 --profile minimal
node scripts/rooster.mjs new teste --channel demo --duration 10
```

- Não existe suíte de testes formal. `docs/TESTING.md` é um registro de testes manuais, não uma suíte automatizada.
- Se adicionar testes automatizados, use `node:test` e mantenha zero dependências.
- Teste o caminho de erro também: arquivo ausente, plano inválido, ffmpeg indisponível.
- Em Windows, cuidado com handles de arquivo e hardlinks; valide o comportamento no SO alvo.

## 10. Sync da skill

- Fonte de verdade: a raiz do repositório.
- `.opencode/skills/rooster-edit/` é artefato de build local, ignorado pelo git.
- Rode `npm run sync` (ou `node scripts/sync-skill.mjs`) depois de mudar `SKILL.md`, `references/`, `scripts/`, `templates/` ou `agents/`, se precisar testar no OpenCode.
- Nunca edite arquivos em `.opencode/` diretamente.

## 11. Performance

- Meça antes de otimizar. Benchmarks e resultados vão para `.scratch/` ou `work/logs/`, não para `docs/`.
- Cache só entra com chave de invalidação (conteúdo + versão da ferramenta + opções) e opção de `--refresh`.
- Não troque qualidade por velocidade silenciosamente: draft e final são explícitos.
- Hardware encode só em draft/intermediário, salvo validação de qualidade para entrega.
- Não adicione paralelismo sem limite; Chrome/ffmpeg consomem RAM e CPU.
- Se um relatório de performance for pedido, o default é `.scratch/YYYY-MM-DD-performance-*.md`.

## 12. Git e commits

- Commits pequenos e focados.
- Estilo convencional: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`.
- Não commite artefatos gerados: `.opencode/`, `rooster/`, `.rooster/`, `.scratch/`, renders, mídia, logs.
- Não reescreva histórico nem faça force-push sem permissão.
- Não misture mudança de código com relatório temporal no mesmo commit.
- Se o usuário pedir para manter um scratch, pergunte onde promovê-lo antes de mover para `docs/`.

## 13. Quando a tarefa é produzir vídeo

- Siga `SKILL.md` e o fluxo de 6/8 etapas.
- Não renderize antes do plano e do preview aprovados, salvo pedido explícito.
- Use o workspace do projeto; não crie projeto na raiz do repositório da skill.
- Delegue etapas pesadas a subagents quando o harness permitir; o principal lê handoff, não transcrição/log/código gerado.
- Feche a tarefa com resultado, caminhos, bloqueios e uma próxima pergunta.

## 14. Armadilhas comuns

- `.opencode/skills/rooster-edit/` é gerado; editar ali não muda a skill.
- `docs/` não é lugar de relatório temporário; use `.scratch/`.
- `references/` é contrato da skill em inglês; não traduza.
- `rooster/` na raiz é workspace de vídeo, não pasta de teste do repositório.
- `doctor` pode chamar `npx` e demorar; não o coloque em loop de teste.
- `build --force` apaga o diretório do engine; nunca aponte para projeto do usuário sem intenção.
- `linkOrCopy` usa hardlink quando possível; em outro volume vira cópia.
- Windows pode segurar handles; espere antes de apagar diretórios grandes.
- Não presuma que uma lib está instalada; cheque versão e adapter real.

## 15. Comandos rápidos

```bash
npm run validate
npm test
npm run sync
node scripts/rooster.mjs --help
node scripts/rooster.mjs doctor --json
```

Se algo não estiver claro, pergunte antes de inventar uma convenção nova.
