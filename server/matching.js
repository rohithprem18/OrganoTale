// Priority-based donor ↔ recipient matching. Pure functions: no database or clock access,
// so every rule and score is unit-testable. The result is a ranked suggestion for a
// hospital to review — it never establishes medical eligibility on its own.
import { LIVING_ORGANS } from '../shared/options.js';

export const WEIGHTS = {
  urgency: { critical: 40, urgent: 25, stable: 10 },
  clinical: 15, // clinical_score (0–40, e.g. MELD for liver) scaled to 15 points
  waiting: 15, // one point per 30 days since verification
  blood: { identical: 10, compatible: 5, 'not-required': 10 },
  proximity: { city: 10, state: 6, other: 2 },
  pediatric: 5,
  priorDonor: 5,
};

const DAY_MS = 86_400_000;
const TISSUES = ['Eye', 'Heart valves'];
// Heart and lungs survive only about 4–6 hours outside the body.
const SHORT_PRESERVATION = ['Heart', 'Lungs'];
const ABO_RECIPIENTS = { O: ['O', 'A', 'B', 'AB'], A: ['A', 'AB'], B: ['B', 'AB'], AB: ['AB'] };

export const abo = (bloodGroup) => String(bloodGroup).replace(/[+-]$/, '');
const same = (a, b) => Boolean(a && b) && a.trim().toLowerCase() === b.trim().toLowerCase();

// Rh (+/−) is not a barrier for solid organs; tissues need no blood-group match.
export function bloodMatch(donorGroup, recipientGroup, organ) {
  if (TISSUES.includes(organ)) return 'not-required';
  const donor = abo(donorGroup);
  const recipient = abo(recipientGroup);
  if (donor === recipient) return 'identical';
  return ABO_RECIPIENTS[donor]?.includes(recipient) ? 'compatible' : null;
}

