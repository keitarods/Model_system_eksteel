# Ferramentas de chapa

O grupo **Chapas** reúne conversão/espessura, Face, Recorte, Flange, Planificar, Desdobrar e Redobrar. Furos, padrões, arredondamentos e chanfros continuam nos grupos gerais de modelagem.

- **Planificar / Ver dobrada**: visualização temporária; não cria operação no histórico. Disponível também para chapa plana com sólido, sem exigir flange.
- **Desdobrar**: registra no histórico a abertura de todas as flanges nativas da chapa. Exige uma chapa com flange. A face base mantém a referência usada pelo motor atual.
- **Redobrar**: após Desdobrar, restaura as dobras e registra a operação. Ambos são salvos no projeto e participam de undo/redo.
- **Flange**: comprimento, ângulo, raio interno e fator K editáveis. Raio vazio acompanha a espessura; fator K padrão 0,5. Os valores antigos permanecem compatíveis.
- **Recorte**: atalho para subtrair o perfil fechado na espessura da chapa, no estado dobrado.

## Limitações

Desdobrar/Redobrar nesta versão operam sobre a chapa inteira, sem seleção parcial de dobras. Não implementam o fluxo de cortar uma dobra aberta e transportar esse corte para a dobra fechada: adicionar operações entre Desdobrar e Redobrar é recusado explicitamente. Para continuar modelando, redobre primeiro. Planificar é apenas visualização e não desfaz uma operação Desdobrar do histórico.

Corpos STEP precisam de flanges nativas reconstruídas com dados suficientes de espessura, raio e fator K. Não se infere um desenvolvimento de fabricação confiável de um sólido arbitrário. Bainha, flange de contorno, alívios automáticos e redobramento de cortes sobre a zona curva ainda não foram implementados.

## Reconhecer uma dobra em STEP

Com um corpo STEP importado, use **Chapas → Reconhecer dobras STEP**. Informe o fator K da sua regra de fabricação e clique em **Analisar operações**. A proposta contém Face e Flange nativas, com espessura, raio interno e ângulo detectados geometricamente. O reconhecimento compara o volume da diferença nas duas direções com o original e verifica que a reconstrução planificada produz geometria.

Use **Substituir corpo por operações** em um documento com apenas o corpo importado; depois clique em **Planificar** ou **Desdobrar**. Para documentos com outros corpos ou operações, baixe o `.eks3d` reconstruído separadamente. Substituir participa do undo/redo existente; uma falha de reconhecimento não altera o original.

A primeira versão cobre **uma dobra cilíndrica simples**, de espessura constante, sem furos/alívios, com superfícies planas e um par de superfícies cilíndricas coaxiais. Aceita outras orientações espaciais e ângulos entre 1° e menos de 179,9°. Está limitada a 30 faces e 240 hipóteses. Múltiplas dobras, bainhas, espessura variável e superfícies livres são recusadas. O fator K é obrigatório e fornecido pelo usuário: o STEP dobrado não determina esse dado de fabricação. Confira o desenvolvimento antes de fabricar.

### Fator K estimado e indicação do planificado

No reconhecimento STEP, é possível optar explicitamente por **K = 0,5 estimado**. Essa hipótese coloca a linha neutra no meio da espessura; não é uma identificação do fator K real pela espessura. A flange salva recebe a marca `kFactorSource: estimated` e uma indicação no nome da operação. O planificado gerado com essa opção também exibe aviso. Sem marcar a opção, continua sendo necessário informar K.

Planificar agora recusa um corpo importado ainda não reconstruído, mesmo que exista uma regra de chapa na árvore. Chapa nativa sem flanges informa que já está plana. Falhas de geração ou triangulação restauram o modo dobrado em vez de manter o botão ativo com a geometria anterior.

### Face a partir de esboço reconstruído

Reconstruir esboço de uma face agora preserva a separação entre o contorno externo e os contornos dos furos. Ao concluir o esboço e escolher **Chapas → Face**, o perfil usa essa região, subtraindo os furos em vez de tentar unir todas as bordas ou selecionar somente o último círculo. É possível escolher também o esboço salvo no seletor Perfil. Reconstruções antigas sem essa informação devem ser refeitas; a alteração não modifica automaticamente os arquivos anteriores. A reconstrução de esboço preserva o corpo original e não equivale a reconhecer suas dobras.

## Flanges encadeados

Flanges criados sobre o trecho reto de outro flange guardam a referência relativa da aresta. Editar comprimento, ângulo ou raio do pai reposiciona os filhos e seus descendentes, tanto no sólido dobrado como no planificado. A posição usa proporções da largura, do comprimento e da espessura do painel pai; uma aresta na ponta permanece na ponta. Flanges irmãos da base continuam independentes.

Ao confirmar a edição, os vínculos dos flanges legados ativos são recuperados antes de alterar o pai. O resultado é reconstruído e validado antes de atualizar o histórico, em uma única ação de desfazer/refazer. O vínculo é preservado no arquivo nativo. Flanges legados suprimidos precisam ser reativados para recuperar a referência antes de editar seu ancestral. Um arquivo já salvo com arestas deslocadas não contém necessariamente informação suficiente para recuperar a intenção original: nesses casos, recrie o flange filho selecionando a aresta correta. Esta correção trata flange sobre flange; não implementa referências topológicas universais para todas as operações CAD.

A seleção de Flange reconhece segmentos colineares contidos na aresta original, mesmo quando operações posteriores dividiram essa aresta. Ao iniciar Flange, a visualização Planificar é desligada para selecionar sobre o sólido dobrado. Se o histórico estiver em Desdobrar, execute Redobrar primeiro. Um sólido sem Face/Flange nativa exige reconstrução/conversão antes de usar esse fluxo.

A identificação do pai também consulta a geometria própria da Face antes de sua união com outros corpos e respeita sólidos importados ocultos na seleção. Isso evita perder a origem da aresta quando o sólido importado de referência cobre a Face reconstruída.

## Profundidade de Recortar

No painel Face, com Corte marcado, escolha **Espessura da chapa** (padrão, acompanha a regra) ou **Distância** para informar uma profundidade positiva em mm. A pré-visualização, o corte e a edição usam o mesmo valor, preservado no arquivo nativo. Os sentidos normal, invertido e simétrico continuam disponíveis; no simétrico, a distância total é dividida entre os dois lados. Face sem corte continua usando a espessura da chapa. Arquivos antigos mantêm o comportamento anterior.

Arredondamentos e chanfros nas arestas dos painéis retos de flanges agora transformam suas referências da peça dobrada para o desenvolvido antes de aplicar a operação. O raio/distância original é mantido. Referências na base permanecem fixas. Operações em superfícies curvas da própria dobra ou em arestas eliminadas pela planificação ainda podem não ter correspondência; nesses casos a operação é recusada com identificação no erro, sem omitir silenciosamente o acabamento.
