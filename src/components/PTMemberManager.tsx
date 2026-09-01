// 기존 단일 파일 프로토타입(회원관리 시스템 코드.jsx)을 Next.js + Supabase 구조로 이식.
// 원본은 window.storage(로컬 key-value)에 JSON 블롭을 저장했고, 여기서는 Supabase 테이블에
// 행 단위로 저장한다.
"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Search, Phone, Trash2, Pencil, X, Minus,
  CalendarClock, Check, UserX, Ban, Moon, ChevronLeft, ChevronRight, Users, CalendarDays,
  Wallet, Settings2, Tag, Receipt, TrendingUp, Target, ShoppingBag,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import * as db from "@/lib/db";
import SignatureModal from "./SignatureModal";
import ProductSaleWizard from "./ProductSaleWizard";
import { getCustomerWorkoutLogs, matchBodyPartTags } from "@/lib/workoutLog";
import { CATALOG_CATEGORIES, CATEGORY_LABELS, isCountBased, categoryToProductType, formatCatalogSummary } from "@/lib/catalogCategory";
import { toLocalDateStr, today, addDays, addMonths, fmtNum, parseNum, formatPhone, emptyToNull } from "@/lib/formatUtils";
import type { Customer, Product, ProductType, PaymentMethod, Reservation, ReservationStatus, CatalogItem, CatalogCategory, PeriodUnit, RenewalForecast } from "@/lib/types";
import "./ptm.css";

function SignatureThumb({ path }: { path?: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (path) db.getSignatureUrl(path).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [path]);
  if (!url) return null;
  return <img src={url} alt="서명" className="ptm-signature-thumb" onClick={() => window.open(url, "_blank")} />;
}

// 폼 상태는 실제 엔티티 타입(Customer/Product 등)과는 다르게, id/customerId 같은 필드가 없거나
// 날짜가 문자열(입력용)인 등 조금씩 모양이 다르다. 그래서 엔티티 타입을 그대로 쓰지 않고 폼 전용
// 타입을 따로 둔다 — "새 폼"과 "기존 항목 불러와서 수정" 양쪽 다 이 타입 하나로 받을 수 있게,
// 엔티티 쪽에서 없을 수 있는 필드는 optional로 둔다.
type CustomerFormData = { name: string; phone?: string; birthdate?: string | null; email?: string; memo?: string };
const emptyCustomer: CustomerFormData = { name: "", phone: "", birthdate: "", email: "", memo: "" };
type ProductFormData = {
  name: string; type: ProductType;
  totalSessions: number; usedSessions: number;
  startDate: string; endDate?: string | null;
  sessionDuration: number; listPrice: number; price: number; paidAmount: number; paymentMethod: PaymentMethod;
  createdAt?: string;
};
const emptyProduct: ProductFormData = {
  name: "", type: "session",
  totalSessions: 10, usedSessions: 0,
  startDate: toLocalDateStr(new Date()), endDate: "",
  sessionDuration: 50, listPrice: 0, price: 0, paidAmount: 0, paymentMethod: "card",
  createdAt: toLocalDateStr(new Date()),
};
type CatalogFormData = { name: string; category: CatalogCategory; sessions: number; months: number; periodUnit: PeriodUnit; price: number; sessionDuration?: number };
const emptyCatalogItem: CatalogFormData = { name: "", category: "daily_pt", sessions: 10, months: 1, periodUnit: "month", price: 0, sessionDuration: 50 };
// 숫자 입력칸(분/반복횟수)은 입력 중엔 문자열로 들어왔다가 실제로 쓸 때 Number()로 변환하는 방식이라
// number | string 양쪽을 다 허용한다 — 이건 폼 입력의 자연스러운 특성이라 굳이 강제 변환하지 않는다.
type ReservationFormData = { date: string; time: string; duration: number | string; memo?: string; repeat: string; repeatCount?: number | string };
const defaultSettings = { baseSalary: 300000, commissionRate: 10, deductionRate: 3.3 };
type PayrollFormData = { baseSalary: number; commissionRate: number | string; deductionRate: number | string };

const nowTime = () => new Date().toTimeString().slice(0, 5);
const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
const repeatLabel: Record<string, string> = { none: "안함", daily: "매일", weekly: "매주", biweekly: "2주마다", monthly: "매월", yearly: "매년" };
// 반복 선택 시 "취소 전까지 계속" 느낌을 주기 위해 기본으로 넉넉히 생성해두는 횟수 (나중에 직접 줄이거나 늘릴 수 있음)
const defaultRepeatCount = { none: 1, daily: 90, weekly: 52, biweekly: 26, monthly: 24, yearly: 5 };
// "매주"를 고르면 다음 달까지 쭉 뻗어나가지 않도록, 시작일이 속한 달 안에서만 반복되는 횟수로 기본값을 잡는다.
// (그 이후 반복은 다음 달 초에 다시 등록하는 방식 — 예약이 무한정 쌓여 조회 성능/1000행 제한에 영향을 주는 걸 방지)
const getDefaultRepeatCount = (repeatType: string, dateStr: string): number => {
  if (repeatType === "weekly") {
    const startMonth = new Date(dateStr).getMonth();
    let n = 0;
    while (new Date(addDays(dateStr, 7 * n)).getMonth() === startMonth) n++;
    return Math.max(1, n);
  }
  return (defaultRepeatCount as Record<string, number>)[repeatType];
};
const addRepeatInterval = (dateStr: string, repeatType: string, n: number): string => {
  if (repeatType === "daily") return addDays(dateStr, n);
  if (repeatType === "weekly") return addDays(dateStr, 7 * n);
  if (repeatType === "biweekly") return addDays(dateStr, 14 * n);
  if (repeatType === "monthly") return addMonths(dateStr, n);
  if (repeatType === "yearly") return addMonths(dateStr, 12 * n);
  return dateStr;
};
const mondayOf = (dateStr: string): string => { const d = new Date(dateStr); const day = d.getDay(); return addDays(dateStr, day === 0 ? -6 : 1 - day); };
const koDate = (dateStr: string): string => { const d = new Date(dateStr); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
const parseBulkLine = (line: string) => {
  const sep = line.includes("\t") ? "\t" : ",";
  const parts = line.split(sep).map((s) => s.trim());
  return { name: parts[0] || "", phone: parts[1] || "", birthdate: parts[2] || "", email: parts[3] || "", memo: parts[4] || "" };
};
const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];
const weekdayFull = ["일", "월", "화", "수", "목", "금", "토"];
const firstOfMonth = (y: number, m: number): string => `${y}-${String(m).padStart(2, "0")}-01`;
const lastOfMonth = (y: number, m: number): string => { const { y: ny, m: nm } = shiftMonthYM(y, m, 1); return addDays(firstOfMonth(ny, nm), -1); };
const shiftMonthYM = (y: number, m: number, delta: number): { y: number; m: number } => {
  const total = y * 12 + (m - 1) + delta;
  return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 + 1 };
};

function daysBetween(a: string, b: string): number { return Math.ceil((new Date(a).getTime() - new Date(b).getTime()) / 86400000); }
function daysUntil(dateStr: string): number { return Math.ceil((new Date(dateStr).getTime() - new Date(today()).getTime()) / 86400000); }
function urgency(p?: Product | null): "ok" | "critical" | "warn" {
  if (!p) return "ok";
  if (p.type === "session") {
    const remain = p.totalSessions - p.usedSessions;
    if (remain <= 1) return "critical";
    if (remain <= 3) return "warn";
    return "ok";
  }
  const remain = daysUntil(p.endDate as string);
  if (remain <= 3) return "critical";
  if (remain <= 10) return "warn";
  return "ok";
}
function remainLabel(p: Product): string {
  if (p.type === "session") return `${p.totalSessions - p.usedSessions}회 남음 / 총 ${p.totalSessions}회`;
  const remain = daysUntil(p.endDate as string);
  return remain < 0 ? `만료 ${Math.abs(remain)}일 지남` : `${remain}일 남음`;
}
function shortRemain(p: Product): string {
  if (p.type === "session") return `${p.totalSessions - p.usedSessions}회`;
  const remain = daysUntil(p.endDate as string);
  return remain < 0 ? "만료" : `${remain}일`;
}
function progressPct(p: Product): number {
  if (p.type === "session") return Math.max(0, Math.min(100, (p.usedSessions / p.totalSessions) * 100));
  const total = daysBetween(p.endDate as string, p.startDate) || 1;
  const used = daysBetween(today(), p.startDate);
  return Math.max(0, Math.min(100, (used / total) * 100));
}
const countsAsUsed = (status: string): boolean => status === "done" || status === "noshow";
const getPaidAmount = (p: Partial<Product> & { paid?: boolean }): number => (p.paidAmount !== undefined ? Number(p.paidAmount) || 0 : (p.paid ? Number(p.price || 0) : 0));
const getUnpaidAmount = (p: Partial<Product> & { paid?: boolean }): number => Math.max(0, Number(p.price || 0) - getPaidAmount(p));
const isFullyPaid = (p: Partial<Product> & { paid?: boolean }): boolean => getUnpaidAmount(p) <= 0;
const statusLabel: Record<string, string> = { scheduled: "예약됨", done: "완료", noshow: "노쇼", cancelled: "취소" };
const paymentMethodLabel: Record<string, string> = { card: "카드", cash: "현금", transfer: "계좌이체" };
const urgencyRank: Record<string, number> = { critical: 0, warn: 1, ok: 2 };

// 매출 계획(재등록 관리) 화면의 "주요 운동시간대" / "주당 평균 횟수" 계산용.
// 자정~새벽(0-5시)은 밤 늦게 이어지는 활동으로 보고 "야간" 구간에 포함시킨다(hour+24 트릭).
const TIME_SLOTS = [
  { label: "아침 (6-9시)", start: 6, end: 9 },
  { label: "오전 (9-12시)", start: 9, end: 12 },
  { label: "오후 (12-17시)", start: 12, end: 17 },
  { label: "저녁 (17-21시)", start: 17, end: 21 },
  { label: "야간 (21시 이후)", start: 21, end: 30 },
];
const getTimeSlotLabel = (time?: string | null): string | null => {
  const h = Number((time || "").split(":")[0]);
  if (Number.isNaN(h)) return null;
  const hour = h < 6 ? h + 24 : h;
  return (TIME_SLOTS.find((s) => hour >= s.start && hour < s.end) || TIME_SLOTS[TIME_SLOTS.length - 1]).label;
};
// doneReservations: 이미 status === "done"으로 필터링된, 특정 고객의 예약 목록
function computeAttendanceStats(doneReservations?: Reservation[] | null) {
  if (!doneReservations || doneReservations.length === 0) {
    return { timeSlotLabel: "-", weeklyAvgLabel: "-", recentVisits: [] as string[] };
  }
  const sorted = [...doneReservations].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const slotCounts: Record<string, number> = {};
  sorted.forEach((r) => {
    const label = getTimeSlotLabel(r.time);
    if (label) slotCounts[label] = (slotCounts[label] || 0) + 1;
  });
  let timeSlotLabel = "-", maxCount = 0;
  TIME_SLOTS.forEach((s) => {
    const c = slotCounts[s.label] || 0;
    if (c > maxCount) { maxCount = c; timeSlotLabel = s.label; }
  });

  // 기간: 최근 12주(84일). 다만 첫 완료 예약일이 그보다 최근이면(=등록 12주 미만) 첫 완료일부터 오늘까지로 좁힌다.
  const firstDoneDate = sorted[0].date;
  const windowStart = addDays(today(), -84);
  const periodStart = firstDoneDate > windowStart ? firstDoneDate : windowStart;
  const periodWeeks = Math.max(1, daysBetween(today(), periodStart) / 7);
  const countInPeriod = sorted.filter((r) => r.date >= periodStart).length;
  const weeklyAvgLabel = `주 ${(countInPeriod / periodWeeks).toFixed(1)}회`;

  const recentVisits = sorted.slice(-5).reverse().map((r) => r.date);
  return { timeSlotLabel, weeklyAvgLabel, recentVisits };
}

const HOUR_START = 6, HOUR_END = 23, HOUR_PX = 36;
const timeTopPx = (time: string): number => { const [h, m] = time.split(":").map(Number); return ((h - HOUR_START) * 60 + m) * (HOUR_PX / 60); };
const durHeightPx = (duration: number): number => Math.max(22, duration * (HOUR_PX / 60));
// 그리드 클릭/드래그로 시간을 잡을 땐 정각·30분 단위로만 스냅한다.
// 15분/20분처럼 세밀한 시간은 예약 등록 후 "날짜·시간 수정"에서 5분 단위로 조정하면 된다.
const pxToTime = (offsetY: number): string => {
  let totalMin = HOUR_START * 60 + offsetY / (HOUR_PX / 60);
  totalMin = Math.round(totalMin / 30) * 30;
  totalMin = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - 30, totalMin));
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const shiftMonth = (y: number, m: number, delta: number): { y: number; m: number } => {
  const total = y * 12 + (m - 1) + delta;
  return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 + 1 };
};
const monthKey = (y: number, m: number): string => `${y}-${String(m).padStart(2, "0")}`;
const timeToMin = (t: string): number => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const isPastDateTime = (date: string, time: string): boolean => new Date(`${date}T${time}:00`).getTime() < Date.now();
const minToTime = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// allReservations useMemo가 예약(Reservation)에 화면 표시용 필드를 덧붙인 것. 스케줄 화면 대부분이
// 이 확장된 모양을 다룬다 (예약 상세 시트 등 일부는 여전히 원본 Reservation을 그대로 다룬다).
type DisplayReservation = Reservation & {
  customerName: string;
  productName: string;
  unitPrice: number;
  remainCount: number | null;
  totalSessions: number | null;
};
// 예약 액션 함수들(취소/삭제/완료 요청)은 원본 Reservation과 DisplayReservation 양쪽에서 다 호출되므로,
// customerName/productName은 있을 수도 없을 수도 있는 걸로 느슨하게 받는다.
type ReservationLike = Reservation & { customerName?: string; productName?: string };
type LaidOutReservation = DisplayReservation & { start: number; end: number; col?: number; columnCount?: number };

