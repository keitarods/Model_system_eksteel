// Ícones originais, em estilo simples de traço (não são cópias dos ícones
// reais do Autodesk Inventor — esses são ativos proprietários da Autodesk).
// Só a linguagem visual é parecida: glifos geométricos minimalistas numa
// grade 20x20, mesmo espírito de barra de ferramentas CAD.

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 20 20",
  width: 16,
  height: 16,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconSelect({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 3l9 8.5-4.3 0.6 2.3 4.4-1.8 1-2.3-4.4-3 3.1z" />
    </svg>
  );
}

export function IconLine({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <line x1="4" y1="16" x2="16" y2="4" />
      <circle cx="4" cy="16" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="4" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCenterline({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <line x1="4" y1="16" x2="16" y2="4" strokeDasharray="4 1.4 0.8 1.4" />
    </svg>
  );
}

export function IconRect({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="5.5" width="13" height="9" />
    </svg>
  );
}

export function IconCircle({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="10" cy="10" r="6.8" />
    </svg>
  );
}

export function IconMeasure({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <line x1="4" y1="5" x2="4" y2="15" />
      <line x1="16" y1="5" x2="16" y2="15" />
      <line x1="4" y1="10" x2="16" y2="10" />
    </svg>
  );
}

export function IconDimension({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <line x1="4" y1="10" x2="16" y2="10" />
      <path d="M4 10l2.6-2M4 10l2.6 2" />
      <path d="M16 10l-2.6-2M16 10l-2.6 2" />
    </svg>
  );
}

export function IconExtrude({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="10.5" width="8.5" height="6" />
      <path d="M8.2 10V3" />
      <path d="M5.6 5.6L8.2 3l2.6 2.6" />
    </svg>
  );
}

export function IconRevolve({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <line x1="10" y1="2" x2="10" y2="18" strokeDasharray="3 1.4" />
      <path d="M6.5 5.5a5.2 5.2 0 1 0 0 9" />
      <polygon points="6.5,3.7 6.5,7.3 9.4,5.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconHole({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="10" cy="10" r="6.8" />
      <circle cx="10" cy="10" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSplit({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.2" y="3.2" width="13.6" height="13.6" />
      <line x1="3.2" y1="16.8" x2="16.8" y2="3.2" strokeDasharray="2 1.4" />
    </svg>
  );
}

export function IconSketch({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.2 15.8l0.9-3.8l8.4-8.4l2.9 2.9l-8.4 8.4z" />
      <path d="M12 4.9l2.9 2.9" />
    </svg>
  );
}

export function IconFinish({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 10.3l4 4l8-9" />
    </svg>
  );
}

export function IconPoint({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <line x1="10" y1="3" x2="10" y2="6.2" />
      <line x1="10" y1="13.8" x2="10" y2="17" />
      <line x1="3" y1="10" x2="6.2" y2="10" />
      <line x1="13.8" y1="10" x2="17" y2="10" />
    </svg>
  );
}

export function IconJoinPoints({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="4.5" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="14" r="1.5" fill="currentColor" stroke="none" />
      <path d="M4.5 6l11 8" strokeDasharray="2.2 1.6" />
      <path d="M9 4l2-2l2 2M11 2v5" />
    </svg>
  );
}

export function IconHorizontal({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <line x1="3" y1="10" x2="17" y2="10" />
      <circle cx="3" cy="10" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="17" cy="10" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconVertical({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <line x1="10" y1="3" x2="10" y2="17" />
      <circle cx="10" cy="3" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="10" cy="17" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPerpendicular({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <line x1="3" y1="14" x2="14" y2="14" />
      <line x1="6" y1="17" x2="6" y2="3" />
      <path d="M6 14h2.5v2.5H6" />
    </svg>
  );
}

export function IconTangent({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="8" cy="12" r="5" />
      <line x1="3.5" y1="4.5" x2="17" y2="9.5" />
    </svg>
  );
}

export function IconFillet({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 15V9a5 5 0 0 1 5-5h6" />
    </svg>
  );
}

export function IconChamfer({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 15V7l3-3h9" />
    </svg>
  );
}

export function IconUndo({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7 5.5L3 9.5l4 4" />
      <path d="M3 9.5h9.5a5 5 0 0 1 0 10H11" />
    </svg>
  );
}

export function IconRedo({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M13 5.5l4 4l-4 4" />
      <path d="M17 9.5H7.5a5 5 0 0 0 0 10H9" />
    </svg>
  );
}

export function IconLogout({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 3H4.5a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 4.5 17H8" />
      <path d="M13 14l4-4-4-4" />
      <path d="M17 10H7.5" />
    </svg>
  );
}

// Rasgo oblongado (stadium) — mesmo glifo base pras duas variantes, só o
// marcador de ponto muda: um em cada centro (centro a centro) vs. um só no
// meio (ponto central, espelha pro outro lado).
export function IconSlotCenterToCenter({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7 5.5a4.5 4.5 0 1 0 0 9h6a4.5 4.5 0 1 0 0-9z" />
      <circle cx="7" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="13" cy="10" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSlotCenterPoint({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7 5.5a4.5 4.5 0 1 0 0 9h6a4.5 4.5 0 1 0 0-9z" />
      <circle cx="10" cy="10" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
