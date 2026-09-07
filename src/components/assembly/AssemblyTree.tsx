"use client";

import { IconFixed } from "@/components/icons/ToolIcons";
import type { AssemblyConstraint, ComponentInstance } from "@/lib/assembly/types";

// Árvore de componentes/restrições da montagem, ao estilo do "Model Browser"
// do Inventor: uma seção com as peças inseridas (vinculada/não vinculada,
// visível, fixa, suprimida) e outra com as restrições (Relações) aplicadas
// entre elas.
export function AssemblyTree({
  instances,
  constraints,
  linkStatus,
  selectedInstanceId,
  onSelectInstance,
  onToggleVisible,
  onToggleGrounded,
  onToggleSuppressed,
  onRemoveInstance,
  onRelinkInstance,
  onRemoveConstraint,
  onInsertPart,
  onStartConstraint,
  onEditInstance,
  constraintPickCount,
}: {
  instances: ComponentInstance[];
  constraints: AssemblyConstraint[];
  // true = vínculo resolvido nesta sessão (peça carregada); false = "não
  // vinculada" (handle ausente/permissão negada/arquivo movido).
  linkStatus: Record<string, boolean>;
  selectedInstanceId: string | null;
  onSelectInstance: (id: string | null) => void;
  onToggleVisible: (id: string) => void;
  onToggleGrounded: (id: string) => void;
  onToggleSuppressed: (id: string) => void;
  onRemoveInstance: (id: string) => void;
  onRelinkInstance: (id: string) => void;
  onRemoveConstraint: (id: string) => void;
  onInsertPart: () => void;
  onStartConstraint: () => void;
  // Duplo clique numa peça — ao estilo Inventor, abre ela pra editar (ver
  // src/lib/project/editInContext.ts).
  onEditInstance: (id: string) => void;
  // 0 = nenhuma restrição em andamento; 1 = já escolheu a 1ª face, esperando
  // a 2ª — mostrado como dica no botão "Nova Restrição".
  constraintPickCount: number;
}) {
  function labelFor(id: string): string {
    return instances.find((i) => i.id === id)?.label ?? "?";
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-primary-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-500">Componentes</h2>
        <button
          type="button"
          onClick={onInsertPart}
          className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          Inserir Peça
        </button>
      </div>

      {instances.length === 0 && <p className="text-xs text-primary-400">Nenhuma peça inserida ainda.</p>}

      <ul className="space-y-1">
        {instances.map((instance) => {
          const linked = linkStatus[instance.id] ?? false;
          const isSelected = instance.id === selectedInstanceId;
          return (
            <li
              key={instance.id}
              onClick={() => onSelectInstance(isSelected ? null : instance.id)}
              onDoubleClick={() => onEditInstance(instance.id)}
              title="Duplo clique pra editar esta peça"
              className={`cursor-pointer rounded-lg border px-2 py-1.5 text-xs ${
                isSelected ? "border-primary bg-white" : "border-transparent hover:bg-white/70"
              } ${instance.suppressed ? "opacity-50" : ""}`}
            >
              <div className="flex items-center gap-1.5">
                {instance.grounded && (
                  <span title="Fixo (não entra no solver)" className="text-amber-600">
                    <IconFixed className="h-3.5 w-3.5" />
                  </span>
                )}
                <span
                  className={`truncate font-medium ${linked ? "text-primary-800" : "text-error"}`}
                  title={linked ? instance.sourceFileName : "Não vinculada — clique em Religar"}
                >
                  {instance.label}
                </span>
                {!linked && (
                  <span className="shrink-0 rounded bg-error/10 px-1 py-0.5 text-[10px] font-semibold text-error">
                    não vinculada
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisible(instance.id);
                  }}
                  className="rounded bg-primary-100 px-1.5 py-0.5 text-primary-700 hover:bg-primary-200"
                >
                  {instance.visible ? "Ocultar" : "Mostrar"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleGrounded(instance.id);
                  }}
                  className="rounded bg-primary-100 px-1.5 py-0.5 text-primary-700 hover:bg-primary-200"
                >
                  {instance.grounded ? "Soltar" : "Fixar"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSuppressed(instance.id);
                  }}
                  className="rounded bg-primary-100 px-1.5 py-0.5 text-primary-700 hover:bg-primary-200"
                >
                  {instance.suppressed ? "Ativar" : "Suprimir"}
                </button>
                {!linked && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRelinkInstance(instance.id);
                    }}
                    className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 hover:bg-amber-200"
                  >
                    Religar
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveInstance(instance.id);
                  }}
                  className="ml-auto rounded bg-error/10 px-1.5 py-0.5 text-error hover:bg-error/20"
                >
                  Remover
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mb-2 mt-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-primary-500">Relações</h2>
        <button
          type="button"
          onClick={onStartConstraint}
          disabled={instances.length < 2}
          title={instances.length < 2 ? "Insira pelo menos 2 peças" : "Escolher uma face em cada peça"}
          className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {constraintPickCount === 1 ? "Escolha a 2ª face…" : "Nova Restrição"}
        </button>
      </div>

      {constraints.length === 0 && <p className="text-xs text-primary-400">Nenhuma restrição ainda.</p>}

      <ul className="space-y-1">
        {constraints.map((constraint) => (
          <li
            key={constraint.id}
            className="flex items-center justify-between rounded-lg bg-white px-2 py-1.5 text-xs text-primary-700"
          >
            <span className="truncate" title={constraint.label}>
              {constraint.label || `${labelFor(constraint.instanceA)} ↔ ${labelFor(constraint.instanceB)}`}
            </span>
            <button
              type="button"
              onClick={() => onRemoveConstraint(constraint.id)}
              className="ml-2 shrink-0 rounded bg-error/10 px-1.5 py-0.5 text-error hover:bg-error/20"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
