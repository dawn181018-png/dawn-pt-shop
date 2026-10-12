// "상품판매" 탭: PT 상품을 신규/재등록 판매하면서 계약서 서명까지 한 번에 진행하는 3단계 화면.
// 1) 고객 검색(재등록) 또는 신규 등록  2) 상품(이용권) 선택 및 가격/결제 입력  3) 계약서 숙지 후 서명
// 고객/상품/서명은 3단계에서 서명을 완료한 순간에만 한 번에 DB에 반영한다 — 중간에 화면을 닫으면
// 아무 것도 저장되지 않아, 계약서 서명 없이 고객/상품 행만 남는 상황을 방지한다.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Check, ChevronLeft, Link2 } from "lucide-react";
import SignaturePad from "signature_pad";
import * as db from "@/lib/db";
import { categoryToProductType, formatCatalogSummary } from "@/lib/catalogCategory";
import { today, addDays, addMonths, fmtNum, parseNum, formatPhone } from "@/lib/formatUtils";
import { CONTRACT_VERSION, CONTRACT_SECTIONS } from "@/lib/contract";
import { signPendingSale } from "@/app/sign/[token]/actions";
import type { Customer, Product, CatalogItem, ProductType, PaymentMethod, PendingSale } from "@/lib/types";

const isPhoneLike = (v: string): boolean => /^[0-9-\s]+$/.test(v.trim()) && v.trim() !== "";

// 이 화면 전용 폼 모양(엔티티 타입과 다르게 id 없음, 날짜가 문자열, gender가 빈 문자열 허용 등).
export type SaleCustomerForm = { name: string; gender: string; phone: string; birthdate: string };
export type SaleProductForm = {
  name: string; type: ProductType;
  totalSessions: number; usedSessions: number;
  startDate: string; endDate: string;
  sessionDuration: number; listPrice: number; price: number; paidAmount: number; paymentMethod: PaymentMethod;
};
const emptyCustomerForm: SaleCustomerForm = { name: "", gender: "", phone: "", birthdate: "" };
const emptyProductForm: SaleProductForm = {
  name: "", type: "session",
  totalSessions: 10, usedSessions: 0,
  startDate: today(), endDate: "",
  sessionDuration: 50, listPrice: 0, price: 0, paidAmount: 0, paymentMethod: "card",
};

// "서명 대기" 건을 현장 서명으로 전환할 때, 그 건의 고객/상품 입력값을 채운 채 3단계(계약서)부터 시작한다.
export type SalePrefill = { customer: Customer | null; newCustomer: SaleCustomerForm | null; product: SaleProductForm };

type ProductSaleWizardProps = {
  customers: Customer[];
  catalog: CatalogItem[];
  onSaleComplete: (customer: Customer, product: Product, isNewCustomer: boolean) => void;
  // 링크 서명: 서명 대기 건을 만든 직후 호출된다(부모가 링크 복사 + 서명 대기 목록 갱신).
  onLinkCreated: (sale: PendingSale) => void;
  prefill?: SalePrefill | null;
  flash: (msg: string, ms?: number) => void;
};

