<h1 align="center">
  <img src="https://raw.githubusercontent.com/WesleyQDev/RoosterEdit/main/docs/assets/logo.png" width="120" alt="RoosterEdit" />
  <br />
  RoosterEdit
</h1>

<p align="center">
  <strong>Transforme o material que você já tem em um corte finalizado.</strong><br />
  Seu agente de código planeja a edição, pede aprovação e renderiza com HyperFrames, Remotion ou FFmpeg.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/rooster-edit"><img src="https://img.shields.io/npm/v/rooster-edit?style=flat-square&logo=npm" alt="npm: rooster-edit" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 22+" />
  <img src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" alt="Status: alpha" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-black?style=flat-square" alt="Licença: MIT" /></a>
</p>

<p align="center">
  <sub><a href="README.md">English</a> · <strong>Português (Brasil)</strong></sub>
</p>

<p align="center">
  <a href="#instalação">Instalação</a> ·
  <a href="#demo">Demo</a> ·
  <a href="#como-funciona">Como funciona</a> ·
  <a href="#documentação">Documentação</a>
</p>

RoosterEdit é uma skill para agentes de código. Entregue um brief e o seu material; ela devolve um plano de edição revisável, um projeto editável e um vídeo finalizado.

O plano é um arquivo, o projeto continua editável e o renderizador é uma escolha, não uma prisão.

## Demo

<p align="center">
  <a href="https://raw.githubusercontent.com/WesleyQDev/RoosterEdit/main/docs/assets/previews/rooster-city-5am-16x9.mp4">
    <img src="https://raw.githubusercontent.com/WesleyQDev/RoosterEdit/main/docs/assets/previews/rooster-city-5am-16x9.gif" alt="Chat que vira o documental The City at 5 AM" width="76%" />
  </a>
  &nbsp;
  <a href="https://raw.githubusercontent.com/WesleyQDev/RoosterEdit/main/docs/assets/previews/rooster-city-5am-9x16.mp4">
    <img src="https://raw.githubusercontent.com/WesleyQDev/RoosterEdit/main/docs/assets/previews/rooster-city-5am-9x16.gif" alt="Corte vertical do mesmo documental" width="22%" />
  </a>
</p>

<p align="center">
  <sub><strong>16:9</strong> · 40 s · chat → documental com parallax</sub>
  &nbsp;&nbsp;&nbsp;
  <sub><strong>9:16</strong> · 28 s · corte vertical do mesmo filme</sub>
</p>

<p align="center">
  <sub>As prévias rodam automaticamente; clique em uma para abrir o vídeo completo.</sub><br />
  <sub>Fotos: Unsplash (CC0), via Wikimedia Commons. Trilha sintetizada para esta demo.</sub>
</p>

## O que o RoosterEdit faz

Ele edita o material que você já tem. Entregue um brief e o seu conteúdo, e ele devolve um corte que você pode revisar, ajustar e manter.

- **Material existente primeiro.** Talking heads, entrevistas, tutoriais, demos, gravações de tela, ensaios com fotos e b-roll que você já possui. Ele limpa silêncio, vícios de fala e takes abandonados antes de acrescentar qualquer coisa.
- **Plano primeiro.** Todo corte começa em um `edit/plan.json` revisável. Você aprova o plano, três frames de estilo e o preview no browser antes do render caro.
- **Um canal, um padrão.** Idioma, formato, estilo, voz e política de assets ficam em um canal. Vídeos novos herdam o padrão em vez de recomeçar de um prompt.
- **Pequeno de propósito.** Node.js e FFmpeg são as únicas ferramentas obrigatórias: sem Python, sem conta de provedor, sem nuvem. O pacote npm tem menos de 1 MB; ferramentas opcionais, como OCR, só baixam para um cache do usuário quando você aprova.
- **Barato em contexto.** As etapas pesadas rodam em subagents e devolvem um handoff curto, então o agente principal nunca lê a transcrição inteira nem o log de build.
- **Deixa a porta aberta.** Exporte EDL/FCPXML para DaVinci Resolve ou Premiere, ou gere uma timeline editável no FilmCraft. Sua edição não morre dentro da ferramenta.

