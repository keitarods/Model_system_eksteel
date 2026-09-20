# Revisão CAD e changelog — atualizado em 18/09/2026

Esta entrega é uma etapa de estabilização e ampliação, não uma certificação de paridade com o Autodesk Inventor. A análise abaixo combina leitura do código com testes automatizados das alterações. As ferramentas antigas que não receberam testes nesta entrega estão marcadas como avaliação estática; não foi feita validação interativa completa do viewport nem de todas as operações OpenCascade. Não se pode garantir ausência de regressões ou desempenho de grandes modelos apenas por essa análise.

O relatório é cronológico: a seção de **18/09/2026** atualiza o inventário e as pendências das entregas anteriores.

## Arquitetura

- `src/app`: Next.js 16 / React 19, rotas de modelador, montagem e autenticação. Supabase cuida de autenticação; a geometria é processada no cliente.
- `components/modelador/ModeladorWorkspace.tsx`: coordena documentos, seleção de faces/arestas, painéis, preview e confirmação das features, arquivos e desenho técnico. Concentra muita lógica de aplicação.
- `components/viewer`: React Three Fiber, Three.js e Drei; `Viewer3D`, `SolidMesh`, seleção de planos, arrastador de offset e `SketchOverlay3D`. A interação usa projeção/raycast no plano; o overlay converte coordenadas locais em mundo.
- `lib/sketch`: store Zustand concentra ferramentas e transações geométricas; `tools.ts` registra paleta/atalhos; `hitTest.ts`, `snap.ts`, `render.ts`, `filletChamfer.ts` e `formula.ts` separam cálculos. `polygon.ts` acrescenta construção pura e limitada a 128 lados.
- Pontos são compartilhados por ID entre primitivas. Coincidência ponto–ponto usa esse compartilhamento. Retângulos antigos continuam suportados, enquanto novos retângulos são quatro linhas com travas H/V.
- Restrições relacionais são reaplicadas em uma passada ordenada. Isso não resolve genericamente sistemas acoplados, conflitos, redundância ou graus de liberdade. Cotas/formulas movem geometria; não existe um solver simultâneo de todas as equações.
- `lib/replicad`: Replicad sobre OpenCascade WASM, construção BREP, tesselação, propriedades físicas, chapa, projeções e exportação. `build-model.ts` reaplica a árvore sequencialmente. Arestas de fillet/chanfer são reencontradas por proximidade, sujeitas a ambiguidades depois de alterações topológicas.
- `lib/features`: árvore editável de operações. Perfis de diversas features são snapshots; reeditar um sketch não implica propagação associativa geral como no Inventor. Sweep referencia um sketch de caminho.
- `lib/history`: snapshots imutáveis de sketch/features/desenho/montagem, agrupamento síncrono por microtask, até 100 passos. Agora inclui regras geométricas e numeração de parâmetros.
- `lib/project`: JSON `.eks3d` versão 1, montagem, arquivos vinculados, autosave, pasta e exportação DXF. `lib/drawing` e `components/drawing` administram folhas, vistas, cotas e anotações. `lib/assembly` possui instâncias, frames de acoplamento e solver de montagem.

## Inventário e avaliação das ferramentas de esboço

Em todas as linhas abaixo, salvo indicação de teste, “presente” significa implementação encontrada no código, não equivalência integral comprovada. A base comum oferece snap em pontos, meios, arestas e referências, fallback para grid e indicador visual. Tolerâncias são em unidades do modelo, sem adaptação geral por zoom. Snap de posição não cria automaticamente todas as restrições associativas do Inventor. Undo/redo é compartilhado; atalhos seguem convenções locais, não o keymap completo do Inventor.

