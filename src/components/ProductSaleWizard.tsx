// @ts-nocheck
// "상품판매" 탭: PT 상품을 신규/재등록 판매하면서 계약서 서명까지 한 번에 진행하는 3단계 화면.
// 1) 고객 검색(재등록) 또는 신규 등록  2) 상품(이용권) 선택 및 가격/결제 입력  3) 계약서 숙지 후 서명
// 고객/상품/서명은 3단계에서 서명을 완료한 순간에만 한 번에 DB에 반영한다 — 중간에 화면을 닫으면
// 아무 것도 저장되지 않아, 계약서 서명 없이 고객/상품 행만 남는 상황을 방지한다.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Check, ChevronLeft } from "lucide-react";
import SignaturePad from "signature_pad";
import * as db from "@/lib/db";

const toLocalDateStr = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const today = () => toLocalDateStr(new Date());
const addMonths = (dateStr, n) => { const d = new Date(dateStr); d.setMonth(d.getMonth() + Number(n)); return toLocalDateStr(d); };
const fmtNum = (n) => { const num = Number(n); return isNaN(num) ? "" : num.toLocaleString("ko-KR"); };
const parseNum = (str) => { const digits = String(str).replace(/[^0-9]/g, ""); return digits === "" ? 0 : Number(digits); };
const formatPhone = (v) => {
  const digits = String(v).replace(/[^0-9]/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
};
const emptyToNull = (v) => (v === "" || v === undefined ? null : v);
const isPhoneLike = (v) => /^[0-9-\s]+$/.test(v.trim()) && v.trim() !== "";

const emptyCustomerForm = { name: "", gender: "", phone: "", birthdate: "" };
const emptyProductForm = {
  name: "", type: "session",
  totalSessions: 10, usedSessions: 0,
  startDate: today(), endDate: "",
  sessionDuration: 50, listPrice: 0, price: 0, paidAmount: 0, paymentMethod: "card",
};

const CONTRACT_VERSION = "v1";
const CONTRACT_SECTIONS = [
  {
    title: "1. [세션 유효기간]",
    body: "본 계약의 세션은 1회당 4일 기준으로 유효기간이 산정됩니다. (10회: 40일 / 20회: 80일 / 30회: 120일)\n유효기간이 경과한 미사용 세션은 원칙적으로 소멸되나, 부상·질병·장기 출장 등 정당한 사유가 있는 경우 사전 신청 시 유효기간을 연장해드립니다.",
  },
  { title: "2. [계약 양도]", body: "타인에게 양도받은 계약은 재환불이 불가능합니다." },
  {
    title: "3. [환불 규정]",
    body: "계약 해지 시 환불금은 다음과 같이 산정됩니다.\n- 환불은 세션의 유효기간 내에만 신청 가능하며, 유효기간이 경과한 미사용 세션은 환불 대상에서 제외됩니다.\n- 환불 금액 산정 시, 사용한 세션에 해당하는 금액은 실제 구매한 회차 상품의 할인 단가가 아니라, 사용한 세션 수에 해당하는 상품의 정상 단가(1회 100,000원 기준)로 재계산하여 공제합니다.\n- 이는 대량 구매 시 적용된 할인 혜택이 실제 사용 회차에 비례하지 않게 환불에 반영되는 것을 방지하기 위함이며, 특정 회원에게만 불리하게 적용되는 조항이 아니라 모든 회원에게 동일하게 적용되는 기준입니다.\n- 환불금 = 실 결제금액 − (정상 단가 × 사용 세션 수) − 위약금(계약금의 10%)\n- 환불 지급일: 당월에 접수된 환불 건은 정산 절차를 거쳐 익월(다음 달) 20일에 지정 계좌로 일괄 지급됩니다.",
  },
  { title: "4.", body: "본 계약은 본인 이용이 원칙이나, 부득이한 사유 시 DAWN FITNESS의 사전 승인을 받아 타인에게 양도할 수 있습니다." },
  { title: "5.", body: "회원은 세션 종료 후 세션 차감 및 프로그램 확인을 위해 매 수업마다 담당 트레이너의 안내에 따라 서명해야 합니다." },
  { title: "6.", body: "담당 트레이너가 불가피한 사유(퇴사, 질병 등)로 강습이 불가능할 경우, 센터는 동등 자격의 트레이너로 대체하여 서비스를 제공하며, 이는 정당한 계약 이행이므로 이로 인한 무조건적인 환불은 제한됩니다." },
  {
    title: "7. [예약 취소 및 노쇼 규정]",
    body: "예약 취소 및 변경은 반드시 수업 시작 6시간 전까지 연락해야 합니다. 무단 불참(노쇼) 또는 6시간 이내 임박 취소 시, 해당 세션은 정상적으로 1회 차감됩니다.",
  },
  {
    title: "8. [신체 상태 및 안전 면책 조항]",
    body: "회원은 아래 사항을 숙지하고 서명함으로써 이에 동의합니다.\n- 회원은 운동에 적합한 신체·정신 상태임을 확인하며, 기왕증이나 의학적 특이사항이 있을 경우 사전에 전문의와 상담해야 합니다.\n- 회원의 건강 상태 및 운동 능력에 따라 시설 이용과 트레이닝의 난이도가 제한되거나 조정될 수 있습니다.\n- 계약서 외에 공식 승인되지 않은 구두상의 임의 약정은 효력을 가지지 않습니다.\n- 센터에서 공식 지급하지 않은 영양제나 약물 등을 개별 복용하여 발생하는 불이익에 대해 센터는 책임지지 않습니다.\n- 트레이닝 중 부상 위험을 인지하고 트레이너의 지시를 준수해야 하며, 회원의 부주의나 고의로 발생한 사고에 대해 센터의 중과실이 없는 한 DAWN FITNESS는 책임을 지지 않습니다.",
  },
];

export default function ProductSaleWizard({ customers, catalog, onSaleComplete, flash }) {
  const [step, setStep] = useState(1);

  // ---- 1단계: 고객 검색/등록 ----
  const [query, setQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null); // 기존 고객을 선택하면 채워짐(재등록)
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    return customers.filter((c) => c.name.includes(query) || (c.phone || "").includes(query)).slice(0, 8);
  }, [customers, query]);

  const pickExistingCustomer = (c) => {
    setSelectedCustomer(c);
    setIsNewCustomer(false);
    setCustomerForm({ name: c.name, gender: c.gender || "", phone: c.phone || "", birthdate: c.birthdate || "" });
    setStep(2);
  };
  const startNewCustomer = () => {
    setSelectedCustomer(null);
    setIsNewCustomer(true);
    setCustomerForm({ ...emptyCustomerForm, name: isPhoneLike(query) ? "" : query, phone: isPhoneLike(query) ? formatPhone(query) : "" });
  };
  const changeCustomer = () => {
    setSelectedCustomer(null);
    setIsNewCustomer(false);
    setCustomerForm(emptyCustomerForm);
    setQuery("");
  };
  const goToStep2FromNewCustomer = () => {
    if (!customerForm.name.trim()) { flash("이름을 입력해주세요"); return; }
    setStep(2);
  };

  // ---- 2단계: 상품 선택/가격 ----
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [catalogPick, setCatalogPick] = useState("");
  const applyCatalogItem = (id) => {
    setCatalogPick(id);
    const item = catalog.find((c) => c.id === id);
    if (!item) return;
    setProductForm({
      ...productForm,
      name: item.name, type: "session",
      totalSessions: item.sessions, usedSessions: 0,
      startDate: today(), endDate: addMonths(today(), item.months),
      sessionDuration: item.sessionDuration || 50,
      listPrice: item.price, price: item.price, paidAmount: item.price,
    });
  };
  const goToStep3 = () => {
    if (!productForm.name.trim()) { flash("상품명을 입력해주세요"); return; }
    setStep(3);
  };

  // ---- 3단계: 계약서 숙지 + 서명 ----
  const [agreed, setAgreed] = useState(false);
  const canvasRef = useRef(null);
  const padRef = useRef(null);
  const [isSignatureEmpty, setIsSignatureEmpty] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (step !== 3 || !agreed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = new SignaturePad(canvas, { backgroundColor: "rgb(255,255,255)" });
    padRef.current = pad;
    pad.addEventListener("endStroke", () => setIsSignatureEmpty(pad.isEmpty()));
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      canvas.getContext("2d")?.scale(ratio, ratio);
      pad.clear();
      setIsSignatureEmpty(true);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      pad.off();
    };
  }, [step, agreed]);

  const clearSignature = () => { padRef.current?.clear(); setIsSignatureEmpty(true); };

  const resetWizard = () => {
    setStep(1);
    setQuery("");
    setSelectedCustomer(null);
    setIsNewCustomer(false);
    setCustomerForm(emptyCustomerForm);
    setProductForm(emptyProductForm);
    setCatalogPick("");
    setAgreed(false);
    setIsSignatureEmpty(true);
  };

  const completeSale = async () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty() || saving) return;
    setSaving(true);
    try {
      let customer = selectedCustomer;
      if (isNewCustomer) {
        customer = await db.insertCustomer({
          name: customerForm.name,
          gender: emptyToNull(customerForm.gender),
          phone: customerForm.phone,
          birthdate: emptyToNull(customerForm.birthdate),
        });
      }
      const product = await db.insertProduct(customer.id, {
        ...productForm,
        endDate: emptyToNull(productForm.endDate),
      });
      const dataUrl = pad.toDataURL("image/png");
      const blob = await (await fetch(dataUrl)).blob();
      const signatureUrl = await db.uploadContractSignature(customer.id, blob);
      await db.insertContractSignature({
        customerId: customer.id,
        productId: product.id,
        isNewCustomer,
        signatureUrl,
        contractVersion: CONTRACT_VERSION,
        signedAt: new Date().toISOString(),
      });
      flash(`${customer.name}님 ${isNewCustomer ? "신규" : "재등록"} 판매 완료`);
      onSaleComplete(customer, product, isNewCustomer);
      resetWizard();
    } catch (e) {
      flash("판매 처리 실패, 다시 시도해주세요");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ptm-sale-wrap">
      <div className="ptm-sale-steps">
        <div className={`ptm-sale-step ${step === 1 ? "active" : step > 1 ? "done" : ""}`}>1. 고객</div>
        <div className={`ptm-sale-step ${step === 2 ? "active" : step > 2 ? "done" : ""}`}>2. 상품·결제</div>
        <div className={`ptm-sale-step ${step === 3 ? "active" : ""}`}>3. 계약서·서명</div>
      </div>

      {step === 1 && (
        <div className="ptm-sale-card">
          {selectedCustomer || isNewCustomer ? (
            <>
              {selectedCustomer && (
                <div className="ptm-selected-chip">
                  <div><span className="ptm-selected-chip-name">{selectedCustomer.name}</span><span className="ptm-selected-chip-phone">{selectedCustomer.phone}</span></div>
                  <button className="ptm-change-btn" onClick={changeCustomer}>다시 검색</button>
                </div>
              )}
              {isNewCustomer && (
                <>
                  <div className="ptm-sale-card-title">신규 고객 등록</div>
                  <div className="ptm-field"><label>이름</label>
                    <input value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} placeholder="고객 이름" autoFocus />
                  </div>
                  <div className="ptm-field"><label>성별</label>
                    <div className="ptm-type-toggle">
                      <button className={`ptm-type-btn ${customerForm.gender === "male" ? "active" : ""}`} onClick={() => setCustomerForm({ ...customerForm, gender: "male" })}>남</button>
                      <button className={`ptm-type-btn ${customerForm.gender === "female" ? "active" : ""}`} onClick={() => setCustomerForm({ ...customerForm, gender: "female" })}>여</button>
                    </div>
                  </div>
                  <div className="ptm-row2">
                    <div className="ptm-field"><label>전화번호</label>
                      <input value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: formatPhone(e.target.value) })} placeholder="010-0000-0000" />
                    </div>
                    <div className="ptm-field"><label>생년월일</label>
                      <input type="date" value={customerForm.birthdate} onChange={(e) => setCustomerForm({ ...customerForm, birthdate: e.target.value })} />
                    </div>
                  </div>
                  <button className="ptm-change-btn" onClick={changeCustomer} style={{ marginBottom: 10 }}>기존 고객 다시 검색</button>
                  <button className="ptm-save-btn" onClick={goToStep2FromNewCustomer}>다음</button>
                </>
              )}
              {selectedCustomer && <button className="ptm-save-btn" onClick={() => setStep(2)}>다음</button>}
            </>
          ) : (
            <>
              <div className="ptm-search" style={{ marginBottom: 10 }}>
                <Search size={15} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 또는 전화번호로 검색" autoFocus />
              </div>
              {query.trim() && (
                matches.length > 0 ? (
                  <div className="ptm-cust-search-results">
                    {matches.map((c) => (
                      <div key={c.id} className="ptm-cust-result" onClick={() => pickExistingCustomer(c)}>
                        <span>{c.name}</span><span className="ptm-cust-result-phone">{c.phone}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ptm-sale-no-match">
                    <div className="ptm-no-product-msg">일치하는 고객이 없어요 — 신규 등록으로 진행할게요</div>
                    <button className="ptm-save-btn" onClick={startNewCustomer}>신규 등록으로 진행</button>
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="ptm-sale-card">
          <button className="ptm-change-btn ptm-sale-back" onClick={() => setStep(1)}><ChevronLeft size={14} /> 이전</button>
          {catalog.length > 0 && (
            <div className="ptm-field"><label>이용권에서 불러오기 (선택 시 자동 입력 · 이후 금액 등 수정 가능)</label>
              <select value={catalogPick} onChange={(e) => applyCatalogItem(e.target.value)}>
                <option value="">직접 입력</option>
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.sessions}회 · {c.months}개월 · {c.sessionDuration || 50}분 · {Number(c.price || 0).toLocaleString()}원)</option>
                ))}
              </select>
            </div>
          )}
          <div className="ptm-field"><label>상품명</label>
            <input value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} placeholder="예: PT 40회, Premium Conditioning 20회" />
          </div>
          <div className="ptm-field"><label>종류</label>
            <div className="ptm-type-toggle">
              <button className={`ptm-type-btn ${productForm.type === "session" ? "active" : ""}`} onClick={() => setProductForm({ ...productForm, type: "session" })}>횟수권</button>
              <button className={`ptm-type-btn ${productForm.type === "period" ? "active" : ""}`} onClick={() => setProductForm({ ...productForm, type: "period" })}>기간권</button>
            </div>
          </div>
          {productForm.type === "session" ? (
            <div className="ptm-row3">
              <div className="ptm-field"><label>총 횟수</label>
                <input type="number" onFocus={(e) => e.target.select()} value={productForm.totalSessions} onChange={(e) => setProductForm({ ...productForm, totalSessions: Number(e.target.value) })} />
              </div>
              <div className="ptm-field"><label>시작일</label>
                <input type="date" value={productForm.startDate} onChange={(e) => setProductForm({ ...productForm, startDate: e.target.value })} />
              </div>
              <div className="ptm-field"><label>1회 시간(분)</label>
                <input type="number" onFocus={(e) => e.target.select()} value={productForm.sessionDuration} onChange={(e) => setProductForm({ ...productForm, sessionDuration: Number(e.target.value) })} />
              </div>
            </div>
          ) : (
            <div className="ptm-row3">
              <div className="ptm-field"><label>시작일</label>
                <input type="date" value={productForm.startDate} onChange={(e) => setProductForm({ ...productForm, startDate: e.target.value })} />
              </div>
              <div className="ptm-field"><label>종료일</label>
                <input type="date" value={productForm.endDate} onChange={(e) => setProductForm({ ...productForm, endDate: e.target.value })} />
              </div>
              <div className="ptm-field"><label>1회 시간(분)</label>
                <input type="number" onFocus={(e) => e.target.select()} value={productForm.sessionDuration} onChange={(e) => setProductForm({ ...productForm, sessionDuration: Number(e.target.value) })} />
              </div>
            </div>
          )}
          <div className="ptm-row2">
            <div className="ptm-field"><label>정가 (원)</label>
              <input type="text" inputMode="numeric" onFocus={(e) => e.target.select()} value={fmtNum(productForm.listPrice)} onChange={(e) => setProductForm({ ...productForm, listPrice: parseNum(e.target.value) })} placeholder="0" />
            </div>
            <div className="ptm-field"><label>판매가 (고객이 내야 할 총액)</label>
              <input
                type="text" inputMode="numeric" onFocus={(e) => e.target.select()}
                value={fmtNum(productForm.price)}
                onChange={(e) => { const v = parseNum(e.target.value); setProductForm({ ...productForm, price: v, paidAmount: v }); }}
                placeholder="0"
              />
            </div>
          </div>
          {Number(productForm.listPrice) > Number(productForm.price) && (
            <div className="ptm-discount-note">할인 {(Number(productForm.listPrice) - Number(productForm.price)).toLocaleString()}원 적용됨</div>
          )}
          <div className="ptm-field"><label>결제 수단</label>
            <div className="ptm-type-toggle">
              <button className={`ptm-type-btn ${productForm.paymentMethod === "card" ? "active" : ""}`} onClick={() => setProductForm({ ...productForm, paymentMethod: "card" })}>카드</button>
              <button className={`ptm-type-btn ${productForm.paymentMethod === "cash" ? "active" : ""}`} onClick={() => setProductForm({ ...productForm, paymentMethod: "cash" })}>현금</button>
              <button className={`ptm-type-btn ${productForm.paymentMethod === "transfer" ? "active" : ""}`} onClick={() => setProductForm({ ...productForm, paymentMethod: "transfer" })}>계좌이체</button>
            </div>
          </div>
          <div className="ptm-row2">
            <div className="ptm-field"><label>결제(입금) 금액</label>
              <input type="text" inputMode="numeric" onFocus={(e) => e.target.select()} value={fmtNum(productForm.paidAmount)} onChange={(e) => setProductForm({ ...productForm, paidAmount: parseNum(e.target.value) })} placeholder="0" />
            </div>
            <button type="button" className="ptm-full-paid-btn" onClick={() => setProductForm({ ...productForm, paidAmount: Number(productForm.price) || 0 })}>전액 결제로 설정</button>
          </div>
          {Number(productForm.price) - Number(productForm.paidAmount) > 0 && (
            <div className="ptm-unpaid-note">미수금 {(Number(productForm.price) - Number(productForm.paidAmount)).toLocaleString()}원 남음</div>
          )}
          <button className="ptm-save-btn" onClick={goToStep3}>다음</button>
        </div>
      )}

      {step === 3 && (
        <div className="ptm-sale-card">
          <button className="ptm-change-btn ptm-sale-back" onClick={() => setStep(2)}><ChevronLeft size={14} /> 이전</button>
          <div className="ptm-sale-card-title">DAWN FITNESS 개인 트레이닝 계약서</div>
          <div className="ptm-contract-box">
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
                <button className="ptm-save-btn" style={{ marginTop: 0 }} onClick={completeSale} disabled={isSignatureEmpty || saving}>
                  {saving ? "저장 중..." : <><Check size={15} /> 서명 완료 · 판매 등록</>}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
