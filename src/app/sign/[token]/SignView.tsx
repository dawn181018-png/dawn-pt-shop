"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import { Check, Printer } from "lucide-react";
import { CONTRACT_SECTIONS } from "@/lib/contract";
import { PAYMENT_LABELS, type SaleProductSnapshot, type SignViewData } from "@/lib/pendingSale";
import { signPendingSale } from "./actions";
import "@/components/ptm.css";

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
function Receipt({ customerName, product, signedAt }: { customerName: string; product: SaleProductSnapshot; signedAt: string | null }) {
  return (
    <div className="ptm-sign-card ptm-sign-receipt">
      <div className="ptm-sign-receipt-head">
        <div className="ptm-eyebrow">Dawn Fitness</div>
        <div className="ptm-sign-title">결제 확인서</div>
        {signedAt && <div className="ptm-sign-muted">계약 서명일시 {koDateTime(signedAt)}</div>}
      </div>
      <SaleSummary customerName={customerName} product={product} />
      <div className="ptm-sign-muted" style={{ marginTop: 14 }}>
        본 확인서는 DAWN FITNESS 개인 트레이닝 계약 및 결제 내역을 확인하기 위한 문서이며, 세금계산서나 현금영수증을 대신하지 않습니다.
      </div>
      <button className="ptm-save-btn ptm-sign-no-print" onClick={() => window.print()}>
        <Printer size={15} /> 인쇄 / PDF 저장
      </button>
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

  // 상품판매 화면의 현장 서명과 같은 방식(signature_pad)으로 서명을 받는다.
  useEffect(() => {
    if (view.state !== "pending" || !agreed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = new SignaturePad(canvas, { backgroundColor: "rgb(255,255,255)" });
    padRef.current = pad;
    pad.addEventListener("endStroke", () => setIsEmpty(pad.isEmpty()));
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      canvas.getContext("2d")?.scale(ratio, ratio);
      pad.clear();
      setIsEmpty(true);
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
        <label className="ptm-contract-agree">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={saving} />
          위 내용을 모두 확인하고 숙지하였습니다
        </label>

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
