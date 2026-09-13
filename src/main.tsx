"use client";
/** Responsive Supabase workspace with direct uploads, queued exports, and visibility-aware polling. */
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
  approved_at: string | null;
  created: string;
  confidence: Record<string, number>;
};
type Me = {
  user: { name: string; email: string };
  workspace: { name: string; forwarding: string | null };
  quota: {
    plan: string;
    used: number;
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
      {value.replaceAll("_", " ")}
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
                  ? "Create your workspace"
                  : "Sign in"}
              <Icon name="arrow" size={16} />
            </button>
          </form>
          <p className="fine-print">
            Your originals stay linked to your records. Review every receipt
            before approval, and export your data whenever you need it.
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
  const [filter, setFilter] = useState("all");
  const [progress, setProgress] = useState<number | null>(null);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [exportJobs, setExportJobs] = useState<
    { id: string; format: string; status: string; error: string | null }[]
  >([]);
  const [setupError, setSetupError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
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
  async function download(format: "csv" | "pdf" | "zip") {
    await act(async () => {
      await api("/exports", "POST", { format });
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
  const needsReview = rows.filter(
    (r) => !["approved", "exported"].includes(r.state),
  );
  const approved = rows.filter((r) =>
    ["approved", "exported"].includes(r.state),
  );
  const totalCad = approved
    .filter((r) => r.fields.currency === "CAD")
    .reduce((sum, r) => sum + (r.fields.total || 0), 0);
  const visible = rows.filter(
    (r) =>
      (filter === "all" ||
        (filter === "review"
          ? !["approved", "exported"].includes(r.state)
          : ["approved", "exported"].includes(r.state))) &&
      `${r.fields.merchant} ${r.filename} ${r.fields.category}`
        .toLowerCase()
        .includes(search.toLowerCase()),
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
            <small>Business workspace</small>
          </div>
        </div>
        <span className="nav-label">WORKSPACE</span>
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
              {p === "Receipts" && (
                <span className="nav-count">{rows.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="allowance">
            <div>
              <span>
                {me.quota.plan === "paid"
                  ? "Business plan"
                  : "A little room to grow"}
              </span>
              <Icon name="leaf" size={17} />
            </div>
            <p>
              {me.quota.used} of {me.quota.limit} receipts · {me.quota.period}
            </p>
            <div className="meter">
              <span
                style={{
                  width: `${Math.min(100, (me.quota.used / me.quota.limit) * 100)}%`,
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
          <span>
            Workspace <span className="crumb">/</span> <strong>{page}</strong>
          </span>
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
              <div className="page-heading">
                <div>
                  <span className="eyebrow">A CLEARER PICTURE</span>
                  <h1>Your receipts</h1>
                  <p>All the little expenses. One tidy place.</p>
                </div>
                <button
                  className="button primary"
                  disabled={progress !== null || !me.quota.canUpload}
                  onClick={() => input.current?.click()}
                >
                  <Icon name="plus" size={18} />
                  Add receipt
                </button>
              </div>
              <div className="stats">
                <div>
                  <span>
                    Total receipts <Icon name="receipts" size={18} />
                  </span>
                  <strong>
                    {rows.length}
                    <small>in your workspace</small>
                  </strong>
                </div>
                <div>
                  <span>
                    Ready for review <span className="amber-dot" />
                  </span>
                  <strong>
                    {needsReview.length}
                    <small>
                      {needsReview.length
                        ? "a quick look goes a long way"
                        : "nothing waiting on you"}
                    </small>
                  </strong>
                </div>
                <div>
                  <span>
                    Approved expenses <Icon name="check" size={18} />
                  </span>
                  <strong>
                    {money(totalCad, "CAD")}
                    <small>CAD · {approved.length} approved records</small>
                  </strong>
                </div>
              </div>
              <section
                className={`capture-card ${dragging ? "dragging" : ""}`}
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
                <div className="capture-symbol">
                  <Icon name="upload" size={24} />
                </div>
                <div>
                  <h2>
                    {progress === null
                      ? "From your pocket to your books."
                      : `Uploading your receipt… ${progress}%`}
                  </h2>
                  <p>
                    {progress === null
                      ? "Drop a receipt here, or choose a photo or PDF. We’ll help with the details."
                      : "Keep this page open. Your original will be saved securely."}
                  </p>
                  <span className="capture-meta">
                    JPG, PNG, WebP, HEIC & PDF <span>·</span> Up to 10 MB per
                    receipt
                  </span>
                  {progress !== null && (
                    <progress
                      max={100}
                      value={progress}
                      aria-label="Upload progress"
                    />
                  )}
                </div>
                <div className="capture-actions">
                  <button
                    className="button secondary"
                    disabled={progress !== null || !me.quota.canUpload}
                    onClick={() => input.current?.click()}
                  >
                    Choose a file
                  </button>
                  <button
                    className="text-button camera-button"
                    disabled={progress !== null || !me.quota.canUpload}
                    onClick={() => camera.current?.click()}
                  >
                    Take a photo
                  </button>
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
                  <div className="tabs">
                    {[
                      ["all", "All receipts"],
                      ["review", "To review"],
                      ["approved", "Approved"],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        className={filter === key ? "active" : ""}
                        onClick={() => setFilter(key)}
                      >
                        {label}
                        {key === "all" && <span>{rows.length}</span>}
                      </button>
                    ))}
                  </div>
                  <label className="search">
                    <Icon name="search" size={17} />
                    <input
                      aria-label="Search receipts"
                      placeholder="Search receipts"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
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
                    {visible.length} receipt{visible.length === 1 ? "" : "s"}
                  </span>
                  <span>Originals kept. Details in your hands.</span>
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
                  {rows.length} receipts · {approved.length} approved ·{" "}
                  {needsReview.length} awaiting review. Exports include all
                  records, with approval status clearly labelled.
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
                        "A spreadsheet-ready file with amounts, categories, warnings, and approval dates.",
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
                      disabled={actionBusy || !rows.length}
                      className={`button ${x.format === "zip" ? "primary" : "secondary"}`}
                      onClick={() => download(x.format)}
                    >
                      {actionBusy
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
          <span>Made for independent business.</span>
        </footer>
      </div>
    </div>
  );
}
function Review({
  receipt,
  onClose,
  onSaved,
  onDelete,
}: {
  receipt: Receipt;
  onClose: () => void;
  onSaved: (r: Receipt) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [fields, setFields] = useState<Fields>(receipt.fields);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    api<{ url: string }>(`/receipts/${receipt.id}/link`)
      .then((r) => setUrl(r.url))
      .catch((e) => setError(e.message));
  }, [receipt.id]);
  const dirty = JSON.stringify(fields) !== JSON.stringify(receipt.fields);
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
            <div className="notice">
              Extraction is queued or running. You can enter details manually
              now, or reopen this receipt shortly to see the result.
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>
              Merchant
              <input
                required
                value={fields.merchant}
                maxLength={200}
                onChange={(e) =>
                  setFields({ ...fields, merchant: e.target.value })
                }
                placeholder="Business on the receipt"
              />
            </label>
            <div className="form-grid">
              <label>
                Receipt date
                <input
                  type="date"
                  required
                  value={fields.date}
                  onChange={(e) =>
                    setFields({ ...fields, date: e.target.value })
                  }
                />
              </label>
              <label>
                Currency
                <input
                  required
                  pattern="[A-Z]{3}"
                  maxLength={3}
                  value={fields.currency}
                  onChange={(e) =>
                    setFields({
                      ...fields,
                      currency: e.target.value.toUpperCase(),
                    })
                  }
                />
              </label>
            </div>
            <label>
              Category
              <input
                list="categories"
                value={fields.category}
                maxLength={80}
                onChange={(e) =>
                  setFields({ ...fields, category: e.target.value })
                }
              />
              <datalist id="categories">
                {[
                  "Meals & entertainment",
                  "Office supplies",
                  "Travel",
                  "Software & services",
                  "Vehicle",
                  "Professional services",
                  "Uncategorized",
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </datalist>
            </label>
            <div className="amount-fields">
              {(["subtotal", "tax", "tip", "total"] as const).map((k) => (
                <label key={k}>
                  {k === "tax"
                    ? "Sales tax (combined)"
                    : k[0].toUpperCase() + k.slice(1)}
                  <div className="amount-input">
                    <span>{fields.currency}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="-1000000"
                      max="1000000"
                      required={k === "total"}
                      aria-label={
                        k === "tax"
                          ? "Sales tax"
                          : k[0].toUpperCase() + k.slice(1)
                      }
                      value={fields[k] === null ? "" : fields[k]! / 100}
                      placeholder="Unknown"
                      onChange={(e) =>
                        setFields({
                          ...fields,
                          [k]:
                            e.target.value === ""
                              ? null
                              : Math.round(Number(e.target.value) * 100),
                        })
                      }
                    />
                  </div>
                </label>
              ))}
            </div>
            {receipt.warnings.length > 0 && (
              <div className="warning-list">
                <strong>A few things to check</strong>
                {receipt.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
                <small>
                  Arithmetic checks only. GST/HST treatment should be confirmed
                  with your accountant.
                </small>
              </div>
            )}
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
                  ["approved", "exported"].includes(receipt.state)
                }
                onClick={() =>
                  action(async () => {
                    const r = await api<Receipt>(
                      `/receipts/${receipt.id}/approve`,
                      "POST",
                      { version: receipt.version, acknowledgeDuplicate: ack },
                    );
                    await onSaved(r);
                  })
                }
              >
                <Icon name="check" size={17} />
                Approve receipt
              </button>
            </div>
            {dirty && (
              <small className="fine-print">
                Save your changes before approving. Saving clears any previous
                approval.
              </small>
            )}
          </form>
          {receipt.original && (
            <details className="extraction-details">
              <summary>View the original extraction</summary>
              <dl>
                {Object.entries(receipt.original).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>
                      {v === null
                        ? "Unknown"
                        : ["subtotal", "tax", "tip", "total"].includes(k)
                          ? money(Number(v), receipt.original!.currency)
                          : String(v)}
                      {receipt.confidence[k] !== undefined && (
                        <small>
                          {" "}
                          · {Math.round(receipt.confidence[k] * 100)}%
                          confidence
                        </small>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
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
          <h2>
            {me.quota.plan === "paid" ? "Business plan" : "Free allowance"}
          </h2>
          <p>
            {me.quota.used} of {me.quota.limit} receipts used {me.quota.period}.
            Business includes 500 receipts per month. The subscription price is
            shown at checkout.
          </p>
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
            you approve the final record. Tax warnings do not determine GST/HST
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
