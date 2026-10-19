export type BodyDiagnostic = {
  bodyId: number; bodyCount: number;
  bounds: [number, number, number, number, number, number];
  status: 'failed' | 'passed' | 'inconclusive'; message: string;
};

export function readBodyDiagnostic(value: unknown, expectedBody: number): BodyDiagnostic {
  const d = value as BodyDiagnostic | undefined;
  if (!d || d.bodyId !== expectedBody || !Number.isInteger(d.bodyCount) || d.bodyCount < expectedBody ||
      !['failed', 'passed', 'inconclusive'].includes(d.status) || typeof d.message !== 'string' || d.message.length > 500 ||
      !Array.isArray(d.bounds) || d.bounds.length !== 6 || !d.bounds.every(Number.isFinite) ||
      d.bounds.slice(0, 3).some((v, i) => v > d.bounds[i + 3])) throw new Error('Diagnóstico inválido recebido do comunicador.');
  return d;
}

export function diagnosticSummary(items: BodyDiagnostic[]): string {
  if (!items.length) return '';
  const failures = items.filter(item => item.status === 'failed').length;
  const complete = items.length === items[0].bodyCount && !items.some(item => item.status === 'inconclusive');
  if (failures) return `${failures} corpo(s) reproduziram a interseção isoladamente.${complete ? '' : ' Diagnóstico parcial.'}`;
  if (!complete) return 'Diagnóstico parcial ou inconclusivo. Ainda não é possível localizar a falha.';
  return 'Todos os corpos geraram malha isoladamente. A falha do conjunto não foi localizada; interfaces e efeitos da malha conjunta ainda precisam ser investigados.';
}
