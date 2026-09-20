# Converter arquivos 3D para Eksteel

No modelador de peças, fora do esboço, abra **Importar / converter 3D**.

1. Escolha um arquivo STEP (`.step`, `.stp`, `.ste`), STL ou GLB.
2. Para GLB, mantenha **Metros** para arquivos conformes ao formato. Se o exportador tiver gravado coordenadas em milímetros ou centímetros sem conversão, selecione a unidade correspondente antes de escolher o arquivo.
3. Confira a lista de corpos e os avisos da conversão.
4. Use **Inserir no documento** para acrescentar os corpos em um passo de undo/redo; depois salve normalmente. Ou use **Baixar .eks3d** para obter um projeto novo contendo apenas os corpos convertidos.

O arquivo `.eks3d` incorpora a geometria BREP e não depende do arquivo importado para reabrir. É possível acrescentar esboços, extrusões, cortes e outras operações sobre os corpos. Cada corpo recebe uma entrada na árvore; apagar essa entrada remove o corpo. Os novos corpos são agrupados sem união booleana durante a importação, inclusive quando se tocam. Operações posteriores seguem as regras existentes do modelador e podem combinar corpos.

## O que é reconstruído

A conversão constrói **corpos base**, não o histórico paramétrico que originou a peça. Ela não cria automaticamente esboços, cotas, restrições, camadas de esboço, extrusões ou furos equivalentes aos originais. Reconhecer essas operações a partir da geometria final é uma etapa distinta de engenharia reversa, ainda não implementada.

- **STEP:** mantém a geometria CAD dos sólidos e suas posições. O leitor usado não recupera nomes, hierarquia, restrições ou vínculos da montagem de origem; os corpos recebem nomes numerados. A saída é uma peça com múltiplos corpos em `.eks3d`, não uma montagem vinculada `.eks3dasm`.
- **GLB:** converte a cena principal estática em sólidos facetados. Aplica as transformações dos nós, inclusive escala negativa, converte Y-up para Z-up e unidades para mm. Nomes e caminho dos grupos ficam no rótulo/metadados de origem, sem recriar uma árvore de montagem. Primitivas de materiais diferentes do mesmo nó são reunidas antes da validação. Materiais, texturas, animações e outras cenas não são importados. A conversão não transforma curvas facetadas em cilindros ou superfícies analíticas.
- **STL:** converte malha fechada em sólido facetado, conforme o suporte existente. Coordenadas são interpretadas em mm; STL não contém declaração de unidades.

## IPT e IAM

Não há leitor direto desses formatos no aplicativo. Abra a peça ou montagem no Inventor e exporte para STEP; depois use o conversor acima. Para uma montagem IAM, disponibilize também suas peças referenciadas ao Inventor durante a exportação. O STEP resultante pode conter todos os corpos em um arquivo. Consulte as [opções de exportação STEP do Inventor](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/What-are-the-Inventor-Save-As-STEP-Export-Options-stp-ste-step.html).

Leitura direta de IPT/IAM e recuperação de features exigiriam uma integração adicional com um tradutor apropriado/API do Inventor. Nenhum arquivo é enviado a um serviço externo por este conversor.

## Limites e validação

- Até 50 MB e 200 corpos por arquivo; GLB também tem limite de 100 mil triângulos na cena importada. Esses limites não garantem baixa latência: triangulações densas podem ser caras para OpenCascade e para o histórico.
- GLB deve ser versão 2 com buffers incorporados e triângulos estáticos. Recursos externos, extensões obrigatórias/compressão, esqueletos, morph targets e instâncias de GPU são recusados; exporte instâncias como nós separados. Malhas abertas, invertidas, degeneradas ou inválidas para o kernel são recusadas, sem importação parcial.
- A validação do kernel não equivale a reparo automático. Malhas desconectadas dentro de um único nó podem precisar ser separadas em corpos no aplicativo de origem.
- A inserção é recusada se o documento mudar durante a conversão. O resultado ainda pode ser baixado como arquivo independente. Nenhuma etapa de leitura modifica o documento.
- Campos opcionais de origem e preservação de corpos mantêm a leitura de projetos antigos. Features importadas antigas conservam seu comportamento anterior de união.

Os testes automatizados usam o OpenCascade WASM real: GLB transformado/espelhado, unidades, múltiplas primitivas, fechamento, entrada inválida, STEP com corpos adjacentes, round-trip nativo, corte posterior e undo/redo. A interface ainda precisa de teste interativo com arquivos reais representativos.

Referência de coordenadas/unidades: [especificação glTF 2.0, Khronos](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units).

## Reconstruir um esboço de uma face STEP

Depois de inserir um STEP, clique com o **botão direito em uma face plana**, fora do modo esboço, e escolha **Reconstruir esboço desta face**. O programa cria uma entrada de esboço na árvore e a abre para edição; o corpo importado permanece no projeto.

Esta primeira etapa extrai retas, arcos e círculos diretamente das arestas CAD, incluindo contornos internos de furos. Pontos coincidentes são compartilhados. Comprimentos, raios e diâmetros recebem **cotas de referência**, sem impor valores ou restrições geométricas novas. É possível concluir e reabrir o esboço, salvá-lo em `.eks3d` e utilizá-lo nas ferramentas existentes. A extração participa do histórico de undo/redo.

Não há ainda reconhecimento de profundidade de extrusão, substituição automática do corpo, comparação de desvios ou reconstrução da sequência original de operações. O esboço é uma cópia independente da geometria da face, sem vínculo associativo com futuras alterações do STEP. Furos internos são extraídos, mas a seleção de múltiplos perfis continua seguindo as regras existentes de união da extrusão; para reproduzir os furos, utilize operações de corte/furo separadas. Faces curvas, elipses e outras curvas não suportadas são recusadas explicitamente. Limite: mil arestas por face.

O botão **Importar 3D** fica junto de **Abrir/Salvar** no cabeçalho. As opções abrem em uma janela centralizada, com rolagem própria; **Esc** ou **Fechar** retorna ao modelador. O resultado de uma conversão permanece disponível se a janela for fechada e reaberta.

## Reconstruir operações

Além de extrair uma face, o comando **Reconstruir STEP** oferece reconhecimento assistido de extrusão/furos, revolução e chapa, nos limites descritos no [guia de reconstrução](RECONSTRUCTION.md). Essa seção atualiza a limitação anterior sobre ausência de reconhecimento de operações: agora há reconhecimento dos casos documentados, sem recuperação universal do histórico.

A opção **Tentar reconstruir operações do STEP** agora vem marcada na importação. Cada corpo é analisado; quando não há reconstrução válida, permanece como sólido importado. O relatório indica o resultado por corpo. É possível desmarcar para importar somente a geometria. Isso não infere dados de fabricação de chapa.
