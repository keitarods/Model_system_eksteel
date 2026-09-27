# Materiais e aparências

No Modelador, abra **Propriedades da peça** e use **Biblioteca de materiais e aparências**. É possível pesquisar, aplicar, editar, importar e exportar materiais. A definição aplicada fica dentro do `.eks3d`, com origem, propriedades e aparência; a peça não depende da biblioteca local para reabrir. Na montagem, cada peça usa sua aparência, mantendo o destaque de seleção; veja **Materiais na montagem**. A biblioteca de seleção fica no armazenamento local deste navegador: exporte seu JSON para transferi-la ou fazer backup.

## Biblioteca padrão do Inventor

A Autodesk informa o caminho padrão:

```text
C:\Users\Public\Documents\Autodesk\Inventor <versão>\Design Data\Materials\InventorMaterialLibrary.adsklib
```

A biblioteca compartilhada `PhysicalMaterial.adsklib` fica normalmente em `C:\Program Files (x86)\Common Files\Autodesk Shared\Materials\20XX`. Projetos empresariais podem apontar para outros caminhos. Consulte as bibliotecas carregadas no projeto do Inventor.

## Biblioteca padrão do Eksteel

A **Inventor Material Library** (`InventorMaterialLibrary.adsklib`, 74 materiais com ativo físico) é a biblioteca padrão. Os dados ficam na tabela `public.eksteel_materials` do **Supabase de login**, não no repositório: são conteúdo da Autodesk e o repositório é público.

- **Propriedades da peça e Montagem**: os materiais do banco aparecem sem importação, em ordem alfabética. Alterações e materiais próprios ficam no armazenamento local; só o que difere da biblioteca padrão é salvo, de modo que atualizações do banco chegam aos usuários.
- **Simulação**: as predefinições são os materiais isotrópicos com E, Poisson, escoamento e densidade. O estudo novo começa com o "Steel" do Inventor (Aço: E 210 GPa, ν 0,3, Sy 207 MPa, 7850 kg/m³), valores fixos no código que funcionam mesmo sem o banco.
- A biblioteca é lida uma vez por sessão, somente por usuários autenticados (RLS). Sem login ou sem autenticação configurada, a lista mostra apenas os materiais locais e o aviso correspondente; importar `.adsklib`/JSON continua disponível.

### Carregar ou atualizar a biblioteca no banco

1. Gere o SQL a partir do arquivo ou da pasta descompactada:

   ```bash
   node --require ./scripts/register-tests.cjs scripts/build-inventor-materials.cjs caminho/InventorMaterialLibrary.adsklib
   ```

   O resultado é `supabase/migrations/202609270005_eksteel_materials.sql`. Como todo `*.sql` do projeto, é **privado e ignorado pelo Git** (ver `RELEASE_PRIVACY.md`); guarde-o fora do repositório.
2. Execute o arquivo no SQL Editor do Supabase de login. Ele cria a tabela (se preciso), aplica as permissões (somente leitura para `authenticated`, nada para `anon`), atualiza os materiais e remove os que saíram da biblioteca. Pode ser repetido.

Os nomes e categorias estão em português (`scripts/inventor-material-names-pt.cjs`, por identificador do Inventor). O nome original em inglês fica na origem do material, e a pesquisa encontra os dois. Variantes com a mesma descrição são distinguidas pelas palavras-chave da própria biblioteca (ex.: POM preto/branco). `Madeira de lei (760 kg/m³)` não tem espécie identificada no arquivo.

## Importar outro .adsklib

Em **Importar biblioteca (.adsklib ou JSON)**, selecione o arquivo `.adsklib` (pacote ZIP). O navegador lê o arquivo localmente, sem Inventor, Windows ou envio a servidor. Se o arquivo tiver sido descompactado, compacte o conteúdo da pasta (arquivos `[Content_Types].xml`, `core.xml` e a pasta com GUID na raiz do ZIP) e renomeie para `.adsklib`.

O leitor (`src/lib/materials/adsklib.ts`) interpreta `AssetData/InstanceProperties.bin` e `DefinitionIteratorProperties.bin` usando os tipos e unidades de `Schemas/*.xml`. O formato binário não é documentado pela Autodesk; o leitor foi validado com `InventorMaterialLibrary.adsklib` (AssetLibVersion 1.0, InstanceProperties 3.2): 74 materiais com ativo físico, todos os registros estruturais e térmicos lidos até o fim. Bibliotecas de outras versões devem ser conferidas por amostragem.

- Valores vêm do ativo físico (estrutural) do material, como no painel do Inventor. Condutividade, calor específico e densidade são completados pelo ativo térmico quando ausentes.
- Conversões: kPa → MPa, µm/(m·°C) → 1/K, J/(g·°C) → J/(kg·K). Cada valor traz o código de unidade gravado; se não for a unidade esperada do schema, o campo fica vazio.
- Comportamento: isotrópico/ortotrópico conforme o ativo. Para ortotrópicos (madeiras), apenas os valores principais são importados, e a Simulação continua bloqueada.
- Nomes: os nomes exibidos no Inventor (ex.: "Aluminum 6061") vêm de arquivos de localização da instalação, não do `.adsklib`. O Eksteel usa a descrição do material ou do ativo estrutural; nomes repetidos recebem o identificador (ex.: `(MaterialInv_031)`). Renomeie após aplicar, se desejar.
- Aparência: cor, brilho e transparência são lidos das aparências genéricas sem textura conectada. Aparências Metal, Plástico/Vinil, Madeira e com texturas usam uma aproximação por categoria/nome.

