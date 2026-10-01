# Simulação estrutural

Acesse **Simulação** no cabeçalho do Modelador ou `/simulacao`. O documento de estudo é independente da peça: o comando **Usar peça do Modelador** copia a geometria atual. Alterações posteriores no Modelador não atualizam silenciosamente uma análise existente.

## O que está implementado

- Peça sólida STEP ou montagem aberta/importada (`.eks3dasm`), com conversão para milímetros.
- Análise estática com elasticidade linear, material isotrópico comum ou por corpo volumétrico, pequenas deformações; solução incremental para contato unilateral.
- Geração volumétrica por Gmsh, tetraedros C3D4 ou quadráticos C3D10 (padrão de novos estudos), refinamento local por face, tamanho mínimo e discretização por curvatura. Otimização Gmsh + Netgen com qualidade alvo minSICN, percentil 5 e contagem abaixo do alvo.
- Etapa Geometria: reparo/costura de faces, remoção de pequenas entidades, união de partes e união de microfolgas por tolerância. Relatório de sólidos e variação de volume.
- Convergência automática com até quatro malhas, redução de 30% dos tamanhos e comparação de deslocamento, tensão e energia.
- Verificação de equilíbrio de forças e momentos no solver; momentos em N·mm em relação ao centro médio dos nós.
- Contatos aderidos entre faces planas coincidentes de corpos com malhas independentes (C3D4/C3D10), com seleção de pares e relatório de forças transmitidas.
- Contato sem atrito por penalidade, com abertura/fechamento, folga inicial e histórico incremental; faces planas e pequenos deslizamentos.
- Fixação independente de UX, UY e UZ nas faces selecionadas.
- Força total distribuída por área nas faces, pressão normal e gravidade.
- Cálculo real pelo CalculiX, deslocamentos, tensões, deformações e reações.
- Mapa de von Mises **por elemento**, deslocamento total, εxx e deformada com ampliação configurável.
- Arquivo `.eksfea` com STEP, material, condições, malha e resultados; rascunho automático separado em IndexedDB.
- Exportação de resultados JSON e entrada `.inp` do último cálculo disponível no serviço.
- Fila assíncrona, cancelamento e isolamento dos trabalhos por usuário.

## Iniciar nesta máquina

Foram preparados `services/fea/.venv`, as bibliotecas nativas em `services/fea/.runtime` e as variáveis privadas em `.env.local`. Esses arquivos não entram no Git.

Em um terminal:

```sh
npm run fea:dev
```

Em outro, inicie o aplicativo com `npm run dev`. O serviço escuta apenas em `127.0.0.1:8090`. Se o Next.js já estava iniciado antes de configurar as variáveis, reinicie-o para carregar a configuração.

## Instalar em outra máquina Linux

Instale Python 3.11 ou superior, CalculiX (`ccx`) e a biblioteca GLU. Em Debian/Ubuntu, os pacotes nativos são `calculix-ccx` e `libglu1-mesa`.

```sh
python3 -m venv services/fea/.venv
services/fea/.venv/bin/pip install -r services/fea/requirements.txt
```

Defina no `.env.local` do Next.js:

```dotenv
FEA_SERVICE_URL=http://127.0.0.1:8090
FEA_API_TOKEN=SUBSTITUA_POR_UM_SEGREDO_ALEATORIO_DE_24_OU_MAIS_CARACTERES
```

Use `npm run fea:dev`. O lançador lê a chave privada do mesmo arquivo. `CCX_BIN` permite indicar outro executável CalculiX. Nenhuma destas variáveis deve usar o prefixo `NEXT_PUBLIC_`.

## Serviço em Docker

Como alternativa ao Python local:

```sh
docker compose --env-file .env.local -f services/fea/compose.yaml up --build -d
```

O serviço usa um processo HTTP e um trabalhador nativo por vez, limite de 4 GB, até quatro trabalhos na fila e dois trabalhos pendentes por usuário. Em infraestrutura onde o Next.js roda em outro container/servidor, ajuste `FEA_SERVICE_URL` para o endereço privado acessível a ele e use a mesma chave em ambos. O serviço não deve ser exposto diretamente ao navegador. A API Next.js verifica sessão e origem nas operações de escrita. Sem autenticação instalada, apenas desenvolvimento em localhost é permitido.

A geração de malha e o solver não rodam dentro de funções serverless: elas apenas encaminham requisições curtas ao serviço separado.

