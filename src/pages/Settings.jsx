import { api } from '../api';
import { useResource, useAsync, useAuth, Loading, Notice, PrivateHint, AppHeader, Box, ConfirmButton, ButtonLink } from '../components';
import { ORGANS, LIVING_ORGANS } from '../../shared/options';

export function Settings() {
  const { user } = useAuth();
  const preferences = useResource('/notifications/preferences');
  const action = useAsync();
  return <div className="screen">
    <AppHeader title="Settings" subtitle="Your preferences" />
    <div className="screen-grid two grow">
    {user.role !== 'hospital' && <DonorSettings />}
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
    </div>
  </div>;
}

export function DonorSettings() {
  const { setUser } = useAuth();
  const settings = useResource('/auth/donor-settings');
  const deceased = settings.data?.donor_status === 'deceased';
  const change = async (donor_status) => {
    const result = await api('/auth/donor-settings', { method: 'PATCH', body: { donor_status, acknowledged: true } });
    setUser(result.user);
    settings.refresh();
  };
  return <Box scroll title="Donor status" subtitle="Alive or deceased — this changes which donations can proceed">
    <Notice>{settings.error}</Notice>
    {!settings.data ? <Loading /> : <>
      <div className="donor-status-banner"><span className={`status ${deceased ? 'status-pending' : 'status-active'}`}>{deceased ? 'Deceased' : 'Alive'}</span><span>{deceased ? settings.data.hospital_verified ? 'After-death availability recorded by a hospital' : 'Reported in Settings · hospital verification required' : 'Living donation and future after-death pledges'}</span></div>
      <h3 className="form-section-title">{deceased ? 'Organs that can be pledged after death' : 'Organs that can be pledged for living donation'}</h3>
      <ul className="eligible-organs">{(deceased ? ORGANS : LIVING_ORGANS).map((organ) => <li key={organ}>{organ}</li>)}</ul>
      <p className="quiet-note">{deceased ? 'A verified hospital must certify death, document consent, and report each organ available. Its transplant team decides which organs are suitable.' : 'Living donation uses a kidney or part of an eligible organ. You can also register a future after-death pledge for heart, eyes, heart valves, and other organs without changing your status.'}</p>
      <div className="inline-actions"><ButtonLink to="/pledge">{deceased ? 'Pledge organs after death' : 'Create a pledge'}</ButtonLink>
        {!deceased ? <ConfirmButton title="Report this donor as deceased?" description="Confirm only if you are authorized to act for this donor. Active living-donation pledges will be withdrawn and pending living matches closed. This report does not replace hospital verification or automatically make organs available." confirmLabel="Report deceased" success="Donor status updated. After-death pledges can now be created." onConfirm={() => change('deceased')}>Report deceased</ConfirmButton>
          : !settings.data.hospital_verified && <ConfirmButton danger={false} title="Correct donor status to alive?" description="Use this to correct a mistaken report. Previously withdrawn pledges stay withdrawn; you can reactivate eligible living pledges from My pledges." confirmLabel="Set to alive" success="Donor status corrected to alive." onConfirm={() => change('alive')}>Correct to alive</ConfirmButton>}
      </div>
      {deceased && settings.data.hospital_verified && <p className="quiet-note">Contact the hospital if this status is incorrect; hospital-verified records cannot be changed here.</p>}
    </>}
  </Box>;
}
