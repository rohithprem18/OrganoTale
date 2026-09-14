import { STATES } from '../shared/options.js';

// PostalPinCode is a third-party directory. Return editable district/city suggestions.
export function parsePostalLocations(payload) {
  const offices = payload?.[0]?.Status === 'Success' ? payload[0].PostOffice : [];
  const locations = new Map();
  for (const office of Array.isArray(offices) ? offices : []) {
    const state = STATES.find((s) => s.toLowerCase() === String(office.State).toLowerCase());
    const city = String(office.District || '').trim();
    if (state && city && city !== 'NA') locations.set(`${city}:${state}`, { city, state });
  }
  return [...locations.values()];
}

export function postalLookup(fetcher = fetch) {
  const cache = new Map();
  return async (pin) => {
    const cached = cache.get(pin);
    if (cached && cached.until > Date.now()) return cached.locations;
    const response = await fetcher(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Postal directory unavailable');
    const locations = parsePostalLocations(await response.json());
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(pin, { locations, until: Date.now() + 86400000 });
    return locations;
  };
}
