import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, CalendarDays, Check, ClipboardList, FileSpreadsheet, LoaderCircle, Paperclip, Plus, Save, Search, Sparkles, Trash2, Users } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import type {
  MeetingDetailResponse,
  MeetingAttachment,
  MeetingListResponse,
  MeetingOptionsResponse,
  MeetingWriteRequest,
  AiActionExtractionResponse,
} from "@shared/types";
import { toKstDateString } from "@shared/week";
import { DataTable, EmptyState, StatusBadge } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { RichTextEditor } from "@/features/reports/RichTextEditor";
import { apiRequest } from "@/lib/api";

interface MeetingFormState {
  typeCode: string;
  meetingDate: string;
  timePlace: string;
  chair: string;
  attendeeIds: number[];
  body: unknown | null;
  bodyText: string;
}

const EMPTY_FORM: MeetingFormState = {
  typeCode: "",
  meetingDate: toKstDateString(),
  timePlace: "",
  chair: "대표이사",
  attendeeIds: [],
  body: null,
  bodyText: "",
};

function formatDate(date: string) {
  const value = new Date(date + "T00:00:00+09:00");
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", timeZone: "Asia/Seoul",
  }).format(value);
}

function defaultBody(departments: MeetingOptionsResponse["departments"]) {
  return {
    type: "doc",
    content: departments.flatMap((department, index) => [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: `${index + 1}. ${department.name}` }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{
        type: "paragraph", content: [{ type: "text", text: "[논의 내용을 입력하세요]" }],
      }] }] },
    ]),
  };
}

function defaultBodyText(departments: MeetingOptionsResponse["departments"]) {
  return departments.map((department, index) => `${index + 1}. ${department.name}\\n[논의 내용을 입력하세요]`).join("\\n");
}

function renderNode(node: Record<string, unknown>, key: string): ReactNode {
  const type = String(node.type ?? "");
  const content = Array.isArray(node.content)
    ? node.content.map((child, index) => renderNode(child as Record<string, unknown>, key + "-" + index))
    : null;
  if (type === "text") {
    const marks = Array.isArray(node.marks) ? node.marks as Array<Record<string, unknown>> : [];
    const bold = marks.some((mark) => mark.type === "bold");
    const styleMark = marks.find((mark) => mark.type === "textStyle");
    const attrs = styleMark?.attrs as Record<string, unknown> | undefined;
    const color = typeof attrs?.color === "string" && /^#[0-9a-f]{6}$/i.test(attrs.color) ? attrs.color : undefined;
    return <span key={key} style={{ color, fontWeight: bold ? 700 : undefined }}>{String(node.text ?? "")}</span>;
  }
  if (type === "paragraph") return <p key={key}>{content}</p>;
  if (type === "heading") {
    const level = Number((node.attrs as Record<string, unknown> | undefined)?.level) || 2;
    return level === 3 ? <h3 key={key}>{content}</h3> : <h2 key={key}>{content}</h2>;
  }
  if (type === "bulletList") return <ul key={key}>{content}</ul>;
  if (type === "orderedList") return <ol key={key}>{content}</ol>;
  if (type === "listItem") return <li key={key}>{content}</li>;
  if (type === "hardBreak") return <br key={key} />;
  if (type === "image") {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    const src = typeof attrs?.src === "string" ? attrs.src : "";
    return src.startsWith("/api/files/")
      ? <img key={key} src={src} alt={typeof attrs?.alt === "string" ? attrs.alt : "회의 첨부 이미지"} />
      : null;
  }
  return <span key={key}>{content}</span>;
}

function RichBody({ body, text }: { body: string | null; text: string | null }) {
  if (body) {
    try {
      const value = JSON.parse(body) as Record<string, unknown>;
      return <div className="meeting-body-view">{renderNode(value, "root")}</div>;
    } catch { /* 과거 평문 데이터는 아래에서 표시 */ }
  }
  return <div className="meeting-body-view is-plain">{text || "등록된 회의 본문이 없습니다."}</div>;
}

export function MeetingPage() {
  const { meetingId } = useParams();
  return meetingId ? <MeetingEditor meetingId={meetingId} /> : <MeetingList />;
}

