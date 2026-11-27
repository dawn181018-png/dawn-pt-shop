// 서명 시트 "서명 붙여넣기" 창(관리자 전용): 완료됐지만 서명이 빈 회차에 서명 그림을 넣는다.
// 넣는 방법: 클립보드 붙여넣기(Ctrl+V 또는 버튼) / 파일 선택(휴대폰 사진첩·카톡 이미지). 미리보기 후 "등록"을 눌러야 저장되고,
// 취소하면 아무것도 저장하지 않는다. 저장과 "관리자 입력" 기록은 DB 함수가 함께 처리한다(대표 계정만, 덮어쓰기 불가).
"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, ImagePlus, X } from "lucide-react";
import * as db from "@/lib/db";
import { isAllowedSignatureType, prepareAdminSignature } from "@/lib/adminSignature";
import type { Reservation } from "@/lib/types";

export default function AdminSignaturePaste({ reservationId, label, onClose, onSaved }: {
  reservationId: string;
  label: string; // "3회차 · 2026.09.30(수) 13:00"
  onClose: () => void;
  onSaved: (updated: Reservation) => void;
}) {
  const [picked, setPicked] = useState<{ blob: Blob; url: string; method: "paste" | "file" } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const pickedRef = useRef(picked);
  useEffect(() => { pickedRef.current = picked; }, [picked]);
  useEffect(() => () => { if (pickedRef.current) URL.revokeObjectURL(pickedRef.current.url); }, []);

  const take = async (src: Blob, method: "paste" | "file") => {
    setError("");
    if (!isAllowedSignatureType(src.type)) { setError("PNG 또는 JPG 이미지만 넣을 수 있어요"); return; }
    setWorking(true);
    try {
      const blob = await prepareAdminSignature(src);
      setPicked((cur) => { if (cur) URL.revokeObjectURL(cur.url); return { blob, url: URL.createObjectURL(blob), method }; });
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지를 처리하지 못했어요");
    } finally { setWorking(false); }
  };

  // PC: 창이 열려 있는 동안 Ctrl+V로 붙여넣기
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.kind === "file" && i.type.startsWith("image/"));
      const f = item?.getAsFile();
      if (!f) { setError("클립보드에 이미지가 없어요. 이미지를 복사한 뒤 다시 붙여넣어 주세요"); return; }
      e.preventDefault();
      take(f, "paste");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // 버튼으로 클립보드 읽기(지원하는 브라우저만 — 안 되면 Ctrl+V 안내)
  const readClipboard = async () => {
    setError("");
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t === "image/png" || t === "image/jpeg") || it.types.find((t) => t.startsWith("image/"));
        if (type) { await take(await it.getType(type), "paste"); return; }
      }
      setError("클립보드에 이미지가 없어요. 이미지를 복사한 뒤 다시 눌러주세요");
    } catch {
      setError("이 브라우저는 버튼으로 붙여넣기가 안 돼요. PC는 Ctrl+V, 휴대폰은 '파일 선택'을 써주세요");
    }
  };

  const save = async () => {
    if (!picked || working) return;
    setWorking(true);
    setError("");
    try {
      const path = await db.uploadAdminSignature(reservationId, picked.blob);
      const updated = await db.attachAdminSignature(reservationId, path, picked.method);
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했어요. 다시 시도해주세요");
      setWorking(false);
    }
  };

  return (
    <div className="ptm-overlay" onClick={() => { if (!working) onClose(); }}>
      {/* 그림을 넣은 뒤에는 휴대폰에서 바깥 터치·끌어서 닫기를 막는다(닫기 버튼·취소로만) */}
      <div className="ptm-sheet ptm-asp-sheet" data-lock={picked ? "1" : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="ptm-sheet-head">
          <span className="ptm-sheet-title">서명 붙여넣기</span>
          <button className="ptm-icon-btn" disabled={working} onClick={onClose}><X size={16} /></button>
        </div>
        <p className="ptm-series-desc">{label} — 저장하면 &ldquo;관리자 입력&rdquo; 서명으로 구분되어 기록돼요.</p>
        <div className="ptm-asp-actions">
          <button className="ptm-res-btn" disabled={working} onClick={readClipboard}><ClipboardPaste size={14} /> 클립보드에서 붙여넣기</button>
          <button className="ptm-res-btn" disabled={working} onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> 파일 선택</button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" style={{ display: "none" }}
            onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) take(f, "file"); }} />
        </div>
        <div className="ptm-asp-hint">PC: 이미지를 복사한 뒤 Ctrl+V · 휴대폰: 파일 선택(사진첩·카톡으로 받은 이미지) · PNG/JPG만</div>
        <div className="ptm-asp-preview">
          {working && !picked ? <span className="ptm-ss-nosign">처리 중…</span>
            // eslint-disable-next-line @next/next/no-img-element
            : picked ? <img src={picked.url} alt="서명 미리보기" />
            : <span className="ptm-ss-nosign">여기에 미리보기가 보여요</span>}
        </div>
        {picked && <div className="ptm-asp-hint">넣은 방식: {picked.method === "paste" ? "붙여넣기" : "파일"} · 서명 칸 크기에 맞게 줄이고 바탕을 흰색으로 정리했어요</div>}
        {error && <div className="ptm-asp-error">{error}</div>}
        <div className="ptm-confirm-actions">
          <button className="ptm-series-btn ghost" disabled={working} onClick={onClose}>취소</button>
          <button className="ptm-series-btn primary" disabled={!picked || working} onClick={save}>{working && picked ? "저장 중…" : "등록"}</button>
        </div>
      </div>
    </div>
  );
}
