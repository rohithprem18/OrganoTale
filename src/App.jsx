import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, List, X, SignOut, SquaresFour } from '@phosphor-icons/react';
import { api } from './api';
import { AuthContext, useAuth, Logo, Loading, Notice, ButtonLink, homeFor } from './components';
import { Home, FAQ, Vision, Contact, Policy } from './pages/Public';
import { Login, Register, HospitalRegister } from './pages/Auth';
import { Dashboard, Requests, RequestForm, PledgeForm, Records } from './pages/Workspace';
import { HospitalPortal, HospitalRequest } from './pages/Hospital';
import { Admin } from './pages/Admin';

function Navigation({ user }) {
  if (user?.role === 'hospital') return <><NavLink to="/" end>Home</NavLink><NavLink to="/hospital">Hospital portal</NavLink><NavLink to="/faq">FAQs</NavLink></>;
  if (user) return <><NavLink to="/" end>Home</NavLink><NavLink to="/dashboard">Dashboard</NavLink><NavLink to="/pledge">Pledge</NavLink><NavLink to="/requests">Requests</NavLink><NavLink to="/records">My records</NavLink><NavLink to="/faq">FAQs</NavLink></>;
  return <><NavLink to="/" end>Home</NavLink><NavLink to="/vision">Our vision</NavLink><NavLink to="/requests">Donate organ</NavLink><NavLink to="/hospital/register">For hospitals</NavLink><NavLink to="/faq">FAQs</NavLink><NavLink to="/contact">Contact</NavLink></>;
}
function Layout() {
  const { user, setUser } = useAuth();
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { setMenu(false); window.scrollTo(0, 0); }, [location.pathname]);
  const logout = async () => {
    setBusy(true); setError('');
    try { await api('/auth/logout', { method: 'POST', body: {} }); setUser(null); navigate('/'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <><a className="skip-link" href="#main">Skip to content</a><div className="topline"><span>A shared purpose. A second chance.</span><Link to="/faq">Learn about the journey <ArrowUpRight size={13} /></Link></div><header className="site-header"><div className="nav-container"><Logo /><button className="mobile-toggle icon-button" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={24} /> : <List size={24} />}</button><nav className={menu ? 'main-nav is-open' : 'main-nav'} aria-label="Main navigation"><Navigation user={user} /></nav><div className="nav-actions">{user ? <>{user.role === 'admin' && <Link className="admin-link" to="/admin"><SquaresFour size={18} /> Admin</Link>}<span className="avatar" title={user.role === 'hospital' ? `${user.first_name} ${user.last_name} · ${user.hospital?.name}` : `${user.first_name} ${user.last_name}`}>{user.first_name[0]}{user.last_name[0]}</span><button className="icon-button" aria-label="Log out" disabled={busy} onClick={logout}><SignOut size={21} /></button></> : <><Link className="login-link" to="/login">Log in</Link><Link className="button small" to="/register">Join the community <ArrowUpRight size={17} /></Link></>}</div></div></header><main id="main"><Notice>{error}</Notice><Outlet /></main><footer className="footer"><div className="footer-inner"><Logo /><p>Connecting people.<br />Keeping hope within reach.</p><div><Link to="/faq">FAQs</Link><Link to="/hospital/register">For hospitals</Link><Link to="/contact">Contact</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} OrganoTale</span><span>Made for a more caring tomorrow.</span></div></footer></>;
}
function Protected({ roles }) {
  const { user } = useAuth(); const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;
  return <Outlet />;
}
export default function App() {
  const [user, setUser] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = () => { setLoading(true); setError(''); api('/auth/me').then((data) => setUser(data.user)).catch((err) => setError(err.message)).finally(() => setLoading(false)); };
  useEffect(load, []);
  if (loading) return <div className="boot"><Logo /><Loading /></div>;
  if (error) return <div className="boot"><Logo /><Notice>{error}</Notice><button className="button" onClick={load}>Try again</button></div>;
  return <AuthContext.Provider value={{ user, setUser }}><Routes><Route element={<Layout />}>
    <Route index element={<Home />} /><Route path="login" element={<Login />} /><Route path="register" element={<Register />} /><Route path="hospital/register" element={<HospitalRegister />} />
    <Route path="faq" element={<FAQ />} /><Route path="vision" element={<Vision />} /><Route path="contact" element={<Contact />} /><Route path="privacy" element={<Policy />} /><Route path="terms" element={<Policy terms />} />
    <Route element={<Protected roles={['member', 'admin']} />}><Route path="dashboard" element={<Dashboard />} /><Route path="requests" element={<Requests />} /><Route path="requests/new" element={<RequestForm />} /><Route path="requests/:id/edit" element={<RequestForm />} /><Route path="pledge" element={<PledgeForm />} /><Route path="records" element={<Records />} /></Route>
    <Route element={<Protected roles={['hospital']} />}><Route path="hospital" element={<HospitalPortal />} /><Route path="hospital/requests/:id" element={<HospitalRequest />} /></Route>
    <Route element={<Protected roles={['admin']} />}><Route path="admin" element={<Admin />} /></Route>
    <Route path="*" element={<div className="page-container not-found"><span className="eyebrow">404 / A little off course</span><h1>Let’s find your way back.</h1><p>This page doesn’t exist. Your next step is still within reach.</p><ButtonLink to="/">Back to home</ButtonLink></div>} />
  </Route></Routes></AuthContext.Provider>;
}
