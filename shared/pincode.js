// Suggests an Indian state or union territory from a 6-digit PIN code using India Post's
// postal ranges. It is a suggestion for form filling only; people can change the state.
// Exact six-digit ranges are checked first where a prefix is shared by two regions.
const EXACT = [
  [160001, 160036, 'Chandigarh'],
  [605001, 605014, 'Puducherry'],
  [609602, 609609, 'Puducherry'],
  [682551, 682559, 'Lakshadweep'],
];
// [first three digits from, to, state] — earlier rows win.
const PREFIXES = [
  [110, 110, 'Delhi'], [121, 136, 'Haryana'], [140, 160, 'Punjab'], [171, 177, 'Himachal Pradesh'], [194, 194, 'Ladakh'],
  [180, 193, 'Jammu and Kashmir'], [244, 249, 'Uttarakhand'], [262, 263, 'Uttarakhand'], [201, 285, 'Uttar Pradesh'],
  [301, 345, 'Rajasthan'], [360, 396, 'Gujarat'], [403, 403, 'Goa'], [400, 445, 'Maharashtra'], [490, 497, 'Chhattisgarh'],
  [450, 488, 'Madhya Pradesh'], [500, 509, 'Telangana'], [515, 535, 'Andhra Pradesh'], [560, 591, 'Karnataka'],
  [600, 643, 'Tamil Nadu'], [670, 695, 'Kerala'], [737, 737, 'Sikkim'], [744, 744, 'Andaman and Nicobar Islands'],
  [700, 743, 'West Bengal'], [751, 770, 'Odisha'], [781, 788, 'Assam'], [790, 792, 'Arunachal Pradesh'], [793, 794, 'Meghalaya'],
  [795, 795, 'Manipur'], [796, 796, 'Mizoram'], [797, 798, 'Nagaland'], [799, 799, 'Tripura'], [814, 816, 'Jharkhand'],
  [825, 835, 'Jharkhand'], [800, 855, 'Bihar'],
];

export function stateFromPincode(value) {
  const pin = String(value ?? '').trim();
  if (!/^[1-9]\d{5}$/.test(pin)) return null;
  const full = Number(pin);
  const exact = EXACT.find(([from, to]) => full >= from && full <= to);
  if (exact) return exact[2];
  const prefix = Math.floor(full / 1000);
  return PREFIXES.find(([from, to]) => prefix >= from && prefix <= to)?.[2] ?? null;
}