## Alternativa: exportar pela API do Inventor

1. Abra o Inventor no Windows e um documento qualquer; carregue no projeto as bibliotecas desejadas.
2. No painel de materiais do Eksteel, baixe **exportador para Inventor**. O arquivo também está em `public/materials/export-inventor-materials.ps1`.
3. Em **Windows PowerShell 5.1**, execute o script, ajustando o caminho:

```powershell
& "$env:USERPROFILE\Downloads\export-inventor-materials.ps1" -OutputPath "$env:USERPROFILE\Desktop\inventor-materials.json"
```

4. No Eksteel, use **Importar biblioteca JSON** e selecione `inventor-materials.json`.
5. Pesquise e selecione o material para aplicá-lo. Confira os campos ausentes e confirme o comportamento mecânico conforme o material real.

O script consulta as bibliotecas carregadas pela API COM do Inventor, sem modificar documentos ou bibliotecas. Usa `FloatAssetValue.Units` e `UnitsOfMeasure.ConvertUnits`, sem presumir unidades internas. Falhas de conversão geram um campo vazio e observação. Um arquivo adicional `.raw.json` registra os valores originais disponíveis e os materiais que falharam; ele é um registro de diagnóstico, não a biblioteca a importar.

O exportador requer validação na instalação Windows do usuário. Neste ambiente Linux não há Inventor/COM disponível para executar a exportação real. O formato JSON e sua integração com peças foram testados localmente com dados sintéticos; isso não valida os valores de uma biblioteca Autodesk ainda não fornecida.

## Materiais na montagem

Como no Inventor, há duas coisas diferentes, ambas em **Material** (faixa *Montar* ou botão na árvore de componentes):

- **Material da peça**: é gravado no arquivo `.eks3d` da peça (ou na cópia incorporada) e vale para todas as ocorrências dela na montagem; massa e Lista de Peças passam a usá-lo. É preciso permissão de escrita no arquivo vinculado. A geometria e as folhas de desenho da peça são preservadas. Não entra no desfazer da montagem.
- **Aparência nesta montagem**: substituição só daquela ocorrência, salva no arquivo da montagem, sem alterar a peça. **Limpar substituição de aparência** volta à aparência do material.

A árvore mostra o material de cada peça e a substituição de aparência, quando houver. Se a peça estiver aberta no Modelador com alterações não salvas, salvar lá sobrescreve o material gravado pela montagem.

## Propriedades

| Grupo | Campo | Unidade no Eksteel |
|---|---|---|
| Física | Densidade | kg/m³ |
| Mecânica | Young e cisalhamento | MPa |
| Mecânica | Poisson | adimensional |
| Mecânica | Escoamento e resistência à tração | MPa |
| Térmica | Condutividade | W/(m·K) |
| Térmica | Expansão linear | 1/K |
| Térmica | Calor específico | J/(kg·K) |

Os valores representam a condição do material exportado; não são curvas dependentes de temperatura. A massa usa a densidade aplicada à peça. **Usar peça do Modelador**, na Simulação, copia densidade, Young, Poisson e escoamento quando a peça tem material completo e isotrópico. Uma definição incompleta ou ortotrópica impede essa importação até ser corrigida, para evitar substituição silenciosa por aço. Peças antigas sem definição completa ainda usam a escolha manual de material no estudo. O solver atual continua estático estrutural; armazenar propriedades térmicas não implementa análise térmica. Montagens continuam usando um material comum no estudo.

## Aparências

O renderizador utiliza cor, metalização, rugosidade, opacidade e um ambiente local de reflexos. O exportador tenta ler cores de aparências genéricas/metálicas e converte os parâmetros genéricos de brilho e transparência quando disponíveis. Essa conversão é aproximada. Materiais com shaders próprios, múltiplas cores, texturas, relevo, anisotropia ou refração do Inventor não têm reprodução idêntica. Os arquivos de textura não são incorporados pelo exportador. Os controles permitem ajustar a aparência convertida.

## Fontes oficiais

- [Localização de InventorMaterialLibrary.adsklib](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Unable-to-locate-the-material-library-file-in-Inventor.html)
- [Bibliotecas físicas e de aparência](https://help.autodesk.com/cloudhelp/2025/ENU/Inventor-Help/files/GUID-5953AE40-331A-43DC-9E9D-DE8775B4ED93.htm)
- [Propriedades e unidades](https://help.autodesk.com/cloudhelp/2026/ENU/Inventor-Help/files/GUID-C3F48618-5989-4CEB-9099-1ACAC6B07391.htm)
- [MaterialAsset e seus conjuntos associados](https://help.autodesk.com/cloudhelp/2022/ENU/Inventor-API/files/MaterialAsset.htm)
- [FloatAssetValue e unidades de retorno](https://help.autodesk.com/cloudhelp/2022/ENU/Inventor-API/files/FloatAssetValue.htm)
- [Exemplo oficial de enumeração das bibliotecas](https://help.autodesk.com/cloudhelp/2022/ENU/Inventor-API/files/DumpAllMaterials_Sample.htm)
