import { api } from '../api';
import { useResource, useAsync, Loading, Notice, PrivateHint, AppHeader, Box } from '../components';

export function Settings() {
  const preferences = useResource('/notifications/preferences');
  const action = useAsync();
  return <div className="screen">
    <AppHeader title="Settings" subtitle="Your preferences" />
    <Box title="Email alerts" subtitle="Get an email when a donor is proposed or a match is confirmed">
      <Notice>{preferences.error || action.error}</Notice>
      {!preferences.data ? <Loading /> : <><label className="checkbox-label"><input type="checkbox" checked={preferences.data.email_alerts} disabled={action.busy} onChange={(e) => {
        const email_alerts = e.target.checked;
        action.run(() => preferences.mutate((d) => ({ ...d, email_alerts }), () => api('/notifications/preferences', { method: 'PATCH', body: { email_alerts } })), { success: 'Preferences saved', toastError: true });
      }} /><span>Send match alerts to <strong>{preferences.data.email}</strong></span></label>
        {!preferences.data.email_available && <p className="field-hint">Email delivery is not configured yet. Your preference will be saved, and updates stay available in the notification bell.</p>}
        <PrivateHint>Emails contain a sign-in link, without names or medical details.</PrivateHint>
      </>}
    </Box>
  </div>;
}
