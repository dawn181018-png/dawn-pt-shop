// "서명 대기" 목록: 상품판매에서 링크로 고객 서명을 요청해둔 판매 건들. 상품판매 탭(전체)과
// 고객 상세 > 판매내역(그 고객 것만)에서 같은 컴포넌트를 쓴다. 각 건에서 링크 다시 복사, 금액·횟수 수정
// (새 링크 발급), 현장 서명으로 전환, 링크 취소를 할 수 있다. 실제 처리는 부모(PTMemberManager)가 한다.
"use client";

import { useState } from "react";
import { Copy, Pencil, PenLine, X, RefreshCw } from "lucide-react";
import { fmtNum, parseNum } from "@/lib/formatUtils";
import { PAYMENT_LABELS } from "@/lib/pendingSale";
import type { Customer, PaymentMethod, PendingSale } from "@/lib/types";

type PendingSalesPanelProps = {
  sales: PendingSale[];
  customers: Customer[];
  onCopyLink: (sale: PendingSale) => void;
  onEdit: (sale: PendingSale, product: PendingSale["product"]) => Promise<void>;
  onConvertToOnsite: (sale: PendingSale) => void;
  onCancel: (sale: PendingSale) => void;
  onRefresh?: () => void;
};

const isExpired = (s: PendingSale) => new Date(s.expiresAt).getTime() < Date.now();
const expiryLabel = (s: PendingSale) => {
  const d = new Date(s.expiresAt);
  return `${d.getMonth() + 1}월 ${d.getDate()}일까지`;
};

export default function PendingSalesPanel({ sales, customers, onCopyLink, onEdit, onConvertToOnsite, onCancel, onRefresh }: PendingSalesPanelProps) {
  const [editing, setEditing] = useState<PendingSale | null>(null);
  const [form, setForm] = useState<PendingSale["product"] | null>(null);
  const [saving, setSaving] = useState(false);

  if (sales.length === 0) return null;

  const nameOf = (s: PendingSale) =>
    s.customerId ? customers.find((c) => c.id === s.customerId)?.name || "고객" : `${s.newCustomer?.name || "이름 없음"} (신규)`;

  const openEdit = (s: PendingSale) => { setEditing(s); setForm({ ...s.product }); };
  const saveEdit = async () => {
    if (!editing || !form || saving) return;
    setSaving(true);
    try {
      await onEdit(editing, form);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ptm-pending-sales">
      <div className="ptm-pending-sales-head">
        <span className="ptm-detail-section-title" style={{ margin: 0 }}>서명 대기 {sales.length}건</span>
        {onRefresh && <button className="ptm-icon-btn" title="고객 서명 여부 새로고침" onClick={onRefresh}><RefreshCw size={14} /></button>}
      </div>
      <div className="ptm-no-product-msg" style={{ marginTop: 0, marginBottom: 8 }}>
        고객이 링크에서 서명하면 그때 이용권이 등록되고 매출에 반영돼요. 서명 전에는 횟수·매출·통계에 잡히지 않아요.
      </div>
      {sales.map((s) => {
        const expired = isExpired(s);
        return (
          <div className="ptm-pending-sale-row" key={s.id}>
            <div className="ptm-pending-sale-info">
              <div>
                <b>{nameOf(s)}</b> · {s.product.name}{s.product.type === "session" ? ` ${s.product.totalSessions}회` : ""}
              </div>
              <div className="ptm-pending-sale-sub">
                {Number(s.product.price || 0).toLocaleString()}원 · {PAYMENT_LABELS[s.product.paymentMethod]}{" "}
                <span className={`ptm-badge ${expired ? "unpaid" : "forecast"}`}>{expired ? "링크 만료" : `서명 대기 · ${expiryLabel(s)}`}</span>
              </div>
            </div>
            <div className="ptm-actions">
              <button className="ptm-icon-btn" title={expired ? "새 링크 발급 후 복사" : "링크 다시 복사"} onClick={() => onCopyLink(s)}><Copy size={14} /></button>
              <button className="ptm-icon-btn" title="금액·횟수 수정 (새 링크 발급)" onClick={() => openEdit(s)}><Pencil size={14} /></button>
              <button className="ptm-icon-btn" title="현장 서명으로 전환" onClick={() => onConvertToOnsite(s)}><PenLine size={14} /></button>
              <button className="ptm-icon-btn" title="링크 취소" onClick={() => onCancel(s)}><X size={14} /></button>
            </div>
          </div>
        );
      })}

      {editing && form && (
        <div className="ptm-overlay" onClick={() => !saving && setEditing(null)}>
          <div className="ptm-sheet" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">서명 대기 건 수정</span>
              <button className="ptm-icon-btn" onClick={() => setEditing(null)} disabled={saving}><X size={16} /></button>
            </div>
            <div className="ptm-no-product-msg" style={{ marginTop: -6 }}>
              저장하면 이전에 보낸 링크는 바로 무효가 되고, 새 링크가 복사돼요. 새 링크를 고객에게 다시 보내주세요.
            </div>
            {form.type === "session" && (
              <div className="ptm-field"><label>총 횟수</label>
                <input type="number" onFocus={(e) => e.target.select()} value={form.totalSessions} onChange={(e) => setForm({ ...form, totalSessions: Number(e.target.value) })} />
              </div>
            )}
            <div className="ptm-row2">
              <div className="ptm-field"><label>정가 (원)</label>
                <input type="text" inputMode="numeric" onFocus={(e) => e.target.select()} value={fmtNum(form.listPrice)} onChange={(e) => setForm({ ...form, listPrice: parseNum(e.target.value) })} />
              </div>
              <div className="ptm-field"><label>판매가 (원)</label>
                <input type="text" inputMode="numeric" onFocus={(e) => e.target.select()} value={fmtNum(form.price)} onChange={(e) => { const v = parseNum(e.target.value); setForm({ ...form, price: v, paidAmount: v }); }} />
              </div>
            </div>
            <div className="ptm-field"><label>결제 수단</label>
              <div className="ptm-type-toggle">
                {(["card", "cash", "transfer"] as PaymentMethod[]).map((m) => (
                  <button key={m} className={`ptm-type-btn ${form.paymentMethod === m ? "active" : ""}`} onClick={() => setForm({ ...form, paymentMethod: m })}>{PAYMENT_LABELS[m]}</button>
                ))}
              </div>
            </div>
            <div className="ptm-field"><label>결제(입금) 금액</label>
              <input type="text" inputMode="numeric" onFocus={(e) => e.target.select()} value={fmtNum(form.paidAmount)} onChange={(e) => setForm({ ...form, paidAmount: parseNum(e.target.value) })} />
            </div>
            <button className="ptm-save-btn" onClick={saveEdit} disabled={saving}>{saving ? "저장 중..." : "저장하고 새 링크 복사"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
