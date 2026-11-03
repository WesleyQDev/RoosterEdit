# Templates

Templates usados pelo CLI para criar workspaces, projetos, perfis e starters de engine.

## Perfis built-in

```text
templates/profiles/
├── minimal/
├── tech-neon/
└── 3d-cartoon/
```

Cada perfil tem `profile.json` (contrato legível por máquina) e `STYLE.md` (direção humana).

## Outros templates

| Arquivo | Uso |
|---|---|
| `style.md` | Template de guia de estilo para `channels/<canal>/projects/<slug>/style.md` |
| `plan.example.json` | Exemplo de `edit/plan.json` com cortes e elementos |
| `install-prompt.pt-BR.md` | Prompt único de instalação + dependências + workspace |
| `bootstrap-prompt.pt-BR.md` | Prompt de setup inspirado no vídeo de referência, adaptado ao RoosterEdit |

## Starters de engine (planejados)

```text
templates/engines/
├── hyperframes/
├── remotion/
└── ffmpeg/
```

Os starters devem ser mínimos e funcionais: uma composição, um asset de teste, um comando de preview e um comando de render.

## Como o CLI usa

`node scripts/rooster.mjs init` copia os perfis built-in para o workspace do usuário, se ainda não existirem. O workspace é a fonte de verdade local; os templates são apenas o ponto de partida.

## Regras

- Não incluir mídia pesada nos templates.
- Não incluir fontes sem licença.
- Não incluir chaves de API.
- Manter os JSONs válidos e os IDs em kebab-case.
