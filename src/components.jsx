import { createContext, Fragment, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CaretDown, CaretUp, CaretUpDown, Check, CheckCircle, FloppyDisk, Heartbeat, LockSimple, MagnifyingGlass, SealCheck, WarningCircle, X } from '@phosphor-icons/react';
import { api } from './api';

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
export const homeFor = (user) => user.role === 'admin' ? '/admin' : user.role === 'hospital' ? '/hospital' : '/dashboard';

// Keeps the previous data visible while refetching, so pages don't flash back to placeholders.
export function useResource(path) {
  const [state, setState] = useState({ data: null, error: '', loading: Boolean(path) });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) return undefined;
    let active = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    api(path)
      .then((data) => { if (active) setState({ data, error: '', loading: false }); })
      .catch((err) => { if (active) setState((current) => ({ ...current, error: err.message, loading: false })); });
    return () => { active = false; };
  }, [path, version]);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback((update) => setState((current) => ({ ...current, data: typeof update === 'function' ? update(current.data) : update })), []);
  const mutate = async (update, send) => {
    const previous = state.data;
    setData(update);
    try { return await send(); }
    catch (error) { setData(previous); throw error; }
    finally { refresh(); }
  };
  return { ...state, refreshing: state.loading && state.data !== null, refresh, setData, mutate };
}

// ---------- Toasts ----------
const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((all) => all.filter((item) => item.id !== id)), []);
  const toast = useCallback((message, { type = 'success' } = {}) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((all) => [...all.slice(-3), { id, message, type }]);
    setTimeout(() => dismiss(id), type === 'error' ? 7000 : 4000);
  }, [dismiss]);
  return <ToastContext.Provider value={toast}>{children}<div className="toast-region" aria-live="polite">{toasts.map((item) => <div key={item.id} className={`toast ${item.type}`} role={item.type === 'error' ? 'alert' : 'status'}>{item.type === 'error' ? <WarningCircle size={19} /> : <CheckCircle size={19} />}<span>{item.message}</span><button type="button" className="toast-close" aria-label="Dismiss message" onClick={() => dismiss(item.id)}><X size={14} /></button></div>)}</div></ToastContext.Provider>;
}
export const useToast = () => useContext(ToastContext);

