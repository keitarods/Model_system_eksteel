/** Return fixed diagnostics only: driver messages may contain passwords, SQL and URIs. */
export function databaseErrorMessage(error: unknown): string {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  const codes = new Set<string>();
  let timeout = false;
  let tenant = false;
  while (queue.length && seen.size < 20) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    const e = item as { code?: unknown; number?: unknown; message?: unknown; cause?: unknown; originalError?: unknown; errors?: unknown };
    if (typeof e.code === 'string') codes.add(e.code);
    if (typeof e.number === 'number') codes.add(String(e.number));
    if (typeof e.message === 'string') {
      timeout ||= /timeout|timed out|timeout expired/i.test(e.message);
      tenant ||= /tenant or user not found/i.test(e.message);
    }
    queue.push(e.cause, e.originalError);
    if (Array.isArray(e.errors)) queue.push(...e.errors);
  }
  const has = (...values: string[]) => values.some(v => codes.has(v));
  if (tenant) return 'Conexão: usuário ou projeto não encontrado no pooler Supabase. Copie o usuário completo e o host de Connect → Session pooler (geralmente postgres.ID_DO_PROJETO).';
  if (has('28P01','28000','ER_ACCESS_DENIED_ERROR','ELOGIN','18456')) return 'Autenticação do banco recusada. Confira usuário e senha do banco (não a senha do usuário Auth). No Supabase Session pooler, copie o usuário completo mostrado em Connect.';
  if (has('ENOTFOUND','EAI_AGAIN')) return 'Rede: o servidor não conseguiu resolver o host do banco. Confira o host copiado da conexão e o DNS da hospedagem.';
  if (has('ENETUNREACH','EHOSTUNREACH')) return 'Rede: o endereço do banco está inacessível ao servidor. Se estiver usando conexão direta Supabase em uma rede sem IPv6, use Connect → Session pooler e autorize o novo host e porta.';
  if (has('ECONNREFUSED')) return 'Rede: a conexão foi recusada pelo destino. Confira porta, disponibilidade do banco e regras de acesso/firewall.';
  if (has('CERT_HAS_EXPIRED')) return 'TLS: o certificado do banco ou da autoridade expirou. Solicite ao provedor uma cadeia válida e atualize o certificado CA no servidor.';
  if (has('ERR_TLS_CERT_ALTNAME_INVALID')) return 'TLS: o certificado não corresponde ao host informado. Copie o host exato de Connect e autorize esse destino. Adicionar uma CA não corrige um host incorreto.';
  if (has('DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','ERR_TLS_CERT_ALTNAME_INVALID')) return 'TLS: não foi possível validar o certificado do banco. Solicite ao administrador que configure a CA pública do provedor no servidor (CAD_DATABASE_CA_PEM) e confira o host. A validação TLS permanece ativa.';
  if (has('ETIMEDOUT','ETIMEOUT','ER_QUERY_TIMEOUT','57014') || timeout) return 'Tempo limite: o banco não respondeu a tempo. Verifique se o projeto está ativo, se o host/porta são corretos e se a rede permite a conexão.';
  if (has('3D000','ER_BAD_DB_ERROR','4060')) return 'Banco não encontrado ou inacessível. Confira o nome do banco (normalmente postgres no Supabase) e as permissões do usuário.';
  if (has('42501','ER_TABLEACCESS_DENIED_ERROR','ER_DBACCESS_DENIED_ERROR','229')) return 'Permissão insuficiente no banco. Solicite ao administrador as permissões de leitura, inserção e atualização necessárias às tabelas Eksteel.';
  if (has('42P01','42703','ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR','208','207')) return 'Estrutura do banco ausente ou incompatível. Solicite ao administrador a aplicação dos scripts Eksteel no mesmo banco da conexão.';
  if (has('23505','ER_DUP_ENTRY','2627','2601')) return 'Já existe um registro com esse nome. Escolha outro nome para a pasta ou peça; para atualizar uma peça existente, abra-a e use Salvar.';
  if (has('ECONNRESET','EPIPE','ESOCKET')) return 'A conexão com o banco foi interrompida. Verifique a rede e o destino e conecte novamente. Se ocorreu ao salvar, reabra a peça para confirmar se a gravação foi concluída.';
  return 'Falha não identificada na operação do banco. Informe qual botão foi usado e o tipo de conexão, sem enviar senhas ou a string completa.';
}
