// 고객 상세 > 서명 탭 "서명 시트"(관리자 전용): 이용권 1개를 종이 출석부처럼 한 장(50칸: 왼쪽 1~25, 오른쪽 26~50)에 보여주고
// 그대로 이미지(PNG)·PDF·인쇄로 내보낸다. 고객에게 "이만큼 사용하셨습니다"를 보여주는 용도라 결제금액·연락처·메모는 넣지 않는다.
// 칸 채우는 기준은 lib/signatureSheet(레슨에 저장된 이용권 연결 + 날짜순), 담당 구분은 lib/delegateSettlement(classifyLesson).
// 서명 파일은 관리자 권한으로 직접 받아 브라우저 안에서만 쓰는 임시 주소로 보여준다(공개 주소를 만들지 않음).
// 조회와 저장만 한다 — 예약·서명·세션 차감·잔여 횟수는 바꾸지 않는다.
"use client";

import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { ChevronLeft, ChevronRight, ImageDown, Printer, Share2, Images, X } from "lucide-react";
import * as db from "@/lib/db";
import { today, toLocalDateStr } from "@/lib/formatUtils";
import { printElement, saveElementPng, shareOrSaveElementPng, waitForElementImages } from "@/lib/exportUtils";
import { classifyLesson, type LessonHandler, type StatusLogActor } from "@/lib/delegateSettlement";
import { buildSheet, defaultSheetProductId, sheetFileName, splitColumns, type SheetCell } from "@/lib/signatureSheet";
import type { PassTransfer, Product, Reservation } from "@/lib/types";