function MeetingList() {
  const navigate = useNavigate();
  const [data, setData] = useState<MeetingListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeCode, setTypeCode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (typeCode) params.set("typeCode", typeCode);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      setData(await apiRequest<MeetingListResponse>("/api/meetings?" + params));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "회의록 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [typeCode, from, to]);

  return <main className="workspace-page meeting-page">
    <header className="workspace-heading">
      <div><h1>회의록 등록</h1><p>전사 회의 내용을 기록하고 액션아이템과 연결합니다.</p></div>
      {data?.canCreate && <button className="btn btn-primary" type="button" onClick={() => navigate("/meetings/new")}>
        <Plus /> 회의록 등록
      </button>}
    </header>
    <section className="meeting-list-card card">
      <div className="meeting-filters">
        <label><span>회의구분</span><select value={typeCode} onChange={(event) => setTypeCode(event.target.value)}>
          <option value="">전체</option>
          {data?.meetingTypes.map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}
        </select></label>
        <label><span>시작일</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>종료일</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <span className="meeting-filter-count"><Search /> {data?.items.length ?? 0}건</span>
      </div>
      {error ? <EmptyState title="회의록을 불러오지 못했습니다." description={error}
        action={<button className="btn btn-outline" type="button" onClick={() => void load()}>다시 시도</button>} />
      : <DataTable caption="회의록 목록" minWidth={850} empty={!loading && !data?.items.length}
          emptyMessage="등록된 회의록이 없습니다."
          headers={<tr><th>번호</th><th>회의구분</th><th>회의일자</th><th>주재</th><th>서기</th><th>연결 액션</th><th>상태</th></tr>}>
        {data?.items.map((item) => <tr key={item.id} className="meeting-list-row"
          onClick={() => navigate("/meetings/" + item.id)}>
          <td><strong>{item.displayNo ?? "임시저장"}</strong></td>
          <td>{item.typeName}</td>
          <td>{formatDate(item.meetingDate)}</td>
          <td>{item.chair}</td>
          <td>{item.clerkName}</td>
          <td>{item.actionCount}건</td>
          <td><StatusBadge tone={item.status === "published" ? "success" : "warning"}>
            {item.status === "published" ? "등록" : "작성중"}
          </StatusBadge></td>
        </tr>)}
      </DataTable>}
    </section>
  </main>;
}

