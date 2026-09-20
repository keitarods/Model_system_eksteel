import { timingSafeEqual } from 'node:crypto';
export function canConfigureInstallation(url: string, provided: string) {
  if (process.env.NODE_ENV === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) return true;
  const expected = process.env.CAD_SETUP_TOKEN;
  return !!expected && expected.length >= 24 && Buffer.byteLength(expected) === Buffer.byteLength(provided)
    && timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}
