# Atalhos de teclado

Atalhos inspirados no Inventor e adaptados aos comandos existentes do Eksteel. Referência: https://www.autodesk.com/shortcuts/inventor

## Modelo 3D

| Tecla | Comando |
|---|---|
| S | Criar esboço: escolher face ou plano |
| M | Medir entre faces ou extremidades de arestas (ΔX, ΔY, ΔZ) |
| E | Extrudar o perfil ativo; em chapa, criar Face |
| R | Revolucionar (perfil e linha de centro necessários) |
| H | Furo (sólido e círculos necessários) |
| F | Arredondar arestas |
| Esc | Encerrar medição 3D |

M no modelo não modifica a peça. Clique em duas faces para medir a menor distância entre suas superfícies reais. Shift+clique seleciona a aresta inteira mais próxima na face clicada, inclusive curvas. Combine face e aresta em qualquer ordem, ou duas arestas. Alt+Shift+clique seleciona a extremidade de aresta mais próxima na face clicada; pontos livres no interior da face não são utilizados. É possível combinar face e extremidade. Arestas fechadas, como círculos, não fornecem extremidades.

O painel mantém a distância em mm e ΔX, ΔY e ΔZ assinados nos eixos globais, da primeira para a segunda referência. Esses componentes correspondem ao par de pontos de distância mínima calculado pelo kernel; havendo vários pares equivalentes, o kernel escolhe um deles. Faces adjacentes têm distância mínima zero. Não se trata da distância entre planos infinitos nem de uma cota paramétrica. Esc ou iniciar outro comando encerra a medição. Alterar o sólido limpa as referências anteriores.

## Esboço

| Tecla | Comando |
|---|---|
| L | Linha |
| R | Retângulo |
| C | Círculo |
| A | Arco de três pontos |
| D | Cota |
| M | Medir no plano do esboço |
| F | Concordância |
| T | Aparar |
| Shift+T | Tangente |
| Shift+E | Estender |
| E | Concluir esboço e abrir Extrudar/Face, se houver perfil fechado |
| Esc | Cancelar a ferramenta e voltar à seleção |
| S | Selecionar (atalho legado, dentro do esboço) |

Os demais atalhos do esboço aparecem nas dicas das ferramentas. Ctrl/Cmd+S, Ctrl/Cmd+Shift+S, desfazer/refazer e copiar/colar mantêm os fluxos existentes; não são uma cópia integral do mapa do Inventor. Comandos de desenho técnico e montagem não foram remapeados.

Os novos comandos não disparam em campos de texto/número, selects, conteúdo editável, menus ou diálogos abertos. Repetição de tecla e composição de texto são ignoradas.

Ao selecionar duas faces planas, a medição também mostra o menor ângulo entre os planos (0° a 90°) e seu suplementar (180° menos esse ângulo). Planos paralelos mostram 0°/180° e perpendiculares 90°. Não depende da orientação das normais nem do ponto clicado. Faces curvas e seleções com arestas/vértices mantêm a distância, sem ângulo de plano.

Em Medir (M), Alt+clique junto a uma borda circular seleciona seu centro geométrico e mostra raio e diâmetro. Clique em outra face para medir do centro até a superfície real, em qualquer ordem. O centro é o da borda circular mais próxima na face clicada (boca/fundo do furo), não o ponto clicado nem um eixo infinito. Rebaixos podem ter várias bordas: confira o centro marcado e o diâmetro exibido. Também funciona em bordas circulares externas; não classifica automaticamente a geometria como furo. Shift+clique continua medindo a partir da própria aresta, quando se deseja a distância da borda em vez do centro.

A medição oferece os botões Face, Aresta, Centro do furo (R/Ø) e Extremidade. Eles permitem selecionar sem modificadores de teclado: escolha Centro do furo, clique na superfície junto à borda e depois escolha Face para medir até ela. Trocar o modo preserva a primeira referência. Alt+clique continua disponível. A busca também aceita círculos de faces vizinhas muito próximos do clique (tolerância de 15% do raio, mínimo 0,1 mm), sem usar círculos remotos.

## Seleção de perfis nas operações

Ao criar Extrudar, Face/Recortar ou Revolução, o painel **Perfis do esboço** lista contornos fechados com miniaturas. Marque os perfis desejados; a pré-visualização e a operação usam apenas essa seleção. **Nenhum** desabilita a confirmação e **Seleção anterior** restaura a escolha do esboço (Ctrl+clique ou perfil padrão). Na Face, a lista acompanha o esboço salvo escolhido no campo Perfil. A seleção explícita preserva o esboço ativo para reutilizar os contornos em outra operação.

Esboços reconstruídos oferecem a região original com seus vazios e os contornos internos separadamente, úteis para cortes. Marcar todos une os perfis, podendo preencher os vazios; confira a pré-visualização. Contornos abertos não aparecem. Esta seleção usa contornos completos: ainda não subdivide automaticamente regiões criadas pelo cruzamento de curvas sobrepostas. Ao editar uma operação já existente, o perfil original permanece preservado; a escolha nova está disponível na criação.

## Redefinir plano do esboço

Com o esboço concluído, clique em **Plano** na sua linha do Histórico. Escolha XY/XZ/YZ, um plano de trabalho criado ou uma face plana no visualizador. Cancelar mantém o esboço intacto. Ao confirmar, o esboço abre para edição no novo plano, mantendo coordenadas 2D, cotas, restrições, camadas e contornos. Para uma face, o ponto clicado define a nova origem; a orientação local segue a base calculada para sua normal. A alteração participa de desfazer/refazer e do arquivo nativo.

A referência é uma posição/orientação de plano, não uma ligação topológica permanente com a face. Operações existentes que copiaram o perfil e plano não são reposicionadas automaticamente; operações novas usam o plano redefinido. Faces curvas são recusadas.

**Manter posição** vem marcado ao redefinir o plano. A nova face deve ser coplanar ao esboço; nesse caso, a origem e os eixos locais anteriores são preservados, mesmo se o clique estiver longe ou a normal da face for invertida. Pontos, referências, cotas e restrições permanecem no mesmo lugar. Planos deslocados ou inclinados são recusados nesse modo, pois não podem conter o mesmo esboço sem movê-lo. Desmarcar a opção restaura o reposicionamento explícito no plano escolhido.
