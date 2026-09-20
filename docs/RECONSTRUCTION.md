# Reconstrução de operações a partir de STEP

No modelador, importe um STEP e abra **Reconstruir STEP**, ao lado de Importar 3D. Escolha um corpo e o tipo de reconhecimento. **Analisar operações** não altera o documento: apresenta prévia, lista de operações e diferença geométrica medida.

- **Baixar reconstrução .eks3d** gera um projeto separado e conserva o original aberto.
- **Substituir corpo por operações** está disponível somente quando o documento contém exatamente um corpo importado, sem features posteriores. A troca é um único passo de undo/redo. Se o documento mudar durante a análise, a aplicação é recusada.
- Em arquivos com vários corpos, reconstrua e baixe cada um separadamente. A substituição parcial não é oferecida porque operações antigas podem referenciar a topologia do corpo importado.

## Reconhecimento disponível

| Modo | Resultado | Condições |
|---|---|---|
| Extrusão | Esboço, extrusão base, recortes e furos | Corpo prismático com face plana de entrada e contorno de retas/arcos/círculos; profundidade medida. Recortes passantes são reconstruídos. Furos cilíndricos completos paralelos à extrusão podem ser passantes ou cegos de fundo plano. |
| Revolução | Esboço da meia-seção e revolução 360° | Eixo identificável numa superfície cilíndrica, meia-seção única com contorno suportado. Inclui eixos escalonados e tubos, desde que a reconstrução coincida com o corpo inteiro. |
| Chapa sem dados complementares | Regra de espessura, face base e eventuais recortes/furos | Chapa plana com espessura constante comprovada por reconstrução; espessura limitada a 20% da raiz da área externa como filtro conservador de candidatas. Esse filtro não identifica material nem processo de fabricação. |
| Chapa com dados complementares | Regra, faces, dobras e furos fornecidos | Documento JSON explícito de fabricação, validado e comparado ao STEP. Dados insuficientes ou divergentes geram erro. |

Não se trata de um reconhecedor universal de histórico. Degraus prismáticos, cavidades arbitrárias, furos inclinados/cônicos/roscados, fillets/chanfros como operações separadas, revoluções parciais e superfícies livres ainda podem ser recusados. A função não transforma uma região desconhecida em operação aproximada para fazer a análise passar.

O contorno e as cotas extraídos são esboços nativos, com cotas de referência. Profundidade, ângulo e parâmetros de furo são editáveis nas operações da árvore. **Limitação do modelo atual:** as features armazenam uma cópia do perfil; editar o esboço salvo não atualiza automaticamente essa cópia. A reconstrução não acrescenta associatividade que o motor ainda não possui.

## Chapa: erro se faltarem informações

O leitor STEP atual fornece BREP, não extrai histórico de dobras, regra de material, fator K ou tabela de desenvolvimento. Uma chapa dobrada sem esses dados é recusada no modo Chapa, mesmo que se possa observar sua espessura aparente. Nenhum valor padrão de fabricação é escolhido pelo reconhecedor.

Quando houver informações de fabricação, forneça um arquivo complementar `.json` no seletor **Dados de fabricação**. Esse arquivo é um contrato explícito do Eksteel; não é uma leitura automática de metadados de qualquer exportador STEP.

Veja [o exemplo de dados de chapa](examples/chapa-reconstruction.json). Ele descreve uma peça específica de base 40 × 30 × 2 mm e uma dobra; não deve ser aplicado como receita genérica. Operações devem estar na ordem de construção e conter:

- `format: "eksteel-sheet-reconstruction"`, `version: 1`, `features`.
- Uma regra `sheetMetal` com `thickness` positiva antes de qualquer face.
- Face base com `profile` e `plane` nas coordenadas do STEP, em mm.
- Cada `flange` com pai anterior (`parentId`), extremidades da aresta (`edgeStart`, `edgeEnd`), comprimento reto, ângulo, **`innerRadius` e `kFactor` explícitos**. Raio positivo; ângulo entre 0 e 180° exclusivos; fator K entre 0 e 1.
- Recortes/alívios representados pelas operações suportadas (`face` com corte ou `hole`). Dados que não reproduzem os alívios existentes falham na comparação.

