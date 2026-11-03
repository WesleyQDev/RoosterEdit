# Prompt de instalação (pt-BR)

Copie o bloco abaixo e cole no agente (OpenCode, Claude Code, Codex etc.). Ajuste o caminho/nome do projeto se necessário.

---

Instale a skill **RoosterEdit** neste projeto e valide o ambiente.

1. Clone o repositório na pasta de skills do projeto:
   ```bash
   git clone https://github.com/WesleyQDev/RoosterEdit.git .opencode/skills/rooster-edit
   ```
   Se você usa Claude Code/Codex em vez de OpenCode, clone em `.claude/skills/rooster-edit` ou `.agents/skills/rooster-edit`.
2. Confirme que existe `.opencode/skills/rooster-edit/SKILL.md`.
3. Rode:
   ```bash
   node .opencode/skills/rooster-edit/scripts/rooster.mjs doctor --json
   ```
4. Me mostre o resultado do doctor em linguagem simples.
5. Se faltar Node.js, FFmpeg ou FFprobe, me peça permissão antes de instalar qualquer coisa e explique o comando.
6. Não crie workspace, projeto ou vídeo ainda. Nesta etapa, só instale a skill e valide o ambiente.
7. No fim, me explique:
   - o que é a skill;
   - como pedir um vídeo;
   - quais comandos eu posso rodar sozinho;
   - o que ainda precisa ser instalado (Whisper, HyperFrames, etc.).

---

## Variação global

Se eu quiser a skill disponível em todos os projetos, clone em:

```bash
git clone https://github.com/WesleyQDev/RoosterEdit.git ~/.config/opencode/skills/rooster-edit
```

No Windows:

```powershell
git clone https://github.com/WesleyQDev/RoosterEdit.git "$env:USERPROFILE\.config\opencode\skills\rooster-edit"
```
