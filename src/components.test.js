import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let server, dom, React, createRoot, components, language, root, host;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  for (const key of ['window', 'document', 'HTMLElement', 'Event', 'FormData', 'localStorage']) globalThis[key] = dom.window[key];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  components = await server.ssrLoadModule('/src/components.jsx');
  language = await server.ssrLoadModule('/src/i18n.jsx');
});
afterEach(async () => {
  if (root) await React.act(() => root.unmount());
  root = null; host?.remove(); localStorage.clear();
});
after(async () => { await server?.close(); dom?.window.close(); });
const h = (...args) => React.createElement(...args);
async function mount(element) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await React.act(() => root.render(element));
}
async function submit() { await React.act(() => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }

test('wizard validates each step and rechecks previous fields before final submission', async () => {
  let submitted = 0;
  const { Wizard, Field } = components;
  await mount(h(Wizard, { onSubmit: () => submitted++, steps: [
    { title: 'Organ', content: h(Field, { label: 'Organ', name: 'organ' }) },
    { title: 'Review', content: h('p', null, 'Review') },
  ] }));
  await submit();
  assert.equal(submitted, 0);
  assert.equal(host.querySelector('.wizard-step:not([hidden])').getAttribute('aria-label'), 'Organ');
  host.querySelector('[name=organ]').value = 'Kidney';
  await submit();
  assert.equal(host.querySelector('.wizard-step:not([hidden])').getAttribute('aria-label'), 'Review');
  host.querySelector('[name=organ]').value = '';
  await submit();
  assert.equal(submitted, 0);
  assert.equal(host.querySelector('.wizard-step:not([hidden])').getAttribute('aria-label'), 'Organ');
  host.querySelector('[name=organ]').value = 'Kidney';
  await submit(); await submit();
  assert.equal(submitted, 1);
});

test('draft flushes on navigation and never stores consent', async () => {
  const { Wizard, Field, useDraftSaver, readDraft } = components;
  function DraftForm() {
    const draft = useDraftSaver('test-user');
    return h(Wizard, { draft, onSubmit: () => {}, steps: [{ title: 'Organ', content: h(React.Fragment, null,
      h(Field, { label: 'Organ', name: 'organ' }), h('input', { type: 'checkbox', name: 'consent', defaultChecked: true }),
    ) }] });
  }
  await mount(h(DraftForm));
  await React.act(() => {
    const field = host.querySelector('[name=organ]'); field.value = 'Kidney'; field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await React.act(() => root.unmount()); root = null;
  assert.equal(readDraft('test-user').values.organ, 'Kidney');
  assert.equal(readDraft('test-user').values.consent, undefined);
});

test('translated dropdown labels preserve canonical API values and unique accessible IDs', async () => {
  localStorage.setItem('organotale:language', 'hi');
  const { Field } = components;
  await mount(h(language.LanguageProvider, null, h(React.Fragment, null,
    h(Field, { label: 'Organ', name: 'organ', options: ['Kidney'] }),
    h(Field, { label: 'Organ', name: 'organ', options: ['Liver'] }),
  )));
  const controls = host.querySelectorAll('select');
  assert.notEqual(controls[0].id, controls[1].id);
  assert.equal(host.querySelector('label').textContent, 'अंग');
  assert.equal(controls[0].options[1].textContent, 'गुर्दा');
  assert.equal(controls[0].options[1].value, 'Kidney');
});

test('optimistic mutations update immediately and restore data when the server rejects', async () => {
  const { useResource } = components;
  let resource;
  function Sample() { resource = useResource(null); return h('span', null, resource.data?.status); }
  await mount(h(Sample));
  await React.act(() => resource.setData({ status: 'active' }));
  let reject;
  let result;
  await React.act(() => { result = resource.mutate(() => ({ status: 'withdrawn' }), () => new Promise((_, fail) => { reject = fail; })).catch(() => {}); });
  assert.equal(host.textContent, 'withdrawn');
  await React.act(async () => { reject(new Error('Denied')); await result; });
  assert.equal(host.textContent, 'active');
});
