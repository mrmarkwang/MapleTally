"use client";
/** Responsive T1/T2125 preparation workspace with receipt review, Canadian tax fields, business-use allocation, and qualified exports. */
import React, { useEffect, useRef, useState } from "react";
type Fields = {
  merchant: string;
  date: string;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  currency: string;
  category: string;
  payment_method: string;
  province: string;
  tax_year: number | "Unknown";
  gst: number | null;
  hst: number | null;
  qst: number | null;
  pst: number | null;
  rst: number | null;
  category_status: string;
  business_or_personal: "Business" | "Personal" | "Mixed Use";
  business_use_percent: number | null;
  business_amount: number | null;
  personal_amount: number | null;
  itc_status: string;
  review_status: string;
  notes: string;
};
type Receipt = {
  id: string;
  filename: string;
  mime: string;
  state: string;
  fields: Fields;
  original: Fields | null;
  warnings: string[];
  error: string | null;
  version: number;
  duplicate_of: string | null;
  confirmed_at: string | null;
  created: string;
  confidence: Record<string, number>;
};
type Me = {
  user: { name: string; email: string };
  workspace: { name: string; forwarding: string | null };
  quota: {
    plan: string;
    used: number;
    reserved: number;
    limit: number;
    period: string;
    canUpload: boolean;
  };
  billingAvailable: boolean;
  hasCustomer: boolean;
  hasSubscription: boolean;
  extractionAvailable: boolean;
  notifications: { id: string; message: string }[];
};
type Page = "Receipts" | "Exports" | "Settings";
const RECEIPTS_PER_PAGE = 10;
const CONFIRMED_STATES = new Set(["confirmed", "exported"]);
const REVIEW_READY_STATES = new Set(["needs_review", "duplicate_candidate"]);
const IN_PROGRESS_STATES = new Set(["captured", "processing"]);
type StatusOption = readonly [string, string, readonly string[]];
const STATUS_OPTIONS: StatusOption[] = [
  ["processing", "Processing", ["captured", "processing"]],
  ["needs_review", "Needs review", ["needs_review", "duplicate_candidate"]],
  ["confirmed", "Confirmed", ["confirmed", "exported"]],
  ["failed", "Failed", ["failed"]],
];
const STATUS_LABELS: Record<string, string> = {
  captured: "Processing",
  processing: "Processing",
  needs_review: "Needs review",
  duplicate_candidate: "Needs review",
  confirmed: "Confirmed",
  exported: "Confirmed",
  failed: "Failed",
};
const TAX_TYPES = ["gst", "hst", "qst", "pst", "rst"] as const;
const TAX_TYPE_LABELS: Record<(typeof TAX_TYPES)[number], string> = {
  gst: "GST",
  hst: "HST",
  qst: "QST",
  pst: "PST",
  rst: "RST",
};
const USAGE_OPTIONS = ["Business", "Personal", "Mixed Use"] as const;
const REVIEW_OPTIONS = ["Suggested", "Confirmed", "Needs Review"] as const;
const RECEIPT_FILTERS_STORAGE_KEY = "mapletally.receiptFilters";
const PLAN_LIMITS = { free: 20, paid: 200 } as const;
const PRO_FEATURES = [
  "每月 200 张收据",
  "专属转发邮箱",
  "PDF 和 ZIP 完整导出",
  "原图长期保存",
  "重复/漏单检测",
  "GST/HST/PST/QST 异常检查",
  "银行/信用卡 CSV 匹配",
  "会计师只读共享",
  "优先处理和客服",
];

function isConfirmed(receipt: Receipt) {
  return CONFIRMED_STATES.has(receipt.state);
}

