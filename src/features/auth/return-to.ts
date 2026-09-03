export function normalizeAppReturnTo(value: string | null, fallback = '/account'): string {
  if (typeof value !== 'string') return fallback;

  const candidate = value.trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return fallback;
  }

  try {
    const url = new URL(candidate, 'https://local.invalid');
    if (url.origin !== 'https://local.invalid') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
