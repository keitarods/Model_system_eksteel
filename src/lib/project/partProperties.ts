// "iProperties" da peça, ao estilo Inventor: dados que descrevem a peça mas
// não são geometria (código, descrição, material/densidade, responsáveis).
// Ficam salvos DENTRO do .eks3d (ver nativeFormat.ts), pra que uma montagem
// que referencie essa peça consiga montar a Lista de Peças (BOM) lendo o
// próprio arquivo dela — do mesmo jeito que o Inventor lê as iProperties do
// .ipt pra preencher a Parts List do .idw.
//
// A densidade mora aqui (não numa tabela global de materiais) porque é dela
// que sai a MASSA na BOM: massa = volume do sólido × densidade. Guardar o
// número junto da peça deixa a conta reprodutível mesmo que a tabela de
// materiais do app mude depois.

export type PartProperties = {
  // Código/nº da peça — a coluna "Nº DA PEÇA" da lista. Vazio = a lista
  // cai pro nome do arquivo (ver bom.ts).
  partNumber: string;
  description: string;
  material: string;
  // kg/m³. 0 = desconhecida — a coluna de massa mostra "—" em vez de 0.
  density: number;
  designer: string;
  // Engenheiro responsável (quem assina/aprova tecnicamente) — separado do
  // desenhista de propósito, igual o Inventor separa "Designer" de
  // "Engineer".
  engineer: string;
  vendor: string;
  notes: string;
};

// Densidades em kg/m³ dos materiais mais comuns numa serralheria/estrutura
// metálica — só um atalho pra preencher o campo, o valor continua editável
// à mão depois de escolher (ligas variam, e cada projeto pode ter a sua
// referência).
export const MATERIAL_PRESETS: { name: string; density: number }[] = [
  { name: "Aço carbono (ASTM A36)", density: 7850 },
  { name: "Aço carbono (SAE 1020)", density: 7870 },
  { name: "Aço inoxidável (AISI 304)", density: 7900 },
  { name: "Aço inoxidável (AISI 316)", density: 8000 },
  { name: "Alumínio (6061)", density: 2700 },
  { name: "Alumínio (5052)", density: 2680 },
  { name: "Cobre", density: 8960 },
  { name: "Latão", density: 8500 },
  { name: "Ferro fundido", density: 7200 },
  { name: "Polietileno (PEAD)", density: 950 },
  { name: "Nylon (PA6)", density: 1140 },
];

export function createEmptyPartProperties(): PartProperties {
  return {
    partNumber: "",
    description: "",
    material: "",
    // Aço carbono como padrão — é o material esmagadoramente mais comum no
    // uso da Eksteel, e uma massa aproximada por padrão é mais útil numa
    // lista de peças do que um "—" que todo mundo teria que preencher.
    density: 7850,
    designer: "",
    engineer: "",
    vendor: "",
    notes: "",
  };
}

// Normaliza o que veio de um arquivo salvo — arquivos anteriores a essas
// propriedades existirem simplesmente não têm o campo, e cada campo solto
// pode faltar num arquivo salvo por uma versão intermediária. Sempre
// devolve um objeto completo, nunca undefined, pra ninguém precisar tratar
// isso caso a caso.
export function normalizePartProperties(raw: unknown): PartProperties {
  const base = createEmptyPartProperties();
  if (!raw || typeof raw !== "object") return base;
  const source = raw as Partial<PartProperties>;
  return {
    partNumber: typeof source.partNumber === "string" ? source.partNumber : base.partNumber,
    description: typeof source.description === "string" ? source.description : base.description,
    material: typeof source.material === "string" ? source.material : base.material,
    density: typeof source.density === "number" && Number.isFinite(source.density) ? source.density : base.density,
    designer: typeof source.designer === "string" ? source.designer : base.designer,
    engineer: typeof source.engineer === "string" ? source.engineer : base.engineer,
    vendor: typeof source.vendor === "string" ? source.vendor : base.vendor,
    notes: typeof source.notes === "string" ? source.notes : base.notes,
  };
}
