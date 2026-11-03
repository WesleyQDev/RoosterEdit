<h1 align="center">
  <img src="docs/assets/logo.png" width="120" alt="RoosterEdit" />
  <br />
  RoosterEdit
</h1>

<p align="center">
  <strong>Um estúdio de vídeo para agentes de IA.</strong><br />
  Você traz a ideia e o material. O agente cuida do plano, da edição e do render.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" alt="Status: alpha" />
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 20+" /></a>
  <a href="#motores"><img src="https://img.shields.io/badge/engines-HyperFrames%20%7C%20Remotion-1f6feb?style=flat-square" alt="Motores: HyperFrames e Remotion" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-black?style=flat-square" alt="Licença MIT" /></a>
</p>

<p align="center">
  <a href="#instalação">Instalação</a> ·
  <a href="#como-funciona">Como funciona</a> ·
  <a href="#primeiro-vídeo">Primeiro vídeo</a> ·
  <a href="#motores">Motores</a> ·
  <a href="#documentação">Documentação</a>
</p>

RoosterEdit é uma skill para agentes de IA que trabalham com vídeo. Ela organiza o projeto, transcreve o material, monta o plano de edição, aplica os cortes e entrega o vídeo pronto para revisar.

O agente não sai renderizando por conta própria. Primeiro ele mostra o plano e espera o seu OK. Isso evita o erro mais caro do processo: produzir um vídeo inteiro em cima de uma edição errada.

## O que já funciona

- Organizar materiais por canais, com idioma, formato, estilo, voz e política de assets.
- Transcrever com HyperFrames/Parakeet ou Whisper.
- Montar um plano com cortes, capítulos e elementos visuais.
- Gerar o projeto em HyperFrames ou Remotion já com os cortes aplicados.
- Baixar links autorizados com `yt-dlp`.
- Usar perfis prontos ou criar os seus.
- Revisar no preview e renderizar o arquivo final.

## Como funciona

1. Você configura um canal. Ele guarda o que não muda de vídeo para vídeo: idioma, formato, estilo, voz e de onde vêm os assets.
2. Coloca o material bruto no projeto.
3. O agente transcreve, entende o conteúdo e escreve o plano de edição.
4. Você lê o plano, ajusta o que quiser e aprova.
5. Só então o projeto é gerado, pré-visualizado e renderizado.

O plano é o ponto de controle. Se ele estiver errado, o vídeo inteiro sai errado.

## Instalação

Você vai precisar de Node 20+, FFmpeg com FFprobe e um browser. Whisper, `yt-dlp` e GPU são opcionais.

O jeito mais simples é deixar o seu agente instalar e validar tudo. Copie o prompt abaixo e cole na conversa com o seu agente:

```text
Instale a skill RoosterEdit neste projeto e valide o ambiente.

1. Clone https://github.com/WesleyQDev/RoosterEdit.git na pasta de skills
   deste agente, com o nome rooster-edit.
2. Confirme que o arquivo SKILL.md está no lugar.
3. Rode o doctor da skill e me mostre o resultado em linguagem simples.
4. Se faltar Node.js, FFmpeg ou FFprobe, me peça permissão antes de instalar
   qualquer coisa e explique o comando.
5. Não crie workspace, projeto ou vídeo ainda. Só instale a skill e valide
   o ambiente.
6. No fim, me explique:
   - o que é a skill;
   - como pedir um vídeo;
   - quais comandos eu posso rodar sozinho;
   - o que ainda precisa ser instalado.
```

Se preferir instalar na mão, o passo a passo e as soluções de problemas estão em [`docs/INSTALL.md`](docs/INSTALL.md).

## Primeiro vídeo

Depois de instalar, você não precisa decorar comandos. Peça ao agente algo como "quero fazer um vídeo de 60 segundos sobre tal assunto". Ele cria o workspace, configura o canal, transcreve o material e monta o plano.

Quando ele pedir, coloque o material bruto na pasta do projeto. Depois é só revisar o plano e aprovar. A partir daí o agente gera o projeto, abre o preview e renderiza o vídeo.

O passo a passo completo, com dicas para o primeiro projeto, está em [`docs/FIRST-RUN.md`](docs/FIRST-RUN.md).

## Motores

O HyperFrames é melhor para HTML, CSS, GSAP, motion graphics e vídeos para redes sociais. O Remotion é melhor quando o projeto pede React, componentes e 3D.

O FFmpeg não é um terceiro motor. Ele trabalha por baixo, nos cortes, nas legendas e na montagem.

## Canais e perfis

Um canal guarda o que é estável na sua marca: o que ele produz, idioma, formato, duração, estilo, voz e política de assets. Todo projeto nasce dentro de um canal e pode sobrescrever os padrões.

Perfis cuidam da identidade visual e sonora, como cores, tipografia, motion e legendas. Existem três perfis prontos (`minimal`, `tech-neon` e `3d-cartoon`), e você também pode criar os seus. Não existe categoria separada: o conteúdo de cada vídeo fica no brief, no roteiro e no plano de edição.

## Assets

A skill pode trabalhar só com arquivos seus, com links autorizados, com uma biblioteca local, com conteúdo gerado por IA ou com uma mistura disso. A escolha fica no canal e pode mudar em cada projeto.

Ela não busca stock automaticamente. Links só entram com confirmação de direitos. Veja [`docs/ASSETS.md`](docs/ASSETS.md).

## Para gastar menos tokens

Trabalhar com vídeo gasta tokens, então a skill foi feita para ler o mínimo necessário: trechos da transcrição, o plano em formato legível e alguns frames do resultado. As dicas estão em [`docs/TOKEN-OPTIMIZATION.md`](docs/TOKEN-OPTIMIZATION.md).

## Documentação

- [`docs/INSTALL.md`](docs/INSTALL.md): instalação e problemas comuns.
- [`docs/FIRST-RUN.md`](docs/FIRST-RUN.md): do zero ao primeiro vídeo.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): como as peças se encaixam.
- [`docs/WORKSPACE.md`](docs/WORKSPACE.md): como o workspace é organizado.
- [`docs/ASSETS.md`](docs/ASSETS.md): direitos e políticas de assets.
- [`docs/TOKEN-OPTIMIZATION.md`](docs/TOKEN-OPTIMIZATION.md): como gastar menos contexto.
- [`docs/TESTING.md`](docs/TESTING.md): o que já foi testado.
- [`docs/ROADMAP.md`](docs/ROADMAP.md): próximos passos.

## Contribuindo

Encontrou um bug ou tem uma ideia? Abra uma issue. Se for mexer no código, rode a validação do projeto antes de mandar o pull request.

## Créditos

- [Como editar vídeos com IA usando o Claude Code](https://www.youtube.com/watch?v=EIj7WPiKmOE), de Marcos Lemos: inspiração para o fluxo de seis etapas, do estilo ao render.
- [Fábrica de animações 3D só com o Claude](https://www.youtube.com/watch?v=u6du22ySnC4), de diegokk: inspiração para o pipeline 3D com Three.js.
- [HyperFrames](https://github.com/heygen-com/hyperframes) e [Remotion](https://www.remotion.dev): os motores de render.

O RoosterEdit não copia o conteúdo dos vídeos. Ele resume os fluxos em uma skill própria, com estrutura e perfis adaptados.

## Licença

MIT. Veja [`LICENSE`](LICENSE).