// Busy and error state for a button or form action, with optional success and error toasts.
export function useAsync() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, { success, toastError = false } = {}) => {
    setBusy(true); setError('');
    try {
      const result = await fn();
      if (success) toast(success);
      return result;
    } catch (err) {
      setError(err.message);
      if (toastError) toast(err.message, { type: 'error' });
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

// ---------- Brand ----------
export function LogoMark({ size = 38 }) {
  return <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="14" fill="#f4b942" /><path d="M24 36S9.5 27.6 9.5 18.6A7.6 7.6 0 0 1 24 14.8a7.6 7.6 0 0 1 14.5 3.8C38.5 27.6 24 36 24 36Z" fill="none" stroke="#29271f" strokeWidth="3" strokeLinejoin="round" /><path d="M14.5 23h5.5l2.6-5 3.6 9.5 2.6-4.5h5" fill="none" stroke="#29271f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function Logo() {
  return <Link className="logo" to="/" aria-label="OrganoTale home"><span className="logo-mark"><LogoMark /></span><span>Organo<span className="logo-light">Tale</span><small>A little of you. A life for someone.</small></span></Link>;
}
export function VerifiedBadge() {
  return <span className="badge-verified"><SealCheck size={13} weight="fill" /> Verified hospital</span>;
}
export function PrivateHint({ children = 'Private: visible only to you, your hospital, and administrators' }) {
  return <span className="private-hint"><LockSimple size={13} /> {children}</span>;
}

// ---------- Basic building blocks ----------
export function ButtonLink({ children, to, secondary = false, ...props }) {
  return <Link className={`button ${secondary ? 'secondary' : ''}`} to={to} {...props}>{children}<ArrowRight size={18} /></Link>;
}
export function Notice({ children, success = false }) {
  return children ? <div className={`notice ${success ? 'success' : ''}`} role={success ? 'status' : 'alert'}>{success ? <CheckCircle size={21} /> : <WarningCircle size={21} />}<span>{children}</span></div> : null;
}
export function Loading({ variant = 'lines' }) {
  const count = variant === 'cards' ? 3 : 4;
  return <div className={`skeleton ${variant === 'cards' ? 'cards' : ''}`} role="status" aria-label="Loading">{Array.from({ length: count }, (_, i) => <span key={i} />)}</div>;
}
export function Empty({ title = 'Nothing here yet', children, action }) {
  return <div className="empty"><span className="empty-icon"><Heartbeat size={30} /></span><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}
export function PageHeading({ eyebrow, title, children, action }) {
  return <div className="page-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{children && <p>{children}</p>}</div>{action}</div>;
}
export function FormShell({ eyebrow, title, description, children, aside, back = '/dashboard', backLabel = 'Back to dashboard' }) {
  return <div className="page-container"><Link className="back-link" to={back}><ArrowLeft size={17} /> {backLabel}</Link><PageHeading eyebrow={eyebrow} title={title}>{description}</PageHeading><div className="form-layout"><div className="form-panel">{children}</div><aside className="form-aside"><span className="large-mark"><Heartbeat size={38} /></span><h3>Every journey starts<br />with a little hope.</h3>{aside || <p>Your information helps keep requests and donation records organized in one place.</p>}<div className="aside-bottom">A little of you.<br /><strong>A life for someone.</strong></div></aside></div></div>;
}
const STATUS_LABELS = { 'Not Emergency': 'Standard', deceased: 'After death' };
export function Status({ value, label }) {
  const key = value || 'pending';
  return <span className={`status status-${key.toLowerCase().replaceAll(' ', '-')}`}>{label || (STATUS_LABELS[key] || key)}</span>;
}
export function Stats({ items }) {
  return <div className="stats-grid">{items.map(([label, value, Icon]) => <div className="stat" key={label}><div><span>{label}</span><strong>{value}</strong></div><Icon size={26} weight="light" /></div>)}</div>;
}
export function SearchBox({ value, onChange, placeholder = 'Search by name, organ or location' }) {
  return <label className="search-box"><MagnifyingGlass size={20} /><input aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
export function NextStep({ icon: Icon, title, body, action, to, onClick, calm = false }) {
  return <section className={`next-step ${calm ? 'calm' : ''}`} aria-label="Your next step"><span className="next-icon"><Icon size={24} /></span><div><span className="eyebrow">Your next step</span><h2>{title}</h2>{body && <p>{body}</p>}</div>{action && (to ? <Link className="button" to={to}>{action}<ArrowRight size={18} /></Link> : <button type="button" className="button" onClick={onClick}>{action}<ArrowRight size={18} /></button>)}</section>;
}

// ---------- Confirmation dialog ----------
export function ConfirmButton({ onConfirm, children = 'Delete', title, description = 'This cannot be undone.', confirmLabel = 'Delete', busyLabel = 'Working…', danger = true, success, className }) {
  const dialog = useRef(null);
  const titleId = useId();
  const action = useAsync();
  const close = () => dialog.current?.close();
  return <>
    <button type="button" className={className || `text-button ${danger ? 'danger' : ''}`} onClick={() => dialog.current?.showModal()}>{children}</button>
    <dialog ref={dialog} className="modal" aria-labelledby={titleId}>
      <div className="modal-body"><h3 id={titleId}>{title || confirmLabel}</h3><p>{description}</p><Notice>{action.error}</Notice></div>
      <div className="modal-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button type="button" className={`button ${danger ? 'danger-button' : ''}`} disabled={action.busy} onClick={() => action.run(async () => { await onConfirm(); close(); }, { success })}>{action.busy ? busyLabel : confirmLabel}</button></div>
    </dialog>
  </>;
}

// ---------- Form fields ----------
function useFieldValidation(props) {
  const [error, setError] = useState('');
  const validate = (field) => {
    if (field.name === 'confirm_password') field.setCustomValidity(field.value !== field.form?.elements.namedItem('password')?.value ? 'Passwords do not match.' : '');
    return field.checkValidity() ? '' : field.validationMessage;
  };
  const handlers = {
    onBlur: (e) => { setError(validate(e.target)); props.onBlur?.(e); },
    onInvalid: (e) => { setError(e.target.validationMessage); props.onInvalid?.(e); },
    onInput: (e) => {
      if (error || e.target.name === 'confirm_password') setError(validate(e.target));
      if (e.target.name === 'password') {
        const confirm = e.target.form?.elements.namedItem('confirm_password');
        if (confirm?.value) confirm.setCustomValidity(confirm.value === e.target.value ? '' : 'Passwords do not match.');
      }
      props.onInput?.(e);
    },
    onChange: (e) => { if (error && e.target.checkValidity()) setError(''); props.onChange?.(e); },
  };
  return [error, handlers];
}
// options: plain strings, or { value, label } objects.
export function Field({ label, name, options, wide = false, multiline = false, required = true, hint, ...props }) {
  const id = useId();
  const [error, handlers] = useFieldValidation(props);
  const shared = { id, name, required, ...props, ...handlers, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined };
  const control = options
    ? <select {...shared}><option value="">Select {label}</option>{options.map((o) => typeof o === 'object' ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o} value={o}>{o}</option>)}</select>
    : multiline ? <textarea rows={3} maxLength={1500} {...shared} /> : <input {...shared} />;
  return <div className={`field ${wide ? 'wide' : ''} ${error ? 'invalid' : ''}`}><label htmlFor={id}>{label}{!required && <span> (optional)</span>}</label>{control}{error ? <span id={`${id}-error`} className="field-error">{error}</span> : hint && <span id={`${id}-hint`} className="field-hint">{hint}</span>}</div>;
}

// Searchable dropdown. options: [{ value, label, detail? }]. Submits the chosen value under `name`.
export function Combobox({ label, name, options, defaultValue = '', value: controlled, onChange, required = true, placeholder, wide = false, hint }) {
  const id = useId();
  const listId = `${id}-list`;
  const [own, setOwn] = useState(defaultValue);
  const current = controlled ?? own;
  const selected = options.find((o) => String(o.value) === String(current));
  const [query, setQuery] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState('');
  const input = useRef(null);
  const hidden = useRef(null);
  const lastSelected = useRef(selected?.value ?? '');
  useEffect(() => { if (selected) setQuery(selected.label); }, [selected?.value]);
  useEffect(() => { input.current?.setCustomValidity(required && !selected && query ? 'Choose an option from the list.' : ''); }, [selected, query, required]);
  // Let the surrounding form (e.g. draft autosave) see selection changes.
  useEffect(() => {
    const value = selected?.value ?? '';
    if (value === lastSelected.current) return;
    lastSelected.current = value;
    hidden.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }, [selected?.value]);
  const typed = open && query !== (selected?.label ?? '');
  const matches = typed ? options.filter((o) => `${o.label} ${o.detail || ''}`.toLowerCase().includes(query.trim().toLowerCase())) : options;
  const choose = (option) => {
    if (controlled === undefined) setOwn(option.value);
    onChange?.(option.value);
    setQuery(option.label); setOpen(false); setError('');
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (matches[highlight]) choose(matches[highlight]); }
    else if (e.key === 'Escape') setOpen(false);
  };
  return <div className={`field ${wide ? 'wide' : ''} ${error ? 'invalid' : ''}`}>
    <label htmlFor={id}>{label}{!required && <span> (optional)</span>}</label>
    <div className="combobox">
      <input ref={input} id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && matches[highlight] ? `${listId}-${highlight}` : undefined} aria-invalid={error ? true : undefined} autoComplete="off" placeholder={placeholder} value={query} required={required}
        onChange={(e) => { setQuery(e.target.value); setError(''); setOpen(true); setHighlight(0); if (controlled === undefined) setOwn(''); onChange?.(''); }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 120);
          const exact = options.find((o) => o.label.toLowerCase() === query.trim().toLowerCase());
          if (exact && !selected) choose(exact);
          else if (required && !selected) setError(query ? 'Choose an option from the list.' : '');
        }}
        onInvalid={(e) => setError(e.target.validationMessage)}
        onKeyDown={onKeyDown} />
      <input ref={hidden} type="hidden" name={name} value={selected ? selected.value : ''} />
      {open && <ul id={listId} role="listbox" className="combobox-list">{matches.length ? matches.map((o, i) => <li key={o.value} id={`${listId}-${i}`} role="option" aria-selected={String(o.value) === String(current)} className={`combobox-option ${i === highlight ? 'highlighted' : ''}`} onMouseDown={(e) => { e.preventDefault(); choose(o); }}>{o.label}{o.detail && <small>{o.detail}</small>}</li>) : <li className="combobox-empty">No matches</li>}</ul>}
    </div>
    {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
  </div>;
}