## Fluxo de uso

1. Crie ou abra a peça no Modelador ou o conjunto na Montagem e entre em Simulação.
2. Clique em **Usar peça do Modelador**, **Usar montagem aberta** ou **Importar montagem** (`.eks3dasm`). Também é possível importar um STEP de peça.
3. Configure E (MPa), Poisson, densidade (kg/m³) e escoamento (MPa). As predefinições são valores iniciais editáveis: confira a liga e sua condição.
4. Em **Geometria**, escolha os reparos antes de definir condições. A tolerância é em mm (de 1e-7 a 1). Fechar microfolgas exige unir partes e usa a tolerância booleana do OpenCASCADE; não é preenchimento de grandes vãos nem reposicionamento de componentes. A eficácia depende da geometria: confira o número de corpos conectados e a variação de volume. Alterar a preparação limpa cargas, apoios e refinamentos para evitar referências a faces modificadas.
5. Em Malha, defina o tamanho em mm e gere. Clique nas faces do modelo para selecionar; clicar de novo desmarca.
6. Para refinar, selecione faces, informe tamanho local e aplique. **Gere novamente** para atualizar a malha.
7. Em Fixações, marque os deslocamentos nulos e adicione o apoio.
8. Em Cargas, escolha força, pressão ou gravidade e adicione. A força informada é o **total conjunto** das faces selecionadas, não o valor por face. Pressão positiva comprime a superfície; gravidade usa m/s².
9. Resolva e consulte os resultados. Ampliação 0 exibe a geometria original; 1 mostra o deslocamento real.
10. Salve o estudo `.eksfea`. Para recalcular um arquivo reaberto ou um rascunho restaurado, gere novamente a malha, porque os identificadores temporários do serviço não são reaproveitados.

## Montagens

A importação copia todos os componentes não suprimidos, inclusive os ocultos, suas posições resolvidas, rotações e operações de montagem/soldagem. Se a Montagem não estiver carregada em memória, o comando procura seu rascunho local. Peças vinculadas precisam estar acessíveis; arquivos com peças incorporadas dispensam os vínculos. Restrições conflitantes ou componentes indisponíveis interrompem a importação inteira. O estudo é uma cópia independente.

No modo **Material comum**, componentes encostados ou sobrepostos são fundidos geometricamente antes da malha, com união contínua e transferência de esforços, sem deslizamento ou separação. A união pode ser desativada na etapa Geometria. Microfolgas podem ser tratadas por tolerância quando a união está ativa; corpos que permanecem separados precisam de apoios próprios ou de contatos aderidos válidos que os liguem a um grupo apoiado. Ligações apenas por aresta ou ponto são rejeitadas. Restrições e componentes aterrados na Montagem posicionam a geometria, mas **não viram fixações FEA**. Defina os apoios e cargas na Simulação.

No modo **Material por corpo volumétrico**, o gerador preserva regiões e compartilha nós nas interfaces encostadas quando a união está ativa. Depois de gerar a malha, selecione o corpo na etapa Material: suas faces externas são destacadas. O centro em mm identifica cada corpo; escolha uma predefinição ou edite E, Poisson, densidade e escoamento. Corpos sem atribuição própria usam o material padrão. Esta etapa não associa automaticamente nomes e materiais dos componentes do CAD aos sólidos STEP. Corpos sobrepostos com união ativa são rejeitados, pois a atribuição de material seria ambígua. Alterar preparação ou modo de materiais limpa as atribuições e condições.

## Contatos aderidos entre malhas independentes

Na etapa **Contatos**, clique em **Preparar corpos independentes** e gere novamente a malha. O comando habilita múltiplos sólidos, desativa união e fechamento de folgas e limpa condições e materiais atribuídos por corpo. O STEP original continua preservado. A etapa Geometria também permite selecionar peça única ou montagem STEP.

Escolha uma face mestre e uma dependente, usando a seleção no visor ou as listas de faces. O seletor **Corpo visível** isola corpos para acessar interfaces internas. **Pares sugeridos** procura centros, áreas e normais compatíveis; são sugestões, não contatos aplicados automaticamente. Prefira a face de malha mais grossa como mestre. Confirme em **Adicionar contato aderido** e configure cargas e apoios.

Esta formulação usa equações lineares `*EQUATION` do CalculiX: cada nó dependente segue a interpolação linear ou quadrática da face mestre. Ela transmite esforços normais e tangenciais, sem fundir geometria, mover nós ou introduzir rigidez de penalidade. Não é contato unilateral: **não abre, não desliza e não possui atrito**. Faces curvas e fechamento de folgas físicas não são suportados nesta etapa.

