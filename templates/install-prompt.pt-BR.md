# Prompt de instalação e setup (pt-BR)

Copie o bloco abaixo e cole na conversa com o seu agente. Ele deve usar a pasta de skills que o seu harness já lê e pedir permissão antes de instalar qualquer coisa.

---

Instale e prepare o **RoosterEdit** neste projeto.

1. Antes de clonar, pergunte se quero instalação local no projeto (recomendada) ou global. Use a pasta de skills que este harness já lê; exemplos de local: `.opencode/skills`, `.claude/skills`, `.agents/skills`; exemplos de global: `~/.config/opencode/skills`, `~/.claude/skills`. Não clone nada antes da minha resposta.
2. Clone https://github.com/WesleyQDev/RoosterEdit.git na pasta escolhida, com o nome `rooster-edit`.
3. Confirme que o `SKILL.md` está no lugar e rode o doctor da skill. Mostre só o essencial: o que está pronto e o que falta, em no máximo 6 linhas.
4. Se faltar Node.js, FFmpeg, FFprobe, Python 3 ou Whisper/faster-whisper, me peça permissão antes de instalar e explique o comando. Use winget no Windows, Homebrew no macOS ou o instalador adequado no Linux.
5. Se o HyperFrames não estiver disponível, pergunte se quero instalar agora. Não instale nada sem meu OK.
6. Não crie workspace, projeto ou vídeo ainda. Nesta etapa, só instale, valide o ambiente e deixe claro que eu não preciso rodar comandos: você executa e me mostra o resultado.
7. No fim, responda em no máximo 8 linhas: status da instalação, o que já está pronto, o que falta (se algo) e onde ler os detalhes. Não escreva um guia longo nem liste todos os comandos.
8. Termine com uma pergunta simples, sem jargão: **"Quer criar o primeiro canal agora? Pensa nele como a pasta daquele projeto: dentro dela ficam os vídeos, o estilo e os arquivos da marca ou cliente. Se sim, me diga o nome do canal e o que ele vai produzir?"** Se eu disser não, pare sem criar nada.
9. Se eu disser sim, use o nome que eu der (ou proponha um curto em kebab-case se eu não der), infira idioma, formato, voz e política de assets, mostre um resumo curto para eu ajustar e só então crie a pasta `rooster/` com `init` + `channel new`. Não faça as 12 perguntas de uma vez e não defina duração.
10. Depois do canal, crie a identidade: pergunte em um bloco só sobre paleta, tipografia e motion/áudio e rode `channel design <id>`. Se eu não tiver preferência, mantenha o perfil base e diga que dá para mudar depois.
11. Depois do setup, me diga em uma linha como começar o primeiro vídeo e ofereça o prompt de bootstrap.

---

Se o agente não souber onde ficam as skills, veja [`docs/INSTALL.md`](../docs/INSTALL.md) para os caminhos mais comuns. Custos esperados estão em [`docs/COSTS.md`](../docs/COSTS.md).