**Para quem é:** criadores e times pequenos com material existente que querem uma edição repetível e revisável dentro do agente que já usam. **Escopo:** edição local, plan-first, com handoff limpo para Resolve, Premiere ou FilmCraft.

## Instalação

```bash
npx rooster-edit@latest install
```

O comando copia a skill para a pasta de skills que o seu agente já lê e mostra o caminho. Funciona com OpenCode, Claude Code, Codex e qualquer harness que leia `SKILL.md`. Depois, abra o agente e diga:

> Configure o RoosterEdit e verifique o meu ambiente.

Instalação global, outro harness ou atualização:

```bash
npx rooster-edit@latest install --global
npx rooster-edit@latest install --harness claude
npx rooster-edit@latest install --force
```

Verifique a máquina:

```bash
npx rooster-edit@latest doctor
```

Requisitos: **Node.js 22+**, **FFmpeg/FFprobe** e um browser. Whisper, `yt-dlp` e GPU são opcionais. Guia completo: [`docs/INSTALL.md`](docs/INSTALL.md).

## O que você pode criar

- Edições de talking head com limpeza de silêncio, vícios de fala e retakes.
- Entrevistas, tutoriais, demos e gravações de tela cortados em uma história objetiva.
- Promos de produto, reels, Shorts e cortes verticais a partir de material existente.
- Explicadores narrados com TTS, legendas, b-roll e gráficos.
- Motion graphics e cenas 3D com blocos do registry do HyperFrames (instalados sob demanda) ou uma cena Three.js/Remotion escrita à mão.

## Como funciona

1. **Canal** — defina os padrões estáveis uma vez: idioma, formato, estilo, voz e política de assets.
2. **Intake** — entregue um brief ao agente e coloque o material no projeto.
3. **Plano** — o agente transcreve e propõe cortes, capítulos, gráficos, b-roll e música em `edit/plan.json`.
4. **Aprovação** — revise o plano, três frames de estilo e o preview no browser.
5. **Build e render** — o engine escolhido monta o projeto; o `qa` confere plano, áudio, cortes e rostos, e extrai só os quadros que precisam de revisão antes do render final.

O plano é o ponto de controle. Se ele estiver errado, o vídeo está errado.

## Documentação

| Guia | O que cobre |
|---|---|
| [Instalação](docs/INSTALL.md) | Instalação local e global, requisitos, problemas comuns |
| [Primeiro vídeo](docs/FIRST-RUN.md) | Do workspace vazio ao primeiro render |
| [Arquitetura](docs/ARCHITECTURE.md) | Como as peças se encaixam e por quê |
| [Workspace](docs/WORKSPACE.md) | Canais, projetos, assets e perfis |
| [Custos](docs/COSTS.md) | O que é grátis, opcional ou pago |
| [Roadmap](docs/ROADMAP.md) | O que vem a seguir |

A documentação detalhada está em inglês.

## Contribuindo

Encontrou um bug ou tem uma ideia? Abra uma issue. Para mexer no código, rode `npm install` uma vez, depois `npm run validate` e `npm test`.

## Créditos

- [Como editar vídeos com IA usando o Claude Code](https://www.youtube.com/watch?v=EIj7WPiKmOE), de Marcos Lemos — inspiração para o fluxo de seis etapas.
- [Fábrica de animações 3D só com o Claude](https://www.youtube.com/watch?v=u6du22ySnC4), de diegokk — inspiração para o pipeline 3D com Three.js.
- [HyperFrames](https://github.com/heygen-com/hyperframes) e [Remotion](https://www.remotion.dev) — os motores de render.

O RoosterEdit não copia esses vídeos. Ele resume os fluxos em uma skill própria.

## Licença

MIT. Veja [LICENSE](LICENSE).

---

<sub>Este é o README em português. A versão canônica é o [README.md](README.md), em inglês.</sub>
