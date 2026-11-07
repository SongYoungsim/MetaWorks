import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellRing,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  FilePenLine,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Scale,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { ROLE_LABEL, type NotificationItem, type NotificationListResponse } from "@shared/types";
import { useAuth } from "@/features/auth/AuthProvider";
import { apiRequest } from "@/lib/api";

const SIDEBAR_COLLAPSED_KEY = "metawork.sidebarCollapsed";

interface MenuItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

const WORK_MENU: MenuItem[] = [
  { label: "대시보드", to: "/dashboard", icon: LayoutDashboard },
  { label: "주간업무보고 작성", to: "/reports", icon: FilePenLine },
  { label: "회의록 등록", to: "/meetings", icon: ClipboardCheck },
  { label: "액션아이템 등록", to: "/actions/register", icon: ShieldCheck },
  { label: "액션트래킹", to: "/actions/tracking", icon: ClipboardCheck },
  { label: "AI봇", to: "/ai", icon: Bot },
];

const ADMIN_MENU: MenuItem[] = [
  { label: "마스터 관리", to: "/admin/master", icon: Settings },
  { label: "사원 · 권한", to: "/admin/employees", icon: Users },
];

const PATH_LABELS: Array<[string, string]> = [
  ["/admin/employees", "사원 · 권한"],
  ["/admin/master", "마스터 관리"],
  ["/actions/tracking", "액션트래킹"],
  ["/actions/register", "액션아이템 등록"],
  ["/meetings", "회의록 등록"],
  ["/reports", "주간업무보고 작성"],
  ["/dashboard", "대시보드"],
  ["/ai", "AI봇"],
];

function currentPageLabel(pathname: string): string {
  return PATH_LABELS.find(([path]) => pathname.startsWith(path))?.[1] ?? "업무트래커";
}

function notificationTime(createdAt: number) {
  const elapsed = Math.max(0, Date.now() - createdAt);
  if (elapsed < 60_000) return "방금";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}분 전`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}시간 전`;
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)}일 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" }).format(createdAt);
}

function NotificationTypeIcon({ type }: { type: string }) {
  if (type.includes("action") || type === "N05") return <ClipboardCheck />;
  if (type.includes("decision") || type === "N03" || type === "N04") return <Scale />;
  if (type.includes("report") || type === "N02" || type === "N07") return <FileCheck2 />;
  if (type.includes("overdue") || type === "N01" || type === "N06") return <AlertTriangle />;
  return <BellRing />;
}

interface SidebarProps {
  collapsed: boolean;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}

