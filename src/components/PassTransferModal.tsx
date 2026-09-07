// "이용권 양도" 모달: 한 이용권(product)의 잔여 횟수를 1명 이상에게 나눠서 넘기고 결제까지 받는다.
// ProductSaleWizard와 달리 계약서 서명 없이 관리자가 바로 처리하는 단일 화면이다.
// 실제 DB 반영(고객/이용권 생성, 이력 기록, 원본 차감)은 db.transferPass가 호출하는
// Postgres 함수(transfer_pass) 안에서 하나의 트랜잭션으로 처리된다 — 프론트는 입력값만 모은다.
"use client";

import { useState } from "react";
import { Search, X, Plus } from "lucide-react";
import * as db from "@/lib/db";
import { fmtNum, parseNum, formatPhone } from "@/lib/formatUtils";
import type { Customer, Product, PaymentMethod, TransferRecipientInput } from "@/lib/types";

const isPhoneLike = (v: string): boolean => /^[0-9-\s]+$/.test(v.trim()) && v.trim() !== "";

type RecipientForm = {
  id: string;
  query: string;
  selectedCustomer: Customer | null;
  isNewCustomer: boolean;
  newName: string;
  newPhone: string;
  sessions: number;
  amount: number;
  paymentMethod: PaymentMethod;
};
const emptyRecipient = (): RecipientForm => ({
  id: crypto.randomUUID(),
  query: "", selectedCustomer: null, isNewCustomer: false, newName: "", newPhone: "",
  sessions: 0, amount: 0, paymentMethod: "card",
});

type PassTransferModalProps = {
  customers: Customer[];
  sourceProduct: Product;
  onClose: () => void;
  onComplete: () => Promise<void>; // 성공 시 부모가 products/customers/passTransfers를 다시 불러온다
  flash: (msg: string) => void;
};

