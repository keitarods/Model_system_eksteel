# Projetos no banco do cliente

## Fluxo atual: conexão simples no software

Em **Projetos na nuvem**, escolha o provedor, informe as credenciais e clique em **Conectar**. Pastas e peças aparecem após a conexão. Preparação de tabelas, autorização de rede, certificados e configuração do login são responsabilidades do administrador, fora desse diálogo.

- **Supabase Storage:** URL do projeto, chave pública anon/publishable, e-mail e senha de um usuário Auth desse projeto.
- **PostgreSQL, MySQL e SQL Server:** string de conexão para preencher os campos, ou host, porta, banco, usuário e senha.

Conectar não cria tabelas nem altera permissões. As ferramentas administrativas anteriores e suas APIs permanecem disponíveis no código para compatibilidade; não são exigidas pelo fluxo abaixo. `/configurar` continua sendo uma alternativa administrativa para o login da instalação.

## Seu teste com Supabase: preparação única no painel

1. Abra o projeto Supabase de destino e seu **SQL Editor**.
2. Execute `supabase/migrations/202609180001_cad_project_storage.sql`. Cria/configura o bucket privado `cad-projects` e suas políticas.
3. Execute `supabase/migrations/202609190002_cad_current.sql`. Cria a tabela `public.eksteel_cad_current`, com RLS por usuário, para a peça atual.
4. O script de Storage pode ser repetido: recria somente as seis políticas Eksteel na mesma transação e preserva os arquivos. Ele também reaplica a configuração privada e os limites do bucket. O script da tabela atual também pode ser repetido para a estrutura Eksteel: preserva linhas existentes e reaplica permissões e a política cad_current_owner. Não converte tabelas com estrutura diferente nem remove políticas personalizadas.
5. Em **Authentication → Users**, crie um usuário de teste com e-mail/senha, confirmado. O login por e-mail/senha deve estar habilitado. Essa conta é diferente da senha administrativa do PostgreSQL.
6. Obtenha a **Project URL** no diálogo **Connect** e a chave **Publishable** em **Settings → API Keys** (a chave antiga anon também funciona).
7. Confirme que a Data API está habilitada e que a tabela atual no esquema `public` está acessível pela API com as permissões da migração.

Não torne o bucket público. Não forneça service_role/secret ao software. As políticas de isolamento são aplicadas pelo Supabase, usando a conta autenticada do cliente.

### Conectar e testar

No Modelador, abra **Projetos na nuvem → Supabase Storage**, informe os quatro campos e clique em **Conectar**. Não é necessário informar host/porta PostgreSQL, senha administrativa, token de instalação ou certificado CA nesse fluxo.

1. Crie uma pasta `Teste`.
2. Com uma peça na área de trabalho, informe `PecaTeste` e clique em **Salvar como**.
3. No Supabase, confira o registro em **Table Editor → eksteel_cad_current**.
4. Clique em **Criar revisão**. Confira o arquivo em **Storage → cad-projects → ID do usuário → Teste → PecaTeste**.
5. Use **Abrir peça atual** para ler do banco, ou **Listar versões → Abrir** para ler do Storage.

A preparação no SQL Editor evita a conexão administrativa PostgreSQL pelo servidor do software. O erro TLS dessa conexão não se aplica ao fluxo normal do SDK Supabase, que usa HTTPS. Isso não elimina eventuais problemas de rede/certificado HTTPS do ambiente.

## Servidor do software: autenticação da instalação

Para uma instalação comercial, configure uma vez o login do software. Em desenvolvimento, crie `.env.local` na raiz; em hospedagem, use variáveis de ambiente:

```env
NEXT_PUBLIC_SUPABASE_URL=https://PROJETO_DE_LOGIN.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=CHAVE_PUBLICA_DO_PROJETO_DE_LOGIN
```

Reinicie o servidor local após mudar o ambiente; em produção, recompile/reimplante quando alterar variáveis públicas. Alternativamente, o operador pode usar `/configurar`: em produção essa configuração exige `CAD_SETUP_TOKEN` (mínimo 24 caracteres), além de um diretório persistente/gravável para `.cad-config` ou `CAD_CONFIG_DIR`.

O projeto do login pode ser diferente do Supabase de armazenamento de cada cliente. No seu teste, pode ser o mesmo. No modo local sem autenticação configurada, o conector **Supabase Storage** continua usando sua sessão própria; os conectores SQL no servidor exigem o login da instalação. Em produção, configure a autenticação antes de disponibilizar o software.

A sessão Supabase do armazenamento usa sessionStorage separado dos cookies do login da instalação. Atualizar a página ou navegar entre peça e montagem restaura a conexão na mesma aba, usando os tokens renováveis do Supabase; a senha nunca é salva. Sair do Storage encerra apenas essa conexão. Sair do software também encerra o Storage. Fechar a aba normalmente encerra seu armazenamento de sessão; navegadores podem restaurá-lo ao recuperar abas, portanto use Sair em computadores compartilhados. A opção Lembrar usuário guarda somente o e-mail no localStorage, independente de Lembrar URL e chave pública. Bancos SQL externos mantêm seu funcionamento anterior e não são restaurados após recarregar.