function Sidebar({ collapsed, drawerOpen, onCloseDrawer }: SidebarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  const renderMenu = (item: MenuItem) => {
    const Icon = item.icon;
    return (
      <NavLink
        className={({ isActive }) => "sidebar-link" + (isActive ? " is-active" : "")}
        key={item.to}
        to={item.to}
        onClick={onCloseDrawer}
        title={collapsed ? item.label : undefined}
      >
        <Icon aria-hidden="true" />
        <span>{item.label}</span>
      </NavLink>
    );
  };

  return (
    <>
      <button
        className={"sidebar-backdrop" + (drawerOpen ? " is-open" : "")}
        type="button"
        aria-label="메뉴 닫기"
        onClick={onCloseDrawer}
      />
      <aside
        className={
          "app-sidebar" +
          (collapsed ? " is-collapsed" : "") +
          (drawerOpen ? " is-drawer-open" : "")
        }
        aria-label="주 메뉴"
      >
        <div className="sidebar-brand">
          <img
            className="sidebar-logo"
            src={collapsed ? "/logo_icon.png" : "/logo-inverse.png"}
            alt="META SYSTEMS"
          />
          <button className="sidebar-mobile-close" type="button" onClick={onCloseDrawer} aria-label="메뉴 닫기">
            <X aria-hidden="true" />
          </button>
          {!collapsed && (
            <p className="sidebar-service">
              업무트래커
              <span>{user?.department?.name ?? "전사"}</span>
            </p>
          )}
        </div>

        <nav className="sidebar-nav">
          <p className="sidebar-section-label">업무</p>
          {WORK_MENU.map(renderMenu)}

          {user?.isAdmin && (
            <>
              <p className="sidebar-section-label sidebar-admin-label">관리</p>
              {ADMIN_MENU.map(renderMenu)}
            </>
          )}
        </nav>

        <div className="sidebar-user">
          {userMenuOpen && (
            <div className="sidebar-user-menu">
              <button type="button" onClick={() => navigate("/change-password")}>
                <UserCog aria-hidden="true" />
                비밀번호 변경
              </button>
              <button type="button" onClick={handleLogout} disabled={loggingOut}>
                <LogOut aria-hidden="true" />
                {loggingOut ? "로그아웃 중…" : "로그아웃"}
              </button>
            </div>
          )}
          <button
            className="sidebar-user-button"
            type="button"
            onClick={() => setUserMenuOpen((current) => !current)}
            aria-expanded={userMenuOpen}
            title={collapsed ? user?.name : undefined}
          >
            <span className="user-avatar">{user?.name.slice(0, 1)}</span>
            <span className="sidebar-user-copy">
              <strong>{user?.name}</strong>
              <small>
                {user ? ROLE_LABEL[user.role] : ""}
                {user?.isAdmin ? " · 관리자" : ""}
                {user?.isClerk ? " · 회의 서기" : ""}
              </small>
            </span>
            <ChevronDown className="sidebar-user-chevron" aria-hidden="true" />
          </button>
        </div>
      </aside>
    </>
  );
}

interface TopBarProps {
  collapsed: boolean;
  onToggleSidebar: () => void;
  onOpenDrawer: () => void;
}