// ---------- Drafts ----------
const DRAFT_PREFIX = 'organotale:draft:';
export function readDraft(key) {
  if (!key) return null;
  try { return JSON.parse(localStorage.getItem(DRAFT_PREFIX + key) || 'null'); } catch { return null; }
}
export function clearAllDrafts() {
  try { for (const key of Object.keys(localStorage)) if (key.startsWith(DRAFT_PREFIX)) localStorage.removeItem(key); } catch { /* storage unavailable */ }
}
// Autosaves a form to this device (never the consent checkbox). Pass a null key to disable.
export function useDraftSaver(key) {
  const timer = useRef(null);
  const pending = useRef(null);
  const [savedAt, setSavedAt] = useState(() => readDraft(key)?.savedAt || null);
  const flush = () => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    const { key: pendingKey, values } = pending.current;
    const savedAt = new Date().toISOString();
    try { localStorage.setItem(DRAFT_PREFIX + pendingKey, JSON.stringify({ values, savedAt })); setSavedAt(savedAt); } catch { /* storage unavailable */ }
    pending.current = null;
  };
  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);
  const save = (form) => {
    if (!key || !form) return;
    clearTimeout(timer.current);
    const values = formValues(form);
    delete values.consent;
    pending.current = { key, values };
    timer.current = setTimeout(flush, 600);
  };
  const clear = () => {
    clearTimeout(timer.current);
    pending.current = null;
    try { localStorage.removeItem(DRAFT_PREFIX + key); } catch { /* storage unavailable */ }
    setSavedAt(null);
  };
  return { savedAt, save, clear };
}

