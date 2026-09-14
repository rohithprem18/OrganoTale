import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bloodMatch, evaluate, rankRecipients, rankDonors, ageOn } from './matching.js';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const daysAgo = (days) => new Date(NOW - days * 86_400_000).toISOString();
const donor = (extra = {}) => ({
  id: 1, user_id: 1, organ: 'Kidney', donor_type: 'living', status: 'active', city: 'Pune', state: 'Maharashtra',
  bmi: 23, operation_type: 'None', disease_type: 'None', accident_type: 'None', pregnant: 'No', last_donation: null,
  donor_dob: '1990-01-01', donor_blood_group: 'O+', available_at: null, created_at: daysAgo(10), ...extra,
});
const recipient = (extra = {}) => ({
  id: 10, user_id: 2, organ: 'Kidney', blood_group: 'O+', status: 'open', verification: 'verified', priority: 'urgent',
  clinical_score: 0, verified_at: daysAgo(0), city: 'Pune', state: 'Maharashtra', patient_dob: '1980-01-01', ...extra,
});
const context = (extra = {}) => ({ now: NOW, activePledgeIds: new Set(), declinedPairs: new Set(), priorDonorUserIds: new Set(), ...extra });
const points = (result, factor) => result.breakdown.find((item) => item.factor === factor).points;

test('ABO compatibility ignores Rh and prefers identical groups', () => {
  assert.equal(bloodMatch('O-', 'AB+', 'Kidney'), 'compatible');
  assert.equal(bloodMatch('O+', 'O-', 'Kidney'), 'identical');
  assert.equal(bloodMatch('A+', 'AB-', 'Liver'), 'compatible');
  assert.equal(bloodMatch('A+', 'O+', 'Liver'), null);
  assert.equal(bloodMatch('B-', 'A+', 'Heart'), null);
  assert.equal(bloodMatch('AB+', 'B+', 'Kidney'), null);
  assert.equal(bloodMatch('AB+', 'O-', 'Eye'), 'not-required');
});

test('age is counted in whole years', () => {
  assert.equal(ageOn('2008-06-01', NOW), 18);
  assert.equal(ageOn('2008-06-02', NOW), 17);
});

test('hard rules exclude pairings that must never match', () => {
  const ctx = context();
  const excluded = (pledge, request, text) => {
    const result = evaluate(pledge, request, ctx);
    assert.equal(result.eligible, false);
    assert.ok(result.exclusions.some((reason) => reason.includes(text)), `expected "${text}" in ${result.exclusions}`);
  };
  excluded(donor({ organ: 'Heart' }), recipient({ organ: 'Heart' }), 'living donor');
  excluded(donor({ donor_dob: '2010-01-01' }), recipient(), '18 or older');
  excluded(donor(), recipient({ verification: 'pending' }), 'not verified');
  excluded(donor(), recipient({ status: 'closed' }), 'closed');
  excluded(donor(), recipient({ organ: 'Liver' }), 'needs Liver');
  excluded(donor(), recipient({ user_id: 1 }), 'same person');
  excluded(donor({ donor_blood_group: 'A+' }), recipient({ blood_group: 'O+' }), 'cannot donate');
  excluded(donor({ status: 'withdrawn' }), recipient(), 'withdrawn');
  excluded(donor({ donor_type: 'deceased', organ: 'Heart' }), recipient({ organ: 'Heart' }), 'not been reported available');
  assert.equal(evaluate(donor(), recipient(), context({ activePledgeIds: new Set([1]) })).eligible, false);
  assert.equal(evaluate(donor(), recipient(), context({ declinedPairs: new Set(['10:1']) })).eligible, false);

  const available = { donor_type: 'deceased', available_at: daysAgo(0), available_city: 'Mumbai', available_state: 'Maharashtra' };
  excluded(donor({ ...available, organ: 'Heart' }), recipient({ organ: 'Heart', city: 'Bengaluru', state: 'Karnataka' }), 'same state');
  assert.equal(evaluate(donor({ ...available, organ: 'Heart' }), recipient({ organ: 'Heart', city: 'Pune' }), ctx).eligible, true);
  assert.equal(evaluate(donor({ ...available }), recipient({ city: 'Bengaluru', state: 'Karnataka' }), ctx).eligible, true, 'kidneys can travel between states');
});

test('scores and ranks the documented example', () => {
  const ctx = context();
  const pledge = donor();
  const mumbaiCritical = recipient({ id: 1, user_id: 11, priority: 'critical', verified_at: daysAgo(60), city: 'Mumbai' });
  const puneUrgent = recipient({ id: 2, user_id: 12, blood_group: 'A+', priority: 'urgent', verified_at: daysAgo(400) });
  const delhiChild = recipient({ id: 3, user_id: 13, blood_group: 'B+', priority: 'urgent', verified_at: daysAgo(90), city: 'New Delhi', state: 'Delhi', patient_dob: '2014-01-01' });
  const ranking = rankRecipients(pledge, [delhiChild, puneUrgent, mumbaiCritical], ctx);
  assert.deepEqual(ranking.map((r) => [r.request.id, r.score, r.rank]), [[1, 58, 1], [2, 53, 2], [3, 40, 3]]);
  assert.equal(points(ranking[1], 'waiting'), 13);
  assert.equal(points(ranking[2], 'pediatric'), 5);
  assert.equal(points(ranking[2], 'proximity'), 2);
});

test('ties go to the recipient verified first', () => {
  const ranking = rankRecipients(donor(), [recipient({ id: 2, user_id: 3, verified_at: daysAgo(5) }), recipient({ id: 1, verified_at: daysAgo(6) })], context());
  assert.equal(ranking[0].score, ranking[1].score);
  assert.deepEqual(ranking.map((r) => r.request.id), [1, 2]);
});

test('clinical score scales to 15 points and confirmed past donors get a bonus', () => {
  const ctx = context({ priorDonorUserIds: new Set([2]) });
  assert.equal(points(evaluate(donor(), recipient({ clinical_score: 40 }), ctx), 'clinical'), 15);
  assert.equal(points(evaluate(donor(), recipient({ clinical_score: 20 }), ctx), 'clinical'), 8);
  assert.equal(points(evaluate(donor(), recipient(), ctx), 'prior_donor'), 5);
});

test('screening flags are warnings and never exclude a donor', () => {
  const result = evaluate(donor({ bmi: 38, disease_type: 'Chronic', pregnant: 'Yes', last_donation: daysAgo(100).slice(0, 10) }), recipient(), context());
  assert.equal(result.eligible, true);
  assert.equal(result.flags.length, 4);
});

test('rankDonors reports where the request stands for each donor', () => {
  const ctx = context();
  const higher = recipient({ id: 1, user_id: 11, priority: 'critical' });
  const lower = recipient({ id: 2, user_id: 12, priority: 'stable' });
  const [candidate] = rankDonors(lower, [donor()], [higher, lower], ctx);
  assert.equal(candidate.recipientRank, 2);
  assert.equal(candidate.competingRecipients, 2);
  assert.equal(rankDonors(higher, [donor()], [higher, lower], ctx)[0].recipientRank, 1);
});
