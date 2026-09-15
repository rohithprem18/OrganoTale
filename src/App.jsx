import { useEffect, useRef, useState } from 'react';
import { Routes, Route, NavLink, Navigate, Outlet, Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowUpRight, Bell, ChartBar, ClockCounterClockwise, HandHeart, Handshake, Heartbeat, Hospital, IdentificationCard, Kanban, List, Queue, SignOut, SquaresFour, UsersThree, X } from '@phosphor-icons/react';
import { api } from './api';
import { AuthContext, useAuth, Logo, Loading, Notice, ButtonLink, homeFor, useResource, ToastProvider, timeAgo, clearAllDrafts } from './components';
import { Home, FAQ, Vision, Contact, Policy } from './pages/Public';
import { Login, Register, HospitalRegister } from './pages/Auth';
import { Dashboard, Requests, RequestDetail, RequestForm, PledgeForm, Records, MyPledges, MyMatches } from './pages/Workspace';
import { Settings } from './pages/Settings';
import { HospitalPortal } from './pages/Hospital';
import { Admin } from './pages/Admin';


function useLogout() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  return async () => {
    try { await api('/auth/logout', { method: 'POST', body: {} }); } finally {
      clearAllDrafts();
      setUser(null);
      navigate('/');
    }
  };
}

// ---------- Public site ----------
function PublicLayout() {
  const { user } = useAuth();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => { setMenu(false); window.scrollTo(0, 0); }, [location.pathname]);
  return <><a className="skip-link" href="#main">Skip to content</a><div className="topline"><span>A shared purpose. A second chance.</span><Link to="/faq">Learn about the journey <ArrowUpRight size={13} /></Link></div>
    <header className="site-header"><div className="nav-container"><Logo /><button className="mobile-toggle icon-button" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={24} /> : <List size={24} />}</button>
      <nav className={menu ? 'main-nav is-open' : 'main-nav'} aria-label="Main navigation"><NavLink to="/" end>Home</NavLink><NavLink to="/vision">Our vision</NavLink><NavLink to="/hospital/register">For hospitals</NavLink><NavLink to="/faq">FAQs</NavLink><NavLink to="/contact">Contact</NavLink></nav>
      <div className="nav-actions public-actions">{user ? <Link className="button small open-app" to={homeFor(user)}>Open app <ArrowUpRight size={17} /></Link> : <><Link className="login-link" to="/login">Log in</Link><Link className="button small" to="/register">Join the community <ArrowUpRight size={17} /></Link></>}</div>
    </div></header>
    <main id="main"><Outlet /></main>
    <footer className="footer"><div className="footer-inner"><Logo /><p>Connecting people.<br />Keeping hope within reach.</p><div><Link to="/faq">FAQs</Link><Link to="/hospital/register">For hospitals</Link><Link to="/contact">Contact</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} OrganoTale</span><span>Made for a more caring tomorrow.</span></div></footer>
  </>;
}