function TopBar({ collapsed, onToggleSidebar, onOpenDrawer }: TopBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notificationData, setNotificationData] = useState<NotificationListResponse | null>(null);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const pageLabel = currentPageLabel(location.pathname);

  const loadNotifications = useCallback(async (cursor?: number) => {
    if (cursor) setNotificationLoading(true);
    try {
      const result = await apiRequest<NotificationListResponse>("/api/notifications" + (cursor ? `?cursor=${cursor}` : ""));
      setNotificationData((current) => cursor && current ? {
        ...result,
        items: [...current.items, ...result.items.filter((item) => !current.items.some((existing) => existing.id === item.id))],
      } : result);
    } catch { /* 다음 포커스 또는 폴링에서 다시 시도 */ }
    finally { setNotificationLoading(false); }
  }, []);

  useEffect(() => {
    void loadNotifications();
    const refresh = () => void loadNotifications();
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [loadNotifications]);

  const openNotification = async (item: NotificationItem) => {
    if (!item.isRead) {
      setNotificationData((current) => current ? {
        ...current,
        unreadCount: Math.max(0, current.unreadCount - 1),
        items: current.items.map((entry) => entry.id === item.id ? { ...entry, isRead: true } : entry),
      } : current);
      try { await apiRequest(`/api/notifications/${item.id}/read`, { method: "PATCH" }); }
      catch { void loadNotifications(); }
    }
    setNotificationsOpen(false);
    if (item.link) navigate(item.link);
  };

  const readAllNotifications = async () => {
    if (!notificationData?.unreadCount) return;
    setNotificationData((current) => current ? {
      ...current, unreadCount: 0, items: current.items.map((item) => ({ ...item, isRead: true })),
    } : current);
    try { await apiRequest("/api/notifications/read-all", { method: "POST" }); }
    catch { void loadNotifications(); }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setNotificationsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) window.setTimeout(() => searchInput.current?.focus(), 0);
  }, [searchOpen]);

  return (
    <>
      <header className="app-topbar">
        <button className="topbar-icon desktop-sidebar-toggle" type="button" onClick={onToggleSidebar} aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}>
          {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
        </button>
        <button className="topbar-icon mobile-menu-toggle" type="button" onClick={onOpenDrawer} aria-label="메뉴 열기">
          <Menu aria-hidden="true" />
        </button>

        <div className="topbar-breadcrumb">
          <span>업무트래커</span>
          <ChevronRight aria-hidden="true" />
          <strong>{pageLabel}</strong>
        </div>

        <div className="topbar-actions">
          <button className="topbar-search" type="button" onClick={() => setSearchOpen(true)}>
            <Search aria-hidden="true" />
            <span>보고서 · 회의록 · 액션 검색</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="topbar-popover-wrap">
            <button
              className="topbar-icon notification-button"
              type="button"
              onClick={() => { setNotificationsOpen((current) => !current); if (!notificationsOpen) void loadNotifications(); }}
              aria-label="알림"
              aria-expanded={notificationsOpen}
            >
              <Bell aria-hidden="true" />
              {(notificationData?.unreadCount ?? 0) > 0 && <span className="notification-unread-count">{notificationData!.unreadCount > 99 ? "99+" : notificationData!.unreadCount}</span>}
            </button>
            {notificationsOpen && (
              <div className="notification-popover">
                <div>
                  <strong>알림 {(notificationData?.unreadCount ?? 0) > 0 && <span>{notificationData?.unreadCount}</span>}</strong>
                  <button type="button" disabled={!notificationData?.unreadCount} onClick={() => void readAllNotifications()}>모두 읽음</button>
                </div>
                {!notificationData?.items.length ? <p>새 알림이 없습니다.</p>
                : <div className="notification-list" onScroll={(event) => {
                  const target = event.currentTarget;
                  if (target.scrollHeight - target.scrollTop - target.clientHeight < 48 && notificationData.nextCursor && !notificationLoading) {
                    void loadNotifications(notificationData.nextCursor);
                  }
                }}>
                  {notificationData.items.map((item) => <button type="button" key={item.id}
                    className={item.isRead ? "notification-item is-read" : "notification-item"}
                    onClick={() => void openNotification(item)}>
                    <span className="notification-type-icon"><NotificationTypeIcon type={item.type} /></span>
                    <span className="notification-item-copy"><strong>{item.message}</strong><small>{notificationTime(item.createdAt)}</small></span>
                    {!item.isRead && <i aria-label="읽지 않음" />}
                  </button>)}
                  {notificationLoading && <span className="notification-loading">불러오는 중…</span>}
                </div>}
              </div>
            )}
          </div>
        </div>
      </header>

      {searchOpen && (
        <div className="search-dialog-backdrop" role="presentation" onMouseDown={() => setSearchOpen(false)}>
          <section className="search-dialog" role="dialog" aria-modal="true" aria-label="통합 검색" onMouseDown={(event) => event.stopPropagation()}>
            <div className="search-dialog-input">
              <Search aria-hidden="true" />
              <input
                ref={searchInput}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="검색어를 입력하세요"
                aria-label="검색어"
              />
              <button type="button" onClick={() => setSearchOpen(false)} aria-label="검색 닫기">
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="search-dialog-body">
              <p>{query.length < 2 ? "검색어를 2자 이상 입력하세요." : "검색 결과가 없습니다."}</p>
              <small>주간보고, 회의록, 액션과 진행내용을 검색합니다.</small>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (!drawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drawerOpen]);

  return (
    <div className={"app-shell" + (collapsed ? " has-collapsed-sidebar" : "")}>
      <Sidebar collapsed={collapsed} drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} />
      <TopBar
        collapsed={collapsed}
        onToggleSidebar={() => setCollapsed((current) => !current)}
        onOpenDrawer={() => setDrawerOpen(true)}
      />
      <div className="app-content" id="main-content">
        <Outlet />
      </div>
    </div>
  );
}
