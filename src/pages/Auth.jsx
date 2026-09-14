import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Heartbeat, Check } from '@phosphor-icons/react';
import { Field, Combobox, Notice, useAuth, useAsync, formValues, homeFor } from '../components';
import { api } from '../api';
import { BLOOD_GROUPS, STATES } from '../../shared/options';
import { LocationFields } from '../LocationFields';

const COPY = {
  login: ['A familiar place. A fresh start.', 'Welcome back.', 'Log in as a member, hospital, or administrator.'],
  register: ['Your journey starts here', 'Create your account', 'A few details to help us get to know you.'],
  hospital: ['For transplant hospitals', 'Register your hospital', 'Verified hospitals confirm patient priority and coordinate donor matches.'],
};
function AuthLayout({ variant = 'login', children }) {
  const [eyebrow, title, intro] = COPY[variant];
  return <div className={`auth-layout ${variant !== 'login' ? 'registration-layout' : ''}`}><aside className="auth-story"><span className="eyebrow">A little of you. A life for someone.</span><h1>Good things<br />begin with<br /><span>giving.</span></h1><div className="auth-art"><img src="/images/donation.jpg" alt="Hands holding and sharing a heart" /></div><p>Join a community built on compassion, connection, and the possibility of a new beginning.</p><span className="auth-signature"><Heartbeat size={23} /> Give hope. Share life.</span></aside><section className="auth-form"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{intro}</p>{children}</section></div>;
}
const phonePattern = String.raw`[+0-9 .\(\)\-]{7,25}`;
const today = () => new Date().toISOString().slice(0, 10);

export function Login() {
  const { user, setUser } = useAuth(); const action = useAsync(); const location = useLocation(); const navigate = useNavigate();
  if (user) return <Navigate to={homeFor(user)} replace />;
  return <AuthLayout><form onSubmit={(event) => { event.preventDefault(); const body = formValues(event.currentTarget); action.run(async () => { const data = await api('/auth/login', { method: 'POST', body }); setUser(data.user); const from = location.state?.from; navigate(from?.startsWith('/') && !from.startsWith('//') ? from : homeFor(data.user), { replace: true }); }); }}><div className="fields"><Field label="Email address" name="email" type="email" autoComplete="email" placeholder="you@example.com" wide /><Field label="Password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" wide /></div><Notice>{action.error}</Notice><button className="button full" disabled={action.busy}>{action.busy ? 'Logging in…' : 'Log in'}<ArrowRight size={19} /></button><p className="auth-switch">New to the community? <Link to="/register">Create an account</Link></p><p className="auth-switch">Hospital staff? <Link to="/hospital/register">Register your hospital</Link></p></form><div className="auth-footnote"><Check size={17} /> Your pledges, requests, and matches in one place.</div></AuthLayout>;
}
export function Register() {
  const { user, setUser } = useAuth(); const action = useAsync(); const navigate = useNavigate();
  if (user) return <Navigate to={homeFor(user)} replace />;
  return <AuthLayout variant="register"><form onSubmit={(event) => { event.preventDefault(); const body = formValues(event.currentTarget); body.consent = body.consent === 'on'; action.run(async () => { const data = await api('/auth/register', { method: 'POST', body }); setUser(data.user); navigate('/dashboard'); }, { success: 'Welcome to OrganoTale.' }); }}><div className="fields"><Field label="First name" name="first_name" autoComplete="given-name" maxLength={80} /><Field label="Last name" name="last_name" autoComplete="family-name" maxLength={80} /><Field label="Date of birth" name="dob" type="date" min="1900-01-01" max={today()} /><Field label="Blood group" name="blood_group" options={BLOOD_GROUPS} /><Field label="Gender" name="gender" options={['Male', 'Female', 'Other', 'Prefer not to say']} /><Field label="Phone number" name="phone" type="tel" autoComplete="tel" pattern={phonePattern} /><Field label="Email address" name="email" type="email" autoComplete="email" wide /><Field label="Password" name="password" type="password" minLength={8} maxLength={128} placeholder="At least 8 characters" autoComplete="new-password" /><Field label="Confirm password" name="confirm_password" type="password" minLength={8} autoComplete="new-password" /><Field label="Address" name="address" autoComplete="street-address" /><Field label="Postal code" name="zip" autoComplete="postal-code" maxLength={16} /></div><label className="checkbox-label"><input type="checkbox" name="consent" required /><span>I agree to the <Link to="/terms" target="_blank">terms of use</Link> and have read how <Link to="/privacy" target="_blank">my information is stored</Link>.</span></label><Notice>{action.error}</Notice><button className="button full" disabled={action.busy}>{action.busy ? 'Creating account…' : 'Create account'}<ArrowRight size={19} /></button><p className="auth-switch">Already a member? <Link to="/login">Log in</Link></p></form></AuthLayout>;
}
export function HospitalRegister() {
  const { user, setUser } = useAuth(); const action = useAsync(); const navigate = useNavigate();
  if (user) return <Navigate to={homeFor(user)} replace />;
  return <AuthLayout variant="hospital"><form onSubmit={(event) => { event.preventDefault(); const body = formValues(event.currentTarget); body.consent = body.consent === 'on'; action.run(async () => { const data = await api('/hospital/register', { method: 'POST', body }); setUser(data.user); navigate('/hospital'); }, { success: 'Hospital registered. An administrator has been notified.' }); }}>
    <h3 className="form-section-title">Hospital details</h3>
    <div className="fields"><Field label="Hospital name" name="hospital_name" maxLength={150} wide /><Field label="Registration number" name="registration_number" minLength={3} maxLength={50} /><Field label="Hospital phone" name="hospital_phone" type="tel" pattern={phonePattern} /><LocationFields /></div>
    <h3 className="form-section-title separated">Your staff account</h3>
    <div className="fields"><Field label="First name" name="first_name" autoComplete="given-name" maxLength={80} /><Field label="Last name" name="last_name" autoComplete="family-name" maxLength={80} /><Field label="Work email" name="email" type="email" autoComplete="email" /><Field label="Your phone" name="phone" type="tel" autoComplete="tel" pattern={phonePattern} /><Field label="Password" name="password" type="password" minLength={8} maxLength={128} placeholder="At least 8 characters" autoComplete="new-password" /><Field label="Confirm password" name="confirm_password" type="password" minLength={8} autoComplete="new-password" /></div>
    <label className="checkbox-label"><input type="checkbox" name="consent" required /><span>I am authorized to register this hospital. An administrator will verify it before we can review requests or propose matches.</span></label>
    <Notice>{action.error}</Notice><button className="button full" disabled={action.busy}>{action.busy ? 'Registering…' : 'Register hospital'}<ArrowRight size={19} /></button><p className="auth-switch">Already registered? <Link to="/login">Log in</Link></p>
  </form></AuthLayout>;
}
