// Fórmula de cota ao estilo Inventor/Excel — só as 4 operações + parênteses
// + referências a OUTRAS cotas por paramName (d1, d2, d3...), ver
// paramName/formula em types.ts. Parser recursivo-descendente escrito à
// mão de propósito (sem eval()/Function()): o texto vem direto do campo de
// valor de uma cota, entrada do usuário, não dá pra confiar nela.
//
//   expr   := term (('+' | '-') term)*
//   term   := factor (('*' | '/') factor)*
//   factor := NUMBER | PARAM | '(' expr ')' | ('+' | '-') factor
//   PARAM  := 'd' DIGIT+

const PARAM_PATTERN = /\bd\d+\b/gi;

// Todos os paramNames (minúsculo, sem repetir) citados numa fórmula — usado
// tanto pra saber de quem essa cota passa a DEPENDER (cascata/ciclo, ver
// cascadeFormulaDependents/wouldCreateFormulaCycle em store.ts) quanto,
// aqui dentro, pra resolver cada referência durante a avaliação.
export function extractParamNames(formula: string): string[] {
  const matches = formula.match(PARAM_PATTERN);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.toLowerCase()))];
}

// Um valor digitado só conta como fórmula de verdade se citar pelo menos
// uma referência (d1, d2...) — sem isso, "25.4" e "25,4" continuam apenas
// um número solto (comportamento de sempre), mesmo passando pelo parser
// abaixo sem erro (uma fórmula sem operadores nem referência é só o número
// em si).
export function isFormula(text: string): boolean {
  return extractParamNames(text).length > 0;
}

// Avalia a fórmula usando resolveParam pra buscar o valor ATUAL de cada
// referência citada (ver dimensionCurrentValue em store.ts) — null em
// QUALQUER problema (sintaxe inválida, parênteses desencontrados,
// referência que resolveParam não conhece, divisão por zero, resultado
// não-finito): quem chama trata como "não aplica a edição", mesma postura
// de sempre desse app pra entrada inválida (ver updateDimensionValue).
export function evaluateFormula(formula: string, resolveParam: (name: string) => number | null): number | null {
  const raw = formula.trim().replace(/^=/, "").trim();
  if (raw.length === 0) return null;

  let pos = 0;
  const peek = () => raw[pos] ?? "";
  const skipSpace = () => {
    while (peek() === " " || peek() === "\t") pos++;
  };

  function parseNumber(): number | null {
    const start = pos;
    let sawDigit = false;
    while (/[0-9]/.test(peek())) {
      pos++;
      sawDigit = true;
    }
    if (peek() === ".") {
      pos++;
      while (/[0-9]/.test(peek())) {
        pos++;
        sawDigit = true;
      }
    }
    if (!sawDigit) {
      pos = start;
      return null;
    }
    return Number(raw.slice(start, pos));
  }

  function parseParam(): number | null {
    const start = pos;
    if (peek().toLowerCase() !== "d") return null;
    pos++;
    const digitsStart = pos;
    while (/[0-9]/.test(peek())) pos++;
    if (pos === digitsStart) {
      pos = start;
      return null;
    }
    return resolveParam(raw.slice(start, pos).toLowerCase());
  }

  function parseFactor(): number | null {
    skipSpace();
    if (peek() === "(") {
      pos++;
      const value = parseExpr();
      skipSpace();
      if (value === null || peek() !== ")") return null;
      pos++;
      return value;
    }
    if (peek() === "-") {
      pos++;
      const value = parseFactor();
      return value === null ? null : -value;
    }
    if (peek() === "+") {
      pos++;
      return parseFactor();
    }
    if (peek().toLowerCase() === "d") return parseParam();
    return parseNumber();
  }

  function parseTerm(): number | null {
    let value = parseFactor();
    if (value === null) return null;
    for (;;) {
      skipSpace();
      const op = peek();
      if (op !== "*" && op !== "/") return value;
      pos++;
      const rhs = parseFactor();
      if (rhs === null) return null;
      if (op === "/") {
        if (Math.abs(rhs) < 1e-12) return null;
        value = value / rhs;
      } else {
        value = value * rhs;
      }
    }
  }

  function parseExpr(): number | null {
    let value = parseTerm();
    if (value === null) return null;
    for (;;) {
      skipSpace();
      const op = peek();
      if (op !== "+" && op !== "-") return value;
      pos++;
      const rhs = parseTerm();
      if (rhs === null) return null;
      value = op === "+" ? value + rhs : value - rhs;
    }
  }

  const result = parseExpr();
  skipSpace();
  if (result === null || pos !== raw.length || !Number.isFinite(result)) return null;
  return result;
}