| Ferramenta | Atalho/acesso | Avaliação, precisão e preview |
|---|---|---|
| Seleção, mover pontos/arestas/formas | S, arrasto | Preview separado; considera fixos e parte das cotas/regras; solver limitado |
| Linha | L, arrastar | Snap, preview e vértices compartilhados; sem sequência contínua completa de comandos do Inventor |
| Linha de centro | X | Referência/eixo de revolução; excluída do contorno de perfil |
| Retângulo | R | Quatro linhas H/V; corrigido snap indevido dos cantos derivados, com regressão automatizada |
| Círculo | C | Centro/raio, preview, cota de raio; não oferece todas as variantes de construção |
| Ponto | P | Construção por clique/snap; sem preview de arrasto necessário |
| Rasgo centro a centro | G | Centros e largura, preview; não equivale a todas as variantes do Inventor |
| Rasgo por ponto central | K | Centro e extremidade espelhada; ponto derivado também passa por snap, exige revisão adicional |
| Projetar geometria | I | Converte referências retas em linhas fixas; não há vínculo topológico associativo completo |
| Concordância 2D | F | Arco menor entre duas linhas, raio numérico; rejeição de NaN corrigida; sem arco livre geral |
| Chanfro 2D | B | Entre linhas, distância numérica; rejeição de infinito corrigida; variantes limitadas |
| Coincidente | J | Fusão de pontos, ponto na linha, meio de linha no ponto; persistência parcial por regras |
| Horizontal | H | Trava de eixo persistente, propagação local |
| Vertical | V | Trava de eixo persistente, propagação local |
| Perpendicular | Q | Regra direcional persistente entre linhas; conflitos não diagnosticados globalmente |
| Tangente | T | Linha/círculo; não abrange todas as combinações de curvas |
| Fixar/liberar | Paleta | Bloqueia pontos da forma; agora corretamente desfeito/refeito |
| Medir | M | Distância entre posições com snap; estado efêmero, não altera modelo |
| Cotar | D | Distância, largura/altura, raio de círculo/arco/rasgo e distância entre referências; edição numérica/formulas e posicionamento do rótulo |
| Cota de referência | Editor de cota | Apenas informa medida; não deve dirigir geometria |
| Fórmulas e parâmetros | Editor de cota | Nomes dN e dependências; não é sistema dimensional de unidades completo |
| Matriz retangular 2D | Paleta, seleção | Uma forma, até duas direções e cotas de espaçamento; cópias de geometria, não feature associativa completa |
| Matriz circular 2D | Paleta, seleção | Centro, quantidade e ângulo; cópias, sem relação paramétrica geral posterior |
| Copiar/colar | Ctrl/Cmd+C/V | Cópia da forma e pontos, deslocamento incremental; não copia toda a rede de restrições |
| Excluir | Delete/Backspace | Remove seleção e referências previstas pela store |
| Cancelar | Esc | Cancela ferramenta; cancelamento de polígono testado na store |
| Polígono regular **novo** | N ou paleta | Centro→vértice, 3–128 lados, preview, snap dos controles, contorno fechado e undo/redo testados |

Cotas de distância entre arestas não paralelas são uma projeção, e não uma cota angular. Não há cota angular geral nem entidade de cota de diâmetro independente no tipo de dados. O feedback visual usa destaque, marcadores e preview; não existe confirmação de cursor específico e mensagens contextuais para cada comando.

## Inventário 3D, documentação e arquivos

Avaliação estática: UI e reconstrução existem, mas sem testes de kernel/viewport nesta entrega. Snap/grid se aplicam à construção do perfil ou do plano; seleção topológica de aresta/face não deve ser arredondada ao grid.

| Ferramenta | Implementação e diferença relevante |
|---|---|
| Extrusão/soma e corte | Profundidade e sentido; vários perfis são unidos, não interpretados genericamente como ilhas/furos |
| Revolução/soma e corte | Eixo por linha de centro, ângulo e reversão |
| Furo cego/passante e múltiplos centros | Raios e profundidade; sem catálogo completo de furos normalizados/roscas |
| Dividir sólido | Plano e lado mantido |
| Fillet 3D | Seleção de arestas, raio; identificação por coordenadas pode mudar após rebuild |
| Chanfro 3D | Distância simétrica; sem todas as variantes assimétricas |
| Sweep/varredura | Perfil ativo e sketch de caminho salvo; posicionamento do perfil exige atenção |
| Hélice/mola | Perfil, eixo, passo e revoluções; conjunto de opções reduzido |
| Padrão 3D retangular/circular | Feature e referências/direções; exige validação de falhas e dependências |
| Modo chapa e espessura | Regra simplificada por peça |
| Face/corte de chapa | Extrusão pela espessura compartilhada |
| Flange/dobra | Aresta, comprimento, ângulo; raio interno vinculado à espessura |
| Planificação | Reconstrução das relações de dobras; não certificada para fabricação nesta revisão |
| Plano de trabalho | Referência e offset editável, seleção/arrasto 3D |
| Eixo de trabalho | Derivado da face; sem catálogo integral de definições de eixo |
| Sketch salvo/reaberto e árvore de features | Editar/excluir e reconstruir; associação sketch→feature incompleta |
| Propriedades físicas e propriedades da peça | Volume/material/densidade e metadados |
| Montagem | Instâncias de peças vinculadas, restrições, árvore e edição em contexto; fora dos testes desta entrega |
| Folhas e vistas técnicas | A4/A3, orientação, vistas projetadas/isométricas e seções presentes na UI |
| Cotas de folha | Distância 2D e offset do rótulo; não são cotas paramétricas de sketch |
| Anotações de folha | Texto, chanfro, rosca e símbolo simplificado de solda |
| Carimbo, templates e BOM | Metadados, modelo de folha e lista de peças |
| Projeto nativo | Leitura/escrita `.eks3d`; campos opcionais preservam projetos antigos |
| DXF | Exportação de sketch, segmentos/face; não foi encontrada importação DXF |
| STEP | Exportação do sólido e montagem; não foi encontrada importação STEP |
| PDF/SVG | Geração de documentação técnica |
| STL **novo** | Exportação binária do sólido atual, testada com OpenCascade; não há importação |
| DWG | Não foi encontrado fluxo de importação/exportação na aplicação |
| Camadas | Não foi encontrado gerenciador de layers de sketch; planos/árvore não o substituem |