## Outros bancos: preparação no servidor/banco

Aplique os dois scripts correspondentes, uma vez e nesta ordem, com uma conta administrativa no banco do cliente:

| Banco | Estrutura inicial | Peça atual |
|---|---|---|
| PostgreSQL | `database/postgres.sql` | `database/postgres-current.sql` |
| MySQL 8+ | `database/mysql.sql` | `database/mysql-current.sql` |
| SQL Server | `database/mssql.sql` | `database/mssql-current.sql` |

Use na aplicação um login dedicado com:

- SELECT e INSERT em `eksteel_cad_folders` e `eksteel_cad_versions`;
- SELECT, INSERT e UPDATE em `eksteel_cad_current`;
- acesso ao banco e ao esquema usado pelas tabelas.

Não é necessário conceder CREATE TABLE ao login diário. Não execute scripts SQL Server no Supabase: Supabase utiliza PostgreSQL e precisa das migrações específicas de RLS/Storage.

No servidor do software, autorize os destinos exatos:

```env
CAD_DATABASE_ALLOWED_HOSTS=db.cliente.com:5432,mysql.cliente.com:3306,sql.cliente.com:1433
```

Libere a saída TCP do servidor e a entrada no banco para esses destinos. As conexões exigem TLS com certificado válido. Se a CA for privada, configure `CAD_DATABASE_CA_PEM` com o conteúdo PEM real (incluindo quebras de linha) fornecido pelo administrador/provedor. Autorizações e CAs por destino cadastradas anteriormente pela interface continuam funcionando; a CA por destino tem precedência sobre a variável global. Não há opção de desabilitar a verificação de certificado.

O token da preparação administrativa e a CA PostgreSQL **não são necessários para o conector Supabase Storage** quando suas migrações foram aplicadas pelo painel.

### Strings aceitas

Use `postgresql://usuario:senha@host:5432/banco` (ou `postgres://`), `mysql://usuario:senha@host:3306/banco`, `mssql://usuario:senha@host:1433/banco` (ou `sqlserver://`). Strings SQL Server `Server=...;Database=...` não são interpretadas. Aplique a string e revise os campos antes de conectar.

Senhas com caracteres especiais na URI precisam de percent-encoding; alternativamente, preencha a senha no campo individual. `[YOUR-PASSWORD]` é substituído por campo vazio para preenchimento manual. A string fica mascarada e é limpa após aplicação. Opções extras são recusadas, exceto `sslmode=require`, `verify-ca` ou `verify-full` para PostgreSQL; todos continuam sujeitos à validação TLS do servidor.

## Salvamento e compatibilidade

- **Salvar como:** cria outro registro atual, com nome novo.
- **Salvar:** atualiza a peça aberta, sem criar revisão. Tokens são comparados na mesma operação de gravação para recusar alterações concorrentes desatualizadas.
- **Criar revisão:** guarda uma cópia independente do conteúdo da área de trabalho; não atualiza a peça atual.
- Revisões antigas continuam acessíveis. Abra uma delas e salve para criar/restaurar a peça atual, preservando a revisão original.
- **Salvar/Ctrl+S fora do diálogo continua local.** Não há sincronização remota automática.

São preservados o formato `.eks3d`, esboços, operações, folhas de desenho e propriedades. Abrir substitui o documento após confirmação, limpa seu histórico undo/redo anterior e desvincula o arquivo local anterior. A biblioteca de arquivos Supabase permite montagens portáteis com peças incorporadas; consulte `docs/CAD_GESTAO_DOCUMENTS.md`.

No Supabase, a peça atual é texto no banco (até 50 MiB); revisões são arquivos no Storage. Em SQL direto, peças e revisões são texto em tabelas, até 10 MiB. Limites do proxy/hospedagem e `max_allowed_packet` do MySQL podem ser menores. Listas são paginadas em lotes de 100, mas a interface acumula todas as páginas. Revisões usam data do dispositivo, não uma sequência transacional.

## Segurança, operação e validação

Conexões SQL executam no servidor com parâmetros vinculados; senhas não são retornadas nas respostas nem persistidas em disco. As sessões duram até uma hora, cinco por usuário e cem por processo. Reiniciar invalida essas sessões. Múltiplas réplicas precisam de afinidade; ainda não há cofre compartilhado nem limite distribuído de requisições.

O Supabase aplica RLS por usuário. SQL direto aplica o filtro de usuário na API, não RLS: o dono das credenciais SQL pode acessar os dados permitidos àquela conta. Para isolamento físico entre clientes, use bancos/logins separados. Administradores do banco continuam capazes de alterar dados; revisão imutável pela aplicação não substitui backup.

**Conexão OK** confirma autenticação e leitura naquele momento. Criar pasta, salvar e abrir confirmam as permissões de escrita/leitura do fluxo completo. Testes locais usam adaptadores simulados; homologue com bancos reais, duas contas e duas sessões concorrentes. Nenhum banco externo foi alterado automaticamente durante esta simplificação.