// ---------- Step-by-step form ----------
// steps: [{ title, content: node | (values) => node, blocked? }]. All steps stay mounted so the form submits every field.
export function Wizard({ steps, onSubmit, busy = false, submitLabel = 'Submit', draft, onDiscard, error }) {
  const form = useRef(null);
  const stepRefs = useRef([]);
  const [index, setIndex] = useState(0);
  const [values, setValues] = useState({});
  const last = index === steps.length - 1;
  const validateStep = () => {
    const fields = stepRefs.current[index]?.querySelectorAll('input:not([type=hidden]), select, textarea') || [];
    let firstInvalid = null;
    for (const field of fields) if (!field.checkValidity() && !firstInvalid) firstInvalid = field;
    firstInvalid?.focus();
    return !firstInvalid;
  };
  const go = (next) => { setIndex(next); form.current?.scrollIntoView({ behavior: 'auto', block: 'start' }); };
  useEffect(() => { stepRefs.current[index]?.focus({ preventScroll: true }); }, [index]);
  const submit = (e) => {
    e.preventDefault();
    if (!validateStep()) return;
    const current = formValues(form.current);
    if (!last) { setValues(current); go(index + 1); return; }
    // Recheck earlier steps too: async options may have been unavailable when visited.
    for (let i = 0; i < steps.length; i++) {
      const invalid = [...(stepRefs.current[i]?.querySelectorAll('input:not([type=hidden]), select, textarea') || [])].find((field) => !field.checkValidity());
      if (invalid || steps[i].blocked) { go(i); requestAnimationFrame(() => invalid?.focus()); return; }
    }
    onSubmit(current);
  };
  return <form ref={form} noValidate onSubmit={submit} onInput={() => draft?.save(form.current)} onChange={() => draft?.save(form.current)}>
    <ol className="wizard-steps" style={{ '--steps': steps.length }}>{steps.map((step, i) => <li key={step.title} className={i < index ? 'done' : i === index ? 'current' : ''} aria-current={i === index ? 'step' : undefined}><span>{step.title}</span></li>)}</ol>
    <div className="wizard-meta"><span>Step {index + 1} of {steps.length} · <strong>{(steps[index].title)}</strong></span>{draft?.savedAt && <span className="field-hint"><FloppyDisk size={14} /> Draft saved on this device · <button type="button" className="text-button" onClick={onDiscard}>Discard draft</button></span>}</div>
    {steps.map((step, i) => <div key={step.title} ref={(el) => { stepRefs.current[i] = el; }} className="wizard-step" tabIndex={-1} aria-label={step.title} hidden={i !== index}>{typeof step.content === 'function' ? step.content(values) : step.content}</div>)}
    <Notice>{error}</Notice>
    <div className="wizard-actions">{index > 0 && <button type="button" className="button secondary" onClick={() => go(index - 1)}><ArrowLeft size={18} /> Back</button>}<span className="spacer" /><button className="button" disabled={busy || steps[index].blocked}>{last ? (busy ? 'Saving…' : submitLabel) : 'Next'}<ArrowRight size={18} /></button></div>
  </form>;
}
export function ReviewList({ items }) {
  return <dl className="review-list">{items.filter(Boolean).map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value || '—'}</dd></div>)}</dl>;
}

