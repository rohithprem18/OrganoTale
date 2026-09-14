import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateFromPincode } from '../shared/pincode.js';
import { STATES } from '../shared/options.js';

test('PIN codes suggest the right state or union territory', () => {
  const cases = {
    110001: 'Delhi', 400001: 'Maharashtra', 411001: 'Maharashtra', 403001: 'Goa', 560001: 'Karnataka', 600001: 'Tamil Nadu',
    605001: 'Puducherry', 682001: 'Kerala', 682555: 'Lakshadweep', 500001: 'Telangana', 520001: 'Andhra Pradesh',
    700001: 'West Bengal', 737101: 'Sikkim', 744101: 'Andaman and Nicobar Islands', 800001: 'Bihar', 834001: 'Jharkhand',
    160017: 'Chandigarh', 160062: 'Punjab', 194101: 'Ladakh', 190001: 'Jammu and Kashmir', 248001: 'Uttarakhand',
    226001: 'Uttar Pradesh', 302001: 'Rajasthan', 380001: 'Gujarat', 462001: 'Madhya Pradesh', 492001: 'Chhattisgarh',
    751001: 'Odisha', 781001: 'Assam', 795001: 'Manipur', 799001: 'Tripura',
  };
  for (const [pin, state] of Object.entries(cases)) assert.equal(stateFromPincode(pin), state, pin);
});

test('invalid or unknown PIN codes suggest nothing, and every suggestion is a known state', () => {
  for (const value of ['', '12345', '0110001', 'abcdef', '999999', null]) assert.equal(stateFromPincode(value), null);
  for (let pin = 100000; pin <= 999999; pin += 997) {
    const state = stateFromPincode(pin);
    if (state) assert.ok(STATES.includes(state), `${pin} → ${state}`);
  }
});


test('postal directory parsing preserves ambiguous districts, deduplicates offices and caches results', async () => {
  const { parsePostalLocations, postalLookup } = await import('./pincode.js');
  const payload = [{ Status: 'Success', PostOffice: [
    { District: 'Mumbai', State: 'Maharashtra' }, { District: 'Mumbai', State: 'Maharashtra' },
    { District: 'Thane', State: 'Maharashtra' }, { District: 'Unknown', State: 'Invalid state' },
  ] }];
  assert.deepEqual(parsePostalLocations(payload), [{ city: 'Mumbai', state: 'Maharashtra' }, { city: 'Thane', state: 'Maharashtra' }]);
  assert.deepEqual(parsePostalLocations([{ Status: 'Error', PostOffice: null }]), []);
  let calls = 0;
  const lookup = postalLookup(async () => { calls++; return new Response(JSON.stringify(payload)); });
  await lookup('400001'); await lookup('400001');
  assert.equal(calls, 1);
});
