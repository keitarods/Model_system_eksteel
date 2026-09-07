"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import type { Solid, ShapeMesh } from "replicad";
import { createClient } from "@/lib/supabase/client";
import { IconLogout, IconRedo, IconUndo } from "@/components/icons/ToolIcons";
import { AssemblyViewer3D, type AssemblyBody, type FacePick, type PickMarker } from "./AssemblyViewer3D";
import { AssemblyTree } from "./AssemblyTree";
import { ConstraintDialog } from "./ConstraintDialog";
import { useAssemblyStore } from "@/lib/assembly/store";
import { solveAssembly } from "@/lib/assembly/solver";
import { frameFromFaceClick } from "@/lib/assembly/mateFrame";
import { IDENTITY_PLACEMENT, type ComponentInstance, type ComponentPlacement, type MateFrame } from "@/lib/assembly/types";
import { rebuildModel } from "@/lib/replicad/build-model";
import { loadOpenCascade } from "@/lib/replicad/opencascade";
import { buildAssemblyCompound, exportAssemblyStep } from "@/lib/replicad/assemblyExport";
import { DrawingSheetWorkspace, type SheetShapeSource } from "@/components/drawing/DrawingSheetWorkspace";
import { useAssemblyDrawingStore } from "@/lib/drawing/store";
import { createEmptyPartProperties, type PartProperties } from "@/lib/project/partProperties";
import {
  convertVolume,
  formatMass,
  measureAssemblyProperties,
  DEFAULT_VOLUME_UNIT,
  VOLUME_UNIT_LABELS,
  type AssemblyMassPart,
  type AssemblyPhysicalProperties,
  type VolumeUnit,
} from "@/lib/replicad/physicalProperties";
import { pickAndLinkFile, resolveLinkedFile } from "@/lib/project/linkedFiles";
import { ASSEMBLY_FILE_EXTENSION, parseAssembly, serializeAssembly } from "@/lib/project/assemblyFormat";
import {
  isFileSystemAccessSupported,
  pickFileToOpen,
  pickSaveFileHandle,
  saveOrDownload,
  writeToFileHandle,
} from "@/lib/project/folder";
import {
  clearDraft,
  flushDraftSave,
  loadDraft,
  rememberCurrentFileHandle,
  restoreCurrentFileHandle,
  scheduleDraftSave,
} from "@/lib/project/autosave";
import { consumePendingReturnSelection, requestEditInContext } from "@/lib/project/editInContext";
import { redoModel, undoModel, useUndoStore } from "@/lib/history/store";

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

// Converte um ponto MUNDIAL (o que o clique no viewer devolve — a peça já
// está desenhada com o transform da instância aplicado) de volta pro
// espaço LOCAL do sólido reconstruído (o que findClickedAxis/
// frameFromFaceClick espera, já que rebuildModel nunca sabe onde a
// instância está posicionada na montagem).
function worldPointToLocal(point: [number, number, number], placement: ComponentPlacement): [number, number, number] {
  const inverseRotation = new THREE.Quaternion(...placement.quaternion).invert();
  const local = new THREE.Vector3(...point).sub(new THREE.Vector3(...placement.position)).applyQuaternion(inverseRotation);
  return [local.x, local.y, local.z];
}

// Inverso de worldPointToLocal — usado só pra desenhar o marcador visual de
// uma referência já escolhida (MateFrame vive em espaço local da peça; o
// viewport precisa da posição MUNDIAL atual dela pra desenhar no lugar
// certo, mesmo que a peça tenha sido arrastada depois do clique).
function localFrameToWorld(
  frame: MateFrame,
  placement: ComponentPlacement
): { point: [number, number, number]; normal: [number, number, number] } {
  const q = new THREE.Quaternion(...placement.quaternion);
  const pos = new THREE.Vector3(...placement.position);
  const origin = new THREE.Vector3(...frame.origin).applyQuaternion(q).add(pos);
  const normal = new THREE.Vector3(...frame.normal).applyQuaternion(q).normalize();
  return { point: [origin.x, origin.y, origin.z], normal: [normal.x, normal.y, normal.z] };
}

function describeFrameKind(frame: MateFrame): string {
  if (frame.kind === "cylindrical") {
    return `Furo/eixo redondo${frame.radius ? ` (Ø${(frame.radius * 2).toFixed(1)}mm)` : ""}`;
  }
  return "Face plana";
}

type ConstraintDraft = {
  instanceA: string;
  frameA: MateFrame;
  instanceB: string;
  frameB: MateFrame;
  offset: number;
  flip: boolean;
  angle: number;
  lockDistance: boolean;
  lockAngle: boolean;
};

