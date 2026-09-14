import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Combobox, Field } from './components';
import { STATES } from '../shared/options';
import { useT } from './i18n';

const options = STATES.map((s) => ({ value: s, label: s }));
export function LocationFields({ initial = {}, pinName = 'pincode', required = true, includeLocation = true }) {
  const t = useT();
  const [pin, setPin] = useState(initial[pinName] || '');
  const [city, setCity] = useState(initial.city || '');
  const [state, setState] = useState(initial.state || '');
  const [hint, setHint] = useState('');
  const [locations, setLocations] = useState([]);
  const revision = useRef(0);
  const container = useRef(null);
  const lastLocation = useRef(`${initial.city || ''}|${initial.state || ''}`);
  useEffect(() => {
    let active = true;
    const version = revision.current;
    setLocations([]);
    setHint('');
    if (!/^[1-9]\d{5}$/.test(pin)) return undefined;
    const timer = setTimeout(async () => {
      setHint(t('Looking up location…'));
      try {
        const result = await api(`/pincodes/${pin}`);
        if (!active || revision.current !== version) return;
        setLocations(result.locations);
        if (result.locations.length === 1) {
          const found = result.locations[0];
          setCity(found.city); setState(found.state);
          setHint(`${found.city}, ${found.state}. ${t('Check this suggestion before continuing.')}`);
        } else setHint(t(result.locations.length ? 'Choose your location or enter it below.' : 'PIN not found. Enter your location manually.'));
      } catch {
        if (active) setHint(t('Location lookup unavailable. Enter your location manually.'));
      }
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [pin]);
  useEffect(() => {
    // Controlled autofill must also reach the wizard's draft autosave listener,
    // but only when the location really changed, or an untouched form would save an empty draft.
    const current = `${city}|${state}`;
    if (current === lastLocation.current) return;
    lastLocation.current = current;
    container.current?.querySelector('input')?.dispatchEvent(new Event('input', { bubbles: true }));
  }, [city, state]);
  return <div ref={container} className="location-fields">
    <Field label="PIN code" name={pinName} required={required} inputMode="numeric" autoComplete="postal-code" pattern="[1-9][0-9]{5}" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} hint={hint || t('Enter six digits to look up your city and state.')} />
    {includeLocation && <><Field label="City" name="city" maxLength={100} autoComplete="address-level2" value={city} onChange={(e) => { revision.current++; setCity(e.target.value); }} /><Combobox label="State" name="state" options={options} value={state} onChange={(value) => { revision.current++; setState(value); }} placeholder={t('Search states')} wide />
      {locations.length > 1 && <div className="wide"><Combobox label="Suggested location" name="location_suggestion" required={false} options={locations.map((l) => ({ value: `${l.city}|${l.state}`, label: `${l.city}, ${l.state}` }))} onChange={(value) => { if (value) { const [c, s] = value.split('|'); setCity(c); setState(s); } }} /></div>}</>}
  </div>;
}