export default function ProductSaleWizard({ customers, catalog, onSaleComplete, onLinkCreated, prefill, flash }: ProductSaleWizardProps) {
  const [step, setStep] = useState(prefill ? 3 : 1);

  // ---- 1단계: 고객 검색/등록 ----
  const [query, setQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(prefill?.customer ?? null); // 기존 고객을 선택하면 채워짐(재등록)
  const [isNewCustomer, setIsNewCustomer] = useState(!!prefill?.newCustomer);
  const [customerForm, setCustomerForm] = useState<SaleCustomerForm>(
    prefill?.newCustomer ??
      (prefill?.customer
        ? { name: prefill.customer.name, gender: prefill.customer.gender || "", phone: prefill.customer.phone || "", birthdate: prefill.customer.birthdate || "" }
        : emptyCustomerForm),
  );

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    return customers.filter((c) => c.name.includes(query) || (c.phone || "").includes(query)).slice(0, 8);
  }, [customers, query]);

  const pickExistingCustomer = (c: Customer) => {
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
  const [productForm, setProductForm] = useState<SaleProductForm>(prefill?.product ?? emptyProductForm);
  const [catalogPick, setCatalogPick] = useState("");
  const applyCatalogItem = (id: string) => {
    setCatalogPick(id);
    const item = catalog.find((c) => c.id === id);
    if (!item) return;
    const type = categoryToProductType(item.category);
    setProductForm({
      ...productForm,
      name: item.name, type,
      totalSessions: item.sessions, usedSessions: 0,
      startDate: today(),
      endDate: type === "period" && item.periodUnit === "day" ? addDays(today(), item.months) : addMonths(today(), item.months),
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [isSignatureEmpty, setIsSignatureEmpty] = useState(true);
  const [saving, setSaving] = useState(false);
  // 3단계 서명 방식: 현장 서명(기존 그대로) / 링크 서명(고객 휴대폰에서 서명)
  const [signMode, setSignMode] = useState<"onsite" | "link">("onsite");

  useEffect(() => {
    if (step !== 3 || !agreed || signMode !== "onsite") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = new SignaturePad(canvas, { backgroundColor: "rgb(255,255,255)" });
    padRef.current = pad;
    pad.addEventListener("endStroke", () => setIsSignatureEmpty(pad.isEmpty()));
    // 휴대폰 주소창이 나타났다 사라질 때 오는 "resize"마다 초기화하면 서명이 지워지므로, 캔버스 폭이 실제로
    // 바뀐 경우에만 다시 맞추고 이미 그린 서명은 복원한다(출석 서명창/고객 링크 서명 화면과 같은 처리).
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
      setIsSignatureEmpty(pad.isEmpty());
    };
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      pad.off();
    };
  }, [step, agreed, signMode]);

  const clearSignature = () => { padRef.current?.clear(); setIsSignatureEmpty(true); };


  const [creatingLink, setCreatingLink] = useState(false);
  // 링크 서명은 이용권을 지금 만들지 않고 "서명 대기" 건만 만든다 — 고객이 링크에서 서명하는 순간 DB가
  // 고객/이용권/계약서 기록을 한 번에 확정한다(그 전엔 횟수·매출·통계에 반영되지 않음).
  const createSignLink = async () => {
    if (creatingLink) return;
    setCreatingLink(true);
    try {
      const { usedSessions: _unused, ...product } = productForm;
      void _unused;
      const sale = await db.insertPendingSale({
        customerId: isNewCustomer ? null : (selectedCustomer as Customer).id,
        newCustomer: isNewCustomer ? customerForm : null,
        product,
        contractVersion: CONTRACT_VERSION,
      });
      onLinkCreated(sale);
      resetWizard();
    } catch {
      flash("링크 만들기에 실패했어요. 다시 시도해주세요");
    } finally {
      setCreatingLink(false);
    }
  };

  const resetWizard = () => {
    setSignMode("onsite");
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

  // 현장 서명 저장: 링크 서명과 같은 경로를 쓴다 — 서명 대기 건을 만든 뒤 곧바로 이 화면의 서명으로 확정하면,
  // DB 함수(confirm_pending_sale)가 고객(신규면 생성)·이용권·계약서 서명 기록을 한 트랜잭션으로 만든다.
  // 예전처럼 고객→이용권→서명→계약서를 네 번 따로 저장하다 중간에 끊겨 "이용권은 있는데 계약서 기록이 없는"
  // 반쪽 저장이 생기지 않는다. 확정에 실패하면 만든 서명 대기 건을 취소해 목록에 남지 않게 한다.
  const completeSale = async () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty() || saving) return;
    setSaving(true);
    let pendingId: string | null = null;
    try {
      const { usedSessions: _unused, ...product } = productForm;
      void _unused;
      const sale = await db.insertPendingSale({
        customerId: isNewCustomer ? null : (selectedCustomer as Customer).id,
        newCustomer: isNewCustomer ? customerForm : null,
        product,
        contractVersion: CONTRACT_VERSION,
      });
      pendingId = sale.id;
      const result = await signPendingSale(sale.token, pad.toDataURL("image/png"));
      if (!result.ok) throw new Error(result.error);
      pendingId = null;
      const [customer, savedProduct] = await Promise.all([db.getCustomer(result.customerId), db.getProduct(result.productId)]);
      flash(`${customer.name}님 ${isNewCustomer ? "신규" : "재등록"} 판매 완료`);
      onSaleComplete(customer, savedProduct, isNewCustomer);
      resetWizard();
    } catch {
      if (pendingId) {
        try {
          await db.cancelPendingSale(pendingId);
          flash("판매 처리 실패, 다시 시도해주세요 (저장된 것은 없어요)");
        } catch {
          // 취소가 "이미 서명됨"으로 거절됐다면 응답만 못 받았을 뿐 판매는 확정된 것이다.
          flash("판매가 저장됐을 수 있어요. 새로고침해서 고객의 이용권을 확인해주세요", 5000);
        }
      } else {
        flash("판매 처리 실패, 다시 시도해주세요");
      }
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
                  <option key={c.id} value={c.id}>{c.name} ({formatCatalogSummary(c)})</option>
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
          <div className="ptm-type-toggle ptm-sign-mode-toggle">
            <button className={`ptm-type-btn ${signMode === "onsite" ? "active" : ""}`} onClick={() => setSignMode("onsite")} disabled={saving || creatingLink}>현장 서명</button>
            <button className={`ptm-type-btn ${signMode === "link" ? "active" : ""}`} onClick={() => setSignMode("link")} disabled={saving || creatingLink}>링크 복사 (고객 휴대폰 서명)</button>
          </div>

          {signMode === "link" && (
            <div className="ptm-sign-link-box">
              <div className="ptm-no-product-msg" style={{ margin: 0 }}>
                링크를 문자/카카오톡으로 보내면 고객이 자기 휴대폰에서 이 계약서를 확인하고 서명해요. 서명하는 즉시 등록이 확정되고,
                그 전까지는 &lsquo;서명 대기&rsquo;로 남아 이용권 횟수·매출에 반영되지 않아요. 링크는 7일간 유효해요.
              </div>
              <button className="ptm-save-btn" onClick={createSignLink} disabled={creatingLink}>
                {creatingLink ? "링크 만드는 중..." : <><Link2 size={15} /> 서명 링크 만들고 복사</>}
              </button>
            </div>
          )}

          {signMode === "onsite" && (
          <label className="ptm-contract-agree">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={saving} />
            위 내용을 모두 확인하고 숙지하였습니다
          </label>
          )}

          {signMode === "onsite" && agreed && (
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
