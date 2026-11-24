import { securityError } from './security';
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function dateOnly(value: unknown, empty = true): boolean {
  if (empty && (value === '' || value == null)) return true;
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function patientFields(data: Record<string, unknown>, partial = false) {
  const limits: Record<string, number> = {
    name: 150,
    email: 254,
    phone: 40,
    birthDate: 10,
    status: 20,
    objective: 500,
    clinicalNotes: 5000,
  };
  if (Object.keys(data).some((k) => !Object.hasOwn(limits, k)))
    throw securityError(400, 'Campo não permitido.');
  for (const [key, value] of Object.entries(data))
    if (typeof value !== 'string' || value.length > limits[key])
      throw securityError(400, 'Revise os dados cadastrais.');
  if ((!partial || data.name !== undefined) && (typeof data.name !== 'string' || !data.name.trim()))
    throw securityError(400, 'Nome inválido.');
  if (
    data.status !== undefined &&
    !['Ativo', 'Em pausa', 'Arquivado'].includes(String(data.status))
  )
    throw securityError(400, 'Status inválido.');
  if (
    !dateOnly(data.birthDate) ||
    (data.birthDate && String(data.birthDate) > new Date().toISOString().slice(0, 10))
  )
    throw securityError(400, 'Nascimento inválido.');
  if (data.email && !/^\S+@\S+\.\S+$/.test(String(data.email)))
    throw securityError(400, 'E-mail inválido.');
}
export function pageList(collection: string, rows: unknown[], url: URL) {
  const offset = Number(url.searchParams.get('offset') || 0),
    limit = Number(url.searchParams.get('limit') || 200);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw securityError(400, 'Paginação inválida (limit1–200).');
  return {
    [collection]: rows.slice(offset, offset + limit),
    page: {
      collection,
      total: rows.length,
      nextOffset: offset + limit < rows.length ? offset + limit : null,
    },
  };
}
export function revision(plan: { revision?: number }, value: unknown) {
  if (!Number.isSafeInteger(value)) throw securityError(428, 'Informe a revisão do plano.');
  if (value !== (plan.revision || 0))
    throw securityError(409, 'O plano mudou. Recarregue antes de salvar ou publicar.');
}
