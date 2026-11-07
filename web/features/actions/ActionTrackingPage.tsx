import { Fragment, useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, FileText, ListChecks, LoaderCircle, Paperclip, Search, Send, X } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import type { ActionProgressStatus, ActionStatus, ActionTrackingDetailResponse, ActionTrackingItem, ActionTrackingResponse } from "@shared/types";
import { addDays, toKstDateString } from "@shared/week";
import { DataTable, EmptyState, StatusBadge, SummaryCard } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { apiRequest } from "@/lib/api";

type Period = "4" | "8" | "12" | "all" | "custom";

const STATUS_LABEL: Record<ActionStatus, string> = {
  unregistered: "진행 미등록",
  in_progress: "진행중",
  hold: "보류",
  done: "완료",
};

function statusTone(status: ActionStatus) {
  if (status === "unregistered") return "danger" as const;
  if (status === "in_progress") return "info" as const;
  if (status === "hold") return "warning" as const;
  return "success" as const;
}

function dotted(date: string | null) {
  return date ? date.replaceAll("-", ".") : "–";
}

function shortDate(date: string | null) {
  return date ? date.slice(5).replace("-", "/") : "–";
}

function elapsedDays(date: string) {
  const start = Date.parse(date + "T00:00:00Z");
  const today = Date.parse(toKstDateString() + "T00:00:00Z");
  return Math.max(0, Math.floor((today - start) / 86_400_000));
}

function meetingRange(period: Period, customFrom: string, customTo: string) {
  if (period === "all") return { from: "", to: "" };
  if (period === "custom") return { from: customFrom, to: customTo };
  const today = toKstDateString();
  return { from: addDays(today, -Number(period) * 7), to: today };
}

