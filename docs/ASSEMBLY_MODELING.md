# Modelagem dentro da montagem

A faixa de comandos da montagem reúne Montar, Modelo 3D, Soldagem e Usinagem. A árvore de componentes fica à esquerda e os comandos existentes de restrição, vínculo, visibilidade, fixação, desenho e STEP continuam disponíveis.

## Fluxo

1. Em **Montar**, insira uma peça ou escolha **Criar componente**.
2. Em **Modelo 3D → Criar sketch**, escolha XY, XZ ou YZ, deslocamento do plano, coordenadas e dimensões do retângulo, círculo ou triângulo. Coordenadas são locais ao componente. O círculo usa X/Y como centro; os demais usam o canto inicial.
3. Conclua o sketch. O contorno aparece em verde no 3D para o componente selecionado. **Enquadrar tudo** ajusta a câmera.
4. Escolha **Extrude** ou **Revolve**, selecione o sketch e escolha adicionar ou remover material. A revolução usa X ou Y pela origem do plano. Distância, ângulo e sentido são configuráveis. A aba **Usinagem** inicia esses comandos em remoção de material.
5. Em **Soldagem → Solda de filete**, informe plano, posição, cateto, comprimento e processo. O cordão reto tem seção triangular de catetos iguais e aparece em dourado. É um componente independente que pode ser movido, restringido, ocultado ou removido.

O histórico do componente aparece abaixo da faixa. Clicar em um sketch o seleciona como perfil para a próxima operação. O botão × remove a operação e as posteriores, após confirmação. Ctrl+Z e Ctrl+Y desfazem e refazem as alterações.

As operações são armazenadas em `assemblyFeatures` de cada instância. O arquivo de origem vinculado permanece intacto. Salvamento local, rascunho e montagem portátil preservam operações e dados de solda. STEP, vistas e propriedades físicas usam a geometria reconstruída. Cortes sem interseção ou que eliminem todo o componente são rejeitados antes da alteração do documento.

## Escopo atual

Esta implementação oferece perfis dimensionados em planos principais, operações por componente e filetes retos definidos por coordenadas. Ainda não inclui sketch livre completo na montagem, seleção de face para plano, corte simultâneo de múltiplos componentes, soldas curvas/chanfradas automáticas, símbolos normativos ou todos os ambientes do Inventor. O processo de soldagem é um dado descritivo, sem simulação térmica ou verificação estrutural. A seleção de um processo não muda a geometria.

Referência de organização dos ambientes: [Autodesk — About the Weldments Environment](https://help.autodesk.com/cloudhelp/2021/ENU/Inventor-Help/files/GUID-5986183A-97D5-4E2D-AE00-C1AE0D1C53BB.htm).

## Área de desenho compacta

O menu no logotipo reúne abrir, salvar como, nuvem, STEP, atualizar peças e propriedades. Salvar, desfazer e refazer continuam no acesso rápido. Os comandos de montagem usam os mesmos botões com ícones e dicas do Modelador.

Use o ícone de painel à esquerda das abas para recolher ou restaurar os componentes. Arraste o divisor lateral para ajustar a largura; com foco no divisor, as setas esquerda/direita também funcionam. A seta à direita das abas recolhe a faixa de ferramentas; clicar em uma aba volta a expandi-la. O histórico de operações fica em uma seção expansível. As vistas, enquadramento e wireframe ficam sobre o viewport, sem uma faixa adicional de altura. Em telas pequenas, as abas Modelo 3D/Componentes continuam disponíveis.
