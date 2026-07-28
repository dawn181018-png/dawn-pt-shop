// Supabase(snake_case) <-> 앱 내부 상태(camelCase) 변환 유틸

export function toSnake(obj: object): Record<string, unknown> {
  const src = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    const snakeKey = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    out[snakeKey] = src[key];
  }
  return out;
}

export function toCamel<T = Record<string, unknown>>(obj: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const camelKey = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    out[camelKey] = obj[key];
  }
  return out as T;
}

// created_at(timestamptz 문자열) -> epoch ms 숫자로 변환 (기존 로직이 Date.now() 기반 숫자 비교/정렬을 사용하기 때문)
export function withEpochCreatedAt<T extends { createdAt?: unknown }>(obj: T): T {
  if (!obj.createdAt) return obj;
  return { ...obj, createdAt: new Date(obj.createdAt as string).getTime() };
}
