import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from "react-router-dom";
import {
  CarFront,
  MapPin,
  Wrench,
  Bell,
  UserRound,
  ChevronDown,
  LogOut,
  ShieldCheck,
  ArrowRight,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { Bootstrap, PublicConfig, User } from "@autovoyage/shared";
import { api, post, ApiError } from "./lib/api";
import { Brand, CarArt, ErrorBox, Loading, messageOf } from "./components/UI";
import { VehicleEditor, ImportMileage } from "./components/VehicleForms";
import HomePage from "./pages/HomePage";
const StoresPage = lazy(() => import("./pages/StoresPage"));
import RepairsPage from "./pages/RepairsPage";
import AccountPage from "./pages/AccountPage";
import MessagesPage from "./pages/MessagesPage";
const AdminApp = lazy(() => import("./admin/AdminApp"));
const navigation = [
  { to: "/", label: "爱车", desktop: "我的爱车", Icon: CarFront },
  { to: "/stores", label: "找店", desktop: "附近门店", Icon: MapPin },
  { to: "/repairs", label: "报修", desktop: "故障咨询", Icon: Wrench },
  { to: "/messages", label: "消息", desktop: "消息中心", Icon: Bell },
  { to: "/account", label: "我的", desktop: "我的服务", Icon: UserRound },
];

export default function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const refresh = useCallback(async () => {
    try {
      const result = await api<Bootstrap>("/bootstrap");
      setData(result);
      setConfig(result.config);
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setData(null);
        navigate("/");
      }
      throw e;
    }
  }, [navigate]);
  useEffect(() => {
    let alive = true;
    Promise.all([
      api<PublicConfig>("/config"),
      api<{ user: User | null }>("/auth/me"),
    ])
      .then(async ([publicConfig, session]) => {
        if (!alive) return;
        setConfig(publicConfig);
        if (session.user) await refresh();
      })
      .catch((e) => {
        if (alive) setError(messageOf(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refresh]);
  const logout = async () => {
    await post("/auth/logout");
    setData(null);
    sessionStorage.removeItem("autovoyage-vehicle");
    navigate("/");
  };
  if (loading)
    return (
      <div className="startup">
        <Brand />
        <Loading label="正在准备你的云程…" />
      </div>
    );
  if (!data)
    return <Login config={config} loadError={error} onLogin={refresh} />;
  if (data.user.role !== "owner")
    return (
      <Suspense fallback={<Loading />}>
        <AdminApp data={data} onRefresh={refresh} onLogout={logout} />
      </Suspense>
    );
  return <OwnerShell data={data} refresh={refresh} logout={logout} />;
}

function Login({
  config,
  loadError,
  onLogin,
}: {
  config: PublicConfig | null;
  loadError: string;
  onLogin: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState("");
  return (
    <div className="login-page">
      <section className="login-story">
        <Brand inverse />
        <div className="login-story-copy">
          <span className="login-kicker">把日常交给安心，把远方留给自己</span>
          <h1>
            每一程，
            <br />
            都有照应。
          </h1>
          <p>
            从下一次保养，到下一段旅途。
            <br />
            让汽车信息更清楚，让养车选择更从容。
          </p>
        </div>
        <CarArt />
        <div className="login-story-footer">
          <span>中国海洋大学 MEM · 软件工程管理</span>
          <span>AUTOVOYAGE / 2026</span>
        </div>
      </section>
      <main className="login-form-side">
        <div className="mobile-login-brand">
          <Brand />
        </div>
        <div className="login-card">
          <p className="eyebrow">WELCOME TO AUTOVOYAGE</p>
          <h2>你好，欢迎来到云程</h2>
          <p className="muted">登录，开启你的安心养车之旅。</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await post("/auth/login", { email, password });
                await onLogin();
              } catch (e) {
                setError(messageOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              电子邮箱
              <input
                type="email"
                name="email"
                autoComplete="username"
                placeholder="请输入账号邮箱"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              登录密码
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <ErrorBox message={error || loadError} />
            <button className="btn btn-primary btn-full" disabled={busy}>
              {busy ? "正在登录…" : "登录云程"}
              <ArrowRight size={18} />
            </button>
          </form>
          {config?.demoMode && (
            <div className="demo-login">
              <p>
                <span>课程演示体验</span>
                <small>下方均为合成账号与业务数据</small>
              </p>
              <div className="demo-role-grid">
                {[
                  { role: "owner", label: "车主" },
                  { role: "store", label: "门店" },
                  { role: "expert", label: "专家" },
                  { role: "admin", label: "平台" },
                ].map((item) => (
                  <button
                    className={chosen === item.role ? "selected" : ""}
                    key={item.role}
                    onClick={() => {
                      setChosen(item.role);
                      setEmail(`${item.role}@autovoyage.demo`);
                      setPassword("Yuncheng2026!");
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <small>仅填入演示登录信息，由你点击登录。</small>
            </div>
          )}
          <div className="login-trust">
            <ShieldCheck size={17} />
            <span>个人车辆与服务记录，按账号独立管理</span>
          </div>
        </div>
        <p className="login-bottom">云程 AutoVoyage · 让每一程都有照应</p>
      </main>
    </div>
  );
}

function OwnerShell({
  data,
  refresh,
  logout,
}: {
  data: Bootstrap;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}) {
  const [vehicleId, setVehicleId] = useState(
    () => sessionStorage.getItem("autovoyage-vehicle") || "",
  );
  const [editor, setEditor] = useState(false);
  const [importer, setImporter] = useState(false);
  const [importJobId, setImportJobId] = useState<string>();
  const [globalError, setGlobalError] = useState("");
  const [toast, setToast] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);
  const vehicle =
    data.vehicles.find((v) => v.id === vehicleId) || data.vehicles[0];
  const unread = data.messages.filter((m) => !m.readAt).length;
  useEffect(() => {
    if (vehicle) sessionStorage.setItem("autovoyage-vehicle", vehicle.id);
  }, [vehicle]);
  useEffect(() => {
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const afterMutation = async (message: string) => {
    await refresh();
    setToast(message);
  };
  const current =
    navigation.find((n) => n.to === location.pathname) || navigation[0];
  return (
    <div className="owner-app">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <Brand />
        <p className="sidebar-eyebrow">让每一程都有照应</p>
        <nav aria-label="主要导航">
          {navigation.map(({ to, desktop, Icon }) => (
            <NavLink key={to} to={to} end={to === "/"}>
              <Icon size={21} aria-hidden="true" />
              <span>{desktop}</span>
              {to === "/messages" && unread > 0 && (
                <span className="nav-count">{unread}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-line" />
            <p>
              车与生活，
              <br />
              皆有好风景。
            </p>
            <small>YOUR CAR. YOUR JOURNEY.</small>
          </div>
          {data.config.demoMode && (
            <span className="demo-environment">课程演示环境</span>
          )}
          <button className="sidebar-user" onClick={() => navigate("/account")}>
            <span className="avatar">{data.user.name.slice(0, 1)}</span>
            <span>
              <strong>{data.user.name}</strong>
              <small>云程车主</small>
            </span>
            <ChevronDown size={16} />
          </button>
        </div>
      </aside>
      <div className="owner-workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand />
          </div>
          <div className="breadcrumb">
            云程 <span>/</span> {current.desktop}
          </div>
          <div className="topbar-right">
            <span className="topbar-date">
              {new Intl.DateTimeFormat("zh-CN", {
                timeZone: "Asia/Shanghai",
                month: "long",
                day: "numeric",
                weekday: "long",
              }).format(new Date())}
            </span>
            <button
              className="icon-btn"
              title="刷新数据"
              aria-label="刷新数据"
              onClick={() =>
                refresh().catch((e) => setGlobalError(messageOf(e)))
              }
            >
              <RefreshCw size={18} />
            </button>
            <button
              className="notification-button icon-btn"
              aria-label={`消息中心，${unread}条未读`}
              onClick={() => navigate("/messages")}
            >
              <Bell size={20} />
              {unread > 0 && <span />}
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <ErrorBox message={globalError} />
          <Routes>
            <Route
              path="/"
              element={
                <HomePage
                  data={data}
                  vehicle={vehicle}
                  onSelectVehicle={setVehicleId}
                  onAddVehicle={() => setEditor(true)}
                  onImport={() => {
                    setImportJobId(undefined);
                    setImporter(true);
                  }}
                />
              }
            />
            <Route
              path="/stores"
              element={
                <Suspense fallback={<Loading label="正在载入门店地图…" />}>
                  <StoresPage
                    data={data}
                    vehicle={vehicle}
                    onSelectVehicle={setVehicleId}
                    onRefresh={refresh}
                    onSuccess={setToast}
                  />
                </Suspense>
              }
            />
            <Route
              path="/repairs"
              element={
                <RepairsPage
                  data={data}
                  vehicle={vehicle}
                  onRefresh={refresh}
                  onSuccess={setToast}
                />
              }
            />
            <Route
              path="/messages"
              element={<MessagesPage data={data} onRefresh={refresh} />}
            />
            <Route
              path="/account"
              element={
                <AccountPage
                  data={data}
                  vehicle={vehicle}
                  onRefresh={refresh}
                  onLogout={logout}
                  onAddVehicle={() => setEditor(true)}
                  onImport={(id?: string, jobId?: string) => {
                    if (id) setVehicleId(id);
                    setImportJobId(jobId);
                    setImporter(true);
                  }}
                  onSuccess={setToast}
                />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <footer className="page-footer">
          <span>云程 AutoVoyage</span>
          <span>
            让每一程都有照应{data.config.demoMode ? " · 课程演示数据" : ""}
          </span>
        </footer>
      </div>
      <nav className="bottom-navigation" aria-label="手机主要导航">
        {navigation.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} end={to === "/"}>
            <span>
              <Icon size={22} aria-hidden="true" />
              {to === "/messages" && unread > 0 && <i />}
            </span>
            {label}
          </NavLink>
        ))}
      </nav>
      {editor && (
        <VehicleEditor
          models={data.models}
          onClose={() => setEditor(false)}
          onSaved={async () => {
            setEditor(false);
            await afterMutation("车辆档案已创建");
          }}
        />
      )}{" "}
      {importer && vehicle && (
        <ImportMileage
          vehicle={vehicle}
          data={data}
          initialJobId={importJobId}
          onClose={() => setImporter(false)}
          onRefresh={refresh}
          onSuccess={setToast}
        />
      )}{" "}
      {toast && (
        <div className="toast" role="status">
          <ShieldCheck size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
