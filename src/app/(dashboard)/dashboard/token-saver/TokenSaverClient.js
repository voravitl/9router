"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, Button, Input, Modal, Toggle } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { getCurrentLocale, onLocaleChange } from "@/i18n/runtime";
import {
  WENYAN_LOCALES,
  CAVEMAN_LEVELS,
  PONYTAIL_LEVELS,
} from "../endpoint/endpointConstants";

function fmtBytes(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.abs(Number(n));
  if (v < 1024) return `${Math.round(n)} B`;
  if (v < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString();
}

export default function TokenSaverClient() {
  const [rtkEnabled, setRtkEnabledState] = useState(true);
  const [headroomEnabled, setHeadroomEnabled] = useState(false);
  const [headroomUrl, setHeadroomUrl] = useState("http://localhost:8787");
  const [headroomStatus, setHeadroomStatus] = useState({
    installed: false,
    running: false,
    python: null,
    loading: true,
  });
  const [showHeadroomInstallModal, setShowHeadroomInstallModal] =
    useState(false);
  const [headroomActionLoading, setHeadroomActionLoading] = useState(false);
  const [headroomActionError, setHeadroomActionError] = useState("");
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState("full");
  const [ponytailEnabled, setPonytailEnabled] = useState(false);
  const [ponytailLevel, setPonytailLevel] = useState("full");
  const [locale, setLocale] = useState("en");
  const [summaryPeriod, setSummaryPeriod] = useState("7d");
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");

  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    setLocale(getCurrentLocale());
    return onLocaleChange(() => setLocale(getCurrentLocale()));
  }, []);

  const isWenyanLocale = WENYAN_LOCALES.includes(locale);
  const visibleCavemanLevels = isWenyanLocale
    ? CAVEMAN_LEVELS
    : CAVEMAN_LEVELS.filter((lvl) => !lvl.wenyan);

  useEffect(() => {
    const current = CAVEMAN_LEVELS.find((lvl) => lvl.id === cavemanLevel);
    if (current?.wenyan && !isWenyanLocale) {
      setCavemanLevel("ultra");
      patchSetting({ cavemanLevel: "ultra" });
    }
  }, [isWenyanLocale, cavemanLevel]);

  const patchSetting = async (patch) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (error) {
      console.log("Error updating setting:", error);
    }
  };

  const handleRtkEnabled = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rtkEnabled: value }),
      });
      if (res.ok) setRtkEnabledState(value);
    } catch (error) {
      console.log("Error updating rtkEnabled:", error);
    }
  };

  const handleCavemanEnabled = (value) => {
    setCavemanEnabled(value);
    patchSetting({ cavemanEnabled: value });
  };

  const handleHeadroomEnabled = (value) => {
    const nextUrl = headroomUrl.trim() || "http://localhost:8787";
    setHeadroomUrl(nextUrl);
    setHeadroomEnabled(value);
    patchSetting({ headroomEnabled: value, headroomUrl: nextUrl });
  };

  const handleHeadroomUrlBlur = async () => {
    const next = headroomUrl.trim() || "http://localhost:8787";
    setHeadroomUrl(next);
    await patchSetting({ headroomUrl: next });
    refreshHeadroomStatus();
  };

  const refreshHeadroomStatus = useCallback(async () => {
    setHeadroomStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/headroom/status", {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await res.json();
      setHeadroomStatus({ ...data, loading: false });
    } catch {
      setHeadroomStatus({
        installed: false,
        running: false,
        python: null,
        loading: false,
      });
    }
  }, []);

  const handleHeadroomStart = useCallback(async () => {
    setHeadroomActionError("");
    setHeadroomActionLoading(true);
    try {
      const res = await fetch("/api/headroom/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to start proxy");
      await refreshHeadroomStatus();
    } catch (e) {
      setHeadroomActionError(e.message);
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const handleHeadroomStop = useCallback(async () => {
    setHeadroomActionLoading(true);
    try {
      await fetch("/api/headroom/stop", { method: "POST" });
      await refreshHeadroomStatus();
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const handleCavemanLevel = (level) => {
    setCavemanLevel(level);
    patchSetting({ cavemanLevel: level });
  };

  const handlePonytailEnabled = (value) => {
    setPonytailEnabled(value);
    patchSetting({ ponytailEnabled: value });
  };

  const handlePonytailLevel = (level) => {
    setPonytailLevel(level);
    patchSetting({ ponytailLevel: level });
  };

  const loadSummary = useCallback(async (period = summaryPeriod) => {
    setSummaryLoading(true);
    setSummaryError("");
    try {
      const res = await fetch(`/api/usage/token-save-summary?period=${period}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load summary");
      setSummary(data);
    } catch (e) {
      setSummaryError(e.message || "Failed to load summary");
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [summaryPeriod]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setRtkEnabledState(data.rtkEnabled !== false);
          setHeadroomEnabled(!!data.headroomEnabled);
          setHeadroomUrl(data.headroomUrl || "http://localhost:8787");
          setCavemanEnabled(!!data.cavemanEnabled);
          setCavemanLevel(data.cavemanLevel || "full");
          setPonytailEnabled(!!data.ponytailEnabled);
          setPonytailLevel(data.ponytailLevel || "full");
          refreshHeadroomStatus();
        }
      } catch {}
    };
    loadSettings();
  }, [refreshHeadroomStatus]);

  useEffect(() => {
    loadSummary(summaryPeriod);
  }, [summaryPeriod, loadSummary]);

  const headroomRunning = !!headroomStatus.running;
  const headroomLocalUrl = headroomStatus.localUrl !== false;
  // External Docker sidecar (e.g. http://headroom:8787) — not managed by this process.
  const headroomExternal = headroomStatus.localUrl === false;
  const headroomStatusLabel = headroomStatus.loading
    ? "Checking…"
    : headroomRunning
      ? "Running"
      : headroomExternal
        ? "Unreachable"
        : !headroomStatus.installed
          ? "Not installed"
          : "Stopped";
  const headroomCanStart = !!headroomStatus.canStart;
  const headroomManaged =
    headroomLocalUrl && !!headroomStatus.managedPid;

  const rtk = summary?.rtk;
  const hr = summary?.headroom;

  return (
    <div className="space-y-6 p-6">
      {/* Aggregated before/after savings — primary reason this page is in the sidebar */}
      <Card id="savings-report">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">monitoring</span>
              Savings report
            </h2>
            <p className="text-sm text-text-muted mt-1">
              After RTK / Headroom pipeline — combined before → after from real requests
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {["24h", "7d", "30d"].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setSummaryPeriod(p)}
                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                  summaryPeriod === p
                    ? "bg-primary text-white border-primary"
                    : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                }`}
              >
                {p}
              </button>
            ))}
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => loadSummary(summaryPeriod)} disabled={summaryLoading}>
              Refresh
            </Button>
          </div>
        </div>

        {summaryError ? (
          <p className="text-sm text-warning mb-3">{summaryError}</p>
        ) : null}

        {summaryLoading && !summary ? (
          <p className="text-sm text-text-muted">Loading savings…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <div className="rounded-xl border border-border bg-surface-2/40 p-4">
                <p className="text-xs uppercase tracking-wide text-text-muted">Scanned</p>
                <p className="text-2xl font-semibold mt-1">{fmtNum(summary?.period?.scanned)}</p>
                <p className="text-xs text-text-muted mt-1">
                  requests in {summary?.periodLabel || summaryPeriod}
                  {summary?.period?.truncated ? " (capped)" : ""}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface-2/40 p-4">
                <p className="text-xs uppercase tracking-wide text-text-muted">RTK before → after</p>
                <p className="text-lg font-semibold mt-1 font-mono">
                  {fmtBytes(rtk?.bytesBefore)} → {fmtBytes(rtk?.bytesAfter)}
                </p>
                <p className="text-sm text-success mt-1">
                  −{fmtBytes(rtk?.bytesSaved)} ({rtk?.pctSaved ?? 0}%)
                </p>
                <p className="text-xs text-text-muted mt-1">
                  {fmtNum(rtk?.requestsWithSavings)} / {fmtNum(rtk?.requestsWithStats)} requests saved
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface-2/40 p-4">
                <p className="text-xs uppercase tracking-wide text-text-muted">Headroom</p>
                <p className="text-2xl font-semibold mt-1">
                  −{fmtNum(hr?.tokensSaved)} <span className="text-sm font-normal text-text-muted">tok</span>
                </p>
                <p className="text-xs text-text-muted mt-1">
                  {hr?.bytesSaved > 0 ? `also −${fmtBytes(hr.bytesSaved)} body` : "tokens reported by proxy"}
                </p>
                <p className="text-xs text-text-muted mt-1">
                  {fmtNum(hr?.requestsWithSavings)} requests with savings
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface-2/40 p-4">
                <p className="text-xs uppercase tracking-wide text-text-muted">Caveman / Ponytail</p>
                <p className="text-sm mt-2 text-text-muted leading-5">
                  Prompt-only — no before/after meter. They shorten model output / code style, not measured in this report.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Top RTK filters</p>
                {rtk?.topFilters?.length ? (
                  <ul className="space-y-1.5">
                    {rtk.topFilters.map((f) => (
                      <li key={f.name} className="flex justify-between text-sm border-b border-border/60 pb-1">
                        <span className="font-mono">{f.name}</span>
                        <span className="text-text-muted">{fmtNum(f.count)} hits</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-text-muted">No RTK hits in this window.</p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Recent savings</p>
                {summary?.recent?.length ? (
                  <ul className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                    {summary.recent.map((row, idx) => (
                      <li key={row.id || idx} className="text-xs border-b border-border/60 pb-1.5">
                        <div className="flex justify-between gap-2">
                          <span className="font-mono truncate">{row.model || "—"}</span>
                          <span className="text-success shrink-0">
                            {row.rtkBytesSaved > 0 ? `RTK −${fmtBytes(row.rtkBytesSaved)}` : ""}
                            {row.rtkBytesSaved > 0 && (row.headroomTokensSaved > 0 || row.headroomBytesSaved > 0) ? " · " : ""}
                            {row.headroomTokensSaved > 0 ? `HR −${fmtNum(row.headroomTokensSaved)}tok` : ""}
                            {row.headroomTokensSaved <= 0 && row.headroomBytesSaved > 0 ? `HR −${fmtBytes(row.headroomBytesSaved)}` : ""}
                          </span>
                        </div>
                        <p className="text-text-muted mt-0.5">
                          {row.timestamp ? new Date(row.timestamp).toLocaleString() : ""}
                          {row.provider ? ` · ${row.provider}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-text-muted">
                    No measured savings yet. Send agent traffic with tools (RTK) or enable Headroom, then refresh.
                  </p>
                )}
              </div>
            </div>

            {hr?.topSkipReasons?.length ? (
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">Headroom skip / errors</p>
                <ul className="text-xs text-warning space-y-1">
                  {hr.topSkipReasons.map((r) => (
                    <li key={r.reason} className="font-mono break-all">
                      {r.count}× {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3 text-sm">
              <Link href="/dashboard/usage" className="text-primary underline hover:opacity-80">
                Open Usage → Request Details (per-request benchmark)
              </Link>
              <Link href="/dashboard/basic-chat" className="text-primary underline hover:opacity-80">
                Test Chat (meta under replies)
              </Link>
            </div>
          </>
        )}
      </Card>

      <Card id="rtk">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">
              bolt
            </span>
            Controls
          </h2>
        </div>
        <div className="flex items-center justify-between pt-2 pb-4 border-b border-border gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress tool output{" "}
              <a
                href="https://github.com/rtk-ai/rtk"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (RTK)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              git/grep/ls/tree/logs → 60-90% fewer input tokens
            </p>
          </div>
          <Toggle
            checked={rtkEnabled}
            onChange={() => handleRtkEnabled(!rtkEnabled)}
          />
        </div>
        <div className="flex items-center justify-between py-4 border-b border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="font-medium">
                Compress context{" "}
                <a
                  href="https://github.com/chopratejas/headroom"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-normal text-primary underline hover:opacity-80"
                >
                  (Headroom)
                </a>
              </p>
              <span
                className={`text-xs px-2 py-0.5 rounded ${headroomRunning ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
              >
                {headroomStatusLabel}
              </span>
              {headroomEnabled && !headroomRunning && !headroomStatus.loading ? (
                <span className="text-xs text-warning">
                  enabled · proxy not reachable (fail-open)
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setShowHeadroomInstallModal(true)}
                className="text-xs text-primary underline hover:opacity-80"
              >
                {headroomRunning || headroomExternal ? "Manage" : "Setup"}
              </button>
            </div>
            <p className="text-sm text-text-muted mt-1">
              Compress prompts via /v1/compress before routing to the model
            </p>
          </div>
          <Toggle
            // Enabled state is independent of probe — compress is fail-open when down.
            // Tying the toggle to `running` made Setup look on/off when /health was slow.
            checked={headroomEnabled}
            onChange={() => handleHeadroomEnabled(!headroomEnabled)}
          />
        </div>
        <div className="flex items-center justify-between pt-4 gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress LLM output{" "}
              <a
                href="https://github.com/JuliusBrussee/caveman"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Caveman)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Terse-style system prompt → ~65% fewer output tokens (up to 87%)
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {cavemanEnabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {visibleCavemanLevels.map((lvl) => (
                    <button
                      key={lvl.id}
                      onClick={() => handleCavemanLevel(lvl.id)}
                      className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                        cavemanLevel === lvl.id
                          ? "bg-primary text-white border-primary"
                          : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                      }`}
                      title={lvl.desc}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-primary">
                  {
                    CAVEMAN_LEVELS.find((lvl) => lvl.id === cavemanLevel)
                      ?.desc
                  }
                </p>
              </div>
            )}
            <Toggle
              checked={cavemanEnabled}
              onChange={() => handleCavemanEnabled(!cavemanEnabled)}
            />
          </div>
        </div>
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Lazy senior dev{" "}
              <a
                href="https://github.com/DietrichGebert/ponytail"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Ponytail)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Bias the model toward minimal code: YAGNI, reuse stdlib,
              deletion over addition
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {ponytailEnabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {PONYTAIL_LEVELS.map((lvl) => (
                    <button
                      key={lvl.id}
                      onClick={() => handlePonytailLevel(lvl.id)}
                      className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                        ponytailLevel === lvl.id
                          ? "bg-primary text-white border-primary"
                          : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                      }`}
                      title={lvl.desc}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-primary">
                  {
                    PONYTAIL_LEVELS.find((lvl) => lvl.id === ponytailLevel)
                      ?.desc
                  }
                </p>
              </div>
            )}
            <Toggle
              checked={ponytailEnabled}
              onChange={() => handlePonytailEnabled(!ponytailEnabled)}
            />
          </div>
        </div>
      </Card>

      <Modal
        isOpen={showHeadroomInstallModal}
        title={headroomRunning ? "Headroom" : "Setup Headroom"}
        onClose={() => setShowHeadroomInstallModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between text-sm">
            <span>Status</span>
            <span
              className={headroomRunning ? "text-success" : "text-warning"}
            >
              {headroomStatusLabel}
            </span>
          </div>
          {headroomRunning && (
            <a
              href="/api/headroom/proxy/dashboard"
              target="_blank"
              rel="noreferrer"
              className="w-full rounded border border-border px-4 py-2 text-center text-sm hover:bg-surface-2"
            >
              Open Headroom Dashboard
            </a>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Proxy URL</p>
            <Input
              value={headroomUrl}
              onChange={(e) => setHeadroomUrl(e.target.value)}
              onBlur={handleHeadroomUrlBlur}
              placeholder="http://localhost:8787"
              className="font-mono text-sm"
            />
            <p className="text-xs text-text-muted">
              Use a local proxy for Start/Stop, or an external Docker sidecar
              like http://headroom:8787.
            </p>
          </div>
          {headroomManaged ? (
            <Button
              onClick={handleHeadroomStop}
              variant="ghost"
              fullWidth
              disabled={headroomActionLoading}
            >
              {headroomActionLoading ? "Stopping…" : "Stop Headroom"}
            </Button>
          ) : headroomRunning ? (
            <p className="text-sm text-success">
              Headroom proxy is reachable. You can enable the token saver.
            </p>
          ) : headroomCanStart ? (
            <Button
              onClick={handleHeadroomStart}
              fullWidth
              disabled={headroomActionLoading}
            >
              {headroomActionLoading ? "Starting…" : "Start Headroom"}
            </Button>
          ) : !headroomLocalUrl ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-warning">
                {headroomRunning
                  ? "Docker / external sidecar is reachable."
                  : "Start the Headroom container (or external proxy) at the URL above, then Recheck."}
              </p>
              <p className="text-xs text-text-muted">
                Compose example: service <code className="font-mono">headroom</code> on port 8787,
                set Proxy URL to <code className="font-mono">http://headroom:8787</code>.
              </p>
            </div>
          ) : !headroomStatus.python ? (
            <p className="text-sm text-warning">
              Python ≥ 3.10 required for local managed mode. Install Python
              first, or use an external proxy URL.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Install then click Start:</p>
              <div className="flex items-center gap-2">
                <pre className="flex-1 rounded bg-black/5 dark:bg-white/5 p-2 text-xs font-mono overflow-x-auto">
                  {`pip install "headroom-ai[proxy]"`}
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    copy(`pip install "headroom-ai[proxy]"`)
                  }
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}
          {headroomActionError && (
            <p className="text-sm text-warning">{headroomActionError}</p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => refreshHeadroomStatus()}
              variant="ghost"
              fullWidth
            >
              Recheck
            </Button>
            <Button
              onClick={() => setShowHeadroomInstallModal(false)}
              fullWidth
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
