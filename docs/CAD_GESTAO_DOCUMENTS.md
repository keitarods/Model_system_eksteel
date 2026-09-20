# Biblioteca de arquivos e integração com Gestão Eksteel

## Habilitar no Supabase do cliente

Após as duas migrações CAD anteriores, aplique uma vez (pode ser repetida) `supabase/migrations/202609200003_cad_documents.sql`. Ela cria:

- bucket privado **cad-documents**, até 50 MiB por arquivo;
- catálogo **public.eksteel_cad_documents**;
- autorizações de leitura **public.eksteel_cad_document_readers**.

A migração não torna públicos os arquivos nem libera acesso a todos os usuários. O catálogo e o download são protegidos por RLS. Aplique no Supabase de armazenamento, não necessariamente no Supabase do login do software.

## Usar no CAD

Em **Projetos na nuvem**, conecte o Supabase, escolha/crie a pasta e informe o nome da peça ou montagem como origem. No bloco **Arquivos da pasta**:

- **Salvar arquivo da peça nesta pasta** envia diretamente a peça aberta como `.eks3d`, sem download intermediário. Esboços, features, propriedades e folhas estão no mesmo arquivo.
- No ambiente Montagem, **Salvar montagem nesta pasta** envia `.eks3dasm` com cópias das peças incorporadas. Dependências ausentes bloqueiam o envio, inclusive peças suprimidas. As cópias preservam todo o JSON da peça, incluindo folhas e propriedades.
- **Enviar arquivo** aceita `.eks3d`, `.eks3dasm` portátil, PDF e DXF ASCII. Para montagens antigas que só têm vínculos locais, abra-as no ambiente Montagem e use o botão próprio para incluir as peças.
- PDFs e DXFs gerados pelos comandos de exportação aparecem na lista de exportações recentes da aba (até cinco). Clique em **Enviar para esta pasta**. Revise a origem selecionada: a vinculação é explícita, não inferida do desenho. A fila é somente em memória; arquivos baixados também podem ser selecionados manualmente.
- **Atualizar arquivos**, **Baixar** e **Abrir no software** permitem recuperar em outro computador após autenticar no mesmo Supabase. Arquivos de peça abrem no Modelador e montagens no ambiente Montagem.
- A observação permite registrar finalidade de compra/referência; ela não calcula quantidade, material ou fornecedor automaticamente.

A biblioteca guarda cópias imutáveis com identificador próprio, sem sobrescrever envios anteriores. É diferente do botão **Salvar** da peça atual, que mantém um registro editável no banco. Pastas são lógicas; no Storage o caminho é `owner_id/pasta_codificada/document_id/nome_codificado`. Nomes com acentos aparecem codificados no painel Storage, mas legíveis no software.

Montagens portáteis são snapshots. O posicionamento e as restrições continuam editáveis. Para editar uma peça em contexto com vínculo ao vivo, primeiro religue um arquivo local; o snapshot incorporado é então removido da ocorrência religada. Arquivos antigos sem snapshots continuam sendo aceitos. Versões antigas do software podem ignorar o campo novo e pedir vínculos locais. Peças repetidas são incorporadas por ocorrência, aumentando tamanho; o envio falha acima de 50 MiB.

## Contrato de integração do Gestão

O código/tela de compras do Gestão ainda precisa consumir esse contrato. Nenhuma alteração foi feita em outro repositório. Um usuário do Gestão deve autenticar **no Supabase de armazenamento**. Estar autenticado em outro projeto Supabase não concede acesso a estes arquivos.

Se for o mesmo usuário que publicou os arquivos, já possui acesso aos próprios documentos. Para liberar PDFs/DXFs de uma pasta para outro usuário, o administrador executa no SQL Editor, substituindo os UUIDs e a pasta:

```sql
insert into public.eksteel_cad_document_readers (owner_id, reader_id, folder_name)
values ('UUID_DO_AUTOR', 'UUID_DO_USUARIO_COMPRAS', 'Peças Eksteel')
on conflict do nothing;
```

Esses usuários devem existir em `auth.users` do mesmo Supabase. Somente administrador pode conceder essa autorização; usuários comuns não podem se promover a leitores. A permissão é de leitura de PDFs/DXFs dessa pasta, incluindo novos envios, e não dá acesso aos arquivos nativos de outro usuário.

Exemplo usando um cliente Supabase com sessão desse usuário (chave pública, sem service_role):

```ts
// Pagine conforme a tela de compras; use owner_id para evitar misturar autores.
const { data: documents, error } = await supabase
  .from('eksteel_cad_documents')
  .select('id,owner_id,folder_name,source_name,filename,kind,object_path,byte_size,created_at,purpose')
  .eq('owner_id', ownerId)
  .eq('folder_name', folderName)
  .in('kind', ['pdf', 'dxf'])
  .order('created_at', { ascending: false })
  .order('id')
  .range(0, 49);
if (error) throw error;

// Ao selecionar um documento no pedido:
const { data: file, error: downloadError } = await supabase.storage
  .from('cad-documents')
  .download(selectedDocument.object_path);
if (downloadError) throw downloadError;
// file é Blob; a UI pode oferecer download/visualização conforme seu padrão.
```

Guarde o **document_id** no item/pedido de compra para preservar a referência exata, em vez de selecionar sempre o arquivo mais recente pelo nome. `source_name` vincula ao nome informado da peça/montagem, mas ainda não é um código mestre de produto. Não há extração automática de BOM, cotas, quantidades ou material a partir de PDF/DXF.

## Limitações operacionais e validação

Upload e inserção do catálogo são duas operações, sem transação distribuída. Se upload funcionar e catálogo falhar, a UI avisa que o arquivo não foi publicado; pode restar um objeto órfão a ser revisado pelo administrador. Não há exclusão pelo cliente nem limpeza automática implementada. A validação no aplicativo verifica formato básico/extensão/tamanho, não substitui análise antimalware ou validação completa de um arquivo externo.

Antes da liberação, homologue com três usuários reais: autor, leitor autorizado e usuário sem permissão. O leitor deve listar/baixar PDF/DXF autorizados, sem ler nativos alheios, alterar dados ou conceder acesso. O usuário sem permissão não deve listar/baixar esses documentos. Remover a linha de autorização deve revogar novas consultas/downloads; arquivos já baixados não podem ser recolhidos. Os testes locais de serviço usam adaptadores simulados, não uma instância real de RLS.

Esta biblioteca está implementada no conector Supabase Storage. Conectores SQL mantêm o fluxo anterior de peças atuais/revisões; não possuem armazenamento binário de PDF/DXF implementado.
