# Visibilidade e supressão

Na árvore Histórico:

- **Ocultar peça / Mostrar peça** controla a exibição da malha final, sem alterar a geometria nem exportações. Essa opção é da sessão de visualização.
- **● / ○** alterna a visibilidade de planos, eixos e do esboço quando ele está carregado. Esboços abertos para edição permanecem visíveis. A aplicação ainda não exibe todos os esboços históricos simultaneamente.
- **⏸ / ▶** suprime ou reativa uma operação. Suprimir preserva os parâmetros e recalcula a geometria sem a operação. A árvore risca os itens inativos.

Dependências explícitas (regra de chapa, flange pai, seções de loft, caminho de varredura e estados de dobra) propagam a supressão. Modificadores do sólido dependem do resultado anterior. Dependentes inativos são reativados ao restaurar a origem, exceto os que tenham sido suprimidos explicitamente. A proposta é reconstruída e triangulada antes de ser aplicada; falhas preservam o documento anterior.

Visibilidade de referências e supressão são salvas nos arquivos nativos e participam do undo/redo. Arquivos anteriores assumem visibilidade ativa e ausência de supressão. Não se oculta isoladamente uma extrusão já fundida ao mesmo sólido: o visualizador trabalha com uma única malha final. Seleção individual de corpos e esboços históricos simultâneos ainda não está implementada.

## Corpo importado na árvore

O item de sólido importado (STEP/STL/GLB) também possui **● / ○**. Ocultá-lo remove sua representação e seus modificadores dependentes da reconstrução visual; referências e operações independentes posteriores continuam disponíveis. O cálculo completo, exportações e propriedades físicas preservam o corpo oculto. Mostrar novamente restaura a exibição. O estado é salvo no próprio item e participa de undo/redo.

**Suprimir** continua sendo uma ação diferente: remove o corpo da reconstrução completa, com propagação aos modificadores dependentes. Esboços de referência e operações independentes não são apagados. Operações já fundidas numa mesma cadeia não têm visibilidade individual; ocultar uma extrusão intermediária como se fosse um corpo separado ainda não é suportado.