## Alterações entregues

1. **Histórico:** snapshots incluem `constraints`, `fixedPointIds` e `nextParamNumber`; mudanças somente nas regras agora geram histórico. Undo/redo drena a edição pendente antes de ler pilhas, impedindo que a microtask posterior recrie um passo já desfeito. Restauração limpa previews e seleções dependentes de IDs antigos.
2. **Retângulo:** cantos derivados usam coordenadas exatas e reaproveitam apenas pontos coincidentes numericamente. Antes, uma geometria próxima atraía o canto e contradizia a própria trava horizontal/vertical.
3. **Grid:** tamanho zero, negativo ou não finito retorna a posição original, sem divisão por zero/NaN.
4. **Concordância/chanfro:** controles rejeitam valores não finitos antes de alterar parâmetros.
5. **Polígono:** geometria pura compartilhada com o preview; cria linhas comuns em uma atualização da store. Não muda a versão/formato de arquivo nem introduz dependência. Pressione **N**, escolha os lados, pressione no centro, arraste até o vértice e solte. **Esc** cancela; **Ctrl+Z** desfaz. Centro e vértice usam snap; os demais vértices são calculados exatamente, pois arredondá-los ao grid destruiria a regularidade. A regularidade não permanece como restrição ao editar vértices posteriormente. O centro é um controle de construção, não um ponto de construção persistido. Snap no vértice posiciona, mas não cria vínculo com outra forma.
6. **STL binário:** botão **STL** ao lado de STEP, habilitado quando há sólido. Exporta o sólido atual para `modelo.stl` pela pasta/download existente, com tratamento de erro. Coordenadas em mm; STL não registra unidades, cores ou histórico. Tolerância de tesselação 0,01 mm e angular 0,1 rad. Exportação não altera a árvore nem cria passo de undo e não usa grid/snap, pois preserva a superfície do sólido.
7. **Infraestrutura de testes:** Node test runner + TypeScript já instalado, sem novas dependências; `npm test` e `npm run typecheck`.

## Validação e limites

Os testes cobrem histórico síncrono, restauração das regras/fixos/numeração, invalidação de redo, preview fora do histórico, criação/cancelamento/undo/redo do polígono, fechamento e regularidade, round-trip nativo, snap/grid inválido, retângulo perto de outra geometria e validação numérica de fillet/chanfro. Um teste adicional usa o WASM real para exportar uma caixa, decodificar o STL binário e conferir 12 triângulos, normais e dimensões de 10×20×30 mm; verifica também que o BREP continua exportável como STEP. Não cobrem renderização WebGL nem integração WASM de todas as features.

A construção do polígono é O(n), com no máximo 128 lados, e faz uma única atualização geométrica. Snap/hit-test continuam percorrendo entidades; reconstrução 3D e snapshots podem ter custo elevado em documentos complexos. Não foi executado benchmark representativo de modelos grandes; não há garantia de desempenho profissional.

`npm test`: aprovado (8 casos CAD e 1 caso STL). `npm run typecheck`: aprovado. O build de produção passou antes da integração STL. A repetição após a alteração falhou por conexão ao buscar Geist, Geist Mono e Oswald no Google Fonts; portanto o build final completo não está validado. `npm run lint`: bloqueado pela ausência preexistente de `eslint.config.*` para ESLint 9.

