# Primeira execução

Depois de instalar, o ideal é configurar **um canal** — não o workspace inteiro. O workspace é a pasta `rooster/` no diretório atual; você não precisa escolher onde ele fica.

## O conceito

```text
Workspace → Canal → Projeto
```

- **Workspace** = a pasta `rooster/`. Infraestrutura e biblioteca compartilhada.
- **Canal** = padrão de produção estável para uma marca, audiência ou operação. Guarda conteúdo, idioma, formato, duração, perfil, assets, engine, autonomia e voz.
- **Perfil** = identidade visual.
- **Projeto** = um vídeo dentro de um canal. Herda os padrões e pode sobrescrever qualquer coisa.

Exemplo: canal **EN Tech** (inglês, 16:9, tech-neon, TTS) e canal **PT Criador** (pt-BR, 1:1, minimal, voz do usuário).

Não existe categoria separada. O campo `content` do canal registra o que ele produz, e cada projeto define a própria estrutura em `brief.md`, `script.md` e `edit/plan.json`.

## O que o agente pergunta

Se o harness tiver uma tool de formulário, use ela. Se não, pergunte no chat. Nada de wizard rígido no CLI.

A primeira pergunta não deve soar como “criar um canal no YouTube”. Use a pasta como referência:

> **“Vamos criar a pasta do seu primeiro canal? Ela guarda o idioma, formato, estilo, assets e voz padrão dos vídeos deste projeto.”**

Depois, em um bloco:

1. Nome do canal.
2. O que ele produz (uma frase).
3. Idioma.
4. Formato padrão (16:9, 9:16, 1:1 ou `auto`).
5. Duração padrão.
6. Modo de origem (live, generated ou hybrid).
7. Perfil visual.
8. Política de assets.
9. Engine.
10. Autonomia.
11. Voz.
12. Assets de marca (opcional).

O agente grava com:

```bash
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" channel new en-tech \
  --name "EN Tech" \
  --content "English tech explainers" \
  --language en \
  --format 16:9 \
  --duration 60 \
  --profile tech-neon \
  --source generated \
  --voice tts \
  --engine auto \
  --autonomy guided \
  --assets mixed
node "<skill>/scripts/rooster.mjs" channel show en-tech
```

Depois mostra o resumo e para. Não cria vídeo ainda.

## Criar um projeto dentro do canal

```bash
node "<skill>/scripts/rooster.mjs" new video-x --channel en-tech --duration 60
```

Se o projeto for diferente do padrão do canal:

```bash
node "<skill>/scripts/rooster.mjs" new video-special --channel en-tech \
  --format 9:16 \
  --profile brutalist \
  --voice user
```

O `project.json` registra `channel` e `overrides`, então dá para ver o que veio do canal e o que foi decisão do projeto.

## Precedência

```text
projeto > canal > workspace/global > built-in
```

O projeto manda em tudo. O canal é o contexto estável; não há camada de categoria.

## O que não perguntar

- “Onde fica o rooster?” — o padrão é `./rooster`; só pergunte se o usuário quiser outro caminho.
- “Quer criar um canal?” — prefira “Vamos criar a pasta do seu primeiro canal?” e explique que é um padrão de produção.
- Categoria, preset ou receita — esse conceito não existe.
- As mesmas perguntas do canal em todo projeto — herde e confirme só o que mudou.

## Mudar depois

```bash
node "<skill>/scripts/rooster.mjs" channel set en-tech format 9:16
node "<skill>/scripts/rooster.mjs" channel set en-tech assets.strategy user
node "<skill>/scripts/rooster.mjs" channel use en-tech
```

Ou, por projeto, edite `project.json` e os overrides.
