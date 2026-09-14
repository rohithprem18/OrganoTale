import { createContext, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Heartbeat, MagnifyingGlass, WarningCircle, CheckCircle, ArrowLeft, X } from '@phosphor-icons/react';
import { api } from './api';

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
export const homeFor = (user) => user.role === 'admin' ? '/admin' : user.role === 'hospital' ? '/hospital' : '/dashboard';
export function useResource(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api(path).then((value) => { if (active) setData(value); }).catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, version]);
  return { data, error, loading, refresh: () => setVersion((v) => v + 1) };
}
// Busy and error state for a button or form action.
export function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn) => { setBusy(true); setError(''); try { return await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  return { busy, error, run };
}
export function Logo() {
  return <Link className="logo" to="/" aria-label="OrganoTale home"><span className="logo-mark"><Heartbeat size={28} weight="bold" /></span><span>organo<span className="logo-light">tale</span><small>A little of you. A life for someone.</small></span></Link>;
}
export function ButtonLink({ children, to, secondary = false, ...props }) {
  return <Link className={`button ${secondary ? 'secondary' : ''}`} to={to} {...props}>{children}<ArrowRight size={18} /></Link>;
}
// options: plain strings, or { value, label } objects.
export function Field({ label, name, options, wide = false, multiline = false, required = true, ...props }) {
  const id = `field-${name}`;
  return <div className={`field ${wide ? 'wide' : ''}`}><label htmlFor={id}>{label}{!required && <span> (optional)</span>}</label>{options ? <select id={id} name={name} required={required} {...props}><option value="">Select {label.toLowerCase()}</option>{options.map((o) => typeof o === 'object' ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o} value={o}>{o}</option>)}</select> : multiline ? <textarea id={id} name={name} required={required} rows={3} maxLength={1500} {...props} /> : <input id={id} name={name} required={required} {...props} />}</div>;
}
export function Notice({ children, success = false }) {
  return children ? <div className={`notice ${success ? 'success' : ''}`} role={success ? 'status' : 'alert'}>{success ? <CheckCircle size={21} /> : <WarningCircle size={21} />}<span>{children}</span></div> : null;
}
export function Loading() { return <div className="loading" role="status"><div /><div /><div /><span>Loading your information…</span></div>; }
export function Empty({ title = 'Nothing here yet', children, action }) {
  return <div className="empty"><span className="empty-icon"><Heartbeat size={30} /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function PageHeading({ eyebrow, title, children, action }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{children && <p>{children}</p>}</div>{action}</div>;
}
export function FormShell({ eyebrow, title, description, children, aside, back = '/dashboard', backLabel = 'Back to dashboard' }) {
  return <div className="page-container"><Link className="back-link" to={back}><ArrowLeft size={17} /> {backLabel}</Link><PageHeading eyebrow={eyebrow} title={title}>{description}</PageHeading><div className="form-layout"><div className="form-panel">{children}</div><aside className="form-aside"><span className="large-mark"><Heartbeat size={38} /></span><h3>Every journey starts<br />with a little hope.</h3>{aside || <p>Your information helps keep requests and donation records organized in one place.</p>}<div className="aside-bottom">A little of you.<br /><strong>A life for someone.</strong></div></aside></div></div>;
}
const STATUS_LABELS = { 'Not Emergency': 'Standard', deceased: 'After death' };
export function Status({ value, label }) {
  const key = value || 'pending';
  return <span className={`status status-${key.toLowerCase().replaceAll(' ', '-')}`}>{label || STATUS_LABELS[key] || key}</span>;
}
export function Stats({ items }) {
  return <div className="stats-grid">{items.map(([label, value, Icon]) => <div className="stat" key={label}><div><span>{label}</span><strong>{value}</strong></div><Icon size={26} weight="light" /></div>)}</div>;
}
export function ScoreBreakdown({ score, breakdown }) {
  return <div className="score" aria-label={`Priority score ${score} out of 100`}><div className="score-total">{score}<small>/ 100 priority score</small></div>{breakdown.map((item) => <div className="score-row" key={item.factor}><span>{item.label}</span><strong>{item.points}/{item.max}</strong><div className="score-bar" aria-hidden="true"><i style={{ width: `${item.max ? (item.points / item.max) * 100 : 0}%` }} /></div></div>)}</div>;
}
export function FlagList({ flags }) {
  return flags?.length ? <ul className="flag-list" aria-label="Screening flags for clinical review">{flags.map((flag) => <li key={flag}>{flag}</li>)}</ul> : null;
}
export function SearchBox({ value, onChange, placeholder = 'Search by name, organ or location' }) {
  return <label className="search-box"><MagnifyingGlass size={20} /><input aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
export function ConfirmButton({ onConfirm, children = 'Delete', description = 'Delete this item? This cannot be undone.', confirmLabel = 'Confirm delete', busyLabel = 'Deleting…' }) {
  const [open, setOpen] = useState(false);
  const action = useAsync();
  if (!open) return <button type="button" className="text-button danger" onClick={() => setOpen(true)}>{children}</button>;
  return <div className="confirm" role="group" aria-label={confirmLabel}><p>{description}</p><Notice>{action.error}</Notice><button className="button small danger-button" disabled={action.busy} onClick={() => action.run(async () => { await onConfirm(); setOpen(false); })}>{action.busy ? busyLabel : confirmLabel}</button><button className="icon-button" aria-label="Cancel" onClick={() => setOpen(false)}><X size={18} /></button></div>;
}
export const formValues = (form) => Object.fromEntries(new FormData(form));
export const formatDate = (date) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date));
export const formatDateTime = (date) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(date));
export function ageFrom(dob) {
  if (!dob) return '—';
  const birth = new Date(`${dob}T00:00:00`); const now = new Date();
  return now.getFullYear() - birth.getFullYear() - (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
}