const PAGE_W = 794; // A4 세로(96dpi) — 화면에서는 이 크기를 줄여서 보여주고, 저장은 이 크기의 2배로
const PAGE_H = 1120;
const weekdayShort = ["일", "월", "화", "수", "목", "금", "토"];
const dotDate = (d: string) => `${d.slice(0, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;
const shortDate = (d: string) => {
  const x = new Date(`${d}T00:00:00`);
  return `${String(x.getFullYear()).slice(2)}.${x.getMonth() + 1}.${x.getDate()}(${weekdayShort[x.getDay()]})`;
};
const statusText: Record<string, string> = { done: "완료", noshow: "노쇼", cancelled: "취소", scheduled: "예약됨" };
const handlerText = (h: LessonHandler) =>
  h.kind === "delegate" ? `대리: ${h.delegateName || "이름 없음"}`
  : h.kind === "check" ? `확인 필요 (${h.note || "대리 기록"})`
  : h.kind === "owner" ? "본인" : "담당 구분 없음";

export default function SignatureSheet({
  customerName, products, reservations, transfers, firstDay, statusLogs, flash,
}: {
  customerName: string;
  products: Product[]; // 이 고객의 이용권(보관 포함 — 선택 목록에서는 보관된 것을 뺀다)
  reservations: Reservation[]; // 이 고객의 예약 전체
  transfers: PassTransfer[];
  firstDay: string | null;
  statusLogs?: Map<string, StatusLogActor>;
  flash: (msg: string, ms?: number) => void;
}) {
  const choices = useMemo(
    () => products.filter((p) => p.type === "session" && !p.archivedAt).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [products],
  );
  const [pickedId, setPickedId] = useState("");
  const productId = choices.some((p) => p.id === pickedId) ? pickedId : defaultSheetProductId(choices);
  const product = choices.find((p) => p.id === productId) || null;
  const todayStr = today();
  const sheet = useMemo(() => (product ? buildSheet(product, reservations, transfers, todayStr) : null), [product, reservations, transfers, todayStr]);
  const [pageIdx, setPageIdx] = useState(0);
  const page = sheet ? Math.min(pageIdx, sheet.pages.length - 1) : 0;
  const [showDelegate, setShowDelegate] = useState(true); // 고객에게 보여줄 때 끌 수 있게(기본 켬)
  const [showTime, setShowTime] = useState(true);
  const [showPlanned, setShowPlanned] = useState(true);
  const [zoom, setZoom] = useState<SheetCell | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportAll, setExportAll] = useState(false); // 전체 저장·전체 인쇄 때만 모든 장을 화면 밖에 그린다

  // 레슨별 담당(본인/대리/구분 없음) — 정산·서명 목록과 같은 판단(classifyLesson)
  const handlers = useMemo(
    () => new Map(reservations.map((r) => [r.id, classifyLesson(r, firstDay, statusLogs?.get(r.id))])),
    [reservations, firstDay, statusLogs],
  );
  const handlerOf = (r: Reservation): LessonHandler => handlers.get(r.id) || classifyLesson(r, firstDay, statusLogs?.get(r.id));

  // 서명 파일: 보이는 장(전체 저장 중이면 모든 장)만 받아온다. 한 번 받은 파일은 다시 받지 않는다.
  const [blobs, setBlobs] = useState<Record<string, string>>({});
  const requested = useRef<Set<string>>(new Set());
  const wantedPaths = useMemo(() => {
    if (!sheet) return [];
    const cells = exportAll ? sheet.cells : sheet.pages[page] || [];
    return cells.flatMap((c) => (c.kind === "lesson" && c.r.status === "done" && c.r.signatureUrl ? [c.r.signatureUrl] : []));
  }, [sheet, page, exportAll]);
  useEffect(() => {
    const missing = wantedPaths.filter((p) => !requested.current.has(p));
    if (missing.length === 0) return;
    missing.forEach((p) => requested.current.add(p));
    db.getSignatureBlobUrls(missing).then((m) => setBlobs((cur) => ({ ...cur, ...m }))).catch(() => {});
  }, [wantedPaths]);
  const blobsRef = useRef(blobs);
  useEffect(() => { blobsRef.current = blobs; }, [blobs]);
  useEffect(() => () => { Object.values(blobsRef.current).forEach((u) => URL.revokeObjectURL(u)); }, []);
  const allLoaded = wantedPaths.every((p) => p in blobs);

  // 화면 너비(PC는 높이도)에 맞춰 한 장을 통째로 줄여 보여준다 → 휴대폰에서도 가로 스크롤 없음
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const byW = w / PAGE_W;
      const byH = window.innerWidth > 640 ? Math.max(0.45, (window.innerHeight * 0.88 - 170) / PAGE_H) : Infinity;
      setScale(Math.min(1, byW, byH));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); };
  }, [product]);

  const pageRef = useRef<HTMLDivElement>(null);
  const allRef = useRef<HTMLDivElement>(null);
  const fileFor = (i: number) => sheetFileName(customerName, product?.name || "이용권", todayStr, sheet ? { no: i + 1, of: sheet.pages.length } : undefined);
  const waitReady = async (el: HTMLElement) => {
    for (let i = 0; i < 50 && !el.isConnected; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 80));
    await waitForElementImages(el);
  };
  const run = async (job: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await job(); } catch { flash("저장에 실패했어요. 잠시 뒤 다시 시도해주세요", 3500); } finally { setBusy(false); }
  };
  const savePage = () => run(async () => {
    if (!pageRef.current) return;
    await waitReady(pageRef.current);
    await saveElementPng(pageRef.current, fileFor(page));
  });
  const sharePage = () => run(async () => {
    if (!pageRef.current) return;
    await waitReady(pageRef.current);
    const r = await shareOrSaveElementPng(pageRef.current, fileFor(page), `${customerName} 서명 시트`);
    if (r === "saved") flash("이 브라우저는 바로 공유가 안 돼서 이미지로 저장했어요. 저장된 이미지를 보내주세요", 4000);
  });
  // 전체: 모든 장을 화면 밖에 그린 뒤 장마다 PNG로 저장(또는 한 번에 인쇄·PDF)
  const withAllPages = (job: (pages: HTMLElement[], root: HTMLElement) => Promise<void>) => run(async () => {
    setExportAll(true);
    try {
      for (let i = 0; i < 60 && !allRef.current; i++) await new Promise((r) => setTimeout(r, 50));
      const root = allRef.current;
      if (!root) throw new Error("no root");
      for (let i = 0; i < 100 && wantedPathsRef.current.some((p) => !(p in blobsRef.current)); i++) await new Promise((r) => setTimeout(r, 100));
      await waitReady(root);
      await job(Array.from(root.querySelectorAll<HTMLElement>(".ptm-ss-page")), root);
    } finally { setExportAll(false); }
  });
  const wantedPathsRef = useRef(wantedPaths);
  useEffect(() => { wantedPathsRef.current = wantedPaths; }, [wantedPaths]);
  const saveAll = () => withAllPages(async (pages) => {
    for (let i = 0; i < pages.length; i++) await saveElementPng(pages[i], fileFor(i));
    if (pages.length > 1) flash(`${pages.length}장을 이미지로 저장했어요`, 2500);
  });
  const printAll = () => withAllPages(async (_pages, root) => {
    await printElement(root, `${customerName} 서명 시트`, "@page { size:A4 portrait; margin:0; } .ptm-ss-page { box-shadow:none !important; margin:0 !important; break-after:page; } .ptm-ss-page:last-child { break-after:auto; }");
  });

  if (choices.length === 0) return <div className="ptm-table-empty">횟수제 이용권이 없어요</div>;
  if (!product || !sheet) return null;

  const renderCell = (c: SheetCell) => {
    const base = `ptm-ss-cell ${c.kind}`;
    if (c.kind === "lesson") {
      const h = handlerOf(c.r);
      const dlg = showDelegate && h.kind === "delegate";
      const sig = c.r.signatureUrl ? blobs[c.r.signatureUrl] : undefined;
      return (
        <button key={c.no} type="button" className={`${base}${dlg ? " delegate" : ""}`} onClick={() => setZoom(c)}>
          <span className="ptm-ss-no">{c.no}</span>
          <span className="ptm-ss-date">{shortDate(c.r.date)}{showTime && <small>{c.r.time}</small>}</span>
          <span className="ptm-ss-sign">
            {c.r.status === "noshow" ? <span className="ptm-ss-noshow">NO SHOW</span>
              : !c.r.signatureUrl ? <span className="ptm-ss-nosign">서명 없음</span>
              : sig ? <img src={sig} alt="" /> : <span className="ptm-ss-nosign">…</span>}
            {dlg && <span className="ptm-ss-dlg">대리: {h.delegateName || "이름 없음"}</span>}
          </span>
        </button>
      );
    }
    if (c.kind === "transfer") return <div key={c.no} className={base}><span className="ptm-ss-no">{c.no}</span><span className="ptm-ss-date">{shortDate(c.date)}</span><span className="ptm-ss-sign"><span className="ptm-ss-note">양도</span></span></div>;
    if (c.kind === "unrecorded") return <div key={c.no} className={base}><span className="ptm-ss-no">{c.no}</span><span className="ptm-ss-date" /><span className="ptm-ss-sign"><span className="ptm-ss-note">기록 없는 사용</span></span></div>;
    if (c.kind === "scheduled" && showPlanned) return <div key={c.no} className={base}><span className="ptm-ss-no">{c.no}</span><span className="ptm-ss-date">{shortDate(c.r.date)}{showTime && <small>{c.r.time}</small>}</span><span className="ptm-ss-sign"><span className="ptm-ss-planned">예정</span></span></div>;
    return <div key={c.no} className="ptm-ss-cell empty"><span className="ptm-ss-no">{c.no}</span><span className="ptm-ss-date" /><span className="ptm-ss-sign" /></div>;
  };
  const renderPage = (cells: SheetCell[], i: number, ref?: Ref<HTMLDivElement>) => {
    const [left, right] = splitColumns(cells);
    return (
      <div key={i} ref={ref} className="ptm-ss-page" style={{ width: PAGE_W, height: PAGE_H }}>
        <div className="ptm-ss-head">
          <div className="ptm-ss-brand">DAWN FITNESS <span>레슨 서명 시트</span></div>
          <div className="ptm-ss-title">
            <div><b>{customerName}</b> 님 · {product.name}</div>
            {sheet.pages.length > 1 && <span className="ptm-ss-pageno">{i + 1}/{sheet.pages.length}장</span>}
          </div>
          <div className="ptm-ss-summary">
            <span>사용 <b>{sheet.used}</b>회</span><span>남은 <b>{sheet.remain}</b>회</span><span>총 <b>{sheet.total}</b>회</span>
          </div>
          <div className="ptm-ss-range">{sheet.firstDate ? `첫 수업 ${dotDate(sheet.firstDate)} ~ 최근 수업 ${dotDate(sheet.lastDate as string)}` : "아직 진행한 수업이 없어요"}</div>
        </div>
        <div className="ptm-ss-cols">
          <div className="ptm-ss-col">{left.map(renderCell)}</div>
          <div className="ptm-ss-col">{right.map(renderCell)}</div>
        </div>
        <div className="ptm-ss-foot">
          {showDelegate && <span><i className="ptm-ss-swatch" /> 대리 트레이너 진행</span>}
          <span>노쇼는 1회 사용으로 계산돼요</span>
          <span>{dotDate(todayStr)} 기준</span>
        </div>
      </div>
    );
  };

  const zoomInfo = zoom && zoom.kind === "lesson" ? { r: zoom.r, h: handlerOf(zoom.r), sig: zoom.r.signatureUrl ? blobs[zoom.r.signatureUrl] : undefined } : null;

  return (
    <div className="ptm-ss">
      <div className="ptm-ss-bar">
        <select className="ptm-sort" value={product.id} onChange={(e) => { setPickedId(e.target.value); setPageIdx(0); }}>
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.createdAt ? dotDate(toLocalDateStr(new Date(p.createdAt))) : ""} 등록 · {p.usedSessions}/{p.totalSessions}회{p.id === defaultSheetProductId(choices) ? " (사용 중)" : ""}
            </option>
          ))}
        </select>
        <label className="ptm-acct-check"><input type="checkbox" checked={showDelegate} onChange={(e) => setShowDelegate(e.target.checked)} /> 대리 표시</label>
        <label className="ptm-acct-check"><input type="checkbox" checked={showTime} onChange={(e) => setShowTime(e.target.checked)} /> 시간</label>
        <label className="ptm-acct-check"><input type="checkbox" checked={showPlanned} onChange={(e) => setShowPlanned(e.target.checked)} /> 예정</label>
        {sheet.pages.length > 1 && (
          <span className="ptm-ss-pager">
            <button className="ptm-nav-btn" disabled={page === 0} onClick={() => setPageIdx(page - 1)}><ChevronLeft size={15} /></button>
            <b>{page + 1}/{sheet.pages.length}장</b>
            <button className="ptm-nav-btn" disabled={page >= sheet.pages.length - 1} onClick={() => setPageIdx(page + 1)}><ChevronRight size={15} /></button>
          </span>
        )}
        <span className="ptm-ss-actions">
          <button className="ptm-res-btn" disabled={busy || !allLoaded} onClick={savePage}><ImageDown size={13} /> 이미지로 저장</button>
          {sheet.pages.length > 1 && <button className="ptm-res-btn" disabled={busy} onClick={saveAll}><Images size={13} /> 전체 저장</button>}
          <button className="ptm-res-btn" disabled={busy || !allLoaded} onClick={sharePage}><Share2 size={13} /> 공유</button>
          <button className="ptm-res-btn" disabled={busy} onClick={printAll}><Printer size={13} /> 인쇄 · PDF</button>
        </span>
      </div>

      <div ref={boxRef} className="ptm-ss-box" style={{ height: PAGE_H * scale }}>
        <div style={{ width: PAGE_W, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          {renderPage(sheet.pages[page] || [], page, pageRef)}
        </div>
      </div>
      <div className="ptm-ss-basis">
        칸 나누기 기준: 레슨에 저장된 이용권(실제로 차감된 이용권) · 날짜순. 레슨 {sheet.lessonCount}회
        {sheet.transferCount > 0 && ` · 양도 ${sheet.transferCount}회`}{sheet.unrecorded > 0 && ` · 기록 없는 사용 ${sheet.unrecorded}회`}.
        {sheet.mismatch && <> {sheet.mismatch}.</>}{sheet.overTotal && " 총 횟수보다 많은 칸이 채워졌어요."}
      </div>

      {exportAll && (
        <div ref={allRef} className="ptm-ss-offscreen" aria-hidden="true">
          {sheet.pages.map((cells, i) => renderPage(cells, i))}
        </div>
      )}

      {zoom && (
        <div className="ptm-overlay" onClick={() => setZoom(null)}>
          <div className="ptm-sheet ptm-ss-zoom" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">{zoom.no}회차</span>
              <button className="ptm-icon-btn" onClick={() => setZoom(null)}><X size={16} /></button>
            </div>
            {zoomInfo && (
              <>
                <div className="ptm-ss-zoom-sign">
                  {zoomInfo.r.status === "noshow" ? <span className="ptm-ss-noshow big">NO SHOW</span>
                    : zoomInfo.sig ? <img src={zoomInfo.sig} alt="서명" /> : <span className="ptm-ss-nosign">서명 없음</span>}
                </div>
                <ul className="ptm-acct-diff">
                  <li>날짜 {dotDate(zoomInfo.r.date)} ({weekdayShort[new Date(`${zoomInfo.r.date}T00:00:00`).getDay()]}) · {zoomInfo.r.time}{zoomInfo.r.duration ? ` · ${zoomInfo.r.duration}분` : ""}</li>
                  <li>담당 {handlerText(zoomInfo.h)}</li>
                  <li>상태 {statusText[zoomInfo.r.status]}</li>
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
