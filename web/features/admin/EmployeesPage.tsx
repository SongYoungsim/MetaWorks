import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { FileDown, KeyRound, Plus, Search, Upload, UserRoundCheck, UserRoundX, UsersRound } from "lucide-react";
import { EMPLOYEE_STATUS_LABEL, ROLE_LABEL } from "@shared/types";
import type {
  EmployeeAdminItem,
  EmployeeBulkCreateResponse,
  EmployeeCreateRequest,
  EmployeeCredentialResult,
  EmployeeListResponse,
  EmployeeStatus,
  EmployeeUpdateRequest,
  Role,
} from "@shared/types";
import {
  DataTable,
  EmptyState,
  Modal,
  SegmentedControl,
  SidePanel,
  StatusBadge,
  SummaryCard,
  Toggle,
} from "@/components/ui";
import { apiRequest, ApiClientError } from "@/lib/api";
import { EMPLOYEE_NUMBER_MESSAGE, isEmployeeNumber, normalizeEmployeeNumber } from "@shared/employee";
import { createCsv } from "@shared/csv";
import { EMPLOYEE_CSV_HEADERS, parseEmployeeCsv } from "./employeeCsv";
import type { EmployeeImportPreview } from "./employeeCsv";

interface EmployeeFormState {
  name: string;
  loginId: string;
  empNo: string;
  departmentId: string;
  position: string;
  role: Role;
  isClerk: boolean;
  isAdmin: boolean;
  status: EmployeeStatus;
}

const EMPTY_FORM: EmployeeFormState = {
  name: "",
  loginId: "",
  empNo: "",
  departmentId: "",
  position: "",
  role: "member",
  isClerk: false,
  isAdmin: false,
  status: "active",
};

function employeeForm(employee: EmployeeAdminItem): EmployeeFormState {
  return {
    name: employee.name,
    loginId: employee.loginId,
    empNo: employee.empNo,
    departmentId: employee.departmentId ? String(employee.departmentId) : "",
    position: employee.position,
    role: employee.role,
    isClerk: employee.isClerk,
    isAdmin: employee.isAdmin,
    status: employee.status,
  };
}

function statusTone(status: EmployeeStatus) {
  if (status === "active") return "success" as const;
  if (status === "pending") return "warning" as const;
  return "neutral" as const;
}

