/** Backend port when using Vite dev server (proxied API calls go direct to Express). */
export const DEV_BACKEND_PORT =
  (import.meta.env.VITE_BACKEND_PORT as string | undefined) || '5005';

/**
 * Base URL for API requests. Empty in production builds (same-origin via nginx /api).
 * http://localhost:PORT when running `vite` dev server.
 */
export function getBackendBaseUrl(): string {
  if (import.meta.env.DEV) {
    return `http://localhost:${DEV_BACKEND_PORT}`;
  }
  return '';
}