O solver verifica planicidade, normais opostas, cobertura de toda a área dependente (inclusive furos) e coincidência geométrica, com tolerância apenas numérica, limitada a 1e-5 mm. Um nó dependente não pode estar fixado, ser dependente de outro par ou aparecer como mestre de outro vínculo. Corpos de um grupo aderido precisam de apoios que eliminem seus seis movimentos rígidos; corpos não ligados continuam exigindo apoios próprios. Pares que violam essas condições são rejeitados, em vez de serem ignorados.

O pós-processamento inclui forças de contato no equilíbrio nodal, verifica compatibilidade dos deslocamentos e mantém a checagem de forças e momentos. Em Resultados, cada par mostra número de nós ligados, força resultante X/Y/Z na face dependente (N) e descontinuidade máxima de deslocamento (mm). O JSON também contém forças nodais de contato e a resultante oposta na mestre. Essas forças internas não são confundidas com reações de apoio. Os contatos persistem no `.eksfea` e suas faces são conferidas no refinamento automático.

Os testes com Gmsh/CalculiX verificam tração, flexão, transmissão de momento, rejeição de folgas, cobertura parcial, vínculos repetidos, dependências conflitantes e falta de apoios, além do fluxo HTTP. Na barra axial com interface de malhas diferentes, os erros globais de deslocamento e energia ficaram abaixo de 0,1%. Isso **não valida precisão local de tensão**: a interpolação nó–superfície pode perturbar tensões perto da interface; o teste grosseiro C3D10 apresentou pico próximo de 12,17 MPa para referência uniforme de 10 MPa, embora a resposta global estivesse próxima. Compare refinamentos e malhas compatíveis para avaliar tensões locais. A interface quadrática com nós coincidentes reproduziu a tensão uniforme no teste de referência.

