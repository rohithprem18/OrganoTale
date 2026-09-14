import { useEffect, useState } from 'react';
import { api } from '../api';
import { useResource, useAsync, PageHeading, Loading, Notice, PrivateHint } from '../components';
import { LANGUAGES, useLanguage, useT } from '../i18n';

export function applyMotionPreference(value) {
  document.documentElement.dataset.motion = value;
}
export function readMotionPreference() {
  try { return localStorage.getItem('organotale:motion') || 'system'; } catch { return 'system'; }
}
export function Settings() {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  const preferences = useResource('/notifications/preferences');
  const action = useAsync();
  const [motion, setMotion] = useState(readMotionPreference);
  useEffect(() => {
    applyMotionPreference(motion);
    try { localStorage.setItem('organotale:motion', motion); } catch { /* Keep for this visit. */ }
  }, [motion]);
  return <div className="page-container workspace settings-page">
    <PageHeading eyebrow={t('Your preferences')} title={t('Settings')} />
    <section className="panel"><h2>{t('Language and accessibility')}</h2><div className="fields">
      <div className="field"><label htmlFor="settings-language">{t('Language')}</label><select id="settings-language" value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select><p className="field-hint">{t('Navigation, form labels and statuses are translated. Some guidance remains in English.')}</p></div>
      <div className="field"><label htmlFor="settings-motion">{t('Animations')}</label><select id="settings-motion" value={motion} onChange={(e) => setMotion(e.target.value)}><option value="system">{t('Follow device setting')}</option><option value="reduce">{t('Turn off animations')}</option></select></div>
    </div></section>
    <section className="panel"><h2>{t('Email alerts')}</h2><p>{t('Get an email when a donor is proposed or a match is confirmed.')}</p><Notice>{preferences.error || action.error}</Notice>
      {!preferences.data ? <Loading /> : <><label className="checkbox-label"><input type="checkbox" checked={preferences.data.email_alerts} disabled={action.busy} onChange={(e) => {
        const email_alerts = e.target.checked;
        action.run(() => preferences.mutate((d) => ({ ...d, email_alerts }), () => api('/notifications/preferences', { method: 'PATCH', body: { email_alerts } })), { success: t('Preferences saved'), toastError: true });
      }} /><span>{t('Send match alerts to')} <strong>{preferences.data.email}</strong></span></label>
        {!preferences.data.email_available && <p className="field-hint">{t('Email delivery is not configured yet. Your preference will be saved; updates remain available in the notification bell.')}</p>}
        <PrivateHint>{t('Emails contain a sign-in link, without names or medical details.')}</PrivateHint>
      </>}
    </section>
  </div>;
}
