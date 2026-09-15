// Plain-language audit events, shared by the admin audit log and the PDF report.
const DANGER = ['rejected', 'declined', 'status_suspended', 'deleted', 'withdrawn', 'donor_declined'];
const WARN = ['donor_lookup', 'status_pending', 'updated'];

export function describeEvent(e) {
  const who = e.first_name ? `${e.first_name} ${e.last_name}` : e.actor_id ? 'A deleted account' : 'The system';
  const d = e.detail || {};
  const id = `#${e.entity_id}`;
  const text = {
    registered: `${who} registered ${d.name || `hospital ${id}`}`,
    status_verified: `${who} verified hospital ${id}`,
    status_suspended: `${who} suspended hospital ${id}`,
    status_pending: `${who} moved hospital ${id} back to pending`,
    created: e.entity === 'pledge' ? `${who} pledged ${d.organ || 'an organ'} (${d.donor_type === 'deceased' ? 'after death' : 'living'})` : `${who} created ${d.organ ? `a ${d.organ.toLowerCase()} ` : ''}request ${id}`,
    updated: `${who} updated request ${id}${d.verification_reset ? ', sending it back for verification' : ''}`,
    verified: `${who} verified request ${id} as ${d.priority}${d.clinical_score ? ` (clinical score ${d.clinical_score})` : ''}`,
    rejected: `${who} rejected request ${id}${d.note ? `: “${d.note}”` : ''}`,
    withdrawn: `${who} withdrew pledge ${id}`,
    reactivated: `${who} reactivated pledge ${id}`,
    proposed: `${who} proposed match ${id} (score ${d.score}, rank #${d.rank} of ${d.competing_recipients})${d.override_reason ? ` with override: “${d.override_reason}”` : ''}`,
    donor_accepted: `The donor accepted match ${id}`,
    donor_declined: `The donor declined match ${id}${d.reason ? `: “${d.reason}”` : ''}`,
    confirmed: `${who} confirmed match ${id}${d.request_closed ? ', fulfilling the request' : ''}`,
    declined: `${who} declined match ${id}${d.reason ? `: “${d.reason}”` : ''}`,
    reported_available: `${who} reported after-death pledge ${id} available${d.converted_from_living ? ' (pledged for living donation)' : ''}`,
    donor_lookup: `${who} searched the donor registry for ${d.email} (${d.results} found)`,
    deleted: `${who} deleted the ${d.role} account ${d.email}`,
    promoted_admin: `Account ${id} was made an administrator`,
    donor_status_changed: `${who} changed donor ${id} from ${d.from} to ${d.to}`,
  }[e.action] || `${who} ${e.action.replaceAll('_', ' ')} ${e.entity} ${id}`;
  return { text, tone: DANGER.includes(e.action) ? 'danger' : WARN.includes(e.action) || d.override_reason ? 'warn' : '' };
}