export function AssemblyWorkspace({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const instances = useAssemblyStore((s) => s.instances);
  const constraints = useAssemblyStore((s) => s.constraints);
  const addInstance = useAssemblyStore((s) => s.addInstance);
  const updateInstance = useAssemblyStore((s) => s.updateInstance);
  const removeInstance = useAssemblyStore((s) => s.removeInstance);
  const addConstraint = useAssemblyStore((s) => s.addConstraint);
  const removeConstraint = useAssemblyStore((s) => s.removeConstraint);
  const clearAssembly = useAssemblyStore((s) => s.clear);
  const loadAssembly = useAssemblyStore((s) => s.loadAssembly);
  const canUndo = useUndoStore((s) => s.past.length > 0);
  const canRedo = useUndoStore((s) => s.future.length > 0);
  // Folhas de desenho DA MONTAGEM — store própria, separada da do Modelador
  // (ver createDrawingStore em src/lib/drawing/store.ts): as duas telas
  // convivem na mesma sessão e cada uma salva as suas no seu arquivo.
  const assemblySheets = useAssemblyDrawingStore((s) => s.sheets);

  const [meshes, setMeshes] = useState<Record<string, ShapeMesh | null>>({});
  const [linkStatus, setLinkStatus] = useState<Record<string, boolean>>({});
  const [partProperties, setPartProperties] = useState<Record<string, PartProperties>>({});
  // "modelo" = montagem 3D; "desenho" = folha de desenho DA MONTAGEM (mesmo
  // ambiente de Desenho do Modelador, com a montagem inteira como fonte de
  // geometria e a Lista de Peças habilitada) — mesma divisão de modos que o
  // ModeladorWorkspace já usa pra peça.
  const [mode, setMode] = useState<"modelo" | "desenho">("modelo");
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [placements, setPlacements] = useState<Record<string, ComponentPlacement>>({});
  const solidsRef = useRef<Record<string, Solid | null>>({});
  const generationRef = useRef(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [constraintMode, setConstraintMode] = useState(false);
  const [pendingFace, setPendingFace] = useState<{ instanceId: string; frame: MateFrame } | null>(null);
  const [constraintDraft, setConstraintDraft] = useState<ConstraintDraft | null>(null);

  const [currentFileHandle, setCurrentFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [solverWarning, setSolverWarning] = useState<string | null>(null);
  // null = ainda não checou (evita mismatch de hidratação: no servidor
  // isFileSystemAccessSupported() sempre dá false por não ter `window` —
  // mesmo raciocínio de ModeladorWorkspace.tsx). Só depois de montado no
  // client é que sabemos de verdade se o navegador suporta.
  const [fsAccessSupported, setFsAccessSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setFsAccessSupported(isFileSystemAccessSupported());
  }, []);

  const showNotice = useCallback((message: string) => {
    setNoticeMessage(message);
    window.setTimeout(() => {
      setNoticeMessage((current) => (current === message ? null : current));
    }, 2500);
  }, []);

  // Restaura o rascunho automático (ver src/lib/project/autosave.ts) — só
  // roda uma vez, ao montar, e só se a montagem ainda estiver vazia (recém
  // aberta, nunca depois de abrir um arquivo de verdade). O ref trava o
  // efeito de autosave logo abaixo até essa tentativa terminar, senão um
  // autosave do estado ainda VAZIO (disparado no mesmo instante) apagaria o
  // rascunho de verdade antes dele ser lido.
  const hasRestoredAutosaveRef = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        if (useAssemblyStore.getState().instances.length === 0) {
          const json = await loadDraft("montagem");
          if (json) {
            const draft = parseAssembly(json);
            loadAssembly(draft);
            useAssemblyDrawingStore.getState().loadSheets(draft.drawingSheets);
            showNotice("Rascunho automático restaurado (última alteração antes de fechar/atualizar a página).");
          }
        }
        if (isFileSystemAccessSupported()) {
          const handle = await restoreCurrentFileHandle("montagem");
          if (handle) {
            setCurrentFileHandle(handle);
            setCurrentFileName(handle.name);
          }
        }
        // Voltando de "editar peça no contexto" (ver editInContext.ts) —
        // reseleciona a instância que estava sendo editada, só de conforto
        // visual (não afeta o solver nem a reconstrução, que já rodam do
        // zero de qualquer forma nesta remontagem).
        const returnedId = consumePendingReturnSelection();
        if (returnedId) setSelectedInstanceId(returnedId);
      } catch (err) {
        console.error("Falha ao restaurar rascunho automático:", err);
      } finally {
        hasRestoredAutosaveRef.current = true;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, []);

  // Autosave: qualquer mudança em instâncias/restrições/folhas vira um
  // rascunho salvo no IndexedDB (debounced) — sobrevive a um reload/fechar
  // sem "Salvar" manual (as peças em si continuam vinculadas ao vivo via
  // linkedFiles.ts, isso aqui só salva quais peças/restrições existem).
  useEffect(() => {
    if (!hasRestoredAutosaveRef.current) return;
    scheduleDraftSave("montagem", serializeAssembly(instances, constraints, assemblySheets));
  }, [instances, constraints, assemblySheets]);

  // Flush imediato ao fechar/recarregar a aba — ver flushDraftSave.
  useEffect(() => {
    function handlePageHide() {
      if (!hasRestoredAutosaveRef.current) return;
      flushDraftSave("montagem", serializeAssembly(instances, constraints, assemblySheets));
    }
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [instances, constraints, assemblySheets]);

  // Chave "estrutural": só muda quando uma peça é inserida/removida ou
  // religada a outro arquivo (linkKey) ou suprimida — DELIBERADAMENTE não
  // inclui placementSeed, senão arrastar um componente (que também passa
  // por updateInstance, mudando a referência do array `instances`)
  // disparava uma reconstrução completa via OpenCascade a cada frame do
  // arrasto.
  const structuralKey = useMemo(
    () => instances.map((i) => `${i.id}:${i.linkKey}:${i.suppressed ? 1 : 0}`).join("|"),
    [instances]
  );

  useEffect(() => {
    let cancelled = false;
    const generation = ++generationRef.current;

    (async () => {
      if (instances.length === 0) {
        Object.values(solidsRef.current).forEach((s) => s?.delete());
        solidsRef.current = {};
        setMeshes({});
        setLinkStatus({});
        return;
      }

      await loadOpenCascade();

      const nextSolids: Record<string, Solid | null> = {};
      const nextMeshes: Record<string, ShapeMesh | null> = {};
      const nextLinkStatus: Record<string, boolean> = {};
      // "iProperties" lidas do arquivo de cada peça — é daqui que a Lista
      // de Peças da folha tira código/descrição/material/densidade (ver
      // src/lib/drawing/bom.ts). Guardadas junto da resolução do vínculo
      // pra não precisar reler o arquivo toda vez que a lista atualizar.
      const nextProperties: Record<string, PartProperties> = {};
      let anyBuildFailed = false;

      for (const instance of instances) {
        // break (não return): precisa cair no bloco de limpeza logo abaixo
        // do loop, que descarta os sólidos WASM já construídos nas
        // iterações anteriores — um `return` aqui pularia essa limpeza e
        // vazaria memória do OpenCascade toda vez que esse efeito for
        // cancelado (nova mudança) no meio do loop assíncrono.
        if (cancelled || generation !== generationRef.current) break;
        if (instance.suppressed) continue;

        const resolution = await resolveLinkedFile(instance.linkKey);
        if (!resolution.ok) {
          nextLinkStatus[instance.id] = false;
          continue;
        }

        nextLinkStatus[instance.id] = true;
        nextProperties[instance.id] = resolution.properties;
        if (resolution.fileName !== instance.sourceFileName) {
          updateInstance(instance.id, { sourceFileName: resolution.fileName });
        }

        try {
          const solid = rebuildModel(resolution.features, {});
          nextSolids[instance.id] = solid;
          nextMeshes[instance.id] = solid ? solid.mesh() : null;
        } catch (err) {
          console.error(`Falha ao reconstruir a peça "${instance.label}":`, err);
          nextSolids[instance.id] = null;
          nextMeshes[instance.id] = null;
          anyBuildFailed = true;
        }
      }

      if (cancelled || generation !== generationRef.current) {
        Object.values(nextSolids).forEach((s) => s?.delete());
        return;
      }

      Object.values(solidsRef.current).forEach((s) => s?.delete());
      solidsRef.current = nextSolids;
      setMeshes(nextMeshes);
      setLinkStatus(nextLinkStatus);
      setPartProperties(nextProperties);
      if (anyBuildFailed) {
        setErrorMessage("Uma ou mais peças não puderam ser reconstruídas — veja o console para detalhes.");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralKey, refreshToken]);

  // Resolve o posicionamento final de cada componente (restrições
  // combinadas em conjunto) — puramente numérico, roda de novo sempre que
  // instâncias (posição arrastada, fixar/soltar, suprimir) ou restrições
  // mudam. Ver src/lib/assembly/solver.ts.
  useEffect(() => {
    const result = solveAssembly(instances, constraints);
    setPlacements(result.placements);
    setSolverWarning(
      result.unsatisfiedConstraintIds.length > 0
        ? `${result.unsatisfiedConstraintIds.length} restrição(ões) não conseguiram ser satisfeitas totalmente juntas — confira se não são conflitantes entre si.`
        : null
    );
  }, [instances, constraints]);

  useEffect(() => {
    return () => {
      Object.values(solidsRef.current).forEach((s) => s?.delete());
    };
  }, []);

  const bodies: AssemblyBody[] = useMemo(
    () =>
      instances
        .filter((i) => !i.suppressed && meshes[i.id])
        .map((i) => ({
          instanceId: i.id,
          mesh: meshes[i.id]!,
          placement: placements[i.id] ?? i.placementSeed,
          visible: i.visible,
          grounded: i.grounded,
        })),
    [instances, meshes, placements]
  );

  const pickMarkers: PickMarker[] = useMemo(() => {
    if (!pendingFace) return [];
    const instance = instances.find((i) => i.id === pendingFace.instanceId);
    if (!instance) return [];
    const placement = placements[pendingFace.instanceId] ?? instance.placementSeed;
    const world = localFrameToWorld(pendingFace.frame, placement);
    return [{ point: world.point, normal: world.normal, color: "#f59e0b" }];
  }, [pendingFace, instances, placements]);

  const selectedInstance = instances.find((i) => i.id === selectedInstanceId) ?? null;
  // Ao estilo Inventor: mesmo uma peça já restringida continua arrastável —
  // o solver (ver solveAssembly) só corrige de volta os graus de liberdade
  // que a restrição realmente trava, deixando o resto seguir o arrasto (ex.
  // deslizar no plano/eixo, girar). Arrastar uma peça 100% travada só não
  // vai produzir movimento nenhum, sem mal nenhum nisso.
  const draggableInstanceId = selectedInstance ? selectedInstance.id : null;

  const handleInsertPart = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      showNotice(
        "Este navegador não suporta vínculo persistente de peças (funciona no Chrome/Edge) — a peça precisará ser religada toda vez que a montagem for reaberta."
      );
    }
    const linkKey = createId();
    try {
      const result = await pickAndLinkFile(linkKey);
      if (!result) return;
      const instance: ComponentInstance = {
        id: createId(),
        label: result.fileName.replace(/\.eks3d$/i, ""),
        linkKey,
        sourceFileName: result.fileName,
        // 1ª peça inserida vem fixa, ao estilo Inventor (toda montagem
        // precisa de pelo menos 1 referência que o solver não mexe).
        grounded: instances.length === 0,
        suppressed: false,
        visible: true,
        // Espaçada da origem (não empilhada em cima da 1ª peça) — senão
        // todo componente novo nasce EXATAMENTE sobreposto ao anterior, o
        // que torna impossível diferenciar/clicar em cada um até alguém
        // arrastar manualmente. Só a semente inicial; arrastar ou
        // restringir depois substitui isso normalmente.
        placementSeed: {
          position: [instances.length * 150, 0, 0],
          quaternion: [0, 0, 0, 1],
        },
      };
      addInstance(instance);
      showNotice(`"${result.fileName}" inserida.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erro ao inserir a peça.");
    }
  }, [instances.length, addInstance, showNotice]);

  const handleRelinkInstance = useCallback(
    async (id: string) => {
      const instance = instances.find((i) => i.id === id);
      if (!instance) return;
      try {
        const result = await pickAndLinkFile(instance.linkKey);
        if (!result) return;
        updateInstance(id, { sourceFileName: result.fileName });
        setRefreshToken((t) => t + 1);
        showNotice(`"${result.fileName}" religada.`);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Erro ao religar a peça.");
      }
    },
    [instances, updateInstance, showNotice]
  );

  // Duplo clique numa peça (viewport ou árvore) — ao estilo Inventor, abre
  // ela pra editar com as ferramentas do Modelador. Não tenta salvar nada
  // aqui: quem devolve pro contexto certo (salvar de volta no mesmo arquivo
  // vinculado + voltar pra esta montagem) é o botão "Voltar pra Montagem"
  // do Modelador, ver editInContext.ts.
  const handleEditInstance = useCallback(
    (id: string) => {
      if (constraintMode) return; // duplo clique durante escolha de face não deveria abrir nada
      const instance = instances.find((i) => i.id === id);
      if (!instance) return;
      if (!linkStatus[id]) {
        showNotice(`"${instance.label}" não está vinculada — religue o arquivo antes de editar.`);
        return;
      }
      requestEditInContext({ linkKey: instance.linkKey, instanceId: id, instanceLabel: instance.label });
      router.push("/modelador");
    },
    [constraintMode, instances, linkStatus, router, showNotice]
  );

  const handleStartConstraint = useCallback(() => {
    setConstraintMode(true);
    setPendingFace(null);
    setConstraintDraft(null);
  }, []);

  const handleCancelConstraint = useCallback(() => {
    setConstraintMode(false);
    setPendingFace(null);
    setConstraintDraft(null);
  }, []);

  const handlePickFace = useCallback(
    (pick: FacePick) => {
      const solid = solidsRef.current[pick.instanceId];
      const instance = instances.find((i) => i.id === pick.instanceId);
      if (!solid || !instance) return;

      const placement = placements[pick.instanceId] ?? instance.placementSeed;
      const localPoint = worldPointToLocal(pick.point, placement);
      const frame = frameFromFaceClick(solid, localPoint);
      if (!frame) {
        showNotice("Não foi possível reconhecer essa face — tente clicar mais perto do centro dela.");
        return;
      }

      if (!pendingFace) {
        setPendingFace({ instanceId: pick.instanceId, frame });
        return;
      }

      if (pendingFace.instanceId === pick.instanceId) {
        showNotice("Escolha a 2ª face numa peça diferente da 1ª.");
        return;
      }

      // Padrão físico sensato pra cada combinação: 2 faces cilíndricas
      // (furo/eixo redondo) quase sempre é "Inserir" (um dentro do outro,
      // eixos alinhados no MESMO sentido); faces planas quase sempre é
      // "Encaixar" (encostam de frente, normais opostas) — o usuário troca
      // pelos presets/campos do ConstraintDialog se não for o caso.
      // Padrão de graus de liberdade ao estilo Inventor: plana trava a
      // distância (é o sentido de "encostar"); cilíndrica começa livre pra
      // deslizar no eixo (só concêntrico) — o usuário troca pelo
      // ConstraintDialog se quiser "Inserir" (travada) em vez disso.
      const bothCylindrical = pendingFace.frame.kind === "cylindrical" && frame.kind === "cylindrical";
      setConstraintDraft({
        instanceA: pendingFace.instanceId,
        frameA: pendingFace.frame,
        instanceB: pick.instanceId,
        frameB: frame,
        offset: 0,
        flip: bothCylindrical,
        angle: 0,
        lockDistance: !bothCylindrical,
        lockAngle: false,
      });
      setPendingFace(null);
      setConstraintMode(false);
    },
    [instances, placements, pendingFace, showNotice]
  );

  function labelFor(id: string): string {
    return instances.find((i) => i.id === id)?.label ?? "?";
  }

  const handleConfirmConstraint = useCallback(() => {
    if (!constraintDraft) return;
    addConstraint({
      id: createId(),
      type: "mate",
      label: `${labelFor(constraintDraft.instanceA)} ↔ ${labelFor(constraintDraft.instanceB)}`,
      ...constraintDraft,
    });
    setConstraintDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constraintDraft, addConstraint]);

  const handleDragInstance = useCallback(
    (instanceId: string, position: [number, number, number]) => {
      const current = placements[instanceId] ?? instances.find((i) => i.id === instanceId)?.placementSeed ?? IDENTITY_PLACEMENT;
      updateInstance(instanceId, { placementSeed: { position, quaternion: current.quaternion } });
    },
    [placements, instances, updateInstance]
  );

  const handleLogout = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }, [router]);

  // Peças posicionadas (sólido + placement resolvido) — base tanto da
  // exportação STEP quanto das vistas da folha de montagem.
  const placedParts = useMemo(
    () =>
      instances
        .filter((i) => !i.suppressed && solidsRef.current[i.id])
        .map((i) => ({ solid: solidsRef.current[i.id]!, placement: placements[i.id] ?? i.placementSeed })),
    // solidsRef é um ref (não dispara render) — `meshes` muda no MESMO
    // setState em que os sólidos são trocados, então serve de gatilho pra
    // recalcular isto quando a reconstrução termina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instances, placements, meshes]
  );

  // "Atualizar" das propriedades físicas da MONTAGEM, ao estilo do Update
  // da aba Physical das iProperties do Inventor: soma a massa de todas as
  // ocorrências, usando a densidade que cada peça traz no próprio arquivo.
  // Síncrono e sob demanda: os sólidos já estão reconstruídos em memória
  // (solidsRef), só falta medir — e medir passa pelo OpenCascade, por isso
  // nunca roda sozinho a cada arrasto/restrição.
  const handleMeasureAssembly = useCallback((): AssemblyPhysicalProperties => {
    const parts: AssemblyMassPart[] = instances
      .filter((i) => !i.suppressed)
      .map((instance) => ({
        // linkKey = identidade da PEÇA (o arquivo vinculado), não da
        // ocorrência: é o que faz 4 cópias do mesmo parafuso virarem uma
        // linha "qtd 4" em vez de 4 linhas iguais.
        key: instance.linkKey,
        label: instance.label,
        solid: solidsRef.current[instance.id] ?? null,
        density: (partProperties[instance.id] ?? createEmptyPartProperties()).density,
      }));
    return measureAssemblyProperties(parts);
  }, [instances, partProperties]);

  // Fonte de geometria da folha de desenho DA MONTAGEM: a montagem inteira
  // composta num shape só (mesmo composto usado pra exportar STEP), mais a
  // Lista de Peças, que a folha de peça única não tem.
  const assemblySheetSource: SheetShapeSource = useMemo(
    () => ({
      kind: "montagem",
      buildShape: () => buildAssemblyCompound(placedParts),
      // Posição/rotação entram na assinatura (ao contrário da peça, que só
      // olha features): mover um componente muda a vista projetada da
      // montagem, então a vista fica mesmo desatualizada.
      signature: JSON.stringify(
        instances.map((i) => ({ id: i.id, s: i.suppressed, p: placements[i.id] ?? i.placementSeed }))
      ),
      supportsFlatten: false,
      emptyMessage: "Nenhuma peça vinculada ainda — insira peças na montagem antes de adicionar uma vista.",
      bomParts: () =>
        instances.map((instance) => ({
          instance,
          solid: solidsRef.current[instance.id] ?? null,
          properties: partProperties[instance.id] ?? createEmptyPartProperties(),
        })),
    }),
    [placedParts, instances, placements, partProperties]
  );

  // Fecha a montagem atual (ao estilo Inventor: descarta o documento
  // aberto, volta pra uma Montagem vazia) — sem isso, a única forma de
  // "largar" uma montagem era abrir outra por cima, e o rascunho automático
  // dela continuava restaurando sozinho a cada reload mesmo sem nenhuma
  // peça visível na tela. clearDraft apaga esse rascunho na hora, em vez de
  // confiar só no autosave (debounced) reescrever o estado vazio a tempo.
  const handleCloseAssembly = useCallback(() => {
    if (instances.length === 0 && !currentFileName) return;
    if (
      !window.confirm(
        "Fechar a montagem atual? Qualquer alteração que ainda não esteja salva num arquivo será perdida (o rascunho automático também é apagado)."
      )
    ) {
      return;
    }
    clearAssembly();
    useAssemblyDrawingStore.getState().clear();
    setSelectedInstanceId(null);
    setConstraintMode(false);
    setPendingFace(null);
    setConstraintDraft(null);
    setCurrentFileHandle(null);
    setCurrentFileName(null);
    setMode("modelo");
    rememberCurrentFileHandle("montagem", null);
    clearDraft("montagem").catch((err) => console.error("Falha ao apagar rascunho automático:", err));
    showNotice("Montagem fechada.");
  }, [instances.length, currentFileName, clearAssembly, showNotice]);

  const handleSaveAssemblyAs = useCallback(async () => {
    const json = serializeAssembly(instances, constraints, assemblySheets);
    const suggestedName = currentFileName ?? `montagem${ASSEMBLY_FILE_EXTENSION}`;

    if (isFileSystemAccessSupported()) {
      const handle = await pickSaveFileHandle(suggestedName, [
        { description: "Montagem Eksteel", accept: { "application/json": [ASSEMBLY_FILE_EXTENSION] } },
      ]);
      if (!handle) return;
      await writeToFileHandle(handle, json);
      setCurrentFileHandle(handle);
      setCurrentFileName(handle.name);
      rememberCurrentFileHandle("montagem", handle);
      showNotice(`"${handle.name}" salva.`);
      return;
    }

    const filename = window.prompt("Salvar como (nome do arquivo):", suggestedName);
    if (!filename) return;
    const result = await saveOrDownload(null, json, filename);
    setCurrentFileHandle(null);
    setCurrentFileName(filename);
    rememberCurrentFileHandle("montagem", null);
    showNotice(result === "folder" ? "Montagem salva." : "Montagem baixada.");
  }, [instances, constraints, assemblySheets, currentFileName, showNotice]);

  const handleSaveAssembly = useCallback(async () => {
    if (!currentFileHandle) {
      await handleSaveAssemblyAs();
      return;
    }
    try {
      await writeToFileHandle(currentFileHandle, serializeAssembly(instances, constraints, assemblySheets));
      showNotice(`"${currentFileHandle.name}" salva.`);
    } catch {
      setCurrentFileHandle(null);
      await handleSaveAssemblyAs();
    }
  }, [instances, constraints, assemblySheets, currentFileHandle, handleSaveAssemblyAs, showNotice]);

  const handleOpenAssembly = useCallback(async () => {
    const picked = await pickFileToOpen([
      { description: "Montagem Eksteel", accept: { "application/json": [ASSEMBLY_FILE_EXTENSION] } },
    ]);
    if (!picked) return;

    try {
      const loaded = parseAssembly(await picked.file.text());
      loadAssembly(loaded);
      useAssemblyDrawingStore.getState().loadSheets(loaded.drawingSheets);
      setSelectedInstanceId(null);
      setConstraintMode(false);
      setPendingFace(null);
      setConstraintDraft(null);
      setCurrentFileHandle(picked.handle);
      setCurrentFileName(picked.file.name);
      rememberCurrentFileHandle("montagem", picked.handle);
      setRefreshToken((t) => t + 1);
      showNotice(`Montagem "${picked.file.name}" aberta — religue as peças que aparecerem como "não vinculada".`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erro ao abrir a montagem.");
    }
  }, [loadAssembly, showNotice]);

  const handleExportStep = useCallback(async () => {
    if (placedParts.length === 0) {
      showNotice("Nenhuma peça vinculada para exportar.");
      return;
    }

    try {
      const blob = exportAssemblyStep(placedParts);
      const result = await saveOrDownload(null, blob, "montagem.step");
      showNotice(result === "folder" ? "STEP salvo na pasta selecionada." : "STEP baixado.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erro ao exportar STEP.");
    }
  }, [placedParts, showNotice]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (e.shiftKey) handleSaveAssemblyAs();
      else handleSaveAssembly();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSaveAssembly, handleSaveAssemblyAs]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-chrome-border bg-chrome-bg px-4 py-2 text-chrome-text">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/Eksteel-logo.png" alt="Eksteel" className="h-9 w-auto object-contain" />
          <div className="hidden h-7 w-px bg-chrome-border sm:block" />
          <span
            className="hidden text-sm font-semibold uppercase tracking-wide text-chrome-text-muted sm:inline"
            style={{ fontFamily: "var(--font-oswald)" }}
          >
            Montagem
          </span>
        </div>
        {currentFileName && (
          <span className="max-w-[10rem] truncate text-sm font-medium text-chrome-text-muted">{currentFileName}</span>
        )}

        {/* Montagem 3D x Folha de desenho da montagem — mesma divisão de
            modos do Modelador (modelo x desenho). */}
        <div className="flex items-center gap-0.5 rounded-lg bg-chrome-surface-alt p-0.5">
          {(["modelo", "desenho"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                mode === m ? "bg-primary text-primary-foreground" : "text-chrome-text-muted hover:bg-chrome-border"
              }`}
            >
              {m === "modelo" ? "Montagem" : "Folha"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPropertiesOpen(true)}
          title="Propriedades físicas da montagem (massa total por componente)"
          className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt"
        >
          Propriedades
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => router.push("/modelador")}
            title="Ir para o Modelador de peça"
            className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt"
          >
            Abrir Modelador
          </button>
          <div className="mx-1 hidden h-6 w-px bg-chrome-border sm:block" />
          <button
            type="button"
            onClick={handleCloseAssembly}
            title="Fechar a montagem atual (volta pra uma Montagem vazia)"
            className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={handleOpenAssembly}
            title={`Abrir montagem (${ASSEMBLY_FILE_EXTENSION})`}
            className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt"
          >
            Abrir
          </button>
          <button
            type="button"
            onClick={handleSaveAssembly}
            title="Salvar (Ctrl+S)"
            className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={handleSaveAssemblyAs}
            title="Salvar como um novo arquivo (Ctrl+Shift+S)"
            className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt"
          >
            Salvar Como
          </button>
          <button
            type="button"
            onClick={() => setRefreshToken((t) => t + 1)}
            title="Reler todas as peças vinculadas"
            className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt"
          >
            Atualizar Peças
          </button>
          <button
            type="button"
            onClick={handleExportStep}
            disabled={instances.length === 0}
            title="Exportar a montagem inteira (todas as peças posicionadas) como um único STEP"
            className="rounded-lg px-2 py-1.5 text-xs text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-40"
          >
            STEP
          </button>
          <div className="mx-1 hidden h-6 w-px bg-chrome-border sm:block" />
          <button
            type="button"
            onClick={undoModel}
            disabled={!canUndo}
            title="Desfazer (Ctrl+Z)"
            className="rounded-lg p-1.5 text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-30"
          >
            <IconUndo />
          </button>
          <button
            type="button"
            onClick={redoModel}
            disabled={!canRedo}
            title="Refazer (Ctrl+Y)"
            className="rounded-lg p-1.5 text-chrome-text-muted hover:bg-chrome-surface-alt disabled:cursor-not-allowed disabled:opacity-30"
          >
            <IconRedo />
          </button>
          {userEmail && (
            <div className="ml-1 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-1 pl-3 pr-1 backdrop-blur-sm">
              <span className="max-w-[10rem] truncate text-xs font-semibold text-chrome-text-muted">{userEmail}</span>
              <button
                type="button"
                onClick={handleLogout}
                title="Sair da conta"
                className="flex items-center gap-1.5 rounded-xl border border-chrome-border bg-chrome-surface-alt px-2.5 py-1.5 text-xs font-semibold text-chrome-text-muted transition hover:bg-chrome-border"
              >
                <IconLogout />
                Sair
              </button>
            </div>
          )}
        </div>
      </header>

      {fsAccessSupported === false && (
        <p className="bg-amber-100 px-4 py-2 text-xs text-amber-900">
          Este navegador não suporta File System Access (funciona no Chrome/Edge) — os vínculos de peça não
          sobrevivem a um recarregamento da página; será preciso religar cada peça sempre que a montagem for reaberta.
        </p>
      )}
      {noticeMessage && <p className="bg-primary-100 px-4 py-2 text-sm text-primary-800">{noticeMessage}</p>}
      {errorMessage && <p className="bg-error/10 px-4 py-2 text-sm text-error">{errorMessage}</p>}
      {solverWarning && <p className="bg-amber-100 px-4 py-2 text-sm text-amber-900">{solverWarning}</p>}

      {constraintDraft && (
        <ConstraintDialog
          instanceALabel={labelFor(constraintDraft.instanceA)}
          instanceBLabel={labelFor(constraintDraft.instanceB)}
          frameA={constraintDraft.frameA}
          frameB={constraintDraft.frameB}
          offset={constraintDraft.offset}
          flip={constraintDraft.flip}
          angle={constraintDraft.angle}
          lockDistance={constraintDraft.lockDistance}
          lockAngle={constraintDraft.lockAngle}
          onOffsetChange={(offset) => setConstraintDraft((d) => (d ? { ...d, offset } : d))}
          onFlipChange={(flip) => setConstraintDraft((d) => (d ? { ...d, flip } : d))}
          onAngleChange={(angle) => setConstraintDraft((d) => (d ? { ...d, angle } : d))}
          onLockDistanceChange={(lockDistance) => setConstraintDraft((d) => (d ? { ...d, lockDistance } : d))}
          onLockAngleChange={(lockAngle) => setConstraintDraft((d) => (d ? { ...d, lockAngle } : d))}
          onConfirm={handleConfirmConstraint}
          onCancel={() => setConstraintDraft(null)}
        />
      )}

      {mode === "desenho" ? (
        <DrawingSheetWorkspace useStore={useAssemblyDrawingStore} source={assemblySheetSource} />
      ) : (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div className="min-h-0 flex-1 md:order-1">
          <AssemblyViewer3D
            bodies={bodies}
            pickMode={constraintMode}
            pickModeHint={
              pendingFace
                ? `1ª referência: ${describeFrameKind(pendingFace.frame)} — clique numa face de OUTRA peça para a 2ª`
                : "Clique numa face, furo ou eixo redondo para a 1ª referência da restrição"
            }
            onPickFace={handlePickFace}
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={setSelectedInstanceId}
            draggableInstanceId={draggableInstanceId}
            onDragInstance={handleDragInstance}
            pickMarkers={pickMarkers}
            onEditInstance={handleEditInstance}
          />
        </div>
        <div className="min-h-0 w-full shrink-0 md:order-2 md:w-72" style={{ flex: "0 0 auto" }}>
          <AssemblyTree
            instances={instances}
            constraints={constraints}
            linkStatus={linkStatus}
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={setSelectedInstanceId}
            onToggleVisible={(id) => updateInstance(id, { visible: !instances.find((i) => i.id === id)?.visible })}
            onToggleGrounded={(id) => updateInstance(id, { grounded: !instances.find((i) => i.id === id)?.grounded })}
            onToggleSuppressed={(id) => updateInstance(id, { suppressed: !instances.find((i) => i.id === id)?.suppressed })}
            onRemoveInstance={(id) => {
              removeInstance(id);
              if (selectedInstanceId === id) setSelectedInstanceId(null);
            }}
            onRelinkInstance={handleRelinkInstance}
            onRemoveConstraint={removeConstraint}
            onInsertPart={handleInsertPart}
            onStartConstraint={handleStartConstraint}
            onEditInstance={handleEditInstance}
            constraintPickCount={pendingFace ? 1 : 0}
          />
          {constraintMode && (
            <div className="border-t border-primary-100 bg-white p-2 text-right">
              <button
                type="button"
                onClick={handleCancelConstraint}
                className="rounded-lg bg-primary-100 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-200"
              >
                Cancelar Restrição
              </button>
            </div>
          )}
        </div>
      </div>
      )}

      {propertiesOpen && (
        <AssemblyPropertiesDialog onMeasure={handleMeasureAssembly} onClose={() => setPropertiesOpen(false)} />
      )}
    </div>
  );
}

// Propriedades físicas da montagem — ao estilo da aba Physical das
// iProperties de um .iam do Inventor: massa total, volume total e o
// detalhamento por componente (qtd × massa unitária). Nada é calculado ao
// abrir: só no "Atualizar", igual o botão Update de lá.
function AssemblyPropertiesDialog({
  onMeasure,
  onClose,
}: {
  onMeasure: () => AssemblyPhysicalProperties;
  onClose: () => void;
}) {
  const [physical, setPhysical] = useState<AssemblyPhysicalProperties | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [measureError, setMeasureError] = useState<string | null>(null);
  // Unidade só de apresentação — o volume medido é sempre em mm³ (ver
  // physicalProperties.ts), trocar aqui reformata na hora.
  const [volumeUnit, setVolumeUnit] = useState<VolumeUnit>(DEFAULT_VOLUME_UNIT);

  function handleUpdate() {
    setMeasuring(true);
    setMeasureError(null);
    try {
      setPhysical(onMeasure());
    } catch (err) {
      setMeasureError(err instanceof Error ? err.message : "Erro ao calcular a massa da montagem.");
    } finally {
      setMeasuring(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[32rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-primary-100 bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-primary-900">Propriedades da Montagem</h3>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-primary-500 hover:bg-primary-50">
            ✕
          </button>
        </div>

        <div className="mb-3 flex items-center justify-between rounded-xl border border-primary-100 bg-primary-50/50 p-3">
          <div>
            <p className="text-xs text-primary-600">Massa total</p>
            <p className="text-xl font-semibold text-primary-900">
              {physical ? formatMass(physical.totalMassKg) : "—"}
            </p>
            {physical && (
              <p className="flex items-center gap-1 text-[11px] text-primary-500">
                Volume total: {convertVolume(physical.totalVolumeMm3, volumeUnit)}
                <select
                  value={volumeUnit}
                  onChange={(e) => setVolumeUnit(e.target.value as VolumeUnit)}
                  className="rounded border border-primary-200 bg-white px-1 py-0.5 text-[11px]"
                >
                  {(Object.keys(VOLUME_UNIT_LABELS) as VolumeUnit[]).map((unit) => (
                    <option key={unit} value={unit}>
                      {VOLUME_UNIT_LABELS[unit]}
                    </option>
                  ))}
                </select>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleUpdate}
            disabled={measuring}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {measuring ? "Calculando…" : "Atualizar"}
          </button>
        </div>

        {measureError && <p className="mb-2 text-xs text-error">{measureError}</p>}

        {physical && physical.partsWithoutMass > 0 && (
          <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
            {physical.partsWithoutMass} peça(s) sem densidade ou sem vínculo resolvido não entraram no total — abra a
            peça no Modelador e preencha o material/densidade em &quot;Propriedades&quot;.
          </p>
        )}

        {physical ? (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-primary-100 text-primary-500">
                <th className="py-1 font-semibold">Componente</th>
                <th className="py-1 text-center font-semibold">Qtd</th>
                <th className="py-1 text-right font-semibold">Massa unit.</th>
                <th className="py-1 text-right font-semibold">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {physical.components.map((component) => (
                <tr key={component.label} className="border-b border-primary-50">
                  <td className="py-1 text-primary-800">{component.label}</td>
                  <td className="py-1 text-center text-primary-700">{component.quantity}</td>
                  <td className="py-1 text-right text-primary-700">{formatMass(component.unitMassKg)}</td>
                  <td className="py-1 text-right font-medium text-primary-900">{formatMass(component.subtotalMassKg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !measureError && (
            <p className="text-xs text-primary-500">
              Clique em <strong>Atualizar</strong> para somar a massa de todos os componentes, usando a densidade que
              cada peça traz no próprio arquivo.
            </p>
          )
        )}

        <div className="mt-4 text-right">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Fechar
          </button>
        </div>
      </div>
    </>
  );
}
