# Cotagem automática

Em Desenho, **Gerar cotas automaticamente** prepara novas folhas A3 com prévia; **Inserir folhas** confirma. Não substitui folhas existentes. Para peças reconhecidas como chapa pelo modelador, gera uma folha planificada e outra dobrada, usando as duas reconstruções reais do modelo. Peças comuns e montagens recebem uma folha.

Perfil inicial baseado em uma amostra de 16 PDFs dos dois arquivos fornecidos (271 PDFs no total): cotas gerais externas, parciais em cadeia, milímetros com vírgula decimal, vistas ortogonais e isométrica de apoio. Não foi feito treinamento de modelo nem cópia dos desenhos, nomes, logotipos ou dados profissionais para o repositório. O carimbo vem da folha atual quando disponível.

As cotas gerais usam os limites da projeção, com linhas auxiliares ancoradas nas extremidades conhecidas da geometria. O detalhamento prioriza segmentos de apoio do contorno visível e ignora arestas ocultas, segmentos internos e fragmentos muito pequenos na escala da folha. Limita-se a 12 cotas por vista, verifica sobreposição entre caixas dos textos e usa afastamento inicial de 8 mm e níveis de 7 mm. As cotas gerais ficam a 16 mm. Não é um solucionador completo de colisões entre linhas e vistas.

**Reorganizar cotas da folha** apresenta uma prévia e substitui apenas as cotas automáticas, preservando cotas manuais. Anotações existentes continuam na folha. O botão é útil para folhas geradas antes da correção. **Ajustar folha**, zoom e painéis recolhíveis ampliam a área de trabalho.

O valor das cotas automáticas é armazenado em milímetros da peça, separado das coordenadas no papel. Elas acompanham a posição e escala da vista; atualizar a geometria dessa vista remove suas cotas automáticas antigas. Gere novas folhas para recalcular. As chamadas de diâmetro são anotações estáticas, reposicionáveis manualmente.

Dobras nativas incluem uma tabela de parâmetros: comprimento de aba antes de dobrar, giro assinado da operação e raio interno quando explicitamente definido. A tabela ocupa a célula da isométrica na folha dobrada; acima de 14 dobras, páginas de continuação preservam os registros restantes.

Limites: a cotagem angular depende da identificação de dobras nativas descrita abaixo; não infere dobras de sólidos importados. Não gera localização dos centros dos furos, GD&T ou plano de fabricação completo. A distribuição reduz aglomeração por espaçamento e limite de quantidade, mas não resolve toda colisão de texto. Revise a prévia e complemente o desenho antes da fabricação. Importações sem recursos de chapa não são automaticamente desdobradas.


Cantos arredondados ortogonais: quando duas retas estão ligadas tangencialmente pelo mesmo arco circular, recupera-se seu encontro teórico para medir o lado completo, incluindo as extensões até o canto. Isso evita cotar apenas o segmento reto entre tangências. Não se extrapolam cantos oblíquos, elipses ou splines. Na planificada, trechos de abas em regiões côncavas também entram na seleção; o limite de densidade e espaço ainda pode exigir complemento manual.

Arcos circulares visíveis recebem uma chamada por raio distinto, prefixo R, quantidade por vista e seta sobre o arco. A igualdade é agrupada à precisão geométrica de 0,0001 mm; a apresentação usa até duas casas decimais. Vistas antigas precisam ser atualizadas para extrair os arcos; depois use Reorganizar cotas. Novas folhas já incluem esses dados.

Referência de apresentação consultada: ISO 129-1:2018, https://www.iso.org/standard/64007.html. A consulta pública confirma o escopo; não constitui auditoria de conformidade integral ISO/ABNT. Nenhuma tolerância de fabricação é inferida.

Cotas angulares: na folha dobrada, o gerador procura perfis circulares visíveis ligados tangencialmente a duas retas e compatíveis com um giro de dobra nativo. Desenha uma abertura por dobra identificada e por vista, com arco, setas e símbolo de grau. A abertura entre as laterais é distinta do giro da operação (giro de 40° pode produzir abertura de 140°). A associação usa posição, eixo e raio da operação nativa, conforme a seção Identificação das dobras; confira a referência no desenho. Perfis elípticos, isométricos ou sem reta tangente não recebem ângulos inferidos.

