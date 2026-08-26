function contentSecurityPolicy(allowViteReactRefresh: boolean): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' https://js.tosspayments.com${allowViteReactRefresh ? " 'unsafe-inline'" : ''}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' http://127.0.0.1:3000 ws: wss: https:",
    "media-src 'self' blob: https:",
    "frame-src https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');
}

function securityHeaders(allowViteReactRefresh: boolean) {
  return Object.freeze({
    'Content-Security-Policy': contentSecurityPolicy(allowViteReactRefresh),
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(self)',
  });
}

export const webSecurityHeaders = securityHeaders(false);
export const viteDevelopmentSecurityHeaders = securityHeaders(true);