export function ageOn(dob, now) {
  if (!dob) return null;
  const birth = new Date(`${dob}T00:00:00Z`);
  const today = new Date(now);
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  if (today.getUTCMonth() < birth.getUTCMonth() || (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

// Warnings for a clinician to review. They never exclude a donor automatically.
export function screeningFlags(pledge, donorAge, now) {
  const flags = [];
  if (pledge.bmi < 18.5 || pledge.bmi > 35) flags.push(`BMI ${pledge.bmi} is outside 18.5–35`);
  if (pledge.disease_type === 'Chronic') flags.push('Chronic disease reported');
  if (pledge.operation_type === 'Major') flags.push('Major operation reported');
  if (pledge.accident_type === 'Critical') flags.push('Critical accident reported');
  if (pledge.pregnant === 'Yes') flags.push('Currently pregnant');
  if (pledge.last_donation && now - Date.parse(pledge.last_donation) < 365 * DAY_MS) flags.push('Donated within the last 12 months');
  if (pledge.donor_type === 'living' && donorAge > 65) flags.push(`Living donor aged ${donorAge}`);
  return flags;
}

/**
 * pledge:  { id, user_id, organ, donor_type, status, city, state, bmi, …health, donor_dob, donor_blood_group,
 *            available_at, available_city, available_state, created_at }
 * request: { id, user_id, organ, blood_group, status, verification, priority, clinical_score, verified_at,
 *            city, state (of the treating hospital), patient_dob }
 * ctx:     { now, activePledgeIds: Set, declinedPairs: Set<"requestId:pledgeId">, priorDonorUserIds: Set }
 */
export function evaluate(pledge, request, ctx) {
  const now = ctx.now;
  const exclusions = [];
  const donorAge = ageOn(pledge.donor_dob, now);
  const deceased = pledge.donor_type === 'deceased';
  const donorCity = deceased ? pledge.available_city : pledge.city;
  const donorState = deceased ? pledge.available_state : pledge.state;

  if (request.status !== 'open') exclusions.push('Request is closed');
  if (request.verification !== 'verified') exclusions.push('Request is not verified by its hospital');
  if (pledge.organ !== request.organ) exclusions.push(`Donor pledged ${pledge.organ}; request needs ${request.organ}`);
  if (pledge.status !== 'active' || ctx.activePledgeIds?.has(pledge.id)) exclusions.push('Donor is withdrawn or already in an active match');
  if (pledge.user_id === request.user_id) exclusions.push('Donor and requester are the same person');
  const blood = bloodMatch(pledge.donor_blood_group, request.blood_group, request.organ);
  if (!blood) exclusions.push(`Blood group ${pledge.donor_blood_group} cannot donate to ${request.blood_group}`);
  if (!deceased) {
    if (pledge.donor_status === 'deceased') exclusions.push('Donor is deceased and cannot make a living donation');
    if (!LIVING_ORGANS.includes(pledge.organ)) exclusions.push(`${pledge.organ} cannot come from a living donor`);
    if (!(donorAge >= 18)) exclusions.push('Living donors must be 18 or older');
  } else if (!pledge.available_at) {
    exclusions.push('Deceased-donor pledge has not been reported available by a hospital');
  } else if (SHORT_PRESERVATION.includes(request.organ) && !same(donorState, request.state)) {
    exclusions.push(`${request.organ} must be transplanted within the same state (4–6 hour window)`);
  }
  if (ctx.declinedPairs?.has(`${request.id}:${pledge.id}`)) exclusions.push('This pairing was already declined');

  const breakdown = [];
  const add = (factor, label, points, max) => breakdown.push({ factor, label, points, max });
  add('urgency', request.priority ? `Verified ${request.priority}` : 'Priority not verified', WEIGHTS.urgency[request.priority] ?? 0, WEIGHTS.urgency.critical);
  const clinicalScore = Math.min(Math.max(Number(request.clinical_score) || 0, 0), 40);
  add('clinical', `Clinical score ${clinicalScore} of 40`, Math.round((clinicalScore / 40) * WEIGHTS.clinical), WEIGHTS.clinical);
  const days = request.verified_at ? Math.max(0, Math.floor((now - new Date(request.verified_at)) / DAY_MS)) : 0;
  add('waiting', `${days} ${days === 1 ? 'day' : 'days'} on the verified list`, Math.min(WEIGHTS.waiting, Math.floor(days / 30)), WEIGHTS.waiting);
  const bloodLabels = { identical: 'Identical blood group', compatible: 'Compatible blood group', 'not-required': 'Blood match not required' };
  add('blood', blood ? bloodLabels[blood] : 'Incompatible blood group', blood ? WEIGHTS.blood[blood] : 0, WEIGHTS.blood.identical);
  const proximity = same(donorCity, request.city) && same(donorState, request.state) ? 'city' : same(donorState, request.state) ? 'state' : 'other';
  add('proximity', { city: 'Same city', state: 'Same state', other: 'Different state' }[proximity], WEIGHTS.proximity[proximity], WEIGHTS.proximity.city);
  const patientAge = ageOn(request.patient_dob, now);
  const child = patientAge !== null && patientAge < 18;
  add('pediatric', child ? `Child patient, age ${patientAge}` : 'Adult patient', child ? WEIGHTS.pediatric : 0, WEIGHTS.pediatric);
  const priorDonor = Boolean(ctx.priorDonorUserIds?.has(request.user_id));
  add('prior_donor', priorDonor ? 'Requester is a confirmed past donor' : 'No confirmed past donation', priorDonor ? WEIGHTS.priorDonor : 0, WEIGHTS.priorDonor);

  return {
    eligible: exclusions.length === 0,
    exclusions,
    score: breakdown.reduce((sum, item) => sum + item.points, 0),
    breakdown,
    flags: screeningFlags(pledge, donorAge, now),
    blood,
    donorAge,
    patientAge,
  };
}

// Highest score first; ties go to whoever has waited on the verified list longer.
const byPriority = (a, b) => b.score - a.score || new Date(a.request.verified_at) - new Date(b.request.verified_at) || a.request.id - b.request.id;

export function rankRecipients(pledge, requests, ctx) {
  return requests
    .map((request) => ({ request, ...evaluate(pledge, request, ctx) }))
    .filter((result) => result.eligible)
    .sort(byPriority)
    .map((result, index) => ({ ...result, rank: index + 1 }));
}

// Donors who can help this request, each with where this request stands among
// everyone that donor could help. recipientRank > 1 means someone has higher priority.
export function rankDonors(request, pledges, allRequests, ctx) {
  return pledges
    .map((pledge) => ({ pledge, ...evaluate(pledge, request, ctx) }))
    .filter((candidate) => candidate.eligible)
    .map((candidate) => {
      const ranking = rankRecipients(candidate.pledge, allRequests, ctx);
      return { ...candidate, recipientRank: ranking.findIndex((item) => item.request.id === request.id) + 1, competingRecipients: ranking.length };
    })
    .sort((a, b) => a.recipientRank - b.recipientRank || b.score - a.score || a.flags.length - b.flags.length || new Date(a.pledge.created_at) - new Date(b.pledge.created_at));
}
