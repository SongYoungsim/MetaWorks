import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileText,
  MessageSquareWarning,
  UsersRound,
} from "lucide-react";
import { useNavigate, useParams } from "react-router";
import type {
  WeeklyReportOptionsResponse,
  WeeklyReportResponse,
  WeeklyReportStatus,
} from "@shared/types";
import {
  formatMdWithDay,
  formatYearWeekSlug,
  getDeadlineInfo,
  parseYearWeekSlug,
  shiftYearWeek,
  splitYearWeek,
} from "@shared/week";
import { EmptyState, StatusBadge, SummaryCard } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { apiRequest } from "@/lib/api";
import { ReportBoard } from "./ReportBoard";

const STATUS: Record<WeeklyReportStatus, { label: string; tone: "warning" | "success" }> = {
  draft: { label: "작성중", tone: "warning" },
  submitted: { label: "제출", tone: "success" },
  late: { label: "지연 제출", tone: "warning" },
  confirmed: { label: "임원 확인", tone: "success" },
};

function deadlineValue(deadlineAt: number): string {
  const info = getDeadlineInfo(deadlineAt);
  if (info.state === "overdue") return info.days < 0 ? "D+" + Math.abs(info.days) : "마감 경과";
  if (info.state === "today") return "D-day";
  return "D-" + info.days;
}

