"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import SignaturePad from "signature_pad";
import { Check, Printer, Copy } from "lucide-react";
import { CONTRACT_SECTIONS } from "@/lib/contract";
import { PAYMENT_LABELS, BANK_ACCOUNT, type SaleProductSnapshot, type SignViewData } from "@/lib/pendingSale";
import { signPendingSale } from "./actions";
import "@/components/ptm.css";

// 서버에서 그려진 HTML이 먼저 보이고 화면 동작(자바스크립트)은 조금 뒤에 붙는데, 느린 휴대폰 통신에서 그 사이에
// 확인 체크를 누르면 체크 표시만 되고 서명 칸은 안 나타난다. 동작이 붙은 뒤에만 체크 칸을 보여준다.
const noopSubscribe = () => () => {};
const useIsHydrated = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

const won = (n: number) => `${Number(n || 0).toLocaleString()}원`;
const koDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const usageLabel = (p: SaleProductSnapshot) =>
  p.type === "session" ? `${p.totalSessions}회 (1회 ${p.sessionDuration}분)` : `${p.startDate} ~ ${p.endDate || "-"}`;

function SaleSummary({ customerName, product }: { customerName: string; product: SaleProductSnapshot }) {
  const unpaid = Number(product.price) - Number(product.paidAmount);
  const discount = Number(product.listPrice) - Number(product.price);
  return (
    <div className="ptm-sign-summary">
      <div className="ptm-sign-row"><span>회원명</span><b>{customerName}</b></div>
      <div className="ptm-sign-row"><span>상품명</span><b>{product.name}</b></div>
      <div className="ptm-sign-row"><span>{product.type === "session" ? "횟수" : "이용기간"}</span><b>{usageLabel(product)}</b></div>
      {discount > 0 && <div className="ptm-sign-row"><span>정가</span><span>{won(product.listPrice)}</span></div>}
      <div className="ptm-sign-row"><span>판매가</span><b>{won(product.price)}</b></div>
      <div className="ptm-sign-row"><span>결제수단</span><span>{PAYMENT_LABELS[product.paymentMethod] || product.paymentMethod}</span></div>
      <div className="ptm-sign-row"><span>결제금액</span><b>{won(product.paidAmount)}</b></div>
      {unpaid > 0 && <div className="ptm-sign-row" style={{ color: "var(--coral)" }}><span>미결제 잔액</span><b>{won(unpaid)}</b></div>}
    </div>
  );
}

// 서명 완료 후 보여주는 결제 확인서. 인쇄(또는 인쇄 창에서 "PDF로 저장")할 수 있다.
// 고객이 링크를 연 환경. 카카오톡 등 앱 안의 내장 브라우저는 인쇄(window.print)를 막아둔 경우가 많아
// 버튼을 눌러도 반응이 없으므로, 그때는 "다른 브라우저로 열기"부터 안내한다. 서버 렌더링 땐 알 수 없어 "unknown".
type ViewerEnv = "kakao" | "inapp" | "ios" | "android" | "other" | "unknown";
const detectViewerEnv = (): ViewerEnv => {
  const ua = navigator.userAgent;
  if (/KAKAOTALK/i.test(ua)) return "kakao";
  if (/NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(ua)) return "inapp";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
};
const useViewerEnv = (): ViewerEnv => useSyncExternalStore(noopSubscribe, detectViewerEnv, () => "unknown");

function ReceiptSaveGuide() {
  const env = useViewerEnv();
  const iosGuide = (
    <div className="ptm-sign-guide-item">
      <b>아이폰</b>
      <ol>
        <li>위 <b>인쇄 / PDF 저장</b> 버튼을 눌러요</li>
        <li>인쇄 화면 위쪽(또는 아래쪽)의 <b>공유 버튼</b>(네모에 위쪽 화살표)을 눌러요</li>
        <li><b>파일에 저장</b>을 누르면 PDF로 저장돼요 (사진으로 남기려면 화면 캡처도 괜찮아요)</li>
      </ol>
    </div>
  );
  const androidGuide = (
    <div className="ptm-sign-guide-item">
      <b>안드로이드 (갤럭시 등)</b>
      <ol>
        <li>위 <b>인쇄 / PDF 저장</b> 버튼을 눌러요</li>
        <li>맨 위 프린터 선택을 눌러 <b>PDF로 저장</b>으로 바꿔요</li>
        <li><b>PDF</b>(다운로드) 버튼을 누르면 저장돼요 (사진으로 남기려면 화면 캡처도 괜찮아요)</li>
      </ol>
    </div>
  );
  return (
    <div className="ptm-sign-guide ptm-sign-no-print">
      <div className="ptm-sign-guide-title">결제 확인서 저장 방법</div>
      {(env === "kakao" || env === "inapp") && (
        <div className="ptm-sign-guide-warn">
          {env === "kakao" ? "카카오톡" : "앱"} 안에서 열린 화면에서는 인쇄/PDF 저장이 안 될 수 있어요.
          오른쪽 위(또는 아래)의 <b>⋯ 메뉴</b>에서 <b>다른 브라우저로 열기</b>(아이폰은 Safari, 안드로이드는 Chrome)를 누른 뒤
          아래 방법대로 저장해주세요. 서명은 이미 완료됐으니 다시 열어도 확인서만 보여요.
        </div>
      )}
      {env === "android" ? <>{androidGuide}{iosGuide}</> : <>{iosGuide}{androidGuide}</>}
    </div>
  );
}

