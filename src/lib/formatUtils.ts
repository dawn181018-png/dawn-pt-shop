// PTMemberManager.tsx와 ProductSaleWizard.tsx에서 각자 따로 정의해 쓰던 날짜/숫자/전화번호
// 포맷 유틸을 한 곳으로 모은 것. 두 파일 모두 이 함수들을 그대로 가져다 쓴다.

// epoch/Date 절대시각을 "브라우저 로컬 기준" 날짜 문자열로 변환.
// toISOString()은 UTC 기준이라, UTC+9(한국)에서도 자정~오전 9시 사이엔 하루 전 날짜로 밀리는 버그가 있었다.
export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const today = (): string => toLocalDateStr(new Date());

export const addDays = (dateStr: string, n: number): string => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Number(n));
  return toLocalDateStr(d);
};

export const addMonths = (dateStr: string, n: number): string => {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + Number(n));
  return toLocalDateStr(d);
};

export const fmtNum = (n: unknown): string => {
  const num = Number(n);
  return isNaN(num) ? "" : num.toLocaleString("ko-KR");
};

export const parseNum = (str: unknown): number => {
  const digits = String(str).replace(/[^0-9]/g, "");
  return digits === "" ? 0 : Number(digits);
};

export const formatPhone = (v: unknown): string => {
  const digits = String(v).replace(/[^0-9]/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
};

// date 타입 컬럼에 빈 문자열("")을 그대로 보내면 Postgres가 거부하므로 null로 치환
export const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);
