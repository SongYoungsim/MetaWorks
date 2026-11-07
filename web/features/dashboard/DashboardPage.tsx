import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, Check, CircleAlert, Clipboard, FileText, Gauge, LoaderCircle, RefreshCw, Sparkles, Timer, X } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { ActionStatus, AiWeeklySummaryResponse, DashboardResponse } from "@shared/types";
import { FilterChip, SegmentedControl, StatusBadge, SummaryCard } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { apiRequest } from "@/lib/api";

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

function shortDate(date: string) {
  return date.slice(5).replace("-", "/");
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDepartment = searchParams.get("departmentId") ?? String(user?.department?.id ?? "");
  const [scope, setScope] = useState<"all" | "team">(searchParams.get("scope") === "team" && initialDepartment ? "team" : "all");
  const [weeks, setWeeks] = useState(Number(searchParams.get("weeks")) || 8);
  const [departmentId, setDepartmentId] = useState(initialDepartment);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<AiWeeklySummaryResponse | null>(null);
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [summaryCopied, setSummaryCopied] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams({ weeks: String(weeks), scope });
    if (scope === "team" && departmentId) params.set("departmentId", departmentId);
    return params;
  }, [departmentId, scope, weeks]);

  useEffect(() => { setSearchParams(query, { replace: true }); }, [query, setSearchParams]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiRequest<DashboardResponse>("/api/dashboard?" + query)
      .then((result) => { if (active) setData(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "대시보드를 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query]);

  const trackingUrl = (params: Record<string, string>) => {
    const target = new URLSearchParams({ period: "all", ...params });
    if (scope === "team" && departmentId) target.set("departmentId", departmentId);
    return "/actions/tracking?" + target;
  };
  const changeScope = (value: string) => {
    const next = value === "team" ? "team" : "all";
    if (next === "team" && !departmentId) {
      const fallback = user?.department?.id ?? data?.departments[0]?.id;
      if (fallback) setDepartmentId(String(fallback));
      else return;
    }
    setScope(next);
  };
  const maximumWeekly = Math.max(1, ...(data?.weekly.flatMap((week) => [week.registered, week.completed]) ?? [1]));
  const maximumAverage = Math.max(1, ...(data?.departmentStatus.map((department) => department.averageDays) ?? [1]));
  const generateSummary = async (force = false) => {
    if (aiPending) return;
    setAiPending(true); setAiError(null);
    try { setAiSummary(await apiRequest<AiWeeklySummaryResponse>("/api/ai/weekly-summary", { method: "POST", body: JSON.stringify({ scope, force }) })); }
    catch (reason) { setAiError(reason instanceof Error ? reason.message : "AI 주간 요약을 만들지 못했습니다."); }
    finally { setAiPending(false); }
  };
  const copySummary = async () => {
    if (!aiSummary) return; await navigator.clipboard.writeText(aiSummary.content); setSummaryCopied(true); window.setTimeout(() => setSummaryCopied(false), 1500);
  };

  return <main className="workspace-page dashboard-page">
    <header className="workspace-heading">
      <div><h1>대시보드</h1><p>주간보고와 액션 현황을 한눈에 확인합니다.</p></div>
      <div className="dashboard-heading-actions">{loading && <span className="dashboard-loading"><LoaderCircle className="spin" /> 갱신 중</span>}<button className="btn btn-primary" type="button" disabled={loading || aiPending} onClick={() => void generateSummary()}>{aiPending ? <LoaderCircle className="spin" /> : <Sparkles />} AI 주간 요약</button></div>
    </header>
    <div className="dashboard-toolbar">
      <div className="dashboard-filter-group" aria-label="조회 기간">{[4, 8, 12, 26].map((value) => <FilterChip key={value} active={weeks === value} onClick={() => setWeeks(value)}>최근 {value}주</FilterChip>)}</div>
      <div className="dashboard-scope-controls"><SegmentedControl label="조회 범위" value={scope} onChange={changeScope} options={[{ value: "all", label: "전체" }, { value: "team", label: "팀" }]} />
        {scope === "team" && <select aria-label="조회 부서" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>{data?.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>}
      </div>
    </div>
    {error && <div className="action-message is-error">{error}<button type="button" onClick={() => setError(null)}>닫기</button></div>}
    <section className="dashboard-intro">
      <div><StatusBadge tone="dark">{data ? `${data.currentYearWeek % 100}주차` : "이번 주"}</StatusBadge><h2>{user?.name}님, 업무 현황을 확인하세요.</h2><p>{data ? `${data.currentYearWeek.toString().slice(0, 4)}년 ${data.currentYearWeek % 100}주차 (${shortDate(data.week.monday)}–${shortDate(data.week.friday)}) · ${data.scope.departmentName ?? "전사"} 기준` : "데이터를 불러오는 중입니다."}</p></div>
      <dl><div><dt>조회 범위</dt><dd>{data?.scope.departmentName ?? "전사"}</dd></div><div><dt>조회 기간</dt><dd>최근 {weeks}주</dd></div></dl>
    </section>
    {(aiSummary || aiPending || aiError) && <section className="card dashboard-ai-summary">
      <header><div><span><Sparkles /></span><div><h2>AI 주간 요약</h2><p>{data?.scope.departmentName ?? "전사"} · {data?.currentYearWeek ? `${data.currentYearWeek % 100}주차` : "이번 주"}{aiSummary?.cached ? " · 1시간 캐시" : ""}</p></div></div><button type="button" aria-label="요약 닫기" onClick={() => { setAiSummary(null); setAiError(null); }}><X /></button></header>
      {aiPending ? <div className="dashboard-ai-pending"><LoaderCircle className="spin" /> 주간보고와 액션 데이터를 분석하고 있습니다.</div> : aiError ? <div className="dashboard-ai-error">{aiError}<button className="btn btn-outline" type="button" onClick={() => void generateSummary()}>다시 시도</button></div> : aiSummary && <><div className="dashboard-ai-content">{aiSummary.content}</div><div className="dashboard-ai-sources"><strong>출처 {aiSummary.sources.length}개</strong>{aiSummary.sources.map((source) => <Link to={source.link} key={`${source.type}-${source.id}`}><FileText />{source.label}</Link>)}</div><footer><button className="btn btn-outline" type="button" onClick={() => void copySummary()}>{summaryCopied ? <Check /> : <Clipboard />}{summaryCopied ? "복사됨" : "복사"}</button><button className="btn btn-outline" type="button" onClick={() => void generateSummary(true)}><RefreshCw />다시 생성</button><Link className="btn btn-primary" to={`/ai?prompt=${encodeURIComponent("이번 주 요약을 바탕으로 더 자세히 설명해 줘.")}`}><Sparkles />AI봇에서 이어서 질문</Link></footer></>}
    </section>}
    <section className="dashboard-summary-grid">
      <button type="button" onClick={() => navigate(trackingUrl({ period: "custom", from: data?.week.monday ?? "", to: data?.week.friday ?? "" }))}><SummaryCard label="이번 주 신규 액션" value={data?.summary.newActions ?? 0} description={`${(data?.currentYearWeek ?? 0) % 100 || "–"}주차 회의 지시사항`} icon={<Sparkles />} /></button>
      <button type="button" onClick={() => navigate(trackingUrl({ hideCompleted: "true" }))}><SummaryCard label="미완료 액션" value={data?.summary.incomplete ?? 0} description={`진행중 ${data?.summary.inProgress ?? 0} · 보류 ${data?.summary.hold ?? 0} · 미등록 ${data?.summary.unregistered ?? 0}`} icon={<Activity />} /></button>
      <button type="button" onClick={() => navigate(trackingUrl({ status: "done" }))}><SummaryCard label="완료율" value={`${data?.summary.completionRate ?? 0}%`} description={`누적 ${data?.summary.total ?? 0}건 중 ${data?.summary.completed ?? 0}건 완료`} icon={<Gauge />} /></button>
      <button type="button" onClick={() => navigate(trackingUrl({ status: "done" }))}><SummaryCard label="평균 소요기간" value={`${data?.summary.averageDays ?? 0}일`} description="지시일 → 완료일" icon={<Timer />} /></button>
      <button type="button" onClick={() => navigate(trackingUrl({ hideCompleted: "true" }))}><SummaryCard label="장기 미완료" value={data?.summary.overdue ?? 0} description={`지시 후 ${data?.summary.overdueDays ?? 14}일 이상 경과`} tone="danger" icon={<CircleAlert />} /></button>
    </section>

    <div className="dashboard-widget-grid">
      <section className="card dashboard-weekly-card"><header><div><h2>주차별 액션아이템</h2><p>등록과 완료 추이</p></div><div className="dashboard-chart-legend"><span><i className="is-registered" />등록</span><span><i className="is-completed" />완료</span></div></header>
        <div className="dashboard-weekly-scroll"><div className="dashboard-weekly-chart" style={{ minWidth: Math.max(560, weeks * 52) }}>{data?.weekly.map((week) => <div className={week.current ? "dashboard-week is-current" : "dashboard-week"} key={week.yearWeek} title={`${week.monday}~${week.friday} · 등록 ${week.registered} · 완료 ${week.completed}`}><div className="dashboard-bars"><span className="is-registered" style={{ height: `${Math.max(3, week.registered / maximumWeekly * 100)}%` }}><b>{week.registered || ""}</b></span><span className="is-completed" style={{ height: `${Math.max(3, week.completed / maximumWeekly * 100)}%` }}><b>{week.completed || ""}</b></span></div><small>{week.label}</small></div>)}</div></div>
      </section>
      <section className="card dashboard-attention-card"><header><div><h2>주의 필요 액션</h2><p>경과일이 오래된 미완료 항목</p></div><Link to={trackingUrl({ hideCompleted: "true" })}>전체 <ArrowRight /></Link></header>
        {!data?.attention.length ? <p className="dashboard-empty">미완료 액션이 없습니다.</p> : <ul>{data.attention.map((item) => <li key={item.id}><Link to={`/actions/tracking?period=all&departmentId=${item.departmentId}&actionId=${item.id}`}><span className="dashboard-attention-dept">{item.departmentName}</span><strong>{item.subject}</strong><small>지시 {item.meetingDate.replaceAll("-", ".")}</small><StatusBadge tone={statusTone(item.status)}>{STATUS_LABEL[item.status]}</StatusBadge><em className={item.elapsedDays >= (data.summary.overdueDays ?? 14) ? "is-overdue" : ""}>D+{item.elapsedDays}</em></Link></li>)}</ul>}
      </section>
    </div>

    <section className="card dashboard-department-card"><header><div><h2>부서별 진행상태</h2><p>누적 액션 기준</p></div></header>
      <div className="dashboard-department-list">{data?.departmentStatus.map((department) => <article key={department.id}><button type="button" className="dashboard-department-name" onClick={() => navigate(`/actions/tracking?period=all&departmentId=${department.id}`)}>{department.name}<span>{department.total}건</span></button><div className="dashboard-status-stack" aria-label={`${department.name} 진행상태`}>
        {department.unregistered > 0 && <button className="is-unregistered" style={{ width: `${department.unregistered / department.total * 100}%` }} title={`진행 미등록 ${department.unregistered}`} onClick={() => navigate(`/actions/tracking?period=all&departmentId=${department.id}&status=unregistered`)}>{department.unregistered}</button>}
        {department.inProgress > 0 && <button className="is-progress" style={{ width: `${department.inProgress / department.total * 100}%` }} title={`진행중 ${department.inProgress}`} onClick={() => navigate(`/actions/tracking?period=all&departmentId=${department.id}&status=in_progress`)}>{department.inProgress}</button>}
        {department.hold > 0 && <button className="is-hold" style={{ width: `${department.hold / department.total * 100}%` }} title={`보류 ${department.hold}`} onClick={() => navigate(`/actions/tracking?period=all&departmentId=${department.id}&status=hold`)}>{department.hold}</button>}
        {department.done > 0 && <button className="is-done" style={{ width: `${department.done / department.total * 100}%` }} title={`완료 ${department.done}`} onClick={() => navigate(`/actions/tracking?period=all&departmentId=${department.id}&status=done`)}>{department.done}</button>}
        {!department.total && <span className="is-empty">등록된 액션 없음</span>}
      </div><div className="dashboard-department-metrics"><span>완료율 <b>{department.completionRate}%</b><i><em style={{ width: `${department.completionRate}%` }} /></i></span><span>평균 <b>{department.averageDays}일</b><i><em className="is-average" style={{ width: `${department.averageDays / maximumAverage * 100}%` }} /></i></span><span className={department.overdue ? "is-danger" : ""}>장기 미완료 <b>{department.overdue}건</b></span></div></article>)}</div>
    </section>
  </main>;
}
