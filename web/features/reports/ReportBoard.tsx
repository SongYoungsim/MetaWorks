import { ArrowDown, ArrowUp, CalendarDays, Check, Copy, Ellipsis, EyeOff, LoaderCircle, Pencil, Plane, Plus, RotateCcw, Search, Trash2, Umbrella, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/react";
import type {
  DecisionStatus,
  AttendanceWriteRequest,
  WeeklyEntryUpdateRequest,
  WeeklyEntryResult,
  WeeklyReportEntry,
  WeeklyReportResponse,
  WeeklyScheduleInput,
  WeeklyAttendance,
  WeeklyTitleHistoryResponse,
} from "@shared/types";
import { clipDateRange, formatMdWithDay, splitYearWeek, toKstDateString } from "@shared/week";
import { EmptyState, Modal, SegmentedControl, SidePanel, StatusBadge } from "@/components/ui";
import { ApiClientError, apiRequest } from "@/lib/api";
import { RichTextEditor } from "./RichTextEditor";

type BoardFilter = "all" | "mine" | "decision";

const RESULT: Record<WeeklyEntryResult, { symbol: string; label: string }> = {
  done: { symbol: "○", label: "완료" },
  continue: { symbol: "→", label: "계속" },
  stopped: { symbol: "×", label: "중단" },
  hold: { symbol: "△", label: "보류" },
};

function scheduleLabel(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { dates?: unknown };
    if (!Array.isArray(parsed.dates)) return null;
    const dates = parsed.dates.filter((date): date is string =>
      typeof date === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date));
    return dates.length ? dates.map(formatMdWithDay).join(", ") : null;
  } catch {
    return null;
  }
}

function WeekContent({
  body,
  text,
  schedule,
  empty,
}: {
  body?: string | null;
  text: string | null;
  schedule: string | null;
  empty: string;
}) {
  const dates = scheduleLabel(schedule);
  return <div className="report-week-content">
    {dates && <span className="report-schedule"><CalendarDays />{dates}</span>}
    {text?.trim() ? <RichBody body={body ?? null} fallback={text} /> : <p className="report-empty-copy">{empty}</p>}
  </div>;
}

function renderRichNode(node: JSONContent, key: number): ReactNode {
  if (node.type === "text") {
    let content: ReactNode = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") content = <strong>{content}</strong>;
      if (mark.type === "textStyle" && typeof mark.attrs?.color === "string") {
        const color = ["#18181b", "#dc2626", "#2563eb"].includes(mark.attrs.color)
          ? mark.attrs.color : "#18181b";
        content = <span style={{ color }}>{content}</span>;
      }
    }
    return <span key={key}>{content}</span>;
  }
  if (node.type === "image") {
    const src = typeof node.attrs?.src === "string" && node.attrs.src.startsWith("/api/files/")
      ? node.attrs.src : null;
    return src ? <img key={key} src={src} alt={String(node.attrs?.alt ?? "첨부 이미지")} /> : null;
  }
  const children = node.content?.map(renderRichNode);
  if (node.type === "paragraph") return <p key={key}>{children}</p>;
  if (node.type === "bulletList") return <ul key={key}>{children}</ul>;
  if (node.type === "orderedList") return <ol key={key}>{children}</ol>;
  if (node.type === "listItem") return <li key={key}>{children}</li>;
  if (node.type === "hardBreak") return <br key={key} />;
  return <span key={key}>{children}</span>;
}

function RichBody({ body, fallback }: { body: string | null; fallback: string }) {
  if (!body) return <p>{fallback}</p>;
  try {
    const json = JSON.parse(body) as JSONContent;
    return <div className="report-rich-view">{json.content?.map(renderRichNode)}</div>;
  } catch {
    return <p>{fallback}</p>;
  }
}

function ResultPicker({
  result,
  editable = false,
  onChange,
}: {
  result: WeeklyEntryResult | null;
  editable?: boolean;
  onChange?: (value: WeeklyEntryResult | null) => void;
}) {
  return <div className="report-result-picker" aria-label="업무 결과">
    {(Object.entries(RESULT) as Array<[WeeklyEntryResult, (typeof RESULT)[WeeklyEntryResult]]>)
      .map(([value, item]) => <button
        key={value}
        type="button"
        className={result === value ? "is-selected result-" + value : ""}
        disabled={!editable}
        aria-pressed={result === value}
        title={item.label}
        onClick={() => onChange?.(result === value ? null : value)}
      >
        <strong>{item.symbol}</strong>
        <span>{item.label}</span>
      </button>)}
  </div>;
}

const DECISION_STATUS: Record<DecisionStatus, { label: string; tone: "warning" | "success" | "danger" }> = {
  pending: { label: "결정 대기", tone: "warning" },
  approved: { label: "승인", tone: "success" },
  rejected: { label: "반려", tone: "danger" },
  held: { label: "보류", tone: "warning" },
};

