# Simulação estrutural

Acesse **Simulação** no cabeçalho do Modelador ou `/simulacao`. O comando **Usar peça do Modelador** cria um estudo vinculado à peça. Configurações, geometria de referência, malha e resultados são incorporados no `.eks3d` quando a peça é salva (arquivo local, Salvar Como ou nuvem). O rascunho local também é atualizado durante a simulação; isso não sobrescreve automaticamente o arquivo do disco. Use **Baixar peça com simulações** no ambiente FEA ou salve a peça no Modelador. Os estudos aparecem na árvore da peça e no seletor do ambiente de Simulação. São aceitos até 20 estudos por peça. Alterações posteriores no histórico do Modelador não modificam silenciosamente uma análise: um aviso identifica a versão antiga, e um novo estudo pode ser criado da geometria atual. Reabrir resultados dispensa o solver; recalcular exige uma malha na sessão atual. STEP, montagens e arquivos `.eksfea` sem vínculo continuam como estudos independentes.

A seleção oferece pré-destaque ciano, faces selecionadas em azul, substituição por clique simples, Ctrl/Shift para alternar referências e modo Múltipla para toque. Esc, Limpar e clique no fundo limpam a seleção. O filtro de contornos usa os limites das triangulações de faces (não as diagonais internas), sem substituir uma topologia CAD exata; contornos podem selecionar explicitamente suas faces adjacentes. Condições FEA continuam restritas a faces. Os painéis listam referências removíveis e a área total selecionada.

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
- Força por componentes globais ou normal às faces, com intensidade em N, prévia das setas e opção de inverter o sentido; pressão normal e gravidade. No modo normal, o padrão é para dentro. A intensidade é a soma das magnitudes distribuídas por área, não a magnitude da resultante em superfícies curvas ou não paralelas. A cada cálculo/refinamento, a força normal é convertida em pressão equivalente usando a área dos triângulos de integração da malha atual, mantendo compatibilidade com o comunicador nativo.
- Cálculo real pelo CalculiX, deslocamentos, tensões, deformações e reações.
- Mapas de calor de von Mises **por elemento**, σxx/σyy/σzz, τxy/τyz/τxz, deslocamento total e X/Y/Z, εxx e fator de segurança (escoamento do material de cada região dividido por von Mises). O mapa de segurança limita a escala visual a 10, mostra valores menores que 1 em vermelho e trata tensão nula como ≥10; o resumo numérico permanece sem esse limite.
- Visualização da deformada sem ampliação (real 1×), 2×, 3×, geometria original (0×) e ampliação personalizada. Faixa manual de tensões em MPa com saturação das cores fora dos limites, restauração automática e marcadores de extremos da superfície visível; as opções não alteram os resultados físicos. Marcadores de tensão identificam elementos, não a posição exata de um ponto de integração.
- Barra de progresso por etapas reportadas pelo motor, com avanço por elementos no pós-processamento. Não estima tempo restante nem a fração interna da fatoração do CalculiX. Comunicadores anteriores mostram progresso indeterminado.
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

Instale Python 3.11 ou superior, CalculiX (`ccx`) e a biblioteca GLU. Em Debian/Ubuntu, os pacotes nativos são `calculix-ccx`, `libglu1-mesa`, `libgl1`, `libxrender1`, `libxcursor1`, `libxft2`, `libfontconfig1` e `libxinerama1`. O pacote Gmsh pode exigir essas bibliotecas mesmo sem interface gráfica.

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


## Operação automática no site

Os visitantes usam apenas o navegador. No modo **Servidor da instalação**, o serviço FEA deve ser implantado uma vez pelo administrador em um servidor que execute processos persistentes. No modo **Meu computador**, o comunicador desktop executa o mesmo motor localmente, sem VPS. `npm run dev` e `npm start` iniciam somente o Next.js; publicar o site não instala nem inicia o solver automaticamente.

No servidor Linux com Docker, configure as variáveis privadas e execute:

```sh
docker compose --env-file .env.local -f services/fea/compose.yaml up --build -d
```

O container roda em segundo plano e a política `restart: unless-stopped` reinicia o processo após falhas e após reinicializar o servidor, desde que o Docker inicie no boot. Um container parado manualmente permanece parado até ser iniciado novamente. Não é necessário manter um terminal aberto. A imagem inclui todos os módulos FEA e uma verificação autenticada de saúde, sem imprimir o token. O contexto de build exclui ambientes locais, segredos e dados de trabalhos.

Para conferir a operação, use `docker compose --env-file .env.local -f services/fea/compose.yaml ps` e `logs --tail=100 fea` com o mesmo prefixo. O healthcheck indica indisponibilidade, mas o Docker Compose não reinicia automaticamente um processo que continua vivo e apenas fica `unhealthy`; esse caso exige monitoramento e intervenção do administrador.

A publicação do Next.js em hospedagem serverless exige um servidor separado para Gmsh/CalculiX. Configure `FEA_SERVICE_URL` com um endereço alcançável pelo servidor Next.js e mantenha o mesmo `FEA_API_TOKEN` nos dois serviços. `127.0.0.1` aponta para o próprio ambiente de execução: não alcança outro servidor ou container. O Compose fornecido publica a porta somente no loopback do host; acesso remoto exige configurar rede privada ou um proxy HTTPS autenticado. Nunca coloque o token em variáveis `NEXT_PUBLIC_`.

A configuração está preparada no repositório; ativação em produção depende do servidor escolhido. Em caso de indisponibilidade, o site orienta o visitante a tentar novamente ou contatar o administrador, sem solicitar comandos de instalação.


## Comunicador local — Windows e Linux

