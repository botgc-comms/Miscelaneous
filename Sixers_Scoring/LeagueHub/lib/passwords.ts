const iterations = 600000;
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export async function passwordHash(
  password: string,
  salt = hex(crypto.getRandomValues(new Uint8Array(16))),
) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      iterations,
    },
    key,
    256,
  );
  return `pbkdf2-sha256:${iterations}:${salt}:${hex(new Uint8Array(bits))}`;
}
export async function passwordMatches(password: string, stored: string) {
  const parts = stored.split(':');
  if (
    parts.length !== 4 ||
    parts[0] !== 'pbkdf2-sha256' ||
    Number(parts[1]) !== iterations
  )
    return false;
  const actual = await passwordHash(password, parts[2]);
  let diff = actual.length ^ stored.length;
  for (let i = 0; i < actual.length; i++)
    diff |= actual.charCodeAt(i) ^ (stored.charCodeAt(i) || 0);
  return diff === 0;
}
