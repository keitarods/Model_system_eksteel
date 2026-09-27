# Simulação estrutural

Acesse **Simulação** no cabeçalho do Modelador ou `/simulacao`. O documento de estudo é independente da peça: o comando **Usar peça do Modelador** copia a geometria atual. Alterações posteriores no Modelador não atualizam silenciosamente uma análise existente.

## O que está implementado

- Peça sólida STEP ou montagem aberta/importada (`.eks3dasm`), com conversão para milímetros.
- Análise estática linear, material homogêneo e isotrópico, pequenas deformações.
- Geração volumétrica por Gmsh, tetraedros lineares C3D4, refinamento local por face e índice de qualidade minSICN.
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
4. Em Malha, defina o tamanho em mm e gere. Clique nas faces do modelo para selecionar; clicar de novo desmarca.
5. Para refinar, selecione faces, informe tamanho local e aplique. **Gere novamente** para atualizar a malha.
6. Em Fixações, marque os deslocamentos nulos e adicione o apoio.
7. Em Cargas, escolha força, pressão ou gravidade e adicione. A força informada é o **total conjunto** das faces selecionadas, não o valor por face. Pressão positiva comprime a superfície; gravidade usa m/s².
8. Resolva e consulte os resultados. Ampliação 0 exibe a geometria original; 1 mostra o deslocamento real.
9. Salve o estudo `.eksfea`. Para recalcular um arquivo reaberto ou um rascunho restaurado, gere novamente a malha, porque os identificadores temporários do serviço não são reaproveitados.

## Montagens

A importação copia todos os componentes não suprimidos, inclusive os ocultos, suas posições resolvidas, rotações e operações de montagem/soldagem. Se a Montagem não estiver carregada em memória, o comando procura seu rascunho local. Peças vinculadas precisam estar acessíveis; arquivos com peças incorporadas dispensam os vínculos. Restrições conflitantes ou componentes indisponíveis interrompem a importação inteira. O estudo é uma cópia independente.

Nesta versão há **um material comum**. Componentes encostados ou sobrepostos são fundidos geometricamente antes da malha, com união contínua e transferência de esforços, sem deslizamento ou separação. Folgas não são preenchidas; corpos separados precisam de apoios próprios. Ligações apenas por aresta ou ponto são rejeitadas. Restrições e componentes aterrados na Montagem posicionam a geometria, mas **não viram fixações FEA**. Defina os apoios e cargas na Simulação.

## Validação e limites

Os testes do motor usam Gmsh e CalculiX reais. A barra de 100 × 10 × 10 mm, E = 210000 MPa, Poisson = 0, sob 1000 N axiais é comparada com `u = FL/(EA)` e tensão de 10 MPa, além do equilíbrio de reações. Também se verifica a conservação de forças/pressões/gravidade, rejeição de apoios insuficientes, múltiplos sólidos no modo peça e refinamento local. Para montagens, uma barra formada por dois componentes unidos é comparada à solução analítica; corpos separados são testados com e sem apoios individuais.

Na viga engastada de mesma seção com Poisson 0,3 e carga transversal de 10 N, o teste de convergência comparou tamanho global 5 mm (0,012915 mm) e 2,5 mm (0,016650 mm) com Euler–Bernoulli (0,019048 mm). Isso demonstra a melhora por refinamento e também o erro restante: não representa uma certificação geral de precisão.

C3D4 é um elemento de deformação constante e pode ser muito rígido em flexão. Chapas finas e estados quase incompressíveis não são o alvo desta versão. Poisson é limitado a 0,49. Não há cascas, vigas, contatos com atrito/separação entre componentes, plasticidade, análise modal, flambagem ou fadiga. Refine e compare malhas; máximos de tensão em cantos singulares não necessariamente convergem.

O solver calcula deslocamentos. O pós-processamento recupera deformações `B·u`, tensões `D·B·u` e reações pelo equilíbrio nodal. A checagem de resíduos livres considera o limite de arredondamento dos sete algarismos significativos impressos pelo CalculiX no `.dat`. A soma de cargas e reações também é verificada. No JSON, tensões e deformações seguem a ordem xx, yy, zz, xy, yz, zx; as três componentes de deformação por cisalhamento são de engenharia (γ). Tensões são exibidas sem suavização; a razão escoamento/von Mises é apenas um indicador de escoamento elástico.

Limites atuais: 128 componentes por montagem, 12 MB de STEP, 30 mil nós, 100 mil elementos, 240 segundos por trabalho. Os resultados no serviço são temporários, com expiração após 24 h e perda de referências em reinício; salve o `.eksfea` para persistência. O serviço deve usar um único worker HTTP, pois a fila e a autorização dos trabalhos ficam em memória.

## Testes

```sh
npm test
npm run typecheck
# Com ccx no PATH, ou CCX_BIN e suas bibliotecas configurados:
services/fea/.venv/bin/python -m unittest discover -s services/fea -p 'test_engine.py' -v
# Para testes HTTP, instale httpx no ambiente de testes:
services/fea/.venv/bin/pip install 'httpx>=0.27,<1'
services/fea/.venv/bin/python -m unittest discover -s services/fea -p 'test_service.py' -v
```

## Referências e distribuição

- [Manual Gmsh](https://gmsh.info/doc/texinfo/): importação OpenCASCADE, campos de tamanho, malha e qualidade.
- [CalculiX](https://www.calculix.de/) e [manual do solver](https://www.dhondt.de/ccx_2.22.pdf): C3D4, elasticidade, condições e saída nodal.

Gmsh e CalculiX têm licenças próprias (GPL e opções específicas do Gmsh). Os executáveis não foram incorporados ao código JavaScript nem versionados neste repositório. A distribuição de imagens/binários deve preservar as obrigações de licença correspondentes; executar um serviço separado não elimina essas obrigações.
