import { FilePdf } from '@phosphor-icons/react';
import { useAsync } from './components';

const LOADERS = { member: 'loadMemberReport', hospital: 'loadHospitalReport', admin: 'loadAdminReport' };

// Builds the signed-in account's PDF report in the browser and downloads it.
export function ExportPdfButton({ kind }) {
  const action = useAsync();
  return <button type="button" className="button secondary" disabled={action.busy} onClick={() => action.run(async () => {
    const pdf = await import('./pdf.js');
    pdf.savePdf(await pdf[LOADERS[kind]](), kind);
  }, { success: 'PDF report downloaded.', toastError: true })}><FilePdf size={18} />{action.busy ? 'Preparing PDF…' : 'Export PDF'}</button>;
}
