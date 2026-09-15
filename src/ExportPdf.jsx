import { FilePdf } from '@phosphor-icons/react';
import { useAsync } from './components';

// Downloads the PDF record of one confirmed match. The PDF library loads on first use.
export function MatchPdfButton({ id, compact = false }) {
  const action = useAsync();
  return <button type="button" className={compact ? 'text-button' : 'button secondary small'} disabled={action.busy} onClick={() => action.run(async () => {
    const pdf = await import('./pdf.js');
    pdf.savePdf(await pdf.loadMatchReport(id), `organotale-match-${id}.pdf`);
  }, { success: 'Match PDF downloaded.', toastError: true })}><FilePdf size={compact ? 16 : 18} />{action.busy ? 'Preparing…' : 'Export PDF'}</button>;
}