function formatTimestamp(value: number | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function downloadCsv(fileName: string, rows: Array<Array<string | number>>) {
  const blob = new Blob(["\uFEFF" + createCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName; anchor.click();
  URL.revokeObjectURL(url);
}

async function readCsvFile(file: File) {
  const bytes = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("euc-kr").decode(bytes); }
}

export function EmployeesPage() {
  const [data, setData] = useState<EmployeeListResponse>({ employees: [], departments: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active_pending");
  const [selected, setSelected] = useState<EmployeeAdminItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<EmployeeFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [credential, setCredential] = useState<EmployeeCredentialResult | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<EmployeeImportPreview[]>([]);
  const [bulkFileName, setBulkFileName] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResult, setBulkResult] = useState<EmployeeBulkCreateResponse | null>(null);
  const bulkFileRef = useRef<HTMLInputElement | null>(null);

  const loadEmployees = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await apiRequest<EmployeeListResponse>("/api/employees"));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "사원 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEmployees();
  }, []);

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return data.employees.filter((employee) => {
      const matchesQuery =
        !normalizedQuery ||
        employee.name.toLowerCase().includes(normalizedQuery) ||
        employee.loginId.toLowerCase().includes(normalizedQuery) ||
        employee.empNo.toLowerCase().includes(normalizedQuery);
      const matchesDepartment =
        !departmentFilter || employee.departmentId === Number(departmentFilter);
      const matchesRole = !roleFilter || employee.role === roleFilter;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active_pending"
          ? employee.status !== "inactive"
          : employee.status === statusFilter);
      return matchesQuery && matchesDepartment && matchesRole && matchesStatus;
    });
  }, [data.employees, departmentFilter, query, roleFilter, statusFilter]);

  const summary = useMemo(
    () => ({
      total: data.employees.length,
      active: data.employees.filter((employee) => employee.status === "active").length,
      pending: data.employees.filter((employee) => employee.status === "pending").length,
      inactive: data.employees.filter((employee) => employee.status === "inactive").length,
    }),
    [data.employees],
  );

  const openCreate = () => {
    setCreating(true);
    setSelected(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setPanelOpen(true);
  };

  const openEmployee = (employee: EmployeeAdminItem) => {
    setCreating(false);
    setSelected(employee);
    setForm(employeeForm(employee));
    setFormError(null);
    setPanelOpen(true);
  };

  const setField = <K extends keyof EmployeeFormState>(key: K, value: EmployeeFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  };

  const saveEmployee = async (
    event: FormEvent<HTMLFormElement>,
    replaceLeader = false,
  ) => {
    event.preventDefault();
    if (!form.name.trim() || !form.loginId.trim() || !form.position.trim() || (creating && !form.empNo.trim())) {
      setFormError("이름, 아이디, 사번, 직급을 입력하세요.");
      return;
    }
    if (creating && form.empNo.trim() && !isEmployeeNumber(form.empNo)) {
      setFormError(EMPLOYEE_NUMBER_MESSAGE);
      return;
    }
    if (form.role !== "executive" && !form.departmentId) {
      setFormError("소속 팀을 선택하세요.");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const departmentId = form.departmentId ? Number(form.departmentId) : null;
      if (creating) {
        const request: EmployeeCreateRequest = {
          name: form.name.trim(),
          loginId: form.loginId.trim(),
          empNo: normalizeEmployeeNumber(form.empNo),
          departmentId,
          position: form.position.trim(),
          role: form.role,
          isClerk: form.isClerk,
          isAdmin: form.isAdmin,
          replaceLeader,
        };
        const result = await apiRequest<EmployeeCredentialResult>("/api/employees", {
          method: "POST",
          body: JSON.stringify(request),
        });
        setCredential(result);
      } else if (selected) {
        const request: EmployeeUpdateRequest = {
          name: form.name.trim(),
          departmentId,
          position: form.position.trim(),
          role: form.role,
          isClerk: form.isClerk,
          isAdmin: form.isAdmin,
          status: form.status,
          replaceLeader,
        };
        await apiRequest<EmployeeAdminItem>("/api/employees/" + selected.id, {
          method: "PATCH",
          body: JSON.stringify(request),
        });
      }
      setPanelOpen(false);
      await loadEmployees();
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.status === 409 &&
        error.details.fields?.role &&
        !replaceLeader &&
        window.confirm(error.message + "\\n기존 팀장을 팀원으로 변경하고 계속할까요?")
      ) {
        await saveEmployee(event, true);
        return;
      }
      setFormError(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    if (!selected || !window.confirm(selected.name + "님의 비밀번호를 초기화할까요?")) return;
    setSaving(true);
    try {
      const result = await apiRequest<EmployeeCredentialResult>(
        "/api/employees/" + selected.id + "/reset-password",
        { method: "POST" },
      );
      setCredential(result);
      setPanelOpen(false);
      await loadEmployees();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "비밀번호를 초기화하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const copyCredential = async () => {
    if (!credential) return;
    await navigator.clipboard.writeText(
      "아이디: " + credential.employee.loginId + "\\n임시 비밀번호: " + credential.temporaryPassword,
    );
  };

  const openBulk = () => {
    setBulkRows([]); setBulkFileName(""); setBulkError(null); setBulkOpen(true);
    if (bulkFileRef.current) bulkFileRef.current.value = "";
  };

  const loadBulkFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { setBulkError("CSV 파일만 선택할 수 있습니다."); return; }
    if (file.size > 2 * 1024 * 1024) { setBulkError("CSV 파일은 2MB 이하만 사용할 수 있습니다."); return; }
    try {
      const rows = parseEmployeeCsv(await readCsvFile(file), data.departments, data.employees);
      setBulkRows(rows); setBulkFileName(file.name); setBulkError(rows.length ? null : "등록할 사원 행이 없습니다.");
    } catch (error) { setBulkRows([]); setBulkFileName(file.name); setBulkError(error instanceof Error ? error.message : "CSV 파일을 읽지 못했습니다."); }
  };

  const registerBulk = async () => {
    const requests = bulkRows.flatMap((row) => row.request ? [row.request] : []);
    if (!requests.length || requests.length !== bulkRows.length || bulkSaving) return;
    setBulkSaving(true); setBulkError(null);
    try {
      const result = await apiRequest<EmployeeBulkCreateResponse>("/api/employees/bulk", { method: "POST", body: JSON.stringify({ items: requests }) });
      setBulkResult(result); setBulkOpen(false); await loadEmployees();
    } catch (error) { setBulkError(error instanceof Error ? error.message : "사원을 일괄 등록하지 못했습니다."); }
    finally { setBulkSaving(false); }
  };

  const downloadBulkResult = () => {
    if (!bulkResult) return;
    downloadCsv("사원_일괄등록_계정정보.csv", [["사번", "이름", "아이디", "임시비밀번호"],
      ...bulkResult.credentials.map((item) => [item.employee.empNo, item.employee.name, item.employee.loginId, item.temporaryPassword])]);
  };

  return (
    <main className="workspace-page employee-page">
      <header className="workspace-heading">
        <div>
          <h1>사원 · 권한</h1>
          <p>사원 계정과 역할, 추가 권한, 계정 상태를 관리합니다.</p>
        </div>
        <div className="workspace-heading-actions">
          <button className="btn btn-outline" type="button" onClick={openBulk}><Upload aria-hidden="true" />CSV 일괄등록</button>
          <button className="btn btn-primary" type="button" onClick={openCreate}><Plus aria-hidden="true" />사원 등록</button>
        </div>
      </header>

      <section className="employee-summary-grid">
        <SummaryCard label="전체 사원" value={summary.total} description="등록 전체" icon={<UsersRound />} />
        <SummaryCard label="재직" value={summary.active} description="현재 로그인 가능" icon={<UserRoundCheck />} />
        <SummaryCard label="첫 로그인 대기" value={summary.pending} description="임시 비밀번호 발급 상태" icon={<KeyRound />} />
        <SummaryCard label="비활성" value={summary.inactive} description="로그인 차단" icon={<UserRoundX />} />
      </section>

      <section className="employee-list-card card">
        <div className="employee-filters">
          <label className="employee-search">
            <Search aria-hidden="true" />
            <span className="sr-only">사원 검색</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름 · 아이디 · 사번 검색" />
          </label>
          <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} aria-label="팀 필터">
            <option value="">전체 팀</option>
            {data.departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} aria-label="역할 필터">
            <option value="">전체 역할</option>
            <option value="member">팀원</option>
            <option value="leader">팀장</option>
            <option value="executive">임원</option>
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="상태 필터">
            <option value="active_pending">재직 · 대기</option>
            <option value="active">재직</option>
            <option value="pending">첫 로그인 대기</option>
            <option value="inactive">비활성</option>
            <option value="all">전체 상태</option>
          </select>
          <span className="employee-result-count">{filteredEmployees.length}명</span>
        </div>

        {loadError ? (
          <EmptyState
            title="사원 목록을 불러오지 못했습니다."
            description={loadError}
            action={<button className="btn btn-outline" type="button" onClick={() => void loadEmployees()}>다시 시도</button>}
          />
        ) : (
          <DataTable
            caption="사원 목록"
            minWidth={980}
            empty={!loading && filteredEmployees.length === 0}
            emptyMessage="조건에 맞는 사원이 없습니다."
            headers={
              <tr>
                <th>이름</th>
                <th>소속 팀</th>
                <th>직급</th>
                <th>역할</th>
                <th>추가 권한</th>
                <th>상태</th>
                <th>마지막 로그인</th>
              </tr>
            }
          >
            {loading ? (
              <tr><td className="data-table-empty" colSpan={7}>불러오는 중…</td></tr>
            ) : (
              filteredEmployees.map((employee) => (
                <tr className={employee.status === "inactive" ? "is-inactive" : undefined} key={employee.id}>
                  <td>
                    <button className="employee-name-button" type="button" onClick={() => openEmployee(employee)}>
                      <span className="employee-avatar">{employee.name.slice(0, 1)}</span>
                      <span><strong>{employee.name}</strong><small>{employee.loginId} · {employee.empNo}</small></span>
                    </button>
                  </td>
                  <td>{employee.departmentName ?? "소속 없음"}</td>
                  <td>{employee.position}</td>
                  <td><StatusBadge tone={employee.role === "executive" ? "dark" : employee.role === "leader" ? "info" : "neutral"}>{ROLE_LABEL[employee.role]}</StatusBadge></td>
                  <td>
                    <div className="employee-permissions">
                      {employee.isAdmin && <StatusBadge tone="danger">관리자</StatusBadge>}
                      {employee.isClerk && <StatusBadge tone="warning">회의 서기</StatusBadge>}
                      {!employee.isAdmin && !employee.isClerk && "—"}
                    </div>
                  </td>
                  <td><StatusBadge tone={statusTone(employee.status)} dot>{EMPLOYEE_STATUS_LABEL[employee.status]}</StatusBadge></td>
                  <td>{formatTimestamp(employee.lastLoginAt)}</td>
                </tr>
              ))
            )}
          </DataTable>
        )}
      </section>

      <SidePanel
        open={panelOpen}
        title={creating ? "사원 등록" : selected?.name ?? "사원 정보"}
        description={creating ? "저장하면 임시 비밀번호가 한 번만 표시됩니다." : selected?.loginId}
        onClose={() => setPanelOpen(false)}
        footer={
          <>
            {!creating && (
              <button className="btn btn-ghost employee-reset-button" type="button" onClick={resetPassword} disabled={saving}>
                비밀번호 초기화
              </button>
            )}
            <button className="btn btn-outline" type="button" onClick={() => setPanelOpen(false)}>취소</button>
            <button className="btn btn-primary" type="submit" form="employee-form" disabled={saving}>
              {saving ? "저장 중…" : "저장"}
            </button>
          </>
        }
      >
        <form className="employee-form" id="employee-form" onSubmit={saveEmployee}>
          {formError && <div className="callout callout-danger" role="alert">{formError}</div>}
          <div className="employee-form-grid">
            <div className="field">
              <label className="field-label" htmlFor="employee-name">이름</label>
              <input id="employee-name" className="input" value={form.name} onChange={(event) => setField("name", event.target.value)} maxLength={20} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="employee-position">직급</label>
              <input id="employee-position" className="input" value={form.position} onChange={(event) => setField("position", event.target.value)} maxLength={30} />
            </div>
          </div>
          <div className="employee-form-grid">
            <div className="field">
              <label className="field-label" htmlFor="employee-login-id">아이디</label>
              <input id="employee-login-id" className="input" value={form.loginId} onChange={(event) => setField("loginId", event.target.value.toUpperCase())} disabled={!creating} maxLength={20} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="employee-no">사번</label>
              <input id="employee-no" className="input" value={form.empNo} onChange={(event) => setField("empNo", event.target.value.toUpperCase())} disabled={!creating} required={creating} maxLength={7} pattern="S[0-9]{6}" title="S로 시작하는 숫자 6자리 (예: S000001)" placeholder="필수 입력 · 예: S000001" />
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="employee-department">소속 팀</label>
            <select id="employee-department" className="input" value={form.departmentId} onChange={(event) => setField("departmentId", event.target.value)}>
              <option value="">{form.role === "executive" ? "소속 없음" : "팀 선택"}</option>
              {data.departments.filter((department) => department.isActive).map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">역할</span>
            <SegmentedControl
              label="사원 역할"
              value={form.role}
              onChange={(value) => setField("role", value as Role)}
              options={[
                { value: "member", label: "팀원" },
                { value: "leader", label: "팀장" },
                { value: "executive", label: "임원" },
              ]}
            />
          </div>
          <div className="employee-toggle-list">
            <div>
              <span><strong>회의 서기</strong><small>회의록 · 액션아이템 등록</small></span>
              <Toggle checked={form.isClerk} onChange={(value) => setField("isClerk", value)} label="회의 서기 권한" />
            </div>
            <div>
              <span><strong>시스템 관리자</strong><small>마스터 · 사원 · 권한 관리</small></span>
              <Toggle checked={form.isAdmin} onChange={(value) => setField("isAdmin", value)} label="시스템 관리자 권한" />
            </div>
          </div>
          {!creating && (
            <div className="field">
              <label className="field-label" htmlFor="employee-status">계정 상태</label>
              <select id="employee-status" className="input" value={form.status} onChange={(event) => setField("status", event.target.value as EmployeeStatus)}>
                {form.status === "pending" && <option value="pending">첫 로그인 대기</option>}
                <option value="active">재직</option>
                <option value="inactive">비활성</option>
              </select>
              <span className="field-hint">비활성으로 바꾸면 기존 로그인 세션이 즉시 종료됩니다.</span>
            </div>
          )}
        </form>
      </SidePanel>

      <Modal
        open={credential !== null}
        title="임시 비밀번호가 발급되었습니다"
        description="이 창을 닫으면 다시 볼 수 없습니다."
        onClose={() => setCredential(null)}
        size="small"
        footer={
          <>
            <button className="btn btn-outline" type="button" onClick={() => void copyCredential()}>계정 정보 복사</button>
            <button className="btn btn-primary" type="button" onClick={() => setCredential(null)}>확인</button>
          </>
        }
      >
        {credential && (
          <div className="credential-box">
            <dl>
              <div><dt>이름</dt><dd>{credential.employee.name}</dd></div>
              <div><dt>아이디</dt><dd>{credential.employee.loginId}</dd></div>
              <div><dt>임시 비밀번호</dt><dd>{credential.temporaryPassword}</dd></div>
            </dl>
            <p>사원에게 안전한 방법으로 전달하고 첫 로그인 시 새 비밀번호를 설정하도록 안내하세요.</p>
          </div>
        )}
      </Modal>

      <Modal
        open={bulkOpen}
        title="사원 CSV 일괄등록"
        description="CSV 내용을 검증한 뒤 오류가 없을 때 한 번에 등록합니다."
        onClose={() => !bulkSaving && setBulkOpen(false)}
        size="large"
        footer={<><button className="btn btn-outline" type="button" onClick={() => downloadCsv("사원_일괄등록_양식.csv", [EMPLOYEE_CSV_HEADERS])}><FileDown />CSV 양식 받기</button><span className="bulk-import-footer-spacer" /><button className="btn btn-outline" type="button" onClick={() => setBulkOpen(false)} disabled={bulkSaving}>취소</button><button className="btn btn-primary" type="button" onClick={() => void registerBulk()} disabled={bulkSaving || !bulkRows.length || bulkRows.some((row) => row.errors.length > 0)}>{bulkSaving ? "등록 중…" : `${bulkRows.length}명 일괄등록`}</button></>}
      >
        <div className="employee-bulk-import">
          <section className="employee-bulk-guide"><strong>필수 열</strong><p>사번 · 이름 · 아이디 · 비밀번호 · 소속팀 · 직급 · 역할 · 회의서기 · 관리자</p><ul><li>사번: S + 숫자 6자리 (예: S000002)</li><li>비밀번호: 1~64자, 최초 로그인 후 변경</li><li>소속팀: 팀 이름 또는 코드(T01 등), 임원만 공란 가능</li><li>역할: 팀원 / 팀장 / 임원</li><li>회의서기·관리자: Y / N</li></ul></section>
          <input ref={bulkFileRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => void loadBulkFile(event.target.files?.[0])} />
          <button className="employee-bulk-file" type="button" onClick={() => bulkFileRef.current?.click()}><Upload /><span><strong>{bulkFileName || "CSV 파일 선택"}</strong><small>UTF-8 또는 Excel CSV · 최대 2MB · 최대 100명</small></span></button>
          {bulkError && <div className="callout callout-danger" role="alert">{bulkError}</div>}
          {bulkRows.length > 0 && <><div className="employee-bulk-summary"><strong>미리보기 {bulkRows.length}명</strong><span className={bulkRows.some((row) => row.errors.length) ? "is-error" : "is-valid"}>{bulkRows.filter((row) => row.errors.length).length ? `오류 ${bulkRows.filter((row) => row.errors.length).length}행` : "모든 행 검증 완료"}</span></div><div className="employee-bulk-table"><table><thead><tr><th>행</th>{EMPLOYEE_CSV_HEADERS.map((header) => <th key={header}>{header}</th>)}<th>검증</th></tr></thead><tbody>{bulkRows.map((row) => <tr className={row.errors.length ? "is-error" : undefined} key={row.sourceRow}><td>{row.sourceRow}</td>{row.values.map((value, index) => <td key={index}>{value || "-"}</td>)}<td>{row.errors.length ? row.errors.join(" · ") : "정상"}</td></tr>)}</tbody></table></div></>}
        </div>
      </Modal>

      <Modal open={bulkResult !== null} title="사원 일괄등록 완료" description="CSV에 입력한 초기 비밀번호가 적용되었습니다." onClose={() => setBulkResult(null)} size="large" footer={<><button className="btn btn-outline" type="button" onClick={downloadBulkResult}><FileDown />계정정보 CSV 받기</button><button className="btn btn-primary" type="button" onClick={() => setBulkResult(null)}>확인</button></>}>
        {bulkResult && <div className="employee-bulk-result"><p>{bulkResult.credentials.length}명의 계정을 생성했습니다. 계정정보 CSV를 내려받아 안전하게 전달하세요.</p><div className="employee-bulk-table"><table><thead><tr><th>사번</th><th>이름</th><th>아이디</th><th>임시 비밀번호</th></tr></thead><tbody>{bulkResult.credentials.map((item) => <tr key={item.employee.id}><td>{item.employee.empNo}</td><td>{item.employee.name}</td><td>{item.employee.loginId}</td><td><code>{item.temporaryPassword}</code></td></tr>)}</tbody></table></div></div>}
      </Modal>
    </main>
  );
}