// ---------- Signed-in app ----------
const NAVIGATION = {
  member: [['Dashboard', '/dashboard', SquaresFour], ['My pledges', '/pledges', HandHeart], ['My requests', '/requests?mine=true', Heartbeat], ['Matches', '/matches', Handshake]],
  hospital: [['Patient queue', '/hospital', Queue], ['Matches', '/hospital?tab=matches', Kanban], ['Report a death', '/hospital?tab=registry', IdentificationCard]],
  admin: [['Overview', '/admin', ChartBar], ['Hospitals', '/admin?tab=hospitals', Hospital], ['Members', '/admin?tab=members', UsersThree], ['Requests', '/admin?tab=requests', Heartbeat], ['Pledges', '/admin?tab=pledges', HandHeart], ['Matches', '/admin?tab=matches', Handshake], ['Audit log', '/admin?tab=audit', ClockCounterClockwise]],
};
function isActive(location, to) {
  const [path, query = ''] = to.split('?');
  if (location.pathname !== path && !(path === '/hospital' && location.pathname.startsWith('/hospital/requests')) && !(path === '/requests' && location.pathname.startsWith('/requests/'))) return false;
  const want = new URLSearchParams(query).get('tab');
  if (path === '/requests') return location.pathname.startsWith('/requests/') || new URLSearchParams(location.search).get('mine') === 'true';
  return (new URLSearchParams(location.search).get('tab') || null) === want;
}
function SidebarLink({ label, to, icon: Icon, count }) {
  const location = useLocation();
  const active = isActive(location, to);
  return <Link className={`sidebar-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} to={to}><Icon size={19} /><span>{label}</span>{count > 0 && <span className="count">{count}</span>}</Link>;
}
function NotificationBell() {
  const navigate = useNavigate();
  const location = useLocation();
  const inbox = useResource('/notifications');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { refresh } = inbox;
  useEffect(() => { const timer = setInterval(refresh, 60000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { refresh(); }, [location.pathname, location.search, refresh]);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const unread = inbox.data?.unread || 0;
  const markRead = async (ids) => {
    const now = new Date().toISOString();
    inbox.setData((d) => d && { unread: ids ? Math.max(0, d.unread - d.items.filter((n) => ids.includes(n.id) && !n.read_at).length) : 0, items: d.items.map((n) => !ids || ids.includes(n.id) ? { ...n, read_at: n.read_at || now } : n) });
    try { await api('/notifications/read', { method: 'POST', body: ids ? { ids } : {} }); } catch { refresh(); }
  };
  return <div className="bell" ref={ref}>
    <button type="button" className="icon-button" aria-label={unread ? `Notifications (${unread})` : 'Notifications'} aria-expanded={open} onClick={() => setOpen(!open)}><Bell size={21} />{unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}</button>
    {open && <div className="popover" role="dialog" aria-label="Notifications">
      <div className="popover-head"><span>Notifications</span>{unread > 0 && <button type="button" className="text-button" onClick={() => markRead()}>Mark all read</button>}</div>
      {inbox.error ? <Notice>{inbox.error}</Notice> : !inbox.data ? <Loading /> : inbox.data.items.length ? <ul className="notification-list">{inbox.data.items.map((n) => <li key={n.id}><button type="button" className={`notification ${n.read_at ? '' : 'unread'}`} onClick={() => { if (!n.read_at) markRead([n.id]); setOpen(false); if (n.link) navigate(n.link); }}><span className="dot" aria-hidden="true" /><span><strong>{n.title}</strong>{n.body && <span>{n.body}</span>}<small>{timeAgo(n.created_at)}</small></span></button></li>)}</ul> : <p className="popover-empty">No notifications yet</p>}
    </div>}
  </div>;
}
function AppShell() {
  const { user } = useAuth();
  const logout = useLogout();
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMenu(false); }, [location.pathname, location.search]);
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  const sections = user.role === 'admin' ? [['Admin', NAVIGATION.admin], ['Member area', NAVIGATION.member]] : user.role === 'hospital' ? [['Hospital portal', NAVIGATION.hospital]] : [['Menu', NAVIGATION.member]];
  const current = sections.flatMap(([, items]) => items).find(([, to]) => isActive(location, to));
  return <div className="app-shell">
    <a className="skip-link" href="#app-main">Skip to content</a>
    <aside className={`sidebar ${menu ? 'is-open' : ''}`} aria-label="App navigation">
      <Logo />
      {sections.map(([title, items]) => <nav key={title} aria-label={title}><div className="sidebar-section">{title}</div>{items.map(([label, to, icon]) => <SidebarLink key={to} label={label} to={to} icon={icon} />)}</nav>)}
      <div className="sidebar-footer">
        <Link className="sidebar-link" to="/settings"><IdentificationCard size={19} /><span>Settings</span></Link>
        <div className="account-card"><span className="avatar" aria-hidden="true">{user.first_name[0]}{user.last_name[0]}</span><div><strong>{user.first_name} {user.last_name}</strong><small>{user.role === 'hospital' ? user.hospital?.name : user.email}</small></div></div>
        <Link className="sidebar-link" to="/"><ArrowUpRight size={19} /><span>Home</span></Link>
        <button type="button" className="sidebar-link" onClick={logout}><SignOut size={19} /><span>Log out</span></button>
      </div>
    </aside>
    <button type="button" className={`sidebar-backdrop ${menu ? 'is-open' : ''}`} aria-label="Close navigation" tabIndex={menu ? 0 : -1} onClick={() => setMenu(false)} />
    <div className="app-main">
      <header className="app-topbar">
        <button type="button" className="icon-button menu-button" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(true)}><List size={22} /></button>
        <span className="topbar-title">{current ? (current[0]) : 'OrganoTale'}</span>
        <div className="topbar-actions"><NotificationBell /></div>
      </header>
      <main id="app-main" className="app-content" key={location.pathname}><Outlet /></main>
    </div>
  </div>;
}
function Protected({ roles }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;
  return <Outlet />;
}
function HospitalRequestRedirect() {
  const { id } = useParams();
  return <Navigate to={`/hospital?request=${id}`} replace />;
}
function NotFound() {
  return <div className="page-container not-found"><span className="eyebrow">404 / A little off course</span><h1>Let’s find your way back.</h1><p>This page doesn’t exist. Your next step is still within reach.</p><ButtonLink to="/">Back to home</ButtonLink></div>;
}

export default function App() {
  const [user, setUser] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = () => { setLoading(true); setError(''); api('/auth/me').then((data) => setUser(data.user)).catch((err) => setError(err.message)).finally(() => setLoading(false)); };
  useEffect(load, []);
  return <ToastProvider>
    {loading ? <div className="boot"><Logo /><Loading /></div>
      : error ? <div className="boot"><Logo /><Notice>{error}</Notice><button className="button" onClick={load}>Try again</button></div>
      : <AuthContext.Provider value={{ user, setUser }}><Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Home />} /><Route path="login" element={<Login />} /><Route path="register" element={<Register />} /><Route path="hospital/register" element={<HospitalRegister />} />
          <Route path="faq" element={<FAQ />} /><Route path="vision" element={<Vision />} /><Route path="contact" element={<Contact />} /><Route path="privacy" element={<Policy />} /><Route path="terms" element={<Policy terms />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route element={<AppShell />}>
          <Route path="settings" element={<Settings />} />
          <Route element={<Protected roles={['member', 'admin']} />}><Route path="pledges" element={<MyPledges />} /><Route path="matches" element={<MyMatches />} /></Route>
          <Route element={<Protected roles={['member', 'admin']} />}><Route path="dashboard" element={<Dashboard />} /><Route path="requests" element={<Requests />} /><Route path="requests/new" element={<RequestForm />} /><Route path="requests/:id" element={<RequestDetail />} /><Route path="requests/:id/edit" element={<RequestForm />} /><Route path="pledge" element={<PledgeForm />} /><Route path="records" element={<Records />} /></Route>
          <Route element={<Protected roles={['hospital']} />}><Route path="hospital" element={<HospitalPortal />} /><Route path="hospital/requests/:id" element={<HospitalRequestRedirect />} /></Route>
          <Route element={<Protected roles={['admin']} />}><Route path="admin" element={<Admin />} /></Route>
        </Route>
      </Routes></AuthContext.Provider>}
  </ToastProvider>;
}
