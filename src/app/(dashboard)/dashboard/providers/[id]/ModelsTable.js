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
 * Replaces the old flex-wrap grid of ModelRow chips with a dense table that
 * supports sorting by last synced time, name, and context window.
 *
 * Per-row action affordances and hover-reveal behaviour mirror the original
 * ModelRow chip so existing UX is preserved.
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
      className={`px-4 py-2.5 cursor-pointer select-none hover:bg-bg-subtle/50 whitespace-nowrap ${align === "right" ? "text-right" : ""}`}
      onClick={() => toggleSort(field)}
    >
      {label}
      <SortIcon field={field} currentSort={sortField} currentOrder={sortOrder} />
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm text-left">
        <thead className="bg-bg-subtle/30 text-text-muted uppercase text-xs">
          <tr>
            {headerCell("name", "Model")}
            {headerCell("context", "Context")}
            {headerCell("releasedAt", "Released")}
            <th className="px-4 py-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                {emptyMessage}
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
            const borderColor = testStatus === "ok"
              ? "border-green-500/40"
              : testStatus === "error"
              ? "border-red-500/40"
              : "border-transparent";
            const iconColor = testStatus === "ok"
              ? "#22c55e"
              : testStatus === "error"
              ? "#ef4444"
              : undefined;

            return (
              <tr key={rowKey} className="group hover:bg-bg-subtle/30 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="flex min-w-0 items-start gap-2">
                    <span
                      className="material-symbols-outlined shrink-0 text-base"
                      style={iconColor ? { color: iconColor } : undefined}
                    >
                      {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <code className="max-w-[72vw] truncate rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted sm:max-w-[360px]">{fullModel}</code>
                      <span className="flex min-w-0 items-center text-[9px] gap-1 pl-1">
                        {model.name && <span className="truncate text-[9px] italic text-text-muted/70">{model.name}</span>}
                        <CapacityBadges caps={caps} colorOverride="text-text-muted/70" size={12} />
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-text-muted whitespace-nowrap">
                  {ctx ? `${Math.round(ctx / 1000)}k` : "—"}
                </td>
                <td className="px-4 py-2.5 text-text-muted whitespace-nowrap">
                  {model.releasedAt ? (
                    <span title={fmtAbsolute(model.releasedAt)}>{fmtRelative(model.releasedAt)}</span>
                  ) : (
                    <span className="text-text-muted/60">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {onTest && (
                      <div className="relative shrink-0 group/btn">
                        <button
                          onClick={() => onTest(model.id)}
                          disabled={isTesting}
                          className={`rounded p-0.5 text-text-muted transition-opacity hover:bg-sidebar hover:text-primary ${isTesting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`}
                        >
                          <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                            {isTesting ? "progress_activity" : "science"}
                          </span>
                        </button>
                        <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                          {isTesting ? "Testing..." : "Test"}
                        </span>
                      </div>
                    )}
                    <div className="relative shrink-0 group/btn">
                      <button
                        onClick={() => onCopy(copyText, `model-${model.id}`)}
                        className="rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary"
                      >
                        <span className="material-symbols-outlined text-sm">
                          {copied === `model-${model.id}` ? "check" : "content_copy"}
                        </span>
                      </button>
                      <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                        {copied === `model-${model.id}` ? "Copied!" : "Copy"}
                      </span>
                    </div>
                    {isCustom ? (
                      <button
                        onClick={() => onDeleteAlias(model.id)}
                        className={`rounded p-0.5 text-text-muted hover:bg-red-500/10 hover:text-red-500 ${onTest ? "opacity-100 sm:opacity-0 sm:group-hover:opacity-100" : "opacity-100"}`}
                        title="Remove custom model"
                      >
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    ) : onDisable ? (
                      <button
                        onClick={() => onDisable(model.id)}
                        className={`rounded p-0.5 text-text-muted hover:bg-red-500/10 hover:text-red-500 ${onTest ? "opacity-100 sm:opacity-0 sm:group-hover:opacity-100" : "opacity-100"}`}
                        title="Disable this model"
                      >
                        <span className="material-symbols-outlined text-sm">close</span>
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
  );
}

ModelsTable.propTypes = {
  models: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    lastSyncedAt: PropTypes.string,
    firstSeenAt: PropTypes.string,
    releasedAt: PropTypes.string,
    maxInputTokens: PropTypes.number,
    contextLength: PropTypes.number,
  })).isRequired,
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
