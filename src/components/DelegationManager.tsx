// "대리 레슨" 관리 화면(관리자용): 다른 트레이너에게 기간 동안 지정 고객의 레슨만 맡기는 지정 건을
// 만들고, 목록에서 기간/대상 변경, 즉시 해제, 로그인 링크 복사를 한다. 실제 저장은 부모(PTMemberManager)가 한다.
"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil, Ban, Link2, X, Search } from "lucide-react";
import { today, addDays } from "@/lib/formatUtils";
import type { Customer, LessonDelegation } from "@/lib/types";

export type DelegationFormData = Pick<LessonDelegation, "delegateName" | "delegateEmail" | "customerIds" | "startsOn" | "endsOn">;

type DelegationManagerProps = {
  delegations: LessonDelegation[];
  customers: Customer[];
  // 고객 상세의 "대리 레슨 지정" 버튼으로 들어오면 그 고객이 미리 선택된 새 지정 폼을 연 채로 시작한다
  // (부모가 key를 바꿔 이 컴포넌트를 새로 그린다).
  presetCustomerId: string | null;
  onCreate: (data: DelegationFormData) => Promise<boolean>;
  onUpdate: (id: string, data: Pick<LessonDelegation, "customerIds" | "startsOn" | "endsOn">) => Promise<boolean>;
  onRevoke: (d: LessonDelegation) => void;
  onCopyLoginLink: (d: LessonDelegation) => void;
  flash: (msg: string, ms?: number) => void;
};

export const delegationStatus = (d: LessonDelegation): { label: string; tone: "active" | "upcoming" | "ended" } => {
  if (d.revokedAt) return { label: "해제됨", tone: "ended" };
  const t = today();
  if (t < d.startsOn) return { label: "예정", tone: "upcoming" };
  if (t > d.endsOn) return { label: "종료", tone: "ended" };
  return { label: "진행중", tone: "active" };
};

