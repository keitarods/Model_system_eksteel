// Handoff "editar peça no contexto" da Montagem — ao estilo Inventor: duplo
// clique num componente abre o Modelador já carregado naquele arquivo
// vinculado, com um botão "Voltar pra Montagem" que salva e retorna.
//
// Só precisa sobreviver a uma navegação client-side (router.push do Next),
// nunca a um reload de página de verdade — por isso é uma variável de
// módulo simples em memória, sem IndexedDB (comparar com autosave.ts/
// linkedFiles.ts, que existem justamente pra sobreviver a um reload).

export type EditInContextRequest = {
  linkKey: string;
  instanceId: string;
  instanceLabel: string;
};

let pendingEdit: EditInContextRequest | null = null;
let pendingReturnInstanceId: string | null = null;

// Chamado pela Montagem (duplo clique num componente) antes de navegar pro
// Modelador.
export function requestEditInContext(request: EditInContextRequest): void {
  pendingEdit = request;
}

// Chamado pelo Modelador ao montar — consome (lê e limpa) o pedido, se
// houver um. Só dá `!= null` na PRIMEIRA vez que o Modelador monta depois
// do duplo clique; um reload de página de verdade nunca vê isso.
export function consumePendingEditInContext(): EditInContextRequest | null {
  const request = pendingEdit;
  pendingEdit = null;
  return request;
}

// Chamado pelo Modelador ("Voltar pra Montagem") antes de navegar de volta —
// deixa a Montagem saber qual instância reselecionar ao montar de novo.
export function requestReturnSelection(instanceId: string): void {
  pendingReturnInstanceId = instanceId;
}

export function consumePendingReturnSelection(): string | null {
  const id = pendingReturnInstanceId;
  pendingReturnInstanceId = null;
  return id;
}
