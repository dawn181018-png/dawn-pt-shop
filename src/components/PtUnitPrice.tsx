// 통계분석 > "PT 단가 분석"(관리자 전용, 조회만). 계산은 lib/unitPrice 한 곳에서 하고 이 화면은 보여주기만 한다.
"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { today } from "@/lib/formatUtils";
import { monthRange } from "@/lib/accounting";
import { byCount, extremes, monthlyTrend, totalsOf, unitSales, wonRound, type UnitBasis, type UnitSale, type UnitTotals } from "@/lib/unitPrice";
import type { Customer, PaymentCollection, Product } from "@/lib/types";

const shiftMonth = (month: string, d: number) => {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1 + d;
  return `${y + Math.floor(m / 12)}-${String((((m % 12) + 12) % 12) + 1).padStart(2, "0")}`;
};
const monthLabel = (k: string) => `${k.slice(0, 4)}년 ${Number(k.slice(5, 7))}월`;
const kindLabel = { new: "신규", renew: "재등록" } as const;

export default function PtUnitPrice({ products, customers, collections, transferRecipientIds }: {
  products: Product[]; // 보관 안 된 이용권
  customers: Customer[]; // 보관된 고객 포함(이름 표시용)
  collections: PaymentCollection[] | null;
  transferRecipientIds: Set<string>;
}) {
  const [mode, setMode] = useState<"month" | "custom">("month");
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [from, setFrom] = useState(() => `${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(() => today());
  const [basis, setBasis] = useState<UnitBasis>("received");
  const rangeStart = mode === "month" ? monthRange(month).start : from <= to ? from : to;
  const rangeEnd = mode === "month" ? monthRange(month).end : from <= to ? to : from;

  const data = useMemo(
    () => unitSales({ products, customers, collections, transferRecipientIds, basis, range: { start: rangeStart, end: rangeEnd } }),
    [products, customers, collections, transferRecipientIds, basis, rangeStart, rangeEnd],
  );
  const totals = totalsOf(data.sales);
  const kinds = (["new", "renew"] as const).map((k) => ({ k, t: totalsOf(data.sales.filter((s) => s.kind === k)) }));
  const groups = byCount(data.sales);
  const ext = extremes(data.sales, 5);
  const trendEnd = mode === "month" ? month : rangeEnd.slice(0, 7);
  const trend = useMemo(
    () => monthlyTrend({ products, customers, collections, transferRecipientIds, basis }, trendEnd),
    [products, customers, collections, transferRecipientIds, basis, trendEnd],
  );
  const amountWord = basis === "received" ? "받은 금액" : "계약 금액";
  const empty = data.sales.length === 0;

  const row = (label: string, t: UnitTotals) => (
    <tr key={label}><td>{label}</td><td>{t.count}건</td><td><b>{wonRound(t.avgUnit)}</b></td><td>{wonRound(t.avgUnitNoService)}</td><td>{wonRound(t.avgContract)}</td><td>{wonRound(t.amount)}</td><td>{t.sessions}회{t.service > 0 ? ` (서비스 ${t.service})` : ""}</td></tr>
  );
  const saleRow = (s: UnitSale) => (
    <tr key={s.id}><td>{s.customerName}</td><td><b>{wonRound(s.unit)}</b></td><td>{s.productName}</td><td>{wonRound(s.amount)}{basis === "received" && s.unpaid > 0 ? <small className="ptm-up-unpaid"> 미수 {s.unpaid.toLocaleString()}</small> : null}</td><td>{s.sessions}회</td><td>{s.paidDate.slice(2).replace(/-/g, ".")}</td></tr>
  );

  return (
    <div className="ptm-up">
      <div className="ptm-up-bar">
        <div className="ptm-type-toggle">
          <button className={`ptm-type-btn ${mode === "month" ? "active" : ""}`} onClick={() => setMode("month")}>월별</button>
          <button className={`ptm-type-btn ${mode === "custom" ? "active" : ""}`} onClick={() => setMode("custom")}>기간 선택</button>
        </div>
        {mode === "month" ? (
          <div className="ptm-week-nav">
            <button className="ptm-nav-btn" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
            <button className="ptm-nav-today" onClick={() => setMonth(today().slice(0, 7))}>이번 달</button>
            <button className="ptm-nav-btn" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
            <span className="ptm-week-range">{monthLabel(month)}</span>
          </div>
        ) : (
          <label className="ptm-sg-range"><input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /> ~ <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        )}
        <div className="ptm-type-toggle">
          <button className={`ptm-type-btn ${basis === "received" ? "active" : ""}`} onClick={() => setBasis("received")}>실제 받은 금액</button>
          <button className={`ptm-type-btn ${basis === "contract" ? "active" : ""}`} onClick={() => setBasis("contract")}>계약 금액</button>
        </div>
      </div>

      <div className="ptm-up-cards">
        <div className="ptm-pay-card"><div className="ptm-pay-card-label">평균 1회 단가</div><div className="ptm-pay-card-num">{empty ? "-" : wonRound(totals.avgUnit)}</div>
          <div className="ptm-up-formula">{amountWord} 합계 ÷ 총 횟수(서비스 포함)</div>
          <div className="ptm-up-sub">서비스 제외 {empty ? "-" : wonRound(totals.avgUnitNoService)}</div></div>
        <div className="ptm-pay-card"><div className="ptm-pay-card-label">1건당 평균 계약금액</div><div className="ptm-pay-card-num">{empty ? "-" : wonRound(totals.avgContract)}</div>
          <div className="ptm-up-formula">{amountWord} 합계 ÷ 판매 건수</div></div>
        <div className="ptm-pay-card"><div className="ptm-pay-card-label">판매 건수</div><div className="ptm-pay-card-num">{totals.count}건</div>
          <div className="ptm-up-formula">{amountWord} {wonRound(totals.amount)}</div>
          <div className="ptm-up-sub">총 {totals.sessions}회{totals.service > 0 ? ` (서비스 ${totals.service}회)` : ""}</div></div>
      </div>

      <div className="ptm-up-notes">
        {basis === "received"
          ? <>실제 받은 금액 = 처음 결제 + 나중에 받은 미수금(판매 건에 붙여 계산). {data.unpaidCount > 0 && <b>미수금이 남은 {data.unpaidCount}건({data.unpaidAmount.toLocaleString()}원)은 받은 만큼만 들어가요 — &ldquo;계약 금액&rdquo;으로 바꾸면 포함돼요.</b>}</>
          : <>계약 금액 = 판매가(아직 못 받은 미수금 포함).{data.unpaidCount > 0 && ` 이 중 미수금 ${data.unpaidCount}건 ${data.unpaidAmount.toLocaleString()}원.`}</>}
        {" "}판매 건은 처음 결제일 기준으로 묶어요. 삭제된 판매 건·기간권{data.excludedPeriod > 0 ? `(${data.excludedPeriod}건)` : ""}·양도로 생긴 이용권{data.excludedTransfer > 0 ? `(${data.excludedTransfer}건)` : ""}은 제외.
        {" "}서비스 횟수는 메모의 &ldquo;서비스 N회&rdquo;에서 읽어요{data.serviceUnread > 0 ? ` — 메모에 서비스가 있지만 횟수를 못 읽은 ${data.serviceUnread}건은 서비스 0회로 계산` : ""}.
      </div>

      {empty ? (
        <div className="ptm-table-empty">해당 기간 판매 내역이 없습니다</div>
      ) : (
        <>
          <div className="ptm-up-title">신규 / 재등록</div>
          <div className="ptm-table-wrap"><table className="ptm-table ptm-up-table">
            <thead><tr><th>구분</th><th>건수</th><th>1회 단가</th><th>서비스 제외</th><th>1건 평균</th><th>{amountWord}</th><th>총 횟수</th></tr></thead>
            <tbody>{kinds.map(({ k, t }) => row(kindLabel[k], t))}{row("전체", totals)}</tbody>
          </table></div>

          <div className="ptm-up-title">상품(횟수)별</div>
          <div className="ptm-table-wrap"><table className="ptm-table ptm-up-table">
            <thead><tr><th>횟수</th><th>건수</th><th>1회 단가</th><th>서비스 제외</th><th>1건 평균</th><th>{amountWord}</th><th>총 횟수</th></tr></thead>
            <tbody>{groups.map((g) => row(`${g.sessions}회`, g.totals))}</tbody>
          </table></div>

          <div className="ptm-up-title">단가가 가장 높은 5건</div>
          <div className="ptm-table-wrap"><table className="ptm-table ptm-up-table">
            <thead><tr><th>회원</th><th>1회 단가</th><th>상품</th><th>{amountWord}</th><th>횟수</th><th>결제일</th></tr></thead>
            <tbody>{ext.high.map(saleRow)}</tbody>
          </table></div>
          <div className="ptm-up-title">단가가 가장 낮은 5건</div>
          <div className="ptm-table-wrap"><table className="ptm-table ptm-up-table">
            <thead><tr><th>회원</th><th>1회 단가</th><th>상품</th><th>{amountWord}</th><th>횟수</th><th>결제일</th></tr></thead>
            <tbody>{ext.low.map(saleRow)}</tbody>
          </table></div>
        </>
      )}

      <div className="ptm-up-title">최근 12개월 평균 1회 단가 ({monthLabel(trendEnd)}까지)</div>
      <div className="ptm-up-chart">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={trend.map((t) => ({ label: `${Number(t.month.slice(5, 7))}월`, 단가: t.totals.avgUnit === null ? 0 : Math.round(t.totals.avgUnit) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}천`} />
            <Tooltip formatter={(v) => [`${Number(v).toLocaleString()}원`, "1회 단가"]} />
            <Bar dataKey="단가" fill="#3b6fe0" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="ptm-table-wrap"><table className="ptm-table ptm-up-table">
        <thead><tr><th>월</th><th>1회 단가</th><th>건수</th><th>1건 평균</th><th>{amountWord}</th><th>총 횟수</th></tr></thead>
        <tbody>{[...trend].reverse().map((t) => (
          <tr key={t.month}><td>{monthLabel(t.month)}</td><td><b>{t.totals.count ? wonRound(t.totals.avgUnit) : "판매 없음"}</b></td><td>{t.totals.count}건</td><td>{wonRound(t.totals.avgContract)}</td><td>{wonRound(t.totals.amount)}</td><td>{t.totals.sessions}회</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