export default function PassTransferModal({ customers, sourceProduct, onClose, onComplete, flash }: PassTransferModalProps) {
  const [recipients, setRecipients] = useState<RecipientForm[]>([emptyRecipient()]);
  const [saving, setSaving] = useState(false);

  const remaining = sourceProduct.totalSessions - sourceProduct.usedSessions;

  const updateRecipient = (id: string, patch: Partial<RecipientForm>) => {
    setRecipients((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const addRecipient = () => setRecipients((cur) => [...cur, emptyRecipient()]);
  const removeRecipient = (id: string) => setRecipients((cur) => cur.filter((r) => r.id !== id));
  const matchesFor = (query: string): Customer[] => {
    if (!query.trim()) return [];
    return customers.filter((c) => c.name.includes(query) || (c.phone || "").includes(query)).slice(0, 8);
  };

  const totalAllotted = recipients.reduce((sum, r) => sum + (Number(r.sessions) || 0), 0);
  const recipientValid = (r: RecipientForm): boolean =>
    (r.selectedCustomer !== null || (r.isNewCustomer && r.newName.trim() !== "")) && Number(r.sessions) > 0 && Number(r.amount) >= 0;
  const isValid = remaining > 0 && recipients.length > 0 && recipients.every(recipientValid) && totalAllotted > 0 && totalAllotted <= remaining;

  const submitTransfer = async () => {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      const recipientsInput: TransferRecipientInput[] = recipients.map((r) => ({
        customerId: r.selectedCustomer?.id,
        newCustomerName: r.isNewCustomer ? r.newName.trim() : undefined,
        newCustomerPhone: r.isNewCustomer ? r.newPhone.trim() : undefined,
        sessions: Number(r.sessions),
        amount: Number(r.amount),
        paymentMethod: r.paymentMethod,
      }));
      await db.transferPass(sourceProduct.id, recipientsInput);
      flash("이용권 양도 완료");
      await onComplete();
      onClose();
    } catch (e) {
      flash(e instanceof Error ? e.message : "저장 실패, 다시 시도해주세요");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ptm-overlay" onClick={onClose}>
      <div className="ptm-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ptm-sheet-head">
          <span className="ptm-sheet-title">이용권 양도</span>
          <button className="ptm-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ptm-detail-memo">{sourceProduct.name} · 잔여 {remaining}회 / 총 {sourceProduct.totalSessions}회</div>

        {recipients.map((r, i) => (
          <div className="ptm-prod-row" key={r.id} style={{ marginBottom: 10 }}>
            <div className="ptm-prod-top">
              <span className="ptm-prod-name">받는 사람 {i + 1}</span>
              {recipients.length > 1 && (
                <button className="ptm-icon-btn" onClick={() => removeRecipient(r.id)}><X size={14} /></button>
              )}
            </div>

            {r.selectedCustomer ? (
              <div className="ptm-selected-chip" style={{ marginTop: 10 }}>
                <div><span className="ptm-selected-chip-name">{r.selectedCustomer.name}</span><span className="ptm-selected-chip-phone">{r.selectedCustomer.phone}</span></div>
                <button className="ptm-change-btn" onClick={() => updateRecipient(r.id, { selectedCustomer: null, query: "" })}>다시 검색</button>
              </div>
            ) : r.isNewCustomer ? (
              <div style={{ marginTop: 10 }}>
                <div className="ptm-row2">
                  <div className="ptm-field"><label>이름</label>
                    <input value={r.newName} onChange={(e) => updateRecipient(r.id, { newName: e.target.value })} placeholder="이름" />
                  </div>
                  <div className="ptm-field"><label>전화번호</label>
                    <input value={r.newPhone} onChange={(e) => updateRecipient(r.id, { newPhone: formatPhone(e.target.value) })} placeholder="010-0000-0000" />
                  </div>
                </div>
                <button className="ptm-change-btn" onClick={() => updateRecipient(r.id, { isNewCustomer: false, query: "" })} style={{ marginBottom: 4 }}>기존 고객 다시 검색</button>
              </div>
            ) : (
              <div style={{ marginTop: 10 }}>
                <div className="ptm-search" style={{ marginBottom: 8 }}>
                  <Search size={14} />
                  <input value={r.query} onChange={(e) => updateRecipient(r.id, { query: e.target.value })} placeholder="이름 또는 전화번호로 검색" />
                </div>
                {r.query.trim() && (
                  matchesFor(r.query).length > 0 ? (
                    <div className="ptm-cust-search-results">
                      {matchesFor(r.query).map((c) => (
                        <div key={c.id} className="ptm-cust-result" onClick={() => updateRecipient(r.id, { selectedCustomer: c, query: "" })}>
                          <span>{c.name}</span><span className="ptm-cust-result-phone">{c.phone}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="ptm-no-product-msg">
                      일치하는 고객이 없어요 —{" "}
                      <button
                        className="ptm-change-btn" style={{ padding: 0 }}
                        onClick={() => updateRecipient(r.id, {
                          isNewCustomer: true,
                          newName: isPhoneLike(r.query) ? "" : r.query,
                          newPhone: isPhoneLike(r.query) ? formatPhone(r.query) : "",
                        })}
                      >신규 등록으로 진행</button>
                    </div>
                  )
                )}
              </div>
            )}

            <div className="ptm-row2" style={{ marginTop: 10 }}>
              <div className="ptm-field"><label>양도 횟수</label>
                <input type="number" onFocus={(e) => e.target.select()} value={r.sessions} onChange={(e) => updateRecipient(r.id, { sessions: Number(e.target.value) })} />
              </div>
              <div className="ptm-field"><label>결제 금액(원)</label>
                <input type="text" inputMode="numeric" onFocus={(e) => e.target.select()} value={fmtNum(r.amount)} onChange={(e) => updateRecipient(r.id, { amount: parseNum(e.target.value) })} placeholder="0" />
              </div>
            </div>
            <div className="ptm-field" style={{ marginBottom: 0 }}><label>결제 수단</label>
              <div className="ptm-type-toggle">
                <button className={`ptm-type-btn ${r.paymentMethod === "card" ? "active" : ""}`} onClick={() => updateRecipient(r.id, { paymentMethod: "card" })}>카드</button>
                <button className={`ptm-type-btn ${r.paymentMethod === "cash" ? "active" : ""}`} onClick={() => updateRecipient(r.id, { paymentMethod: "cash" })}>현금</button>
                <button className={`ptm-type-btn ${r.paymentMethod === "transfer" ? "active" : ""}`} onClick={() => updateRecipient(r.id, { paymentMethod: "transfer" })}>계좌이체</button>
              </div>
            </div>
          </div>
        ))}

        <button className="ptm-add-product-btn" onClick={addRecipient}><Plus size={14} /> 받는 사람 추가</button>

        <div style={{ fontSize: 12.5, color: totalAllotted > remaining ? "var(--coral)" : "var(--ink-dim)", margin: "10px 0" }}>
          배분 합계 {totalAllotted}회 / 잔여 {remaining}회
        </div>

        <button className="ptm-save-btn" onClick={submitTransfer} disabled={!isValid || saving}>
          {saving ? "처리 중..." : "양도 완료"}
        </button>
      </div>
    </div>
  );
}