Duplo clique em uma cota abre **Editar cota**. Permite precisão (0–4 casas), prefixo, sufixo, desvios superior/inferior e afastamento (ou raio do arco angular). Aplicar grava na folha; Cancelar/Esc descarta; Excluir remove a cota. O valor medido não pode ser sobrescrito por texto. O formato é salvo no desenho e aplicado à renderização usada nas exportações.

**Atualizar e reorganizar cotas** agora reconstrói as projeções normais a partir da peça antes de extrair arcos e regenerar as cotas. Vistas de seção preservam seus dados atuais. A prévia deve ser confirmada; as cotas manuais são preservadas, mas devem ser conferidas caso a geometria tenha mudado.

**Cota angular · 2 arestas** permite escolher duas retas da mesma vista ortogonal, inclusive separadas por arredondamento. O comando encontra a interseção das direções e mede a abertura projetada; não deve ser usado como ângulo espacial quando a vista não é o perfil da dobra. Paralelas e seleção entre vistas diferentes são rejeitadas. Após criar, abre o editor. **Editar cota…** lista as cotas da folha e permite abrir a janela sem duplo clique.

## Tolerâncias e chamadas ancoradas

O editor separa precisão da medida e da tolerância, aceita desvios manuais assinados e calcula limites ISO 286 para H/h/JS/js, graus IT1–IT18, em dimensões maiores que zero até 500 mm. Fonte: tabela 1 e diagramas das zonas H/h/JS/js da ISO 286-2:2010 (prévia pública vinculada no módulo `isoFits.ts`). As faixas são abertas no limite inferior e fechadas no superior. As tolerâncias calculadas mantêm casas suficientes para não arredondar um desvio pequeno para zero. Não é um catálogo completo: j7, outras zonas e valores fora da faixa validada são rejeitados, sem aproximação. Uma tabela validada adicional é necessária para ampliar essa cobertura.

Chamadas de raio, notas com chamada, balões e soldas mantêm a ponta da seta fixa ao arrastar o texto. Ao mover ou reescalar a vista, a referência acompanha essa transformação. Atualizações topológicas da peça ainda exigem regeneração/revisão das chamadas. A distribuição automática busca espaço fora da geometria e dos textos, evitando cruzar caixas de textos existentes; em folhas saturadas ainda pode haver necessidade de ajuste manual.

## Identificação das dobras

A geração angular não aceita mais apenas coincidência de ângulo. A reconstrução fornece o `FlattenLink` de cada operação nativa; sua posição, raio interno/externo e eixo são projetados na câmera da vista. Só perfis normais ao eixo, com arcos coincidentes e retas tangentes, recebem cotas automáticas. Cada cota guarda o ID da dobra; a eliminação de duplicatas ocorre por dobra na vista, não pelo valor angular. O reconhecimento permite tangências no interior de retas projetadas longas.

A prévia lista as dobras do modelo e identifica as que não receberam cota angular. Não é alegada cobertura completa quando o perfil está oculto, oblíquo ou alterado por operações posteriores. **Atualizar e reorganizar cotas** remove os ângulos automáticos antigos e executa a nova associação. Peças importadas sem operações de dobra não recebem identificação automática por semelhança visual.

## Seleção múltipla de cotas

Arraste uma janela no espaço vazio da folha. Esquerda → direita seleciona cotas cuja linha/arco e texto estão contidos; direita → esquerda seleciona as que intersectam a janela (teste por limites gráficos). Ctrl, Cmd ou Shift acrescenta à janela; com clique sobre uma cota, alterna sua seleção. **Selecionar cotas por janela** permite iniciar o retângulo também sobre uma vista, sem arrastar essa vista. Escape ou Limpar seleção encerra a seleção.

Arraste uma cota selecionada para ajustar os afastamentos do conjunto. Cotas lineares seguem a normal de sua linha; angulares ajustam o raio do arco. Valores, vértices e referências permanecem intactos. A atualização é aplicada em conjunto ao soltar o ponteiro. A seleção é local à folha, não é salva nem exportada. Esta seleção abrange cotas lineares e angulares; notas/chamadas de raio continuam com seu arraste individual ancorado.
