const key = 'golfsixes-parent-email';
export function rememberedEmail() {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}
export function rememberEmail(email: string) {
  try {
    if (email) localStorage.setItem(key, email.trim().toLowerCase());
    else localStorage.removeItem(key);
  } catch {
    /* Optional device preference. */
  }
}
