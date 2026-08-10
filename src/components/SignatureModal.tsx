"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import { X } from "lucide-react";

export default function SignatureModal({
  title,
  onCancel,
  onSubmit,
}: {
  title: string;
  onCancel: () => void;
  onSubmit: (blob: Blob) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
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
  }, []);

  const handleClear = () => {
    padRef.current?.clear();
    setIsEmpty(true);
  };

  const handleSubmit = async () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty() || saving) return;
    setSaving(true);
    try {
      const dataUrl = pad.toDataURL("image/png");
      const blob = await (await fetch(dataUrl)).blob();
      await onSubmit(blob);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ptm-overlay" onClick={onCancel}>
      <div className="ptm-sheet ptm-signature-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ptm-sheet-head">
          <span className="ptm-sheet-title">{title}</span>
          <button className="ptm-icon-btn" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="ptm-signature-hint">아래 영역에 서명해주세요</div>
        <div className="ptm-signature-canvas-wrap">
          <canvas ref={canvasRef} className="ptm-signature-canvas" />
        </div>
        <div className="ptm-signature-actions">
          <button className="ptm-res-btn" onClick={handleClear} disabled={saving}>지우기</button>
          <button className="ptm-save-btn" style={{ marginTop: 0 }} onClick={handleSubmit} disabled={isEmpty || saving}>
            {saving ? "저장 중..." : "서명 완료"}
          </button>
        </div>
      </div>
    </div>
  );
}