export function ActionTrackingPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [departmentId, setDepartmentId] = useState(searchParams.get("departmentId") ?? String(user?.department?.id ?? ""));
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [period, setPeriod] = useState<Period>((searchParams.get("period") as Period) || "4");
  const [customFrom, setCustomFrom] = useState(searchParams.get("from") ?? "");
  const [customTo, setCustomTo] = useState(searchParams.get("to") ?? "");
  const [hideCompleted, setHideCompleted] = useState(searchParams.get("hideCompleted") === "true");
  const [data, setData] = useState<ActionTrackingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(() => {
    const value = Number(searchParams.get("actionId"));
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const [refreshKey, setRefreshKey] = useState(0);

  const range = useMemo(() => meetingRange(period, customFrom, customTo), [customFrom, customTo, period]);
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (departmentId) params.set("departmentId", departmentId);
    if (status) params.set("status", status);
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    if (hideCompleted) params.set("hideCompleted", "true");
    return params;
  }, [departmentId, hideCompleted, range.from, range.to, status]);

  useEffect(() => {
    const url = new URLSearchParams(query);
    url.set("period", period);
    if (period === "custom") {
      if (customFrom) url.set("from", customFrom);
      if (customTo) url.set("to", customTo);
    }
    if (expandedId) url.set("actionId", String(expandedId));
    setSearchParams(url, { replace: true });
  }, [customFrom, customTo, expandedId, period, query, setSearchParams]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiRequest<ActionTrackingResponse>("/api/actions/tracking?" + query)
      .then((next) => { if (active) setData(next); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "액션 목록을 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, refreshKey]);

  const scopeLabel = departmentId
    ? data?.departments.find((department) => String(department.id) === departmentId)?.name ?? "선택 부서"
    : "전체 부서";
  const rangeLabel = period === "all" ? "전체 기간" : period === "custom"
    ? `${customFrom || "시작일"} ~ ${customTo || "종료일"}` : `최근 ${period}주`;

  return <main className="workspace-page tracking-page">
    <header className="workspace-heading">
      <div><h1>액션트래킹</h1><p>배정된 지시사항의 진행여부와 완료 현황을 부서별로 확인합니다.</p></div>
      <span className="tracking-result-count"><Search /> {loading ? "조회 중" : `${data?.items.length ?? 0}건`}</span>
    </header>

    {error && <div className="action-message is-error">{error}<button type="button" onClick={() => setError(null)}>닫기</button></div>}

    <section className="tracking-summary-grid" aria-label="액션 현황 요약">
      <button type="button" className="tracking-summary-button" onClick={() => setStatus("")}>
        <SummaryCard label="전체 지시사항" value={data?.summary.total ?? 0} description={`${scopeLabel} · ${rangeLabel}`} icon={<ListChecks />} />
      </button>
      <button type="button" className="tracking-summary-button" onClick={() => setStatus("unregistered")}>
        <SummaryCard label="진행 미등록" value={data?.summary.unregistered ?? 0} description="부서의 진행여부 등록 필요" tone="danger" icon={<CircleAlert />} />
      </button>
      <button type="button" className="tracking-summary-button" onClick={() => setStatus(status === "in_progress" ? "hold" : "in_progress")}>
        <SummaryCard label="진행중 · 보류" value={`${data?.summary.inProgress ?? 0} · ${data?.summary.hold ?? 0}`} description={`최근 진행 등록 ${shortDate(data?.summary.latestProgressDate ?? null)}`} icon={<Activity />} />
      </button>
      <button type="button" className="tracking-summary-button" onClick={() => setStatus("done")}>
        <SummaryCard label="완료" value={data?.summary.done ?? 0} description="완료일 + 완료 체크" icon={<CheckCircle2 />} />
      </button>
    </section>

    <section className="card tracking-filter-card">
      <div className="tracking-department-tabs" role="tablist" aria-label="부서 선택">
        <button type="button" className={!departmentId ? "is-active" : ""} onClick={() => setDepartmentId("")}>전체 부서</button>
        {data?.departments.map((department) => <button type="button" key={department.id}
          className={departmentId === String(department.id) ? "is-active" : ""}
          onClick={() => setDepartmentId(String(department.id))}>
          {department.name}{user?.department?.id === department.id ? " · 내 부서" : ""}
        </button>)}
      </div>
      <div className="tracking-filters">
        <label><span>진행여부</span><select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">전체</option><option value="unregistered">진행 미등록</option><option value="in_progress">진행중</option><option value="hold">보류</option><option value="done">완료</option>
        </select></label>
        <label><span>회의일자</span><select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
          <option value="4">최근 4주</option><option value="8">최근 8주</option><option value="12">최근 12주</option><option value="all">전체</option><option value="custom">기간 지정</option>
        </select></label>
        {period === "custom" && <><label><span>시작일</span><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label><label><span>종료일</span><input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label></>}
        <label className="tracking-hide-completed"><input type="checkbox" checked={hideCompleted} onChange={(event) => setHideCompleted(event.target.checked)} /><span>완료 항목 숨기기</span></label>
      </div>
    </section>

    <section className="card tracking-list-card">
      {loading && !data ? <div className="tracking-loading"><LoaderCircle className="spin" /> 액션을 불러오는 중입니다.</div>
      : !data?.items.length ? <EmptyState title="조건에 맞는 액션아이템이 없습니다." description="부서 또는 기간 필터를 변경해 보세요." />
      : <DataTable caption="액션트래킹 목록" minWidth={1180} headers={<tr><th>회의</th><th>부서</th><th>주제</th><th>주요 이슈 및 요청 사항</th><th>진행여부</th><th>진행내용(최근)</th><th>완료일</th><th>완료</th></tr>}>
        {data.items.map((item) => <TrackingRow key={item.id} item={item} expanded={expandedId === item.id}
          onToggle={() => setExpandedId((current) => current === item.id ? null : item.id)}
          onSaved={() => setRefreshKey((value) => value + 1)} />)}
      </DataTable>}
      <p className="tracking-legend">진행여부: 진행 미등록 → 진행중 · 보류 · 완료 · 진행내용은 등록할 때마다 이력으로 누적 · 완료 = 완료일 + 완료 체크</p>
    </section>
  </main>;
}

function TrackingRow({ item, expanded, onToggle, onSaved }: {
  item: ActionTrackingItem;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const elapsed = elapsedDays(item.meetingDate);
  const overdue = item.status !== "done" && elapsed >= 14;
  return <Fragment><tr className={(item.status === "done" ? "tracking-row is-done" : "tracking-row") + (expanded ? " is-expanded" : "")} onClick={onToggle}>
    <td><div className="tracking-meeting-with-toggle"><button type="button" className="tracking-expand-button" onClick={(event) => { event.stopPropagation(); onToggle(); }} aria-label={expanded ? "상세 닫기" : "상세 열기"}>{expanded ? <ChevronDown /> : <ChevronRight />}</button><div className="tracking-meeting-cell">{item.meetingId ? <Link onClick={(event) => event.stopPropagation()} to={`/meetings/${item.meetingId}`}>{item.meetingTypeName}</Link> : <strong>{item.meetingTypeName}</strong>}<span>{dotted(item.meetingDate)}</span>{overdue && <em>D+{elapsed}</em>}</div></div></td>
    <td><span className="tracking-department-badge">{item.departmentName}</span></td>
    <td className="tracking-subject"><strong>{item.subject}</strong><small>{item.displayNo}</small></td>
    <td className="tracking-request">{item.request}</td>
    <td><StatusBadge tone={statusTone(item.status)}>{STATUS_LABEL[item.status]}</StatusBadge></td>
    <td>{item.latestProgressText ? <div className="tracking-latest"><span>{shortDate(item.latestProgressDate)}</span><p>{item.latestProgressText}</p></div> : <span className="tracking-empty-progress">아직 등록 없음</span>}</td>
    <td>{dotted(item.completedDate)}</td>
    <td><input type="checkbox" checked={item.isCompleted} disabled aria-label={`${item.displayNo} 완료 여부`} readOnly /></td>
  </tr>{expanded && <tr className="tracking-detail-row"><td colSpan={8}><ProgressDetail item={item} onSaved={onSaved} /></td></tr>}</Fragment>;
}

const PROGRESS_LABEL: Record<ActionProgressStatus, string> = {
  in_progress: "진행중",
  hold: "보류",
  done: "완료",
  reopened: "완료 취소",
};

function progressTone(status: ActionProgressStatus) {
  if (status === "done") return "success" as const;
  if (status === "hold") return "warning" as const;
  return "info" as const;
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function ProgressDetail({ item, onSaved }: { item: ActionTrackingItem; onSaved: () => void }) {
  const [detail, setDetail] = useState<ActionTrackingDetailResponse | null>(null);
  const [dueDate, setDueDate] = useState(toKstDateString());
  const [progressStatus, setProgressStatus] = useState<"in_progress" | "hold" | "done">(
    item.status === "hold" || item.status === "done" ? item.status : "in_progress",
  );
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setDetail(await apiRequest<ActionTrackingDetailResponse>(`/api/actions/tracking/${item.id}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "진행 이력을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [item.id]);

  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    const next = [...files, ...Array.from(selected)];
    const oversized = next.find((file) => file.size > 20 * 1024 * 1024);
    if (oversized) { setError(`${oversized.name}: 파일은 20MB 이하만 첨부할 수 있습니다.`); return; }
    setFiles(next);
  };

  const submit = async () => {
    if (!content.trim()) { setError("진행내용을 입력하세요."); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await apiRequest<{ id: number }>(`/api/actions/tracking/${item.id}/progress`, {
        method: "POST",
        body: JSON.stringify({ dueDate, status: progressStatus, content }),
      });
      const failedFiles: string[] = [];
      for (const file of files) {
        const form = new FormData();
        form.append("progressId", String(created.id));
        form.append("file", file);
        try {
          await apiRequest("/api/files/progress-attachments", { method: "POST", body: form });
        } catch {
          failedFiles.push(file.name);
        }
      }
      setContent("");
      setFiles([]);
      setDueDate(toKstDateString());
      await load();
      onSaved();
      if (failedFiles.length) setError(`진행내용은 등록했지만 다음 첨부파일은 업로드하지 못했습니다: ${failedFiles.join(", ")}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "진행내용을 등록하지 못했습니다."); }
    finally { setSaving(false); }
  };

  if (loading && !detail) return <div className="tracking-detail-loading"><LoaderCircle className="spin" /> 진행 이력을 불러오는 중입니다.</div>;

  return <div className="tracking-detail-panel">
    <section className="tracking-history">
      <header><div><h3>진행 이력 <span>{detail?.history.length ?? 0}</span></h3><p>등록할 때마다 최신순으로 누적됩니다.</p></div></header>
      {!detail?.history.length ? <div className="tracking-no-history">아직 등록된 진행 내용이 없습니다.</div>
      : <div className="tracking-timeline">{detail.history.map((history, index) => <article key={history.id} className={index === 0 ? "is-latest" : ""}>
        <span className="tracking-timeline-dot" />
        <div className="tracking-history-content"><header><div><strong>진행 {dotted(history.progressDate)}</strong><StatusBadge tone={progressTone(history.status)}>{PROGRESS_LABEL[history.status]}</StatusBadge></div><small>{history.authorName}</small></header>
          <small className="tracking-history-due">기한 {dotted(history.dueDate)}</small>
          <p>{history.content}</p>
          {history.attachments.length > 0 && <div className="tracking-history-files">{history.attachments.map((file) => <a key={file.id} href={file.url}><FileText /> <span>{file.fileName}</span><small>{fileSize(file.size)}</small></a>)}</div>}
        </div>
      </article>)}</div>}
    </section>
    {detail?.canUpdate ? <section className="tracking-progress-form">
      <header><h3>진행 등록</h3><p>현재 진행 상황과 업무 일정을 기록하세요.</p></header>
      {error && <div className="tracking-form-error">{error}</div>}
      <div className="tracking-progress-fields">
        <label><span>기한 *</span><input type="date" min={item.meetingDate} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
        <fieldset><legend>진행여부 *</legend><div className="tracking-status-picker">
          {(["in_progress", "hold", "done"] as const).map((value) => <button key={value} type="button" className={progressStatus === value ? "is-active" : ""} onClick={() => setProgressStatus(value)}>{PROGRESS_LABEL[value]}</button>)}
        </div></fieldset>
        <label className="tracking-progress-content"><span>진행내용 *</span><textarea maxLength={2000} value={content} placeholder="이번 진행 상황과 다음 일정을 입력하세요." onChange={(event) => setContent(event.target.value)} /><small>{content.length}/2,000</small></label>
        <div className="tracking-selected-files">{files.map((file, index) => <span key={`${file.name}-${index}`}><Paperclip /> {file.name}<button type="button" onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}><X /></button></span>)}</div>
        <div className="tracking-progress-actions"><label className="btn btn-outline"><Paperclip /> 파일 첨부<input type="file" multiple onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} /></label><button className="btn btn-primary" type="button" disabled={saving} onClick={() => void submit()}>{saving ? <LoaderCircle className="spin" /> : <Send />} 등록</button></div>
        <p className="tracking-progress-date-help">진행일은 등록하는 오늘 날짜로 자동 기록됩니다.</p>
        {progressStatus === "done" && <p className="tracking-complete-help">완료를 선택하면 완료일이 오늘 날짜로 채워지고 완료 체크됩니다.</p>}
      </div>
    </section> : <section className="tracking-readonly-detail"><strong>열람 전용</strong><p>담당 부서 구성원만 진행내용을 등록할 수 있습니다.</p></section>}
  </div>;
}