function DecisionPanel({
  entry,
  canEdit,
  canResolve,
  defaultDesiredDate,
  onChanged,
}: {
  entry: WeeklyReportEntry;
  canEdit: boolean;
  canResolve: boolean;
  defaultDesiredDate: string;
  onChanged: () => void;
}) {
  const decision = entry.decision;
  const [reRequesting, setReRequesting] = useState(false);
  const processed = decision !== null && decision.status !== "pending" && !reRequesting;
  const [enabled, setEnabled] = useState(decision !== null);
  const [content, setContent] = useState(decision?.content ?? "");
  const [desiredDate, setDesiredDate] = useState(decision?.desiredDate ?? defaultDesiredDate);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit && !decision) return null;

  const saveRequest = async (nextEnabled: boolean = enabled) => {
    if (pending) return;
    if (nextEnabled && !content.trim()) {
      setError("결정 요청 내용을 입력하세요.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiRequest("/api/reports/entries/" + entry.id + "/decision", {
        method: "PUT",
        body: JSON.stringify({ enabled: nextEnabled, content, desiredDate: desiredDate || null }),
      });
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "결정 요청을 저장하지 못했습니다.");
      setEnabled(decision !== null);
    } finally {
      setPending(false);
    }
  };

  const resolve = async (status: Exclude<DecisionStatus, "pending">) => {
    if (!decision || pending) return;
    let comment = "";
    if (status === "rejected" || status === "held") {
      comment = window.prompt(status === "rejected" ? "반려 사유를 입력하세요." : "보류 사유를 입력하세요.")?.trim() ?? "";
      if (!comment) return;
    } else if (!window.confirm("이 결정 요청을 승인할까요?")) return;
    setPending(true);
    setError(null);
    try {
      await apiRequest("/api/reports/decisions/" + decision.id + "/resolve", {
        method: "POST", body: JSON.stringify({ status, comment }),
      });
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "결정 요청을 처리하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  return <div className={"report-decision-panel" + (processed ? " is-processed" : "")}>
    <div className="report-decision-head">
      <label>
        <input type="checkbox" checked={enabled} disabled={!canEdit || processed || pending}
          onChange={(event) => {
            const next = event.target.checked;
            if (!next && decision?.status === "pending"
              && !window.confirm("대기 중인 결정 요청을 취소할까요?")) return;
            setEnabled(next);
            if (!next) void saveRequest(false);
          }} />
        임원 결정 필요
      </label>
      {decision && <StatusBadge tone={DECISION_STATUS[decision.status].tone}>
        {DECISION_STATUS[decision.status].label}
      </StatusBadge>}
      {canEdit && decision && decision.status !== "pending" && !reRequesting && <button
        className="report-decision-retry" type="button" onClick={() => {
          setReRequesting(true);
          setDesiredDate(defaultDesiredDate);
        }}>다시 요청</button>}
    </div>
    {enabled && <div className="report-decision-fields">
      <input value={content} maxLength={200} disabled={!canEdit || processed || pending}
        placeholder="임원이 결정해야 할 내용을 한 줄로 입력"
        onChange={(event) => setContent(event.target.value)} />
      <label><span>희망일</span><input type="date" value={desiredDate}
        min={toKstDateString()} disabled={!canEdit || processed || pending}
        onChange={(event) => setDesiredDate(event.target.value)} /></label>
      {canEdit && !processed && <button className="btn btn-outline" type="button" disabled={pending}
        onClick={() => void saveRequest()}>{pending ? "저장 중…" : reRequesting ? "다시 요청" : decision ? "요청 수정" : "결정 요청"}</button>}
      {canResolve && decision?.status === "pending" && <div className="report-decision-actions">
        <button type="button" disabled={pending} onClick={() => void resolve("approved")}>승인</button>
        <button type="button" disabled={pending} onClick={() => void resolve("rejected")}>반려</button>
        <button type="button" disabled={pending} onClick={() => void resolve("held")}>보류</button>
      </div>}
    </div>}
    {decision?.comment && <p className="report-decision-comment">임원 코멘트 · {decision.comment}</p>}
    {error && <p className="report-decision-error">{error}</p>}
  </div>;
}

function parseBody(value: string | null): unknown | null {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function scheduleFromDate(date: string, type: "single" | "deadline"): WeeklyScheduleInput | null {
  return date ? { type, dates: [date] } : null;
}

function parseSchedule(value: string | null, fallback: "single" | "deadline"): WeeklyScheduleInput | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as WeeklyScheduleInput;
    if (["single", "multiple", "range", "deadline"].includes(parsed.type)
      && Array.isArray(parsed.dates)) return parsed;
  } catch {
    // 잘못된 과거 값은 빈 일정으로 편집한다.
  }
  return scheduleFromDate(firstScheduleDate(value), fallback);
}

function firstScheduleDate(value: string | null): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as { dates?: unknown };
    return Array.isArray(parsed.dates) && typeof parsed.dates[0] === "string" ? parsed.dates[0] : "";
  } catch { return ""; }
}