function isReviewReady(receipt: Receipt) {
  return REVIEW_READY_STATES.has(receipt.state);
}
function matchesStatus(state: string, selected: string[]) {
  return (
    selected.length === 0 ||
    selected.some((value) =>
      STATUS_OPTIONS.find(([option]) => option === value)?.[2].includes(state),
    )
  );
}
function hasTaxType(fields: Fields, taxType: string) {
  return TAX_TYPES.includes(taxType as (typeof TAX_TYPES)[number]) && fields[taxType as (typeof TAX_TYPES)[number]] !== null;
}
async function api<T = any>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method,
    headers: { "Content-Type": "application/json", "X-MapleTally": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error || "Request failed."), {
      status: response.status,
    });
  return data;
}
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    receipts: (
      <>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
        <path d="M9 8h6M9 12h6" />
      </>
    ),
    export: (
      <>
        <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    upload: (
      <>
        <path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    check: <path d="m5 12 4 4L19 6" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 6 9 7 9-7" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    leaf: (
      <>
        <path d="M5 18C1 7 12 3 21 3c0 9-4 19-14 16M5 21 16 10" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.receipts}
    </svg>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        M<span>·</span>
      </span>
      <span>MapleTally</span>
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`status ${value}`}>
      <span />
      {STATUS_LABELS[value] || value.replaceAll("_", " ")}
    </span>
  );
}
function money(value: number | null, currency: string) {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(value / 100);
  } catch {
    return `${(value / 100).toFixed(2)} ${currency}`;
  }
}
function Auth({ onLogin }: { onLogin: () => Promise<void> }) {
  const [register, setRegister] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api(
        `/auth/${register ? "register" : "login"}`,
        "POST",
        data,
      );
      if (result.confirmationRequired) setConfirmation(true);
      else await onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div>
          <span className="eyebrow">LESS PAPERWORK. MORE POSSIBILITY.</span>
          <h1>
            Good work.
            <br />
            Tidy receipts.
            <br />
            <em>Clear head.</em>
          </h1>
          <p>
            A little order for your independent business.
            <br />
            Capture your receipts, check the details, and
            <br className="desktop-only" /> hand off with confidence.
          </p>
          <div className="paper-stack">
            <div className="sample-receipt">
              <span className="sample-icon">
                <Icon name="leaf" size={30} />
              </span>
              <strong>A fresh start</strong>
              <span>FOR YOUR BUSINESS BOOKS</span>
              <hr />
              <div>
                Loose receipts <span>Sorted</span>
              </div>
              <div>
                Uncertain details <span>Reviewed</span>
              </div>
              <hr />
              <div className="sample-total">
                Peace of mind <Icon name="check" />
              </div>
            </div>
            <span className="sample-badge">
              <Icon name="check" size={16} /> Your future self says thanks
            </span>
          </div>
        </div>
        <small>Made for the way Canadians work.</small>
      </section>
      <section className="auth-form">
        <div className="auth-top">
          {register ? "Already have an account?" : "New to MapleTally?"}{" "}
          <button
            className="text-button"
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register ? "Sign in" : "Create an account"}
          </button>
        </div>
        <div className="auth-form-inner">
          <span className="eyebrow">YOUR RECEIPTS, SORTED</span>
          <h2>{register ? "Make room for better things." : "Welcome back."}</h2>
          <p>
            {register
              ? "Start with 25 receipts, on us. No card needed."
              : "Your business paperwork is right where you left it."}
          </p>
          {confirmation && (
            <div className="notice" role="status">
              Check your email to confirm your account, then sign in.
            </div>
          )}
          <form onSubmit={submit}>
            {register && (
              <>
                <label>
                  Your name
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={100}
                    placeholder="Alex Morgan"
                  />
                </label>
                <label>
                  Business name
                  <input
                    name="business"
                    autoComplete="organization"
                    required
                    maxLength={100}
                    placeholder="Your business or your name"
                  />
                </label>
              </>
            )}
            <label>
              Email address
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                placeholder="you@example.ca"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={12}
                maxLength={128}
                placeholder="At least 12 characters"
              />
            </label>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary wide" disabled={busy}>
              {busy
                ? "One moment…"
                : register
                  ? "Create your account"
                  : "Sign in"}
              <Icon name="arrow" size={16} />
            </button>
          </form>
          <p className="fine-print">
            Track your freelance expenses today. Prepare your Canadian tax
            return with confidence next year. MapleTally organizes T1/T2125
            material; it does not file for you.
          </p>
        </div>
      </section>
    </main>
  );
}
export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>("Receipts");
  const [rows, setRows] = useState<Receipt[]>([]);
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [taxYearFilter, setTaxYearFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [provinceFilter, setProvinceFilter] = useState("");
  const [taxTypeFilter, setTaxTypeFilter] = useState("");
  const [usageFilter, setUsageFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const [filterOwner, setFilterOwner] = useState("");
  const [receiptPage, setReceiptPage] = useState(1);
  const [progress, setProgress] = useState<number | null>(null);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [exportJobs, setExportJobs] = useState<
    { id: string; format: string; status: string; error: string | null }[]
  >([]);
  const planLimit = me
    ? PLAN_LIMITS[me.quota.plan === "paid" ? "paid" : "free"]
    : PLAN_LIMITS.free;
  const [setupError, setSetupError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const statusDetails = useRef<HTMLDetailsElement>(null);
  const hasPendingWork =
    rows.some((row) => ["captured", "processing"].includes(row.state)) ||
    exportJobs.some((job) => ["queued", "processing"].includes(job.status));
  async function refresh() {
    const m = await api<Me>("/me");
    const [r, e] = await Promise.all([
      api<Receipt[]>("/receipts"),
      api<typeof exportJobs>("/exports"),
    ]);
    setMe(m);
    setRows(r);
    setSelected((current) => {
      if (!current) return current;
      return r.find((row) => row.id === current.id) || current;
    });
    setExportJobs(e);
    setSetupError("");
  }
  useEffect(() => {
    refresh()
      .catch((e) => {
        if (e.status !== 401) setSetupError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!me) return;
    const poll = () => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    };
    const timer = setInterval(
      () => {
        poll();
      },
      hasPendingWork ? 4000 : 30000,
    );
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [!!me, hasPendingWork]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const closeStatusMenu = (event: PointerEvent) => {
      if (!statusDetails.current?.contains(event.target as Node)) {
        statusDetails.current?.removeAttribute("open");
      }
    };
    document.addEventListener("pointerdown", closeStatusMenu);
    return () => document.removeEventListener("pointerdown", closeStatusMenu);
  }, []);
  useEffect(() => {
    const email = me?.user.email;
    if (!email) return;
    try {
      const saved = JSON.parse(
        localStorage.getItem(`${RECEIPT_FILTERS_STORAGE_KEY}:${email}`) || "{}",
      ) as Record<string, unknown>;
      const validStatuses = new Set(STATUS_OPTIONS.map(([value]) => value));
      const isDate = (value: unknown): value is string =>
        typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
      setStatusFilters(
        Array.isArray(saved.statuses)
          ? saved.statuses.filter(
              (status): status is string =>
                typeof status === "string" && validStatuses.has(status),
            )
          : [],
      );
      setDateFrom(isDate(saved.dateFrom) ? saved.dateFrom : "");
      setDateTo(isDate(saved.dateTo) ? saved.dateTo : "");
      setTaxYearFilter(typeof saved.taxYear === "string" ? saved.taxYear : "");
      setMonthFilter(typeof saved.month === "string" ? saved.month : "");
      setCategoryFilter(typeof saved.category === "string" ? saved.category : "");
      setProvinceFilter(typeof saved.province === "string" ? saved.province : "");
      setTaxTypeFilter(typeof saved.taxType === "string" && TAX_TYPES.includes(saved.taxType as (typeof TAX_TYPES)[number]) ? saved.taxType : "");
      setUsageFilter(typeof saved.usage === "string" && USAGE_OPTIONS.includes(saved.usage as (typeof USAGE_OPTIONS)[number]) ? saved.usage : "");
      setReviewFilter(typeof saved.reviewStatus === "string" && REVIEW_OPTIONS.includes(saved.reviewStatus as (typeof REVIEW_OPTIONS)[number]) ? saved.reviewStatus : "");
      setSearch(typeof saved.search === "string" ? saved.search : "");
    } catch {
      setStatusFilters([]);
      setDateFrom("");
      setDateTo("");
      setTaxYearFilter("");
      setMonthFilter("");
      setCategoryFilter("");
      setProvinceFilter("");
      setTaxTypeFilter("");
      setUsageFilter("");
      setReviewFilter("");
      setSearch("");
    }
    setReceiptPage(1);
    setFilterOwner(email);
  }, [me?.user.email]);
  useEffect(() => {
    const email = me?.user.email;
    if (!email || filterOwner !== email) return;
    try {
      localStorage.setItem(
        `${RECEIPT_FILTERS_STORAGE_KEY}:${email}`,
        JSON.stringify({ statuses: statusFilters, dateFrom, dateTo, taxYear: taxYearFilter, month: monthFilter, category: categoryFilter, province: provinceFilter, taxType: taxTypeFilter, usage: usageFilter, reviewStatus: reviewFilter, search }),
      );
    } catch {}
  }, [me?.user.email, filterOwner, statusFilters, dateFrom, dateTo, taxYearFilter, monthFilter, categoryFilter, provinceFilter, taxTypeFilter, usageFilter, reviewFilter, search]);
  async function act(fn: () => Promise<void>) {
    setError("");
    setActionBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }
  async function open(id: string) {
    await act(async () => setSelected(await api<Receipt>(`/receipts/${id}`)));
  }
  async function uploadFile(file: File) {
    if (progress !== null) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Choose a file under 10 MB.");
      return;
    }
    setError("");
    setProgress(0);
    setRetryFile(file);
    let reservation: string | undefined;
    try {
      const upload = await api<{ id: string; url: string }>(
        "/uploads",
        "POST",
        {
          filename: file.name,
          mime: file.type || "application/octet-stream",
          size: file.size,
        },
      );
      reservation = upload.id;
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", upload.url);
        xhr.setRequestHeader(
          "Content-Type",
          file.type || "application/octet-stream",
        );
        xhr.timeout = 120_000;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error("Upload interrupted. Please retry."));
        };
        xhr.onerror = xhr.ontimeout = () =>
          reject(
            new Error("Connection interrupted. Your file is ready to retry."),
          );
        xhr.send(file);
      });
      const result = await api<{ id: string; duplicate: boolean }>(
        `/uploads/${upload.id}/complete`,
        "POST",
      );
      setRetryFile(null);
      setToast(
        result.duplicate
          ? "This original is already in your workspace. No duplicate was added."
          : "Receipt captured. You can review it while extraction runs.",
      );
      await refresh();
      await open(result.id);
    } catch (e) {
      if (reservation)
        await api(`/uploads/${reservation}`, "DELETE").catch(() => {});
      setError((e as Error).message);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
      if (camera.current) camera.current.value = "";
    }
  }
  async function download(
    format: "csv" | "pdf" | "zip",
    receiptIds?: string[],
  ) {
    await act(async () => {
      await api("/exports", "POST", { format, receiptIds });
      setToast(
        "Export queued. You can leave this page and download it when it is ready.",
      );
      await refresh();
    });
  }
  if (loading)
    return (
      <div className="loading">
        <Brand />
        <p>Opening your workspace…</p>
      </div>
    );
  if (setupError)
    return (
      <div className="loading">
        <Brand />
        <p role="alert">{setupError}</p>
        <button
          className="button secondary"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    );
  if (!me) return <Auth onLogin={refresh} />;
  const needsReview = rows.filter(isReviewReady);
  const confirmed = rows.filter(isConfirmed);
  const inProgress = rows.filter((r) => IN_PROGRESS_STATES.has(r.state));
  const failed = rows.filter((r) => r.state === "failed");
  const taxYears = Array.from(
    new Set(rows.map((r) => String(r.fields.tax_year)).filter((year) => year !== "Unknown")),
  ).sort((a, b) => Number(b) - Number(a));
  const categories = Array.from(new Set(rows.map((r) => r.fields.category))).sort();
  const provinces = Array.from(new Set(rows.map((r) => r.fields.province).filter(Boolean))).sort();
  const filteredRows = rows.filter(
    (r) =>
      matchesStatus(r.state, statusFilters) &&
      `${r.fields.merchant} ${r.filename} ${r.fields.category}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      ((!dateFrom && !dateTo) ||
        (!!r.fields.date &&
          (!dateFrom || r.fields.date >= dateFrom) &&
          (!dateTo || r.fields.date <= dateTo))) &&
      (!taxYearFilter || String(r.fields.tax_year) === taxYearFilter) &&
      (!monthFilter || r.fields.date.slice(5, 7) === monthFilter) &&
      (!categoryFilter || r.fields.category === categoryFilter) &&
      (!provinceFilter || r.fields.province === provinceFilter) &&
      (!taxTypeFilter || hasTaxType(r.fields, taxTypeFilter)) &&
      (!usageFilter || r.fields.business_or_personal === usageFilter) &&
      (!reviewFilter || r.fields.review_status === reviewFilter),
  );
  const hasActiveFilters =
    statusFilters.length > 0 || !!dateFrom || !!dateTo || !!taxYearFilter || !!monthFilter || !!categoryFilter || !!provinceFilter || !!taxTypeFilter || !!usageFilter || !!reviewFilter || !!search;
  const totalReceiptPages = Math.max(
    1,
    Math.ceil(filteredRows.length / RECEIPTS_PER_PAGE),
  );
  const currentReceiptPage = Math.min(receiptPage, totalReceiptPages);
  const firstVisibleReceipt =
    (currentReceiptPage - 1) * RECEIPTS_PER_PAGE;
  const visible = filteredRows.slice(
    firstVisibleReceipt,
    firstVisibleReceipt + RECEIPTS_PER_PAGE,
  );
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-card">
          <span className="workspace-avatar">
            {me.workspace.name[0].toUpperCase()}
          </span>
          <div>
            <strong>{me.workspace.name}</strong>
          </div>
        </div>
        <nav>
          {(["Receipts", "Exports", "Settings"] as Page[]).map((p) => (
            <button
              key={p}
              className={page === p ? "active" : ""}
              onClick={() => {
                setPage(p);
                setSelected(null);
                setError("");
              }}
            >
              <Icon name={p === "Exports" ? "export" : p.toLowerCase()} />
              {p}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="allowance">
            <div>
              <span>
                {me.quota.plan === "paid" ? "Pro plan" : "Free plan"}
              </span>
              <Icon name="leaf" size={17} />
            </div>
            <p>
              {me.quota.used} of {planLimit} receipts · this month
              {me.quota.reserved > 0 && ` (${me.quota.reserved} uploading)`}
            </p>
            <small className="allowance-note">
              Counts successful processing only. Failed or duplicate receipts do
              not use your allowance; deleting a receipt does not restore it.
            </small>
            <div className="meter">
              <span
                style={{
                  width: `${Math.min(100, ((me.quota.used + me.quota.reserved) / planLimit) * 100)}%`,
                }}
              />
            </div>
            <button className="text-button" onClick={() => setPage("Settings")}>
              Manage your plan <span>↗</span>
            </button>
          </div>
          <div className="user">
            <span className="avatar">{me.user.name[0].toUpperCase()}</span>
            <div>
              <strong>{me.user.name}</strong>
              <small>{me.user.email}</small>
            </div>
            <button
              title="Sign out"
              className="icon-button"
              onClick={() =>
                act(async () => {
                  await api("/auth/logout", "POST");
                  setMe(null);
                  setRows([]);
                  setSelected(null);
                })
              }
            >
              ↪
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <strong>{page}</strong>
          <span className="topbar-note">
            <span className="green-dot" /> A little more organized.
          </span>
        </header>
        <main className="content">
          {toast && (
            <div className="toast" role="status">
              <Icon name="check" />
              {toast}
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setToast("")}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {error && (
            <div className="error global-error" role="alert">
              {error}
              <button className="text-button" onClick={() => setError("")}>
                Dismiss
              </button>
            </div>
          )}
          {selected ? (
            <Review
              key={selected.id}
              receipt={selected}
              extractionAvailable={me.extractionAvailable}
              onClose={() => {
                setSelected(null);
                void refresh();
              }}
              onSaved={async (r) => {
                setSelected(r);
                await refresh();
              }}
              onDelete={async () => {
                await api(`/receipts/${selected.id}`, "DELETE");
                setSelected(null);
                await refresh();
                setToast("Receipt and original file deleted.");
              }}
            />
          ) : page === "Receipts" ? (
            <>
              <section
                className={`capture-card ${dragging ? "dragging" : ""}`}
                aria-label="Receipt overview and upload"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer.files[0])
                    void uploadFile(e.dataTransfer.files[0]);
                }}
              >
                <div className="receipt-overview">
                  <span className="eyebrow">A CLEARER PICTURE</span>
                  <h1>Your receipts</h1>
                  <p>Prepare Canadian self-employed T1/T2125 records from every expense.</p>
                  <button
                    className="review-summary"
                    disabled={needsReview.length === 0}
                    onClick={() => {
                      setStatusFilters(Array.from(REVIEW_READY_STATES));
                      setDateFrom("");
                      setDateTo("");
                      setTaxYearFilter("");
                      setMonthFilter("");
                      setCategoryFilter("");
                      setProvinceFilter("");
                      setTaxTypeFilter("");
                      setUsageFilter("");
                      setReviewFilter("");
                      setSearch("");
                      setReceiptPage(1);
                    }}
                    aria-label={
                      needsReview.length === 0
                        ? "No receipts need review"
                        : `Review ${needsReview.length} ${needsReview.length === 1 ? "receipt" : "receipts"}`
                    }
                  >
                    <strong>{needsReview.length}</strong>
                    <span>
                      {needsReview.length === 1 ? "receipt" : "receipts"} to
                      review
                    </span>
                    {needsReview.length > 0 ? (
                      <Icon name="arrow" size={15} />
                    ) : (
                      <Icon name="check" size={15} />
                    )}
                  </button>
                </div>
                <div className="capture-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={progress !== null}
                    onClick={() => input.current?.click()}
                  >
                    <Icon name="plus" size={18} />
                    Add receipt
                  </button>
                  <button
                    type="button"
                    className="text-button camera-button"
                    disabled={progress !== null}
                    onClick={() => camera.current?.click()}
                  >
                    Take a photo
                  </button>
                  <span className="capture-meta">
                    {progress === null
                      ? "or drop a JPG, PNG, WebP, HEIC, or PDF · 10 MB max"
                      : `Uploading… ${progress}%`}
                  </span>
                  {progress !== null && (
                    <progress
                      max={100}
                      value={progress}
                      aria-label="Upload progress"
                    />
                  )}
                </div>
              </section>
              {retryFile && progress === null && (
                <button
                  className="button secondary retry"
                  onClick={() => uploadFile(retryFile)}
                >
                  Retry upload: {retryFile.name}
                </button>
              )}
              <section className="receipt-panel">
                <div className="list-toolbar">
                  <p className="filtered-count">
                    {filteredRows.length} {filteredRows.length === 1 ? "receipt" : "receipts"}
                  </p>
                  <div className="list-filters">
                    <div className="status-filter">
                      <span>Status</span>
                      <details ref={statusDetails}>
                        <summary aria-label="Receipt status">
                          {statusFilters.length === 0
                            ? "Any status"
                            : statusFilters.length === 1
                              ? STATUS_OPTIONS.find(([value]) => value === statusFilters[0])?.[1]
                              : `${statusFilters.length} statuses`}
                        </summary>
                        <div className="status-menu">
                          <button
                            type="button"
                            onClick={() => {
                              setStatusFilters([]);
                              setReceiptPage(1);
                            }}
                          >
                            Any status
                          </button>
                          {STATUS_OPTIONS.map(([value, label]) => (
                            <label key={value}>
                              <input
                                type="checkbox"
                                checked={statusFilters.includes(value)}
                                onChange={(event) => {
                                  setStatusFilters((current) =>
                                    event.target.checked
                                      ? [...current, value]
                                      : current.filter((status) => status !== value),
                                  );
                                  setReceiptPage(1);
                                }}
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </details>
                    </div>
                    <label className="filter-select">
                      <span>Tax year</span>
                      <select value={taxYearFilter} onChange={(e) => { setTaxYearFilter(e.target.value); setReceiptPage(1); }}>
                        <option value="">Any year</option>
                        {taxYears.map((year) => <option key={year} value={year}>{year}</option>)}
                      </select>
                    </label>
                    <label className="filter-select">
                      <span>Month</span>
                      <select value={monthFilter} onChange={(e) => { setMonthFilter(e.target.value); setReceiptPage(1); }}>
                        <option value="">Any month</option>
                        {Array.from({ length: 12 }, (_, index) => {
                          const month = String(index + 1).padStart(2, "0");
                          return <option key={month} value={month}>{month}</option>;
                        })}
                      </select>
                    </label>
                    <label className="filter-select">
                      <span>Category</span>
                      <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setReceiptPage(1); }}>
                        <option value="">Any category</option>
                        {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                    </label>
                    <label className="filter-select">
                      <span>Province</span>
                      <select value={provinceFilter} onChange={(e) => { setProvinceFilter(e.target.value); setReceiptPage(1); }}>
                        <option value="">Any province</option>
                        {provinces.map((province) => <option key={province} value={province}>{province}</option>)}
                      </select>
                    </label>
                    <label className="filter-select">
                      <span>Tax type</span>
                      <select value={taxTypeFilter} onChange={(e) => { setTaxTypeFilter(e.target.value); setReceiptPage(1); }}>
                        <option value="">Any tax</option>
                        {TAX_TYPES.map((taxType) => <option key={taxType} value={taxType}>{TAX_TYPE_LABELS[taxType]}</option>)}
                      </select>
                    </label>
                    <label className="filter-select">
                      <span>Usage</span>
                      <select value={usageFilter} onChange={(e) => { setUsageFilter(e.target.value); setReceiptPage(1); }}>
                        <option value="">Any usage</option>
                        {USAGE_OPTIONS.map((usage) => <option key={usage} value={usage}>{usage}</option>)}
                      </select>
                    </label>
                    <label className="filter-select">
                      <span>Review</span>
                      <select value={reviewFilter} onChange={(e) => { setReviewFilter(e.target.value); setReceiptPage(1); }}>
                        <option value="">Any review</option>
                        {REVIEW_OPTIONS.map((review) => <option key={review} value={review}>{review}</option>)}
                      </select>
                    </label>
                    <div className="date-range" role="group" aria-label="Receipt date range">
                      <label>
                        <span>From</span>
                        <input
                          type="date"
                          aria-label="Receipts from"
                          max={dateTo || undefined}
                          value={dateFrom}
                          onChange={(e) => {
                            setDateFrom(e.target.value);
                            setReceiptPage(1);
                          }}
                        />
                      </label>
                      <label>
                        <span>To</span>
                        <input
                          type="date"
                          aria-label="Receipts to"
                          min={dateFrom || undefined}
                          value={dateTo}
                          onChange={(e) => {
                            setDateTo(e.target.value);
                            setReceiptPage(1);
                          }}
                        />
                      </label>
                    </div>
                    <label className="search">
                      <Icon name="search" size={17} />
                      <input
                        aria-label="Search receipts"
                        placeholder="Search receipts"
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setReceiptPage(1);
                        }}
                      />
                    </label>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        className="reset-filters"
                        onClick={() => {
                          setStatusFilters([]);
                          setDateFrom("");
                          setDateTo("");
                          setTaxYearFilter("");
                          setMonthFilter("");
                          setCategoryFilter("");
                          setProvinceFilter("");
                          setTaxTypeFilter("");
                          setUsageFilter("");
                          setReviewFilter("");
                          setSearch("");
                          setReceiptPage(1);
                          statusDetails.current?.removeAttribute("open");
                          try {
                            localStorage.removeItem(
                              `${RECEIPT_FILTERS_STORAGE_KEY}:${me.user.email}`,
                            );
                          } catch {}
                        }}
                      >
                        <Icon name="close" size={15} />
                        Reset filters
                      </button>
                    )}
                    {hasActiveFilters && (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={actionBusy || !filteredRows.length}
                        onClick={() =>
                          download("csv", filteredRows.map((r) => r.id))
                        }
                      >
                        {actionBusy ? "Preparing…" : "Export filtered CSV"}
                        <Icon name="export" size={16} />
                      </button>
                    )}
                  </div>
                </div>
                {visible.length ? (
                  <div className="receipt-table">
                    <div className="table-head">
                      <span>MERCHANT / RECEIPT</span>
                      <span>DATE</span>
                      <span>STATUS</span>
                      <span>TOTAL</span>
                      <span />
                    </div>
                    {visible.map((r) => (
                      <button
                        className="receipt-row"
                        key={r.id}
                        onClick={() => open(r.id)}
                      >
                        <span className="merchant-cell">
                          <span className="receipt-avatar">
                            {(r.fields.merchant || r.filename)[0].toUpperCase()}
                          </span>
                          <span>
                            <strong>{r.fields.merchant || r.filename}</strong>
                            <small>{r.fields.category}</small>
                          </span>
                        </span>
                        <span className="receipt-date">
                          {r.fields.date || "Not entered"}
                        </span>
                        <Status value={r.state} />
                        <strong className="receipt-amount">
                          {money(r.fields.total, r.fields.currency)}
                        </strong>
                        <Icon name="arrow" size={16} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-illustration">
                      <Icon name="receipts" size={38} />
                      <span>
                        <Icon name="check" size={15} />
                      </span>
                    </div>
                    <h2>
                      {rows.length
                        ? "Nothing here just yet."
                        : "A clean slate. A good start."}
                    </h2>
                    <p>
                      {rows.length
                        ? "Try a different search or filter."
                        : "Add your first receipt and give your paperwork a place to land."}
                    </p>
                    {!rows.length && (
                      <button
                        className="text-button"
                        onClick={() => input.current?.click()}
                      >
                        Add your first receipt <span>↗</span>
                      </button>
                    )}
                  </div>
                )}
                <div className="list-footer">
                  <span>
                    {filteredRows.length
                      ? `${firstVisibleReceipt + 1}–${Math.min(firstVisibleReceipt + RECEIPTS_PER_PAGE, filteredRows.length)} of ${filteredRows.length}`
                      : "0"}{" "}
                    receipt{filteredRows.length === 1 ? "" : "s"}
                  </span>
                  {totalReceiptPages > 1 ? (
                    <nav className="pagination" aria-label="Receipt pages">
                      <button
                        className="icon-button previous-page"
                        aria-label="Previous receipt page"
                        disabled={currentReceiptPage === 1}
                        onClick={() => setReceiptPage(currentReceiptPage - 1)}
                      >
                        <Icon name="arrow" size={15} />
                      </button>
                      <span>
                        Page {currentReceiptPage} of {totalReceiptPages}
                      </span>
                      <button
                        className="icon-button"
                        aria-label="Next receipt page"
                        disabled={currentReceiptPage === totalReceiptPages}
                        onClick={() => setReceiptPage(currentReceiptPage + 1)}
                      >
                        <Icon name="arrow" size={15} />
                      </button>
                    </nav>
                  ) : (
                    <span>Originals kept. Details in your hands.</span>
                  )}
                </div>
              </section>
              <div className="bottom-note">
                <Icon name="mail" size={20} />
                <div>
                  <strong>Receipts in your inbox?</strong>
                  <span>
                    {me.workspace.forwarding ? (
                      <>
                        {" "}
                        Forward them to{" "}
                        <button
                          className="text-button"
                          onClick={() =>
                            act(async () => {
                              await navigator.clipboard.writeText(
                                me.workspace.forwarding!,
                              );
                              setToast("Forwarding address copied.");
                            })
                          }
                        >
                          {me.workspace.forwarding}
                        </button>
                      </>
                    ) : (
                      " Email forwarding will be available after provider setup."
                    )}
                  </span>
                </div>
              </div>
            </>
          ) : page === "Exports" ? (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">READY FOR THE NEXT STEP</span>
                  <h1>Good records. Easy handoff.</h1>
                  <p>Take your work with you, or send it to your accountant.</p>
                </div>
              </div>
              <div className="notice">
                <Icon name="receipts" />
                <span>
                  {rows.length} receipts · {confirmed.length} confirmed ·{" "}
                  {needsReview.length} ready for review · {inProgress.length}{" "}
                  processing · {failed.length} failed. Exports include all
                  records, with confirmation status clearly labelled.
                </span>
              </div>
              <div className="export-grid">
                {(
                  [
                    {
                      format: "zip",
                      label: "The complete package",
                      description:
                        "Original receipts, a spreadsheet, a readable report, and the full record history.",
                      tag: "BEST FOR YOUR ACCOUNTANT",
                    },
                    {
                      format: "csv",
                      label: "Just the numbers",
                      description:
                        "A spreadsheet-ready file with amounts, categories, warnings, and confirmation dates.",
                      tag: "CSV SPREADSHEET",
                    },
                    {
                      format: "pdf",
                      label: "A clear overview",
                      description:
                        "A readable receipt report. Each record includes its status and anything worth checking.",
                      tag: "PDF REPORT",
                    },
                  ] as const
                ).map((x) => (
                  <section className="export-card" key={x.format}>
                    <div className="capture-symbol">
                      <Icon name="export" size={25} />
                    </div>
                    <span className="eyebrow">{x.tag}</span>
                    <h2>{x.label}</h2>
                    <p>{x.description}</p>
                    <button
                      disabled={
                        actionBusy ||
                        !rows.length ||
                        (me.quota.plan !== "paid" && x.format !== "csv")
                      }
                      className={`button ${x.format === "zip" ? "primary" : "secondary"}`}
                      onClick={() => download(x.format)}
                    >
                      {me.quota.plan !== "paid" && x.format !== "csv"
                        ? "Available with Pro"
                        : actionBusy
                          ? "Preparing…"
                          : `Prepare ${x.format.toUpperCase()}`}
                      <Icon name="export" size={16} />
                    </button>
                  </section>
                ))}
              </div>
              <section className="settings-card">
                <h2>Your exports</h2>
                {exportJobs.length === 0 ? (
                  <p>No exports yet.</p>
                ) : (
                  exportJobs.map((job) => (
                    <div className="export-job" key={job.id}>
                      <span>
                        {job.format.toUpperCase()} · {job.status}
                        {job.error && <small>{job.error}</small>}
                      </span>
                      {job.status === "complete" && (
                        <button
                          className="button secondary"
                          onClick={() =>
                            act(async () => {
                              const result = await api<{ url: string }>(
                                `/exports/${job.id}`,
                              );
                              const a = document.createElement("a");
                              a.href = result.url;
                              a.rel = "noreferrer";
                              a.click();
                            })
                          }
                        >
                          Download {job.format.toUpperCase()}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </section>
              <p className="fine-print">
                Export access is always available, even after cancelling your
                subscription. Different currencies remain separate; no
                exchange-rate conversions are applied.
              </p>
            </>
          ) : (
            <Settings
              me={me}
              onRefresh={refresh}
              onDeleted={() => {
                setMe(null);
                setRows([]);
              }}
              onAction={act}
              busy={actionBusy}
            />
          )}
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            hidden
            onChange={(e) => {
              if (e.target.files?.[0]) void uploadFile(e.target.files[0]);
            }}
          />
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              if (e.target.files?.[0]) void uploadFile(e.target.files[0]);
            }}
          />
        </main>
        <footer className="app-footer">
          <span>
            MapleTally <span>·</span> A little less paperwork.
          </span>
                <span>Made for Canadian independent business.</span>
        </footer>
      </div>
    </div>
  );
}
function Review({
  receipt,
  extractionAvailable,
  onClose,
  onSaved,
  onDelete,
}: {
  receipt: Receipt;
  extractionAvailable: boolean;
  onClose: () => void;
  onSaved: (r: Receipt) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [fields, setFields] = useState<Fields>(receipt.fields);
  const editedFields = useRef(new Set<keyof Fields>());
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    setFields((current) => {
      const next = { ...current };
      let changed = false;
      for (const key of Object.keys(receipt.fields) as (keyof Fields)[]) {
        if (
          !editedFields.current.has(key) &&
          current[key] !== receipt.fields[key]
        ) {
          (next as Record<keyof Fields, Fields[keyof Fields]>)[key] =
            receipt.fields[key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [receipt.fields]);
  useEffect(() => {
    api<{ url: string }>(`/receipts/${receipt.id}/link`)
      .then((r) => setUrl(r.url))
      .catch((e) => setError(e.message));
  }, [receipt.id]);
  const dirty = JSON.stringify(fields) !== JSON.stringify(receipt.fields);
  function fieldLabel(key: keyof Fields, label: string) {
    const confidence = receipt.confidence[key];
    const missingOptionalTip = key === "tip" && fields.tip === null;
    return (
      <span className="field-label">
        <span>{label}</span>
        {confidence !== undefined && confidence < 0.8 && !missingOptionalTip && (
          <small className="low-confidence">
            Check this field · {Math.round(confidence * 100)}% confidence
          </small>
        )}
      </span>
    );
  }
  function setField<K extends keyof Fields>(key: K, value: Fields[K]) {
    editedFields.current.add(key);
    setFields((current) => ({ ...current, [key]: value }));
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    await action(async () => {
      const r = await api<Receipt>(`/receipts/${receipt.id}`, "PUT", {
        fields,
        version: receipt.version,
      });
      editedFields.current.clear();
      setFields(r.fields);
      await onSaved(r);
    });
  }
  return (
    <>
      <button
        className="text-button back"
        onClick={() => {
          if (!dirty || window.confirm("Discard unsaved changes?")) onClose();
        }}
      >
        ← Back to receipts
      </button>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A MOMENT TO DOUBLE-CHECK</span>
          <h1>Review receipt</h1>
          <p>{receipt.filename}</p>
        </div>
        <Status value={receipt.state} />
      </div>
      <div className="review-grid">
        <section className="original-panel">
          <div className="panel-heading">
            <h2>The original</h2>
            {url && (
              <a href={url} target="_blank" rel="noreferrer">
                Open ↗
              </a>
            )}
          </div>
          <div className="preview">
            {url ? (
              receipt.mime === "application/pdf" ? (
                <iframe title="Original PDF receipt" src={url} />
              ) : (
                <img
                  alt="Original receipt"
                  src={url}
                  onError={() =>
                    setError(
                      "Preview expired or unsupported. Use Open to download, or reopen this receipt.",
                    )
                  }
                />
              )
            ) : (
              <p>Loading original…</p>
            )}
          </div>
          <p className="fine-print">
            Your original is preserved exactly as uploaded.
          </p>
        </section>
        <section className="review-fields">
          <div className="panel-heading">
            <h2>The details</h2>
            <span>Always yours to review</span>
          </div>
          {receipt.error && (
            <div className="notice warning">
              {receipt.error}
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await api(`/receipts/${receipt.id}/retry`, "POST");
                    onClose();
                  })
                }
              >
                Retry extraction ↗
              </button>
            </div>
          )}
          {["captured", "processing"].includes(receipt.state) && (
            <div className={`notice${extractionAvailable ? "" : " warning"}`}>
              {extractionAvailable
                ? "Extraction is queued or running. The details will update here automatically; you can also enter them manually now."
                : "Automatic extraction is not configured. Add the OpenAI API key to the deployment, or enter the details manually."}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>
              {fieldLabel("merchant", "Merchant")}
              <input
                required
                value={fields.merchant}
                maxLength={200}
                onChange={(e) => setField("merchant", e.target.value)}
                placeholder="Business on the receipt"
              />
            </label>
            <div className="form-grid">
              <label>
                {fieldLabel("date", "Receipt date")}
                <input
                  type="date"
                  required
                  value={fields.date}
                  onChange={(e) => setField("date", e.target.value)}
                />
              </label>
              <label>
                {fieldLabel("currency", "Currency")}
                <input
                  required
                  pattern="[A-Z]{3}"
                  maxLength={3}
                  value={fields.currency}
                  onChange={(e) =>
                    setField("currency", e.target.value.toUpperCase())
                  }
                />
              </label>
              <label>
                {fieldLabel("province", "Province or territory")}
                <input
                  value={fields.province}
                  maxLength={40}
                  placeholder="ON"
                  onChange={(e) => setField("province", e.target.value.toUpperCase())}
                />
              </label>
              <label>
                {fieldLabel("payment_method", "Payment method")}
                <input
                  value={fields.payment_method}
                  maxLength={80}
                  placeholder="Credit card"
                  onChange={(e) => setField("payment_method", e.target.value)}
                />
              </label>
            </div>
            <label>
              {fieldLabel("category", "Category")}
              <input
                list="categories"
                value={fields.category}
                maxLength={80}
                onChange={(e) => setField("category", e.target.value)}
              />
              <datalist id="categories">
                {[
                  "Advertising",
                  "Meals and Entertainment",
                  "Motor Vehicle Expenses",
                  "Office Expenses",
                  "Office Supplies",
                  "Professional Fees",
                  "Insurance",
                  "Rent",
                  "Utilities",
                  "Bank Charges",
                  "Delivery/Freight",
                  "Capital Assets/CCA Review",
                  "Other Expenses",
                  "Travel",
                  "Uncategorized",
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </datalist>
            </label>
            <div className="amount-fields">
              {(["subtotal", "gst", "hst", "qst", "pst", "rst", "tip", "total"] as const).map((k) => (
                <label key={k}>
                  {fieldLabel(
                    k,
                    k === "total" ? "Total" : k === "subtotal" ? "Subtotal" : k.toUpperCase(),
                  )}
                  <div className="amount-input">
                    <span>{fields.currency}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="-1000000"
                      max="1000000"
                      required={k === "total"}
                      aria-label={
                        k.toUpperCase()
                      }
                      value={
                        fields[k] === null
                          ? k === "tip"
                            ? "0.00"
                            : ""
                          : fields[k]! / 100
                      }
                      placeholder="Unknown"
                      onChange={(e) =>
                        setField(
                          k,
                          e.target.value === ""
                            ? null
                            : Math.round(Number(e.target.value) * 100),
                        )
                      }
                    />
                  </div>
                </label>
              ))}
            </div>
            <div className="form-grid">
              <label>
                {fieldLabel("business_or_personal", "Use")}
                <select
                  value={fields.business_or_personal}
                  onChange={(e) => setField("business_or_personal", e.target.value as Fields["business_or_personal"])}
                >
                  <option>Business</option>
                  <option>Personal</option>
                  <option>Mixed Use</option>
                </select>
              </label>
              <label>
                {fieldLabel("business_use_percent", "Business-use percentage")}
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  disabled={fields.business_or_personal !== "Mixed Use"}
                  value={fields.business_use_percent ?? ""}
                  placeholder={fields.business_or_personal === "Mixed Use" ? "Required" : "Not needed"}
                  onChange={(e) => setField("business_use_percent", e.target.value === "" ? null : Number(e.target.value))}
                />
              </label>
              <label>
                {fieldLabel("itc_status", "GST/HST/QST review")}
                <select value={fields.itc_status} onChange={(e) => setField("itc_status", e.target.value)}>
                  <option>Unknown</option>
                  <option>Possible</option>
                  <option>Not Indicated</option>
                  <option>Needs Review</option>
                </select>
              </label>
              <label>
                {fieldLabel("category_status", "Category status")}
                <select value={fields.category_status} onChange={(e) => setField("category_status", e.target.value)}>
                  <option>Suggested</option>
                  <option>Confirmed</option>
                  <option>Needs Review</option>
                </select>
              </label>
            </div>
            <label>
              {fieldLabel("notes", "Notes")}
              <textarea
                value={fields.notes}
                maxLength={2000}
                rows={3}
                placeholder="Add context for yourself or your accountant"
                onChange={(e) => setField("notes", e.target.value)}
              />
            </label>
            <p className="fine-print">
              Business and personal portions are organizational estimates. Confirm CRA rules or ask an accountant before claiming expenses, ITCs, vehicle costs, meals, home office, or CCA.
            </p>
            {receipt.duplicate_of && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                This is a separate expense, even though the merchant, date and
                total match another receipt.
              </label>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <div className="review-actions">
              <button
                className="button secondary"
                type="submit"
                disabled={busy || !dirty}
              >
                Save changes
              </button>
              <button
                className="button primary"
                type="button"
                disabled={
                  busy ||
                  dirty ||
                  ["confirmed", "exported"].includes(receipt.state)
                }
                onClick={() =>
                  action(async () => {
                    const r = await api<Receipt>(
                      `/receipts/${receipt.id}/confirm`,
                      "POST",
                      { version: receipt.version, acknowledgeDuplicate: ack },
                    );
                    await onSaved(r);
                  })
                }
              >
                <Icon name="check" size={17} />
                Confirm receipt
              </button>
            </div>
            {dirty && (
              <small className="fine-print">
                Save your changes before confirming. Saving clears any previous
                confirmation.
              </small>
            )}
          </form>
          <div className="delete-receipt">
            {deleting ? (
              <>
                <p>Delete this receipt and its original file permanently?</p>
                <button
                  disabled={busy}
                  className="button danger"
                  onClick={() => action(onDelete)}
                >
                  Yes, delete receipt
                </button>
                <button
                  className="text-button"
                  onClick={() => setDeleting(false)}
                >
                  Keep it
                </button>
              </>
            ) : (
              <button
                className="text-button muted"
                onClick={() => setDeleting(true)}
              >
                Delete receipt
              </button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
function Settings({
  me,
  onRefresh,
  onDeleted,
  onAction,
  busy,
}: {
  me: Me;
  onRefresh: () => Promise<void>;
  onDeleted: () => void;
  onAction: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [name, setName] = useState(me.workspace.name);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);
  async function billing(path: string) {
    await onAction(async () => {
      const result = await api<{ url: string }>(`/billing/${path}`, "POST");
      window.location.assign(result.url);
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE YOURSELF AT HOME</span>
          <h1>Workspace settings</h1>
          <p>A few details to keep everything in order.</p>
        </div>
      </div>
      <div className="settings-stack">
        <section className="settings-card">
          <h2>Your business</h2>
          <p>Signed in as {me.user.email}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onAction(async () => {
                await api("/account", "PATCH", { name });
                await onRefresh();
                setSaved(true);
              });
            }}
          >
            <label>
              Business name
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
                required
                maxLength={100}
              />
            </label>
            <button className="button secondary" disabled={busy}>
              {saved ? "Saved" : "Save business name"}
            </button>
          </form>
          <button
            className="text-button"
            onClick={() =>
              onAction(async () => {
                await api("/auth/logout", "POST");
                onDeleted();
              })
            }
          >
            Sign out
          </button>
        </section>
        <section className="settings-card">
          <span className="eyebrow">PLANS</span>
          <h2>{me.quota.plan === "paid" ? "Pro plan" : "Free plan"}</h2>
          <p>
            {me.quota.used} of {me.quota.limit} receipts used this month.
          </p>
          <p className="quota-policy">
            Your allowance is a monthly count of successful processing. Failed
            and duplicate receipts are not charged. Deleting a receipt does not
            return a used slot.
          </p>
          <div className="plan-grid">
            <div className={me.quota.plan === "free" ? "plan active" : "plan"}>
              <div className="plan-heading">
                <strong>Free</strong>
                <span>Free forever</span>
              </div>
              <p>Core receipt capture for light use and trying MapleTally.</p>
              <ul>
                <li>20 receipts per month</li>
                <li>Image/PDF upload, OCR and AI extraction</li>
                <li>GST/HST checks, editing and CSV export</li>
                <li>12 months of records</li>
                <li>No credit card required</li>
              </ul>
            </div>
            <div className={me.quota.plan === "paid" ? "plan active" : "plan"}>
              <div className="plan-heading">
                <strong>Pro</strong>
                <span>CAD $12.99/mo · $119/yr</span>
              </div>
              <p>More automation and a complete handoff for your accountant.</p>
              <ul>
                {PRO_FEATURES.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>
          </div>
          {me.hasCustomer ? (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => billing("portal")}
            >
              Manage billing & cancellation ↗
            </button>
          ) : (
            <button
              className="button primary"
              disabled={busy || !me.billingAvailable}
              onClick={() => billing("checkout")}
            >
              Upgrade your plan ↗
            </button>
          )}
          {!me.billingAvailable && (
            <p className="fine-print">
              Paid subscriptions will be available after billing setup.
            </p>
          )}
          <p className="fine-print">
            You can still read, edit, delete and export your existing records
            after cancellation or when your allowance runs out.
          </p>
        </section>
        <section className="settings-card">
          <h2>Forward from your inbox</h2>
          {me.workspace.forwarding ? (
            <>
              <p>
                Send attachments from <strong>{me.user.email}</strong> to your
                private receipt address:
              </p>
              <code className="email-address">{me.workspace.forwarding}</code>
              <p className="fine-print">
                Your email provider must pass sender authentication. Up to 5
                attachments per email, each under 10 MB. Upload directly if
                forwarding fails.
              </p>
            </>
          ) : (
            <p>
              Email forwarding is awaiting setup. You can upload photos and PDFs
              from Receipts.
            </p>
          )}
          {me.notifications.map((n) => (
            <div className="notice warning" key={n.id}>
              {n.message}
            </div>
          ))}
        </section>
        <section className="settings-card">
          <h2>Your data, in your hands</h2>
          <p>
            Original files, extraction results and your corrections stay
            together until you delete them. Automatic extraction is advisory;
            you confirm the final record. Tax warnings do not determine GST/HST
            eligibility.
          </p>
          <p>
            Use Exports to download your records before deleting your account.
            Account deletion also cancels any active subscription.
          </p>
          {deleting ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void onAction(async () => {
                  await api("/account", "DELETE", { password });
                  onDeleted();
                });
              }}
            >
              <label>
                Confirm your password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <p className="error">
                This permanently removes your account and stored receipts from
                the live service. Backups expire according to the deployment
                retention policy.
              </p>
              <button className="button danger" disabled={busy}>
                Permanently delete account
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setDeleting(false)}
              >
                Keep my account
              </button>
            </form>
          ) : (
            <button
              className="text-button danger-text"
              onClick={() => setDeleting(true)}
            >
              Delete account and receipts
            </button>
          )}
        </section>
      </div>
    </>
  );
}
