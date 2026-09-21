import { validateSupabaseCredentials } from './supabaseConnection';
const STORAGE_KEY = 'eksteel.cloud.public-connection.v1';
type PreferenceStorage = Pick<Storage, 'getItem'|'setItem'|'removeItem'>;
export function loadRememberedCloud(storage: PreferenceStorage): {url:string;key:string}|null {
  try {
    const value=JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if(!value || typeof value.url!=='string' || typeof value.key!=='string') return null;
    return validateSupabaseCredentials(value.url,value.key);
  } catch { return null; }
}
export function rememberCloud(storage: PreferenceStorage, url:string, key:string) {
  const config=validateSupabaseCredentials(url,key);
  // Explicit allowlist: never serialize form state, passwords or session tokens.
  storage.setItem(STORAGE_KEY,JSON.stringify(config));
}
export function forgetCloud(storage: PreferenceStorage) { storage.removeItem(STORAGE_KEY); }

const USER_KEY = 'eksteel.cloud.remembered-user.v1';
export function loadRememberedCloudUser(storage: PreferenceStorage): string {
  const value = storage.getItem(USER_KEY);
  return value && value.length <= 320 ? value : '';
}
export function rememberCloudUser(storage: PreferenceStorage, email: string) {
  storage.setItem(USER_KEY, email.trim().slice(0, 320));
}
export function forgetCloudUser(storage: PreferenceStorage) { storage.removeItem(USER_KEY); }
