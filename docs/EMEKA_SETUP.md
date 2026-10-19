# emeka_system — instalação

A entrada do aplicativo agora é `/ferramentas`, um portal com acesso ao Modelador, Montagem e Simulação. A rota antiga `/auditorias` redireciona para o portal; a interface de auditorias foi removida, preservando os dados existentes. O login conserva a estrutura visual da Eksteel, também usada no orçamento OMKF. Os módulos CAD existentes continuam no repositório.

## Novo projeto Supabase

1. Crie um projeto exclusivo da emeka_system. Não execute a preparação no projeto Eksteel/OMKF.
2. Configure em `.env.local`:

   ```dotenv
   EMEKA_SUPABASE_URL=https://NOVO-PROJETO.supabase.co
   EMEKA_SUPABASE_ANON_KEY=CHAVE_PUBLICA_DO_NOVO_PROJETO
   EMEKA_DATABASE_URL=postgresql://USUARIO:SENHA@HOST:5432/postgres
   ```

   A chave deve ser anon/publishable, nunca service_role. `EMEKA_DATABASE_URL` é privada, usada somente na preparação. Codifique caracteres especiais da senha na URL. As variáveis antigas do CAD não configuram a autenticação da emeka_system.
3. Execute uma vez:

   ```sh
   node --env-file=.env.local scripts/setup-emeka.cjs
   ```

   Alternativamente, execute `database/emeka/001_audits.sql` no SQL Editor do novo projeto. A transação cria auditorias, peças atuais, catálogo de documentos, tabela de materiais e buckets privados de projetos/documentos, com suas políticas. Os nomes técnicos `eksteel_*` e formatos de arquivo são preservados para compatibilidade; todos os dados ficam no novo projeto. Se a tabela já existir, o comando falha sem substituir registros. Nenhum dado ou usuário antigo é migrado automaticamente.
4. Em Authentication, habilite e-mail/senha e desabilite cadastro público. Crie os usuários autorizados pelo painel e envie convite/recuperação de senha. Não há cadastro público na aplicação.
5. Configure Site URL com o domínio do aplicativo e autorize `/auth/callback` e `/auth/callback?next=/reset-password` nas Redirect URLs, incluindo `http://localhost:3000` para desenvolvimento. Configure SMTP para envio de e-mails.
6. Para convites e recuperação entre navegadores, configure os templates de e-mail com os destinos abaixo (preservando os tokens do Supabase):

   ```text
   Recuperação: {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery
   Convite: {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite
   ```
7. Execute `npm run dev`. Entre com uma conta criada no novo projeto.

Também é possível configurar URL/chave pública pela tela `/configurar`. Em produção ela exige `CAD_SETUP_TOKEN` (controle administrativo existente). Essa opção salva em `.emeka-config/auth.json`, ou em `EMEKA_CONFIG_DIR`, e requer volume persistente. Variáveis de ambiente têm precedência. A conexão administrativa não é pedida nem salva pela interface.

## Marca

Coloque o logo em `public/images/emeka_logo.png`. Enquanto o arquivo não existir, as telas exibem `emeka_system` em texto.

## Escopo implementado

Login, logout, recuperação/redefinição de senha, retorno de convite e portal de ferramentas profissionais. As tabelas existentes mantêm suas políticas RLS. O portal não consulta nem altera as auditorias. Compartilhamento entre auditores, perfis administrativos, checklist, anexos e relatórios dependem de definição de escopo e ainda não estão implementados. O bloqueio visual por tentativas não substitui os limites de autenticação do Supabase.

## Validação no projeto novo

Use duas contas: crie uma auditoria com a primeira e confirme que a segunda não consegue consultar ou alterar seu registro. Valide convite, login, logout, recuperação de senha, link expirado e acesso direto a `/ferramentas` sem sessão. Esses testes remotos exigem um projeto configurado e e-mail funcional.

Referências: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) e [recuperação de senha](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).

## Módulos existentes

Modelador, desenhos, montagem e simulação seguem acessíveis pelo painel. Em Projetos na nuvem, conecte o novo Supabase com sua URL, chave pública e uma conta do novo projeto. As conexões lembradas da empresa antiga não são restauradas. A biblioteca de materiais inicia vazia: importe os materiais autorizados conforme `docs/MATERIALS.md`. O serviço externo de simulação continua exigindo a configuração de `docs/SIMULATION.md`; trocar o banco não instala esse serviço.

## Certificado TLS e validação

Baixe o certificado CA do novo projeto no painel Supabase e configure `EMEKA_DATABASE_CA_FILE=./prod-ca-2021.crt` no `.env.local`. O script usa esse certificado com validação TLS obrigatória. Em hospedagem, disponibilize o arquivo no servidor e ajuste o caminho. Não coloque a conexão administrativa em variáveis públicas.

Para validar credenciais e consultar a presença das tabelas sem alterar o banco:

```sh
node --env-file=.env.local scripts/setup-emeka.cjs --check
```

## Direção comercial — Emeka Engenharia

Recomendação: oferecer uma aplicação central administrada pela Emeka Engenharia, com empresas clientes e isolamento por empresa no banco e no Storage. Isso evita manter uma cópia de código por cliente. Uma instalação/banco dedicado pode ser uma modalidade separada para contratos que exijam isolamento físico; tem custo operacional maior.

A implementação atual é uma base de uso interno/piloto: os dados privados são isolados por usuário, e a biblioteca de materiais é compartilhada entre contas autenticadas do projeto. Não existe ainda autorização por licença, assinatura, equipe ou empresa. Cadastro público não deve ser interpretado como permissão de uso comercial.

Antes de atender várias empresas no mesmo ambiente, implementar:

- Empresas, membros e papéis (administrador, editor e leitor), com convites controlados.
- Associação de cada registro e objeto privado à empresa; políticas RLS e Storage verificando vínculo e papel. O usuário não pode escolher uma empresa arbitrária nem promover o próprio papel.
- Licenças e limites de usuários definidos pelo servidor. Login identifica a pessoa; autorização determina empresas e recursos permitidos.
- Registro de alterações e testes que tentem consultar/alterar dados de outra empresa, incluindo anexos e URLs de download.
- Fluxo comercial: inicialmente aprovação manual e convites; depois contratação/cobrança com eventos verificados e idempotentes. Nenhum provedor de pagamento foi escolhido ou integrado.
- Configurações administrativas e conectores acessíveis somente aos responsáveis autorizados; impedir acesso aos recursos pagos também nas APIs, não apenas na interface.

A mudança de isolamento por usuário para empresa exige migração explícita de registros e caminhos do Storage. Não relaxar as políticas atuais para permitir acesso a qualquer usuário autenticado. A recomendação acima não significa que a arquitetura comercial já esteja implementada.

Base técnica: [políticas RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).

O portal apresenta os módulos em formato de catálogo profissional. Preços, checkout e bloqueio por licença não fazem parte desta alteração visual.
