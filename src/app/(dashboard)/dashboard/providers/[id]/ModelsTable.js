"use client";

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { CapacityBadges } from "@/shared/components";
import SortIcon from "@/shared/components/SortIcon";
import { fullModelWithSuffix } from "@/shared/utils/claudeCodeModelId";
import { compareModels } from "./models-table-sort";

export { compareModels };

function fmtRelative(iso) {
  if (!iso) return "";
  const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function fmtAbsolute(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "";
  }
}

/**
 * Sortable table of available models for a provider detail page.
 * Displays models with context length pills, test status indicators,
 * and quick action affordances.
 */
export default function ModelsTable({
  models,
  getContextWindow,
  copied,
  onCopy,
  onTest,
  onDeleteAlias,
  onDisable,
  modelTestResults = {},
  testingModelIds,
  isCustomMap = {},
  capsMap = {},
  fullModelFor,
  emptyMessage = "No models",
}) {
  const [sortField, setSortField] = useState("releasedAt");
  const [sortOrder, setSortOrder] = useState("desc");

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder(field === "releasedAt" ? "desc" : "asc");
    }
  };

  const sorted = useMemo(() => {
    const arr = Array.isArray(models) ? [...models] : [];
    arr.sort((a, b) => compareModels(a, b, sortField, sortOrder));
    return arr;
  }, [models, sortField, sortOrder]);

  const headerCell = (field, label, align = "left") => (
    <th
      className={`px-4 py-3 cursor-pointer select-none font-semibold transition-colors hover:bg-sidebar/80 hover:text-text-main whitespace-nowrap ${align === "right" ? "text-right" : ""}`}
      onClick={() => toggleSort(field)}
    >
      <div className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        <span>{label}</span>
        <SortIcon field={field} currentSort={sortField} currentOrder={sortOrder} />
      </div>
    </th>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-background shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border/60 bg-sidebar/50 text-xs text-text-muted uppercase tracking-wider">
            <tr>
              {headerCell("name", "Model")}
              {headerCell("context", "Context")}
              {headerCell("releasedAt", "Released")}
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-text-muted">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-[32px] text-text-muted/40">inbox</span>
                    <span>{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            )}
            {sorted.map((model) => {
              const fullModel = fullModelFor ? fullModelFor(model) : model.fullModel;
              const rowKey = fullModel || model.id;
              const ctx = model.maxInputTokens || model.contextLength || (getContextWindow ? getContextWindow(fullModel) : 0) || 0;
              const testStatus = modelTestResults[model.id];
              const isTesting = testingModelIds && testingModelIds.has ? testingModelIds.has(model.id) : false;
              const isCustom = !!isCustomMap[model.id];
              const caps = capsMap[model.id];
              const slash = typeof fullModel === "string" ? fullModel.indexOf("/") : -1;
              const baseCopyText = slash > 0
                ? fullModelWithSuffix(fullModel.slice(0, slash), fullModel.slice(slash + 1), getContextWindow ? getContextWindow(fullModel) : undefined)
                : fullModel;
              const copyText = model.thinkingSuffix ? `${baseCopyText}(${model.thinkingSuffix})` : baseCopyText;

              const iconColor = testStatus === "ok"
                ? "#22c55e"
                : testStatus === "error"
                ? "#ef4444"
                : undefined;

              return (
                <tr key={rowKey} className="group transition-colors hover:bg-sidebar/50">
                  <td className="px-4 py-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        className="material-symbols-outlined shrink-0 text-[18px] mt-0.5 transition-transform group-hover:scale-110"
                        style={iconColor ? { color: iconColor } : undefined}
                      >
                        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <code className="max-w-[72vw] truncate rounded-md border border-border/60 bg-sidebar px-2 py-0.5 font-mono text-xs font-semibold text-text-main group-hover:border-primary/40 group-hover:text-primary transition-colors sm:max-w-[360px]">
                            {fullModel}
                          </code>
                          {isCustom && (
                            <span className="rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              custom
                            </span>
                          )}
                        </div>
                        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted/80 pl-0.5">
                          {model.name && <span className="truncate italic">{model.name}</span>}
                          <CapacityBadges caps={caps} colorOverride="text-text-muted/70" size={12} />
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-muted whitespace-nowrap">
                    {ctx ? (
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs ${
                        ctx >= 1000000
                          ? "bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30 font-semibold"
                          : ctx >= 200000
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : "bg-sidebar text-text-muted border border-border/60"
                      }`}>
                        {ctx >= 1000000 ? `${(ctx / 1000000).toFixed(1).replace(/\.0$/, "")}M` : `${Math.round(ctx / 1000)}k`}
                      </span>
                    ) : (
                      <span className="text-text-muted/50">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">
                    {model.releasedAt ? (
                      <span title={fmtAbsolute(model.releasedAt)} className="font-mono">{fmtRelative(model.releasedAt)}</span>
                    ) : (
                      <span className="text-text-muted/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {onTest && (
                        <button
                          onClick={() => onTest(model.id)}
                          disabled={isTesting}
                          className={`rounded-lg p-1.5 text-text-muted transition-all hover:bg-primary/10 hover:text-primary ${
                            isTesting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          }`}
                          title={isTesting ? "Testing..." : "Test model connection"}
                        >
                          <span
                            className="material-symbols-outlined text-[16px]"
                            style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}
                          >
                            {isTesting ? "progress_activity" : "science"}
                          </span>
                        </button>
                      )}
                      <button
                        onClick={() => onCopy(copyText, `model-${model.id}`)}
                        className="rounded-lg p-1.5 text-text-muted transition-all hover:bg-primary/10 hover:text-primary"
                        title={copied === `model-${model.id}` ? "Copied!" : "Copy model name"}
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {copied === `model-${model.id}` ? "check" : "content_copy"}
                        </span>
                      </button>
                      {isCustom ? (
                        <button
                          onClick={() => onDeleteAlias(model.id)}
                          className="rounded-lg p-1.5 text-text-muted transition-all hover:bg-red-500/10 hover:text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          title="Remove custom model"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      ) : onDisable ? (
                        <button
                          onClick={() => onDisable(model.id)}
                          className="rounded-lg p-1.5 text-text-muted transition-all hover:bg-red-500/10 hover:text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          title="Disable this model"
                        >
                          <span className="material-symbols-outlined text-[16px]">block</span>
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

ModelsTable.propTypes = {
  models: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string,
      lastSyncedAt: PropTypes.string,
      firstSeenAt: PropTypes.string,
      releasedAt: PropTypes.string,
      maxInputTokens: PropTypes.number,
      contextLength: PropTypes.number,
    })
  ).isRequired,
  getContextWindow: PropTypes.func,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onTest: PropTypes.func,
  onDeleteAlias: PropTypes.func,
  onDisable: PropTypes.func,
  modelTestResults: PropTypes.object,
  testingModelIds: PropTypes.shape({
    has: PropTypes.func.isRequired,
  }),
  isCustomMap: PropTypes.object,
  capsMap: PropTypes.object,
  fullModelFor: PropTypes.func,
  emptyMessage: PropTypes.string,
};