// 결제수단이 계좌이체인 건의 결제 확인서에만 입금 계좌를 보여준다(인쇄/PDF에도 포함). 복사 버튼은 화면에서만.
function BankAccountBox({ unpaid }: { unpaid: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(BANK_ACCOUNT.number); setCopied(true); } catch { /* 길게 눌러 복사 */ }
  };
  return (
    <div className="ptm-sign-bank">
      <div className="ptm-sign-bank-title">계좌이체 안내</div>
      <div className="ptm-sign-row"><span>은행</span><b>{BANK_ACCOUNT.bank}</b></div>
      <div className="ptm-sign-row"><span>계좌번호</span><b className="ptm-sign-bank-number">{BANK_ACCOUNT.number}</b></div>
      <div className="ptm-sign-row"><span>예금주</span><b>{BANK_ACCOUNT.holder}</b></div>
      {unpaid > 0 && <div className="ptm-sign-muted" style={{ marginTop: 8 }}>남은 금액 {won(unpaid)}을 위 계좌로 입금해주세요.</div>}
      <div className="ptm-sign-muted" style={{ marginTop: 6 }}>입금자명은 회원님 성함으로 해주세요.</div>
      <button className="ptm-res-btn ptm-sign-no-print ptm-sign-bank-copy" onClick={copy}>
        <Copy size={13} /> {copied ? "계좌번호 복사됨" : "계좌번호 복사"}
      </button>
    </div>
  );
}

function Receipt({ customerName, product, signedAt }: { customerName: string; product: SaleProductSnapshot; signedAt: string | null }) {
  return (
    <div className="ptm-sign-card ptm-sign-receipt">
      <div className="ptm-sign-receipt-head">
        <div className="ptm-eyebrow">Dawn Fitness</div>
        <div className="ptm-sign-title">결제 확인서</div>
        {signedAt && <div className="ptm-sign-muted">계약 서명일시 {koDateTime(signedAt)}</div>}
      </div>
      <SaleSummary customerName={customerName} product={product} />
      {product.paymentMethod === "transfer" && <BankAccountBox unpaid={Math.max(0, Number(product.price) - Number(product.paidAmount))} />}
      <div className="ptm-sign-muted" style={{ marginTop: 14 }}>
        본 확인서는 DAWN FITNESS 개인 트레이닝 계약 및 결제 내역을 확인하기 위한 문서이며, 세금계산서나 현금영수증을 대신하지 않습니다.
      </div>
      <button className="ptm-save-btn ptm-sign-no-print" onClick={() => window.print()}>
        <Printer size={15} /> 인쇄 / PDF 저장
      </button>
      <ReceiptSaveGuide />
    </div>
  );
}