// ---------- Journey tracker ----------
export function Journey({ steps, compact = false }) {
  return <ol className={`journey ${compact ? 'compact' : ''}`} style={{ '--steps': steps.length }}>{steps.map((step) => <li key={step.label} className={step.state} aria-current={step.state === 'current' ? 'step' : undefined}><span className="marker" aria-hidden="true">{step.state === 'done' ? <Check size={13} weight="bold" /> : step.state === 'failed' ? <X size={13} weight="bold" /> : null}</span><span>{step.label}</span></li>)}</ol>;
}
export function requestJourney(request, matches = []) {
  const related = matches.filter((m) => m.request_id === request.id);
  const active = related.find((m) => m.status === 'confirmed') || related.find((m) => m.status === 'proposed');
  const rejected = request.verification === 'rejected';
  const verified = request.verification === 'verified' || Boolean(active);
  const accepted = active?.donor_response === 'accepted';
  const confirmed = active?.status === 'confirmed';
  return [
    { label: 'Submitted', state: 'done' },
    { label: 'Verified', state: rejected ? 'failed' : verified ? 'done' : 'current' },
    { label: 'Donor proposed', state: active ? 'done' : verified ? 'current' : 'todo' },
    { label: 'Donor accepted', state: accepted ? 'done' : active ? 'current' : 'todo' },
    { label: 'Confirmed', state: confirmed ? 'done' : accepted ? 'current' : 'todo' },
  ];
}
export function matchJourney(match) {
  const declined = match.status === 'declined';
  const accepted = match.donor_response === 'accepted';
  return [
    { label: 'Proposed', state: 'done' },
    { label: 'Donor accepted', state: accepted ? 'done' : declined ? 'failed' : 'current' },
    { label: 'Confirmed', state: match.status === 'confirmed' ? 'done' : declined ? (accepted ? 'failed' : 'todo') : accepted ? 'current' : 'todo' },
  ];
}

// ---------- Scores ----------
export function ScoreRing({ score, size = 92 }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const [shown, setShown] = useState(0);
  useEffect(() => { const frame = requestAnimationFrame(() => setShown(score)); return () => cancelAnimationFrame(frame); }, [score]);
  return <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`Priority score ${score} out of 100`}><svg width={size} height={size} viewBox="0 0 92 92"><circle className="ring-track" cx="46" cy="46" r={radius} fill="none" strokeWidth="8" /><circle className="ring-value" cx="46" cy="46" r={radius} fill="none" strokeWidth="8" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(shown, 100) / 100)} /></svg><span className="ring-label" aria-hidden="true">{score}<small>of 100</small></span></div>;
}
export function whyRanked(breakdown) {
  const top = breakdown.filter((item) => item.points > 0).sort((a, b) => b.points - a.points).slice(0, 3).map((item) => item.label.charAt(0).toLowerCase() + item.label.slice(1));
  return top.length ? top.join(', ') : 'no priority factors yet';
}
export function ScoreBreakdown({ score, breakdown, note }) {
  return <div className="score"><div className="score-summary"><ScoreRing score={score} /><p className="why"><strong>Why this rank:</strong> {whyRanked(breakdown)}.{note && <> {note}</>}</p></div>{breakdown.map((item) => <div className="score-row" key={item.factor}><span>{item.label}</span><strong>{item.points}/{item.max}</strong><div className="score-bar" aria-hidden="true"><i style={{ width: `${item.max ? (item.points / item.max) * 100 : 0}%` }} /></div></div>)}</div>;
}
export function FlagList({ flags }) {
  return flags?.length ? <ul className="flag-list" aria-label="Screening flags for clinical review">{flags.map((flag) => <li key={flag}>{flag}</li>)}</ul> : null;
}