function formatDeadline(deadlineAt: number): string {
  const date = new Date(deadlineAt + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const time = new Date(deadlineAt).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatMdWithDay(date) + " " + time;
}

export function ReportPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ departmentCode?: string; week?: string }>();
  const [options, setOptions] = useState<WeeklyReportOptionsResponse | null>(null);
  const [report, setReport] = useState<WeeklyReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionPending, setActionPending] = useState(false);
  const [excelPending, setExcelPending] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest<WeeklyReportOptionsResponse>("/api/reports/options")
      .then((result) => {
        if (!active) return;
        setOptions(result);
        if (!params.departmentCode || !params.week) {
          const department = result.departments.find((item) => item.id === user?.department?.id)
            ?? result.departments[0];
          if (department) {
            navigate("/reports/" + department.code + "/" + formatYearWeekSlug(result.currentYearWeek), {
              replace: true,
            });
          }
        }
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "보고서 조회 조건을 불러오지 못했습니다.");
      });
    return () => { active = false; };
  }, [navigate, params.departmentCode, params.week, user?.department?.id]);

  useEffect(() => {
    if (!params.departmentCode || !params.week) return;
    let active = true;
    setLoading(true);
    setError(null);
    setReport(null);
    apiRequest<WeeklyReportResponse>(
      "/api/reports/" + encodeURIComponent(params.departmentCode) + "/" + encodeURIComponent(params.week),
    )
      .then((result) => { if (active) setReport(result); })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "주간업무보고를 불러오지 못했습니다.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [params.departmentCode, params.week, refreshKey]);

  const yearWeek = params.week ? parseYearWeekSlug(params.week) : null;
  const weekNumber = yearWeek ? splitYearWeek(yearWeek).week : 0;
  const status = report?.report ? STATUS[report.report.status] : null;
  const completedNames = report?.members.filter((member) => member.isCompleted).map((member) => member.name) ?? [];
  const writingNames = report?.members.filter((member) => !member.isCompleted).map((member) => member.name) ?? [];
  const myCompletion = report?.members.find((member) => member.id === user?.id)?.isCompleted ?? false;

  const subtitle = useMemo(() => {
    if (!report) return "";
    return splitYearWeek(report.yearWeek).year + "년 " + splitYearWeek(report.yearWeek).week +
      "주차 · " + report.department.name + " · 제출 마감 " + formatDeadline(report.deadlineAt);
  }, [report]);

  const goWeek = (offset: number) => {
    if (!yearWeek || !params.departmentCode) return;
    const target = shiftYearWeek(yearWeek, offset);
    if (options && target > options.maximumYearWeek) return;
    navigate("/reports/" + params.departmentCode + "/" + formatYearWeekSlug(target));
  };

  const changeDepartment = (code: string) => {
    const targetWeek = yearWeek ?? options?.currentYearWeek;
    if (targetWeek) navigate("/reports/" + code + "/" + formatYearWeekSlug(targetWeek));
  };

  const runReportAction = async (action: "completion" | "submit" | "recall" | "confirm", body?: unknown) => {
    if (!report?.report || actionPending) return;
    setActionPending(true);
    try {
      await apiRequest("/api/reports/" + report.report.id + "/" + action, {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      setRefreshKey((current) => current + 1);
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : "요청을 처리하지 못했습니다.");
    } finally {
      setActionPending(false);
    }
  };

  const toggleCompletion = () => {
    if (!report) return;
    if (!myCompletion) {
      const mine = report.details.flatMap((detail) => detail.entries)
        .filter((entry) => entry.ownerId === user?.id);
      const needsReview = mine.filter((entry) => entry.result === null
        || ((entry.result === "continue" || entry.result === "hold") && !entry.nextPlanText?.trim()));
      if (needsReview.length && !window.confirm(
        "확인이 필요한 타이틀이 " + needsReview.length + "건 있습니다. 그래도 작성 완료할까요?",
      )) return;
    }
    void runReportAction("completion", { completed: !myCompletion });
  };

  const submitReport = () => {
    if (writingNames.length && !window.confirm(
      "아직 작성 완료하지 않은 팀원이 있습니다: " + writingNames.join(", ") + ". 제출할까요?",
    )) return;
    void runReportAction("submit");
  };

  const downloadExcel = async () => {
    if (!report?.exists || excelPending) return;
    setExcelPending(true);
    try {
      const { downloadReportExcel } = await import("./reportExcel");
      await downloadReportExcel(report);
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : "엑셀 파일을 만들지 못했습니다.");
    } finally {
      setExcelPending(false);
    }
  };

  if (error) {
    return <main className="workspace-page"><EmptyState title="주간업무보고를 불러오지 못했습니다."
      description={error}
      action={<button className="btn btn-outline" type="button" onClick={() => window.location.reload()}>다시 시도</button>}
    /></main>;
  }

  return <main className="workspace-page report-page">
    <header className="report-heading">
      <div>
        <div className="report-title-line">
          <h1>주간업무보고 작성</h1>
          {status && <StatusBadge tone={status.tone} dot>{status.label}</StatusBadge>}
          {report?.permissions.readOnly && <StatusBadge tone="neutral">열람 전용</StatusBadge>}
        </div>
        <p>{subtitle || "보고서 정보를 불러오는 중입니다."}</p>
      </div>
      <div className="report-heading-actions">
        <div className="week-switcher" aria-label="주차 이동">
          <button type="button" onClick={() => goWeek(-1)} aria-label="이전 주"><ChevronLeft /></button>
          <strong>{weekNumber ? weekNumber + "주차" : "주차"}</strong>
          <button type="button" onClick={() => goWeek(1)}
            disabled={!yearWeek || (options !== null && yearWeek >= options.maximumYearWeek)}
            aria-label="다음 주"><ChevronRight /></button>
        </div>
        <button className="btn btn-outline" type="button" disabled={!report?.exists || excelPending}
          onClick={() => void downloadExcel()}>
          <Download /> {excelPending ? "생성 중…" : "엑셀"}
        </button>
        {report?.permissions.canEditOwn && <button className="btn btn-outline" type="button"
          disabled={actionPending} onClick={toggleCompletion}>
          <Check /> {myCompletion ? "작성 완료됨 · 취소" : "내 작성 완료"}
        </button>}
        {report?.permissions.canSubmit && <button className="btn btn-primary" type="button"
          disabled={actionPending} onClick={submitReport}>팀 보고서 제출</button>}
        {report?.permissions.canRecall && <button className="btn btn-outline" type="button"
          disabled={actionPending} onClick={() => {
            if (window.confirm("제출을 회수하고 보고서를 다시 편집할까요?")) void runReportAction("recall");
          }}>제출 회수</button>}
        {report?.permissions.canConfirm && <button className="btn btn-primary" type="button"
          disabled={actionPending} onClick={() => {
            if (window.confirm("이 보고서를 임원 확인 처리할까요?")) void runReportAction("confirm");
          }}>임원 확인</button>}
      </div>
    </header>

    <div className="report-context-bar">
      <label><span>조회 부서</span><select value={params.departmentCode ?? ""}
        onChange={(event) => changeDepartment(event.target.value)} disabled={!options}>
        {options?.departments.map((department) =>
          <option key={department.id} value={department.code}>{department.name}</option>)}
      </select></label>
      {report && <span className="report-period">
        금주 {formatMdWithDay(report.week.monday)}–{formatMdWithDay(report.week.friday)}
        <i aria-hidden="true" /> 차주 {formatMdWithDay(report.week.nextMonday)}–{formatMdWithDay(report.week.nextFriday)}
      </span>}
    </div>

    {loading || !report ? <section className="report-summary-grid" aria-busy="true">
      {[1, 2, 3, 4].map((item) => <div className="report-summary-skeleton" key={item} />)}
    </section> : <>
      <section className="report-summary-grid">
        <SummaryCard label="팀원 작성 현황"
          value={report.summary.completedMembers + " / " + report.summary.totalMembers}
          description={completedNames.length
            ? "완료 " + completedNames.join(", ") + (writingNames.length ? " · 작성중 " + writingNames.join(", ") : "")
            : writingNames.length ? "작성중 " + writingNames.join(", ") : "대상 팀원이 없습니다."}
          icon={<UsersRound />} />
        <SummaryCard label="이번 주 타이틀" value={report.summary.totalTitles}
          description={"계속 " + report.summary.continued + " · 완료 " + report.summary.completed +
            " · 보류 " + report.summary.held + (report.summary.newTitles ? " · 신규 " + report.summary.newTitles : "")}
          icon={<FileText />} />
        <SummaryCard label="임원 결정 요청" value={report.summary.pendingDecisions}
          description={report.summary.pendingDecisions ? "결정 대기 · 주간회의 안건" : "대기 중인 요청이 없습니다."}
          icon={<MessageSquareWarning />} />
        <SummaryCard label="제출 마감까지" value={deadlineValue(report.deadlineAt)}
          description={formatDeadline(report.deadlineAt) + " · 이후 지연 제출"}
          tone={getDeadlineInfo(report.deadlineAt).state === "overdue" ? "danger" : "default"}
          icon={<CalendarClock />} />
      </section>

      {!report.exists ? <EmptyState title="이 주차에는 생성된 보고서가 없습니다."
        description="과거 미생성 주차는 자동으로 만들지 않습니다."
        icon={<ClipboardCheck />} compact />
      : <ReportBoard report={report} currentUserId={user?.id}
          onChanged={() => setRefreshKey((current) => current + 1)} />}
    </>}
    {report?.exists && (report.permissions.canEditOwn || report.permissions.canSubmit) &&
      <div className="report-mobile-action-bar">
        <button className="btn btn-outline" type="button"
          onClick={() => window.dispatchEvent(new Event("metawork:save-report"))}>임시저장</button>
        {report.permissions.canEditOwn && <button className="btn btn-outline" type="button"
          disabled={actionPending} onClick={toggleCompletion}>
          <Check /> {myCompletion ? "완료 취소" : "내 작성 완료"}
        </button>}
        {report.permissions.canSubmit && <button className="btn btn-primary" type="button"
          disabled={actionPending} onClick={submitReport}>팀 보고서 제출</button>}
      </div>}
  </main>;
}