export default function SignView({ token, initialView }: { token: string; initialView: SignViewData }) {
  const [view, setView] = useState<SignViewData>(initialView);
  const [agreed, setAgreed] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const hydrated = useIsHydrated();

  // 상품판매 화면의 현장 서명과 같은 방식(signature_pad)으로 서명을 받는다.
  useEffect(() => {
    if (view.state !== "pending" || !agreed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = new SignaturePad(canvas, { backgroundColor: "rgb(255,255,255)" });
    padRef.current = pad;
    pad.addEventListener("endStroke", () => setIsEmpty(pad.isEmpty()));
    // 휴대폰에서는 스크롤하거나 화면을 누를 때 주소창이 나타났다 사라지면서 브라우저가 "resize"를 계속
    // 보내는데, 그때마다 캔버스를 초기화하면 방금 그은 서명이 바로 지워져 "터치가 안 되는" 것처럼 보인다.
    // 그래서 캔버스 폭이 실제로 바뀐 경우(화면 회전 등)에만 다시 맞추고, 이미 그린 서명은 그대로 복원한다.
    let lastWidth = -1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (Math.round(rect.width) === lastWidth) return;
      lastWidth = Math.round(rect.width);
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const strokes = pad.toData();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      canvas.getContext("2d")?.scale(ratio, ratio);
      pad.clear();
      if (strokes.length > 0) pad.fromData(strokes);
      setIsEmpty(pad.isEmpty());
    };
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      pad.off();
    };
  }, [view.state, agreed]);

  const clearSignature = () => { padRef.current?.clear(); setIsEmpty(true); };

  const submit = async () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty() || saving) return;
    setSaving(true);
    setError("");
    const result = await signPendingSale(token, pad.toDataURL("image/png"));
    if (result.ok) setView(result.view);
    else setError(result.error);
    setSaving(false);
  };

  if (view.state === "invalid" || view.state === "cancelled" || view.state === "expired" || view.state === "unavailable") {
    const message = {
      invalid: "유효하지 않은 링크예요.",
      cancelled: "취소된 링크예요.",
      expired: "링크 유효기간(7일)이 지났어요.",
      unavailable: "지금은 계약서를 불러올 수 없어요.",
    }[view.state];
    const hint = view.state === "unavailable" ? "잠시 후 링크를 다시 열어주세요." : "담당 트레이너에게 새 링크를 요청해주세요.";
    return (
      <div className="ptm-root ptm-sign-root">
        <div className="ptm-sign-card" style={{ textAlign: "center" }}>
          <div className="ptm-eyebrow">Dawn Fitness</div>
          <div className="ptm-sign-title">{message}</div>
          <div className="ptm-sign-muted">{hint}</div>
        </div>
      </div>
    );
  }

  if (view.state === "signed") {
    return (
      <div className="ptm-root ptm-sign-root">
        <div className="ptm-sign-card ptm-sign-no-print" style={{ textAlign: "center" }}>
          <div className="ptm-sign-done-icon"><Check size={22} /></div>
          <div className="ptm-sign-title">서명이 완료되어 등록이 확정됐어요</div>
          <div className="ptm-sign-muted">아래 결제 확인서를 저장해두실 수 있어요.</div>
        </div>
        <Receipt customerName={view.customerName} product={view.product} signedAt={view.signedAt} />
      </div>
    );
  }

  return (
    <div className="ptm-root ptm-sign-root">
      <div className="ptm-sign-card">
        <div className="ptm-eyebrow">Dawn Fitness</div>
        <div className="ptm-sign-title">개인 트레이닝 계약서</div>
        <div className="ptm-sign-muted">아래 등록 내용과 계약 조항을 확인한 뒤 서명해주세요.</div>
        <SaleSummary customerName={view.customerName} product={view.product} />
      </div>

      <div className="ptm-sign-card">
        <div className="ptm-sale-card-title">DAWN FITNESS 개인 트레이닝 계약서</div>
        <div className="ptm-contract-box ptm-sign-contract">
          {CONTRACT_SECTIONS.map((s, i) => (
            <div key={i} className="ptm-contract-section">
              <div className="ptm-contract-section-title">{s.title}</div>
              <div className="ptm-contract-section-body">{s.body}</div>
            </div>
          ))}
        </div>
        {hydrated ? (
          <label className="ptm-contract-agree">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={saving} />
            위 내용을 모두 확인하고 숙지하였습니다
          </label>
        ) : (
          <div className="ptm-sign-muted" style={{ padding: "10px 2px" }}>서명 화면을 준비하고 있어요...</div>
        )}

        {agreed && (
          <>
            <div className="ptm-signature-hint">아래 영역에 서명해주세요</div>
            <div className="ptm-signature-canvas-wrap">
              <canvas ref={canvasRef} className="ptm-signature-canvas" />
            </div>
            <div className="ptm-signature-actions">
              <button className="ptm-res-btn" onClick={clearSignature} disabled={saving}>지우기</button>
              <button className="ptm-save-btn" style={{ marginTop: 0 }} onClick={submit} disabled={isEmpty || saving}>
                {saving ? "저장 중..." : <><Check size={15} /> 서명 완료</>}
              </button>
            </div>
          </>
        )}
        {error && <div className="ptm-unpaid-note" style={{ marginTop: 10 }}>{error}</div>}
        <div className="ptm-sign-muted" style={{ marginTop: 10 }}>링크 유효기간: {koDateTime(view.expiresAt)}까지</div>
      </div>
    </div>
  );
}