O executor padrão é **Meu computador**. O usuário instala/extraí o pacote completo e abre o comunicador; ele inicia o serviço automaticamente. No site, basta clicar em **Conectar ao meu computador** e aceitar a janela do comunicador. Não é necessário digitar endereço, copiar código, executar terminal ou configurar Python/Docker. A janela mostra a origem exata que solicitou acesso e oferece **Permitir**, **Recusar** e a opção **Lembrar este site**. A primeira aprovação é sempre explícita. O navegador também pode pedir permissão de acesso local, que não é contornada pelo aplicativo.

Ao lembrar o site, a origem é salva no computador e as próximas visitas reconectam automaticamente, com nova sessão privada para cada aba. A consulta automática nunca abre um popup para sites desconhecidos: nesses casos, o usuário inicia a solicitação pelo botão Conectar. Fechar a janela de autorização equivale a recusar; o site permite cancelar uma solicitação pendente. Solicitações expiram em dois minutos. A opção **Esquecer sites e revogar acessos** remove as permissões salvas, invalida as sessões e cancela seus trabalhos.

A abertura automática ao entrar no Windows/Linux é opcional, habilitada por uma caixa de seleção no aplicativo. Minimize a janela para manter os cálculos funcionando. Fechá-la cancela os trabalhos e encerra o serviço. Se o motor nativo não estiver incluído, o aplicativo indica que é necessário instalar o pacote completo, sem pedir comandos ao usuário. Não há download automático de executáveis desconhecidos.

A comunicação vai diretamente da aba para `http://127.0.0.1:8091`; o Next.js/Vercel não retransmite geometria, malhas, resultados ou arquivos `.inp` no modo local. Salvar projetos na nuvem continua sendo um recurso separado. O serviço de servidor permanece na porta 8090 e pode ser selecionado explicitamente. Nunca há fallback automático de local para servidor.

As sessões usam tokens aleatórios de 256 bits, válidos por até 12 horas e restritos à origem aprovada. Tokens ficam apenas na memória da aba, não em localStorage, IndexedDB nem no estudo. Apenas a lista de sites lembrados, o caminho local do CalculiX e a preferência de inicialização são persistidos em `settings.json`. Ao sair da página, o cliente tenta cancelar o trabalho e revogar a sessão com `keepalive`; em uma interrupção abrupta, as sessões remanescentes expiram ou podem ser revogadas no comunicador.

O serviço valida Host numérico e origem HTTPS (HTTP apenas em localhost para desenvolvimento). Antes da aprovação, somente os endpoints de solicitação de conexão estão disponíveis por CORS, sempre com a origem exata, sem cookies nem curinga. Cada solicitação recebe um segredo aleatório, é vinculada à origem e não pode ser consultada por outro site. Não existe endpoint HTTP para aprovar ou lembrar sites: isso ocorre somente na interface desktop. Há no máximo oito solicitações temporárias, uma pendente por origem, doze novas solicitações por minuto, oito sessões ativas e 32 sites lembrados pela interface. Preflights de rede privada não concedem autorização para calcular.

O comunicador escuta somente no loopback. Não instala certificado raiz nem desativa proteções do navegador. Referência: [permissão de acesso local do Chrome](https://developer.chrome.com/blog/local-network-access). O fluxo foi testado com página HTTPS em Chrome, incluindo aprovação na janela desktop e reconexão para site lembrado; outros navegadores e políticas empresariais podem exigir validação adicional.

Cada trabalho mantém o executor escolhido no envio, inclusive para cancelamento e exportação. Trocar de executor/conexão invalida os identificadores temporários na interface, preservando o estudo; gere uma nova malha para recalcular. Persistem os limites de malha, fila e 240 segundos por trabalho. No Windows, cancelamento encerra a árvore de processos com `taskkill`; o limite de memória via `resource` é exclusivo de Linux. Temporários são removidos no encerramento normal; um encerramento abrupto pode deixá-los no disco.

O pareamento antigo por código permanece somente como compatibilidade de protocolo para ferramentas técnicas/testes, fora da interface de uso normal.

### Desenvolvimento e distribuição

No ambiente Linux preparado, `npm run fea:local` abre a interface desktop. No Windows com ambiente Python configurado, execute o Python do ambiente virtual com `services/fea/communicator.py`. Esses comandos são para desenvolvimento; o pacote empacotado dispensa Python, terminal e Docker no computador do usuário.

Compile **no próprio sistema-alvo** com Python 3.11+, Tk, as dependências de `requirements.txt` e `pyinstaller>=6.11,<7`. Forneça o CalculiX nativo confiável e suas DLLs/bibliotecas, licenças e informações do código-fonte correspondente:

```sh
python services/fea/packaging/build.py --calculix CAMINHO_DO_CCX --notices PASTA_DAS_LICENCAS --native-dir PASTA_DAS_DLLS_OU_SO
```

O script gera pasta portátil e ZIP em `dist/communicator`, fora do Git, com Python, Tk, Gmsh, CalculiX e os módulos FEA. A compilação inclui a biblioteca Gmsh identificada no ambiente e suas dependências. No Windows, o executável deve ser compilado no Windows; para gerar o instalador por usuário, compile `services/fea/packaging/windows.iss` com Inno Setup após criar o pacote. A desinstalação remove o registro de inicialização automática. Assinatura de código, distribuição pública e validação em Windows são etapas de lançamento; não se deve apresentar um pacote não testado como instalador homologado. As obrigações de licença/fontes das bibliotecas nativas também se aplicam à distribuição desktop.

O modo `--headless --origin ORIGEM --pairing-file ARQUIVO` serve somente para integração e testes; o arquivo contém um segredo de pareamento e não deve ser publicado. O executável congelado utiliza `--worker` internamente para iniciar os cálculos sem abrir outra janela. Referência: [execução de aplicações PyInstaller](https://pyinstaller.org/en/stable/runtime-information.html).