function MeetingEditor({ meetingId }: { meetingId: string }) {
  const creating = meetingId === "new";
  const navigate = useNavigate();
  const { user } = useAuth();
  const [options, setOptions] = useState<MeetingOptionsResponse | null>(null);
  const [detail, setDetail] = useState<MeetingDetailResponse | null>(null);
  const [form, setForm] = useState<MeetingFormState>(EMPTY_FORM);
  const [persistedId, setPersistedId] = useState<number | null>(creating ? null : Number(meetingId));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveLabel, setSaveLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attendeeCandidate, setAttendeeCandidate] = useState(0);
  const [files, setFiles] = useState<MeetingAttachment[]>([]);
  const [filePending, setFilePending] = useState(false);
  const [excelPending, setExcelPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<MeetingOptionsResponse>("/api/meetings/options"),
      creating ? Promise.resolve(null) : apiRequest<MeetingDetailResponse>("/api/meetings/" + meetingId),
    ]).then(([nextOptions, nextDetail]) => {
      if (!active) return;
      setOptions(nextOptions);
      if (nextDetail) {
        setDetail(nextDetail);
        setFiles(nextDetail.attachments);
        setForm({
          typeCode: nextDetail.typeCode,
          meetingDate: nextDetail.meetingDate,
          timePlace: nextDetail.timePlace ?? "",
          chair: nextDetail.chair,
          attendeeIds: nextDetail.attendees.map((item) => item.id),
          body: nextDetail.body ? JSON.parse(nextDetail.body) : null,
          bodyText: nextDetail.bodyText ?? "",
        });
      } else {
        const weekly = nextOptions.meetingTypes.find((type) => type.code === "WEEKLY")?.code
          ?? nextOptions.meetingTypes[0]?.code ?? "";
        setForm({ ...EMPTY_FORM, typeCode: weekly, body: defaultBody(nextOptions.departments),
          bodyText: defaultBodyText(nextOptions.departments) });
      }
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "회의록을 불러오지 못했습니다.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [creating, meetingId]);

  const canEdit = creating ? Boolean(options?.canCreate) : Boolean(detail?.canEdit);
  const selectedAttendees = useMemo(() => options?.employees.filter((person) => form.attendeeIds.includes(person.id)) ?? [],
    [form.attendeeIds, options]);
  const availableAttendees = options?.employees.filter((person) => !form.attendeeIds.includes(person.id)) ?? [];
  const meetingTypeName = options?.meetingTypes.find((type) => type.code === form.typeCode)?.name ?? "회의";

  const change = <K extends keyof MeetingFormState>(key: K, value: MeetingFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setSaveLabel(null);
  };

  const save = async (intent: "draft" | "publish", quiet = false) => {
    if (!canEdit || saving) return false;
    if (!form.typeCode || !form.meetingDate || !form.chair.trim()) {
      if (!quiet) setError("회의구분, 일자, 주재자를 입력하세요.");
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: MeetingWriteRequest = { ...form, intent };
      const result = await apiRequest<{ id: number; duplicateWarning: boolean; status: "draft" | "published" }>(
        persistedId ? "/api/meetings/" + persistedId : "/api/meetings",
        { method: persistedId ? "PUT" : "POST", body: JSON.stringify(payload) },
      );
      setDirty(false);
      setPersistedId(result.id);
      setSaveLabel(intent === "publish" ? "등록 및 공유 완료" : "임시저장됨");
      if (result.duplicateWarning && !quiet) window.alert(`같은 날짜의 ${meetingTypeName} 회의록이 있습니다.`);
      if (!persistedId) navigate("/meetings/" + result.id, { replace: true });
      else if (intent === "publish") {
        const refreshed = await apiRequest<MeetingDetailResponse>("/api/meetings/" + result.id);
        setDetail(refreshed);
      }
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "회의록을 저장하지 못했습니다.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (!persistedId || filePending) return;
    setFilePending(true);
    setError(null);
    try {
      const data = new FormData();
      data.append("file", file);
      data.append("meetingId", String(persistedId));
      const result = await apiRequest<MeetingAttachment>("/api/files/attachments", { method: "POST", body: data });
      setFiles((current) => [result, ...current]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "파일을 첨부하지 못했습니다.");
    } finally {
      setFilePending(false);
    }
  };

  const removeFile = async (file: MeetingAttachment) => {
    if (filePending || !window.confirm(`${file.fileName} 파일을 삭제할까요?`)) return;
    setFilePending(true);
    try {
      await apiRequest("/api/files/attachments/" + file.id, { method: "DELETE" });
      setFiles((current) => current.filter((item) => item.id !== file.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "첨부파일을 삭제하지 못했습니다.");
    } finally {
      setFilePending(false);
    }
  };

  const downloadExcel = async () => {
    if (!persistedId || excelPending) return;
    setExcelPending(true);
    setError(null);
    try {
      if (dirty && canEdit) {
        const saved = await save(detail?.status === "published" ? "publish" : "draft");
        if (!saved) return;
      }
      const current = await apiRequest<MeetingDetailResponse>("/api/meetings/" + persistedId);
      const { downloadMeetingExcel } = await import("./meetingExcel");
      await downloadMeetingExcel(current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "회의록 엑셀을 만들지 못했습니다.");
    } finally {
      setExcelPending(false);
    }
  };

  const extractActions = async () => {
    if (!detail || extracting) return;
    setExtracting(true);
    setError(null);
    try {
      const result = await apiRequest<AiActionExtractionResponse>("/api/ai/extract-actions", {
        method: "POST", body: JSON.stringify({ meetingId: detail.id }),
      });
      if (!result.candidates.length) {
        setError("회의록에서 명확한 지시사항을 찾지 못했습니다.");
        return;
      }
      sessionStorage.setItem("metawork.aiActionCandidates", JSON.stringify(result));
      navigate(`/actions/register?meetingId=${detail.id}&ai=1`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI 지시사항을 추출하지 못했습니다.");
    } finally { setExtracting(false); }
  };

  const removeMeeting = async () => {
    if (!detail || !detail.canDelete || deleting) return;
    if (detail.status === "published") {
      const expected = detail.displayNo ?? String(detail.id);
      if (window.prompt(`등록된 회의록을 완전히 삭제합니다. 확인을 위해 ${expected}을(를) 입력하세요.`) !== expected) return;
    } else if (!window.confirm("작성 중인 회의록을 삭제할까요? 첨부파일도 함께 삭제됩니다.")) return;
    setDeleting(true);
    setError(null);
    try {
      await apiRequest("/api/meetings/" + detail.id, { method: "DELETE" });
      navigate("/meetings", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "회의록을 삭제하지 못했습니다.");
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!dirty || !canEdit || saving || detail?.status === "published") return;
    const timer = window.setTimeout(() => { void save("draft", true); }, 30_000);
    return () => window.clearTimeout(timer);
  }, [dirty, form, saving, canEdit, detail?.status]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (loading) return <main className="workspace-page"><div className="route-loading"><span className="spinner" /> 회의록을 불러오는 중…</div></main>;
  if (error && !options) return <main className="workspace-page"><EmptyState title="회의록을 열 수 없습니다." description={error}
    action={<button className="btn btn-outline" onClick={() => navigate("/meetings")}>목록으로</button>} /></main>;

  const bodyValue = form.body ? JSON.stringify(form.body) : null;
  const submit = (event: FormEvent) => { event.preventDefault(); void save(detail?.status === "published" ? "publish" : "draft"); };

  return <main className="workspace-page meeting-page">
    <header className="workspace-heading meeting-editor-heading">
      <div>
        <button className="meeting-back" type="button" onClick={() => navigate("/meetings")}><ArrowLeft /> 회의록 목록</button>
        <div className="meeting-title-line"><h1>{creating ? "새 회의록" : detail?.displayNo ?? "임시저장 회의록"}</h1>
          <StatusBadge tone={detail?.status === "published" ? "success" : "warning"}>
            {detail?.status === "published" ? "등록" : "작성중"}
          </StatusBadge></div>
        <p>{formatDate(form.meetingDate)} · 전사 {meetingTypeName}회의 · 서기 {detail?.clerkName ?? user?.name}
          {(detail?.clerkDepartmentName ?? user?.department?.name) ? `(${detail?.clerkDepartmentName ?? user?.department?.name})` : ""}</p>
      </div>
      {(detail || canEdit) && <div className="meeting-heading-actions">
        {detail && (detail.status === "draft" ? detail.canEdit : user?.isAdmin) &&
          <button className="btn btn-ghost meeting-delete-button" type="button"
            disabled={!detail.canDelete || deleting} title={detail.deleteBlockReason ?? "회의록 삭제"}
            onClick={() => void removeMeeting()}><Trash2 /> {deleting ? "삭제 중…" : "삭제"}</button>}
        {persistedId && <button className="btn btn-outline" type="button" disabled={excelPending || saving}
          onClick={() => void downloadExcel()}><FileSpreadsheet /> {excelPending ? "엑셀 생성 중…" : "엑셀"}</button>}
        {canEdit && <>
        {saveLabel && <span className="meeting-save-label"><Check /> {saveLabel}</span>}
        {detail?.status !== "published" && <button className="btn btn-outline" type="button" disabled={saving}
          onClick={() => void save("draft")}><Save /> 임시저장</button>}
        <button className="btn btn-primary" type="button" disabled={saving}
          onClick={() => void save("publish")}><Check /> {detail?.status === "published" ? "수정 저장" : "등록 및 공유"}</button>
        </>}
      </div>}
    </header>
    {error && <div className="meeting-error" role="alert">{error}</div>}
    <form className="meeting-editor-form" onSubmit={submit}>
      <section className="card meeting-info-card">
        <div className="meeting-section-title"><div><CalendarDays /><span><strong>회의 정보</strong><small>회의 기본 정보와 참석자를 입력합니다.</small></span></div></div>
        <div className="meeting-info-grid">
          <label><span>회의구분 *</span><select value={form.typeCode} disabled={!canEdit}
            onChange={(event) => change("typeCode", event.target.value)}>
            {options?.meetingTypes.map((type) => <option value={type.code} key={type.code}>{type.name}</option>)}
          </select></label>
          <label><span>회의일자 *</span><input type="date" value={form.meetingDate} disabled={!canEdit}
            onChange={(event) => change("meetingDate", event.target.value)} /></label>
          <label><span>시간 · 장소</span><input value={form.timePlace} disabled={!canEdit} maxLength={50}
            placeholder="예: 10:00 · 대회의실" onChange={(event) => change("timePlace", event.target.value)} /></label>
          <label><span>주재 *</span><input value={form.chair} disabled={!canEdit} maxLength={50}
            onChange={(event) => change("chair", event.target.value)} /></label>
        </div>
        <div className="meeting-attendees">
          <span className="meeting-field-label"><Users /> 참석자</span>
          <div className="meeting-attendee-chips">
            {selectedAttendees.map((person) => <button type="button" key={person.id} disabled={!canEdit}
              title={canEdit ? "참석자에서 제외" : undefined}
              onClick={() => change("attendeeIds", form.attendeeIds.filter((id) => id !== person.id))}>
              {person.departmentName && <small>{person.departmentName}</small>} {person.name} {person.position && `[${person.position}]`}
              {canEdit && <b>×</b>}
            </button>)}
            {!selectedAttendees.length && <em>선택된 참석자가 없습니다.</em>}
          </div>
          {canEdit && <div className="meeting-attendee-add">
            <select value={attendeeCandidate} onChange={(event) => setAttendeeCandidate(Number(event.target.value))}>
              <option value={0}>참석자 선택</option>
              {availableAttendees.map((person) => <option value={person.id} key={person.id}>
                {person.departmentName ? person.departmentName + " · " : ""}{person.name} {person.position}
              </option>)}
            </select>
            <button className="btn btn-outline" type="button" disabled={!attendeeCandidate} onClick={() => {
              change("attendeeIds", [...form.attendeeIds, attendeeCandidate]); setAttendeeCandidate(0);
            }}><Plus /> 참석자</button>
          </div>}
        </div>
      </section>

      <section className="card meeting-content-card">
        <div className="meeting-section-title"><div><ClipboardList /><span><strong>회의 본문</strong>
          <small>회의 내용 · 대표이사 의견 · 논의 내용을 기록합니다.</small></span></div></div>
        {canEdit ? <RichTextEditor key={persistedId ?? "new"} value={bodyValue} fallbackText={form.bodyText}
          placeholder="회의 내용을 입력하세요." uploadOwner={persistedId ? { type: "meeting", id: persistedId } : null}
          onChange={(value) => { change("body", value.json); change("bodyText", value.text); }} />
        : <RichBody body={detail?.body ?? null} text={detail?.bodyText ?? null} />}
        {canEdit && !persistedId && <p className="meeting-editor-help">이미지를 첨부하려면 회의록을 먼저 임시저장하세요.</p>}
        <div className="meeting-files">
          <div className="meeting-files-heading"><strong><Paperclip /> 첨부파일 {files.length}건</strong>
            {canEdit && persistedId && <label className="btn btn-outline">
              {filePending ? <LoaderCircle className="is-spinning" /> : <Plus />} 파일 첨부
              <input className="sr-only" type="file" disabled={filePending} onChange={(event) => {
                const file = event.target.files?.[0]; if (file) void uploadFile(file); event.target.value = "";
              }} />
            </label>}
          </div>
          {files.length ? <ul>{files.map((file) => <li key={file.id}>
            <a href={file.url}><Paperclip /> <span>{file.fileName}</span><small>{(file.size / 1024).toFixed(1)}KB</small></a>
            {canEdit && <button type="button" disabled={filePending} aria-label={file.fileName + " 삭제"}
              onClick={() => void removeFile(file)}><Trash2 /></button>}
          </li>)}</ul> : <p>첨부된 파일이 없습니다.</p>}
        </div>
      </section>

      {detail?.status === "published" && <section className="meeting-actions-link card">
        <div><strong>이 회의의 액션아이템 {detail.actionCount}건</strong>
          <p>AI 후보를 검토하거나 액션아이템 등록 메뉴에서 직접 등록합니다.</p></div>
        <div className="meeting-heading-actions"><button className="btn btn-outline" type="button" disabled={extracting} onClick={() => void extractActions()}>
          {extracting ? <LoaderCircle className="spin" /> : <Sparkles />} {extracting ? "지시사항 추출 중…" : "AI로 지시사항 추출"}
        </button><button className="btn btn-outline" type="button" onClick={() => navigate("/actions/register?meetingId=" + detail.id)}>
          직접 등록 →
        </button></div>
      </section>}
    </form>
  </main>;
}
