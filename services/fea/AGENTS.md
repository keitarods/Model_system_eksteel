# Atualizações do comunicador

O usuário pediu que toda atualização do comunicador também atualize o instalador
oferecido aos usuários externos. Mudanças no runtime FEA incluído no comunicador
também exigem uma nova distribuição.

- Gere uma versão nova no sistema correspondente e valide malha e cálculo com
  o executável empacotado antes de publicar.
- Para Linux, gere também o `.deb` com `packaging/build.py --deb`.
- Publique com `npm run fea:publish -- linux|windows VERSAO ARQUIVO` na raiz.
  A chave administrativa vem do ambiente privado, nunca do código ou do chat.
- O publicador verifica o download e seu SHA-256 antes de atualizar `latest.json`.
  Não altere as permissões dos buckets de projetos/documentos.
- Sem credenciais, ambiente Windows ou validação, informe o que ficou pendente.
  Não apresente um pacote local como publicado nem um instalador não testado como
  validado. Não substitua a versão de outra plataforma por um pacote incompatível.
