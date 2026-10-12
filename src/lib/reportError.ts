// 화면에서 생긴 중요한 오류(저장 실패, 불러오기 실패, 화면 오류)를 서버에 알린다(/api/report-error).
// 결과를 기다리지 않고 조용히 보내며, 같은 문구는 이 기기에서 5분에 한 번만 보낸다(같은 버튼 연타 등 중복 방지).

const recent = new Map<string, number>();

export function reportError(where: string, message: string) {
  try {
    const key = `${where}|${message}`;
    const now = Date.now();
    if (now - (recent.get(key) ?? 0) < 5 * 60 * 1000) return;
    recent.set(key, now);
    fetch("/api/report-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ where, message, page: typeof location !== "undefined" ? location.pathname : "" }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // 알림 자체가 실패해도 앱 사용에는 영향이 없게 한다.
  }
}
