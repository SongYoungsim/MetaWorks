import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, ExternalLink, LoaderCircle, Pencil, Plus, Save, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import type {
  ActionItemRecord,
  ActionListResponse,
  ActionRegisterOptionsResponse,
  ActionWriteItem,
  AiActionExtractionResponse,
} from "@shared/types";
import { toKstDateString } from "@shared/week";
import { EmptyState, StatusBadge } from "@/components/ui";
import { apiRequest } from "@/lib/api";
import type { ActionImportField } from "./actionExcel";

interface DraftRow extends ActionWriteItem {
  key: string;
  origin?: "manual" | "upload" | "ai";
  sourceRow?: number;
  errors?: Partial<Record<ActionImportField, string>>;
  warning?: string;
  rawMeetingType?: string;
  rawDepartment?: string;
}

const statusLabel = {
  unregistered: "진행 미등록",
  in_progress: "진행중",
  hold: "보류",
  done: "완료",
} as const;

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function writeItem(item: ActionItemRecord): ActionWriteItem {
  return {
    meetingId: item.meetingId,
    meetingTypeCode: item.meetingTypeCode,
    meetingDate: item.meetingDate,
    departmentId: item.departmentId,
    subject: item.subject,
    request: item.request,
  };
}

export function ActionRegisterPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [options, setOptions] = useState<ActionRegisterOptionsResponse | null>(null);
  const [items, setItems] = useState<ActionItemRecord[]>([]);
  const [meetingId, setMeetingId] = useState(searchParams.get("meetingId") ?? "");
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<ActionWriteItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [excelPending, setExcelPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedMeeting = useMemo(
    () => options?.meetings.find((meeting) => String(meeting.id) === meetingId) ?? null,
    [meetingId, options],
  );

  const createDraft = (source?: ActionWriteItem): DraftRow => ({
    key: crypto.randomUUID(),
    meetingId: source?.meetingId ?? selectedMeeting?.id ?? null,
    meetingTypeCode: source?.meetingTypeCode ?? selectedMeeting?.typeCode ?? options?.meetingTypes[0]?.code ?? "",
    meetingDate: source?.meetingDate ?? selectedMeeting?.meetingDate ?? toKstDateString(),
    departmentId: source?.departmentId ?? options?.departments[0]?.id ?? 0,
    subject: source?.subject ?? "",
    request: source?.request ?? "",
    origin: "manual",
  });

  const loadItems = async (nextMeetingId = meetingId) => {
    const query = nextMeetingId ? `?meetingId=${encodeURIComponent(nextMeetingId)}` : "";
    const data = await apiRequest<ActionListResponse>("/api/actions" + query);
    setItems(data.items);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      apiRequest<ActionRegisterOptionsResponse>("/api/actions/register/options"),
      apiRequest<ActionListResponse>("/api/actions" + (meetingId ? `?meetingId=${encodeURIComponent(meetingId)}` : "")),
    ]).then(([nextOptions, list]) => {
      if (!active) return;
      setOptions(nextOptions);
      setItems(list.items);
      const stored = sessionStorage.getItem("metawork.aiActionCandidates");
      if (stored && nextOptions.canEdit) {
        try {
          const extraction = JSON.parse(stored) as AiActionExtractionResponse;
          const meeting = nextOptions.meetings.find((item) => item.id === extraction.meetingId);
          if (meeting && String(meeting.id) === meetingId) {
            setDrafts(extraction.candidates.map((candidate) => ({
              key: crypto.randomUUID(), origin: "ai", meetingId: meeting.id,
              meetingTypeCode: meeting.typeCode, meetingDate: meeting.meetingDate,
              departmentId: candidate.departmentId, subject: candidate.subject, request: candidate.request,
              warning: candidate.duplicateWarning ? "이미 등록된 액션과 주제가 유사합니다. 중복 여부를 확인하세요." : undefined,
            })));
            setNotice(`AI가 추출한 후보 ${extraction.candidates.length}건을 추가했습니다. 내용을 검토한 뒤 등록하세요.`);
          }
        } catch { setError("AI 추출 결과를 불러오지 못했습니다."); }
        sessionStorage.removeItem("metawork.aiActionCandidates");
      }
      const requested = meetingId && nextOptions.meetings.some((meeting) => String(meeting.id) === meetingId);
      if (meetingId && !requested) {
        setMeetingId("");
        setSearchParams({}, { replace: true });
      }
    }).catch((reason) => {
      if (active) setError(messageOf(reason, "액션아이템 정보를 불러오지 못했습니다."));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const changeMeeting = async (value: string) => {
    setMeetingId(value);
    setSearchParams(value ? { meetingId: value } : {}, { replace: true });
    const meeting = options?.meetings.find((item) => String(item.id) === value);
    setDrafts((current) => current.map((draft) => ({
      ...draft,
      meetingId: meeting?.id ?? null,
      meetingTypeCode: meeting?.typeCode ?? draft.meetingTypeCode,
      meetingDate: meeting?.meetingDate ?? draft.meetingDate,
    })));
    setEditingId(null);
    setEditValue(null);
    setError(null);
    try { await loadItems(value); }
    catch (reason) { setError(messageOf(reason, "액션아이템 목록을 불러오지 못했습니다.")); }
  };

  const updateDraft = <K extends keyof ActionWriteItem>(key: string, field: K, value: ActionWriteItem[K]) => {
    setDrafts((current) => current.map((draft) => {
      if (draft.key !== key) return draft;
      const errors = { ...draft.errors };
      delete errors[field as ActionImportField];
      return { ...draft, [field]: value, errors };
    }));
  };

  const addDraft = (source?: ActionWriteItem) => {
    setDrafts((current) => [...current, createDraft(source)]);
    setNotice(null);
  };

  const saveBatch = async () => {
    if (!drafts.length) return;
    const invalid = drafts.find((draft) => Object.keys(draft.errors ?? {}).length || !draft.meetingTypeCode || !draft.meetingDate || !draft.departmentId || !draft.subject.trim() || !draft.request.trim());
    if (invalid) {
      setError("모든 행의 회의구분, 일자, 담당부서, 주제, 요청사항을 입력하세요.");
      return;
    }
    if (!window.confirm(`${drafts.length}건의 액션아이템을 등록하고 담당 부서장에게 알림을 보낼까요?`)) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest("/api/actions/batch", {
        method: "POST",
        body: JSON.stringify({ items: drafts.map(({ key: _key, ...item }) => item) }),
      });
      setDrafts([]);
      setNotice(`${drafts.length}건을 등록했습니다.`);
      await loadItems();
    } catch (reason) {
      setError(messageOf(reason, "액션아이템을 등록하지 못했습니다."));
    } finally { setSaving(false); }
  };

  const downloadTemplate = async () => {
    if (!options || excelPending) return;
    setExcelPending(true);
    setError(null);
    try {
      const { downloadActionTemplate } = await import("./actionExcel");
      await downloadActionTemplate(options, selectedMeeting);
    } catch (reason) { setError(messageOf(reason, "Excel 양식을 만들지 못했습니다.")); }
    finally { setExcelPending(false); }
  };

  const uploadExcel = async (file: File | undefined) => {
    if (!file || !options) return;
    setExcelPending(true);
    setError(null);
    setNotice(null);
    try {
      const { parseActionExcel } = await import("./actionExcel");
      const rows = await parseActionExcel(file, options, selectedMeeting);
      const added: DraftRow[] = rows.map((row) => ({ ...row, key: crypto.randomUUID(), origin: "upload" }));
      const errorCount = added.filter((row) => Object.keys(row.errors ?? {}).length > 0).length;
      setDrafts((current) => [...current, ...added]);
      setNotice(`${added.length}건 추가 · 오류 ${errorCount}건`);
    } catch (reason) { setError(messageOf(reason, "Excel 파일을 읽지 못했습니다.")); }
    finally {
      setExcelPending(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const saveEdit = async (id: number) => {
    if (!editValue) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/actions/${id}`, { method: "PATCH", body: JSON.stringify(editValue) });
      setEditingId(null);
      setEditValue(null);
      setNotice("액션아이템을 수정했습니다.");
      await loadItems();
    } catch (reason) { setError(messageOf(reason, "액션아이템을 수정하지 못했습니다.")); }
    finally { setSaving(false); }
  };

  const removeItem = async (item: ActionItemRecord) => {
    if (!window.confirm(`${item.displayNo} 액션아이템을 삭제할까요?`)) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/actions/${item.id}`, { method: "DELETE" });
      setNotice(`${item.displayNo}을 삭제했습니다.`);
      await loadItems();
    } catch (reason) { setError(messageOf(reason, "액션아이템을 삭제하지 못했습니다.")); }
    finally { setSaving(false); }
  };

  if (loading) return <main className="workspace-page action-page"><div className="route-loading"><LoaderCircle className="spin" /> 불러오는 중입니다.</div></main>;

  return <main className="workspace-page action-page">
    <header className="workspace-heading">
      <div><h1>액션아이템 등록</h1><p>회의 지시사항을 부서별로 등록하고 담당 부서장에게 배정합니다.</p></div>
      {options?.canEdit && <div className="action-heading-actions">
        <button className="btn btn-outline" type="button" disabled={excelPending} onClick={() => void downloadTemplate()}><Download /> 양식 다운로드</button>
        <button className="btn btn-outline" type="button" disabled={excelPending} onClick={() => fileInput.current?.click()}>{excelPending ? <LoaderCircle className="spin" /> : <Upload />} 엑셀 업로드</button>
        <input ref={fileInput} className="action-file-input" type="file" accept=".xlsx,.xls" onChange={(event) => void uploadExcel(event.target.files?.[0])} />
        <button className="btn btn-primary" type="button" onClick={() => addDraft()}><Plus /> 행 추가</button>
      </div>}
    </header>

    {error && <div className="action-message is-error">{error}<button type="button" onClick={() => setError(null)}><X /></button></div>}
    {notice && <div className="action-message is-success">{notice}<button type="button" onClick={() => setNotice(null)}><X /></button></div>}

    <section className="card action-meeting-picker">
      <label><span>연결 회의록</span><select value={meetingId} onChange={(event) => void changeMeeting(event.target.value)}>
        <option value="">회의록 미연결 · 전체 액션 보기</option>
        {options?.meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>
          {meeting.displayNo} · {meeting.typeName} · {meeting.meetingDate}
        </option>)}
      </select></label>
      {selectedMeeting && <div className="action-meeting-summary">
        <div><strong>{selectedMeeting.typeName}</strong><span>{selectedMeeting.meetingDate} · 주재 {selectedMeeting.chair}{selectedMeeting.timePlace ? ` · ${selectedMeeting.timePlace}` : ""}</span></div>
        <Link className="btn btn-outline" to={`/meetings/${selectedMeeting.id}`}><ExternalLink /> 회의록 보기</Link>
      </div>}
      {!options?.canEdit && <p className="action-readonly">회의 서기만 액션아이템을 등록·수정할 수 있습니다.</p>}
    </section>

    {options?.canEdit && <section className="card action-compose-card">
      <div className="action-section-heading"><div><h2>신규 등록</h2><p>여러 행을 추가한 뒤 한 번에 등록할 수 있습니다.</p></div><strong>{drafts.length}건</strong></div>
      {!drafts.length ? <EmptyState title="등록할 행이 없습니다." description="행 추가를 눌러 액션아이템을 입력하세요."
        action={<button className="btn btn-outline" type="button" onClick={() => addDraft()}><Plus /> 첫 행 추가</button>} />
      : <>
        <div className="action-table-wrap"><table className="action-table"><thead><tr><th>회의구분</th><th>회의일자</th><th>담당부서</th><th>주제</th><th>주요 내용 및 요청사항</th><th aria-label="행 작업" /></tr></thead>
          <tbody>{drafts.map((draft) => <tr key={draft.key} className={Object.keys(draft.errors ?? {}).length ? "is-invalid" : draft.origin === "upload" ? "is-upload" : draft.origin === "ai" ? "is-ai" : undefined}>
            <td>{draft.origin === "upload" && <span className="action-origin-badge">업로드 {draft.sourceRow}행</span>}{draft.origin === "ai" && <span className="action-origin-badge is-ai"><Sparkles /> AI 후보</span>}<select className={draft.errors?.meetingTypeCode ? "has-error" : ""} title={draft.errors?.meetingTypeCode} disabled={Boolean(draft.meetingId)} value={draft.meetingTypeCode} onChange={(event) => updateDraft(draft.key, "meetingTypeCode", event.target.value)}>{draft.errors?.meetingTypeCode && <option value={draft.meetingTypeCode}>{draft.rawMeetingType || "회의구분 선택"}</option>}{options.meetingTypes.map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}</select>{draft.errors?.meetingTypeCode && <small className="action-field-error">{draft.errors.meetingTypeCode}</small>}</td>
            <td><input className={draft.errors?.meetingDate ? "has-error" : ""} title={draft.errors?.meetingDate} disabled={Boolean(draft.meetingId)} type="date" value={draft.meetingDate} onChange={(event) => updateDraft(draft.key, "meetingDate", event.target.value)} />{draft.errors?.meetingDate && <small className="action-field-error">{draft.errors.meetingDate}</small>}</td>
            <td><select className={draft.errors?.departmentId ? "has-error" : ""} title={draft.errors?.departmentId} value={draft.departmentId} onChange={(event) => updateDraft(draft.key, "departmentId", Number(event.target.value))}>{draft.errors?.departmentId && <option value={0}>{draft.rawDepartment || "부서 선택"}</option>}{options.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>{draft.errors?.departmentId && <small className="action-field-error">{draft.errors.departmentId}</small>}</td>
            <td><input className={draft.errors?.subject ? "has-error" : ""} title={draft.errors?.subject} maxLength={50} value={draft.subject} placeholder="주제 입력" onChange={(event) => updateDraft(draft.key, "subject", event.target.value)} />{draft.errors?.subject && <small className="action-field-error">{draft.errors.subject}</small>}</td>
            <td><textarea className={draft.errors?.request ? "has-error" : ""} title={draft.errors?.request} maxLength={1000} value={draft.request} placeholder="주요 내용과 요청사항 입력" onChange={(event) => updateDraft(draft.key, "request", event.target.value)} />{draft.errors?.request && <small className="action-field-error">{draft.errors.request}</small>}{draft.warning && <small className="action-field-warning">{draft.warning}</small>}</td>
            <td><button className="action-icon-button is-danger" type="button" title="행 삭제" onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}><Trash2 /></button></td>
          </tr>)}</tbody></table></div>
        <div className="action-compose-actions"><button className="btn btn-outline" type="button" onClick={() => addDraft()}><Plus /> 행 추가</button><button className="btn btn-primary" type="button" disabled={saving} onClick={() => void saveBatch()}>{saving ? <LoaderCircle className="spin" /> : <Save />} {drafts.length}건 일괄 등록</button></div>
      </>}
    </section>}

    <section className="card action-list-card">
      <div className="action-section-heading"><div><h2>{selectedMeeting ? "연결된 액션아이템" : "전체 액션아이템"}</h2><p>진행 이력이 생긴 항목은 등록 화면에서 수정하거나 삭제할 수 없습니다.</p></div><strong>{items.length}건</strong></div>
      {!items.length ? <EmptyState title="등록된 액션아이템이 없습니다." description="신규 등록 영역에서 첫 액션아이템을 추가하세요." />
      : <div className="action-table-wrap"><table className="action-table is-list"><thead><tr><th>번호</th><th>회의</th><th>일자</th><th>담당부서</th><th>주제</th><th>주요 내용 및 요청사항</th><th>상태</th><th aria-label="작업" /></tr></thead>
        <tbody>{items.map((item) => {
          const editing = editingId === item.id && editValue;
          return <tr key={item.id}>
            <td><strong>{item.displayNo}</strong></td>
            <td>{editing ? <select disabled={Boolean(editValue.meetingId)} value={editValue.meetingTypeCode} onChange={(event) => setEditValue({ ...editValue, meetingTypeCode: event.target.value })}>{options?.meetingTypes.map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}</select> : item.meetingTypeName}</td>
            <td>{editing ? <input disabled={Boolean(editValue.meetingId)} type="date" value={editValue.meetingDate} onChange={(event) => setEditValue({ ...editValue, meetingDate: event.target.value })} /> : item.meetingDate}</td>
            <td>{editing ? <select value={editValue.departmentId} onChange={(event) => setEditValue({ ...editValue, departmentId: Number(event.target.value) })}>{options?.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select> : item.departmentName}</td>
            <td>{editing ? <input maxLength={50} value={editValue.subject} onChange={(event) => setEditValue({ ...editValue, subject: event.target.value })} /> : item.subject}</td>
            <td className="action-request-cell">{editing ? <textarea maxLength={1000} value={editValue.request} onChange={(event) => setEditValue({ ...editValue, request: event.target.value })} /> : item.request}</td>
            <td><StatusBadge tone={item.status === "done" ? "success" : item.status === "hold" ? "warning" : "neutral"}>{statusLabel[item.status]}</StatusBadge></td>
            <td><div className="action-row-actions">
              {editing ? <><button className="action-icon-button" type="button" title="저장" disabled={saving} onClick={() => void saveEdit(item.id)}><Save /></button><button className="action-icon-button" type="button" title="취소" onClick={() => { setEditingId(null); setEditValue(null); }}><X /></button></>
              : options?.canEdit && <><button className="action-icon-button" type="button" title="수정" disabled={item.progressCount > 0} onClick={() => { setEditingId(item.id); setEditValue(writeItem(item)); }}><Pencil /></button><button className="action-icon-button" type="button" title="복제" onClick={() => addDraft(writeItem(item))}><Copy /></button><button className="action-icon-button is-danger" type="button" title="삭제" disabled={item.progressCount > 0 || saving} onClick={() => void removeItem(item)}><Trash2 /></button></>}
            </div></td>
          </tr>;
        })}</tbody></table></div>}
    </section>
  </main>;
}