Referência da formulação: [manual CalculiX, restrições multiponto e *EQUATION](https://www.dhondt.de/ccx_2.22.pdf). O suporte nativo a `*CONTACT PAIR`/`*FRICTION` exige outro fluxo de solução incremental e recuperação de contato; não está ativado por esta implementação.

## C3D10 e convergência

Em Malha, escolha a formulação quadrática de 10 nós ou linear de 4 nós. Estudos antigos permanecem C3D4. Os nós intermediários de C3D10 são compartilhados nas arestas e posicionados no ponto médio; a geometria continua com faces planas. Curvatura CAD exige refinamento geométrico. O solver integra C3D10 em quatro pontos; forças superficiais e gravidade usam cargas nodais consistentes, e os apoios incluem os nós intermediários. O limite de 30 mil nós inclui esses nós adicionais.

Em Resultados, **Verificar convergência** resolve a malha atual e até três refinamentos adicionais. Tamanho global, mínimo e refinamentos locais são reduzidos por fator 0,7. A tolerância informada deve ser atendida em deslocamento máximo, von Mises máximo e energia de deformação em duas comparações consecutivas. A variação relativa usa o maior módulo entre o resultado atual e o anterior. As referências geométricas de faces e corpos são conferidas antes de reutilizar cargas, apoios e materiais. Histórico, última malha e resultado válidos são salvos no estudo; cancelamento ou falha de uma etapa preservam a última etapa concluída. Editar configurações invalida o histórico.

A convergência é um critério numérico, não uma certificação da modelagem física. Tensões singulares podem impedir seu atendimento. Para C3D10, o mapa mostra o maior von Mises entre os pontos de integração de cada elemento, enquanto tensores e deformações exportados são médias no elemento. `nodalVonMises` é uma média por volume dos picos elementares, não uma extrapolação das tensões aos nós. A energia é expressa em N·mm; o menor fator de segurança considera o escoamento do material de cada elemento.

## Validação e limites

Os testes do motor usam Gmsh e CalculiX reais. A barra de 100 × 10 × 10 mm, E = 210000 MPa, Poisson = 0, sob 1000 N axiais é comparada com `u = FL/(EA)` e tensão de 10 MPa, além do equilíbrio de reações. Também se verifica a conservação de forças/pressões/gravidade, rejeição de apoios insuficientes, múltiplos sólidos no modo peça e refinamento local. Para montagens, uma barra formada por dois componentes unidos é comparada à solução analítica; corpos separados são testados com e sem apoios individuais.

Na viga engastada de mesma seção com Poisson 0,3 e carga transversal de 10 N, o teste de convergência comparou tamanho global 5 mm (0,012915 mm) e 2,5 mm (0,016650 mm) com Euler–Bernoulli (0,019048 mm). Com C3D10 e tamanho 5 mm, o deslocamento foi 0,019091 mm (diferença de aproximadamente 0,23% em relação à referência). A barra de dois materiais E=210000/70000 MPa também é comparada à soma das flexibilidades axiais. Isso demonstra a melhora por refinamento e também o erro restante: não representa uma certificação geral de precisão.

C3D4 é um elemento de deformação constante e pode ser muito rígido em flexão. Chapas finas e estados quase incompressíveis não são o alvo desta versão. Poisson é limitado a 0,49. Não há cascas, vigas, contatos com atrito ou grandes deslizamentos, plasticidade, análise modal, flambagem ou fadiga. Refine e compare malhas; máximos de tensão em cantos singulares não necessariamente convergem.

O solver calcula deslocamentos. O pós-processamento recupera deformações `B·u`, tensões `D·B·u` e reações pelo equilíbrio nodal. A checagem de resíduos livres considera o limite de arredondamento dos sete algarismos significativos impressos pelo CalculiX no `.dat`. A soma de cargas e reações também é verificada. No JSON, tensões e deformações seguem a ordem xx, yy, zz, xy, yz, zx; as três componentes de deformação por cisalhamento são de engenharia (γ). Tensões são exibidas sem suavização; a razão escoamento/von Mises é apenas um indicador de escoamento elástico.

Limites atuais: 128 componentes por montagem, 12 MB de STEP, 30 mil nós, 100 mil elementos, 240 segundos por trabalho. Os resultados no serviço são temporários, com expiração após 24 h e perda de referências em reinício; salve o `.eksfea` para persistência. O serviço deve usar um único worker HTTP, pois a fila e a autorização dos trabalhos ficam em memória.

## Testes

```sh
npm test
npm run typecheck
# Com ccx no PATH, ou CCX_BIN e suas bibliotecas configurados:
services/fea/.venv/bin/python -m unittest discover -s services/fea -p 'test_*.py' -v
# Para testes HTTP, instale o cliente requerido pela versão de Starlette:
services/fea/.venv/bin/pip install httpx httpx2
services/fea/.venv/bin/python -m unittest discover -s services/fea -p 'test_service.py' -v
```

## Referências e distribuição

- [Manual Gmsh](https://gmsh.info/doc/texinfo/): importação OpenCASCADE, campos de tamanho, malha e qualidade.
- [CalculiX](https://www.calculix.de/) e [manual do solver](https://www.dhondt.de/ccx_2.22.pdf): C3D4/C3D10, elasticidade, restrições multiponto, condições e saída nodal.

Gmsh e CalculiX têm licenças próprias (GPL e opções específicas do Gmsh). Os executáveis não foram incorporados ao código JavaScript nem versionados neste repositório. A distribuição de imagens/binários deve preservar as obrigações de licença correspondentes; executar um serviço separado não elimina essas obrigações.

## Controles de preparação e qualidade

As opções ficam no estudo e são reaplicadas à geometria STEP original a cada geração; o CAD de origem não é alterado. Estudos anteriores continuam compatíveis. Para ativar refinamento por curvatura, use por exemplo 20 divisões por volta e tamanho mínimo menor que o global. Refinamentos por face podem impor tamanhos ainda menores. A qualidade alvo orienta a otimização, mas não garante que todos os elementos a atinjam; a contagem abaixo do alvo permite avaliar o resultado.

Esta implementação usa C3D4/C3D10 e elasticidade linear; o contato unilateral possui as restrições descritas abaixo e não reproduz todas as formulações do Ansys. Flexão, chapas finas e concentrações de tensão exigem estudo de convergência. A união representa continuidade perfeita, com material comum ou por região. A tolerância pode eliminar detalhes físicos: confira o relatório e a malha preparada antes de aplicar as condições.

Referência das operações e controles: [manual do Gmsh](https://gmsh.info/doc/texinfo/gmsh.html), APIs `occ.healShapes`, `occ.fuse`, `Mesh.MeshSizeFromCurvature` e `Mesh.OptimizeThreshold`.


## Contato sem atrito com abertura e fechamento

Em Contatos, prepare corpos independentes, gere a malha e escolha **Sem atrito**. Selecione faces planas com normais opostas; a projeção da dependente deve caber integralmente na mestre. Configure a distância de busca (0–10 mm) e a rigidez normal (1–10⁹ MPa/mm). A busca aceita uma folga inicial, sem mover a geometria. Cada corpo ou grupo conectado por contatos aderidos deve permanecer suficientemente apoiado mesmo com todos os contatos sem atrito abertos. Pares aderidos e sem atrito podem coexistir no mesmo estudo.

A lei é `p = kn max(-g, 0)`, com `g = g0 + n·(u_dependente − Σw u_mestre)`. Não há tração nem força tangencial. As áreas nodais são positivas, obtidas dos triângulos da superfície, incluindo as subdivisões C3D10; os deslocamentos mestres usam interpolação do elemento. Trata-se de penalidade nó-superfície, sensível à escolha da face dependente e à discretização, sobretudo nas pressões locais. Não é a formulação de contato superficial do Ansys.

O serviço controla incrementos de carga e iterações do conjunto ativo. Cada iteração resolve elasticidade linear no CalculiX com molas auxiliares SPRINGA e equações multiponto; os nós auxiliares não integram os resultados físicos. Os incrementos começam em 25% e são reduzidos quando o conjunto ativo não converge. Há até 30 iterações por tentativa, no máximo 100 incrementos aceitos e 180 segundos para a solução incremental. Falhas não são publicadas como resultados parciais. O histórico exibido registra incrementos aceitos, iterações e pontos comprimidos; exige-se atingir 100% da carga.

Resultados incluem força transmitida, pressão máxima, abertura, penetração e energia de penalidade (separada da energia elástica dos sólidos). Reações excluem as forças internas de contato; resíduos e equilíbrio global são verificados. Penetração acima de 1% ou deslocamento tangencial relativo acima de 5% do tamanho global da malha rejeitam a solução. São limites de aceitação desta implementação, não critérios de precisão universais. A normal e a projeção permanecem fixas: não há grandes deslizamentos, grandes deformações, atrito, estabilização artificial nem plasticidade. Compare refinamentos e rigidezes; rigidez excessiva piora o condicionamento.

**Exportar última linearização CalculiX** salva apenas o último conjunto ativo na carga total. Esse `.inp` não contém o algoritmo incremental do serviço e não resolve sozinho alterações de carga com abertura/fechamento. Salve o estudo `.eksfea` para preservar contatos, parâmetros e histórico.

Validação: dois corpos de 50 × 10 × 10 mm, E=210000 MPa e Poisson zero, apoiados nas extremidades externas. Uma força de 1000 N na interface produz transmissão próxima de 500 N em compressão e zero em separação, em C3D4 e C3D10. Com folga inicial de 0,001 mm, o contato abre no primeiro incremento e fecha durante a carga, aproximando a referência de 290 N. Os testes também verificam ausência de resultados parciais, apoios insuficientes, leitura do último bloco de deslocamentos e integração HTTP. Esses casos não constituem validação geral equivalente ao Ansys.


### Montagens com contatos mistos

É possível combinar contatos aderidos (continuidade permanente) e sem atrito (compressão com abertura) na mesma montagem. As equações dos pares aderidos permanecem em todos os incrementos, enquanto somente os pares sem atrito participam da atualização do conjunto ativo. As forças de penalidade são descontadas antes da recuperação das forças dos vínculos aderidos; o equilíbrio global considera a soma de ambos. Os relatórios preservam a ordem dos contatos do estudo.

Grupos ligados por contatos aderidos podem compartilhar seus apoios; o contato sem atrito não é considerado apoio na verificação dos modos de corpo rígido. Mantêm-se as restrições de não repetir nós dependentes e de não usar um nó dependente como mestre de outro par. Assim, encontros de interfaces em arestas comuns podem exigir reorganização das faces. Faces planas e pequenos deslizamentos continuam sendo requisitos.

Validação adicional: três barras de 50 × 10 × 10 mm em série, as duas primeiras aderidas e a terceira em contato sem atrito. Com as extremidades externas fixas e 1000 N na interface da terceira barra, a transmissão em compressão se aproxima de 333,33 N em ambos os pares; em separação, a força transmitida tende a zero. C3D4 e C3D10 são comparados à referência, além da conservação de forças, invariância à ordem dos pares e rejeição de apoios insuficientes.