// ---------- Sortable, paginated table (cards on small screens) ----------
// columns: [{ key, header, render?, sortValue?, sortable? }]
export function DataTable({ columns, rows, rowKey = (row) => row.id, pageSize = 10, emptyTitle = 'Nothing to show yet', emptyText, initialSort = null, renderAfterRow }) {
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    const value = column?.sortValue || ((row) => row[sort.key]);
    return [...rows].sort((a, b) => {
      const x = value(a); const y = value(b);
      const order = x == null ? 1 : y == null ? -1 : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.dir === 'asc' ? order : -order;
    });
  }, [rows, sort, columns]);
  if (!rows.length) return <Empty title={emptyTitle}>{emptyText}</Empty>;
  const pages = Math.ceil(sorted.length / pageSize);
  const current = Math.min(page, pages - 1);
  const start = current * pageSize;
  const toggle = (key) => { setSort((s) => s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }); setPage(0); };
  return <div className="table-wrap"><table className="responsive-table"><thead><tr>{columns.map((c) => <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>{c.sortable === false ? c.header : <button type="button" className="sort-button" onClick={() => toggle(c.key)}>{c.header}{sort?.key === c.key ? (sort.dir === 'asc' ? <CaretUp size={12} /> : <CaretDown size={12} />) : <CaretUpDown size={12} />}</button>}</th>)}</tr></thead>
    <tbody>{sorted.slice(start, start + pageSize).map((row) => <Fragment key={rowKey(row)}><tr>{columns.map((c) => <td key={c.key} data-label={typeof c.header === 'string' ? c.header : ''}>{c.render ? c.render(row) : row[c.key] ?? '—'}</td>)}</tr>{renderAfterRow?.(row, columns.length)}</Fragment>)}</tbody></table>
    <div className="table-footer"><span>Showing {start + 1}–{Math.min(start + pageSize, sorted.length)} of {sorted.length}</span>{pages > 1 && <span className="pager"><button type="button" className="text-button" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current + 1} of {pages}</span><button type="button" className="text-button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button></span>}</div>
  </div>;
}

// ---------- Horizontal bar chart (single series) ----------
// data: [{ label, value, detail? }]. Every value is also available through the table view.
export function BarChart({ title, subtitle, data, format = (v) => String(v), emptyText = 'No data yet.' }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return <section className="chart-card" aria-label={title}>
    <div className="chart-head"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{data.length > 0 && <button type="button" className="text-button" onClick={() => setTable(!table)}>{table ? 'Show chart' : 'Show table'}</button>}</div>
    {!data.length ? <p className="chart-empty">{emptyText}</p> : table
      ? <div className="table-wrap"><table><thead><tr><th scope="col">Category</th><th scope="col">Value</th><th scope="col">Detail</th></tr></thead><tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td><td>{format(d.value)}</td><td>{d.detail || '—'}</td></tr>)}</tbody></table></div>
      : <ul className="bars">{data.map((d, i) => <li key={d.label} className="bar-row"><span className="bar-label">{d.label}</span><div className="bar-track" tabIndex={0} aria-label={`${d.label}: ${format(d.value)}${d.detail ? `, ${d.detail}` : ''}`} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}><span className="bar" style={{ width: `${(d.value / max) * 100}%` }} /><span className="bar-value">{format(d.value)}</span>{hover === i && <span className="chart-tooltip" role="tooltip"><strong>{format(d.value)}</strong>{d.label}{d.detail ? ` · ${d.detail}` : ''}</span>}</div></li>)}</ul>}
  </section>;
}

// ---------- Formatting ----------
export const formValues = (form) => Object.fromEntries(new FormData(form));
export const formatDate = (date) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date));
export const formatDateTime = (date) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(date));
export function timeAgo(date) {
  const seconds = Math.round((Date.now() - new Date(date)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days} d ago` : formatDate(date);
}
export function ageFrom(dob) {
  if (!dob) return '—';
  const birth = new Date(`${dob}T00:00:00`); const now = new Date();
  return now.getFullYear() - birth.getFullYear() - (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
}
