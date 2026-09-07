"use client";

import type { MateFrame } from "@/lib/assembly/types";

// Painel de parâmetros da restrição, depois de escolher as 2 faces — mesmo
// estilo dos painéis de parâmetro de feature do Modelador (Extrudar, Furo
// etc.): uma barra com campos + Confirmar/Cancelar, sem modal.
//
// Não existem "tipos" de restrição separados no motor (ver
// src/lib/assembly/types.ts — um único "mate" cobre tudo), mas a UI
// reconhece o que foi clicado (plano/cilíndrico, com raio) e oferece
// presets com comportamento físico diferente pra cada combinação, ao
// estilo Inventor: Encaixar/Encostar pra faces planas, Inserir/Concêntrico
// pra furos/eixos redondos.
function describeFrame(frame: MateFrame): string {
  if (frame.kind === "cylindrical") {
    return `Furo/eixo redondo${frame.radius ? ` Ø${(frame.radius * 2).toFixed(1)}mm` : ""}`;
  }
  return "Face plana";
}

export function ConstraintDialog({
  instanceALabel,
  instanceBLabel,
  frameA,
  frameB,
  offset,
  flip,
  angle,
  lockDistance,
  lockAngle,
  onOffsetChange,
  onFlipChange,
  onAngleChange,
  onLockDistanceChange,
  onLockAngleChange,
  onConfirm,
  onCancel,
}: {
  instanceALabel: string;
  instanceBLabel: string;
  frameA: MateFrame;
  frameB: MateFrame;
  offset: number;
  flip: boolean;
  angle: number;
  lockDistance: boolean;
  lockAngle: boolean;
  onOffsetChange: (value: number) => void;
  onFlipChange: (value: boolean) => void;
  onAngleChange: (value: number) => void;
  onLockDistanceChange: (value: boolean) => void;
  onLockAngleChange: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const bothCylindrical = frameA.kind === "cylindrical" && frameB.kind === "cylindrical";

  function applyPreset(preset: { offset: number; flip: boolean; angle: number; lockDistance: boolean }) {
    onOffsetChange(preset.offset);
    onFlipChange(preset.flip);
    onAngleChange(preset.angle);
    onLockDistanceChange(preset.lockDistance);
    onLockAngleChange(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-primary-100 bg-primary-50 px-4 py-1.5 text-sm">
      <div className="flex flex-col">
        <span className="font-semibold text-primary-800">
          Restrição: {instanceALabel} ↔ {instanceBLabel}
        </span>
        <span className="text-xs text-primary-500">
          {describeFrame(frameA)} ↔ {describeFrame(frameB)}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {bothCylindrical ? (
          <>
            <button
              type="button"
              onClick={() => applyPreset({ offset: 0, flip: true, angle: 0, lockDistance: false })}
              title="Alinha os dois eixos, um dentro do outro, mas deixa livre pra deslizar/girar (ex. parafuso solto no furo)"
              className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100"
            >
              Concêntrico
            </button>
            <button
              type="button"
              onClick={() => applyPreset({ offset: 0, flip: true, angle: 0, lockDistance: true })}
              title="Alinha os eixos E trava o quanto a peça entra (ex. parafuso todo assentado no furo)"
              className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100"
            >
              Inserir
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => applyPreset({ offset: 0, flip: false, angle: 0, lockDistance: true })}
              title="Encosta as duas faces, uma de frente pra outra"
              className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100"
            >
              Encaixar
            </button>
            <button
              type="button"
              onClick={() => applyPreset({ offset: 0, flip: true, angle: 0, lockDistance: true })}
              title="Junta as faces por dentro (mesmo lado), ao estilo de uma peça encaixada dentro da outra"
              className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100"
            >
              Encostar por dentro
            </button>
          </>
        )}
      </div>

      {bothCylindrical ? (
        <label className="flex items-center gap-1.5 text-primary-700">
          <input type="checkbox" checked={lockDistance} onChange={(e) => onLockDistanceChange(e.target.checked)} />
          Travar posição no eixo
        </label>
      ) : null}
      <label className="flex items-center gap-1.5 text-primary-700">
        Distância (mm)
        <input
          type="number"
          value={offset}
          disabled={bothCylindrical && !lockDistance}
          onChange={(e) => onOffsetChange(Number(e.target.value))}
          className="w-20 rounded border border-primary-200 px-1.5 py-0.5 disabled:opacity-40"
        />
      </label>
      <label className="flex items-center gap-1.5 text-primary-700">
        <input type="checkbox" checked={flip} onChange={(e) => onFlipChange(e.target.checked)} />
        Inverter
      </label>
      <label className="flex items-center gap-1.5 text-primary-700">
        <input type="checkbox" checked={lockAngle} onChange={(e) => onLockAngleChange(e.target.checked)} />
        Travar ângulo
      </label>
      <label className="flex items-center gap-1.5 text-primary-700">
        Ângulo (°)
        <input
          type="number"
          value={angle}
          disabled={!lockAngle}
          onChange={(e) => onAngleChange(Number(e.target.value))}
          className="w-20 rounded border border-primary-200 px-1.5 py-0.5 disabled:opacity-40"
        />
      </label>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:opacity-90"
        >
          Confirmar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-white px-3 py-1.5 text-primary-700 hover:bg-primary-100"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
