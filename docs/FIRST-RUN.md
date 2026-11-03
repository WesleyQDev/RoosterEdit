# Primeira execução

Depois de instalar, o ideal é configurar **um canal** — não o workspace inteiro. O workspace é a pasta `rooster/` no diretório atual; você não precisa escolher onde ele fica.

## O conceito

```text
Workspace → Canal → Projeto
```

- **Workspace** = a pasta `rooster/`. Infraestrutura e biblioteca compartilhada.
- **Canal** = grupo estável de marca/audiência/operação. Guarda idioma, formato, perfil, categoria, assets, engine, autonomia e voz.
- **Categoria** = receita de conteúdo (talking-head, faceless, 3D...).
- **Perfil** = identidade visual.
- **Projeto** = um vídeo dentro de um canal. Herda os padrões e pode sobrescrever qualquer coisa.

Exemplo: canal **EN Tech** (inglês, 16:9, tech-neon, faceless, TTS) e canal **PT Criador** (pt-BR, 1:1, minimal, talking-head, voz do usuário).

## O que o agente pergunta

Se o harness tiver uma tool de formulário, use ela. Se não, pergunte no chat. Nada de wizard rígido no CLI.

1. Nome do canal.
2. Idioma.
3. Formato padrão (16:9, 9:16, 1:1 ou `auto`).
4. Perfil visual.
5. Categoria padrão.
6. Política de assets.
7. Engine.
8. Autonomia.
9. Voz.
10. Assets de marca (opcional).

O agente grava com:

```bash
node "<skill>/scripts/rooster.mjs" init
node "<skill>/scripts/rooster.mjs" channel new en-tech \
  --name "EN Tech" \
  --language en \
  --format 16:9 \
  --profile tech-neon \
  --category faceless-explainer \
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
projeto > canal > categoria (sugestão) > workspace/global > built-in
```

O canal ganha da categoria porque é o contexto estável de marca/audiência. A categoria fornece estrutura, duração, assets necessários e sugestões. O projeto manda em tudo.

## O que não perguntar

- “Onde fica o rooster?” — o padrão é `./rooster`; só pergunte se o usuário quiser outro caminho.
- Formato global — o formato é do canal/projeto.
- Perfil/assets/engine/voz globais — isso é do canal e do projeto.
- As mesmas perguntas do canal em todo projeto — herde e confirme só o que mudou.

## Mudar depois

```bash
node "<skill>/scripts/rooster.mjs" channel set en-tech format 9:16
node "<skill>/scripts/rooster.mjs" channel set en-tech assets.strategy user
node "<skill>/scripts/rooster.mjs" channel use en-tech
```

Ou, por projeto, edite `project.json` e os overrides.
