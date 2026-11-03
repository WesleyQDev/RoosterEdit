# Custos

Vídeo com IA não é gratuito, mas dá para separar o que é obrigatório do que é opcional. Os valores mudam por país, plano e fornecedor; confira o preço atual antes de assinar.

## O que é obrigatório

| Item | Custo | Observação |
|---|---|---|
| Agente com acesso a arquivos e comandos | Assinatura ou API | Claude Pro, ChatGPT/Codex, Gemini ou outro. É o único custo realmente necessário para o fluxo. |
| Node.js, FFmpeg, Python | Grátis | Ferramentas locais. |
| Whisper ou faster-whisper | Grátis | Transcrição local; usa CPU/GPU e tempo. |
| HyperFrames | Grátis e open source | Motor padrão para HTML/CSS/GSAP. |
| Remotion | Grátis para indivíduos e times pequenos; licença para empresas maiores | Confira a licença atual antes de usar comercialmente. |

## O que é opcional

| Item | Custo | Quando faz sentido |
|---|---|---|
| DaVinci Resolve Studio | Pago, licença única | Handoff NLE com mais controle; a versão gratuita importa EDL/FCPXML manualmente. |
| TTS pago (ElevenLabs, OpenAI etc.) | Por caractere/segundo | Voz de alta qualidade; Edge TTS e Piper são alternativas locais/gratuitas. |
| Stock, música e fontes | Variável | Só com licença registrada; nunca use sem saber a origem. |
| Render em nuvem | Por minuto/máquina | Vídeos longos ou 4K; o render local costuma bastar. |
| GPU | Hardware | Acelera 3D e encodes; não é obrigatória para começar. |

## Custos invisíveis

- Render repetido: cada draft consome tempo, disco e, em nuvem, dinheiro.
- Retrabalho de estilo: refazer todos os elementos porque o look não foi aprovado antes.
- Transcrição refeita: re-transcrever o mesmo arquivo sem necessidade.
- Tokens de agente: logs, transcrições e código no contexto principal.

## Como gastar menos

1. Aprove 3 frames de style proof antes do plano.
2. Gere 3 elementos de amostra (`build --sample 3`) antes do build completo.
3. Renderize um draft e revise; só depois o final.
4. Use Whisper/faster-whisper local em vez de transcrição paga.
5. Use `digest` em vez da transcrição inteira.
6. Reuse perfis, TTS e projetos; não refaça o que não mudou.
7. Delegue as etapas pesadas a subagents e leia só o handoff.

## Regra de ouro

O RoosterEdit não chama API paga, provider de TTS ou render em nuvem sem permissão explícita. Se o custo for unavoidable, ele aparece no gate da etapa com uma estimativa antes de executar.

O RoosterEdit em si é MIT. O custo é das ferramentas e serviços que ele orquestra.

