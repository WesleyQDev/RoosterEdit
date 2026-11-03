# Assets

A skill trabalha com seis estratégias de assets. A escolha fica no **canal** e pode ser sobrescrita pelo projeto; o workspace serve de fallback técnico.

| Estratégia | O que significa | Suporte atual |
|---|---|---|
| `user` | Só arquivos que você fornece | Sim (`ingest --file`) |
| `link` | Links autorizados baixados pelo agente | Sim para vídeo via `yt-dlp`; imagem direta ainda não é robusta |
| `library` | Música, SFX, fontes, overlays e b-roll do workspace/global | Pastas existem; catálogo ainda não |
| `generated` | Imagens, TTS e vídeo gerados por IA | TTS pode usar HyperFrames/Edge/APIs; imagem/vídeo é plugável, não nativo |
| `none` | Sem assets externos; só texto e motion graphics | Sim |
| `mixed` | Tudo acima, com permissão explícita | Sim |

## Onde ficam

```text
rooster/projects/<slug>/assets/
├── source/       seus arquivos
├── generated/    imagens, áudio e vídeo gerados
├── licensed/     stock, música, fontes e overlays com licença
└── manifest.json inventário, hash, probe, licença e proveniência
```

O agente não deve apagar nem sobrescrever seus originais. Ele copia ou cria hard link para o projeto.

## Como ajustar

No canal:

```bash
node "<skill>/scripts/rooster.mjs" channel set en-tech assets.strategy user
node "<skill>/scripts/rooster.mjs" channel set en-tech assets.allowDownload false
node "<skill>/scripts/rooster.mjs" channel set en-tech assets.allowGenerate true
```

No workspace, como fallback:

```bash
node "<skill>/scripts/rooster.mjs" config set assets.strategy user
node "<skill>/scripts/rooster.mjs" config set assets.allowDownload false
```

Ou, por projeto, edite `project.json`:

```json
{
  "assets": {
    "strategy": "user",
    "sources": ["user"],
    "licensePolicy": "strict"
  }
}
```

## Internet e direitos

Hoje a skill **não busca stock automaticamente**. Ela consegue:

- baixar um vídeo de link autorizado via `yt-dlp`;
- registrar URL, autor, licença e data;
- sugerir termos de busca para você escolher.

Para baixar, o comando exige `--confirm-rights`. Não contorne DRM, paywall ou login. Não use música/fonte/imagem sem licença.

## Gerado por IA

Geração é plugável e exige permissão. O agente pode usar TTS local (HyperFrames/Kokoro), Edge TTS ou um provider configurado. Não gere voz/imagem de uma pessoa real sem consentimento. Não envie mídia privada para um provider sem autorização.

## Como o usuário troca um asset

1. Coloque o novo arquivo em `assets/source/` ou passe o caminho para `ingest --file`.
2. Rode `ingest` para atualizar o manifest.
3. Rode `build` novamente.

Se o arquivo mudou mas o nome é o mesmo, o manifest deve ser atualizado; não confie no probe antigo.