Tipos aceitos no documento: `sketch`, `sheetMetal`, `face`, `flange`, `hole`. Até 200 operações e 2 MB. Os IDs são remapeados, inclusive os pais de dobras. Uma receita correta é reconstruída dobrada e também precisa permitir geração da planificação. **O fator K é uma informação fornecida, não verificável pela geometria dobrada.** O sucesso não certifica parâmetros de fabricação para uma máquina/material.

O motor foi ampliado para usar raio interno e fator K explícitos por dobra. Arquivos antigos, sem esses campos, preservam seus valores históricos (raio = espessura; K = 0,5). Esses padrões legados não são aceitos implicitamente pelo importador de dados de chapa. A edição de comprimento/ângulo preserva os dados explícitos; a barra mostra o raio e o K efetivos. Para trocar os dados de fabricação nesta etapa, ajuste a receita e reconstrua novamente.

## Critério de aceitação e desempenho

O resultado precisa ser um BREP válido. São calculadas as diferenças booleanas `original − reconstruído` e `reconstruído − original`; a soma de seus volumes absolutos deve ser menor ou igual a `max(1e-7 mm³, volume_original × 1e-8)`. Isso detecta deslocamentos e remoções/adicionamentos mesmo quando o volume total coincide. Não equivale a uma certificação metrológica por distância máxima entre superfícies.

O reconhecimento geométrico aceita um sólido por vez, até 200 faces, procura até 40 faces planas ou 20 eixos cilíndricos candidatos. Falhas do kernel/candidatas incompatíveis não publicam operações parciais. A análise é local e síncrona após carregar o WASM; corpos complexos podem bloquear a interface temporariamente. Não há garantia de desempenho em modelos industriais grandes.

Os testes com o kernel real cobrem extrusão/furos cegos e passantes, eixo oco escalonado, chapa plana, recusa de chapa dobrada sem dados, reconstrução e planificação com raio/K explícitos, dados incompatíveis, persistência e undo/redo. Uma comparação de volumes iguais em posições diferentes é recusada.

## Modo automático com preservação do sólido

A importação oferece **Tentar reconstruir operações do STEP**, ativado por padrão. Para cada corpo, tenta extrusão/recortes/furos e, se não houver correspondência válida, revolução de 360°. O primeiro resultado que passa pela comparação geométrica é usado. Se nenhuma hipótese funcionar, o BREP importado original é mantido, sem alteração e sem interromper os outros corpos. STL/GLB permanecem como corpos importados.

O relatório identifica **operações reconstruídas** ou **mantido como sólido** por corpo e permite consultar os motivos das tentativas malsucedidas. Desmarcar a opção mantém o comportamento de importação somente como sólidos. Não escolhe chapa automaticamente nem presume fator K/raios de fabricação. O modo específico de chapa continua estrito.

**Reconstruir STEP** também abre por padrão em **Automático — manter sólido se não reconhecer**, para documentos importados anteriormente. O modo automático que não reconhece mostra o sólido original, não um erro que obrigue a descartar a peça. Os modos manuais permanecem disponíveis para escolher uma interpretação específica.

Na importação de vários corpos, as operações de cada corpo são marcadas por `bodyGroupId` e reconstruídas isoladamente antes de combinar o resultado como corpos separados. Assim, um furo passante de uma peça não corta a vizinha. Essa marcação opcional é salva no `.eks3d` e preservada na edição. As operações de cada grupo devem permanecer consecutivas; agrupamentos desordenados são recusados. Arquivos antigos sem a marcação mantêm seu comportamento. Versões antigas do aplicativo não conhecem esse isolamento e não devem editar esses novos projetos.

O reconhecimento continua limitado aos casos geométricos documentados. **O fallback é por corpo inteiro:** ainda não decompõe uma peça complexa em regiões parcialmente reconhecidas mais um sólido residual. Não é paridade completa com reconhecedores comerciais. A análise é síncrona dentro de cada corpo, com atualização de progresso entre corpos.
