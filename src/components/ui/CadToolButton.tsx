"use client";

import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";

const APPLICATIONS: Record<string, string> = {
  Selecionar: "Selecione a geometria do esboço para consultar ou modificar seus elementos.",
  "Linha de Centro": "Crie uma referência de construção, por exemplo o eixo de uma revolução.",
  "Spline cúbica": "Crie um contorno curvo usando os pontos de controle do esboço.",
  "Arco (3 pontos)": "Defina um arco por três pontos para compor um perfil curvo.",
  Aparar: "Remova trechos excedentes no encontro entre geometrias do esboço.",
  Estender: "Prolongue uma linha até encontrar outra geometria.",
  Polígono: "Informe o número de lados e desenhe do centro até um vértice.",
  Ponto: "Adicione um ponto de referência no plano do esboço.",
  Coincidente: "Una pontos ou posicione um ponto sobre uma linha para fechar um contorno.",
  Horizontal: "Alinhe uma linha na direção horizontal do plano do esboço.",
  Vertical: "Alinhe uma linha na direção vertical do plano do esboço.",
  Paralelo: "Mantenha duas linhas na mesma direção.",
  Perpendicular: "Faça duas linhas formarem um ângulo reto.",
  Tangente: "Ajuste o encontro de geometrias para que compartilhem a direção tangente.",
  Concêntrico: "Alinhe os centros de círculos, por exemplo para desenhar anéis.",
  Simétrico: "Organize a geometria simetricamente em relação a uma referência.",
  "Cota angular": "Controle o ângulo entre linhas do esboço.",
  "Rasgo (centro a centro)": "Defina os dois centros e depois a largura do rasgo oblongo.",
  "Rasgo (ponto central)": "Defina o ponto médio, uma extremidade e a largura do rasgo.",
  "Projetar Geometria": "Traga referências do sólido para construir o esboço sobre a peça.",
  Esboço: "Escolha um plano ou uma face para desenhar o perfil da próxima operação.",
  Face: "Crie ou recorte uma região com a espessura definida para a chapa.",
  Espiral: "Crie uma varredura helicoidal para modelar molas e formas espirais.",
  "Ver Dobrada": "Volte à visualização tridimensional da chapa dobrada.",
  "Virar Chapa": "Configure o sólido como chapa e defina seus parâmetros de espessura.",
  "Cortar Plano": "Divida o sólido usando um plano de referência.",
  Arredondar: "Selecione arestas do sólido e informe um raio para suavizar seus cantos.",
  Chanfrar: "Selecione arestas do sólido e defina a distância do chanfro.",
  Retangular: "Repita a geometria em direções lineares com quantidade e espaçamento definidos.",
  Circular: "Distribua cópias da geometria ao redor de um eixo.",
  Plano: "Crie uma referência de trabalho para posicionar esboços e operações.",
  Eixo: "Crie uma referência axial para operações de rotação e padrões.",
  Extrudar: "Dê profundidade a um perfil fechado para criar uma base, ressalto ou corte.",
  Revolucionar: "Gire um perfil em torno de uma linha de centro para criar peças de revolução.",
  Furo: "Use círculos do esboço para definir furos no sólido.",
  Varredura: "Conduza um perfil ao longo de um caminho para criar tubos e seções contínuas.",
  Loft: "Una seções de esboços para criar uma transição entre perfis.",
  "Casca (Shell)": "Esvazie um sólido com espessura definida e uma face de abertura.",
  Linha: "Desenhe segmentos para construir o contorno de uma peça.",
  Círculo: "Defina um centro e um raio para desenhar perfis circulares.",
  Retângulo: "Desenhe uma base retangular a partir de dois cantos opostos.",
  Cota: "Defina medidas precisas para controlar o tamanho do esboço.",
  Medir: "Confira distâncias na geometria antes de continuar a modelagem.",
  Chanfro: "Substitua um canto por um segmento inclinado.",
  Concordância: "Arredonde um encontro de segmentos usando o raio informado.",
  Flange: "Crie uma aba dobrada a partir de uma aresta da chapa.",
  Planificar: "Visualize a chapa aberta para conferir o desenvolvimento.",
};

/** Tooltip portaled outside scrolling ribbons; focus and Escape also work without a mouse. */
export function CadToolButton({ icon: Icon, label, title, description, shortcut, disabled, active, onClick }: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  title?: string;
  description?: string;
  shortcut?: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  function close() {
    if (timer.current) clearTimeout(timer.current);
    setPosition(null);
  }
  function show(delay: number) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)), top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 300)) });
    }, delay);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!position) return;
    const dismiss = () => { if (timer.current) clearTimeout(timer.current); setPosition(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("keydown", key);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss, true); };
  }, [position]);
  const explanation = description || APPLICATIONS[label] || title || `Ative ${label.toLowerCase()} e siga as instruções na barra de ferramentas.`;
  return <span ref={anchor} className="inline-flex shrink-0" onMouseEnter={() => show(450)} onMouseLeave={close} onFocus={() => show(0)} onBlur={close}
    tabIndex={disabled ? 0 : undefined} aria-label={disabled ? `${label} — indisponível` : undefined} aria-describedby={disabled && position ? id : undefined}>
    <button type="button" aria-label={label} aria-describedby={position ? id : undefined} aria-pressed={active} disabled={disabled}
      onClick={() => { close(); onClick(); }}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 ${active ? "bg-primary text-primary-foreground" : "bg-white text-primary-700 hover:bg-primary-100"}`}>
      {Icon ? <Icon className="h-5 w-5 shrink-0" /> : <span className="text-xs font-semibold">{label.slice(0, 2)}</span>}
    </button>
    {position && createPortal(<div id={id} role="tooltip" style={position} className="pointer-events-none fixed z-[200] w-72 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-hidden rounded-lg border border-primary-200 bg-white p-3 text-primary-900 shadow-xl">
      <div className="flex items-center justify-between gap-2 text-sm font-semibold"><span>{label}</span>{shortcut && <kbd className="rounded border px-1.5 text-xs">{shortcut}</kbd>}</div>
      {Icon && <div aria-hidden="true" className="my-2 flex h-20 items-center justify-center rounded bg-primary-50 text-primary-600"><Icon className="h-16 w-16" /></div>}
      <p className="text-xs leading-relaxed">{explanation}</p>
      {title && title !== label && title !== explanation && <p className="mt-2 text-xs leading-relaxed text-primary-600">{title}</p>}
      {disabled && <p className="mt-2 text-xs font-semibold">Indisponível na seleção atual.</p>}
    </div>, document.body)}
  </span>;
}
