// 대리 레슨 DB 함수(proxy_*)가 던진 에러를 화면용 문구로 바꾼다. 브라우저/서버 양쪽에서 쓰는 순수 함수.
// not_delegated는 권한 없음/기간 종료/해제를 뜻한다.
export const proxyErrorMessage = (message: string): string =>
  message.includes("not_delegated") || message.includes("not_authenticated")
    ? "대리 권한이 없거나 기간이 끝났어요. 담당 트레이너에게 문의해주세요"
    : message || "처리 실패, 다시 시도해주세요";