const isEmailLike = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export default function DelegationManager({
  delegations, customers, presetCustomerId, onCreate, onUpdate, onRevoke, onCopyLoginLink, flash,
}: DelegationManagerProps) {
  // editingId: null = 새 지정, 문자열 = 그 지정 수정(이름/이메일은 고정, 대상/기간만 변경)
  const [formOpen, setFormOpen] = useState(!!presetCustomerId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DelegationFormData>({
    delegateName: "", delegateEmail: "", customerIds: presetCustomerId ? [presetCustomerId] : [], startsOn: today(), endsOn: addDays(today(), 6),
  });
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const openNew = (customerId?: string) => {
    setEditingId(null);
    setForm({ delegateName: "", delegateEmail: "", customerIds: customerId ? [customerId] : [], startsOn: today(), endsOn: addDays(today(), 6) });
    setQuery("");
    setFormOpen(true);
  };
  const openEdit = (d: LessonDelegation) => {
    setEditingId(d.id);
    setForm({ delegateName: d.delegateName, delegateEmail: d.delegateEmail, customerIds: [...d.customerIds], startsOn: d.startsOn, endsOn: d.endsOn });
    setQuery("");
    setFormOpen(true);
  };

  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name || "(삭제된 고객)";
  const matches = useMemo(() => {
    const q = query.trim();
    const list = q ? customers.filter((c) => c.name.includes(q) || (c.phone || "").includes(q)) : customers;
    return list.filter((c) => !c.isDormant || form.customerIds.includes(c.id)).slice(0, 30);
  }, [customers, query, form.customerIds]);
  const toggleCustomer = (id: string) =>
    setForm((f) => ({ ...f, customerIds: f.customerIds.includes(id) ? f.customerIds.filter((x) => x !== id) : [...f.customerIds, id] }));

  const save = async () => {
    if (saving) return;
    if (!editingId) {
      if (!form.delegateName.trim()) { flash("대리 트레이너 이름을 입력해주세요"); return; }
      if (!isEmailLike(form.delegateEmail)) { flash("대리 트레이너 이메일을 정확히 입력해주세요"); return; }
    }
    if (form.customerIds.length === 0) { flash("대상 고객을 1명 이상 선택해주세요"); return; }
    if (!form.startsOn || !form.endsOn || form.endsOn < form.startsOn) { flash("기간을 확인해주세요 (종료일이 시작일보다 빠를 수 없어요)"); return; }
    setSaving(true);
    const ok = editingId
      ? await onUpdate(editingId, { customerIds: form.customerIds, startsOn: form.startsOn, endsOn: form.endsOn })
      : await onCreate({ ...form, delegateName: form.delegateName.trim(), delegateEmail: form.delegateEmail.trim().toLowerCase() });
    setSaving(false);
    if (ok) setFormOpen(false);
  };

  return (
    <>
      <div className="ptm-week-toolbar">
        <div className="ptm-no-product-msg" style={{ margin: 0 }}>
          다른 트레이너에게 지정한 고객의 레슨(예약·완료·서명·운동일지)만 기간 동안 맡겨요. 대리 트레이너는 매출·급여·다른 고객을 볼 수 없어요.
        </div>
        <button className="ptm-quick-add" onClick={() => openNew()}><Plus size={16} /> 대리 레슨 지정</button>
      </div>

      {delegations.length === 0 ? (
        <div className="ptm-table-empty">아직 대리 레슨 지정이 없어요</div>
      ) : (
        <div className="ptm-prod-list" style={{ marginTop: 0 }}>
          {delegations.map((d) => {
            const st = delegationStatus(d);
            const usable = st.tone !== "ended";
            return (
              <div className={`ptm-prod-row${usable ? "" : " depleted"}`} key={d.id}>
                <div className="ptm-prod-top">
                  <div>
                    <span className="ptm-prod-name">{d.delegateName}</span>{" "}
                    <span className={`ptm-badge ${st.tone === "active" ? "forecast" : st.tone === "ended" ? "dormant" : ""}`}>{st.label}</span>
                    <div className="ptm-pending-sale-sub">{d.delegateEmail} · {d.startsOn} ~ {d.endsOn}</div>
                  </div>
                  <div className="ptm-actions">
                    {usable && <button className="ptm-icon-btn" title="로그인 링크 복사" onClick={() => onCopyLoginLink(d)}><Link2 size={14} /></button>}
                    {usable && <button className="ptm-icon-btn" title="대상 고객·기간 변경" onClick={() => openEdit(d)}><Pencil size={14} /></button>}
                    {!d.revokedAt && <button className="ptm-icon-btn" title="즉시 해제" onClick={() => onRevoke(d)}><Ban size={14} /></button>}
                  </div>
                </div>
                <div className="ptm-pending-sale-sub">대상 고객: {d.customerIds.map(nameOf).join(", ")}</div>
              </div>
            );
          })}
        </div>
      )}

      {formOpen && (
        <div className="ptm-overlay" onClick={() => !saving && setFormOpen(false)}>
          <div className="ptm-sheet" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">{editingId ? "대리 레슨 지정 변경" : "대리 레슨 지정"}</span>
              <button className="ptm-icon-btn" onClick={() => setFormOpen(false)} disabled={saving}><X size={16} /></button>
            </div>
            <div className="ptm-row2">
              <div className="ptm-field"><label>대리 트레이너 이름</label>
                <input value={form.delegateName} disabled={!!editingId} onChange={(e) => setForm({ ...form, delegateName: e.target.value })} placeholder="예: 김코치" />
              </div>
              <div className="ptm-field"><label>이메일 (로그인용)</label>
                <input type="email" value={form.delegateEmail} disabled={!!editingId} onChange={(e) => setForm({ ...form, delegateEmail: e.target.value })} placeholder="coach@example.com" />
              </div>
            </div>
            <div className="ptm-row2">
              <div className="ptm-field"><label>시작일</label>
                <input type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} />
              </div>
              <div className="ptm-field"><label>종료일 (이날까지 가능)</label>
                <input type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />
              </div>
            </div>
            <div className="ptm-field"><label>대상 고객 ({form.customerIds.length}명 선택)</label>
              {form.customerIds.length > 0 && (
                <div className="ptm-actions" style={{ flexWrap: "wrap", marginBottom: 6 }}>
                  {form.customerIds.map((id) => (
                    <span key={id} className="ptm-badge forecast" style={{ cursor: "pointer" }} onClick={() => toggleCustomer(id)}>{nameOf(id)} ✕</span>
                  ))}
                </div>
              )}
              <div className="ptm-search" style={{ marginBottom: 6 }}>
                <Search size={15} color="#8a94a6" />
                <input placeholder="이름 또는 전화번호로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="ptm-delegation-pick">
                {matches.map((c) => (
                  <label key={c.id} className="ptm-contract-agree" style={{ padding: "5px 2px", fontWeight: 500 }}>
                    <input type="checkbox" checked={form.customerIds.includes(c.id)} onChange={() => toggleCustomer(c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
            <button className="ptm-save-btn" onClick={save} disabled={saving}>{saving ? "저장 중..." : editingId ? "변경 저장" : "지정하기"}</button>
          </div>
        </div>
      )}
    </>
  );
}