function ScheduleEditor({
  label,
  value,
  kind,
  onChange,
}: {
  label: string;
  value: WeeklyScheduleInput | null;
  kind: "performance" | "due";
  onChange: (value: WeeklyScheduleInput | null) => void;
}) {
  const [candidate, setCandidate] = useState("");
  const type = value?.type ?? (kind === "performance" ? "single" : "deadline");
  const dates = value?.dates ?? [];
  const choices = kind === "performance"
    ? [{ value: "single", label: "단일" }, { value: "multiple", label: "여러 날짜" }, { value: "range", label: "기간" }]
    : [{ value: "deadline", label: "기한(~)" }, { value: "single", label: "단일" }, { value: "range", label: "기간" }];
  const setType = (nextType: WeeklyScheduleInput["type"]) =>
    onChange({ type: nextType, dates: nextType === "range" ? dates.slice(0, 2) : dates.slice(0, 1) });

  return <div className="report-schedule-editor">
    <span>{label}</span>
    <select value={type} onChange={(event) => setType(event.target.value as WeeklyScheduleInput["type"])}>
      {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select>
    {type === "multiple" ? <>
      <input type="date" value={candidate} onChange={(event) => setCandidate(event.target.value)} />
      <button type="button" disabled={!candidate} onClick={() => {
        onChange({ type: "multiple", dates: [...new Set([...dates, candidate])].sort() });
        setCandidate("");
      }}>추가</button>
      <div className="report-schedule-dates">
        {dates.map((date) => <button type="button" key={date} title="날짜 제거"
          onClick={() => {
            const next = dates.filter((item) => item !== date);
            onChange(next.length ? { type: "multiple", dates: next } : null);
          }}>{formatMdWithDay(date)} ×</button>)}
      </div>
    </> : <>
      <input type="date" value={dates[0] ?? ""}
        onChange={(event) => onChange(event.target.value ? { type, dates: [event.target.value, ...dates.slice(1)] } : null)} />
      {type === "range" && <><span>–</span><input type="date" value={dates[1] ?? ""}
        min={dates[0] ?? undefined}
        onChange={(event) => onChange({ type: "range", dates: [dates[0] ?? event.target.value, event.target.value] })} /></>}
    </>}
  </div>;
}

function TitleTools({
  entry,
  report,
  onChanged,
}: {
  entry: WeeklyReportEntry;
  report: WeeklyReportResponse;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<WeeklyTitleHistoryResponse | null>(null);
  const [ownerId, setOwnerId] = useState(entry.ownerId);
  const [detailId, setDetailId] = useState(entry.detailId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = report.permissions.canEditTeam;

  useEffect(() => {
    if (!open || !report.report) return;
    let active = true;
    setHistory(null);
    setError(null);
    apiRequest<WeeklyTitleHistoryResponse>(
      "/api/reports/titles/" + entry.titleId + "/history?reportId=" + report.report.id,
    ).then((result) => { if (active) setHistory(result); })
      .catch((reason) => {
        if (!active) return;
        if (reason instanceof ApiClientError && reason.status === 404) {
          setOpen(false);
          onChanged();
          return;
        }
        setError(reason instanceof Error ? reason.message : "이력을 불러오지 못했습니다.");
      });
    return () => { active = false; };
  }, [entry.titleId, open, report.report]);

  const manage = async (direction?: "up" | "down") => {
    if (!report.report || pending) return;
    setPending(true);
    setError(null);
    try {
      await apiRequest("/api/reports/titles/" + entry.titleId + "/manage", {
        method: "PATCH",
        body: JSON.stringify({ reportId: report.report.id, ownerId, detailId, direction }),
      });
      onChanged();
      if (!direction) setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "타이틀 설정을 저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!report.report || !history?.canDelete || pending
      || !window.confirm("타이틀과 연결된 모든 초안 주차 이력을 삭제할까요? 삭제한 내용은 복구할 수 없습니다.")) return;
    setPending(true);
    try {
      await apiRequest("/api/reports/" + report.report.id + "/titles/" + entry.titleId, { method: "DELETE" });
      setOpen(false);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "타이틀을 삭제하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  return <>
    <button className="btn btn-ghost btn-icon report-tools-button" type="button"
      aria-label={entry.title + " 관리 및 이력"} onClick={() => setOpen(true)}><Ellipsis /></button>
    <SidePanel open={open} title="타이틀 관리 · 진행 이력"
      description={(entry.number === null ? "" : entry.number + ". ") + entry.title}
      onClose={() => setOpen(false)} width="wide">
      {canManage && <section className="title-manage-form">
        <h3>현재 주차부터 변경</h3>
        <div>
          <label><span>담당자</span><select value={ownerId}
            onChange={(event) => setOwnerId(Number(event.target.value))}>
            {report.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select></label>
          <label><span>세부내용</span><select value={detailId}
            onChange={(event) => setDetailId(Number(event.target.value))}>
            {report.details.filter((detail) => detail.isActive).map((detail) =>
              <option key={detail.id} value={detail.id}>{detail.category.name} · {detail.name}</option>)}
          </select></label>
        </div>
        <div className="title-manage-actions">
          <button className="btn btn-outline" type="button" disabled={pending}
            onClick={() => void manage("up")}><ArrowUp /> 위로</button>
          <button className="btn btn-outline" type="button" disabled={pending}
            onClick={() => void manage("down")}><ArrowDown /> 아래로</button>
          <button className="btn btn-primary" type="button" disabled={pending}
            onClick={() => void manage()}>설정 저장</button>
        </div>
      </section>}
      <section className="title-history">
        <h3>주차별 진행 이력</h3>
        {!history && !error ? <p className="title-history-loading">이력을 불러오는 중…</p>
          : error ? <p className="title-history-error">{error}</p>
          : history?.items.map((item) => {
            const week = splitYearWeek(item.yearWeek);
            return <article key={item.id}>
              <header><strong>{week.year}년 {week.week}주차</strong>
                {item.result && <StatusBadge tone={item.result === "done" ? "success"
                  : item.result === "hold" ? "warning" : "neutral"}>{RESULT[item.result].symbol} {RESULT[item.result].label}</StatusBadge>}
              </header>
              <div><span>금주 실적</span><p>{item.thisWeekText || "—"}</p></div>
              <div><span>차주 계획</span><p>{item.nextPlanText || "—"}</p></div>
            </article>;
          })}
      </section>
      {canManage && <div className="title-delete-zone">
        <button className="btn btn-ghost" type="button" disabled={!history?.canDelete || pending}
          title={!history ? "삭제 가능 여부를 확인하는 중입니다."
            : history.canDelete ? "타이틀과 초안 이력 삭제"
            : history.deleteBlockReason ?? "타이틀을 삭제할 수 없습니다."}
          onClick={() => void remove()}><Trash2 /> 타이틀 삭제</button>
      </div>}
    </SidePanel>
  </>;
}

function EntryCard({
  entry,
  reportId,
  yearWeek,
  canEdit,
  canResolveDecision,
  defaultDesiredDate,
  report,
  onChanged,
}: {
  entry: WeeklyReportEntry;
  reportId: number;
  yearWeek: number;
  canEdit: boolean;
  canResolveDecision: boolean;
  defaultDesiredDate: string;
  report: WeeklyReportResponse;
  onChanged: () => void;
}) {
  const isNew = entry.startYearWeek === yearWeek;
  const endsHere = entry.result === "done" || entry.result === "stopped";
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [version, setVersion] = useState(entry.version);
  const [titleValue, setTitleValue] = useState(
    (entry.number === null ? "" : entry.number + ". ") + entry.title,
  );
  const [titleDirty, setTitleDirty] = useState(false);
  const changeCounter = useRef(0);
  const [nextEditorKey, setNextEditorKey] = useState(0);
  const [draft, setDraft] = useState<WeeklyEntryUpdateRequest>({
    version: entry.version,
    thisWeekBody: parseBody(entry.thisWeekBody),
    thisWeekText: entry.thisWeekText,
    performSchedule: parseSchedule(entry.performSchedule, "single"),
    result: entry.result,
    nextPlanBody: parseBody(entry.nextPlanBody),
    nextPlanText: entry.nextPlanText,
    dueSchedule: parseSchedule(entry.dueSchedule, "deadline"),
    hideOnHold: entry.hiddenOnHold,
  });
  const thisWeekEmpty = isNew && !entry.carriedOver
    ? "금주 실적 없음 — 차주계획부터 시작"
    : "등록된 금주 실적이 없습니다.";

  const changeDraft = (change: Partial<WeeklyEntryUpdateRequest>) => {
    changeCounter.current += 1;
    setDraft((current) => ({ ...current, ...change }));
    setDirty(true);
    setSaveState("idle");
  };

  const save = async () => {
    if (!dirty || saving) return true;
    const savedChange = changeCounter.current;
    setSaving(true);
    try {
      const result = await apiRequest<{ version: number; updatedAt: number }>(
        "/api/reports/entries/" + entry.id,
        { method: "PUT", body: JSON.stringify({ ...draft, version }) },
      );
      setVersion(result.version);
      setDraft((current) => ({ ...current, version: result.version }));
      if (changeCounter.current === savedChange) {
        setDirty(false);
        setSaveState("saved");
      } else {
        setSaveState("idle");
      }
      return true;
    } catch (reason) {
      setSaveState("error");
      if (reason instanceof ApiClientError && reason.status === 409) {
        const separator = String.fromCharCode(10, 10);
        if (window.confirm(reason.message + separator + "최신 보고서를 다시 불러올까요?")) onChanged();
        return false;
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!editing || !dirty || saving) return;
    const timer = window.setTimeout(() => { void save(); }, 2_000);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, editing, saving]);

  useEffect(() => {
    const saveNow = () => { if (editing && dirty && !saving) void save(); };
    window.addEventListener("metawork:save-report", saveNow);
    return () => window.removeEventListener("metawork:save-report", saveNow);
  }, [draft, dirty, editing, saving, version]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty && !titleDirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, titleDirty]);

  const saveTitle = async () => {
    if (!titleDirty) return true;
    try {
      await apiRequest("/api/reports/titles/" + entry.titleId, {
        method: "PATCH",
        body: JSON.stringify({ reportId, title: titleValue }),
      });
      setTitleDirty(false);
      return true;
    } catch (reason) {
      setSaveState("error");
      if (reason instanceof Error) window.alert(reason.message);
      return false;
    }
  };

  const closeEditor = async () => {
    if (!await saveTitle()) return;
    if (dirty && !await save()) return;
    setEditing(false);
    onChanged();
  };

  const copyThisWeek = () => {
    if (draft.nextPlanText?.trim() && !window.confirm("차주계획을 금주실적 내용으로 바꿀까요?")) return;
    changeDraft({ nextPlanBody: draft.thisWeekBody, nextPlanText: draft.thisWeekText });
    setNextEditorKey((current) => current + 1);
  };

  const draftEndsHere = draft.result === "done" || draft.result === "stopped";
  const newWithoutPerformance = isNew && !draft.thisWeekText?.trim();

  return <article className={"report-entry-card" + (editing ? " is-editing" : "")}>
    <header className="report-entry-heading">
      <div className="report-entry-title">
        {editing ? <input className="report-title-edit-input" value={titleValue} maxLength={100}
          aria-label="번호와 타이틀"
          onChange={(event) => { setTitleValue(event.target.value); setTitleDirty(true); }} /> : <>
          {entry.number !== null && <span className="report-entry-number">{entry.number}</span>}
          <h4>{entry.title}</h4>
        </>}
      </div>
      <div className="report-entry-meta">
        <StatusBadge>{entry.ownerName}</StatusBadge>
        {isNew && <StatusBadge tone="info">신규</StatusBadge>}
        {entry.carriedOver && <StatusBadge tone="neutral">이월</StatusBadge>}
        {entry.decisionRequired && <StatusBadge tone="warning">결정 필요</StatusBadge>}
        {entry.result && !editing && <StatusBadge tone={entry.result === "done" ? "success"
          : entry.result === "hold" ? "warning" : "neutral"}>
          {RESULT[entry.result].symbol} {RESULT[entry.result].label}
        </StatusBadge>}
        {draftEndsHere && <StatusBadge tone="success">이번 주 종료</StatusBadge>}
        {editing && <span className={"report-save-state is-" + saveState}>
          {saving ? <><LoaderCircle className="is-spinning" /> 저장 중</>
            : saveState === "saved" ? <><Check /> 저장됨</>
            : saveState === "error" ? "저장 실패" : dirty ? "수정 중" : "편집 중"}
        </span>}
        {canEdit && !editing && <button className="btn btn-ghost report-edit-button" type="button"
          onClick={() => setEditing(true)}><Pencil /> 편집</button>}
        {editing && <button className="btn btn-outline report-edit-button" type="button"
          onClick={() => void closeEditor()}><X /> 닫기</button>}
        <TitleTools entry={entry} report={report} onChanged={onChanged} />
      </div>
    </header>

    <DecisionPanel entry={entry} canEdit={canEdit} canResolve={canResolveDecision}
      defaultDesiredDate={defaultDesiredDate} onChanged={onChanged} />

    <div className="report-entry-grid">
      <section>
        <h5>금주 실적</h5>
        {editing ? <>
          <RichTextEditor value={entry.thisWeekBody} fallbackText={entry.thisWeekText} entryId={entry.id}
            placeholder={thisWeekEmpty}
            onChange={(value) => changeDraft({ thisWeekBody: value.json, thisWeekText: value.text })} />
          <ScheduleEditor label="수행일" value={draft.performSchedule} kind="performance"
            onChange={(performSchedule) => changeDraft({ performSchedule })} />
        </> : <WeekContent body={entry.thisWeekBody} text={entry.thisWeekText}
          schedule={entry.performSchedule} empty={thisWeekEmpty} />}
      </section>
      <section className="report-result-column">
        <h5>결과</h5>
        <ResultPicker result={editing ? draft.result : entry.result}
          editable={editing && !newWithoutPerformance}
          onChange={(result) => changeDraft({
            result,
            hideOnHold: result === "hold" ? draft.hideOnHold : false,
          })} />
        {editing && newWithoutPerformance && <small className="report-result-hint">금주실적 작성 후 선택</small>}
        {(editing ? draft.result : entry.result) === "hold" && (editing ? <label className="report-hold-hide">
          <input type="checkbox" checked={draft.hideOnHold}
            onChange={(event) => changeDraft({ hideOnHold: event.target.checked })} />
          <span><strong>다음 주부터 숨기기</strong></span>
        </label> : entry.hiddenOnHold && <div className="report-hold-hidden-badge"><EyeOff />다음 주부터 숨김</div>)}
      </section>
      <section>
        <h5>차주 계획</h5>
        {editing && !draftEndsHere ? <>
          <button className="report-copy-button" type="button" onClick={copyThisWeek}>
            <Copy /> 금주 내용 복사
          </button>
          <RichTextEditor key={nextEditorKey}
            entryId={entry.id}
            value={draft.nextPlanBody ? JSON.stringify(draft.nextPlanBody) : null}
            fallbackText={draft.nextPlanText} placeholder="차주계획을 입력하세요."
            onChange={(value) => changeDraft({ nextPlanBody: value.json, nextPlanText: value.text })} />
          <ScheduleEditor label="목표 기한" value={draft.dueSchedule} kind="due"
            onChange={(dueSchedule) => changeDraft({ dueSchedule })} />
        </> : (editing ? draftEndsHere : endsHere)
          ? <p className="report-closed-copy">{RESULT[(editing ? draft.result : entry.result)!].label}된 타이틀 — 다음 주 보고서에서 제외됩니다.</p>
          : <WeekContent body={entry.nextPlanBody} text={entry.nextPlanText} schedule={entry.dueSchedule}
              empty="등록된 차주 계획이 없습니다." />}
      </section>
    </div>
  </article>;
}

function TitleComposer({
  report,
  detailId,
  currentUserId,
  onCancel,
  onCreated,
}: {
  report: WeeklyReportResponse;
  detailId: number;
  currentUserId?: number;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const defaultOwner = report.permissions.canEditTeam ? report.members[0]?.id : currentUserId;
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(defaultOwner ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!report.report || !title.trim() || !ownerId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiRequest<{ duplicateWarning: boolean }>(
        "/api/reports/" + report.report.id + "/titles",
        { method: "POST", body: JSON.stringify({ detailId, ownerId, title }) },
      );
      if (result.duplicateWarning) window.alert("같은 세부내용에 동일한 타이틀명이 있습니다.");
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "타이틀을 추가하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="report-title-composer">
    <StatusBadge tone="info">신규</StatusBadge>
    <input autoFocus value={title} maxLength={100}
      placeholder="번호와 타이틀 (예: 13. 타이틀명)"
      onChange={(event) => setTitle(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter") void create(); if (event.key === "Escape") onCancel(); }} />
    {report.permissions.canEditTeam ? <select value={ownerId}
      onChange={(event) => setOwnerId(Number(event.target.value))} aria-label="담당자">
      {report.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
    </select> : <span className="report-composer-owner">
      {report.members.find((member) => member.id === currentUserId)?.name ?? "본인"}
    </span>}
    <button className="btn btn-primary" type="button" disabled={!title.trim() || saving}
      onClick={() => void create()}>{saving ? "추가 중…" : "추가"}</button>
    <button className="btn btn-ghost btn-icon" type="button" aria-label="추가 취소" onClick={onCancel}><X /></button>
    {error && <p>{error}</p>}
  </div>;
}

function attendancePeriod(item: WeeklyAttendance, start: string, end: string): string | null {
  const clipped = clipDateRange(item.startDate, item.endDate, start, end);
  if (!clipped) return null;
  return clipped.startDate === clipped.endDate
    ? formatMdWithDay(clipped.startDate)
    : formatMdWithDay(clipped.startDate) + " – " + formatMdWithDay(clipped.endDate);
}

function AttendanceForm({
  report,
  currentUserId,
  item,
  onClose,
  onChanged,
}: {
  report: WeeklyReportResponse;
  currentUserId?: number;
  item: WeeklyAttendance | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const defaultEmployeeId = report.permissions.canEditTeam ? report.members[0]?.id : currentUserId;
  const [form, setForm] = useState<AttendanceWriteRequest>({
    employeeId: item?.employeeId ?? defaultEmployeeId ?? 0,
    type: item?.type ?? "leave",
    startDate: item?.startDate ?? report.week.monday,
    endDate: item?.endDate ?? report.week.monday,
    note: item?.note ?? "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = <K extends keyof AttendanceWriteRequest>(key: K, value: AttendanceWriteRequest[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!report.report || pending) return;
    if (!form.employeeId || !form.startDate || !form.endDate || form.endDate < form.startDate) {
      setError("사원과 올바른 일정을 입력하세요.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await apiRequest<{ overlapWarning: boolean }>(
        "/api/reports/" + report.report.id + "/attendance" + (item ? "/" + item.id : ""),
        { method: item ? "PATCH" : "POST", body: JSON.stringify(form) },
      );
      if (result.overlapWarning) window.alert("같은 사원의 일정과 겹치는 출장·휴가가 있습니다.");
      onChanged();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "출장·휴가를 저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!report.report || !item || pending || !window.confirm("이 출장·휴가 기록을 삭제할까요?")) return;
    setPending(true);
    try {
      await apiRequest("/api/reports/" + report.report.id + "/attendance/" + item.id, { method: "DELETE" });
      onChanged();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "기록을 삭제하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  return <div className="attendance-form">
    <label><span>사원</span>{report.permissions.canEditTeam ? <select value={form.employeeId}
      onChange={(event) => update("employeeId", Number(event.target.value))}>
      {report.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
    </select> : <input value={report.members.find((member) => member.id === currentUserId)?.name ?? "본인"} disabled />}</label>
    <label><span>유형</span><select value={form.type}
      onChange={(event) => update("type", event.target.value as "trip" | "leave")}>
      <option value="leave">휴가</option><option value="trip">출장</option>
    </select></label>
    <div className="attendance-date-row">
      <label><span>시작일</span><input type="date" value={form.startDate}
        onChange={(event) => update("startDate", event.target.value)} /></label>
      <label><span>종료일</span><input type="date" min={form.startDate} value={form.endDate}
        onChange={(event) => update("endDate", event.target.value)} /></label>
    </div>
    <label><span>내용</span><input value={form.note} maxLength={100}
      placeholder={form.type === "leave" ? "연차, 반차 등" : "출장지 · 목적"}
      onChange={(event) => update("note", event.target.value)} /></label>
    {error && <p className="attendance-form-error">{error}</p>}
    <div className="attendance-form-actions">
      {item && <button className="btn btn-ghost attendance-delete" type="button"
        disabled={pending} onClick={() => void remove()}>삭제</button>}
      <button className="btn btn-outline" type="button" disabled={pending} onClick={onClose}>취소</button>
      <button className="btn btn-primary" type="button" disabled={pending}
        onClick={() => void save()}>{pending ? "저장 중…" : "저장"}</button>
    </div>
  </div>;
}

function AttendanceSection({
  report,
  currentUserId,
  onChanged,
}: {
  report: WeeklyReportResponse;
  currentUserId?: number;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<WeeklyAttendance | "new" | null>(null);
  const columns = [
    { title: "금주", start: report.week.monday, end: report.week.friday },
    { title: "차주", start: report.week.nextMonday, end: report.week.nextFriday },
  ];
  const canAdd = report.permissions.canEditOwn || report.permissions.canEditTeam;

  return <section className="attendance-block">
    <header className="report-detail-heading">
      <div><StatusBadge tone="neutral">출장 및 휴가</StatusBadge><h3>근태 등록 내용</h3>
        <span>{report.attendances.length}건</span></div>
      <button className="btn btn-ghost report-add-title" type="button" disabled={!canAdd}
        onClick={() => setSelected("new")}><Plus /> 출장·휴가 등록</button>
    </header>
    <div className="attendance-columns">
      {columns.map((column) => {
        const items = report.attendances.flatMap((item) => {
          const period = attendancePeriod(item, column.start, column.end);
          return period ? [{ item, period }] : [];
        });
        return <div key={column.title} className="attendance-column">
          <h4>{column.title} · {formatMdWithDay(column.start)}–{formatMdWithDay(column.end)}</h4>
          {items.length ? items.map(({ item, period }) => <button type="button" key={item.id}
            className="attendance-item" disabled={!item.canEdit} onClick={() => setSelected(item)}>
            <span className={"attendance-type is-" + item.type}>
              {item.type === "trip" ? <Plane /> : <Umbrella />}{item.type === "trip" ? "출장" : "휴가"}
            </span>
            <strong>{item.employeeName}</strong><span>{period}</span>{item.note && <em>{item.note}</em>}
          </button>) : <p>등록된 일정이 없습니다.</p>}
        </div>;
      })}
    </div>
    <Modal open={selected !== null} title={selected === "new" ? "출장·휴가 등록" : "출장·휴가 수정"}
      description="기간이 주 경계를 넘으면 금주와 차주에 나누어 표시됩니다."
      onClose={() => setSelected(null)}>
      {selected !== null && <AttendanceForm key={selected === "new" ? "new" : selected.id}
        report={report} currentUserId={currentUserId} item={selected === "new" ? null : selected}
        onClose={() => setSelected(null)} onChanged={onChanged} />}
    </Modal>
  </section>;
}

export function ReportBoard({
  report,
  currentUserId,
  onChanged,
}: {
  report: WeeklyReportResponse;
  currentUserId?: number;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [query, setQuery] = useState("");
  const [addingDetailId, setAddingDetailId] = useState<number | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [resumingTitleId, setResumingTitleId] = useState<number | null>(null);
  const [mobileWeek, setMobileWeek] = useState<"this" | "next">("this");
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");

  const groups = useMemo(() => report.details.map((detail) => ({
    ...detail,
    entries: detail.entries.filter((entry) => {
      if (filter === "mine" && entry.ownerId !== currentUserId) return false;
      if (filter === "decision" && !entry.decisionRequired) return false;
      if (!normalizedQuery) return true;
      return entry.title.toLocaleLowerCase("ko-KR").includes(normalizedQuery)
        || (entry.number !== null && String(entry.number).includes(normalizedQuery));
    }),
  })).filter((detail) => filter === "all" && !normalizedQuery ? true : detail.entries.length > 0),
  [currentUserId, filter, normalizedQuery, report.details]);

  const visibleCount = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const showEmpty = groups.length === 0 || (visibleCount === 0 && (filter !== "all" || normalizedQuery));

  const resumeHiddenHold = async (titleId: number) => {
    if (!report.report || resumingTitleId !== null) return;
    setResumingTitleId(titleId);
    try {
      await apiRequest(`/api/reports/${report.report.id}/hidden-holds/${titleId}/resume`, { method: "POST" });
      setHiddenOpen(false);
      onChanged();
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : "보류 업무를 재개하지 못했습니다.");
    } finally {
      setResumingTitleId(null);
    }
  };

  return <section className={"report-board mobile-show-" + mobileWeek}>
    <div className="report-board-toolbar card">
      <div className="report-mobile-tabs">
        <SegmentedControl label="모바일 보고 주차" value={mobileWeek}
          onChange={(value) => setMobileWeek(value as "this" | "next")}
          options={[{ value: "this", label: "금주 실적" }, { value: "next", label: "차주 계획" }]} />
      </div>
      <SegmentedControl
        label="타이틀 표시 범위"
        value={filter}
        onChange={(value) => setFilter(value as BoardFilter)}
        options={[
          { value: "all", label: "전체" },
          { value: "mine", label: "내 타이틀" },
          { value: "decision", label: "결정 필요" },
        ]}
        size="small"
      />
      <label className="report-search">
        <Search aria-hidden="true" />
        <span className="sr-only">타이틀 검색</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="번호 또는 타이틀 검색" />
      </label>
      {report.hiddenHolds.length > 0 && <button className="btn btn-outline report-hidden-holds-button"
        type="button" onClick={() => setHiddenOpen(true)}>
        <EyeOff /> 숨긴 보류 업무 {report.hiddenHolds.length}건
      </button>}
      <div className="report-result-legend" aria-label="결과 기호 안내">
        {Object.values(RESULT).map((item) => <span key={item.label}><b>{item.symbol}</b>{item.label}</span>)}
      </div>
    </div>

    {showEmpty ? <EmptyState compact title="조건에 맞는 타이틀이 없습니다."
      description="필터나 검색어를 바꾸어 다시 확인해 주세요." />
    : groups.map((group, index) => {
      const firstOfCategory = index === 0 || groups[index - 1].category.id !== group.category.id;
      return <div className="report-detail-block" key={group.id}>
        {firstOfCategory && <h2 className="report-category-title">{group.category.name}</h2>}
        <header className="report-detail-heading">
          <div>
            <StatusBadge tone={group.category.code === "KPI" ? "dark" : "neutral"}
              className={group.category.code === "GENERAL" ? "report-category-general" : ""}>
              {group.category.name}
            </StatusBadge>
            <h3>{group.name}</h3>
            <span>{group.entries.length}건</span>
          </div>
          <button className="btn btn-ghost report-add-title" type="button"
            disabled={report.permissions.readOnly || !group.isActive}
            onClick={() => setAddingDetailId(group.id)}>
            <Plus /> 타이틀 추가
          </button>
        </header>
        <div className="report-entry-list">
          {addingDetailId === group.id && <TitleComposer report={report} detailId={group.id}
            currentUserId={currentUserId} onCancel={() => setAddingDetailId(null)}
            onCreated={() => { setAddingDetailId(null); onChanged(); }} />}
          {group.entries.length
            ? group.entries.map((entry) => <EntryCard key={entry.id} entry={entry}
                reportId={report.report!.id} yearWeek={report.yearWeek}
                canEdit={report.permissions.canEditTeam
                  || (report.permissions.canEditOwn && entry.ownerId === currentUserId)}
                canResolveDecision={report.permissions.canResolveDecisions}
                defaultDesiredDate={report.week.friday}
                report={report}
                onChanged={onChanged} />)
            : <p className="report-detail-empty">등록된 타이틀이 없습니다.</p>}
        </div>
      </div>;
    })}
    <AttendanceSection report={report} currentUserId={currentUserId} onChanged={onChanged} />
    <Modal open={hiddenOpen} title="숨긴 보류 업무"
      description="재개하면 기존 이력을 유지한 채 금주 업무에 다시 표시됩니다."
      onClose={() => setHiddenOpen(false)}>
      <div className="report-hidden-holds-list">
        {report.hiddenHolds.map((item) => {
          const held = splitYearWeek(item.heldYearWeek);
          return <article key={item.titleId}>
            <div><strong>{item.number !== null ? `${item.number}. ` : ""}{item.title}</strong>
              <span>{item.ownerName} · {held.year}년 {held.week}주차 보류</span>
              {item.nextPlanText && <p>{item.nextPlanText}</p>}</div>
            <button className="btn btn-primary" type="button" disabled={!item.canResume || resumingTitleId !== null}
              title={item.canResume ? "금주 업무로 재개" : "담당자 또는 팀장만 재개할 수 있습니다."}
              onClick={() => void resumeHiddenHold(item.titleId)}>
              {resumingTitleId === item.titleId ? <LoaderCircle className="is-spinning" /> : <RotateCcw />}
              금주 업무로 재개
            </button>
          </article>;
        })}
      </div>
    </Modal>
  </section>;
}
