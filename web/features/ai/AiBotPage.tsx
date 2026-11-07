import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Bot, Check, Clipboard, FileText, History, LoaderCircle, MessageSquarePlus, MoreHorizontal, Paperclip, Pencil, RotateCcw, Search, Send, Sparkles, Square, ThumbsDown, ThumbsUp, Trash2, TriangleAlert, X } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import type { AiConversationDetail, AiConversationSummary, AiMessageItem, AiPeriod, AiRiskNotifyResponse, AiRiskReviewResponse, AiScope, AiSource } from "@shared/types";
import { apiRequest } from "@/lib/api";
import { AiMarkdown } from "./AiMarkdown";

const QUICK = [
  { id: "question", icon: Search, title: "보고서 · 회의록 질문", text: "채용 건은 지금 어디까지 진행됐어?" },
  { id: "summary", icon: FileText, title: "주간 요약 만들기", text: "이번 주 주요 업무와 결정 필요 사항, 리스크를 요약해 줘." },
  { id: "instructions", icon: Sparkles, title: "지시사항 확인", text: "최근 회의에서 나온 주요 지시사항과 담당 부서를 정리해 줘." },
  { id: "risk", icon: TriangleAlert, title: "지연 · 리스크 액션", text: "오래 묵거나 진행 등록이 없는 액션을 점검합니다." },
];
const AI_FILE_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.html,.htm";
const AI_FILE_EXTENSIONS = new Set(AI_FILE_ACCEPT.split(",").map((item) => item.slice(1)));
const MAX_AI_FILE_BYTES = 10 * 1024 * 1024;

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

type StreamEvent =
  | { type: "meta"; conversation: AiConversationSummary; userMessage: AiMessageItem; sources: AiSource[] }
  | { type: "delta"; content: string }
  | { type: "done"; conversation: AiConversationSummary; assistantMessage: AiMessageItem }
  | { type: "error"; message: string };

function groupLabel(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diff = start - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (diff < 86_400_000) return "오늘";
  if (diff < 7 * 86_400_000) return "이번 주";
  if (diff < 14 * 86_400_000) return "지난주";
  return "이전";
}