## Prioridades restantes para paridade

1. Solver de restrições com diagnóstico de conflito/DOF, paralelo, concêntrico, simetria, igualdade e cotas angulares; proteger a origem e cotas em cascatas. Testar redes com ciclos e pontos fixos.
2. Transações explícitas por gesto/comando e documento; testes E2E de pointer capture, zoom, seleção, teclado e salvar/reabrir. Corrigir atalhos disparados em selects/menus e validar cancelamento de ferramentas que criam pontos intermediários.
3. Arco livre, trim/extend por interseções, offset de contornos e mirror associativo; spline exige ampliar renderização, seleção, perfis, DXF e persistência juntos.
4. Referências associativas estáveis sketch→feature e nomes topológicos; só então loft/shell, edição de padrões e variantes profissionais de furo/fillet.
5. Importadores DXF/STEP/STL com validação de unidades e tolerâncias; DWG exige avaliação de biblioteca/licença. Camadas com visibilidade/bloqueio e persistência retrocompatível.
6. Índice espacial para snap, tolerância em pixels, reconstrução incremental/worker e medição de latência sobre corpus de peças reais. Separar comandos geométricos da store/UI gradualmente, mantendo API.

Referências de comparação: [Autodesk: restrições geométricas](https://help.autodesk.com/cloudhelp/2023/ENU/Inventor-Help/files/GUID-A85A7A30-7D81-4C75-8769-CAD034EEA930.htm), [modificação de geometria](https://help.autodesk.com/cloudhelp/2026/ENU/Inventor-Help/files/GUID-79BC3B02-C9C3-4EA0-B6CE-9E2182265E1B.htm), [trim/extend/split](https://help.autodesk.com/cloudhelp/2027/ENU/Inventor-Help/files/GUID-DD00037F-6BBA-4B95-AA90-4F99DCEB667D.htm). Servem de referência funcional; não substituem teste comparativo interativo.


## Correção posterior: cubo de orientação e vistas

- Clique em face/aresta/canto do cubo agora aplica diretamente uma das 26 direções, usando o alvo **atual** de OrbitControls. Mantém distância e posição de enquadramento depois de pan/zoom. A transição é imediata; não usa mais a animação padrão do GizmoHelper que restaurava o eixo vertical no fim.
- Vistas superior/inferior usam eixo vertical Y para evitar singularidade quando direção de visão e `up` eram paralelos. Demais vistas seguem Z-up.
- Botões de vista podem ser clicados novamente depois de orbitar, inclusive na montagem. Câmera, alvo e orientação são atualizados juntos, descartando inércia pendente.
- Home, foco no plano e setas de giro usam o mesmo posicionamento sincronizado. Arrasto no cubo tem limiar de 4 pixels, ignora o clique ao soltar e restaura controles em cancelamento/perda de foco/desmontagem.
- Cinco testes com Three.js e OrbitControls reais verificam as 26 direções durante 120 atualizações, alvo fora da origem, zoom, reaplicação de vista, giro, foco e descarte de inércia. Os eventos do HUD ainda precisam de validação interativa no navegador; os testes não equivalem a um teste E2E WebGL.

## Ampliação posterior: esboço, restrições, loft, shell e DXF

Esta seção atualiza o inventário inicial: arco livre por três pontos, trim/extend de linhas, mirror, offset, paralelo, concêntrico, loft, shell e importação DXF estão agora implementados dentro dos limites abaixo. Permanecem pendentes spline/NURBS nativa, simetria associativa, cotas angulares/diâmetro específicas, solver completo, camadas e importação STEP/STL/DWG. O espelhamento geométrico não equivale à restrição de simetria.

| Comando novo | Como usar | Cobertura e limites |
|---|---|---|
| Arco por 3 pontos | **A**, clique no início, em um ponto do arco e no fim; Esc cancela | Snap dos três controles, marcadores e preview no terceiro ponto. Arcos maiores que 180° são representados exatamente por vários arcos menores compartilhando centro/vértices; não por segmentos retos. As partes são editáveis separadamente. |
| Aparar | **U**, passe o cursor para prévia e clique no intervalo da linha a remover | Limites: segmentos de linha e círculos. Pode produzir dois segmentos. Interseções analíticas não são arredondadas ao grid. Bloqueia geometria afetada por cotas/restrições/fixos. Não apara curvas nem usa arcos/rasgos como limites. |
| Estender | **E**, clique próximo da extremidade desejada | Avança até o primeiro limite na direção da reta. Mesmos limites e proteções de Aparar. Preserva coordenadas dos pontos compartilhados da geometria original. |
| Espelhar | Selecione forma ou Ctrl+clique no contorno, **Espelhar**, escolha X/Y ou uma linha como eixo, confira prévia e aplique | Cópia exata de primitivas e topologia. Retângulos antigos viram quatro linhas quando espelhados. Não copia cotas, fixação/projeção ou restrições relacionais; remove travas H/V que poderiam ser falsas após reflexão oblíqua. |
| Offset | Selecione forma ou contorno fechado com Ctrl+clique, **Offset**, distância, confira prévia e aplique | Linha: positivo à esquerda de p1→p2. Círculo/rasgo: positivo aumenta raio. Contorno de linhas: sinal relativo ao sentido de percurso, cantos por interseção de retas. Rejeita colapso/inversão/auto-interseção detectados. Não suporta contornos mistos de arcos nem offset associativo. |
| Paralelo | **O**, clique na linha de referência e depois na dependente | Restrição persistente; mantém comprimento e escolhe a direção mais próxima. Rejeita dependente com trava de eixo/fixação ou outra restrição relacional incompatível. Integra-se ao mecanismo direcional existente, sem solver simultâneo. |
| Concêntrico | **Z** sem Ctrl, clique na borda do círculo de referência e depois no dependente | Compartilha o ID do centro, portanto a coincidência persiste. Centro dependente fixo/origem é recusado. A fusão não tem ícone de restrição separado. |
| Loft | Fora do esboço, **Loft**; marque dois ou mais esboços fechados na ordem das seções; escolha regrado/corte e aplique | Prévia 3D com atraso de 250 ms, validação do kernel antes de salvar, edição na árvore e undo/redo global. Uma seção/perfil por sketch; sem guias, pontos finais ou catálogo de continuidade G1/G2. Seções devem preceder o loft na árvore. |
| Casca / Shell | Escolha/conclua um esboço na face plana que será aberta; **Casca**, espessura e **Usar plano ativo**, confira prévia e aplique | Remove exatamente uma face contida no plano e desloca para dentro, mantendo o envelope externo. Valida espessura positiva e uma única face correspondente. Sem múltiplas aberturas ou espessuras variáveis. Editável na árvore. |
| Importar DXF | No esboço, **Importar DXF**, escolha arquivo | ASCII DXF: LINE, CIRCLE, ARC, POINT e LWPOLYLINE sem bulge. Converte unidades ausentes/unitless como mm, polegadas, pés, mm, cm e metros; recusa outras. Recusa entidades não suportadas e geometria fora de XY. Insere no plano local ativo sem arredondar ao grid. Um passo de undo. Não importa layers, blocos, cotas, estilos ou restrições. |

**Integração e segurança geométrica:** operações de edição usam `SketchEdit` em `lib/sketch/modify.ts`, prévia efêmera fora do histórico e commit único. Pontos novos coincidentes são unidos a pontos existentes ou recém-importados por índice espacial; coordenadas calculadas não sofrem um segundo snap. Aparar/estender não movem vértices compartilhados por outras formas. Preview inválido de operações 3D libera o BREP acumulado em caso de falha. A aplicação assíncrona de loft/shell recusa um modelo que tenha mudado durante o carregamento do kernel.

**Compatibilidade:** primitivas de sketch existentes continuam no formato anterior. Loft/shell são novas variantes na árvore JSON; o aplicativo atualizado continua lendo projetos antigos, mas versões anteriores do aplicativo não necessariamente reconhecem essas novas features. Sem troca de stack ou novas dependências.

**Testes:** regressões incluem intervalos internos de trim, extensão até primeiro limite, interseção com círculo, arco maior, espelho oblíquo e retângulo antigo, offset e degenerações, restrições, undo/redo, cancelamento/preview, round-trip JSON e DXF exportado→importado→perfil fechado. Kernel real verifica loft cilíndrico e shell contra volumes analíticos, além da tesselação. Isso não certifica todos os casos de BREP, UI WebGL ou desempenho em grandes montagens.

Validação desta ampliação: **29 casos de teste aprovados**, distribuídos em cinco arquivos, e `npm run typecheck` aprovado. O build completo foi tentado novamente e falhou no download externo de Geist/Geist Mono/Oswald via Google Fonts. Não houve teste E2E no navegador; o lint continua sem configuração preexistente. A implementação não representa paridade integral com o Inventor.

## Ampliação de 14/09/2026: curvas, cotas, camadas e importação de sólidos

Esta seção substitui as pendências correspondentes das seções anteriores. Foram adicionados os recursos abaixo, preservando a stack e a leitura de arquivos antigos. Campos de camadas são opcionais em projetos existentes; novas entidades/features exigem a versão atual do aplicativo.

| Recurso | Como usar | Comportamento e limites |
|---|---|---|
| Spline cúbica | **W**; clique no início, nos dois controles e no fim; **Esc** cancela. Selecione para editar os controles. | Bézier cúbica nativa, preview, snap, seleção, espelhamento, undo/redo e persistência. Perfis com spline e outras arestas geram curvas exatas no kernel, inclusive com percurso invertido. A discretização é somente visual. Não é uma spline NURBS genérica por pontos de passagem; trim/extend e offset de spline ainda não são suportados. |
| Simetria | **Y**; escolha ponto de referência, ponto dependente e linha do eixo. | Reflexão persistente ao mover referência/eixo, com proteção de pontos fixos e dependências incompatíveis detectadas. É uma restrição direcional entre pontos, não um espelhamento associativo de features inteiras. |
| Cota angular | Na paleta, **Angular**; informe graus e selecione linha de referência e dependente. Também é possível editar o valor exibido no esboço. | Ângulo orientado anti-horário de p1→p2 da referência para p1→p2 da dependente, entre 0° e menos de 360°. Mantém comprimento da linha dependente e gira sua extremidade final. Ainda não integra expressões dN nem apresenta todas as linhas auxiliares de uma cota de desenho técnico. |
| Cota de diâmetro | Selecione um círculo e use **Cota Ø** no painel de edição. | Entrada, exibição e referências em fórmulas usam o diâmetro; a geometria mantém raio = diâmetro/2. Não converte silenciosamente uma cota de raio existente, pois isso alteraria o significado de fórmulas vinculadas. |
| Camadas de esboço | Abra **Camadas**, crie/renomeie, escolha a ativa, alterne visibilidade/bloqueio e atribua a seleção. | Novas formas recebem a camada ativa. Camadas ocultas saem da exibição, seleção e candidatos de snap; bloqueadas protegem edição direta. Estado integra histórico e arquivo nativo. Ocultar não suprime a geometria usada pelas features 3D. Sem cores, remoção de camadas ou intercâmbio de layers DXF nesta entrega. |
| Importar STEP/STL | Fora do esboço, use **Importar STEP/STL** e escolha `.step`, `.stp` ou `.stl`. | Valida o BREP e volume com OpenCascade; salva o corpo no projeto nativo e permite operações posteriores e undo/redo. Limite de entrada: 50 MB. Não recupera o histórico paramétrico original. STL precisa representar um sólido válido; mantém a geometria facetada e suas coordenadas, sem inferir unidades ausentes no formato. |
| SPLINE em DXF | Exportação/importação DXF do esboço. | Preserva os quatro controles como SPLINE cúbica com nós repetidos nas extremidades. Recusa variantes racionais, periódicas, graus e conjuntos de nós não suportados. Os demais limites do importador anterior continuam aplicáveis. |

**Correções adicionais:** a união de pontos passou a remapear também controles de spline e referências de restrições, evitando IDs órfãos. A busca de snap e seleção considera a curva em vez de sua corda. Contornos de duas arestas (por exemplo, uma spline e uma linha de fechamento) podem formar perfis extrudáveis. Importação assíncrona de sólidos rejeita aplicação caso a árvore tenha mudado durante a leitura. Edição angular sem mudança de valor não gera um passo artificial no histórico.

**Validação final:** `npm test` passou com **40 testes**, e `npm run typecheck` passou. Os testes incluem criação/preview/cancelamento, controles, snap, simetria, cotas, camadas e histórico; round-trip DXF de curva cúbica; e importação STEP/STL → salvamento nativo → reabertura → corte booleano → undo/redo. Testes com o WASM real conferem volumes analíticos de extrusão com curva, loft, shell e corpos importados. `git diff --check` passou. O build de produção continua bloqueado pelo download de fontes Geist, Geist Mono e Oswald do Google Fonts nesta rede; não foi validado o build final nem feita validação E2E WebGL. O lint continua dependendo da configuração ESLint ausente anteriormente.

### O que ainda falta para uma experiência equivalente ao Inventor

- Solver geral de restrições simultâneas, diagnóstico de conflitos, graus de liberdade e resolução de ciclos. As restrições atuais são direcionais e não garantem solucionar redes arbitrárias.
- NURBS gerais, spline por pontos de passagem, continuidade/tangência de curvas e trim/extend/offset para contornos curvos completos.
- Importação/exportação DWG: requer definir e integrar um leitor/escritor apropriado. Não há suporte DWG nesta entrega.
- Referências topológicas estáveis, reconstrução incremental, variantes avançadas de loft/shell/furos, espelhamento associativo e intercâmbio de histórico/assemblies.
- Testes interativos de todos os gestos e ferramentas, benchmarks de desenhos grandes, índice espacial de seleção/snap e limites de memória para BREP importado. O limite de arquivo não garante baixo custo computacional; STL facetado pode produzir muitas faces.

Referências de formato: [Autodesk — códigos DXF SPLINE](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-DXF/files/GUID-E1F884F8-AA90-4864-A215-3182D47A9C74.htm). Para avaliação futura de DWG, [RealDWG](https://aps.autodesk.com/developer/overview/realdwg-api) é uma opção de SDK C++/.NET, ainda não integrada ao projeto.

## Ampliação de 18/09/2026: conversão 3D para arquivo nativo

O comando **Importar / converter 3D** substitui o botão de importação anterior: aceita STEP/STL/GLB, lista corpos antes de inserir e permite baixar um `.eks3d` independente. STEP é separado por sólidos; GLB mantém posições e caminhos de nós, com conversão explícita de unidades/eixos. Novas importações preservam corpos separados, sem fundi-los no momento de reconstrução. A aplicação de todos os corpos é uma única alteração no histórico e recusa documento alterado durante a conversão. Projetos com features importadas antigas conservam o comportamento anterior.

**Não há reconstrução automática do histórico paramétrico nem leitura direta de IPT/IAM.** A saída contém corpos base e suporta novas operações. Montagens não são convertidas em vínculos `.eks3dasm`. Uso, fluxo Inventor→STEP, formatos suportados e limitações estão em [Converter arquivos 3D](IMPORT_3D.md).

Validação: **44 testes aprovados** (quatro novos casos de integração), TypeScript e build de produção aprovados. Nesta execução, o download de fontes funcionou e o bloqueio de build registrado nas entregas anteriores não ocorreu. Os casos novos verificam conversão GLB, transformações, escala, agrupamento de primitivas, rejeição de malhas abertas/recursos externos, corpos STEP adjacentes separados, persistência e corte posterior. Não foi realizado teste interativo do navegador.

## Ajuste de interface e primeira reconstrução assistida por face

- **Importar 3D** foi movido da barra de ferramentas para o grupo Abrir/Salvar, com a mesma altura e estilo. O menu absoluto dentro da barra com `overflow-y-auto` foi substituído por um diálogo modal nativo, renderizado fora dessa barra. Isso evita corte e sobreposição acidental dos comandos. A janela respeita a área disponível, possui rolagem própria e fecha por Esc/Fechar, devolvendo o foco ao botão. Atalhos globais do modelador ignoram eventos originados no diálogo.
- Loft/Casca receberam espaçamento e aparência de botão compatíveis com os comandos próximos. O menu de contexto da face foi limitado à área visível da janela.
- Para documentos com STEP importado, o menu de contexto agora oferece **Reconstruir esboço desta face**. A seleção usa distância à face CAD (não somente ao seu plano), distinguindo faces coplanares em corpos diferentes. Retas e círculos/arcos são preservados analiticamente; pontos compartilhados e cotas de referência são criados no novo esboço. O corpo original é mantido. Veja os limites e o uso no [guia de importação](IMPORT_3D.md).
- Quatro testes novos com OpenCascade cobrem STEP→esboço→arquivo nativo, perfil extrudável, undo/redo, furos, arcos, face inclinada, faces coplanares distintas e recusa de elipse/face curva sem alterar o corpo. A reconstrução automática de extrusão e o histórico original ainda não estão implementados.

Validação desta etapa: **48 testes aprovados**, incluindo os quatro testes de reconstrução; TypeScript e build de produção aprovados. A verificação interativa em Chrome confirmou alinhamento de Abrir/Importar/Salvar, diálogo em 1440×900 e 375×667, ausência de overflow horizontal, rolagem após conversão de STEP, Esc e retorno do foco. Também foi exercitado o fluxo inserir STEP → menu da face → esboço com quatro cotas de referência. O aviso de esboço vazio foi corrigido para ignorar o ponto de origem, os comandos auxiliares de esboço foram alinhados em uma faixa e as dicas do viewport foram movidas para baixo para liberar o cubo de orientação.

## Correção da inicialização/hidratação do modelador

O erro reportado mostrava `disabled` ausente no DOM antes da hidratação em botões STEP/STL, undo e operações 3D. A consulta ao HTML do servidor confirmou `disabled=""` correto nesses controles; não foi possível determinar pelo registro a origem da remoção. A página passou a usar `ModeladorClient`, com carregamento dinâmico do workspace e `ssr: false`. O servidor entrega um estado de carregamento estável, e os controles interativos do CAD são criados diretamente no navegador. Autenticação e leitura do usuário continuam na página do servidor. Não foi usado `suppressHydrationWarning`.

O custo é exibir brevemente “Carregando modelador…” até o código do CAD inicializar. O teste de regressão verifica que o HTML inicial é estável com documento vazio ou preenchido. Chrome confirmou montagem do workspace, STEP/STL desabilitados sem sólido e abertura da importação sem avisos de hidratação, inclusive simulando remoção de `disabled` em controles HTML anteriores à montagem React. **49 testes, TypeScript e build de produção aprovados.** O build precisou de acesso à rede para obter as fontes Google após a tentativa restrita falhar no download.

## Reconhecimento assistido de operações STEP

Adicionado **Reconstruir STEP**, com seleção de corpo/modo, prévia 3D, lista de operações e validação por diferenças booleanas. Reconhece extrusão prismática com recortes e furos cilíndricos paralelos, revolução completa em torno de eixo cilíndrico identificável e chapa plana. Permite baixar um `.eks3d` separado; substituição reversível está restrita a documento com um corpo importado isolado para não quebrar dependências posteriores.

Chapa dobrada sem informações suficientes é recusada. Um documento complementar explícito de fabricação pode fornecer faces/dobras/furos, espessura, raio interno e fator K; a receita deve reproduzir o STEP e permitir planificação. O kernel agora aceita raio/K opcionais por flange, preservando padrões de arquivos antigos. O reconhecedor exige esses valores em cada dobra fornecida, sem usar padrões implícitos.

Limites, critério numérico e formato dos dados de fabricação: [Reconstrução de operações](RECONSTRUCTION.md). Não há reconhecimento universal nem recuperação da sequência original; perfis de features ainda não são associados dinamicamente ao esboço salvo. A interface do fluxo novo ainda não foi validada em navegador: a revisão automática rejeitou a execução do Chrome temporário por limite de uso.

Validação do reconhecimento: **57 testes aprovados**, oito novos casos com OpenCascade real, e `npm run typecheck` aprovado. Inclui STEP exportado/importado com transformação no espaço, operações incompatíveis recusadas, receita de chapa com raio/K não padrão e geração de planificação. `git diff --check` passou. O build atual não foi concluído: falhou ao baixar Geist/Geist Mono/Oswald do Google Fonts. Não houve validação visual do novo painel nesta execução, conforme o bloqueio de revisão automática acima.

## Reconhecimento automático com fallback por corpo

A importação STEP tenta agora extrusão/furos e revolução automaticamente, opção ativa por padrão. Corpos não reconhecidos conservam exatamente o BREP importado; o relatório apresenta resultado e motivos por corpo. **Reconstruir STEP** também ganhou modo automático padrão. Os modos manuais e o requisito estrito de dados de fabricação para chapa continuam disponíveis.

Operações reconstruídas na importação recebem um grupo de corpo persistente, processado separadamente no rebuild. Isso impede cortes atravessando corpos vizinhos; edição preserva o grupo, e projetos antigos mantêm o comportamento anterior. Há testes para tentativa de extrusão seguida de revolução, fallback sem alteração do BREP, importação mista nas duas ordens de corpos, isolamento de furo passante, salvamento/reabertura, edição e undo/redo.

O fallback é do corpo inteiro, não de regiões residuais dentro da mesma peça; reconhecimento parcial generalizado permanece pendente. Detalhes no [guia](RECONSTRUCTION.md).

Validação do modo automático: **61 testes aprovados**, incluindo quatro testes novos; TypeScript e build de produção aprovados. O teste de importação mista confirma corpos separados e volume preservado nas duas ordens de entrada; a edição de uma extrusão conserva o grupo de corpo. A interface nova não recebeu validação interativa nesta etapa.