// 같은 시간대에 겹치는 예약을 나란히 배치하기 위한 열(column) 계산
function layoutDayReservations(dayRes: DisplayReservation[]): LaidOutReservation[] {
  const events: LaidOutReservation[] = dayRes
    .map((r) => ({ ...r, start: timeToMin(r.time), end: timeToMin(r.time) + (r.duration || 50) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const result: { events: LaidOutReservation[]; maxEnd: number }[] = [];
  let cluster: { events: LaidOutReservation[]; maxEnd: number } | null = null;
  events.forEach((ev) => {
    if (cluster && ev.start < cluster.maxEnd) {
      cluster.events.push(ev);
      cluster.maxEnd = Math.max(cluster.maxEnd, ev.end);
    } else {
      cluster = { events: [ev], maxEnd: ev.end };
      result.push(cluster);
    }
  });
  const laidOut: LaidOutReservation[] = [];
  result.forEach((c) => {
    const colEnds: number[] = [];
    c.events.forEach((ev) => {
      let placed = false;
      for (let i = 0; i < colEnds.length; i++) {
        if (colEnds[i] <= ev.start) { colEnds[i] = ev.end; ev.col = i; placed = true; break; }
      }
      if (!placed) { ev.col = colEnds.length; colEnds.push(ev.end); }
    });
    const columnCount = colEnds.length;
    c.events.forEach((ev) => laidOut.push({ ...ev, columnCount }));
  });
  return laidOut;
}

export default function PTMemberManager() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("schedule");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState("urgent");
  const [quickFilter, setQuickFilter] = useState<string | null>(null); // remain5 | remain10 | inactive10 | inactive20 | dormant | urgent | unpaid | null
  const [toast, setToast] = useState("");

  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [customerForm, setCustomerForm] = useState<CustomerFormData>(emptyCustomer);

  const [showProductForm, setShowProductForm] = useState(false);
  const [productFormCustomerId, setProductFormCustomerId] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<ProductFormData>(emptyProduct);

  const [customerDetailId, setCustomerDetailId] = useState<string | null>(null);
  const [customerDetailTab, setCustomerDetailTab] = useState("home");
  const [expandedWorkoutNotes, setExpandedWorkoutNotes] = useState<Record<string, boolean>>({});

  // ---- 공용 삭제 확인 다이얼로그 ----
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void; confirmLabel: string } | null>(null);
  const askConfirm = (message: string, onConfirm: () => void, confirmLabel = "삭제") => setConfirmState({ message, onConfirm, confirmLabel });

  const [resSheetProductId, setResSheetProductId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; reservation: LaidOutReservation } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; reservation: LaidOutReservation } | null>(null);
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHoverInfo = (r: LaidOutReservation, x: number, y: number) => {
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current);
    setHoverInfo({ x, y, reservation: r });
  };
  const scheduleHideHoverInfo = () => {
    hoverHideTimer.current = setTimeout(() => setHoverInfo(null), 180);
  };
  const cancelHideHoverInfo = () => {
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current);
  };
  const [hasHoverPointer, setHasHoverPointer] = useState(() =>
    typeof window === "undefined" || !window.matchMedia
      ? true
      : window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setHasHoverPointer(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const [resForm, setResForm] = useState<ReservationFormData>({ date: today(), time: nowTime(), duration: 50, memo: "", repeat: "none", repeatCount: 4 });

  const [weekStart, setWeekStart] = useState(mondayOf(today()));
  const [nowClock, setNowClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNowClock(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickForm, setQuickForm] = useState<ReservationFormData & { customerId: string; productId: string }>({ customerId: "", productId: "", date: today(), time: "18:00", duration: 50, memo: "", repeat: "none", repeatCount: 4 });
  const [quickSearch, setQuickSearch] = useState("");
  const [quickIsNew, setQuickIsNew] = useState(false);
  const [quickIsMisc, setQuickIsMisc] = useState(false);
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");

  const now = new Date();
  const [payYear, setPayYear] = useState(now.getFullYear());
  const [payMonth, setPayMonth] = useState(now.getMonth() + 1);
  const [settings, setSettings] = useState<PayrollFormData>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [showCatalogForm, setShowCatalogForm] = useState(false);
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [catalogForm, setCatalogForm] = useState<CatalogFormData>(emptyCatalogItem);
  const [catalogCategoryTab, setCatalogCategoryTab] = useState("all");
  const [productCatalogPick, setProductCatalogPick] = useState("");

  const [acctPeriod, setAcctPeriod] = useState("day"); // day | week | month
  const [acctDate, setAcctDate] = useState(today());
  const [acctMethodFilter, setAcctMethodFilter] = useState("all");
  const [acctQuery, setAcctQuery] = useState("");

  // ---- 재등록 예정(파이프라인) ----
  const emptyForecast: { customerId: string; targetMonth: string; expectedSessions: number | string; expectedAmount: number; note: string } =
    { customerId: "", targetMonth: today().slice(0, 7), expectedSessions: "", expectedAmount: 0, note: "" };
  const [renewalForecasts, setRenewalForecasts] = useState<RenewalForecast[]>([]);
  const [showForecastForm, setShowForecastForm] = useState(false);
  const [editingForecastId, setEditingForecastId] = useState<string | null>(null);
  const [forecastForm, setForecastForm] = useState(emptyForecast);
  const [forecastMonth, setForecastMonth] = useState(today().slice(0, 7));
  const [forecastQuery, setForecastQuery] = useState("");
  const emptyProspect = { name: "", expectedAmount: 0, note: "" };
  const [newProspectForm, setNewProspectForm] = useState(emptyProspect);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 1800); };

  useEffect(() => {
    (async () => {
      try {
        const [customersData, productsData, reservationsData, catalogData, settingsData, forecastsData] = await Promise.all([
          db.listCustomers(),
          db.listProducts(),
          db.listReservations(),
          db.listCatalog(),
          db.getSettings(),
          db.listRenewalForecasts(),
        ]);
        setCustomers(customersData);
        setProducts(productsData);
        setReservations(reservationsData);
        setCatalog(catalogData);
        setRenewalForecasts(forecastsData);
        if (settingsData) setSettings({ ...defaultSettings, ...settingsData });
      } catch (e) {
        flash("데이터를 불러오지 못했어요");
      }
      setLoaded(true);
    })();
  }, []);

  // ---- Catalog ----
  const openNewCatalog = () => { setCatalogForm(emptyCatalogItem); setEditingCatalogId(null); setShowCatalogForm(true); };
  const openEditCatalog = (item: CatalogItem) => { setCatalogForm(item); setEditingCatalogId(item.id); setShowCatalogForm(true); };
  const saveCatalogItem = async () => {
    if (!catalogForm.name.trim()) { flash("이용권 이름을 입력해주세요"); return; }
    try {
      if (editingCatalogId) {
        const updated = await db.updateCatalogItem(editingCatalogId, catalogForm);
        setCatalog(catalog.map((i) => (i.id === editingCatalogId ? updated : i)));
        flash("이용권 수정됨");
      } else {
        const created = await db.insertCatalogItem(catalogForm);
        setCatalog([...catalog, created]);
        flash("이용권 등록됨");
      }
      setShowCatalogForm(false);
    } catch (e) { flash("저장 실패, 다시 시도해주세요"); }
  };
  const removeCatalogItem = async (id: string) => {
    try {
      await db.deleteCatalogItem(id);
      setCatalog(catalog.filter((i) => i.id !== id));
      flash("이용권 삭제됨");
    } catch (e) { flash("삭제 실패, 다시 시도해주세요"); }
  };

  // ---- 재등록 예정(파이프라인) ----
  const openNewForecast = (customerId?: string | null) => {
    setForecastForm({ ...emptyForecast, customerId: customerId || "", targetMonth: forecastMonth });
    setEditingForecastId(null);
    setShowForecastForm(true);
  };
  const openEditForecast = (f: RenewalForecast) => {
    setForecastForm({
      customerId: f.customerId ?? "", targetMonth: f.targetMonth,
      expectedSessions: f.expectedSessions ?? "", expectedAmount: f.expectedAmount, note: f.note || "",
    });
    setEditingForecastId(f.id);
    setShowForecastForm(true);
  };
  // 재등록 예정 표의 한 행(row)을 편집 — 그 고객이 이 달 예정이 아직 없으면 새로 만들고, 있으면 수정한다.
  const openForecastFor = (row: { customerId: string; forecastId?: string | null; expectedSessions?: number | null; expectedAmount?: number; note?: string }) => {
    setForecastForm({
      customerId: row.customerId, targetMonth: forecastMonth,
      expectedSessions: row.expectedSessions ?? "", expectedAmount: row.expectedAmount || 0, note: row.note || "",
    });
    setEditingForecastId(row.forecastId || null);
    setShowForecastForm(true);
  };
  const saveForecast = async () => {
    if (!forecastForm.customerId) { flash("고객을 선택해주세요"); return; }
    if (!forecastForm.targetMonth) { flash("목표 월을 선택해주세요"); return; }
    const payload = {
      customerId: forecastForm.customerId,
      targetMonth: forecastForm.targetMonth,
      expectedSessions: forecastForm.expectedSessions === "" ? null : Number(forecastForm.expectedSessions),
      expectedAmount: Number(forecastForm.expectedAmount) || 0,
      note: forecastForm.note,
    };
    try {
      if (editingForecastId) {
        const updated = await db.updateRenewalForecast(editingForecastId, payload);
        setRenewalForecasts(renewalForecasts.map((f) => (f.id === editingForecastId ? updated : f)));
        flash("재등록 예정 수정됨");
      } else {
        const created = await db.insertRenewalForecast(payload);
        setRenewalForecasts([...renewalForecasts, created]);
        flash("재등록 예정 등록됨");
      }
      setShowForecastForm(false);
    } catch (e) { flash("저장 실패, 다시 시도해주세요"); }
  };
  const removeForecast = async (id: string) => {
    try {
      await db.deleteRenewalForecast(id);
      setRenewalForecasts(renewalForecasts.filter((f) => f.id !== id));
      flash("재등록 예정 삭제됨");
    } catch (e) { flash("삭제 실패, 다시 시도해주세요"); }
  };
  const requestRemoveForecast = (id: string, message: string) => askConfirm(message, () => removeForecast(id));

  // ---- 신규 고객 명단(아직 등록 안 된 예정 고객) ----
  const addProspect = async () => {
    if (!newProspectForm.name.trim()) { flash("이름을 입력해주세요"); return; }
    const payload = {
      prospectName: newProspectForm.name.trim(),
      targetMonth: forecastMonth,
      expectedAmount: Number(newProspectForm.expectedAmount) || 0,
      note: newProspectForm.note,
    };
    try {
      const created = await db.insertRenewalForecast(payload);
      setRenewalForecasts([...renewalForecasts, created]);
      setNewProspectForm(emptyProspect);
      flash("신규 고객 예정 등록됨");
    } catch (e) { flash("저장 실패, 다시 시도해주세요"); }
  };
  const updateProspectField = (id: string, field: string, value: string | number) => {
    setRenewalForecasts((cur) => cur.map((f) => (f.id === id ? ({ ...f, [field]: value } as RenewalForecast) : f)));
  };
  const persistProspect = async (id: string) => {
    const f = renewalForecasts.find((x) => x.id === id);
    if (!f) return;
    try {
      const updated = await db.updateRenewalForecast(id, {
        prospectName: f.prospectName, expectedAmount: Number(f.expectedAmount) || 0, note: f.note,
      });
      setRenewalForecasts((cur) => cur.map((x) => (x.id === id ? updated : x)));
    } catch (e) { flash("저장 실패, 다시 시도해주세요"); }
  };
  const handleProspectKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") addProspect(); };

  // ---- Customers ----
  const openNewCustomer = () => { setCustomerForm(emptyCustomer); setEditingCustomerId(null); setShowCustomerForm(true); };
  const openEditCustomer = (c: Customer) => { setCustomerForm(c); setEditingCustomerId(c.id); setShowCustomerForm(true); };
  const saveCustomer = async () => {
    if (!customerForm.name.trim()) { flash("이름을 입력해주세요"); return; }
    // customerForm이 고객 목록(요약 데이터 포함)에서 채워졌을 수 있으므로, DB에 실제로 있는
    // 컬럼만 명시적으로 골라 보낸다 (products/hasUnpaid 같은 계산용 필드가 섞여 들어가면 저장이 거부됨).
    const payload = {
      name: customerForm.name,
      phone: customerForm.phone,
      birthdate: emptyToNull(customerForm.birthdate),
      email: customerForm.email,
      memo: customerForm.memo,
    };
    try {
      if (editingCustomerId) {
        const updated = await db.updateCustomer(editingCustomerId, payload);
        setCustomers(customers.map((c) => (c.id === editingCustomerId ? updated : c)));
        flash("고객 정보 수정됨");
        setShowCustomerForm(false);
      } else {
        const created = await db.insertCustomer(payload);
        setCustomers([...customers, created]);
        flash("고객 등록됨 · 이용권을 등록해주세요");
        setShowCustomerForm(false);
        openNewProduct(created.id); // 신규 고객 등록 직후 바로 이용권 등록으로 이어간다
      }
    } catch (e) { flash("저장 실패, 다시 시도해주세요"); }
  };
  const toggleDormant = async (c: Customer) => {
    try {
      const updated = await db.updateCustomer(c.id, { isDormant: !c.isDormant });
      setCustomers(customers.map((x) => (x.id === c.id ? updated : x)));
      flash(updated.isDormant ? "휴면 상태로 변경됨 · 매출 계획에서 제외돼요" : "휴면 상태 해제됨");
    } catch (e) { flash("변경 실패, 다시 시도해주세요"); }
  };
  const removeCustomer = async (id: string) => {
    try {
      await db.deleteCustomer(id); // DB cascade가 관련 products/reservations도 함께 삭제
      setCustomers(customers.filter((c) => c.id !== id));
      setProducts(products.filter((p) => p.customerId !== id));
      setReservations(reservations.filter((r) => r.customerId !== id));
      flash("고객 삭제됨");
    } catch (e) { flash("삭제 실패, 다시 시도해주세요"); }
  };
  const requestRemoveCustomer = (c: Customer) => {
    const prodCount = products.filter((p) => p.customerId === c.id).length;
    const resCount = reservations.filter((r) => r.customerId === c.id).length;
    const parts = [];
    if (prodCount > 0) parts.push(`보유 상품 ${prodCount}개`);
    if (resCount > 0) parts.push(`예약 ${resCount}건`);
    const suffix = parts.length > 0 ? ` ${parts.join(", ")}도 함께 삭제됩니다.` : "";
    askConfirm(`"${c.name}" 고객을 삭제할까요?${suffix}`, () => removeCustomer(c.id));
  };

  const bulkRows = useMemo(() => {
    return bulkText.split("\n").map((l) => l.trim()).filter(Boolean).map(parseBulkLine).filter((r) => r.name);
  }, [bulkText]);
  const bulkDuplicatePhones = useMemo(() => {
    const existingPhones = new Set(customers.map((c) => c.phone).filter(Boolean));
    return bulkRows.filter((r) => r.phone && existingPhones.has(r.phone)).length;
  }, [bulkRows, customers]);
  const runBulkImport = async () => {
    if (bulkRows.length === 0) { flash("등록할 내용이 없어요"); return; }
    const existingPhones = new Set(customers.map((c) => c.phone).filter(Boolean));
    const seenInBatch = new Set<string>();
    const toAdd: Partial<Customer>[] = [];
    bulkRows.forEach((r) => {
      if (r.phone && (existingPhones.has(r.phone) || seenInBatch.has(r.phone))) return; // 이미 있는 전화번호는 건너뜀
      if (r.phone) seenInBatch.add(r.phone);
      toAdd.push({ name: r.name, phone: r.phone, birthdate: emptyToNull(r.birthdate), email: r.email, memo: r.memo });
    });
    try {
      const created = toAdd.length > 0 ? await db.insertCustomers(toAdd) : [];
      setCustomers([...customers, ...created]);
      const skipped = bulkRows.length - toAdd.length;
      setShowBulkImport(false);
      setBulkText("");
      flash(skipped > 0 ? `${created.length}명 등록됨 · 중복 ${skipped}건 건너뜀` : `${created.length}명 등록됨`);
    } catch (e) { flash("등록 실패, 다시 시도해주세요"); }
  };

  // ---- Products ----
  const openNewProduct = (customerId: string) => { setProductForm(emptyProduct); setProductFormCustomerId(customerId); setEditingProductId(null); setProductCatalogPick(""); setShowProductForm(true); };
  const openEditProduct = (p: Product) => {
    setProductForm({
      ...emptyProduct, ...p,
      listPrice: p.listPrice ?? p.price ?? 0,
      paidAmount: getPaidAmount(p),
      createdAt: p.createdAt ? toLocalDateStr(new Date(p.createdAt)) : toLocalDateStr(new Date()),
    });
    setProductFormCustomerId(p.customerId); setEditingProductId(p.id); setProductCatalogPick(""); setShowProductForm(true);
  };
  const saveProduct = async () => {
    if (!productForm.name.trim()) { flash("상품명을 입력해주세요"); return; }
    // createdAt은 화면(폼)에선 날짜 문자열이지만 DB 쓰기 시점엔 timestamptz 문자열(ISO)로 보낸다 —
    // 읽어올 때(Product.createdAt: number, epoch ms)와는 다른 "쓰기 전용" 모양이라 여기서만 캐스팅한다.
    const payload = {
      ...productForm,
      endDate: emptyToNull(productForm.endDate),
      createdAt: productForm.createdAt ? new Date(`${productForm.createdAt}T00:00:00`).toISOString() : new Date().toISOString(),
    } as unknown as Partial<Product>;
    try {
      if (editingProductId) {
        const updated = await db.updateProduct(editingProductId, payload);
        setProducts(products.map((p) => (p.id === editingProductId ? updated : p)));
        flash("상품 정보 수정됨");
      } else {
        const created = await db.insertProduct(productFormCustomerId as string, payload);
        setProducts([...products, created]);
        // "재등록 예정" 탭의 실제 등록금액은 그 달 등록된 상품 금액을 바로 합산해서 보여주므로
        // 별도로 예정 레코드를 갱신할 필요가 없다 — 상품을 등록하는 순간 자동으로 반영된다.
        flash("상품 등록됨");
      }
      setShowProductForm(false);
    } catch (e) { flash("저장 실패, 다시 시도해주세요"); }
  };
  const removeProduct = async (id: string) => {
    try {
      await db.deleteProduct(id); // DB cascade가 관련 reservations도 함께 삭제
      setProducts(products.filter((p) => p.id !== id));
      setReservations(reservations.filter((r) => r.productId !== id));
      flash("상품 삭제됨");
    } catch (e) { flash("삭제 실패, 다시 시도해주세요"); }
  };
  const requestRemoveProduct = (p: Product) => {
    const resCount = reservations.filter((r) => r.productId === p.id).length;
    const parts = [];
    if (p.type === "session") parts.push(`잔여 ${Math.max(0, p.totalSessions - p.usedSessions)}회`);
    if (resCount > 0) parts.push(`관련 예약 ${resCount}건`);
    const suffix = parts.length > 0 ? ` ${parts.join(", ")}도 함께 삭제됩니다.` : "";
    askConfirm(`"${p.name}" 상품을 삭제할까요?${suffix}`, () => removeProduct(p.id));
  };
  const bumpSession = async (id: string, delta: number) => {
    const p = products.find((x) => x.id === id);
    if (!p || p.type !== "session") return;
    try {
      const updated = await db.adjustUsedSessions(id, delta);
      setProducts(products.map((x) => (x.id === id ? updated : x)));
    } catch (e) { flash("저장 실패, 다시 시도해주세요"); }
  };
  const togglePaid = async (id: string) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    try {
      const updated = await db.updateProduct(id, isFullyPaid(p) ? { paidAmount: 0 } : { paidAmount: Number(p.price || 0) });
      setProducts(products.map((x) => (x.id === id ? updated : x)));
    } catch (e) { flash("저장 실패, 다시 시도해주세요"); }
  };

  // ---- Reservations ----
  const pushReservation = async (customerId: string | null, productId: string | null, data: ReservationFormData, statusOverride?: ReservationStatus, extra: Partial<Reservation> = {}) => {
    const repeat = data.repeat && data.repeat !== "none" ? data.repeat : "none";
    const count = repeat !== "none" ? Math.max(1, Number(data.repeatCount) || 1) : 1;
    const seriesId = count > 1 ? newId() : null;
    const status = statusOverride || "scheduled";
    const rows = Array.from({ length: count }, (_, i) => ({
      customerId, productId, seriesId,
      date: i === 0 ? data.date : addRepeatInterval(data.date, repeat, i),
      time: data.time, duration: Number(data.duration) || 50, memo: data.memo || "", status,
      ...extra,
    }));
    const created = await db.insertReservations(rows);
    setReservations((prev) => [...prev, ...created]);
    // 지난 시간을 출석/결석으로 바로 등록한 경우, 그만큼 세션도 함께 차감한다.
    if (countsAsUsed(status) && productId) {
      const p = products.find((x) => x.id === productId);
      if (p && p.type === "session") {
        const updated = await db.adjustUsedSessions(productId, created.length);
        setProducts((prev) => prev.map((x) => (x.id === productId ? updated : x)));
      }
    }
    return created.length;
  };
  const addReservation = async (customerId: string, productId: string, statusOverride?: ReservationStatus) => {
    if (!resForm.date || !resForm.time) { flash("날짜/시간을 입력해주세요"); return; }
    try {
      const n = await pushReservation(customerId, productId, resForm, statusOverride);
      setResForm({ date: today(), time: nowTime(), duration: 50, memo: "", repeat: "none", repeatCount: 4 });
      flash(statusOverride === "done" ? "출석으로 등록됨" : statusOverride === "noshow" ? "결석으로 등록됨" : (n > 1 ? `예약 ${n}건 등록됨` : "예약 등록됨"));
    } catch (e) { flash("등록 실패, 다시 시도해주세요"); }
  };
  const resetQuickAddState = () => {
    setQuickForm({ customerId: "", productId: "", date: today(), time: "18:00", duration: 50, memo: "", repeat: "none", repeatCount: 4 });
    setQuickSearch("");
    setQuickIsNew(false);
    setQuickIsMisc(false);
    setWalkInName("");
    setWalkInPhone("");
  };
  const addQuickReservation = async (statusOverride?: ReservationStatus) => {
    try {
      if (quickIsMisc) {
        const title = (quickForm.memo || "").trim();
        if (!title) { flash("제목을 입력해주세요"); return; }
        const n = await pushReservation(null, null, { ...quickForm, memo: title }, statusOverride, { type: "misc" });
        setShowQuickAdd(false);
        resetQuickAddState();
        flash(n > 1 ? `기타 일정 ${n}건 등록됨` : "기타 일정 등록됨");
        return;
      }
      if (quickIsNew) {
        if (!walkInName.trim()) { flash("이름을 입력해주세요"); return; }
        const newCustomer = await db.insertCustomer({ name: walkInName.trim(), phone: walkInPhone.trim(), birthdate: null, email: "", memo: "" });
        const [newRes] = await db.insertReservations([{
          customerId: newCustomer.id, productId: null, seriesId: null,
          date: quickForm.date, time: quickForm.time, duration: Number(quickForm.duration) || 60, memo: quickForm.memo || "", status: statusOverride || "scheduled",
        }]);
        setCustomers((prev) => [...prev, newCustomer]);
        setReservations((prev) => [...prev, newRes]);
        setShowQuickAdd(false);
        resetQuickAddState();
        flash("신규 고객 등록 및 예약됨");
        return;
      }
      if (!quickForm.customerId) { flash("고객을 선택해주세요"); return; }
      if (!quickForm.productId) { flash("이용권을 선택해주세요"); return; }
      const n = await pushReservation(quickForm.customerId, quickForm.productId, quickForm, statusOverride);
      setShowQuickAdd(false);
      resetQuickAddState();
      flash(statusOverride === "done" ? "출석으로 등록됨" : statusOverride === "noshow" ? "결석으로 등록됨" : (n > 1 ? `예약 ${n}건 등록됨` : "예약 등록됨"));
    } catch (e) { flash("등록 실패, 다시 시도해주세요"); }
  };
  const handleGridClick = (e: React.MouseEvent<HTMLDivElement>, date: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const time = pxToTime(e.clientY - rect.top);
    setHoverInfo(null);
    setQuickForm({ customerId: "", productId: "", date, time, duration: 50, memo: "", repeat: "none", repeatCount: 4 });
    setQuickSearch("");
    setQuickIsNew(false);
    setQuickIsMisc(false);
    setWalkInName("");
    setWalkInPhone("");
    setShowQuickAdd(true);
  };
  const setReservationStatus = async (resId: string, newStatus: ReservationStatus, extra: Partial<Reservation> = {}) => {
    const r = reservations.find((x) => x.id === resId);
    if (!r) return;
    const was = countsAsUsed(r.status), will = countsAsUsed(newStatus);
    let delta = 0;
    if (will && !was) delta = 1;
    if (!will && was) delta = -1;
    try {
      const updatedRes = await db.updateReservation(resId, { status: newStatus, ...extra });
      setReservations((prev) => prev.map((x) => (x.id === resId ? updatedRes : x)));
      if (delta !== 0 && r.productId) {
        const p = products.find((x) => x.id === r.productId);
        if (p && p.type === "session") {
          const updatedProduct = await db.adjustUsedSessions(p.id, delta);
          setProducts((prev) => prev.map((x) => (x.id === p.id ? updatedProduct : x)));
        }
      }
      if (newStatus === "done") flash("완료 처리 · 세션 1회 차감");
      else if (newStatus === "noshow") flash("노쇼 처리 · 세션 1회 차감");
      else if (newStatus === "cancelled") flash("예약 취소됨");
    } catch (e) { flash("처리 실패, 다시 시도해주세요"); }
  };

  // ---- 출석(완료) 처리 전 서명 받기 ----
  const [signatureRes, setSignatureRes] = useState<ReservationLike | null>(null);
  const requestCompleteReservation = (r: ReservationLike) => setSignatureRes(r);
  // 서명 직후, 수기 PT 세션 카드를 대체하는 "몇 회 중 몇 회 사용" 요약을 한 번 보여준다.
  const [sessionCardResId, setSessionCardResId] = useState<string | null>(null);
  const submitSignatureAndComplete = async (blob: Blob, workoutNote: string) => {
    if (!signatureRes) return;
    try {
      const path = await db.uploadSignature(signatureRes.id, blob);
      await setReservationStatus(signatureRes.id, "done", { signatureUrl: path, workoutNote: workoutNote || null });
      setSessionCardResId(signatureRes.id);
      setSignatureRes(null);
    } catch (e) { flash("서명 저장 실패, 다시 시도해주세요"); }
  };
  const deleteReservation = async (resId: string) => {
    const r = reservations.find((x) => x.id === resId);
    if (!r) return;
    try {
      await db.deleteReservation(resId);
      setReservations((prev) => prev.filter((x) => x.id !== resId));
      if (countsAsUsed(r.status) && r.productId) {
        const p = products.find((x) => x.id === r.productId);
        if (p && p.type === "session") {
          const updated = await db.adjustUsedSessions(p.id, -1);
          setProducts((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
        }
      }
      flash("예약 삭제됨");
    } catch (e) { flash("삭제 실패, 다시 시도해주세요"); }
  };

  // ---- 반복 예약: 이 예약만 / 이후 전체 선택 처리 ----
  const [seriesPrompt, setSeriesPrompt] = useState<{ reservation: Reservation; action: "cancel" | "delete" } | null>(null);
  const requestCancelReservation = (r: ReservationLike) => {
    if (r.seriesId) setSeriesPrompt({ reservation: r, action: "cancel" });
    else setReservationStatus(r.id, "cancelled");
  };
  const requestDeleteReservation = (r: ReservationLike) => {
    if (r.seriesId) { setSeriesPrompt({ reservation: r, action: "delete" }); return; }
    const label = r.type === "misc" ? r.customerName : `${r.customerName} · ${r.productName}`;
    askConfirm(`${koDate(r.date)} ${r.time} "${label}" 예약을 삭제할까요?`, () => deleteReservation(r.id));
  };
  const cancelSeriesFuture = async (seriesId: string, fromDate: string) => {
    const deltaByProduct: Record<string, number> = {};
    reservations.forEach((r) => {
      if (r.seriesId === seriesId && r.date >= fromDate && r.status !== "cancelled" && countsAsUsed(r.status) && r.productId) {
        deltaByProduct[r.productId] = (deltaByProduct[r.productId] || 0) - 1;
      }
    });
    try {
      await db.cancelReservationSeriesFrom(seriesId, fromDate);
      setReservations((prev) => prev.map((r) => (r.seriesId === seriesId && r.date >= fromDate && r.status !== "cancelled" ? { ...r, status: "cancelled" as const } : r)));
      for (const pid of Object.keys(deltaByProduct)) {
        const updated = await db.adjustUsedSessions(pid, deltaByProduct[pid]);
        setProducts((prev) => prev.map((x) => (x.id === pid ? updated : x)));
      }
      flash("이후 반복 예약 전체 취소됨");
    } catch (e) { flash("처리 실패, 다시 시도해주세요"); }
  };
  const deleteSeriesFuture = async (seriesId: string, fromDate: string) => {
    const deltaByProduct: Record<string, number> = {};
    reservations.forEach((r) => {
      if (r.seriesId === seriesId && r.date >= fromDate && countsAsUsed(r.status) && r.productId) deltaByProduct[r.productId] = (deltaByProduct[r.productId] || 0) - 1;
    });
    try {
      await db.deleteReservationSeriesFrom(seriesId, fromDate);
      setReservations((prev) => prev.filter((r) => !(r.seriesId === seriesId && r.date >= fromDate)));
      for (const pid of Object.keys(deltaByProduct)) {
        const updated = await db.adjustUsedSessions(pid, deltaByProduct[pid]);
        setProducts((prev) => prev.map((x) => (x.id === pid ? updated : x)));
      }
      flash("이후 반복 예약 전체 삭제됨");
    } catch (e) { flash("처리 실패, 다시 시도해주세요"); }
  };
  const applySeriesChoice = (scope: string) => {
    if (!seriesPrompt) return;
    const { reservation: r, action } = seriesPrompt;
    if (scope === "this") {
      if (action === "cancel") setReservationStatus(r.id, "cancelled");
      else deleteReservation(r.id);
    } else {
      if (action === "cancel") cancelSeriesFuture(r.seriesId as string, r.date);
      else deleteSeriesFuture(r.seriesId as string, r.date);
    }
    setSeriesPrompt(null);
  };

  // ---- 드래그로 예약 시간/요일 이동 ----
  const [dragResId, setDragResId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [gridHover, setGridHover] = useState<{ x: number; y: number; date: string; time: string } | null>(null);
  const moveReservation = async (resId: string, newDate: string, newTime: string) => {
    try {
      const updated = await db.updateReservation(resId, { date: newDate, time: newTime });
      setReservations((prev) => prev.map((r) => (r.id === resId ? updated : r)));
      flash("예약 일정이 변경됨");
    } catch (e) { flash("변경 실패, 다시 시도해주세요"); }
  };

  // ---- 드롭다운으로 예약 시간 정확히 수정 ----
  const [timeEditRes, setTimeEditRes] = useState<ReservationLike | null>(null);
  const [timeEditForm, setTimeEditForm] = useState<{ date: string; hour: string; minute: string; duration: number | string; title: string }>({ date: "", hour: "09", minute: "00", duration: 50, title: "" });
  const openTimeEdit = (r: ReservationLike) => {
    const [h, m] = r.time.split(":");
    setTimeEditRes(r);
    setTimeEditForm({ date: r.date, hour: h, minute: m, duration: r.duration || 50, title: r.type === "misc" ? (r.memo || "") : "" });
  };
  const saveTimeEdit = async () => {
    if (!timeEditRes) return;
    try {
      const isMisc = timeEditRes.type === "misc";
      if (isMisc && !timeEditForm.title.trim()) { flash("제목을 입력해주세요"); return; }
      const updated = await db.updateReservation(timeEditRes.id, {
        date: timeEditForm.date,
        time: `${timeEditForm.hour}:${timeEditForm.minute}`,
        duration: Number(timeEditForm.duration) || 50,
        ...(isMisc ? { memo: timeEditForm.title.trim() } : {}),
      });
      setReservations((prev) => prev.map((r) => (r.id === timeEditRes.id ? updated : r)));
      flash("예약 일정이 변경됨");
    } catch (e) { flash("변경 실패, 다시 시도해주세요"); }
    setTimeEditRes(null);
  };
  const hourOptions = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minuteOptions = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

  // ---- Derived ----
  const customerSummary = useMemo(() => {
    return customers.map((c) => {
      const prods = products.filter((p) => p.customerId === c.id);
      const hasUnpaid = prods.some((p) => !isFullyPaid(p));
      const sessionProds = prods.filter((p) => p.type === "session");
      const periodProds = prods.filter((p) => p.type === "period");
      // "임박 상품" 판정은 이용권 하나하나가 아니라 고객 단위로 봐야 한다 — 재등록으로 이용권이
      // 여러 개면, 예전 이용권이 거의 소진됐어도 새 이용권이 넉넉하면 시급한 게 아니다. 그래서
      // 세션형은 잔여횟수를 전부 합산해서 판단하고(기간형은 이용권마다 만료일이 따로라 합산이
      // 의미 없으므로 기존처럼 이용권 하나하나 중 가장 임박한 걸로 판단), 둘 중 더 급한 쪽을 쓴다.
      const sessionRemainTotal = sessionProds.length ? sessionProds.reduce((s, p) => s + (p.totalSessions - p.usedSessions), 0) : null;
      const sessionUrgency = sessionRemainTotal === null ? "ok" : sessionRemainTotal <= 1 ? "critical" : sessionRemainTotal <= 3 ? "warn" : "ok";
      const periodUrgency = periodProds.length ? periodProds.reduce((acc, p) => (urgencyRank[urgency(p)] < urgencyRank[acc] ? urgency(p) : acc), "ok") : "ok";
      const worst = prods.length ? (urgencyRank[sessionUrgency] < urgencyRank[periodUrgency] ? sessionUrgency : periodUrgency) : "none";
      const minRemain = sessionProds.length ? Math.min(...sessionProds.map((p) => p.totalSessions - p.usedSessions)) : null;
      const doneDates = reservations.filter((r) => r.customerId === c.id && r.status === "done").map((r) => r.date).sort();
      const lastVisit = doneDates.length ? doneDates[doneDates.length - 1] : null;
      const daysSinceVisit = lastVisit ? daysBetween(today(), lastVisit) : Infinity;
      const pendingForecast = renewalForecasts.find((f) => f.customerId === c.id && f.status === "pending");
      return { ...c, products: prods, hasUnpaid, worst, minRemain, lastVisit, daysSinceVisit, pendingForecast };
    });
  }, [customers, products, reservations, renewalForecasts]);

  const filteredCustomers = useMemo(() => {
    let list = customerSummary.filter((c) => c.name.includes(query) || (c.phone || "").includes(query));
    if (quickFilter === "remain5") list = list.filter((c) => c.minRemain !== null && c.minRemain < 5);
    else if (quickFilter === "remain10") list = list.filter((c) => c.minRemain !== null && c.minRemain < 10);
    else if (quickFilter === "inactive10") list = list.filter((c) => c.daysSinceVisit >= 10);
    else if (quickFilter === "inactive20") list = list.filter((c) => c.daysSinceVisit >= 20);
    else if (quickFilter === "dormant") list = list.filter((c) => c.isDormant);
    else if (quickFilter === "urgent") list = list.filter((c) => c.worst !== "ok" && c.worst !== "none");
    else if (quickFilter === "unpaid") list = list.filter((c) => c.hasUnpaid);
    if (sortMode === "urgent") list = [...list].sort((a, b) => (urgencyRank[a.worst] ?? 3) - (urgencyRank[b.worst] ?? 3));
    else if (sortMode === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    else list = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return list;
  }, [customerSummary, query, sortMode, quickFilter]);

  const allReservations = useMemo(() => {
    return reservations.map((r) => {
      if (r.type === "misc") {
        return {
          ...r,
          customerName: r.memo || "제목 없음",
          productName: "기타 일정",
          unitPrice: 0,
          remainCount: null,
          totalSessions: null,
        };
      }
      const product = products.find((p) => p.id === r.productId);
      const customer = customers.find((c) => c.id === r.customerId);
      return {
        ...r,
        customerName: customer ? customer.name : "(삭제된 고객)",
        productName: product ? product.name : (r.productId ? "(삭제된 상품)" : "상담(신규)"),
        unitPrice: product && product.type === "session" && product.totalSessions ? Math.round(product.price / product.totalSessions) : 0,
        remainCount: product && product.type === "session" ? product.totalSessions - product.usedSessions : null,
        totalSessions: product && product.type === "session" ? product.totalSessions : null,
      };
    });
  }, [reservations, products, customers]);

  const todaySchedule = useMemo(() => allReservations.filter((r) => r.date === today()).sort((a, b) => a.time.localeCompare(b.time)), [allReservations]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekStats = useMemo(() => {
    const weekRes = allReservations.filter((r) => weekDates.includes(r.date));
    return {
      total: weekRes.length,
      done: weekRes.filter((r) => r.status === "done").length,
      noshow: weekRes.filter((r) => r.status === "noshow").length,
      cancelled: weekRes.filter((r) => r.status === "cancelled").length,
    };
  }, [allReservations, weekDates]);

  const stats = useMemo(() => {
    const total = customers.length;
    const lowSessions = customerSummary.filter((c) => c.worst !== "ok" && c.worst !== "none").length;
    const unpaid = customerSummary.filter((c) => c.hasUnpaid).length;
    // 취소된 건은 오늘 일정이 아니므로 총 건수에서 제외하고, 그중 아직 예정(완료/노쇼 처리 전)인
    // 건수를 따로 세서 "총/예정"으로 함께 보여준다.
    const todayTotal = todaySchedule.filter((r) => r.status !== "cancelled").length;
    const todayCount = todaySchedule.filter((r) => r.status === "scheduled").length;
    const dormant = customers.filter((c) => c.isDormant).length;
    return { total, lowSessions, unpaid, todayTotal, todayCount, dormant };
  }, [customers, customerSummary, todaySchedule]);

  const resSheetProduct = products.find((p) => p.id === resSheetProductId);
  const resSheetCustomer = resSheetProduct ? customers.find((c) => c.id === resSheetProduct.customerId) : null;

  const quickMatches = useMemo(() => {
    if (!quickSearch.trim()) return [];
    return customers.filter((c) => c.name.includes(quickSearch) || (c.phone || "").includes(quickSearch)).slice(0, 8);
  }, [customers, quickSearch]);
  const quickCustomer = customers.find((c) => c.id === quickForm.customerId);
  const quickCustomerProducts = products.filter((p) => p.customerId === quickForm.customerId);
  // 잔여횟수가 남은 이용권 중 가장 먼저 등록한 것을 우선 사용 (재등록으로 이용권이 여러 개여도
  // 등록한 순서대로 차감되도록 기본 선택 — 필요하면 드롭다운에서 직접 바꿀 수 있다).
  const pickActiveProductId = (customerId: string) => {
    const active = products
      .filter((p) => p.customerId === customerId && p.type === "session" && p.totalSessions - p.usedSessions > 0)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return active.length ? active[0].id : "";
  };

  // ---- Payroll ----
  const revenueForMonth = (y: number, m: number) => {
    const key = monthKey(y, m);
    const done = allReservations.filter((r) => r.status === "done" && r.date.startsWith(key));
    const noshow = allReservations.filter((r) => r.status === "noshow" && r.date.startsWith(key));
    return { revenue: done.reduce((sum, r) => sum + (r.unitPrice || 0), 0), sessionCount: done.length, noshowCount: noshow.length, done };
  };
  const payrollNow = useMemo(() => revenueForMonth(payYear, payMonth), [allReservations, payYear, payMonth]);
  const payrollCalc = useMemo(() => {
    const commission = Math.round(payrollNow.revenue * (Number(settings.commissionRate) / 100));
    const gross = Number(settings.baseSalary) + commission;
    const deduction = Math.round(gross * (Number(settings.deductionRate) / 100));
    return { commission, gross, deduction, net: gross - deduction };
  }, [payrollNow, settings]);
  const trend6 = useMemo(() => {
    const arr = [];
    for (let i = 5; i >= 0; i--) { const { y, m } = shiftMonth(payYear, payMonth, -i); const r = revenueForMonth(y, m); arr.push({ label: `${m}월`, 매출: r.revenue, 세션수: r.sessionCount }); }
    return arr;
  }, [allReservations, payYear, payMonth]);
  const monthDetailRows = useMemo(() => [...payrollNow.done].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)), [payrollNow]);

  // ---- 통계분석 ----
  // 고객별 "첫 상품"의 등록시각을 미리 구해두면, 그 시각과 같은 상품은 신규 등록, 다르면 재등록으로
  // 자동 판별할 수 있다 (사용자가 상품 등록할 때 신규/재등록을 직접 체크할 필요가 없음).
  const firstPurchaseAt = useMemo(() => {
    const map: Record<string, number> = {};
    products.forEach((p) => {
      if (!(p.customerId in map) || (p.createdAt || 0) < map[p.customerId]) map[p.customerId] = p.createdAt || 0;
    });
    return map;
  }, [products]);

  // "세션 매출"(완료 처리된 레슨 기준, 페이롤과 동일한 산정 방식)과
  // "등록 매출"(회계관리와 동일한, 상품을 등록/결제한 금액 기준)은 서로 다른 지표라 둘 다 보여준다.
  const registrationRevenueForMonth = (y: number, m: number) => {
    const key = monthKey(y, m);
    const monthProducts = products.filter((p) => p.createdAt && toLocalDateStr(new Date(p.createdAt)).startsWith(key));
    const newProducts = monthProducts.filter((p) => firstPurchaseAt[p.customerId] === p.createdAt);
    const renewProducts = monthProducts.filter((p) => firstPurchaseAt[p.customerId] !== p.createdAt);
    return {
      regRevenue: monthProducts.reduce((sum, p) => sum + Number(p.price || 0), 0),
      regCount: monthProducts.length,
      regUnpaid: monthProducts.reduce((sum, p) => sum + getUnpaidAmount(p), 0),
      newRevenue: newProducts.reduce((sum, p) => sum + Number(p.price || 0), 0),
      newCount: newProducts.length,
      renewRevenue: renewProducts.reduce((sum, p) => sum + Number(p.price || 0), 0),
      renewCount: renewProducts.length,
    };
  };
  const statsTrend = useMemo(() => {
    const cy = now.getFullYear(), cm = now.getMonth() + 1;
    const arr = [];
    for (let i = 11; i >= 0; i--) {
      const { y, m } = shiftMonth(cy, cm, -i);
      const r = revenueForMonth(y, m);
      const reg = registrationRevenueForMonth(y, m);
      arr.push({ label: `${m}월`, revenue: r.revenue, sessionCount: r.sessionCount, noshowCount: r.noshowCount, ...reg, y, m });
    }
    return arr;
  }, [allReservations, products]);
  const statsCurrent = statsTrend[11];
  const statsPrevious = statsTrend[10];
  const statsAvg6 = useMemo(() => {
    const window = statsTrend.slice(5, 11); // 이번달 제외 직전 6개월
    const n = window.length || 1;
    const avgRevenue = window.reduce((s, x) => s + x.revenue, 0) / n;
    const avgSessions = window.reduce((s, x) => s + x.sessionCount, 0) / n;
    const avgRegRevenue = window.reduce((s, x) => s + x.regRevenue, 0) / n;
    return { avgRevenue, avgSessions, avgRegRevenue };
  }, [statsTrend]);
  const pctDiff = (cur: number, base: number): number | null => (base ? Math.round(((cur - base) / base) * 100) : null);
  const noshowRate = (r: { sessionCount: number; noshowCount: number }): number => (r.sessionCount + r.noshowCount > 0 ? Math.round((r.noshowCount / (r.sessionCount + r.noshowCount)) * 100) : 0);

  // ---- 재등록 예정(파이프라인) 파생 데이터 ----
  // 등록된 고객 전체를 기본으로 보여준다 (별도로 "추가"할 필요 없음). 잔여세션을 보고
  // 그 자리에서 재등록 계획(예상세션/예상금액)을 세울 수 있고, 이번달 실제 등록금액은
  // 해당 월에 새로 등록된 상품 금액을 합산해 자동으로 계산한다.
  const doneReservationsByCustomer = useMemo(() => {
    const map: Record<string, Reservation[]> = {};
    reservations.forEach((r) => {
      if (r.status === "done" && r.customerId) (map[r.customerId] || (map[r.customerId] = [])).push(r);
    });
    return map;
  }, [reservations]);

  const forecastRows = useMemo(() => {
    return customers
      .filter((c) => !c.isDormant && products.some((p) => p.customerId === c.id))
      .map((c) => {
        const f = renewalForecasts.find((x) => x.customerId === c.id && x.targetMonth === forecastMonth);
        const sessionProducts = products.filter((p) => p.customerId === c.id && p.type === "session");
        const totalSummary = sessionProducts.length ? sessionProducts.map((p) => p.name).join(" / ") : "-";
        const ticketCount = sessionProducts.length;
        // 재등록 시급도는 이용권 개별이 아니라 고객 단위로 판단해야 하므로, 여러 이용권의
        // 잔여횟수를 모두 합산한다 (예전 이용권이 거의 소진돼도 새 이용권이 넉넉하면 시급하지 않음).
        const totalRemain = ticketCount ? sessionProducts.reduce((s, p) => s + (p.totalSessions - p.usedSessions), 0) : null;
        const remainDetail = ticketCount ? sessionProducts.map((p) => `${p.totalSessions - p.usedSessions}회`).join(" / ") : "-";
        const remainSessionsShort = ticketCount ? sessionProducts.map((p) => `${p.totalSessions - p.usedSessions}s`).join("/") : "";
        const remainSummary = totalRemain !== null ? `${totalRemain}회${ticketCount > 1 ? ` (${remainSessionsShort})` : ""}` : "-";
        const monthProducts = products.filter((p) => p.customerId === c.id && p.createdAt && toLocalDateStr(new Date(p.createdAt)).startsWith(forecastMonth));
        const actual = monthProducts.reduce((s, p) => s + Number(p.price || 0), 0);
        const expectedSessions = f ? f.expectedSessions : null;
        const expectedAmount = f ? Number(f.expectedAmount || 0) : 0;
        const gap = Math.max(0, expectedAmount - actual);
        const { timeSlotLabel, weeklyAvgLabel, recentVisits } = computeAttendanceStats(doneReservationsByCustomer[c.id]);
        return {
          forecastId: f ? f.id : null, customerId: c.id, customerName: c.name, customerPhone: c.phone,
          totalSummary, remainSummary, remainDetail, ticketCount, totalRemain, timeSlotLabel, weeklyAvgLabel, recentVisits,
          expectedSessions, expectedAmount, note: f ? f.note : "",
          actual, gap, achieved: expectedAmount > 0 && actual >= expectedAmount,
        };
      })
      .sort((a, b) => (a.totalRemain ?? 9999) - (b.totalRemain ?? 9999));
  }, [customers, products, renewalForecasts, forecastMonth, doneReservationsByCustomer]);

  const filteredForecastRows = useMemo(() => {
    if (!forecastQuery.trim()) return forecastRows;
    return forecastRows.filter((r) => r.customerName.includes(forecastQuery) || (r.customerPhone || "").includes(forecastQuery));
  }, [forecastRows, forecastQuery]);

  // 아직 고객으로 등록되지 않은 신규 예정 고객 (customer_id 없이 이름만 직접 입력된 행)
  const prospectRows = useMemo(() => {
    return renewalForecasts
      .filter((f) => !f.customerId && f.targetMonth === forecastMonth)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, [renewalForecasts, forecastMonth]);

  const forecastStats = useMemo(() => {
    const planned = forecastRows.filter((f) => f.expectedAmount > 0);
    const totalActual = forecastRows.reduce((s, f) => s + f.actual, 0);
    const existingExpected = planned.reduce((s, f) => s + f.expectedAmount, 0);
    const existingGap = planned.reduce((s, f) => s + f.gap, 0);
    const achievedCount = planned.filter((f) => f.achieved).length;
    const plannedProspects = prospectRows.filter((f) => Number(f.expectedAmount || 0) > 0);
    const prospectExpected = plannedProspects.reduce((s, f) => s + Number(f.expectedAmount || 0), 0);
    return {
      plannedCount: planned.length + plannedProspects.length,
      achievedCount,
      totalExpected: existingExpected + prospectExpected,
      totalActual,
      totalGap: existingGap + prospectExpected,
    };
  }, [forecastRows, prospectRows]);

  const shiftForecastMonth = (delta: number) => {
    const y = Number(forecastMonth.slice(0, 4)), m = Number(forecastMonth.slice(5, 7));
    const { y: ny, m: nm } = shiftMonthYM(y, m, delta);
    setForecastMonth(monthKey(ny, nm));
  };

  // ---- 회계관리 ----
  const acctRange = useMemo(() => {
    if (acctPeriod === "day") return { start: acctDate, end: acctDate };
    if (acctPeriod === "week") { const s = mondayOf(acctDate); return { start: s, end: addDays(s, 6) }; }
    const y = Number(acctDate.slice(0, 4)), m = Number(acctDate.slice(5, 7));
    return { start: firstOfMonth(y, m), end: lastOfMonth(y, m) };
  }, [acctPeriod, acctDate]);

  const acctLabel = useMemo(() => {
    if (acctPeriod === "day") return `${koDate(acctDate)} (${weekdayFull[new Date(acctDate).getDay()]})`;
    if (acctPeriod === "week") return `${koDate(acctRange.start)} - ${koDate(acctRange.end)}`;
    return `${acctDate.slice(0, 4)}년 ${Number(acctDate.slice(5, 7))}월`;
  }, [acctPeriod, acctDate, acctRange]);

  const acctRows = useMemo(() => {
    const startTs = new Date(acctRange.start + "T00:00:00").getTime();
    const endTs = new Date(acctRange.end + "T23:59:59").getTime();
    let rows = products
      .filter((p) => (p.createdAt || 0) >= startTs && (p.createdAt || 0) <= endTs)
      .map((p) => {
        const cust = customers.find((c) => c.id === p.customerId);
        return {
          ...p,
          customerName: cust ? cust.name : "(삭제된 고객)",
          phone: cust ? cust.phone : "",
          isNew: firstPurchaseAt[p.customerId] === p.createdAt,
        };
      });
    if (acctMethodFilter !== "all") rows = rows.filter((r) => r.paymentMethod === acctMethodFilter);
    if (acctQuery.trim()) rows = rows.filter((r) => r.customerName.includes(acctQuery) || (r.phone || "").includes(acctQuery));
    return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [products, customers, acctRange, acctMethodFilter, acctQuery, firstPurchaseAt]);

  const acctStats = useMemo(() => {
    const totalAmount = acctRows.reduce((s, r) => s + Number(r.price || 0), 0);
    const newRows = acctRows.filter((r) => r.isNew);
    const renewRows = acctRows.filter((r) => !r.isNew);
    const unpaidAmount = acctRows.reduce((s, r) => s + getUnpaidAmount(r), 0);
    return {
      totalAmount, totalCount: acctRows.length,
      newAmount: newRows.reduce((s, r) => s + Number(r.price || 0), 0), newCount: newRows.length,
      renewAmount: renewRows.reduce((s, r) => s + Number(r.price || 0), 0), renewCount: renewRows.length,
      unpaidAmount,
    };
  }, [acctRows]);

  const shiftAcctDate = (delta: number) => {
    if (acctPeriod === "day") setAcctDate(addDays(acctDate, delta));
    else if (acctPeriod === "week") setAcctDate(addDays(acctDate, delta * 7));
    else {
      const y = Number(acctDate.slice(0, 4)), m = Number(acctDate.slice(5, 7));
      const { y: ny, m: nm } = shiftMonthYM(y, m, delta);
      setAcctDate(firstOfMonth(ny, nm));
    }
  };

  return (
    <div className="ptm-root">
      <div className="ptm-eyebrow">던휘트니스 삼성점</div>
      <h1 className="ptm-title">회원 관리</h1>

      <div className="ptm-tabs">
        <button className={`ptm-tab ${view === "schedule" ? "active" : ""}`} onClick={() => setView("schedule")}><CalendarDays size={15} /> 스케줄</button>
        <button className={`ptm-tab ${view === "members" ? "active" : ""}`} onClick={() => setView("members")}><Users size={15} /> 고객관리</button>
        <button className={`ptm-tab ${view === "catalog" ? "active" : ""}`} onClick={() => setView("catalog")}><Tag size={15} /> 이용권 관리</button>
        <button className={`ptm-tab ${view === "accounting" ? "active" : ""}`} onClick={() => setView("accounting")}><Receipt size={15} /> 회계관리</button>
        <button className={`ptm-tab ${view === "forecast" ? "active" : ""}`} onClick={() => setView("forecast")}><Target size={15} /> 매출 계획</button>
        <button className={`ptm-tab ${view === "stats" ? "active" : ""}`} onClick={() => setView("stats")}><TrendingUp size={15} /> 통계분석</button>
        <button className={`ptm-tab ${view === "sale" ? "active" : ""}`} onClick={() => setView("sale")}><ShoppingBag size={15} /> 상품판매</button>
        <button className={`ptm-tab ${view === "payroll" ? "active" : ""}`} onClick={() => setView("payroll")}><Wallet size={15} /> 페이롤</button>
      </div>

      {view === "schedule" && (
        <>
          <div className="ptm-week-toolbar">
            <div className="ptm-week-nav">
              <button className="ptm-nav-btn" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={16} /></button>
              <button className="ptm-nav-today" onClick={() => setWeekStart(mondayOf(today()))}>오늘</button>
              <button className="ptm-nav-btn" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={16} /></button>
              <span className="ptm-week-range">{koDate(weekDates[0])} - {koDate(weekDates[6])}</span>
            </div>
            <div className="ptm-week-summary">
              <span>예약 <b>{weekStats.total}</b></span>
              <span>출석 <b>{weekStats.done}</b></span>
              <span>결석 <b>{weekStats.noshow}</b></span>
              <span>취소 <b>{weekStats.cancelled}</b></span>
            </div>
            <button className="ptm-quick-add" onClick={() => { resetQuickAddState(); setShowQuickAdd(true); }}><Plus size={16} /> 새 예약</button>
          </div>

          <div className="ptm-week-grid-wrap">
            <div style={{ width: "100%" }}>
              <div className="ptm-week-headrow">
                <div className="ptm-week-headtime" />
                {weekDates.map((d, i) => (
                  <div key={d} className={`ptm-week-headcell ${d === today() ? "today" : ""}`}>{dayLabels[i]} {koDate(d)}</div>
                ))}
              </div>
              <div className="ptm-week-body" style={{ height: (HOUR_END - HOUR_START) * HOUR_PX }}>
                <div className="ptm-week-timecol" style={{ height: (HOUR_END - HOUR_START) * HOUR_PX }}>
                  {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i).map((h) => (
                    <div key={h} className="ptm-hour-label" style={{ top: (h - HOUR_START) * HOUR_PX }}>{h}시</div>
                  ))}
                </div>
                {weekDates.map((d) => {
                  const dayRes = layoutDayReservations(allReservations.filter((r) => r.date === d));
                  return (
                    <div
                      key={d}
                      className={`ptm-week-daycol ptm-day-bg ${dragOverDate === d ? "drag-over" : ""}`}
                      style={{ height: (HOUR_END - HOUR_START) * HOUR_PX }}
                      onClick={(e) => handleGridClick(e, d)}
                      onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const t = pxToTime(e.clientY - rect.top);
                        setGridHover({ x: e.clientX, y: e.clientY, date: d, time: t });
                      }}
                      onMouseLeave={() => setGridHover(null)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dragOverDate !== d) setDragOverDate(d);
                        const rect = e.currentTarget.getBoundingClientRect();
                        const t = pxToTime(e.clientY - rect.top);
                        setGridHover({ x: e.clientX, y: e.clientY, date: d, time: t });
                      }}
                      onDragLeave={() => setDragOverDate((cur) => (cur === d ? null : cur))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverDate(null);
                        setGridHover(null);
                        if (!dragResId) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const newTime = pxToTime(e.clientY - rect.top);
                        moveReservation(dragResId, d, newTime);
                        setDragResId(null);
                      }}
                    >
                      {gridHover && gridHover.date === d && !hoverInfo && (
                        <div className="ptm-slot-preview" style={{ top: timeTopPx(gridHover.time), height: durHeightPx(50) }} />
                      )}
                      {d === today() && nowClock.getHours() >= HOUR_START && nowClock.getHours() < HOUR_END && (
                        <div className="ptm-now-line" style={{ top: timeTopPx(`${String(nowClock.getHours()).padStart(2, "0")}:${String(nowClock.getMinutes()).padStart(2, "0")}`) }} />
                      )}
                      {dayRes.map((r) => {
                        const widthPct = 100 / (r.columnCount ?? 1);
                        const leftPct = (r.col ?? 0) * widthPct;
                        return (
                          <div key={r.id} className={`ptm-block ${r.status} ${r.type === "misc" ? "misc" : ""} ${dragResId === r.id ? "dragging" : ""}`}
                            style={{
                              top: timeTopPx(r.time), height: durHeightPx(r.duration || 50),
                              left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`,
                            }}
                            draggable={r.status !== "cancelled"}
                            onDragStart={(e) => { e.stopPropagation(); setHoverInfo(null); setCtxMenu(null); setGridHover(null); setDragResId(r.id); }}
                            onDragEnd={() => { setDragResId(null); setDragOverDate(null); setGridHover(null); }}
                            onClick={(e) => { e.stopPropagation(); setHoverInfo(null); setCtxMenu({ x: e.clientX, y: e.clientY, reservation: r }); }}
                            onMouseMove={(e) => e.stopPropagation()}
                            {...(hasHoverPointer ? {
                              onMouseEnter: (e) => { setGridHover(null); showHoverInfo(r, e.clientX, e.clientY); },
                              onMouseLeave: scheduleHideHoverInfo,
                            } : {})}>
                            {r.totalSessions !== null && (
                              <span className="ptm-block-badge">{r.totalSessions}/{r.remainCount}</span>
                            )}
                            <div className="ptm-block-time">{r.time}-{minToTime(timeToMin(r.time) + (r.duration || 50))}</div>
                            <div className="ptm-block-name">{r.customerName}</div>
                            <div className="ptm-block-sub">{r.productName}{r.remainCount !== null ? ` · 잔여${r.remainCount}` : ""}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {view === "members" && (
        <>
          <div className="ptm-stats">
            <div className="ptm-stat"><div className="ptm-stat-num">{stats.total}</div><div className="ptm-stat-label">전체 고객</div></div>
            <div
              className={`ptm-stat clickable ${stats.lowSessions > 0 ? "warn" : ""} ${quickFilter === "urgent" ? "active" : ""}`}
              title="잔여 3회 이하(횟수제) 또는 종료 10일 이내(기간제) 이용권을 가진 고객"
              onClick={() => setQuickFilter(quickFilter === "urgent" ? null : "urgent")}
            >
              <div className="ptm-stat-num">{stats.lowSessions}</div><div className="ptm-stat-label">임박 상품</div>
            </div>
            <div
              className={`ptm-stat clickable ${stats.unpaid > 0 ? "bad" : ""} ${quickFilter === "unpaid" ? "active" : ""}`}
              title="이용권 대금을 다 못 받은 고객"
              onClick={() => setQuickFilter(quickFilter === "unpaid" ? null : "unpaid")}
            >
              <div className="ptm-stat-num">{stats.unpaid}</div><div className="ptm-stat-label">미수금</div>
            </div>
            <div
              className="ptm-stat clickable"
              title={`오늘 총 ${stats.todayTotal}건 중 ${stats.todayCount}건 예정(아직 완료/노쇼 처리 전) — 클릭하면 스케줄 화면으로 이동해요`}
              onClick={() => { setWeekStart(mondayOf(today())); setView("schedule"); }}
            >
              <div className="ptm-stat-num">{stats.todayTotal}/{stats.todayCount}</div><div className="ptm-stat-label">오늘 예약 (총/예정)</div>
            </div>
            <div className={`ptm-stat clickable ${quickFilter === "dormant" ? "active" : ""}`} title="트레이너가 직접 휴면으로 표시한 고객" onClick={() => setQuickFilter(quickFilter === "dormant" ? null : "dormant")}>
              <div className="ptm-stat-num">{stats.dormant}</div><div className="ptm-stat-label">휴면 고객</div>
            </div>
          </div>
          <div className="ptm-quickfilter-row">
            <button className={`ptm-quickfilter-btn ${quickFilter === "remain5" ? "active" : ""}`} onClick={() => setQuickFilter(quickFilter === "remain5" ? null : "remain5")}>#잔여 5회 미만</button>
            <button className={`ptm-quickfilter-btn ${quickFilter === "remain10" ? "active" : ""}`} onClick={() => setQuickFilter(quickFilter === "remain10" ? null : "remain10")}>#잔여 10회 미만</button>
            <button className={`ptm-quickfilter-btn ${quickFilter === "inactive10" ? "active" : ""}`} onClick={() => setQuickFilter(quickFilter === "inactive10" ? null : "inactive10")}>#미방문 10일 이상</button>
            <button className={`ptm-quickfilter-btn ${quickFilter === "inactive20" ? "active" : ""}`} onClick={() => setQuickFilter(quickFilter === "inactive20" ? null : "inactive20")}>#미방문 20일 이상</button>
            {quickFilter && <button className="ptm-quickfilter-clear" onClick={() => setQuickFilter(null)}>필터 해제</button>}
          </div>
          <div className="ptm-toolbar">
            <div className="ptm-search">
              <Search size={15} color="#8a94a6" />
              <input placeholder="이름 또는 전화번호 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <select className="ptm-sort" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
              <option value="urgent">임박순</option><option value="name">이름순</option><option value="recent">최근등록순</option>
            </select>
            <button className="ptm-add" onClick={openNewCustomer}><Plus size={16} /> 고객 등록</button>
            <button className="ptm-add ghost" onClick={() => { setBulkText(""); setShowBulkImport(true); }}><Users size={16} /> 일괄 등록</button>
          </div>

          {!loaded ? (
            <div className="ptm-empty">불러오는 중...</div>
          ) : filteredCustomers.length === 0 ? (
            <div className="ptm-empty">
              <div className="ptm-empty-title">{customers.length === 0 ? "등록된 고객이 없어요" : "검색 결과가 없어요"}</div>
              {customers.length === 0 && <div>고객 등록 버튼으로 첫 고객을 추가해보세요</div>}
            </div>
          ) : (
            <div className="ptm-list">
              {filteredCustomers.map((c) => (
                <div className="ptm-card" key={c.id} onClick={() => { setCustomerDetailId(c.id); setCustomerDetailTab("home"); }} style={{ cursor: "pointer", opacity: c.isDormant ? 0.55 : 1 }}>
                  <div className="ptm-card-top">
                    <div>
                      <div className="ptm-name-row">
                        <span className="ptm-name">{c.name}</span>
                        {c.isDormant && <span className="ptm-badge dormant">휴면</span>}
                        {c.hasUnpaid && <span className="ptm-badge unpaid">미수금</span>}
                        {c.pendingForecast && <span className="ptm-badge forecast">재등록예정 {c.pendingForecast.targetMonth.slice(5, 7)}월 · {Number(c.pendingForecast.expectedAmount || 0).toLocaleString()}원</span>}
                      </div>
                      {c.phone && <div className="ptm-phone"><Phone size={11} /> {c.phone}</div>}
                      <div className="ptm-prod-count">
                        {c.products.length === 0 ? "등록된 상품 없음" : c.products.map((p) => `${p.name} · 잔여${shortRemain(p)}`).join(" / ")}
                        {(quickFilter === "inactive10" || quickFilter === "inactive20") && (
                          <span> · {c.lastVisit ? `마지막 방문 ${c.daysSinceVisit}일 전 (${c.lastVisit})` : "방문 기록 없음"}</span>
                        )}
                      </div>
                    </div>
                    <div className="ptm-actions">
                      <button className={`ptm-icon-btn ${c.isDormant ? "active" : ""}`} title={c.isDormant ? "휴면 해제" : "휴면 상태로 표시 (매출 계획에서 제외)"} onClick={(e) => { e.stopPropagation(); toggleDormant(c); }}><Moon size={14} /></button>
                      <button className="ptm-icon-btn" onClick={(e) => { e.stopPropagation(); openEditCustomer(c); }}><Pencil size={14} /></button>
                      <button className="ptm-icon-btn" onClick={(e) => { e.stopPropagation(); requestRemoveCustomer(c); }}><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view === "catalog" && (
        <>
          <div className="ptm-week-toolbar">
            <div className="ptm-week-range">이용권 목록</div>
            <button className="ptm-quick-add" onClick={openNewCatalog}><Plus size={16} /> 이용권 만들기</button>
          </div>

          <div className="ptm-tabs" style={{ marginBottom: 14 }}>
            <button className={`ptm-tab ${catalogCategoryTab === "all" ? "active" : ""}`} onClick={() => setCatalogCategoryTab("all")}>전체</button>
            {CATALOG_CATEGORIES.map((cat) => (
              <button key={cat} className={`ptm-tab ${catalogCategoryTab === cat ? "active" : ""}`} onClick={() => setCatalogCategoryTab(cat)}>{CATEGORY_LABELS[cat]}</button>
            ))}
          </div>

          {catalog.length === 0 ? (
            <div className="ptm-empty">
              <div className="ptm-empty-title">등록된 이용권이 없어요</div>
              <div>자주 판매하는 PT 커리큘럼을 미리 등록해두면 고객 상품 등록할 때 바로 불러올 수 있어요</div>
            </div>
          ) : catalogCategoryTab === "all" ? (
            // "전체" 탭에서는 카테고리별로 섹션을 나눠서 보여줘, 데일리PT/프리미엄/회원권/사물함이
            // 한 목록에 뒤섞이지 않고 한눈에 구분되도록 한다.
            <div className="ptm-list">
              {CATALOG_CATEGORIES.map((cat) => {
                const items = [...catalog]
                  .filter((item) => item.category === cat)
                  .sort((a, b) => a.sessions - b.sessions || a.months - b.months);
                if (items.length === 0) return null;
                return (
                  <div key={cat} className="ptm-catalog-group">
                    <div className="ptm-detail-section-title">{CATEGORY_LABELS[cat]}</div>
                    {items.map((item) => (
                      <div className="ptm-card" key={item.id}>
                        <div className="ptm-card-top" style={{ cursor: "default" }}>
                          <div>
                            <div className="ptm-name-row"><span className="ptm-name">{item.name}</span></div>
                            <div className="ptm-prod-count">{formatCatalogSummary(item)}</div>
                          </div>
                          <div className="ptm-actions">
                            <button className="ptm-icon-btn" onClick={() => openEditCatalog(item)}><Pencil size={14} /></button>
                            <button className="ptm-icon-btn" onClick={() => removeCatalogItem(item.id)}><Trash2 size={14} /></button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="ptm-list">
              {[...catalog]
                .filter((item) => item.category === catalogCategoryTab)
                .sort((a, b) => a.sessions - b.sessions || a.months - b.months)
                .map((item) => (
                <div className="ptm-card" key={item.id}>
                  <div className="ptm-card-top" style={{ cursor: "default" }}>
                    <div>
                      <div className="ptm-name-row"><span className="ptm-name">{item.name}</span><span className="ptm-badge">{CATEGORY_LABELS[item.category] || CATEGORY_LABELS.daily_pt}</span></div>
                      <div className="ptm-prod-count">{formatCatalogSummary(item)}</div>
                    </div>
                    <div className="ptm-actions">
                      <button className="ptm-icon-btn" onClick={() => openEditCatalog(item)}><Pencil size={14} /></button>
                      <button className="ptm-icon-btn" onClick={() => removeCatalogItem(item.id)}><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view === "accounting" && (
        <>
          <div className="ptm-week-toolbar">
            <div className="ptm-tabs" style={{ margin: 0 }}>
              <button className={`ptm-tab ${acctPeriod === "day" ? "active" : ""}`} onClick={() => setAcctPeriod("day")}>일간</button>
              <button className={`ptm-tab ${acctPeriod === "week" ? "active" : ""}`} onClick={() => setAcctPeriod("week")}>주간</button>
              <button className={`ptm-tab ${acctPeriod === "month" ? "active" : ""}`} onClick={() => setAcctPeriod("month")}>월간</button>
            </div>
            <div className="ptm-week-nav">
              <button className="ptm-nav-btn" onClick={() => shiftAcctDate(-1)}><ChevronLeft size={16} /></button>
              <button className="ptm-nav-today" onClick={() => setAcctDate(today())}>오늘</button>
              <button className="ptm-nav-btn" onClick={() => shiftAcctDate(1)}><ChevronRight size={16} /></button>
              <span className="ptm-week-range">{acctLabel}</span>
            </div>
          </div>

          <div className="ptm-pay-grid">
            <div className="ptm-pay-card"><div className="ptm-pay-card-label">결제금액 합계</div><div className="ptm-pay-card-num">{acctStats.totalAmount.toLocaleString()}원</div><div className="ptm-prod-count">{acctStats.totalCount}건</div></div>
            <div className="ptm-pay-card"><div className="ptm-pay-card-label">신규등록</div><div className="ptm-pay-card-num">{acctStats.newAmount.toLocaleString()}원</div><div className="ptm-prod-count">{acctStats.newCount}건</div></div>
            <div className="ptm-pay-card"><div className="ptm-pay-card-label">재등록</div><div className="ptm-pay-card-num">{acctStats.renewAmount.toLocaleString()}원</div><div className="ptm-prod-count">{acctStats.renewCount}건</div></div>
            <div className="ptm-pay-card"><div className="ptm-pay-card-label">미수금</div><div className="ptm-pay-card-num" style={acctStats.unpaidAmount > 0 ? { color: "var(--coral)" } : {}}>{acctStats.unpaidAmount.toLocaleString()}원</div></div>
          </div>

          <div className="ptm-toolbar">
            <div className="ptm-search">
              <Search size={15} color="#8a94a6" />
              <input placeholder="고객명 또는 전화번호 검색" value={acctQuery} onChange={(e) => setAcctQuery(e.target.value)} />
            </div>
            <select className="ptm-sort" value={acctMethodFilter} onChange={(e) => setAcctMethodFilter(e.target.value)}>
              <option value="all">결제수단 전체</option>
              <option value="card">카드</option>
              <option value="cash">현금</option>
              <option value="transfer">계좌이체</option>
            </select>
          </div>

          <div className="ptm-table-wrap">
            {acctRows.length === 0 ? (
              <div className="ptm-table-empty">이 기간에 등록된 매출이 없어요</div>
            ) : (
              <table className="ptm-table">
                <thead><tr><th>등록일시</th><th>고객명</th><th>연락처</th><th>판매상품</th><th>판매구분</th><th>정가</th><th>판매가</th><th>결제수단</th><th>결제상태</th></tr></thead>
                <tbody>
                  {acctRows.map((r) => (
                    <tr key={r.id}>
                      <td>{koDate(toLocalDateStr(new Date(r.createdAt || now.getTime())))}</td>
                      <td>{r.customerName}</td>
                      <td>{r.phone || "-"}</td>
                      <td>{r.name}</td>
                      <td>{r.isNew ? "신규" : "재등록"}</td>
                      <td>{Number(r.listPrice ?? r.price ?? 0).toLocaleString()}원</td>
                      <td>{Number(r.price || 0).toLocaleString()}원</td>
                      <td>{paymentMethodLabel[r.paymentMethod] || "-"}</td>
                      <td>{isFullyPaid(r) ? "완납" : `미수 ${getUnpaidAmount(r).toLocaleString()}원`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {view === "forecast" && (
        <>
          <div className="ptm-week-toolbar">
            <div className="ptm-week-nav">
              <button className="ptm-nav-btn" onClick={() => shiftForecastMonth(-1)}><ChevronLeft size={16} /></button>
              <button className="ptm-nav-today" onClick={() => setForecastMonth(today().slice(0, 7))}>이번달</button>
              <button className="ptm-nav-btn" onClick={() => shiftForecastMonth(1)}><ChevronRight size={16} /></button>
              <span className="ptm-week-range">{forecastMonth.slice(0, 4)}년 {Number(forecastMonth.slice(5, 7))}월</span>
            </div>
            <div className="ptm-week-summary">
              <span>휴면 제외 관리 고객 <b>{forecastRows.length}</b>명</span>
            </div>
          </div>

          <div className="ptm-pay-grid">
            <div className="ptm-pay-card">
              <div className="ptm-pay-card-label">이번달 예상 총매출</div>
              <div className="ptm-pay-card-num">{forecastStats.totalExpected.toLocaleString()}원</div>
              <div className="ptm-prod-count">계획 {forecastStats.plannedCount}명 · 달성 {forecastStats.achievedCount}명</div>
            </div>
            <div className="ptm-pay-card">
              <div className="ptm-pay-card-label">이번달 실제 등록금액</div>
              <div className="ptm-pay-card-num" style={{ color: "var(--teal)" }}>{forecastStats.totalActual.toLocaleString()}원</div>
            </div>
            <div className="ptm-pay-card">
              <div className="ptm-pay-card-label">부족한 금액</div>
              <div className="ptm-pay-card-num" style={forecastStats.totalGap > 0 ? { color: "var(--coral)" } : {}}>{forecastStats.totalGap.toLocaleString()}원</div>
            </div>
            <div className="ptm-pay-card">
              <div className="ptm-pay-card-label">계획 대비 달성률</div>
              <div className="ptm-pay-card-num">{forecastStats.totalExpected > 0 ? Math.round((forecastStats.totalActual / forecastStats.totalExpected) * 100) : 0}%</div>
            </div>
          </div>

          <div className="ptm-toolbar">
            <div className="ptm-search">
              <Search size={15} color="#8a94a6" />
              <input placeholder="이름 또는 전화번호 검색" value={forecastQuery} onChange={(e) => setForecastQuery(e.target.value)} />
            </div>
          </div>

          <div className="ptm-no-product-msg" style={{ marginTop: -6, marginBottom: 10 }}>
보유한 이용권 전체의 잔여세션 합산이 적은 고객이 위로 정렬돼요. 행의 연필 아이콘을 눌러 예상세션·예상금액을 바로 입력하세요.
          </div>

          <div className="ptm-table-wrap">
            {filteredForecastRows.length === 0 ? (
              <div className="ptm-table-empty">{customers.length === 0 ? "등록된 고객이 없어요" : "검색 결과가 없어요"}</div>
            ) : (
              <table className="ptm-table ptm-table-compact">
                <thead><tr><th>고객명</th><th>연락처</th><th>주요 운동시간대</th><th>주당 평균 횟수</th><th>보유세션</th><th>잔여세션</th><th>예상세션</th><th>예상금액</th><th>이번달 등록금액</th><th>부족액</th><th>메모</th><th></th></tr></thead>
                <tbody>
                  {filteredForecastRows.map((r) => {
                    const visitTitle = r.recentVisits.length
                      ? `최근 방문: ${r.recentVisits.map((d) => koDate(d)).join(", ")}`
                      : "완료 처리된 예약 기록이 없어요";
                    return (
                    <tr key={r.customerId} className={r.expectedAmount > 0 ? "ptm-row-planned" : ""}>
                      <td className="ptm-hover-link" onClick={() => { setCustomerDetailId(r.customerId); setCustomerDetailTab("home"); }}>{r.customerName}</td>
                      <td>{r.customerPhone || "-"}</td>
                      <td title={visitTitle}>{r.timeSlotLabel}</td>
                      <td title={visitTitle}>{r.weeklyAvgLabel}</td>
                      <td>{r.totalSummary}</td>
                      <td title={r.ticketCount > 1 ? `이용권별 잔여: ${r.remainDetail}` : undefined}>{r.remainSummary}</td>
                      <td>{r.expectedSessions ?? "-"}</td>
                      <td>{r.expectedAmount > 0 ? `${r.expectedAmount.toLocaleString()}원` : "-"}</td>
                      <td style={r.actual > 0 ? { color: "var(--teal)" } : {}}>{r.actual > 0 ? `${r.actual.toLocaleString()}원` : "-"}</td>
                      <td style={r.expectedAmount > 0 && r.gap > 0 ? { color: "var(--coral)" } : {}}>{r.expectedAmount > 0 ? `${r.gap.toLocaleString()}원` : "-"}</td>
                      <td>{r.note || "-"}</td>
                      <td>
                        <div className="ptm-actions">
                          <button className="ptm-icon-btn" title="예상세션·금액 입력" onClick={() => openForecastFor(r)}><Pencil size={14} /></button>
                          {r.forecastId && <button className="ptm-icon-btn" title="예정 삭제" onClick={() => requestRemoveForecast(r.forecastId as string, `"${r.customerName}"의 재등록 예정을 삭제할까요?`)}><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="ptm-detail-section-title" style={{ marginTop: 22 }}>신규 고객 명단</div>
          <div className="ptm-no-product-msg" style={{ marginTop: -6, marginBottom: 10 }}>
            아직 등록 안 된 신규 고객도 이름과 예상 매출을 적어두면 위 이번달 예상 총매출에 함께 합산돼요.
          </div>
          <div className="ptm-table-wrap">
            <table className="ptm-table ptm-table-compact">
              <thead><tr><th>이름</th><th>예상금액</th><th>메모</th><th></th></tr></thead>
              <tbody>
                {prospectRows.map((f) => (
                  <tr key={f.id} className={Number(f.expectedAmount || 0) > 0 ? "ptm-row-planned" : ""}>
                    <td>
                      <input className="ptm-cell-input" value={f.prospectName || ""} placeholder="이름"
                        onChange={(e) => updateProspectField(f.id, "prospectName", e.target.value)}
                        onBlur={() => persistProspect(f.id)} />
                    </td>
                    <td>
                      <input className="ptm-cell-input" type="text" inputMode="numeric" placeholder="0"
                        onFocus={(e) => e.target.select()}
                        value={fmtNum(f.expectedAmount)}
                        onChange={(e) => updateProspectField(f.id, "expectedAmount", parseNum(e.target.value))}
                        onBlur={() => persistProspect(f.id)} />
                    </td>
                    <td>
                      <input className="ptm-cell-input" value={f.note || ""} placeholder="메모"
                        onChange={(e) => updateProspectField(f.id, "note", e.target.value)}
                        onBlur={() => persistProspect(f.id)} />
                    </td>
                    <td>
                      <div className="ptm-actions">
                        <button className="ptm-icon-btn" title="삭제" onClick={() => requestRemoveForecast(f.id, `"${f.prospectName || "이름 없음"}" 신규 고객 명단을 삭제할까요?`)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <input className="ptm-cell-input" value={newProspectForm.name} placeholder="새 고객 이름"
                      onChange={(e) => setNewProspectForm({ ...newProspectForm, name: e.target.value })}
                      onKeyDown={handleProspectKeyDown} />
                  </td>
                  <td>
                    <input className="ptm-cell-input" type="text" inputMode="numeric" placeholder="0"
                      onFocus={(e) => e.target.select()}
                      value={fmtNum(newProspectForm.expectedAmount)}
                      onChange={(e) => setNewProspectForm({ ...newProspectForm, expectedAmount: parseNum(e.target.value) })}
                      onKeyDown={handleProspectKeyDown} />
                  </td>
                  <td>
                    <input className="ptm-cell-input" value={newProspectForm.note} placeholder="메모(선택)"
                      onChange={(e) => setNewProspectForm({ ...newProspectForm, note: e.target.value })}
                      onKeyDown={handleProspectKeyDown} />
                  </td>
                  <td>
                    <div className="ptm-actions">
                      <button className="ptm-icon-btn" title="추가" onClick={addProspect}><Plus size={14} /></button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "stats" && (
        <>
          <div className="ptm-pay-grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
            <div className="ptm-pay-hero" style={{ margin: 0 }}>
              <div className="ptm-pay-hero-label">{statsCurrent.y}년 {statsCurrent.m}월 등록 매출 <span style={{ fontWeight: 400 }}>(상품 등록·결제 기준)</span></div>
              <div className="ptm-pay-hero-num">{statsCurrent.regRevenue.toLocaleString()}원</div>
              <div className="ptm-pay-hero-sub">
                이번달 등록 {statsCurrent.regCount}건 (신규 {statsCurrent.newCount} · 재등록 {statsCurrent.renewCount})
                {statsCurrent.regUnpaid > 0 && <span style={{ color: "var(--coral)" }}> · 미수금 {statsCurrent.regUnpaid.toLocaleString()}원</span>}
              </div>
              <div className="ptm-pay-hero-sub">신규 매출 {statsCurrent.newRevenue.toLocaleString()}원 · 재등록 매출 {statsCurrent.renewRevenue.toLocaleString()}원</div>
            </div>
            <div className="ptm-pay-hero" style={{ margin: 0 }}>
              <div className="ptm-pay-hero-label">{statsCurrent.y}년 {statsCurrent.m}월 세션 매출 <span style={{ fontWeight: 400 }}>(레슨 완료 기준)</span></div>
              <div className="ptm-pay-hero-num">{statsCurrent.revenue.toLocaleString()}원</div>
              <div className="ptm-pay-hero-sub">완료 {statsCurrent.sessionCount}건 · 노쇼 {statsCurrent.noshowCount}건{statsCurrent.sessionCount + statsCurrent.noshowCount > 0 && ` · 노쇼율 ${noshowRate(statsCurrent)}%`}</div>
            </div>
          </div>
          <div className="ptm-no-product-msg" style={{ marginTop: -6, marginBottom: 14 }}>
            등록 매출은 이용권을 등록·결제한 시점 기준이고, 세션 매출은 그 레슨을 실제로 &ldquo;완료&rdquo; 처리한 시점 기준이라 서로 다를 수 있어요.
          </div>

          <div className="ptm-stats-compare">
            <div className="ptm-compare-card">
              <div className="ptm-compare-title">지난달 대비 등록 매출</div>
              <div className={`ptm-compare-num ${statsCurrent.regRevenue - statsPrevious.regRevenue >= 0 ? "up" : "down"}`}>
                {statsCurrent.regRevenue - statsPrevious.regRevenue >= 0 ? "▲" : "▼"} {Math.abs(statsCurrent.regRevenue - statsPrevious.regRevenue).toLocaleString()}원
                {pctDiff(statsCurrent.regRevenue, statsPrevious.regRevenue) !== null && ` (${pctDiff(statsCurrent.regRevenue, statsPrevious.regRevenue)}%)`}
              </div>
              <div className="ptm-compare-sub">지난달 {statsPrevious.regRevenue.toLocaleString()}원</div>
            </div>
            <div className="ptm-compare-card">
              <div className="ptm-compare-title">지난달 대비 세션 매출</div>
              <div className={`ptm-compare-num ${statsCurrent.revenue - statsPrevious.revenue >= 0 ? "up" : "down"}`}>
                {statsCurrent.revenue - statsPrevious.revenue >= 0 ? "▲" : "▼"} {Math.abs(statsCurrent.revenue - statsPrevious.revenue).toLocaleString()}원
                {pctDiff(statsCurrent.revenue, statsPrevious.revenue) !== null && ` (${pctDiff(statsCurrent.revenue, statsPrevious.revenue)}%)`}
              </div>
              <div className="ptm-compare-sub">지난달 {statsPrevious.revenue.toLocaleString()}원</div>
            </div>
            <div className="ptm-compare-card">
              <div className="ptm-compare-title">지난달 대비 레슨 수</div>
              <div className={`ptm-compare-num ${statsCurrent.sessionCount - statsPrevious.sessionCount >= 0 ? "up" : "down"}`}>
                {statsCurrent.sessionCount - statsPrevious.sessionCount >= 0 ? "▲" : "▼"} {Math.abs(statsCurrent.sessionCount - statsPrevious.sessionCount)}건
              </div>
              <div className="ptm-compare-sub">지난달 {statsPrevious.sessionCount}건</div>
            </div>
            <div className="ptm-compare-card">
              <div className="ptm-compare-title">최근 6개월 평균 대비 등록 매출</div>
              <div className={`ptm-compare-num ${statsCurrent.regRevenue - statsAvg6.avgRegRevenue >= 0 ? "up" : "down"}`}>
                {statsCurrent.regRevenue - statsAvg6.avgRegRevenue >= 0 ? "▲" : "▼"} {Math.abs(Math.round(statsCurrent.regRevenue - statsAvg6.avgRegRevenue)).toLocaleString()}원
                {pctDiff(statsCurrent.regRevenue, statsAvg6.avgRegRevenue) !== null && ` (${pctDiff(statsCurrent.regRevenue, statsAvg6.avgRegRevenue)}%)`}
              </div>
              <div className="ptm-compare-sub">평균 {Math.round(statsAvg6.avgRegRevenue).toLocaleString()}원</div>
            </div>
            <div className="ptm-compare-card">
              <div className="ptm-compare-title">최근 6개월 평균 대비 세션 매출</div>
              <div className={`ptm-compare-num ${statsCurrent.revenue - statsAvg6.avgRevenue >= 0 ? "up" : "down"}`}>
                {statsCurrent.revenue - statsAvg6.avgRevenue >= 0 ? "▲" : "▼"} {Math.abs(Math.round(statsCurrent.revenue - statsAvg6.avgRevenue)).toLocaleString()}원
                {pctDiff(statsCurrent.revenue, statsAvg6.avgRevenue) !== null && ` (${pctDiff(statsCurrent.revenue, statsAvg6.avgRevenue)}%)`}
              </div>
              <div className="ptm-compare-sub">평균 {Math.round(statsAvg6.avgRevenue).toLocaleString()}원</div>
            </div>
            <div className="ptm-compare-card">
              <div className="ptm-compare-title">최근 6개월 평균 대비 레슨 수</div>
              <div className={`ptm-compare-num ${statsCurrent.sessionCount - statsAvg6.avgSessions >= 0 ? "up" : "down"}`}>
                {statsCurrent.sessionCount - statsAvg6.avgSessions >= 0 ? "▲" : "▼"} {Math.abs(Math.round(statsCurrent.sessionCount - statsAvg6.avgSessions))}건
              </div>
              <div className="ptm-compare-sub">평균 {statsAvg6.avgSessions.toFixed(1)}건</div>
            </div>
          </div>

          <div className="ptm-charts">
            <div className="ptm-chart-card">
              <div className="ptm-chart-title">최근 12개월 등록 매출 추이 (이번달 강조)</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={statsTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ee" vertical={false} />
                  <XAxis dataKey="label" stroke="#8a94a6" fontSize={11} />
                  <YAxis stroke="#8a94a6" fontSize={11} width={40} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #dde3ee", borderRadius: 8, color: "#1f2937" }} formatter={(v) => Number(v ?? 0).toLocaleString() + "원"} />
                  <Bar dataKey="regRevenue" radius={[4, 4, 0, 0]}>
                    {statsTrend.map((entry, idx) => <Cell key={idx} fill={idx === 11 ? "#3b6fe0" : "#1aa35a"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="ptm-chart-card">
              <div className="ptm-chart-title">최근 12개월 세션 매출 추이 (이번달 강조)</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={statsTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ee" vertical={false} />
                  <XAxis dataKey="label" stroke="#8a94a6" fontSize={11} />
                  <YAxis stroke="#8a94a6" fontSize={11} width={40} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #dde3ee", borderRadius: 8, color: "#1f2937" }} formatter={(v) => Number(v ?? 0).toLocaleString() + "원"} />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {statsTrend.map((entry, idx) => <Cell key={idx} fill={idx === 11 ? "#3b6fe0" : "#7c6fd6"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="ptm-chart-card">
              <div className="ptm-chart-title">최근 12개월 레슨(완료) 수 · 노쇼 추이</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={statsTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ee" vertical={false} />
                  <XAxis dataKey="label" stroke="#8a94a6" fontSize={11} />
                  <YAxis stroke="#8a94a6" fontSize={11} width={30} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #dde3ee", borderRadius: 8, color: "#1f2937" }} />
                  <Bar dataKey="sessionCount" name="완료" stackId="a" radius={[4, 4, 0, 0]} fill="#1aa35a" />
                  <Bar dataKey="noshowCount" name="노쇼" stackId="a" fill="#e0433f" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="ptm-chart-card">
              <div className="ptm-chart-title">최근 12개월 신규 · 재등록 매출</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={statsTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ee" vertical={false} />
                  <XAxis dataKey="label" stroke="#8a94a6" fontSize={11} />
                  <YAxis stroke="#8a94a6" fontSize={11} width={40} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #dde3ee", borderRadius: 8, color: "#1f2937" }} formatter={(v) => Number(v ?? 0).toLocaleString() + "원"} />
                  <Bar dataKey="newRevenue" name="신규" stackId="a" radius={[4, 4, 0, 0]} fill="#3b6fe0" />
                  <Bar dataKey="renewRevenue" name="재등록" stackId="a" fill="#7c6fd6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="ptm-chart-card">
              <div className="ptm-chart-title">최근 12개월 신규 · 재등록 건수</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={statsTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ee" vertical={false} />
                  <XAxis dataKey="label" stroke="#8a94a6" fontSize={11} />
                  <YAxis stroke="#8a94a6" fontSize={11} width={30} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #dde3ee", borderRadius: 8, color: "#1f2937" }} formatter={(v) => v + "건"} />
                  <Bar dataKey="newCount" name="신규" stackId="a" radius={[4, 4, 0, 0]} fill="#1aa35a" />
                  <Bar dataKey="renewCount" name="재등록" stackId="a" fill="#e0433f" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="ptm-table-wrap">
            <table className="ptm-table">
              <thead><tr><th>월</th><th>등록 매출</th><th>신규 매출</th><th>재등록 매출</th><th>등록 건수(신규/재등록)</th><th>세션 매출</th><th>완료 레슨</th><th>노쇼</th><th>노쇼율</th></tr></thead>
              <tbody>
                {[...statsTrend].reverse().map((row, idx) => (
                  <tr key={idx}>
                    <td>{row.y}년 {row.m}월{idx === 0 ? " (이번달)" : ""}</td>
                    <td>{row.regRevenue.toLocaleString()}원</td>
                    <td>{row.newRevenue.toLocaleString()}원</td>
                    <td>{row.renewRevenue.toLocaleString()}원</td>
                    <td>{row.regCount}건 ({row.newCount}/{row.renewCount})</td>
                    <td>{row.revenue.toLocaleString()}원</td>
                    <td>{row.sessionCount}건</td>
                    <td>{row.noshowCount}건</td>
                    <td>{noshowRate(row)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "sale" && (
        <ProductSaleWizard
          customers={customers}
          catalog={catalog}
          onSaleComplete={(customer: Customer, product: Product) => {
            setCustomers((cur) => (cur.some((c) => c.id === customer.id) ? cur.map((c) => (c.id === customer.id ? customer : c)) : [...cur, customer]));
            setProducts((cur) => [...cur, product]);
          }}
          flash={flash}
        />
      )}

      {view === "payroll" && (
        <>
          <div className="ptm-week-toolbar">
            <div className="ptm-week-nav">
              <button className="ptm-nav-btn" onClick={() => { const { y, m } = shiftMonth(payYear, payMonth, -1); setPayYear(y); setPayMonth(m); }}><ChevronLeft size={16} /></button>
              <span className="ptm-week-range">{payYear}년 {payMonth}월</span>
              <button className="ptm-nav-btn" onClick={() => { const { y, m } = shiftMonth(payYear, payMonth, 1); setPayYear(y); setPayMonth(m); }}><ChevronRight size={16} /></button>
              <button className="ptm-nav-today" onClick={() => { setPayYear(now.getFullYear()); setPayMonth(now.getMonth() + 1); }}>이번달</button>
            </div>
            <button className="ptm-quick-add" onClick={() => setShowSettings(true)}><Settings2 size={16} /> 급여 설정</button>
          </div>

          <div className="ptm-pay-hero">
            <div className="ptm-pay-hero-label">{payYear}년 {payMonth}월 예상 지급액</div>
            <div className="ptm-pay-hero-num">{payrollCalc.net.toLocaleString()}원</div>
            <div className="ptm-pay-hero-sub">완료 세션 {payrollNow.sessionCount}건 · 노쇼 {payrollNow.noshowCount}건 · 세션 매출 {payrollNow.revenue.toLocaleString()}원</div>
          </div>

          <div className="ptm-pay-grid">
            <div className="ptm-pay-card"><div className="ptm-pay-card-label">기본급</div><div className="ptm-pay-card-num">{Number(settings.baseSalary).toLocaleString()}원</div></div>
            <div className="ptm-pay-card"><div className="ptm-pay-card-label">세션 수당 ({settings.commissionRate}%)</div><div className="ptm-pay-card-num">{payrollCalc.commission.toLocaleString()}원</div></div>
            <div className="ptm-pay-card"><div className="ptm-pay-card-label">공제액 ({settings.deductionRate}%)</div><div className="ptm-pay-card-num" style={{ color: "var(--coral)" }}>-{payrollCalc.deduction.toLocaleString()}원</div></div>
            <div className="ptm-pay-card"><div className="ptm-pay-card-label">세전 합계</div><div className="ptm-pay-card-num">{payrollCalc.gross.toLocaleString()}원</div></div>
          </div>

          <div className="ptm-charts">
            <div className="ptm-chart-card">
              <div className="ptm-chart-title">최근 6개월 세션 매출 추이</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={trend6}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ee" vertical={false} />
                  <XAxis dataKey="label" stroke="#8a94a6" fontSize={11} />
                  <YAxis stroke="#8a94a6" fontSize={11} width={40} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #dde3ee", borderRadius: 8, color: "#1f2937" }} formatter={(v) => Number(v ?? 0).toLocaleString() + "원"} />
                  <Bar dataKey="매출" fill="#3b6fe0" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="ptm-chart-card">
              <div className="ptm-chart-title">최근 6개월 완료 세션 수</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={trend6}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ee" vertical={false} />
                  <XAxis dataKey="label" stroke="#8a94a6" fontSize={11} />
                  <YAxis stroke="#8a94a6" fontSize={11} width={30} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #dde3ee", borderRadius: 8, color: "#1f2937" }} formatter={(v) => v + "건"} />
                  <Bar dataKey="세션수" fill="#1aa35a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="ptm-table-wrap">
            {monthDetailRows.length === 0 ? (
              <div className="ptm-table-empty">이 달에 완료된 세션이 없어요</div>
            ) : (
              <table className="ptm-table">
                <thead><tr><th>일자</th><th>시간</th><th>고객명</th><th>상품명</th><th>세션 단가</th></tr></thead>
                <tbody>
                  {monthDetailRows.map((r) => (
                    <tr key={r.id}><td>{koDate(r.date)}</td><td>{r.time}</td><td>{r.customerName}</td><td>{r.productName}</td><td>{(r.unitPrice || 0).toLocaleString()}원</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {customerDetailId && (() => {
        const cust = customers.find((c) => c.id === customerDetailId);
        if (!cust) return null;
        const custProducts = products.filter((p) => p.customerId === cust.id);
        const custReservations = allReservations.filter((r) => r.customerId === cust.id).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
        const totalPaid = custProducts.reduce((s, p) => s + getPaidAmount(p), 0);
        const totalUnpaid = custProducts.reduce((s, p) => s + getUnpaidAmount(p), 0);
        const custForecasts = [...renewalForecasts].filter((f) => f.customerId === cust.id).sort((a, b) => b.targetMonth.localeCompare(a.targetMonth));
        return (
          <div className="ptm-overlay" onClick={() => setCustomerDetailId(null)}>
            <div className="ptm-sheet ptm-detail-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="ptm-sheet-head">
                <span className="ptm-sheet-title">{cust.name}{cust.phone ? ` · ${cust.phone}` : ""}</span>
                <div className="ptm-actions">
                  <button className="ptm-icon-btn" onClick={() => openEditCustomer(cust)}><Pencil size={14} /></button>
                  <button className="ptm-icon-btn" onClick={() => setCustomerDetailId(null)}><X size={16} /></button>
                </div>
              </div>

              <div className="ptm-detail-tabs">
                <button className={`ptm-detail-tab ${customerDetailTab === "home" ? "active" : ""}`} onClick={() => setCustomerDetailTab("home")}>홈</button>
                <button className={`ptm-detail-tab ${customerDetailTab === "products" ? "active" : ""}`} onClick={() => setCustomerDetailTab("products")}>이용권</button>
                <button className={`ptm-detail-tab ${customerDetailTab === "sales" ? "active" : ""}`} onClick={() => setCustomerDetailTab("sales")}>판매내역</button>
                <button className={`ptm-detail-tab ${customerDetailTab === "workoutLog" ? "active" : ""}`} onClick={() => setCustomerDetailTab("workoutLog")}>운동일지</button>
              </div>

              {customerDetailTab === "home" && (
                <>
                  <div className="ptm-detail-stats">
                    <div className="ptm-detail-stat"><div className="ptm-detail-stat-num">{koDate(toLocalDateStr(new Date(cust.createdAt || now.getTime())))}</div><div className="ptm-detail-stat-label">등록일</div></div>
                    <div className="ptm-detail-stat"><div className="ptm-detail-stat-num">{custProducts.length}개</div><div className="ptm-detail-stat-label">보유 상품</div></div>
                    <div className="ptm-detail-stat"><div className="ptm-detail-stat-num">{totalPaid.toLocaleString()}원</div><div className="ptm-detail-stat-label">누적 결제금액</div></div>
                    <div className="ptm-detail-stat" style={totalUnpaid > 0 ? { color: "var(--coral)" } : {}}><div className="ptm-detail-stat-num">{totalUnpaid.toLocaleString()}원</div><div className="ptm-detail-stat-label">미수금</div></div>
                  </div>
                  {(cust.birthdate || cust.email) && (
                    <div className="ptm-detail-memo">
                      {cust.birthdate ? `생년월일: ${cust.birthdate}` : ""}{cust.birthdate && cust.email ? " · " : ""}{cust.email ? `이메일: ${cust.email}` : ""}
                    </div>
                  )}
                  {cust.memo && <div className="ptm-detail-memo">{cust.memo}</div>}

                  <div className="ptm-detail-section-title">재등록 예정</div>
                  {custForecasts.length === 0 ? (
                    <div className="ptm-no-product-msg">등록된 재등록 예정이 없어요</div>
                  ) : (
                    custForecasts.map((f) => (
                      <div className="ptm-prod-row" key={f.id} style={{ marginBottom: 8 }}>
                        <div className="ptm-prod-top">
                          <div>
                            <span className="ptm-prod-name">{f.targetMonth.slice(0, 4)}년 {Number(f.targetMonth.slice(5, 7))}월</span>{" "}
                            <span className="ptm-res-badge">대기</span>
                          </div>
                          <div className="ptm-actions">
                            <button className="ptm-icon-btn" onClick={() => openEditForecast(f)}><Pencil size={14} /></button>
                            <button className="ptm-icon-btn" onClick={() => requestRemoveForecast(f.id, `${f.targetMonth.slice(0, 4)}년 ${Number(f.targetMonth.slice(5, 7))}월 재등록 예정을 삭제할까요?`)}><Trash2 size={14} /></button>
                          </div>
                        </div>
                        <div className="ptm-prod-bottom">
                          <div className="ptm-price">
                            예상 {Number(f.expectedAmount || 0).toLocaleString()}원{f.expectedSessions ? ` · ${f.expectedSessions}회` : ""}
                          </div>
                        </div>
                        {f.note && <div className="ptm-res-memo">{f.note}</div>}
                      </div>
                    ))
                  )}
                  <button className="ptm-add-product-btn" onClick={() => openNewForecast(cust.id)}><Plus size={14} /> 재등록 예정 추가</button>

                  <div className="ptm-detail-section-title" style={{ marginTop: 14 }}>최근 예약 · 출결 내역</div>
                  {custReservations.length === 0 ? (
                    <div className="ptm-res-empty">예약 내역이 없어요</div>
                  ) : (
                    <div className="ptm-table-wrap">
                      <table className="ptm-table">
                        <thead><tr><th>일시</th><th>상품</th><th>상태</th></tr></thead>
                        <tbody>
                          {custReservations.slice(0, 8).map((r) => (
                            <tr key={r.id}><td>{koDate(r.date)} {r.time}</td><td>{r.productName}</td><td>{statusLabel[r.status]}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {customerDetailTab === "products" && (
                <div className="ptm-prod-list" style={{ marginTop: 0 }}>
                  {custProducts.length === 0 && <div className="ptm-no-product-msg">등록된 상품이 없어요</div>}
                  {custProducts.map((p) => {
                    const u = urgency(p);
                    const upcoming = reservations.filter((r) => r.productId === p.id && r.status === "scheduled").length;
                    return (
                      <div className="ptm-prod-row" key={p.id}>
                        <div className="ptm-prod-top">
                          <div>
                            <span className="ptm-prod-name">{p.name}</span>{" "}
                            <span className="ptm-badge">{p.type === "session" ? "횟수권" : "기간권"}</span>{" "}
                            <span className={`ptm-badge ${isFullyPaid(p) ? "" : "unpaid"}`} onClick={() => togglePaid(p.id)} style={{ cursor: "pointer" }}>{isFullyPaid(p) ? "완납" : `미수 ${getUnpaidAmount(p).toLocaleString()}원`}</span>
                          </div>
                          <div className="ptm-actions">
                            <button className="ptm-icon-btn" title="예약 관리" onClick={() => setResSheetProductId(p.id)}><CalendarClock size={14} /></button>
                            <button className="ptm-icon-btn" onClick={() => openEditProduct(p)}><Pencil size={14} /></button>
                            <button className="ptm-icon-btn" onClick={() => requestRemoveProduct(p)}><Trash2 size={14} /></button>
                          </div>
                        </div>
                        <div className="ptm-gauge-row">
                          <div className="ptm-gauge-track"><div className={`ptm-gauge-fill ${u}`} style={{ width: `${progressPct(p)}%` }} /></div>
                          <div className="ptm-gauge-label">{remainLabel(p)}</div>
                        </div>
                        <div className="ptm-prod-bottom">
                          <div className="ptm-price">
                            {Number(p.price || 0).toLocaleString()}원{upcoming > 0 ? ` · 예약 ${upcoming}건 대기` : ""}
                          </div>
                          {p.type === "session" && (
                            <div className="ptm-session-btns">
                              <button className="ptm-mini-btn" onClick={() => bumpSession(p.id, -1)}><Minus size={12} /></button>
                              <span style={{ fontSize: 12, color: "#8a94a6" }}>수동조정</span>
                              <button className="ptm-mini-btn" onClick={() => bumpSession(p.id, 1)}><Plus size={12} /></button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <button className="ptm-add-product-btn" onClick={() => openNewProduct(cust.id)}><Plus size={14} /> 상품(이용권) 추가</button>
                </div>
              )}

              {customerDetailTab === "sales" && (() => {
                const salesTotal = custProducts.reduce((s, p) => s + Number(p.price || 0), 0);
                const paidTotal = custProducts.reduce((s, p) => s + getPaidAmount(p), 0);
                const unpaidTotal = custProducts.reduce((s, p) => s + getUnpaidAmount(p), 0);
                const createdDates = custProducts.map((p) => p.createdAt || 0).filter(Boolean).sort((a, b) => a - b);
                const firstPayDate = createdDates.length ? koDate(toLocalDateStr(new Date(createdDates[0]))) : "-";
                const lastPayDate = createdDates.length ? koDate(toLocalDateStr(new Date(createdDates[createdDates.length - 1]))) : "-";
                return (
                  <>
                    <div className="ptm-detail-stats" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
                      <div className="ptm-detail-stat"><div className="ptm-detail-stat-num">{salesTotal.toLocaleString()}원</div><div className="ptm-detail-stat-label">누적 판매금액</div></div>
                      <div className="ptm-detail-stat"><div className="ptm-detail-stat-num">{paidTotal.toLocaleString()}원</div><div className="ptm-detail-stat-label">총 결제금액</div></div>
                      <div className="ptm-detail-stat" style={unpaidTotal > 0 ? { color: "var(--coral)" } : {}}><div className="ptm-detail-stat-num">{unpaidTotal.toLocaleString()}원</div><div className="ptm-detail-stat-label">미수금 잔액</div></div>
                      <div className="ptm-detail-stat"><div className="ptm-detail-stat-num">{firstPayDate}</div><div className="ptm-detail-stat-label">첫 결제일</div></div>
                      <div className="ptm-detail-stat"><div className="ptm-detail-stat-num">{lastPayDate}</div><div className="ptm-detail-stat-label">최근 결제일</div></div>
                    </div>
                    <div className="ptm-table-wrap">
                      {custProducts.length === 0 ? (
                        <div className="ptm-table-empty">판매 내역이 없어요</div>
                      ) : (
                        <table className="ptm-table">
                          <thead><tr><th>등록일</th><th>상품명</th><th>정가</th><th>판매가</th><th>결제수단</th><th>결제상태</th></tr></thead>
                          <tbody>
                            {[...custProducts].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((p) => (
                              <tr key={p.id} className="ptm-row-clickable" onClick={() => openEditProduct(p)}>
                                <td>{koDate(toLocalDateStr(new Date(p.createdAt || Date.now())))}</td>
                                <td>{p.name}</td>
                                <td>{Number(p.listPrice ?? p.price ?? 0).toLocaleString()}원</td>
                                <td>{Number(p.price || 0).toLocaleString()}원</td>
                                <td>{paymentMethodLabel[p.paymentMethod] || "-"}</td>
                                <td>{isFullyPaid(p) ? "완납" : `미수 ${getUnpaidAmount(p).toLocaleString()}원`}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </>
                );
              })()}

              {customerDetailTab === "workoutLog" && (() => {
                const logs = getCustomerWorkoutLogs(allReservations, cust.id);
                const NOTE_PREVIEW_LEN = 80;
                return (
                  <div className="ptm-prod-list" style={{ marginTop: 0 }}>
                    {logs.length === 0 ? (
                      <div className="ptm-no-product-msg">기록된 운동 내용이 없어요</div>
                    ) : (
                      logs.map((log) => {
                        const tags = matchBodyPartTags(log.note);
                        const isLong = log.note.length > NOTE_PREVIEW_LEN;
                        const expanded = !!expandedWorkoutNotes[log.reservationId];
                        const shownNote = isLong && !expanded ? `${log.note.slice(0, NOTE_PREVIEW_LEN)}…` : log.note;
                        return (
                          <div className="ptm-prod-row" key={log.reservationId}>
                            <div className="ptm-prod-top">
                              <span className="ptm-prod-name">{koDate(log.date)} {log.time}</span>
                              {tags.length > 0 && (
                                <div className="ptm-actions">
                                  {tags.map((tag) => (
                                    <span className="ptm-badge" key={tag}>{tag}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="ptm-res-memo" style={{ whiteSpace: "pre-wrap" }}>{shownNote}</div>
                            {isLong && (
                              <button
                                className="ptm-icon-btn"
                                style={{ width: "auto", padding: "2px 0", fontSize: 12, color: "var(--ink-dim)" }}
                                onClick={() => setExpandedWorkoutNotes((prev) => ({ ...prev, [log.reservationId]: !expanded }))}
                              >
                                {expanded ? "접기" : "더보기"}
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}

      {showBulkImport && (
        <div className="ptm-overlay" onClick={() => setShowBulkImport(false)}>
          <div className="ptm-sheet ptm-detail-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">고객 일괄 등록</span>
              <button className="ptm-icon-btn" onClick={() => setShowBulkImport(false)}><X size={16} /></button>
            </div>
            <div className="ptm-bulk-help">
              한 줄에 한 명씩, <b>이름, 전화번호</b> 순서로 붙여넣어주세요. 콤마(,) 또는 탭으로 구분되면 자동으로 인식돼요.
              생년월일·이메일·메모까지 있으면 <b>이름, 전화번호, 생년월일, 이메일, 메모</b> 순서로 이어서 넣으시면 돼요 (없는 항목은 비워둬도 괜찮아요).
              <br />예시: <code>김민지, 010-1234-5678</code>
            </div>
            <textarea
              className="ptm-bulk-textarea"
              rows={10}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={"김민지, 010-1234-5678\n박나래, 010-2345-6789\n최동비, 010-3456-7890"}
            />
            <div className="ptm-bulk-preview">
              {bulkRows.length === 0 ? "등록할 내용을 붙여넣어주세요" : `${bulkRows.length}명 인식됨${bulkDuplicatePhones > 0 ? ` · 기존 전화번호와 중복 ${bulkDuplicatePhones}건은 자동으로 건너뛰어요` : ""}`}
            </div>
            <button className="ptm-save-btn" onClick={runBulkImport}>{bulkRows.length > 0 ? `${bulkRows.length}명 일괄 등록하기` : "일괄 등록하기"}</button>
          </div>
        </div>
      )}

      {showCustomerForm && (
        <div className="ptm-overlay" onClick={() => setShowCustomerForm(false)}>
          <div className="ptm-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">{editingCustomerId ? "고객 정보 수정" : "새 고객 등록"}</span>
              <button className="ptm-icon-btn" onClick={() => setShowCustomerForm(false)}><X size={16} /></button>
            </div>
            <div className="ptm-field"><label>이름</label>
              <input value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} placeholder="고객 이름" />
            </div>
            <div className="ptm-field"><label>전화번호</label>
              <input value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: formatPhone(e.target.value) })} placeholder="010-0000-0000" />
            </div>
            <div className="ptm-row2">
              <div className="ptm-field"><label>생년월일</label>
                <input type="date" value={customerForm.birthdate ?? ""} onChange={(e) => setCustomerForm({ ...customerForm, birthdate: e.target.value })} />
              </div>
              <div className="ptm-field"><label>이메일</label>
                <input type="email" value={customerForm.email} onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })} placeholder="example@email.com" />
              </div>
            </div>
            <div className="ptm-field"><label>메모</label>
              <textarea rows={2} value={customerForm.memo} onChange={(e) => setCustomerForm({ ...customerForm, memo: e.target.value })} placeholder="특이사항 메모" />
            </div>
            <button className="ptm-save-btn" onClick={saveCustomer}>{editingCustomerId ? "수정 완료" : "고객 등록"}</button>
          </div>
        </div>
      )}

      {showProductForm && (
        <div className="ptm-overlay" onClick={() => setShowProductForm(false)}>
          <div className="ptm-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">{editingProductId ? "상품 정보 수정" : "새 상품(이용권) 등록"}</span>
              <button className="ptm-icon-btn" onClick={() => setShowProductForm(false)}><X size={16} /></button>
            </div>
            {catalog.length > 0 && (
              <div className="ptm-field"><label>이용권에서 불러오기 (선택 시 자동 입력 · 이후 금액 등 수정 가능)</label>
                <select
                  value={productCatalogPick}
                  onChange={(e) => {
                    const id = e.target.value;
                    setProductCatalogPick(id);
                    const item = catalog.find((c) => c.id === id);
                    if (item) {
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
                    }
                  }}
                >
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
                <div className="ptm-field"><label>사용한 횟수</label>
                  <input type="number" onFocus={(e) => e.target.select()} value={productForm.usedSessions} onChange={(e) => setProductForm({ ...productForm, usedSessions: Number(e.target.value) })} />
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
                  <input type="date" value={productForm.endDate ?? ""} onChange={(e) => setProductForm({ ...productForm, endDate: e.target.value })} />
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
                  onChange={(e) => {
                    const v = parseNum(e.target.value);
                    setProductForm({ ...productForm, price: v, paidAmount: editingProductId ? productForm.paidAmount : v });
                  }}
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
            <div className="ptm-field"><label>결제일 — 회계관리·판매내역 집계 기준일이에요</label>
              <input type="date" value={productForm.createdAt} onChange={(e) => setProductForm({ ...productForm, createdAt: e.target.value })} />
            </div>
            {Number(productForm.price) - Number(productForm.paidAmount) > 0 && (
              <div className="ptm-unpaid-note">미수금 {(Number(productForm.price) - Number(productForm.paidAmount)).toLocaleString()}원 남음</div>
            )}
            <button className="ptm-save-btn" onClick={saveProduct}>{editingProductId ? "수정 완료" : "상품 등록"}</button>
          </div>
        </div>
      )}

      {resSheetProduct && resSheetCustomer && (
        <div className="ptm-overlay" onClick={() => setResSheetProductId(null)}>
          <div className="ptm-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">{resSheetCustomer.name} · {resSheetProduct.name}</span>
              <button className="ptm-icon-btn" onClick={() => setResSheetProductId(null)}><X size={16} /></button>
            </div>
            <div className="ptm-res-add-row">
              <div className="ptm-field"><label>날짜</label>
                <input type="date" value={resForm.date} onChange={(e) => setResForm({ ...resForm, date: e.target.value })} />
              </div>
              <div className="ptm-field"><label>시간</label>
                <input type="time" value={resForm.time} onChange={(e) => setResForm({ ...resForm, time: e.target.value })} />
              </div>
              <div className="ptm-field" style={{ maxWidth: 70 }}><label>분</label>
                <input type="number" onFocus={(e) => e.target.select()} value={resForm.duration} onChange={(e) => setResForm({ ...resForm, duration: e.target.value })} />
              </div>
              <button className="ptm-res-add-btn" onClick={() => addReservation(resSheetCustomer.id, resSheetProduct.id)}><Plus size={16} /></button>
            </div>
            {resForm.repeat === "none" && isPastDateTime(resForm.date, resForm.time) && (
              <div className="ptm-res-actions" style={{ marginTop: -8, marginBottom: 14 }}>
                <span className="ptm-no-product-msg" style={{ padding: 0 }}>이미 지난 시간 →</span>
                <button className="ptm-res-btn" onClick={() => addReservation(resSheetCustomer.id, resSheetProduct.id, "done")}><Check size={12} /> 출석으로 등록</button>
                <button className="ptm-res-btn danger" onClick={() => addReservation(resSheetCustomer.id, resSheetProduct.id, "noshow")}><UserX size={12} /> 결석으로 등록</button>
              </div>
            )}
            <div className="ptm-repeat-row">
              <div className="ptm-field"><label>반복</label>
                <select value={resForm.repeat} onChange={(e) => setResForm({ ...resForm, repeat: e.target.value, repeatCount: getDefaultRepeatCount(e.target.value, resForm.date) })}>
                  <option value="none">안함</option>
                  <option value="daily">매일</option>
                  <option value="weekly">매주</option>
                  <option value="biweekly">2주마다</option>
                  <option value="monthly">매월</option>
                  <option value="yearly">매년</option>
                </select>
              </div>
              {resForm.repeat !== "none" && (
                <div className="ptm-field" style={{ maxWidth: 110 }}><label>반복 횟수</label>
                  <input type="number" min="1" onFocus={(e) => e.target.select()} value={resForm.repeatCount} onChange={(e) => setResForm({ ...resForm, repeatCount: e.target.value })} />
                </div>
              )}
            </div>
            {resForm.repeat !== "none" && (
              <div className="ptm-discount-note">{repeatLabel[resForm.repeat]} 간격으로 총 {Math.max(1, Number(resForm.repeatCount) || 1)}회 예약이 등록돼요</div>
            )}
            {reservations.filter((r) => r.productId === resSheetProduct.id).length === 0 ? (
              <div className="ptm-res-empty">등록된 예약이 없어요</div>
            ) : (
              [...reservations.filter((r) => r.productId === resSheetProduct.id)].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).map((r) => (
                <div className="ptm-res-item" key={r.id}>
                  <div className="ptm-res-item-top">
                    <span className="ptm-res-date">{r.date} {r.time} ({r.duration || 50}분)</span>
                    <span className={`ptm-res-badge ${r.status}`}>{statusLabel[r.status]}</span>
                  </div>
                  {r.memo && <div className="ptm-res-memo">{r.memo}</div>}
                  {r.status === "noshow" ? <span className="ptm-noshow-mark">NO SHOW</span> : r.signatureUrl && <SignatureThumb path={r.signatureUrl} />}
                  <div className="ptm-res-actions">
                    {r.status !== "done" && <button className="ptm-res-btn" onClick={() => requestCompleteReservation(r)}><Check size={12} /> 완료</button>}
                    {r.status !== "noshow" && <button className="ptm-res-btn" onClick={() => setReservationStatus(r.id, "noshow")}><UserX size={12} /> 노쇼</button>}
                    {r.status !== "cancelled" && <button className="ptm-res-btn" onClick={() => requestCancelReservation(r)}><Ban size={12} /> 취소</button>}
                    <button className="ptm-res-btn danger" onClick={() => requestDeleteReservation(r)}><Trash2 size={12} /> 삭제</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showQuickAdd && (
        <div className="ptm-overlay" onClick={() => setShowQuickAdd(false)}>
          <div className="ptm-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">{quickIsMisc ? "새 일정 등록" : "새 예약 등록"} · {koDate(quickForm.date)} {quickForm.time}</span>
              <button className="ptm-icon-btn" onClick={() => setShowQuickAdd(false)}><X size={16} /></button>
            </div>

            <div className="ptm-type-toggle" style={{ marginBottom: 14 }}>
              <button className={`ptm-type-btn ${!quickIsNew && !quickIsMisc ? "active" : ""}`} onClick={() => { setQuickIsNew(false); setQuickIsMisc(false); }}>등록 회원 예약하기</button>
              <button className={`ptm-type-btn ${quickIsNew ? "active" : ""}`} onClick={() => { setQuickIsNew(true); setQuickIsMisc(false); setQuickForm({ ...quickForm, customerId: "", productId: "" }); setQuickSearch(""); }}>미등록 회원 추가하기</button>
              <button className={`ptm-type-btn ${quickIsMisc ? "active" : ""}`} onClick={() => { setQuickIsMisc(true); setQuickIsNew(false); setQuickForm({ ...quickForm, customerId: "", productId: "", memo: "" }); setQuickSearch(""); }}>기타 일정</button>
            </div>

            {quickIsMisc && (
              <div className="ptm-field"><label>제목</label>
                <input value={quickForm.memo} onChange={(e) => setQuickForm({ ...quickForm, memo: e.target.value })} placeholder="예: 팀 미팅, 외부 일정" autoFocus />
              </div>
            )}

            {!quickIsMisc && (quickIsNew ? (
              <div className="ptm-row2">
                <div className="ptm-field"><label>이름</label>
                  <input value={walkInName} onChange={(e) => setWalkInName(e.target.value)} placeholder="신규 고객 이름" autoFocus />
                </div>
                <div className="ptm-field"><label>휴대폰 번호</label>
                  <input value={walkInPhone} onChange={(e) => setWalkInPhone(formatPhone(e.target.value))} placeholder="010-0000-0000" />
                </div>
              </div>
            ) : !quickForm.customerId ? (
              <div className="ptm-field"><label>고객 검색</label>
                <input value={quickSearch} onChange={(e) => setQuickSearch(e.target.value)} placeholder="이름 또는 전화번호" autoFocus />
                {quickSearch.trim() && (
                  <div className="ptm-cust-search-results">
                    {quickMatches.length === 0 ? (
                      <div className="ptm-cust-result" style={{ cursor: "default" }}>검색 결과가 없어요</div>
                    ) : (
                      quickMatches.map((c) => (
                        <div key={c.id} className="ptm-cust-result" onClick={() => {
                          const pid = pickActiveProductId(c.id);
                          const picked = products.find((p) => p.id === pid);
                          setQuickForm({ ...quickForm, customerId: c.id, productId: pid, duration: picked ? picked.sessionDuration || 50 : quickForm.duration });
                          setQuickSearch("");
                        }}>
                          <span>{c.name}</span><span className="ptm-cust-result-phone">{c.phone}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="ptm-selected-chip">
                <div><span className="ptm-selected-chip-name">{quickCustomer?.name}</span><span className="ptm-selected-chip-phone">{quickCustomer?.phone}</span></div>
                <button className="ptm-change-btn" onClick={() => setQuickForm({ ...quickForm, customerId: "", productId: "" })}>변경</button>
              </div>
            ))}

            {quickIsNew && (
              <div className="ptm-no-product-msg">
                신규 고객으로 등록되며, 이 예약은 상담/OT 성격의 임시 예약으로 잡혀요. PT 상품은 등록 후 고객관리에서 추가해주세요.
              </div>
            )}

            {!quickIsNew && quickForm.customerId && (
              <div className="ptm-field"><label>예약할 이용권 (등록순으로 잔여 있는 것을 자동 선택 — 필요하면 직접 변경)</label>
                {quickCustomerProducts.length === 0 ? (
                  <div className="ptm-no-product-msg">등록된 상품이 없어요 — 고객관리에서 먼저 상품을 등록해주세요</div>
                ) : (
                  <select
                    value={quickForm.productId}
                    onChange={(e) => {
                      const p = products.find((x) => x.id === e.target.value);
                      setQuickForm({ ...quickForm, productId: e.target.value, duration: p ? p.sessionDuration || 50 : quickForm.duration });
                    }}
                  >
                    <option value="">상품 선택</option>
                    {quickCustomerProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.type === "session" ? `잔여 ${p.totalSessions - p.usedSessions}/${p.totalSessions}` : `~${p.endDate}`} · {Number(p.price || 0).toLocaleString()}원)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="ptm-row3">
              <div className="ptm-field"><label>날짜</label>
                <input type="date" value={quickForm.date} onChange={(e) => setQuickForm({ ...quickForm, date: e.target.value })} />
              </div>
              <div className="ptm-field"><label>시간</label>
                <input type="time" value={quickForm.time} onChange={(e) => setQuickForm({ ...quickForm, time: e.target.value })} />
              </div>
              <div className="ptm-field"><label>시간(분)</label>
                <input type="number" onFocus={(e) => e.target.select()} value={quickForm.duration} onChange={(e) => setQuickForm({ ...quickForm, duration: e.target.value })} />
              </div>
            </div>
            <div className="ptm-repeat-row">
              <div className="ptm-field"><label>반복</label>
                <select value={quickForm.repeat} onChange={(e) => setQuickForm({ ...quickForm, repeat: e.target.value, repeatCount: getDefaultRepeatCount(e.target.value, quickForm.date) })}>
                  <option value="none">안함</option>
                  <option value="daily">매일</option>
                  <option value="weekly">매주</option>
                  <option value="biweekly">2주마다</option>
                  <option value="monthly">매월</option>
                  <option value="yearly">매년</option>
                </select>
              </div>
              {quickForm.repeat !== "none" && (
                <div className="ptm-field" style={{ maxWidth: 110 }}><label>반복 횟수</label>
                  <input type="number" min="1" onFocus={(e) => e.target.select()} value={quickForm.repeatCount} onChange={(e) => setQuickForm({ ...quickForm, repeatCount: e.target.value })} />
                </div>
              )}
            </div>
            {quickForm.repeat !== "none" && (
              <div className="ptm-discount-note">{repeatLabel[quickForm.repeat]} 간격으로 총 {Math.max(1, Number(quickForm.repeatCount) || 1)}회 예약이 등록돼요</div>
            )}
            {!quickIsMisc && (
              <div className="ptm-field"><label>메모</label>
                <input value={quickForm.memo} onChange={(e) => setQuickForm({ ...quickForm, memo: e.target.value })} placeholder="선택 입력" />
              </div>
            )}
            {quickIsMisc ? (
              <button className="ptm-save-btn" onClick={() => addQuickReservation()}>일정 등록</button>
            ) : quickForm.repeat === "none" && isPastDateTime(quickForm.date, quickForm.time) ? (
              <>
                <div className="ptm-no-product-msg">이미 지난 시간이에요 — 예약 대신 바로 출석/결석으로 기록할 수 있어요</div>
                <div className="ptm-row2">
                  <button className="ptm-save-btn" style={{ marginTop: 0, background: "var(--teal)" }} onClick={() => addQuickReservation("done")}>출석으로 등록</button>
                  <button className="ptm-save-btn" style={{ marginTop: 0, background: "var(--coral)" }} onClick={() => addQuickReservation("noshow")}>결석으로 등록</button>
                </div>
                <button className="ptm-series-btn ghost" onClick={() => addQuickReservation()}>그래도 예약(대기)으로 등록</button>
              </>
            ) : (
              <button className="ptm-save-btn" onClick={() => addQuickReservation()}>예약하기</button>
            )}
          </div>
        </div>
      )}

      {showCatalogForm && (
        <div className="ptm-overlay" onClick={() => setShowCatalogForm(false)}>
          <div className="ptm-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">{editingCatalogId ? "이용권 수정" : "새 이용권 만들기"}</span>
              <button className="ptm-icon-btn" onClick={() => setShowCatalogForm(false)}><X size={16} /></button>
            </div>
            <div className="ptm-field"><label>카테고리</label>
              <select value={catalogForm.category} onChange={(e) => setCatalogForm({ ...catalogForm, category: e.target.value as CatalogCategory })}>
                {CATALOG_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                ))}
              </select>
            </div>
            <div className="ptm-field"><label>이용권 이름</label>
              <input value={catalogForm.name} onChange={(e) => setCatalogForm({ ...catalogForm, name: e.target.value })} placeholder="예: PT 10회 1개월" />
            </div>
            {isCountBased(catalogForm.category) ? (
              <div className="ptm-row3">
                <div className="ptm-field"><label>횟수</label>
                  <input type="number" onFocus={(e) => e.target.select()} value={catalogForm.sessions} onChange={(e) => setCatalogForm({ ...catalogForm, sessions: Number(e.target.value) })} />
                </div>
                <div className="ptm-field"><label>기간(개월)</label>
                  <input type="number" onFocus={(e) => e.target.select()} value={catalogForm.months} onChange={(e) => setCatalogForm({ ...catalogForm, months: Number(e.target.value) })} />
                </div>
                <div className="ptm-field"><label>규정 가격(원)</label>
                  <input type="text" inputMode="numeric" onFocus={(e) => e.target.select()} value={fmtNum(catalogForm.price)} onChange={(e) => setCatalogForm({ ...catalogForm, price: parseNum(e.target.value) })} />
                </div>
              </div>
            ) : (
              <div className="ptm-row3">
                <div className="ptm-field"><label>기간</label>
                  <input type="number" onFocus={(e) => e.target.select()} value={catalogForm.months} onChange={(e) => setCatalogForm({ ...catalogForm, months: Number(e.target.value) })} />
                </div>
                <div className="ptm-field"><label>단위</label>
                  <div className="ptm-type-toggle">
                    <button className={`ptm-type-btn ${catalogForm.periodUnit === "month" ? "active" : ""}`} onClick={() => setCatalogForm({ ...catalogForm, periodUnit: "month" })}>개월</button>
                    <button className={`ptm-type-btn ${catalogForm.periodUnit === "day" ? "active" : ""}`} onClick={() => setCatalogForm({ ...catalogForm, periodUnit: "day" })}>일</button>
                  </div>
                </div>
                <div className="ptm-field"><label>규정 가격(원)</label>
                  <input type="text" inputMode="numeric" onFocus={(e) => e.target.select()} value={fmtNum(catalogForm.price)} onChange={(e) => setCatalogForm({ ...catalogForm, price: parseNum(e.target.value) })} />
                </div>
              </div>
            )}
            {isCountBased(catalogForm.category) && (
              <div className="ptm-field"><label>1회 세션 시간(분)</label>
                <input type="number" onFocus={(e) => e.target.select()} value={catalogForm.sessionDuration} onChange={(e) => setCatalogForm({ ...catalogForm, sessionDuration: Number(e.target.value) })} placeholder="예: 50, 90, 100" />
              </div>
            )}
            <button className="ptm-save-btn" onClick={saveCatalogItem}>{editingCatalogId ? "수정 완료" : "이용권 등록"}</button>
          </div>
        </div>
      )}

      {showForecastForm && (
        <div className="ptm-overlay" onClick={() => setShowForecastForm(false)}>
          <div className="ptm-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">{editingForecastId ? "재등록 예정 수정" : "재등록 예정 등록"}</span>
              <button className="ptm-icon-btn" onClick={() => setShowForecastForm(false)}><X size={16} /></button>
            </div>
            <div className="ptm-field"><label>고객</label>
              <select value={forecastForm.customerId} onChange={(e) => setForecastForm({ ...forecastForm, customerId: e.target.value })}>
                <option value="">고객 선택</option>
                {[...customers].sort((a, b) => a.name.localeCompare(b.name, "ko")).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>
                ))}
              </select>
            </div>
            <div className="ptm-field"><label>목표 월</label>
              <input type="month" value={forecastForm.targetMonth} onChange={(e) => setForecastForm({ ...forecastForm, targetMonth: e.target.value })} />
            </div>
            <div className="ptm-row2">
              <div className="ptm-field"><label>예상 세션</label>
                <input type="number" onFocus={(e) => e.target.select()} value={forecastForm.expectedSessions} onChange={(e) => setForecastForm({ ...forecastForm, expectedSessions: e.target.value })} placeholder="선택 입력" />
              </div>
              <div className="ptm-field"><label>예상 금액(원)</label>
                <input type="text" inputMode="numeric" onFocus={(e) => e.target.select()} value={fmtNum(forecastForm.expectedAmount)} onChange={(e) => setForecastForm({ ...forecastForm, expectedAmount: parseNum(e.target.value) })} placeholder="0" />
              </div>
            </div>
            <div className="ptm-field"><label>메모 (트레이닝 방향성, 리뉴 계획 등)</label>
              <textarea rows={3} value={forecastForm.note} onChange={(e) => setForecastForm({ ...forecastForm, note: e.target.value })} placeholder="예: 컨디셔닝 위주 운동중, 다음달 재등록 예정" />
            </div>
            <button className="ptm-save-btn" onClick={saveForecast}>{editingForecastId ? "수정 완료" : "등록"}</button>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="ptm-overlay" onClick={() => setShowSettings(false)}>
          <div className="ptm-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">급여 설정</span>
              <button className="ptm-icon-btn" onClick={() => setShowSettings(false)}><X size={16} /></button>
            </div>
            <div className="ptm-field"><label>기본급 (원)</label>
              <input type="text" inputMode="numeric" onFocus={(e) => e.target.select()} value={fmtNum(settings.baseSalary)} onChange={(e) => setSettings({ ...settings, baseSalary: parseNum(e.target.value) })} />
            </div>
            <div className="ptm-field"><label>세션 수당 비율 (완료된 세션 매출의 %)</label>
              <input type="number" onFocus={(e) => e.target.select()} value={settings.commissionRate} onChange={(e) => setSettings({ ...settings, commissionRate: e.target.value })} />
            </div>
            <div className="ptm-field"><label>공제율 (%)</label>
              <input type="number" onFocus={(e) => e.target.select()} step="0.1" value={settings.deductionRate} onChange={(e) => setSettings({ ...settings, deductionRate: e.target.value })} />
            </div>
            <button
              className="ptm-save-btn"
              onClick={async () => {
                try {
                  const saved = await db.upsertSettings({
                    baseSalary: Number(settings.baseSalary) || 0,
                    commissionRate: Number(settings.commissionRate) || 0,
                    deductionRate: Number(settings.deductionRate) || 0,
                  });
                  setSettings({ ...defaultSettings, ...saved });
                  setShowSettings(false);
                  flash("급여 설정 저장됨");
                } catch (e) { flash("저장 실패, 다시 시도해주세요"); }
              }}
            >
              저장
            </button>
          </div>
        </div>
      )}

      {ctxMenu && (() => {
        const r = ctxMenu.reservation;
        const cust = customers.find((c) => c.id === r.customerId);
        const menuLeft = Math.min(ctxMenu.x, window.innerWidth - 236);
        const openUpward = ctxMenu.y > window.innerHeight * 0.55;
        const posStyle = openUpward
          ? { left: menuLeft, bottom: Math.max(8, window.innerHeight - ctxMenu.y), top: "auto" }
          : { left: menuLeft, top: Math.max(8, ctxMenu.y), bottom: "auto" };
        return (
          <div className="ptm-ctx-overlay" onClick={() => setCtxMenu(null)}>
            <div className="ptm-ctx-menu" style={posStyle} onClick={(e) => e.stopPropagation()}>
              <div className="ptm-ctx-header">
                <div className="ptm-ctx-header-time">{r.time}-{minToTime(timeToMin(r.time) + (r.duration || 50))} · {statusLabel[r.status]}</div>
                <div className="ptm-ctx-header-sub">{r.type === "misc" ? r.customerName : `${r.customerName} · ${r.productName}`}</div>
              </div>
              {r.type === "misc" ? (
                <>
                  <button className="ptm-ctx-item" onClick={() => { requestCancelReservation(r); setCtxMenu(null); }}>취소 상태로 변경</button>
                  <div className="ptm-ctx-divider" />
                  <button className="ptm-ctx-item" onClick={() => { openTimeEdit(r); setCtxMenu(null); }}>제목·날짜·시간 수정</button>
                  <div className="ptm-ctx-divider" />
                  <button className="ptm-ctx-item danger" onClick={() => { requestDeleteReservation(r); setCtxMenu(null); }}>일정 삭제</button>
                </>
              ) : (
                <>
                  <button className="ptm-ctx-item" onClick={() => { requestCompleteReservation(r); setCtxMenu(null); }}>출석(완료) 상태로 변경</button>
                  <button className="ptm-ctx-item" onClick={() => { setReservationStatus(r.id, "noshow"); setCtxMenu(null); }}>노쇼 상태로 변경</button>
                  <button className="ptm-ctx-item" onClick={() => { requestCancelReservation(r); setCtxMenu(null); }}>취소 상태로 변경</button>
                  <div className="ptm-ctx-divider" />
                  <button className="ptm-ctx-item" onClick={() => { openTimeEdit(r); setCtxMenu(null); }}>날짜·시간 수정</button>
                  <div className="ptm-ctx-divider" />
                  <button className="ptm-ctx-item" onClick={() => { setCustomerDetailId(r.customerId); setCustomerDetailTab("home"); setCtxMenu(null); }}>고객 정보 보기</button>
                  {r.productId && <button className="ptm-ctx-item" onClick={() => { setResSheetProductId(r.productId); setCtxMenu(null); }}>예약 내역 보기 · 수정</button>}
                  <button className="ptm-ctx-item" onClick={() => { if (cust?.phone) window.open(`sms:${cust.phone}`, "_blank"); setCtxMenu(null); }}>문자(SMS) 보내기</button>
                  <div className="ptm-ctx-divider" />
                  <button className="ptm-ctx-item danger" onClick={() => { requestDeleteReservation(r); setCtxMenu(null); }}>예약 삭제</button>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {gridHover && !hoverInfo && (() => {
        const idx = weekDates.indexOf(gridHover.date);
        const left = Math.min(gridHover.x + 16, window.innerWidth - 180);
        const top = Math.max(8, gridHover.y - 34);
        return (
          <div className="ptm-grid-hover-tag" style={{ left, top }}>
            {idx >= 0 ? `${dayLabels[idx]}요일 ` : ""}{koDate(gridHover.date)} · {gridHover.time}
          </div>
        );
      })()}

      {hoverInfo && (() => {
        const r = hoverInfo.reservation;
        const left = Math.min(hoverInfo.x + 14, window.innerWidth - 270);
        const top = Math.min(hoverInfo.y + 14, window.innerHeight - 340);
        if (r.type === "misc") {
          return (
            <div
              className="ptm-hover-card"
              style={{ left, top }}
              onMouseEnter={cancelHideHoverInfo}
              onMouseLeave={scheduleHideHoverInfo}
            >
              <div className="ptm-hover-head">{r.time}-{minToTime(timeToMin(r.time) + (r.duration || 50))} · {statusLabel[r.status]}{(r.columnCount ?? 1) > 1 ? " · 동시예약" : ""}</div>
              <div className="ptm-hover-row"><span>구분</span><span>기타 일정</span></div>
              <div className="ptm-hover-row"><span>제목</span><span>{r.customerName}</span></div>
            </div>
          );
        }
        const cust = customers.find((c) => c.id === r.customerId);
        const product = products.find((p) => p.id === r.productId);
        const custProducts = products.filter((p) => p.customerId === r.customerId);
        const otherProducts = custProducts.filter((p) => p.id !== r.productId);
        const totalRemainAll = custProducts.reduce((s, p) => s + (p.type === "session" ? (p.totalSessions - p.usedSessions) : 0), 0);
        const totalSessionsAll = custProducts.reduce((s, p) => s + (p.type === "session" ? p.totalSessions : 0), 0);
        return (
          <div
            className="ptm-hover-card"
            style={{ left, top }}
            onMouseEnter={cancelHideHoverInfo}
            onMouseLeave={scheduleHideHoverInfo}
          >
            <div className="ptm-hover-head">{r.time}-{minToTime(timeToMin(r.time) + (r.duration || 50))} · {statusLabel[r.status]}{(r.columnCount ?? 1) > 1 ? " · 동시예약" : ""}</div>
            <div className="ptm-hover-row"><span>구분</span><span>개인레슨</span></div>
            <div className="ptm-hover-row"><span>속성</span><span>{!product ? "상담/신규" : product.type === "period" ? "기간제" : "횟수제"}</span></div>
            <div className="ptm-hover-row"><span>이름</span><span className="ptm-hover-link" onClick={() => { setCustomerDetailId(r.customerId); setCustomerDetailTab("home"); setHoverInfo(null); }}>{r.customerName}</span></div>
            <div className="ptm-hover-row"><span>예약상태</span><span>{statusLabel[r.status]}</span></div>
            <div className="ptm-hover-row"><span>전화번호</span><span>{cust?.phone || "-"}</span></div>
            <div className="ptm-hover-row"><span>상품명</span><span>{r.productName}</span></div>
            {product?.type === "session" && (
              <>
                <div className="ptm-hover-row"><span>총 횟수</span><span>{product.totalSessions}회</span></div>
                <div className="ptm-hover-row"><span>잔여횟수</span><span>{product.totalSessions - product.usedSessions}회</span></div>
              </>
            )}
            <div className="ptm-hover-divider">이용권 요약 정보</div>
            <div className="ptm-hover-row"><span>기타 보유 이용권</span><span>{otherProducts.length === 0 ? "없음" : otherProducts.map((p) => p.name).join(", ")}</span></div>
            <div className="ptm-hover-row"><span>총 잔여/횟수</span><span>{totalRemainAll}/{totalSessionsAll}</span></div>
            <div className="ptm-hover-row"><span>이용권 총 개수</span><span>{custProducts.length}개</span></div>
            <button className="ptm-hover-link-btn" onClick={() => { setCustomerDetailId(r.customerId); setCustomerDetailTab("home"); setHoverInfo(null); }}>고객 정보 보기 →</button>
          </div>
        );
      })()}

      {timeEditRes && (
        <div className="ptm-overlay" onClick={() => setTimeEditRes(null)}>
          <div className="ptm-sheet" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">{timeEditRes.type === "misc" ? "기타 일정 수정" : "날짜·시간 수정"}</span>
              <button className="ptm-icon-btn" onClick={() => setTimeEditRes(null)}><X size={16} /></button>
            </div>
            {timeEditRes.type === "misc" ? (
              <div className="ptm-field"><label>제목</label>
                <input value={timeEditForm.title} onChange={(e) => setTimeEditForm({ ...timeEditForm, title: e.target.value })} placeholder="예: 팀 미팅, 외부 일정" autoFocus />
              </div>
            ) : (
              <div className="ptm-no-product-msg" style={{ marginTop: -6 }}>{timeEditRes.customerName} · {timeEditRes.productName}</div>
            )}
            <div className="ptm-field"><label>날짜</label>
              <input type="date" value={timeEditForm.date} onChange={(e) => setTimeEditForm({ ...timeEditForm, date: e.target.value })} />
            </div>
            <div className="ptm-field"><label>시간</label>
              <div className="ptm-row2">
                <select value={timeEditForm.hour} onChange={(e) => setTimeEditForm({ ...timeEditForm, hour: e.target.value })}>
                  {hourOptions.map((h) => <option key={h} value={h}>{h}시</option>)}
                </select>
                <select value={timeEditForm.minute} onChange={(e) => setTimeEditForm({ ...timeEditForm, minute: e.target.value })}>
                  {minuteOptions.map((m) => <option key={m} value={m}>{m}분</option>)}
                </select>
              </div>
            </div>
            <div className="ptm-field"><label>진행 시간(분) — 50분이 기본이지만 직접 바꿀 수 있어요</label>
              <input type="number" min="1" onFocus={(e) => e.target.select()} value={timeEditForm.duration} onChange={(e) => setTimeEditForm({ ...timeEditForm, duration: e.target.value })} placeholder="50" />
            </div>
            <button className="ptm-save-btn" onClick={saveTimeEdit}>저장</button>
          </div>
        </div>
      )}

      {seriesPrompt && (
        <div className="ptm-overlay" onClick={() => setSeriesPrompt(null)}>
          <div className="ptm-sheet ptm-series-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">반복 예약 {seriesPrompt.action === "cancel" ? "취소" : "삭제"}</span>
              <button className="ptm-icon-btn" onClick={() => setSeriesPrompt(null)}><X size={16} /></button>
            </div>
            <p className="ptm-series-desc">
              이 예약은 반복 등록된 일정이에요. {seriesPrompt.reservation.date} 예약만 {seriesPrompt.action === "cancel" ? "취소" : "삭제"}할까요, 이후 반복되는 예약도 전부 {seriesPrompt.action === "cancel" ? "취소" : "삭제"}할까요?
            </p>
            <button className="ptm-series-btn" onClick={() => applySeriesChoice("this")}>이 예약만 {seriesPrompt.action === "cancel" ? "취소" : "삭제"}</button>
            <button className="ptm-series-btn danger" onClick={() => applySeriesChoice("future")}>이후 모든 반복 예약 {seriesPrompt.action === "cancel" ? "취소" : "삭제"}</button>
            <button className="ptm-series-btn ghost" onClick={() => setSeriesPrompt(null)}>그만두기</button>
          </div>
        </div>
      )}

      {confirmState && (
        <div className="ptm-overlay" onClick={() => setConfirmState(null)}>
          <div className="ptm-sheet ptm-series-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">정말 삭제하시겠습니까?</span>
              <button className="ptm-icon-btn" onClick={() => setConfirmState(null)}><X size={16} /></button>
            </div>
            <p className="ptm-series-desc">{confirmState.message}</p>
            <div className="ptm-confirm-actions">
              <button autoFocus className="ptm-series-btn" onClick={() => setConfirmState(null)}>취소</button>
              <button
                className="ptm-series-btn danger"
                onClick={() => {
                  confirmState.onConfirm();
                  setConfirmState(null);
                }}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {signatureRes && (
        <SignatureModal
          title={`${signatureRes.customerName || customers.find((c) => c.id === signatureRes.customerId)?.name || "고객"} · 출석 서명`}
          onCancel={() => setSignatureRes(null)}
          onSubmit={submitSignatureAndComplete}
        />
      )}

      {sessionCardResId && (() => {
        const res = reservations.find((r) => r.id === sessionCardResId);
        const product = res && products.find((p) => p.id === res.productId);
        const customer = res && customers.find((c) => c.id === res.customerId);
        if (!res || !product || !customer) return null;
        const history = [...reservations]
          .filter((r) => r.productId === product.id && (r.status === "done" || r.status === "noshow"))
          .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        const remaining = Math.max(0, product.totalSessions - product.usedSessions);
        // 총 등록 횟수만큼 자리를 미리 깔아두고(수기 사인지처럼) 앞에서부터 채워, 등록한 세션 전체와
        // 그중 어디까지 진행됐는지를 한 화면에서 볼 수 있게 한다. 50회면 1~25 왼쪽 / 26~50 오른쪽,
        // 30회면 1~15 / 16~30 식으로 반씩 나눈다.
        // usedSessions(수동조정 포함 누적 사용횟수)가 실제 예약 기록(history) 건수보다 많을 수 있다 —
        // 서명 기능 이전에 수기로 진행했거나 수동(+/-)으로 조정된 세션들. 그런 자리는 앞쪽에 채우고
        // "check"로 표시해, 진짜 서명 기록이 있는 최근 세션들과 구분한다.
        const total = product.type === "session" ? Number(product.totalSessions) || 0 : 0;
        const half = Math.ceil(total / 2);
        const historyCount = history.length;
        const usedCount = Math.max(0, Math.min(total, Number(product.usedSessions) || 0));
        const manualUsedCount = Math.max(0, usedCount - historyCount);
        const slots = Array.from({ length: total }, (_, i) => {
          if (i < manualUsedCount) return { used: true, res: null };
          const hIdx = i - manualUsedCount;
          return hIdx < historyCount ? { used: true, res: history[hIdx] } : { used: false, res: null };
        });
        const renderSlotRows = (slotArr: { used: boolean; res: Reservation | null }[], offset: number) => slotArr.map((slot, i) => {
          const r = slot.res;
          return (
            <tr key={offset + i} className={r && r.id === res.id ? "ptm-session-card-highlight" : ""}>
              <td>{offset + i + 1}</td>
              <td>{r ? `${koDate(r.date)} ${r.time}` : "-"}</td>
              <td>{r && r.status === "noshow" ? <span className="ptm-noshow-mark">NO SHOW</span> : r && r.signatureUrl ? <SignatureThumb path={r.signatureUrl} /> : (slot.used ? "check" : "-")}</td>
            </tr>
          );
        });
        return (
          <div className="ptm-overlay" onClick={() => setSessionCardResId(null)}>
            <div className={`ptm-sheet ptm-session-card-sheet ${total > 0 ? "ptm-session-card-wide" : ""}`} onClick={(e) => e.stopPropagation()}>
              <div className="ptm-sheet-head">
                <span className="ptm-sheet-title">{customer.name} · {product.name} 출석 카드</span>
                <button className="ptm-icon-btn" onClick={() => setSessionCardResId(null)}><X size={16} /></button>
              </div>
              {product.type === "session" && (
                <>
                  <div className="ptm-gauge-row">
                    <div className="ptm-gauge-track"><div className={`ptm-gauge-fill ${urgency(product)}`} style={{ width: `${progressPct(product)}%` }} /></div>
                    <div className="ptm-gauge-label">{product.usedSessions} / {product.totalSessions}회 사용</div>
                  </div>
                  {remaining <= 3 && (
                    <div className="ptm-session-card-warn">
                      {remaining === 0 ? "세션을 모두 사용했어요 — 재등록을 안내해보세요" : `남은 세션 ${remaining}회 — 재등록을 안내해보세요`}
                    </div>
                  )}
                </>
              )}
              {total > 0 ? (
                <div className="ptm-session-card-cols">
                  <div className="ptm-table-wrap">
                    <table className="ptm-table">
                      <thead><tr><th>No.</th><th>일자</th><th>회원서명</th></tr></thead>
                      <tbody>{renderSlotRows(slots.slice(0, half), 0)}</tbody>
                    </table>
                  </div>
                  <div className="ptm-table-wrap">
                    <table className="ptm-table">
                      <thead><tr><th>No.</th><th>일자</th><th>회원서명</th></tr></thead>
                      <tbody>{renderSlotRows(slots.slice(half), half)}</tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="ptm-table-wrap" style={{ marginTop: 12 }}>
                  <table className="ptm-table">
                    <thead><tr><th>No.</th><th>일자</th><th>회원서명</th></tr></thead>
                    <tbody>
                      {history.map((r, i) => (
                        <tr key={r.id} className={r.id === res.id ? "ptm-session-card-highlight" : ""}>
                          <td>{i + 1}</td>
                          <td>{koDate(r.date)} {r.time}</td>
                          <td>{r.status === "noshow" ? <span className="ptm-noshow-mark">NO SHOW</span> : r.signatureUrl ? <SignatureThumb path={r.signatureUrl} /> : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button className="ptm-save-btn" onClick={() => setSessionCardResId(null)}>확인</button>
            </div>
          </div>
        );
      })()}

      {toast && <div className="ptm-toast">{toast}</div>}
    </div>
  );
}
