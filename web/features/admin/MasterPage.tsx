import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate } from "react-router";
import { Building2, ChevronDown, ChevronUp, CirclePlus, ExternalLink, FileSliders, ListTree, LockKeyhole, Pencil, Save, Settings2, Trash2, Users } from "lucide-react";
import type { MasterCategory, MasterDataResponse, MasterDepartment, MasterMeetingType, MasterReportDetail, MasterReportTitle, MasterSettings } from "@shared/types";
import { formatYearWeekSlug, splitYearWeek } from "@shared/week";
import { DataTable, EmptyState, SidePanel, StatusBadge, Toggle } from "@/components/ui";
import { apiRequest } from "@/lib/api";

type MasterTab = "departments" | "details" | "meetings" | "settings";
interface DepartmentForm { code: string; name: string; leaderId: string; sortOrder: number; isActive: boolean }
interface DetailForm { departmentId: string; categoryId: string; name: string; sortOrder: number; isActive: boolean }
interface MeetingForm { name: string; sortOrder: number; isActive: boolean }

const INITIAL_SETTINGS: MasterSettings = {
  reportDeadlineWeekday: 5, reportDeadlineTime: "18:00",
  reportReminderWeekday: 5, reportReminderTime: "09:00",
  actionOverdueDays: 14, passwordMinLength: 8, passwordRequireSpecial: true,
  loginMaxFailures: 5, loginLockMinutes: 10, sessionIdleHours: 8, aiDailyLimit: 200,
};
const EMPTY_DATA: MasterDataResponse = {
  departments: [], categories: [], reportDetails: [], reportTitles: [], meetingTypes: [], employees: [],
  settings: INITIAL_SETTINGS,
};
const WEEKDAYS = ["", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"];
const nextOrder = (items: Array<{ sortOrder: number }>) =>
  items.length ? Math.max(...items.map((item) => item.sortOrder)) + 10 : 10;
const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const departmentDeleteBlockReason = (item: MasterDepartment) => {
  const reasons: string[] = [];
  if (item.employeeCount > 0) reasons.push(`소속 사원 ${item.employeeCount}명`);
  if (item.actionCount > 0) reasons.push(`연결된 액션 ${item.actionCount}건`);
  return reasons.length > 0 ? reasons.join(", ") : null;
};

function TabButton({ active, icon, label, count, onClick }: {
  active: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void;
}) {
  return <button className={active ? "is-active" : undefined} type="button" onClick={onClick}>
    {icon}<span>{label}</span>{count !== undefined && <small>{count}</small>}
  </button>;
}

export function MasterPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<MasterDataResponse>(EMPTY_DATA);
  const [tab, setTab] = useState<MasterTab>("departments");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);
  const [departmentPanel, setDepartmentPanel] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<MasterDepartment | null>(null);
  const [departmentForm, setDepartmentForm] = useState<DepartmentForm>({ code: "", name: "", leaderId: "", sortOrder: 10, isActive: true });
  const [detailPanel, setDetailPanel] = useState(false);
  const [titleTraceDetail, setTitleTraceDetail] = useState<MasterReportDetail | null>(null);
  const [editingDetail, setEditingDetail] = useState<MasterReportDetail | null>(null);
  const [detailForm, setDetailForm] = useState<DetailForm>({ departmentId: "", categoryId: "", name: "", sortOrder: 10, isActive: true });
  const [meetingPanel, setMeetingPanel] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<MasterMeetingType | null>(null);
  const [meetingForm, setMeetingForm] = useState<MeetingForm>({ name: "", sortOrder: 10, isActive: true });
  const [settingsForm, setSettingsForm] = useState<MasterSettings>(INITIAL_SETTINGS);

  const loadMaster = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      const result = await apiRequest<MasterDataResponse>("/api/master");
      setData(result);
      setSettingsForm(result.settings);
      setSelectedDepartmentId((current) =>
        current && result.departments.some((item) => item.id === current)
          ? current : result.departments[0]?.id ?? null);
    } catch (error) {
      setLoadError(errorText(error, "기준정보를 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void loadMaster(); }, []);

  const selectedDepartment = data.departments.find((item) => item.id === selectedDepartmentId);
  const selectedDetails = useMemo(() => data.reportDetails
    .filter((item) => item.departmentId === selectedDepartmentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
  [data.reportDetails, selectedDepartmentId]);

  const succeeded = async (text: string) => {
    await loadMaster(true);
    setNotice({ tone: "success", text });
  };
  const failed = (error: unknown, fallback: string) =>
    setNotice({ tone: "danger", text: errorText(error, fallback) });

  const departmentPayload = (form: DepartmentForm) => ({
    code: form.code.trim().toUpperCase(), name: form.name.trim(),
    leaderId: form.leaderId ? Number(form.leaderId) : null,
    sortOrder: Number(form.sortOrder), isActive: form.isActive,
  });
  const openDepartment = (item?: MasterDepartment) => {
    setEditingDepartment(item ?? null);
    setDepartmentForm(item ? {
      code: item.code, name: item.name, leaderId: item.leaderId ? String(item.leaderId) : "",
      sortOrder: item.sortOrder, isActive: item.isActive,
    } : { code: "", name: "", leaderId: "", sortOrder: nextOrder(data.departments), isActive: true });
    setDepartmentPanel(true);
  };
  const saveDepartment = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      await apiRequest(editingDepartment ? "/api/master/departments/" + editingDepartment.id : "/api/master/departments", {
        method: editingDepartment ? "PATCH" : "POST", body: JSON.stringify(departmentPayload(departmentForm)),
      });
      setDepartmentPanel(false);
      await succeeded(editingDepartment ? "부서 정보를 변경했습니다." : "부서를 추가했습니다.");
    } catch (error) { failed(error, "부서를 저장하지 못했습니다."); }
    finally { setSaving(false); }
  };
  const updateDepartment = async (item: MasterDepartment, changes: Partial<DepartmentForm>) => {
    try {
      await apiRequest("/api/master/departments/" + item.id, { method: "PATCH", body: JSON.stringify(departmentPayload({
        code: item.code, name: item.name, leaderId: item.leaderId ? String(item.leaderId) : "",
        sortOrder: item.sortOrder, isActive: item.isActive, ...changes,
      })) });
      await succeeded("부서 정보를 변경했습니다.");
    } catch (error) { failed(error, "부서를 변경하지 못했습니다."); }
  };
  const deleteDepartment = async (item: MasterDepartment) => {
    const blockReason = departmentDeleteBlockReason(item);
    if (blockReason) {
      const message = `${item.name} 부서는 ${blockReason}이 있어 삭제할 수 없습니다. 연결 데이터를 다른 부서로 이동하거나 삭제한 뒤 다시 시도하세요.`;
      setNotice({ tone: "danger", text: message });
      window.alert(message);
      return;
    }
    if (!window.confirm(item.name + " 부서를 삭제할까요?")) return;
    try {
      await apiRequest("/api/master/departments/" + item.id, { method: "DELETE" });
      await succeeded("부서를 삭제했습니다.");
    } catch (error) {
      const message = errorText(error, "부서를 삭제하지 못했습니다.");
      failed(error, message);
      window.alert(message);
    }
  };
  const reorderDepartments = async (index: number, offset: number) => {
    const current = data.departments[index], other = data.departments[index + offset];
    if (!current || !other) return;
    setSaving(true);
    try {
      await Promise.all([
        updateDepartmentRaw(current, other.sortOrder),
        updateDepartmentRaw(other, current.sortOrder),
      ]);
      await succeeded("부서 순서를 변경했습니다.");
    } catch (error) { failed(error, "순서를 변경하지 못했습니다."); }
    finally { setSaving(false); }
  };
  const updateDepartmentRaw = (item: MasterDepartment, sortOrder: number) =>
    apiRequest("/api/master/departments/" + item.id, { method: "PATCH", body: JSON.stringify({
      code: item.code, name: item.name, leaderId: item.leaderId, sortOrder, isActive: item.isActive,
    }) });

  const editCategory = async (item: MasterCategory) => {
    if (item.isSystem) return;
    const name = window.prompt("구분명을 입력하세요.", item.name)?.trim();
    if (!name || name === item.name) return;
    try {
      await apiRequest("/api/master/categories/" + item.id, {
        method: "PATCH", body: JSON.stringify({ name, sortOrder: item.sortOrder }),
      });
      await succeeded("보고서 구분명을 변경했습니다.");
    } catch (error) { failed(error, "구분명을 변경하지 못했습니다."); }
  };

  const detailPayload = (form: DetailForm) => ({
    departmentId: Number(form.departmentId), categoryId: Number(form.categoryId),
    name: form.name.trim(), sortOrder: Number(form.sortOrder), isActive: form.isActive,
  });
  const openDetail = (item?: MasterReportDetail, categoryId?: number) => {
    if (!selectedDepartmentId) return;
    setEditingDetail(item ?? null);
    const targetCategory = item?.categoryId ?? categoryId ??
      data.categories.find((category) => category.code !== "TRAVEL")?.id ?? 0;
    const peers = selectedDetails.filter((detail) => detail.categoryId === targetCategory);
    setDetailForm(item ? {
      departmentId: String(item.departmentId), categoryId: String(item.categoryId),
      name: item.name, sortOrder: item.sortOrder, isActive: item.isActive,
    } : {
      departmentId: String(selectedDepartmentId), categoryId: String(targetCategory),
      name: "", sortOrder: nextOrder(peers), isActive: true,
    });
    setDetailPanel(true);
  };
  const saveDetail = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      await apiRequest(editingDetail ? "/api/master/report-details/" + editingDetail.id : "/api/master/report-details", {
        method: editingDetail ? "PATCH" : "POST", body: JSON.stringify(detailPayload(detailForm)),
      });
      setDetailPanel(false);
      await succeeded(editingDetail ? "세부내용을 변경했습니다." : "세부내용을 추가했습니다.");
    } catch (error) { failed(error, "세부내용을 저장하지 못했습니다."); }
    finally { setSaving(false); }
  };
  const updateDetail = async (item: MasterReportDetail, changes: Partial<DetailForm>) => {
    try {
      await apiRequest("/api/master/report-details/" + item.id, {
        method: "PATCH", body: JSON.stringify(detailPayload({
          departmentId: String(item.departmentId), categoryId: String(item.categoryId),
          name: item.name, sortOrder: item.sortOrder, isActive: item.isActive, ...changes,
        })),
      });
      await succeeded("세부내용을 변경했습니다.");
    } catch (error) { failed(error, "세부내용을 변경하지 못했습니다."); }
  };
  const deleteDetail = async (item: MasterReportDetail) => {
    if (!window.confirm(item.name + " 세부내용을 삭제할까요?")) return;
    try {
      await apiRequest("/api/master/report-details/" + item.id, { method: "DELETE" });
      await succeeded("세부내용을 삭제했습니다.");
    } catch (error) { failed(error, "세부내용을 삭제하지 못했습니다."); }
  };
  const updateDetailRaw = (item: MasterReportDetail, sortOrder: number) =>
    apiRequest("/api/master/report-details/" + item.id, { method: "PATCH", body: JSON.stringify({
      departmentId: item.departmentId, categoryId: item.categoryId, name: item.name,
      sortOrder, isActive: item.isActive,
    }) });
  const reorderDetail = async (item: MasterReportDetail, offset: number) => {
    const peers = selectedDetails.filter((detail) => detail.categoryId === item.categoryId);
    const index = peers.findIndex((detail) => detail.id === item.id);
    const other = peers[index + offset];
    if (!other) return;
    setSaving(true);
    try {
      await Promise.all([updateDetailRaw(item, other.sortOrder), updateDetailRaw(other, item.sortOrder)]);
      await succeeded("세부내용 순서를 변경했습니다.");
    } catch (error) { failed(error, "순서를 변경하지 못했습니다."); }
    finally { setSaving(false); }
  };

  const meetingPayload = (form: MeetingForm) => ({
    name: form.name.trim(), sortOrder: Number(form.sortOrder), isActive: form.isActive,
  });
  const openMeeting = (item?: MasterMeetingType) => {
    setEditingMeeting(item ?? null);
    setMeetingForm(item ? {
      name: item.name, sortOrder: item.sortOrder, isActive: item.isActive,
    } : { name: "", sortOrder: nextOrder(data.meetingTypes), isActive: true });
    setMeetingPanel(true);
  };
  const saveMeeting = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      await apiRequest(editingMeeting ? "/api/master/meeting-types/" + editingMeeting.code : "/api/master/meeting-types", {
        method: editingMeeting ? "PATCH" : "POST", body: JSON.stringify(meetingPayload(meetingForm)),
      });
      setMeetingPanel(false);
      await succeeded(editingMeeting ? "회의구분을 변경했습니다." : "회의구분을 추가했습니다.");
    } catch (error) { failed(error, "회의구분을 저장하지 못했습니다."); }
    finally { setSaving(false); }
  };
  const updateMeeting = async (item: MasterMeetingType, changes: Partial<MeetingForm>) => {
    try {
      await apiRequest("/api/master/meeting-types/" + item.code, {
        method: "PATCH", body: JSON.stringify(meetingPayload({
          name: item.name, sortOrder: item.sortOrder, isActive: item.isActive, ...changes,
        })),
      });
      await succeeded("회의구분을 변경했습니다.");
    } catch (error) { failed(error, "회의구분을 변경하지 못했습니다."); }
  };
  const deleteMeeting = async (item: MasterMeetingType) => {
    if (!window.confirm(item.name + " 회의구분을 삭제할까요?")) return;
    try {
      await apiRequest("/api/master/meeting-types/" + item.code, { method: "DELETE" });
      await succeeded("회의구분을 삭제했습니다.");
    } catch (error) { failed(error, "회의구분을 삭제하지 못했습니다."); }
  };
  const updateMeetingRaw = (item: MasterMeetingType, sortOrder: number) =>
    apiRequest("/api/master/meeting-types/" + item.code, {
      method: "PATCH", body: JSON.stringify({ name: item.name, sortOrder, isActive: item.isActive }),
    });
  const reorderMeeting = async (index: number, offset: number) => {
    const current = data.meetingTypes[index], other = data.meetingTypes[index + offset];
    if (!current || !other) return;
    setSaving(true);
    try {
      await Promise.all([updateMeetingRaw(current, other.sortOrder), updateMeetingRaw(other, current.sortOrder)]);
      await succeeded("회의구분 순서를 변경했습니다.");
    } catch (error) { failed(error, "순서를 변경하지 못했습니다."); }
    finally { setSaving(false); }
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      const result = await apiRequest<MasterSettings>("/api/master/settings", {
        method: "PUT", body: JSON.stringify(settingsForm),
      });
      setSettingsForm(result);
      setData((current) => ({ ...current, settings: result }));
      setNotice({ tone: "success", text: "운영 설정을 저장했습니다. 변경 사항은 즉시 적용됩니다." });
    } catch (error) { failed(error, "운영 설정을 저장하지 못했습니다."); }
    finally { setSaving(false); }
  };

  if (loadError && !loading) {
    return <main className="workspace-page"><EmptyState title="기준정보를 불러오지 못했습니다."
      description={loadError}
      action={<button className="btn btn-outline" type="button" onClick={() => void loadMaster()}>다시 시도</button>}
    /></main>;
  }

  return <main className="workspace-page master-page">
    <header className="workspace-heading">
      <div><h1>마스터 관리</h1><p>보고서·회의·액션에서 사용하는 기준정보와 운영 정책을 관리합니다.</p></div>
      <StatusBadge tone="dark">관리자 전용</StatusBadge>
    </header>
    {notice && <div className={"callout callout-" + notice.tone} role="status">
      {notice.text}<button type="button" onClick={() => setNotice(null)} aria-label="알림 닫기">×</button>
    </div>}
    <div className="master-layout">
      <nav className="master-tabs card" aria-label="마스터 관리 항목">
        <TabButton active={tab === "departments"} icon={<Building2 />} label="부서(팀)" count={data.departments.length} onClick={() => setTab("departments")} />
        <TabButton active={tab === "details"} icon={<ListTree />} label="구분·세부내용" count={data.reportDetails.length} onClick={() => setTab("details")} />
        <TabButton active={tab === "meetings"} icon={<FileSliders />} label="회의구분" count={data.meetingTypes.length} onClick={() => setTab("meetings")} />
        <TabButton active={tab === "settings"} icon={<Settings2 />} label="운영 설정" onClick={() => setTab("settings")} />
      </nav>
      <section className="master-content card" aria-busy={loading}>
        {tab === "departments" && <>
          <SectionHeading title="부서(팀)" description="주간보고 팀과 액션 담당 부서에서 공통으로 사용합니다."
            action={<button className="btn btn-primary" type="button" onClick={() => openDepartment()}><CirclePlus /> 부서 추가</button>} />
          <DataTable caption="부서 목록" minWidth={820} empty={!loading && data.departments.length === 0}
            headers={<tr><th>순서</th><th>코드</th><th>부서명</th><th>팀장</th><th>사용 현황</th><th>사용</th><th>관리</th></tr>}>
            {data.departments.map((item, index) => <tr key={item.id} className={item.isActive ? undefined : "is-inactive"}>
              <td><OrderButtons up={index > 0} down={index < data.departments.length - 1} disabled={saving}
                onUp={() => void reorderDepartments(index, -1)} onDown={() => void reorderDepartments(index, 1)} /></td>
              <td><code>{item.code}</code></td><td><strong>{item.name}</strong></td><td>{item.leaderName ?? "미지정"}</td>
              <td><span className="master-usage"><Users /> 사원 {item.employeeCount}명</span><small>액션 {item.actionCount}건</small></td>
              <td><Toggle checked={item.isActive} label={item.name + " 사용 여부"} onChange={(value) => void updateDepartment(item, { isActive: value })} /></td>
              <td><RowActions onEdit={() => openDepartment(item)} onDelete={() => void deleteDepartment(item)}
                deleteTitle={departmentDeleteBlockReason(item) ?? `${item.name} 삭제`} /></td>
            </tr>)}
          </DataTable>
          <p className="master-help">소속 사원, 보고서 또는 액션이 있는 부서는 삭제할 수 없습니다. 사용 여부를 꺼 주세요.</p>
        </>}

        {tab === "details" && <>
          <SectionHeading title="구분·세부내용" description="구분은 전사 공통, 세부내용은 부서별로 관리합니다." />
          <div className="category-cards">
            {data.categories.map((category) => <article key={category.id} className={category.isSystem ? "is-locked" : undefined}>
              <StatusBadge tone={category.code === "KPI" ? "dark" : category.code === "GENERAL" ? "info" : "neutral"}>{category.code}</StatusBadge>
              <strong>{category.name}</strong>
              {category.isSystem
                ? <span><LockKeyhole /> 시스템 고정</span>
                : <button type="button" onClick={() => void editCategory(category)}><Pencil /> 이름 수정</button>}
            </article>)}
          </div>
          <div className="detail-workspace">
            <aside className="department-picker">
              <strong>부서 선택</strong>
              {data.departments.map((department) => <button key={department.id} type="button"
                className={selectedDepartmentId === department.id ? "is-active" : undefined}
                onClick={() => setSelectedDepartmentId(department.id)}>
                <span>{department.name}</span>
                <small>{data.reportDetails.filter((item) => item.departmentId === department.id).length}</small>
              </button>)}
            </aside>
            <div className="detail-lists">
              <SectionHeading compact title={(selectedDepartment?.name ?? "부서") + " 세부내용"}
                description={"전체 " + selectedDetails.length + "개 · 사용 " + selectedDetails.filter((item) => item.isActive).length + "개"} />
              {data.categories.filter((category) => category.code !== "TRAVEL").map((category) => {
                const rows = selectedDetails.filter((detail) => detail.categoryId === category.id);
                return <section className="detail-category" key={category.id}>
                  <header><div><StatusBadge tone={category.code === "KPI" ? "dark" : "info"}>{category.code}</StatusBadge>
                    <strong>{category.name}</strong><small>{rows.length}</small></div>
                    <button className="btn btn-small btn-outline" type="button" onClick={() => openDetail(undefined, category.id)}>
                      <CirclePlus /> 세부내용 추가
                    </button>
                  </header>
                  <DataTable caption={category.name + " 세부내용"} minWidth={620} empty={rows.length === 0}
                    emptyMessage="등록된 세부내용이 없습니다."
                    headers={<tr><th>순서</th><th>세부내용명</th><th>사용 현황</th><th>사용</th><th>관리</th></tr>}>
                    {rows.map((detail, index) => <tr key={detail.id} className={detail.isActive ? undefined : "is-inactive"}>
                      <td><OrderButtons up={index > 0} down={index < rows.length - 1} disabled={saving}
                        onUp={() => void reorderDetail(detail, -1)} onDown={() => void reorderDetail(detail, 1)} /></td>
                      <td><strong>{detail.name}</strong></td>
                      <td><button className="master-title-count-button" type="button"
                        disabled={detail.titleCount === 0} onClick={() => setTitleTraceDetail(detail)}>
                        <StatusBadge tone={detail.titleCount ? "info" : "neutral"}>타이틀 {detail.titleCount}개</StatusBadge>
                      </button></td>
                      <td><Toggle checked={detail.isActive} label={detail.name + " 사용 여부"} onChange={(value) => void updateDetail(detail, { isActive: value })} /></td>
                      <td><RowActions onEdit={() => openDetail(detail)} onDelete={() => void deleteDetail(detail)} deleteDisabled={detail.titleCount > 0} /></td>
                    </tr>)}
                  </DataTable>
                </section>;
              })}
              <p className="master-help">타이틀이 연결된 세부내용은 삭제할 수 없고 사용 해제만 가능합니다. 과거 보고서는 유지됩니다.</p>
            </div>
          </div>
        </>}
        {tab === "meetings" && <>
          <SectionHeading title="회의구분" description="회의록과 액션아이템 등록 시 선택하는 구분입니다."
            action={<button className="btn btn-primary" type="button" onClick={() => openMeeting()}><CirclePlus /> 회의구분 추가</button>} />
          <DataTable caption="회의구분 목록" minWidth={680} empty={!loading && data.meetingTypes.length === 0}
            headers={<tr><th>순서</th><th>회의구분명</th><th>코드</th><th>사용 현황</th><th>사용</th><th>관리</th></tr>}>
            {data.meetingTypes.map((item, index) => <tr key={item.code} className={item.isActive ? undefined : "is-inactive"}>
              <td><OrderButtons up={index > 0} down={index < data.meetingTypes.length - 1} disabled={saving}
                onUp={() => void reorderMeeting(index, -1)} onDown={() => void reorderMeeting(index, 1)} /></td>
              <td><strong>{item.name}</strong></td><td><code>{item.code}</code></td>
              <td><StatusBadge tone={item.usageCount ? "info" : "neutral"}>{item.usageCount}건</StatusBadge></td>
              <td><Toggle checked={item.isActive} label={item.name + " 사용 여부"} onChange={(value) => void updateMeeting(item, { isActive: value })} /></td>
              <td><RowActions onEdit={() => openMeeting(item)} onDelete={() => void deleteMeeting(item)} deleteDisabled={item.usageCount > 0} /></td>
            </tr>)}
          </DataTable>
          <p className="master-help">회의록이나 액션아이템에서 사용 중인 구분은 삭제할 수 없습니다.</p>
        </>}

        {tab === "settings" && <form className="settings-form" onSubmit={saveSettings}>
          <SectionHeading title="운영 설정" description="저장한 설정은 인증과 신규 업무 처리에 즉시 적용됩니다."
            action={<button className="btn btn-primary" type="submit" disabled={saving}><Save /> {saving ? "저장 중…" : "설정 저장"}</button>} />
          <SettingsSection title="보고서·액션" description="마감과 장기 미완료 판단 기준입니다.">
            <DayTimeField label="보고 마감" weekday={settingsForm.reportDeadlineWeekday} time={settingsForm.reportDeadlineTime}
              onWeekday={(value) => setSettingsForm((item) => ({ ...item, reportDeadlineWeekday: value }))}
              onTime={(value) => setSettingsForm((item) => ({ ...item, reportDeadlineTime: value }))} />
            <DayTimeField label="마감 임박 알림" weekday={settingsForm.reportReminderWeekday} time={settingsForm.reportReminderTime}
              onWeekday={(value) => setSettingsForm((item) => ({ ...item, reportReminderWeekday: value }))}
              onTime={(value) => setSettingsForm((item) => ({ ...item, reportReminderTime: value }))} />
            <NumberField label="장기 미완료 기준" value={settingsForm.actionOverdueDays} min={3} max={90} unit="일"
              onChange={(value) => setSettingsForm((item) => ({ ...item, actionOverdueDays: value }))} />
          </SettingsSection>
          <SettingsSection title="로그인·보안" description="비밀번호 규칙과 계정 잠금, 세션 정책입니다.">
            <NumberField label="비밀번호 최소 길이" value={settingsForm.passwordMinLength} min={8} max={20} unit="자"
              onChange={(value) => setSettingsForm((item) => ({ ...item, passwordMinLength: value }))} />
            <div className="setting-row"><div><strong>특수문자 필수</strong><small>새 비밀번호에 특수문자를 포함합니다.</small></div>
              <Toggle checked={settingsForm.passwordRequireSpecial} label="비밀번호 특수문자 필수"
                onChange={(value) => setSettingsForm((item) => ({ ...item, passwordRequireSpecial: value }))} /></div>
            <NumberField label="로그인 실패 허용" value={settingsForm.loginMaxFailures} min={3} max={10} unit="회"
              onChange={(value) => setSettingsForm((item) => ({ ...item, loginMaxFailures: value }))} />
            <NumberField label="계정 잠금 시간" value={settingsForm.loginLockMinutes} min={5} max={60} unit="분"
              onChange={(value) => setSettingsForm((item) => ({ ...item, loginLockMinutes: value }))} />
            <NumberField label="세션 유휴 만료" value={settingsForm.sessionIdleHours} min={1} max={24} unit="시간"
              onChange={(value) => setSettingsForm((item) => ({ ...item, sessionIdleHours: value }))} />
          </SettingsSection>
          <SettingsSection title="AI 사용량" description="사원 한 명이 하루 동안 사용할 수 있는 최대 요청 수입니다.">
            <NumberField label="일일 사용량 제한" value={settingsForm.aiDailyLimit} min={0} max={100000} unit="회 / 인"
              onChange={(value) => setSettingsForm((item) => ({ ...item, aiDailyLimit: value }))} />
          </SettingsSection>
        </form>}
      </section>
    </div>
    <SidePanel open={departmentPanel} title={editingDepartment ? "부서 수정" : "부서 추가"}
      description={editingDepartment ? "코드는 생성 후 변경할 수 없습니다." : "새 부서의 코드와 이름을 입력하세요."}
      onClose={() => setDepartmentPanel(false)}
      footer={<PanelFooter form="department-form" saving={saving} onClose={() => setDepartmentPanel(false)} />}>
      <form className="master-panel-form" id="department-form" onSubmit={saveDepartment}>
        <FormField id="department-code" label="팀 코드">
          <input className="input" id="department-code" value={departmentForm.code} disabled={editingDepartment !== null}
            maxLength={3} placeholder="T05" required
            onChange={(event) => setDepartmentForm((item) => ({ ...item, code: event.target.value.toUpperCase() }))} />
        </FormField>
        <FormField id="department-name" label="팀명">
          <input className="input" id="department-name" value={departmentForm.name} maxLength={20} required
            onChange={(event) => setDepartmentForm((item) => ({ ...item, name: event.target.value }))} />
        </FormField>
        {editingDepartment && <FormField id="department-leader" label="팀장">
          <select className="input" id="department-leader" value={departmentForm.leaderId}
            onChange={(event) => setDepartmentForm((item) => ({ ...item, leaderId: event.target.value }))}>
            <option value="">미지정</option>
            {data.employees.filter((employee) => employee.departmentId === editingDepartment.id && employee.status === "active")
              .map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </select>
        </FormField>}
        <FormField id="department-order" label="정렬 순서">
          <input className="input" id="department-order" type="number" min={0} max={999} value={departmentForm.sortOrder}
            onChange={(event) => setDepartmentForm((item) => ({ ...item, sortOrder: Number(event.target.value) }))} />
        </FormField>
        <ToggleRow title="사용 여부" description="끄면 신규 보고서와 배정 대상에서 제외됩니다."
          checked={departmentForm.isActive} label="부서 사용 여부"
          onChange={(value) => setDepartmentForm((item) => ({ ...item, isActive: value }))} />
      </form>
    </SidePanel>

    <SidePanel open={detailPanel} title={editingDetail ? "세부내용 수정" : "세부내용 추가"}
      description={selectedDepartment?.name} onClose={() => setDetailPanel(false)}
      footer={<PanelFooter form="detail-form" saving={saving} onClose={() => setDetailPanel(false)} />}>
      <form className="master-panel-form" id="detail-form" onSubmit={saveDetail}>
        <FormField id="detail-category" label="구분">
          <select className="input" id="detail-category" value={detailForm.categoryId}
            onChange={(event) => setDetailForm((item) => ({ ...item, categoryId: event.target.value }))}>
            {data.categories.filter((category) => category.code !== "TRAVEL")
              .map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </FormField>
        <FormField id="detail-name" label="세부내용명">
          <input className="input" id="detail-name" value={detailForm.name} maxLength={30}
            placeholder="예: 법무" required
            onChange={(event) => setDetailForm((item) => ({ ...item, name: event.target.value }))} />
        </FormField>
        <FormField id="detail-order" label="정렬 순서">
          <input className="input" id="detail-order" type="number" min={0} max={999} value={detailForm.sortOrder}
            onChange={(event) => setDetailForm((item) => ({ ...item, sortOrder: Number(event.target.value) }))} />
        </FormField>
        <ToggleRow title="사용 여부" description="끄면 새 보고서에서 표시되지 않습니다."
          checked={detailForm.isActive} label="세부내용 사용 여부"
          onChange={(value) => setDetailForm((item) => ({ ...item, isActive: value }))} />
      </form>
    </SidePanel>

    <SidePanel open={titleTraceDetail !== null} width="wide" title="연결된 타이틀"
      description={titleTraceDetail ? `${selectedDepartment?.name ?? "부서"} · ${titleTraceDetail.name}` : undefined}
      onClose={() => setTitleTraceDetail(null)}>
      <div className="master-title-trace-list">
        {titleTraceDetail && data.reportTitles.filter((item) => item.detailId === titleTraceDetail.id)
          .map((item) => <MasterTitleTraceCard key={item.id} item={item}
            onOpen={() => {
              setTitleTraceDetail(null);
              navigate(`/reports/${item.departmentCode}/${formatYearWeekSlug(item.latestYearWeek)}`);
            }} />)}
      </div>
    </SidePanel>

    <SidePanel open={meetingPanel} title={editingMeeting ? "회의구분 수정" : "회의구분 추가"}
      description="회의록과 액션에서 사용할 이름을 입력하세요." onClose={() => setMeetingPanel(false)}
      footer={<PanelFooter form="meeting-form" saving={saving} onClose={() => setMeetingPanel(false)} />}>
      <form className="master-panel-form" id="meeting-form" onSubmit={saveMeeting}>
        <FormField id="meeting-name" label="회의구분명">
          <input className="input" id="meeting-name" value={meetingForm.name} maxLength={10} required
            onChange={(event) => setMeetingForm((item) => ({ ...item, name: event.target.value }))} />
        </FormField>
        <FormField id="meeting-order" label="정렬 순서">
          <input className="input" id="meeting-order" type="number" min={0} max={999} value={meetingForm.sortOrder}
            onChange={(event) => setMeetingForm((item) => ({ ...item, sortOrder: Number(event.target.value) }))} />
        </FormField>
        <ToggleRow title="사용 여부" description="끄면 신규 회의 등록 선택지에서 제외됩니다."
          checked={meetingForm.isActive} label="회의구분 사용 여부"
          onChange={(value) => setMeetingForm((item) => ({ ...item, isActive: value }))} />
      </form>
    </SidePanel>
  </main>;
}

function MasterTitleTraceCard({ item, onOpen }: { item: MasterReportTitle; onOpen: () => void }) {
  const latest = splitYearWeek(item.latestYearWeek);
  const start = splitYearWeek(item.startYearWeek);
  const state = item.hiddenOnHold
    ? { label: "숨김 보류", tone: "warning" as const }
    : item.latestResult === "done" ? { label: "완료", tone: "success" as const }
    : item.latestResult === "stopped" ? { label: "중단", tone: "danger" as const }
    : item.latestResult === "hold" ? { label: "보류", tone: "warning" as const }
    : item.latestResult === "continue" ? { label: "계속", tone: "info" as const }
    : { label: "결과 미등록", tone: "neutral" as const };
  const reportStatus = item.latestReportStatus === "draft" ? "작성중"
    : item.latestReportStatus === "submitted" ? "제출"
    : item.latestReportStatus === "late" ? "지연 제출" : "확인 완료";
  return <article>
    <header><div><strong>{item.number !== null ? `${item.number}. ` : ""}{item.name}</strong>
      <span>{item.ownerName}</span></div><StatusBadge tone={state.tone}>{state.label}</StatusBadge></header>
    <dl>
      <div><dt>시작 주차</dt><dd>{start.year}년 {start.week}주차</dd></div>
      <div><dt>마지막 기록</dt><dd>{latest.year}년 {latest.week}주차 · {reportStatus}</dd></div>
    </dl>
    <button className="btn btn-outline" type="button" onClick={onOpen}><ExternalLink /> 마지막 보고서 보기</button>
  </article>;
}

function SectionHeading({ title, description, action, compact = false }: {
  title: string; description: string; action?: ReactNode; compact?: boolean;
}) {
  return <div className={"master-section-heading" + (compact ? " compact" : "")}>
    <div>{compact ? <h3>{title}</h3> : <h2>{title}</h2>}<p>{description}</p></div>{action}
  </div>;
}
function OrderButtons({ up, down, disabled, onUp, onDown }: {
  up: boolean; down: boolean; disabled: boolean; onUp: () => void; onDown: () => void;
}) {
  return <div className="order-buttons">
    <button type="button" disabled={!up || disabled} onClick={onUp} aria-label="위로 이동"><ChevronUp /></button>
    <button type="button" disabled={!down || disabled} onClick={onDown} aria-label="아래로 이동"><ChevronDown /></button>
  </div>;
}
function RowActions({ onEdit, onDelete, deleteDisabled = false, deleteTitle = "삭제" }: {
  onEdit: () => void; onDelete: () => void; deleteDisabled?: boolean; deleteTitle?: string;
}) {
  return <div className="table-actions">
    <button type="button" onClick={onEdit} aria-label="수정"><Pencil /></button>
    <button type="button" onClick={onDelete} disabled={deleteDisabled} aria-label="삭제" title={deleteTitle}><Trash2 /></button>
  </div>;
}
function PanelFooter({ form, saving, onClose }: { form: string; saving: boolean; onClose: () => void }) {
  return <><button className="btn btn-outline" type="button" onClick={onClose}>취소</button>
    <button className="btn btn-primary" type="submit" form={form} disabled={saving}>{saving ? "저장 중…" : "저장"}</button></>;
}
function FormField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="field"><label className="field-label" htmlFor={id}>{label}</label>{children}</div>;
}
function ToggleRow({ title, description, checked, label, onChange }: {
  title: string; description: string; checked: boolean; label: string; onChange: (value: boolean) => void;
}) {
  return <div className="setting-row"><div><strong>{title}</strong><small>{description}</small></div>
    <Toggle checked={checked} label={label} onChange={onChange} /></div>;
}
function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="settings-section"><header><h3>{title}</h3><p>{description}</p></header><div>{children}</div></section>;
}
function NumberField({ label, value, min, max, unit, onChange }: {
  label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void;
}) {
  return <label className="setting-row"><span><strong>{label}</strong><small>{min}~{max}{unit}</small></span>
    <span className="number-input"><input className="input" type="number" value={value} min={min} max={max}
      onChange={(event) => onChange(Number(event.target.value))} required /><em>{unit}</em></span></label>;
}
function DayTimeField({ label, weekday, time, onWeekday, onTime }: {
  label: string; weekday: number; time: string; onWeekday: (value: number) => void; onTime: (value: string) => void;
}) {
  return <div className="setting-row"><strong>{label}</strong><span className="day-time-input">
    <select className="input" value={weekday} onChange={(event) => onWeekday(Number(event.target.value))}>
      {WEEKDAYS.slice(1).map((day, index) => <option key={day} value={index + 1}>{day}</option>)}
    </select>
    <input className="input" type="time" step={1800} value={time} onChange={(event) => onTime(event.target.value)} required />
  </span></div>;
}
