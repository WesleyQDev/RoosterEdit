# 3D Cartoon

Receita para animações 3D curtas com Three.js. A regra é silhueta, ritmo e legibilidade.

## Fluxo

1. Definir o sujeito, o estilo e a duração.
2. Escrever o roteiro ou a sequência visual.
3. Criar o storyboard com câmera, poses e duração.
4. Definir as regras de estilo: forma, paleta, luz, material, câmera, movimento.
5. Implementar a cena 3D no Remotion ou HyperFrames.
6. Testar um still por cena.
7. Renderizar um draft e revisar.
8. Ajustar e renderizar o final.

## Regras de estilo

- Low-poly, formas arredondadas.
- Paleta de 3–5 cores.
- Key, fill e rim light.
- Materiais matte/clay/toy.
- Fundo simples.
- Movimento com squash/stretch e antecipação.

## Determinismo

- Tudo deve ser função do frame/tempo.
- Sem `Date.now()`.
- Sem `requestAnimationFrame` real.
- Random com seed.
- Sem physics não determinística.

## Render

- Teste stills antes do vídeo completo.
- Draft em baixa resolução.
- Verifique frames pretos, geometria faltando e câmera cortando o sujeito.
- Se estiver lento, reduza polígonos, sombras e post-processing.

## QA

- Silhueta legível.
- Paleta consistente.
- Câmera suave.
- Sem frames quebrados.
- Legendas na safe area.
- Áudio licenciado.

## Referência completa

`references/categories/3d-cartoon.md`
