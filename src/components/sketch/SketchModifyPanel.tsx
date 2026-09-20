"use client";
import { useEffect, useMemo, useState } from "react";
import { useSketchStore } from "@/lib/sketch/store";
import { createId } from "@/lib/sketch/render";
import { parseDxf } from "@/lib/project/dxfImport";
import { mirrorShapes, offsetShapes } from "@/lib/sketch/modify";
export function SketchModifyPanel() {
    const shapes = useSketchStore(s => s.shapes), points = useSketchStore(s => s.points);
    const selected = useSketchStore(s => s.selectedShapeId), multi = useSketchStore(s => s.multiProfileSelection);
    const tool = useSketchStore(s => s.tool), error = useSketchStore(s => s.modifyError), picks = useSketchStore(s => s.arcPoints);
    const [mode, setMode] = useState<"mirror" | "offset" | null>(null);
    const [axis, setAxis] = useState("x"), [distance, setDistance] = useState(10);
    const result = useMemo(() => {
        if (!mode)
            return null;
        try {
            const source = shapes.filter(s => multi.length ? multi.includes(s.id) : s.id === selected);
            if (!source.length)
                throw new Error("Selecione a forma ou use Ctrl+clique para selecionar o contorno.");
            if (mode === 'offset')
                return { edit: offsetShapes(source, points, distance) };
            const line = shapes.find(s => s.id === axis);
            const a = line?.type === 'line' ? points[line.p1] : { x: 0, y: 0 };
            const b = line?.type === 'line' ? points[line.p2] : axis === 'y' ? { x: 0, y: 1 } : { x: 1, y: 0 };
            return { edit: mirrorShapes(source, points, a, b) };
        }
        catch (e) {
            return { error: (e as Error).message };
        }
    }, [mode, shapes, points, selected, multi, axis, distance]);
    useEffect(() => {
        if (mode)
            useSketchStore.setState({ modifyPreview: result?.edit ?? null });
        return () => { if (mode)
            useSketchStore.setState({ modifyPreview: null }); };
    }, [mode, result]);
    useEffect(() => { if (tool !== 'select')
        setMode(null); }, [tool]);
    return <div className="flex flex-wrap items-center gap-2 text-xs [&_button]:rounded-lg [&_button]:bg-white [&_button]:px-3 [&_button]:py-1.5 [&_button]:font-semibold [&_button]:text-primary-700 [&_button:hover]:bg-primary-100 [&_button:disabled]:opacity-50">
    <label className="cursor-pointer rounded-lg bg-white px-3 py-1.5 font-semibold text-primary-700 hover:bg-primary-100">Importar DXF<input className="hidden" type="file" accept=".dxf" onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file)
                return;
            try {
                useSketchStore.getState().applySketchEdit(parseDxf(await file.text()));
            }
            catch (error) {
                useSketchStore.setState({ modifyError: (error as Error).message });
            }
        }}/></label>
    <button type="button" disabled={!shapes.some(s=>s.id===selected&&s.type==='circle')} onClick={()=>{
      const state=useSketchStore.getState();if(!selected)return;
      if(state.dimensions.some(d=>d.kind==='radius'&&d.circleId===selected)){useSketchStore.setState({modifyError:'O círculo já possui cota radial; remova-a antes de criar a cota de diâmetro.'});return;}
      state.addDimension({id:createId(),kind:'radius',circleId:selected,isDiameter:true});
    }}>Cota Ø</button>
    <button type="button" onClick={() => { useSketchStore.getState().setTool('select'); setMode('mirror'); }}>Espelhar</button>
    <button type="button" onClick={() => { useSketchStore.getState().setTool('select'); setMode('offset'); }}>Offset</button>
    {mode === 'mirror' && <label>Eixo <select aria-label="Eixo de espelhamento" value={axis} onChange={e => setAxis(e.target.value)}>
      <option value="x">X do esboço</option><option value="y">Y do esboço</option>
      {shapes.filter(s => s.type === 'line').map((s, i) => <option key={s.id} value={s.id}>Linha {i + 1}</option>)}
    </select></label>}
    {mode === 'offset' && <label>Distância (mm) <input aria-label="Distância do offset" type="number" step="0.1" value={distance} onChange={e => setDistance(Number(e.target.value))} className="w-20 border"/></label>}
    {mode && <><button type="button" disabled={!result?.edit} onClick={() => { if (result?.edit)
        useSketchStore.getState().applySketchEdit(result.edit); setMode(null); }}>Aplicar</button><button type="button" onClick={() => setMode(null)}>Cancelar</button></>}
    {tool === "angular" && <label>Ângulo anti-horário (°) <input type="number" min="0" max="359.999" step="0.1" defaultValue={useSketchStore.getState().angleValue} onChange={e=>{const degrees=Number(e.target.value);if(Number.isFinite(degrees))useSketchStore.setState({angleValue:degrees});}}/> · clique na referência e na dependente</label>}
    {tool === "symmetric" && <span>Clique no ponto de referência, no dependente e na linha de simetria · Esc cancela</span>}
    {tool === "spline" && <span>Clique: {["início", "controle 1", "controle 2", "fim"][picks.length]} · Esc cancela</span>}
    {tool === 'arc3' && <span>Clique: {picks.length === 0 ? 'início' : picks.length === 1 ? 'ponto sobre o arco' : 'fim'} · Esc cancela</span>}
    {(tool === 'trim' || tool === 'extend') && <span>{tool === 'trim' ? 'Clique no trecho da linha a remover' : 'Clique perto da extremidade a estender'} · limites: linhas/círculos</span>}
    {(result?.error || error) && <span role="status" className="text-red-700">{result?.error || error}</span>}
  </div>;
}
