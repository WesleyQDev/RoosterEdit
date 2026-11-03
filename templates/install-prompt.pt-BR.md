# Prompt de instalação (pt-BR)

Copie o bloco abaixo e cole na conversa com o seu agente. Ele deve usar a pasta de skills que o seu harness já lê.

---

Instale a skill **RoosterEdit** neste projeto e valide o ambiente.

1. Antes de clonar, pergunte se quero instalação local no projeto (recomendado) ou global. Use a pasta de skills que este harness já lê; exemplos de local: `.opencode/skills`, `.claude/skills`, `.agents/skills`; exemplos de global: `~/.config/opencode/skills`, `~/.claude/skills`. Não clone nada antes da minha resposta.
2. Clone https://github.com/WesleyQDev/RoosterEdit.git na pasta escolhida, com o nome rooster-edit.
3. Confirme que o arquivo SKILL.md está no lugar.
4. Rode o doctor da skill e me mostre só o essencial: o que está pronto e o que falta, em no máximo 6 linhas.
5. Se faltar Node.js, FFmpeg ou FFprobe, me peça permissão antes de instalar qualquer coisa e explique o comando.
6. Não crie workspace, projeto ou vídeo ainda. Nesta etapa, só instale a skill e valide o ambiente.
7. No fim, responda em no máximo 8 linhas: status da instalação, o que já está pronto, o que falta (se algo) e onde ler os detalhes. Não escreva um guia longo nem liste todos os comandos.
8. Termine com uma pergunta: "Quer configurar o workspace agora?" Se eu disser não, pare sem criar nada.
9. Se eu disser sim, faça um setup rápido: pergunte só o que o canal vai produzir, infira os padrões e me mostre um resumo para ajustar. Não faça as 12 perguntas de uma vez e não defina duração no canal.

---

Se o agente não souber onde ficam as skills, veja [`docs/INSTALL.md`](../docs/INSTALL.md) para os caminhos mais comuns.