Ainda faltam compartilhamento por organização, quotas, retenção/exclusão, auditoria e backups externos. A auditoria anterior reportou vulnerabilidades nas dependências, incluindo Next.js 16.2.6; atualize e valide antes da publicação comercial.

Referências: [chaves Supabase](https://supabase.com/docs/guides/getting-started/api-keys), [Storage e RLS](https://supabase.com/docs/guides/storage/security/access-control), [certificados PostgreSQL no Supabase](https://supabase.com/docs/guides/platform/ssl-enforcement).

### Nomes com acentos

Pastas e peças aceitam nomes como `Peças Eksteel` e `Eixo de aço`. Para evitar `Invalid key` no Storage, os segmentos com caracteres não ASCII são codificados reversivelmente em UTF-8 hexadecimal com prefixo `_u_`. A interface exibe o nome original; no painel Storage o caminho aparece codificado. Os caminhos ASCII existentes não mudam, e os nomes na tabela da peça atual continuam legíveis. Não é necessário reaplicar migrações para essa correção.

## Arquivos nativos, PDF/DXF e Gestão

A biblioteca **Arquivos da pasta** permite enviar a peça aberta diretamente ao Storage, salvar montagens com peças incorporadas e enviar PDFs/DXFs para consulta pelo Gestão. Requer a migração `202609200003_cad_documents.sql`. Consulte [instruções de uso, permissões e contrato de integração](CAD_GESTAO_DOCUMENTS.md).

## Lembrar a chave pública

No mesmo diálogo **Projetos na nuvem**, marque **Lembrar URL e chave pública neste navegador**. Elas são salvas ao conectar com sucesso ou ao clicar em **Salvar preferência** e preenchidas automaticamente nos próximos acessos. O formulário continua editável e não conecta automaticamente.

**Esquecer dados salvos**, ou desmarcar a opção, remove a preferência. Desconectar encerra a sessão, mas preserva a preferência marcada. Somente URL e chave pública são armazenadas no localStorage deste navegador/site; senha, e-mail e tokens de sessão não são incluídos. A preferência é compartilhada por quem usa esse mesmo perfil de navegador, não sincronizada entre dispositivos. Se o navegador bloquear o armazenamento, a conexão manual continua disponível e o formulário informa a falha ao salvar.

## Desenhos editáveis e geração de PDF/DXF

Aplique também `supabase/migrations/202609200004_cad_drawings.sql` no SQL Editor do Supabase de armazenamento, após a migração de documentos. Ela permite o tipo `drawing` no catálogo, preservando arquivos e políticas existentes.

No ambiente **Desenho**:

1. **Salvar desenho** baixa um `.eksdesenho` com todas as folhas, vistas calculadas, cotas, anotações, carimbos e listas de peças. **Abrir desenho** restaura as folhas, após confirmar sua substituição. O modelo de folha `.eksfolha` continua sendo apenas um modelo reutilizável.
2. Abra **Projetos na nuvem**, conecte ao Supabase e selecione ou crie a pasta de destino (por exemplo, `Desenhos`, `PDF` ou `DXF`). Informe o nome de origem para identificar a peça ou montagem.
3. **Salvar desenho nesta pasta** envia o arquivo editável completo. Use **Atualizar arquivos** e **Abrir no software** para recuperar um desenho salvo.
4. **Gerar e enviar PDF** e **Gerar e enviar DXF** geram a folha ativa e enviam diretamente à pasta selecionada, sem exigir download e upload manual. Para outro destino, troque a pasta antes de enviar. O sucesso é informado após o envio e registro no catálogo.

O PDF é vetorial. O DXF representa a folha em milímetros de papel, com texto e contornos; curvas são aproximadas por segmentos de até 0,2 mm de percurso. Não inclui imagens/logotipos, preenchimentos ou todos os detalhes de tipografia do SVG. Não use o DXF de folha como perfil de corte 1:1: para fabricação, use o exportador de perfil da peça. Caminhos SVG compostos relativos não suportados geram erro explícito.

O `.eksdesenho` preserva vistas calculadas, mas não inclui o sólido/árvore da peça ou montagem. Abra o projeto original para recalcular vistas. Os projetos `.eks3d`/`.eks3dasm` continuam armazenando suas folhas normalmente. Os envios da biblioteca são cópias independentes; leitores do Gestão continuam acessando somente PDF/DXF autorizados, não o desenho editável.

### Login sem chave administrativa

O login valida e-mail e senha diretamente pelo Supabase Auth usando a URL e a chave pública configuradas para a instalação. Não exige `SUPABASE_SERVICE_ROLE_KEY` e não lista usuários antes de autenticar. A conta deve existir no projeto Supabase usado pelo login. Credenciais inválidas recebem uma mensagem conjunta de e-mail/senha; erros de rede não contam como senha incorreta. A rota antiga de consulta de e-mail permanece compatível, retornando `exists: null`, sem revelar contas.