export function AiBotPage() {
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [detail, setDetail] = useState<AiConversationDetail | null>(null);
  const [question, setQuestion] = useState(() => searchParams.get("prompt") ?? "");
  const [scope, setScope] = useState<AiScope>("all");
  const [period, setPeriod] = useState<AiPeriod>("8");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationQuery, setConversationQuery] = useState("");
  const [conversationMenuId, setConversationMenuId] = useState<number | null>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [retryQuestion, setRetryQuestion] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [riskReview, setRiskReview] = useState<AiRiskReviewResponse | null>(null);
  const [riskPending, setRiskPending] = useState(false);
  const [selectedRiskIds, setSelectedRiskIds] = useState<number[]>([]);
  const [riskNotice, setRiskNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadConversations = () => apiRequest<AiConversationSummary[]>("/api/ai/conversations")
    .then(setConversations).finally(() => setLoading(false));
  useEffect(() => { void loadConversations().catch((reason) => setError(reason instanceof Error ? reason.message : "대화 기록을 불러오지 못했습니다.")); }, []);

  const filteredConversations = useMemo(() => {
    const query = conversationQuery.trim().toLocaleLowerCase();
    return query ? conversations.filter((item) => item.title.toLocaleLowerCase().includes(query)) : conversations;
  }, [conversationQuery, conversations]);
  const grouped = useMemo(() => filteredConversations.reduce<Record<string, AiConversationSummary[]>>((result, item) => {
    (result[groupLabel(item.updatedAt)] ??= []).push(item); return result;
  }, {}), [filteredConversations]);

  const openConversation = async (id: number) => {
    setError(null); setHistoryOpen(false);
    try { setDetail(await apiRequest<AiConversationDetail>(`/api/ai/conversations/${id}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "대화를 불러오지 못했습니다."); }
  };
  const newConversation = () => { abortRef.current?.abort(); setDetail(null); setQuestion(""); setAttachedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; setError(null); setRetryQuestion(null); setRiskReview(null); setRiskNotice(null); setConversationMenuId(null); setHistoryOpen(false); };
  const reviewRisks = async () => {
    if (riskPending) return; setRiskPending(true); setError(null); setRiskNotice(null);
    try {
      const result = await apiRequest<AiRiskReviewResponse>("/api/ai/risk-review", { method: "POST", body: JSON.stringify({ scope }) });
      setRiskReview(result); setSelectedRiskIds(result.groups.flatMap((group) => group.items.map((item) => item.id)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "지연·리스크 액션을 점검하지 못했습니다."); }
    finally { setRiskPending(false); }
  };
  const notifyRisks = async () => {
    if (!riskReview || !selectedRiskIds.length || riskPending) return;
    const selectedGroups = riskReview.groups.filter((group) => group.items.some((item) => selectedRiskIds.includes(item.id)));
    const summary = selectedGroups.map((group) => `${group.departmentName} ${group.items.filter((item) => selectedRiskIds.includes(item.id)).length}건`).join(" · ");
    if (!window.confirm(`${summary}\\n\\n해당 부서장에게 알림을 보낼까요?`)) return;
    setRiskPending(true); setError(null);
    try {
      const result = await apiRequest<AiRiskNotifyResponse>("/api/ai/risk-notify", { method: "POST", body: JSON.stringify({ scope, actionIds: selectedRiskIds }) });
      setRiskNotice(`${result.sentDepartments}개 부서에 ${result.sentActions}건의 알림을 보냈습니다.${result.skippedActions ? ` ${result.skippedActions}건은 최근 발송 또는 부서장 미지정으로 제외됐습니다.` : ""}`);
      setSelectedRiskIds([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "부서장 알림을 보내지 못했습니다."); }
    finally { setRiskPending(false); }
  };
  const send = async (questionOverride?: string) => {
    const value = questionOverride?.trim() || question.trim() || (attachedFile ? "이 첨부파일의 핵심 내용을 요약해 줘." : ""); if (!value || sending) return;
    setSending(true); setError(null); setRetryQuestion(value);
    const controller = new AbortController(); abortRef.current = controller;
    const temporaryId = -Date.now();
    const previousMessages = detail?.messages ?? [];
    let activeConversationId = detail?.id;
    let completed = false;
    try {
      let body: BodyInit; let headers: HeadersInit | undefined;
      if (attachedFile) {
        const form = new FormData();
        if (detail?.id) form.set("conversationId", String(detail.id));
        form.set("question", value); form.set("scope", scope); form.set("period", period); form.set("file", attachedFile);
        body = form;
      } else {
        headers = { "Content-Type": "application/json" };
        body = JSON.stringify({ conversationId: detail?.id, question: value, scope, period });
      }
      const response = await fetch("/api/ai/chat/stream", { method: "POST", credentials: "same-origin", headers, body, signal: controller.signal });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "답변을 생성하지 못했습니다.");
      }
      if (!response.body) throw new Error("스트리밍 응답을 열지 못했습니다.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value: chunk } = await reader.read();
        buffer += decoder.decode(chunk, { stream: !done });
        const lines = buffer.split("\\n"); buffer = done ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;
          if (event.type === "meta") {
            activeConversationId = event.conversation.id; setQuestion(""); setAttachedFile(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
            setDetail({ ...event.conversation, messages: [...previousMessages, event.userMessage, { id: temporaryId, role: "assistant", content: "", sources: event.sources, attachments: [], feedback: null, createdAt: Date.now() }] });
          } else if (event.type === "delta") {
            setDetail((current) => current ? { ...current, messages: current.messages.map((item) => item.id === temporaryId ? { ...item, content: item.content + event.content } : item) } : current);
          } else if (event.type === "done") {
            completed = true; setRetryQuestion(null); setDetail((current) => current ? { ...event.conversation, messages: current.messages.map((item) => item.id === temporaryId ? event.assistantMessage : item) } : current);
          } else if (event.type === "error") throw new Error(event.message);
        }
        if (done) break;
      }
      if (!completed) throw new Error("답변 생성이 완료되지 않았습니다. 다시 시도하세요.");
      await loadConversations();
    } catch (reason) {
      const message = controller.signal.aborted
        ? "답변 생성을 중지했습니다."
        : reason instanceof Error ? reason.message : "답변을 생성하지 못했습니다. 다시 시도하세요.";
      if (activeConversationId) await openConversation(activeConversationId);
      setError(message);
    } finally { abortRef.current = null; setSending(false); }
  };
  const stop = () => abortRef.current?.abort();
  const selectFile = (file: File | undefined) => {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!AI_FILE_EXTENSIONS.has(extension)) { setError("PDF, Word, Excel, PowerPoint, CSV, TXT, Markdown, HTML 파일만 첨부할 수 있습니다."); if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    if (file.size < 1 || file.size > MAX_AI_FILE_BYTES) { setError("AI 첨부파일은 10MB 이하만 사용할 수 있습니다."); if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    setError(null); setAttachedFile(file);
  };
  const renameConversation = async (item: AiConversationSummary) => {
    const title = window.prompt("새 대화 제목을 입력하세요.", item.title)?.trim();
    if (!title || title === item.title) { setConversationMenuId(null); return; }
    if (title.length > 80) { setError("대화 제목은 80자 이내로 입력하세요."); return; }
    try {
      await apiRequest(`/api/ai/conversations/${item.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
      setConversations((current) => current.map((conversation) => conversation.id === item.id ? { ...conversation, title } : conversation));
      setDetail((current) => current?.id === item.id ? { ...current, title } : current);
      setConversationMenuId(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "대화 제목을 변경하지 못했습니다."); }
  };
  const removeConversation = async (item: AiConversationSummary) => {
    if (!window.confirm(`\"${item.title}\" 대화를 삭제할까요? 삭제 후 복구할 수 없습니다.`)) return;
    try {
      await apiRequest(`/api/ai/conversations/${item.id}`, { method: "DELETE" });
      if (detail?.id === item.id) newConversation();
      else setConversationMenuId(null);
      await loadConversations();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "대화를 삭제하지 못했습니다."); }
  };
  const copy = async (id: number, content: string) => {
    await navigator.clipboard.writeText(content); setCopiedId(id); window.setTimeout(() => setCopiedId(null), 1500);
  };
  const rateAnswer = async (id: number, rating: "up" | "down") => {
    try {
      await apiRequest(`/api/ai/messages/${id}/feedback`, { method: "POST", body: JSON.stringify({ rating }) });
      setDetail((current) => current ? { ...current, messages: current.messages.map((item) => item.id === id ? { ...item, feedback: rating } : item) } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "답변 평가를 저장하지 못했습니다."); }
  };

  return <main className="workspace-page ai-page">
    <header className="workspace-heading ai-heading"><div><h1>AI봇</h1><p>등록된 업무 데이터를 근거로 질문하고 요약합니다.</p></div>
      <button className="btn btn-outline ai-history-button" type="button" onClick={() => setHistoryOpen(true)}><History /> 대화 기록</button>
      <button className="btn btn-primary" type="button" onClick={newConversation}><MessageSquarePlus /> 새 대화</button>
    </header>
    <div className="ai-layout">
      <aside className={`ai-history card${historyOpen ? " is-open" : ""}`}>
        <header><strong>대화 기록</strong><button type="button" onClick={newConversation}><MessageSquarePlus /><span>새 대화</span></button></header>
        <label className="ai-history-search"><Search /><input type="search" value={conversationQuery} placeholder="대화 제목 검색" aria-label="대화 제목 검색" onChange={(event) => setConversationQuery(event.target.value)} /></label>
        {loading ? <div className="ai-history-empty"><LoaderCircle className="spin" /> 불러오는 중</div> : conversations.length ?
          filteredConversations.length ? <div className="ai-history-groups">{["오늘", "이번 주", "지난주", "이전"].map((group) => grouped[group]?.length ? <section key={group}><h2>{group}</h2>{grouped[group].map((item) => <div className={`ai-history-item${detail?.id === item.id ? " is-active" : ""}`} key={item.id}><button className="ai-history-open" type="button" onClick={() => void openConversation(item.id)}><Bot /><span>{item.title}</span></button><button className="ai-history-more" type="button" aria-label={`${item.title} 메뉴`} aria-expanded={conversationMenuId === item.id} onClick={() => setConversationMenuId((current) => current === item.id ? null : item.id)}><MoreHorizontal /></button>{conversationMenuId === item.id && <div className="ai-history-menu"><button type="button" onClick={() => void renameConversation(item)}><Pencil />제목 변경</button><button type="button" onClick={() => void removeConversation(item)}><Trash2 />삭제</button></div>}</div>)}</section> : null)}</div>
          : <div className="ai-history-empty">검색 결과가 없습니다.</div>
          : <div className="ai-history-empty">아직 대화 기록이 없습니다.</div>}
      </aside>
      {historyOpen && <button className="ai-history-backdrop" aria-label="대화 기록 닫기" onClick={() => setHistoryOpen(false)} />}
      <section className="ai-chat card">
        <header className="ai-chat-header"><div><Bot /><span><strong>{detail?.title ?? "새 대화"}</strong><small>Workers AI · 내부 데이터 근거</small></span></div>{detail && <button className="btn btn-ghost ai-delete" type="button" onClick={() => void removeConversation(detail)}><Trash2 /> 삭제</button>}</header>
        <div className="ai-messages">
          {!detail?.messages.length && !riskReview && <div className="ai-welcome"><span><Sparkles /></span><h2>무엇을 확인해 드릴까요?</h2><p>주간보고, 회의록, 액션아이템과 진행 이력을 함께 찾아 답변합니다.</p><div className="ai-quick-grid">{QUICK.map(({ id, icon: Icon, title, text }) => <button type="button" key={title} disabled={riskPending} onClick={() => id === "risk" ? void reviewRisks() : setQuestion(text)}><Icon /><span><strong>{title}</strong><small>{text}</small></span></button>)}</div></div>}
          {riskReview && <section className="ai-risk-review"><header><div><span><TriangleAlert /></span><div><h2>지연 · 리스크 액션 점검</h2><p>지시 후 {riskReview.overdueDays}일 이상 경과하거나 진행 등록이 없는 액션 {riskReview.total}건</p></div></div><button type="button" aria-label="점검 결과 닫기" onClick={() => setRiskReview(null)}><X /></button></header>
            {riskNotice && <div className="ai-risk-notice"><Check />{riskNotice}</div>}
            {!riskReview.total ? <div className="ai-risk-empty">주의가 필요한 액션이 없습니다.</div> : <div className="ai-risk-groups">{riskReview.groups.map((group) => <section key={group.departmentId}><header><label><input type="checkbox" checked={group.items.every((item) => selectedRiskIds.includes(item.id))} onChange={(event) => setSelectedRiskIds((current) => event.target.checked ? [...new Set([...current, ...group.items.map((item) => item.id)])] : current.filter((id) => !group.items.some((item) => item.id === id)))} /><strong>{group.departmentName}</strong><span>{group.items.length}건</span></label>{!group.hasLeader && <em>부서장 미지정</em>}</header><ul>{group.items.map((item) => <li key={item.id}><label><input type="checkbox" checked={selectedRiskIds.includes(item.id)} onChange={(event) => setSelectedRiskIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span><Link to={item.link}>{item.subject}</Link><small>{item.reasons.join(" · ")} · {item.meetingDate}</small></span></label><b>D+{item.elapsedDays}</b></li>)}</ul></section>)}</div>}
            {riskReview.canNotify && riskReview.total > 0 && <footer><p>동일 액션에는 24시간 이내 다시 알림을 보내지 않습니다.</p><button className="btn btn-primary" type="button" disabled={!selectedRiskIds.length || riskPending} onClick={() => void notifyRisks()}>{riskPending ? <LoaderCircle className="spin" /> : <Bell />} 선택한 {selectedRiskIds.length}건 부서장 알림</button></footer>}
          </section>}
          {detail?.messages.map((item) => <article className={`ai-message is-${item.role}`} key={item.id}><div className="ai-avatar">{item.role === "assistant" ? <Bot /> : "나"}</div><div className="ai-message-body">{item.attachments.length > 0 && <div className="ai-message-files">{item.attachments.map((file) => <a href={file.url} key={file.id}><Paperclip /><span>{file.fileName}</span><small>{fileSize(file.size)}</small></a>)}</div>}<div className={`ai-bubble${item.id < 0 ? " is-streaming" : ""}`}>{item.id < 0 && !item.content ? <span className="ai-thinking"><LoaderCircle className="spin" /> 내부 업무 데이터를 확인하고 있습니다.</span> : item.role === "assistant" ? <AiMarkdown content={item.content} /> : item.content}{item.id < 0 && item.content && <i className="ai-stream-cursor" />}</div>{item.role === "assistant" && item.id > 0 && <div className="ai-answer-tools"><button type="button" onClick={() => void copy(item.id, item.content)}>{copiedId === item.id ? <Check /> : <Clipboard />}{copiedId === item.id ? "복사됨" : "복사"}</button><span /><button className={item.feedback === "up" ? "is-active" : ""} type="button" aria-label="도움이 된 답변" title="도움이 됐어요" onClick={() => void rateAnswer(item.id, "up")}><ThumbsUp /></button><button className={item.feedback === "down" ? "is-active" : ""} type="button" aria-label="개선이 필요한 답변" title="개선이 필요해요" onClick={() => void rateAnswer(item.id, "down")}><ThumbsDown /></button></div>}{item.sources.length > 0 && <div className="ai-sources"><strong>확인한 출처 {item.sources.length}개</strong><div>{item.sources.map((source) => source.type === "file" ? <a href={source.link} key={`${source.type}-${source.id}`}><Paperclip /><span>{source.label}</span></a> : <Link to={source.link} key={`${source.type}-${source.id}`}>{source.type === "report" ? <FileText /> : source.type === "meeting" ? <History /> : <Check />}<span>{source.label}</span></Link>)}</div></div>}</div></article>)}
          {sending && !detail?.messages.some((item) => item.id < 0) && <article className="ai-message is-assistant"><div className="ai-avatar"><Bot /></div><div className="ai-bubble ai-thinking"><LoaderCircle className="spin" /> 관련 업무 데이터를 찾고 있습니다.</div></article>}
        </div>
        <footer className="ai-composer"><div className="ai-query-options"><label>범위<select value={scope} onChange={(event) => setScope(event.target.value as AiScope)}><option value="all">전체</option><option value="team">내 팀</option></select></label><label>기간<select value={period} onChange={(event) => setPeriod(event.target.value as AiPeriod)}><option value="4">최근 4주</option><option value="8">최근 8주</option><option value="12">최근 12주</option><option value="all">전체</option></select></label></div>
          {error && <div className="ai-error"><span>{error}</span>{retryQuestion && <button type="button" disabled={sending} onClick={() => void send(retryQuestion)}><RotateCcw />다시 시도</button>}</div>}<div className="ai-input-wrap">{attachedFile && <div className="ai-attached-file"><Paperclip /><span><strong>{attachedFile.name}</strong><small>{fileSize(attachedFile.size)}</small></span><button type="button" aria-label="첨부파일 제거" disabled={sending} onClick={() => { setAttachedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}><X /></button></div>}<textarea value={question} maxLength={4000} rows={3} placeholder={attachedFile ? "파일에 관해 질문하세요. 비워 두면 핵심 내용을 요약합니다." : "업무 현황을 질문하세요. Enter로 전송, Shift+Enter로 줄바꿈"}
            disabled={sending} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /><input ref={fileInputRef} type="file" accept={AI_FILE_ACCEPT} hidden onChange={(event) => selectFile(event.target.files?.[0])} /><button className="ai-attach-button" type="button" disabled={sending} aria-label="분석할 파일 첨부" title="파일 첨부 (최대 10MB)" onClick={() => fileInputRef.current?.click()}><Paperclip /></button><span>{question.length.toLocaleString()}/4,000</span><button className={sending ? "is-stop" : ""} type="button" disabled={!sending && !question.trim() && !attachedFile} onClick={() => sending ? stop() : void send()} aria-label={sending ? "답변 생성 중지" : "질문 보내기"}>{sending ? <Square /> : <Send />}</button></div>
          <p>PDF·Word·Excel·PowerPoint·CSV·텍스트 파일, 최대 10MB · AI 답변은 틀릴 수 있으니 출처를 확인하세요.</p>
        </footer>
      </section>
    </div>
  </main>;
}
