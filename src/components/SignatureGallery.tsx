// 고객 상세 > "서명" 탭(관리자 전용): 그 고객의 레슨 서명을 한곳에 모아 보고, 대리 트레이너가 진행한 레슨은 연보라 + "대리: 이름"으로
// 구분한다(색만으로 구분하지 않도록 글자도 같이). 담당 판단은 lib/delegateSettlement의 classifyLesson 한 곳 —
// 기록으로 구분이 안 되는 레슨은 칠하지 않고 "담당 구분 없음" / "확인 필요"로만 표시한다(추측해서 대리로 분류하지 않음).
// 서명 이미지는 기존처럼 1시간 동안만 열리는 비공개 주소로 불러온다. 조회만 하고 예약·서명 데이터는 바꾸지 않는다.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Printer, ImageDown } from "lucide-react";
import * as db from "@/lib/db";
import { printElement, saveElementPng } from "@/lib/exportUtils";
import { classifyLesson, type LessonHandler } from "@/lib/delegateSettlement";
import type { Product, Reservation } from "@/lib/types";

const weekdayShort = ["일", "월", "화", "수", "목", "금", "토"];
const statusText: Record<string, string> = { done: "완료", noshow: "노쇼", cancelled: "취소", scheduled: "예약됨" };
const dateLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} (${weekdayShort[d.getDay()]})`;
};
// 서명 파일 이름 끝의 숫자는 서명을 올린 시각(ms)이다: "<uid>/[delegated/]<예약 id>-<ms>.png"
const signedAtOf = (path?: string | null): string | null => {
  const m = path ? /-(\d{12,})\.png$/.exec(path) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const handlerText = (h: LessonHandler): string =>
  h.kind === "delegate" ? `대리: ${h.delegateName || "이름 없음"}`
  : h.kind === "check" ? `대리 예약 · 확인 필요: ${h.delegateName || "이름 없음"}`
  : h.kind === "owner" ? "본인" : "담당 구분 없음";

type Row = { r: Reservation; h: LessonHandler; no: number | null; total: number | null; productName: string; productId: string };

export default function SignatureGallery({
  customerName, reservations, products, sessionInfo, firstDay, flash,
}: {
  customerName: string;
  reservations: Reservation[]; // 이 고객의 예약(전체)
  products: Product[]; // 보관된 이용권 포함
  sessionInfo: Map<string, { no: number; total: number; productName: string }>; // 스케줄 카드와 같은 회차 계산
  firstDay: string | null;
  flash: (msg: string, ms?: number) => void;
}) {
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [delegateOnly, setDelegateOnly] = useState(false);
  const [byProduct, setByProduct] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const allRows: Row[] = useMemo(() => reservations
    .filter((r) => r.type === "pt" && (r.status === "done" || r.status === "noshow"))
    .map((r) => {
      const info = sessionInfo.get(r.id);
      const p = r.productId ? productById.get(r.productId) : undefined;
      return { r, h: classifyLesson(r, firstDay), no: info?.no ?? null, total: info?.total ?? (p?.type === "session" ? p.totalSessions : null), productName: info?.productName || p?.name || "이용권 없음", productId: r.productId || "" };
    }), [reservations, sessionInfo, productById, firstDay]);

  const rows = useMemo(() => {
    const list = allRows
      .filter((x) => (!from || x.r.date >= from) && (!to || x.r.date <= to) && (!delegateOnly || x.h.kind === "delegate"))
      .sort((a, b) => (a.r.date + a.r.time).localeCompare(b.r.date + b.r.time) * (order === "asc" ? 1 : -1));
    return list;
  }, [allRows, from, to, delegateOnly, order]);
  const groups = useMemo(() => {
    if (!byProduct) return [{ key: "all", title: "", rows }];
    const map = new Map<string, { key: string; title: string; rows: Row[]; firstAt: string }>();
    rows.forEach((x) => {
      const g = map.get(x.productId) || { key: x.productId || "none", title: x.productName, rows: [], firstAt: x.r.date + x.r.time };
      g.rows.push(x);
      if (x.r.date + x.r.time < g.firstAt) g.firstAt = x.r.date + x.r.time;
      map.set(x.productId, g);
    });
    return [...map.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt) * (order === "asc" ? 1 : -1));
  }, [rows, byProduct, order]);

  // 보이는 서명만 비공개 주소를 받아온다(1시간 유효)
  const [urls, setUrls] = useState<Record<string, string>>({});
  // 노쇼 건은 서명 대신 NO SHOW를 보여주므로 주소를 받지 않는다. 한 번 요청한 경로는 다시 요청하지 않는다.
  const requested = useRef<Set<string>>(new Set());
  const neededPaths = useMemo(
    () => rows.filter((x) => x.r.status !== "noshow" && !!x.r.signatureUrl).map((x) => x.r.signatureUrl as string),
    [rows],
  );
  useEffect(() => {
    const missing = neededPaths.filter((p) => !requested.current.has(p));
    if (missing.length === 0) return;
    missing.forEach((p) => requested.current.add(p));
    db.getSignatureUrls(missing).then((m) => setUrls((cur) => ({ ...cur, ...m }))).catch(() => {});
  }, [neededPaths]);

  const counts = {
    total: rows.length,
    delegate: rows.filter((x) => x.h.kind === "delegate").length,
    noshow: rows.filter((x) => x.r.status === "noshow").length,
    noSign: rows.filter((x) => x.r.status === "done" && !x.r.signatureUrl).length,
  };
  const exportName = `서명모음_${customerName}${from || to ? `_${from || "처음"}~${to || "지금"}` : ""}`;
  const doPng = async () => {
    if (!areaRef.current) return;
    try { await saveElementPng(areaRef.current, exportName); }
    catch { flash("이미지 저장에 실패했어요. 인쇄 → PDF로 저장을 이용해주세요", 4000); }
  };
  const doPrint = async () => {
    if (!areaRef.current) return;
    try { await printElement(areaRef.current, exportName); }
    catch { flash("인쇄 창을 열지 못했어요", 3000); }
  };

  return (
    <div className="ptm-sg">
      <div className="ptm-sg-filters">
        <div className="ptm-type-toggle">
          <button className={`ptm-type-btn ${order === "desc" ? "active" : ""}`} onClick={() => setOrder("desc")}>최신순</button>
          <button className={`ptm-type-btn ${order === "asc" ? "active" : ""}`} onClick={() => setOrder("asc")}>오래된 순</button>
        </div>
        <label className="ptm-sg-range">기간 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /> ~ <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          {(from || to) && <button className="ptm-res-btn" onClick={() => { setFrom(""); setTo(""); }}>전체</button>}
        </label>
        <label className="ptm-acct-check"><input type="checkbox" checked={delegateOnly} onChange={(e) => setDelegateOnly(e.target.checked)} /> 대리 진행만 보기</label>
        <label className="ptm-acct-check"><input type="checkbox" checked={byProduct} onChange={(e) => setByProduct(e.target.checked)} /> 이용권별로 묶기</label>
        <div className="ptm-sg-export">
          <button className="ptm-res-btn" onClick={doPrint}><Printer size={13} /> 인쇄 · PDF</button>
          <button className="ptm-res-btn" onClick={doPng}><ImageDown size={13} /> 이미지(PNG)</button>
        </div>
      </div>

      <div ref={areaRef} className="ptm-export-area ptm-sg-area">
        <div className="ptm-sg-head">
          <b>{customerName} 님 레슨 서명 모음</b>
          <span>{from || to ? `${from || "처음"} ~ ${to || "지금"} · ` : ""}{counts.total}회 (대리 {counts.delegate} · 노쇼 {counts.noshow} · 서명 없음 {counts.noSign})</span>
        </div>
        <div className="ptm-sg-legend">
          <span><i className="ptm-sg-swatch own" />본인 진행</span>
          <span><i className="ptm-sg-swatch delegate" />대리 진행 (대리: 이름)</span>
          <span><i className="ptm-sg-swatch none" />담당 구분 없음 · 확인 필요는 색 없음</span>
        </div>
        {rows.length === 0 && <div className="ptm-table-empty">{allRows.length === 0 ? "완료·노쇼 처리된 레슨이 없어요" : "조건에 맞는 레슨이 없어요"}</div>}
        {groups.map((g) => (
          <div key={g.key} className="ptm-sg-group">
            {byProduct && <div className="ptm-sg-group-title">{g.title} · {g.rows.length}회</div>}
            {g.rows.map(({ r, h, no, total }) => {
              const signedAt = signedAtOf(r.signatureUrl);
              return (
                <div key={r.id} className={`ptm-sg-row ${h.kind}`}>
                  <span className="ptm-sg-no">{no !== null ? `${no}${total ? `/${total}` : ""}회차` : "-"}</span>
                  <span className="ptm-sg-when">{dateLabel(r.date)}<br />{r.time}{r.duration ? ` · ${r.duration}분` : ""}</span>
                  <span className="ptm-sg-sign">
                    {r.status === "noshow" ? <span className="ptm-noshow-mark">NO SHOW</span>
                      : !r.signatureUrl ? <span className="ptm-sg-nosign">서명 없음</span>
                      : urls[r.signatureUrl] ? <img src={urls[r.signatureUrl]} alt="서명" className="ptm-sg-img" />
                      : <span className="ptm-sg-nosign">불러오는 중…</span>}
                    {signedAt && r.status !== "noshow" && <small>서명 {signedAt}</small>}
                  </span>
                  <span className={`ptm-sg-who ${h.kind}`}>{handlerText(h)}</span>
                  <span className={`ptm-sg-status ${r.status}`}>{statusText[r.status]}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
