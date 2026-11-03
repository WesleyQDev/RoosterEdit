# Primeira execução

Depois de instalar a skill, o ideal é configurar o workspace **antes** do primeiro projeto. Hoje isso não está automatizado por um wizard; o agente faz as perguntas e grava os defaults com `config set`.

## As perguntas

O agente deve perguntar em um único bloco, com defaults:

1. Onde fica o workspace? (padrão: `./rooster`)
2. Idioma padrão? (padrão: `pt-BR`)
3. Formato padrão? (16:9, 9:16, 1:1)
4. Perfil visual padrão? (`minimal`, `tech-neon`, `3d-cartoon`, criar do zero)
5. Política de assets? (`user`, `link`, `library`, `generated`, `none`, `mixed`)
6. Engine? (`auto`, `hyperframes`, `remotion`)
7. Autonomia? (`guided`, `auto`, `manual`)
8. Voz? (usuário, TTS, sem voz)
9. Assets de marca? (logo, fontes, cores, pasta)

## O que o agente faz

```bash
node "<skill>/scripts/rooster.mjs" init

node "<skill>/scripts/rooster.mjs" config set defaults.language pt-BR
node "<skill>/scripts/rooster.mjs" config set defaults.aspect 16:9
node "<skill>/scripts/rooster.mjs" config set defaults.profile minimal
node "<skill>/scripts/rooster.mjs" config set defaults.engine auto
node "<skill>/scripts/rooster.mjs" config set defaults.autonomy guided
node "<skill>/scripts/rooster.mjs" config set assets.strategy mixed
node "<skill>/scripts/rooster.mjs" config set assets.allowDownload true
node "<skill>/scripts/rooster.mjs" config set assets.allowGenerate false
node "<skill>/scripts/rooster.mjs" config set assets.licensePolicy strict
node "<skill>/scripts/rooster.mjs" config set tts.provider auto
node "<skill>/scripts/rooster.mjs" config set tts.language pt-BR

node "<skill>/scripts/rooster.mjs" config show
```

Depois ele resume:

> Workspace em `./rooster`. Padrão: português, 16:9, perfil minimal, engine auto, autonomia guided, assets mistos (arquivos seus + links autorizados; sem geração automática).

E para. Só cria um projeto quando você pedir.

## Por que isso importa

- Evita repetir as mesmas perguntas em todo projeto.
- Deixa claro o que o agente pode baixar, gerar ou usar.
- Define o custo e o risco antes de qualquer API paga.
- Permite trocar defaults depois com um comando.

## Exemplo de conversa

**Você:** “Instale a skill e valide o ambiente.”

**Agente:** instala, roda `doctor`, mostra o que falta. Depois pergunta os defaults.

**Você:** “Português, 16:9, perfil minimal, só meus arquivos e links autorizados, sem TTS, modo guided.”

**Agente:** grava a configuração, mostra o resumo e diz: “Workspace pronto. Me mande o vídeo ou a ideia quando quiser.”

**Você:** “Quero editar este vídeo...”

A partir daí começa o fluxo normal: intake → assets → transcrição → plano → aprovação → build → preview → render.
