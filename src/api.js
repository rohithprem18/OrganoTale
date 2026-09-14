export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'The request could not be completed.');
  return data;
}
