const COMMON = ['password1234', 'passw0rd1234', '123456789012', '1234567890123', 'qwertyuiop12', 'qwerty123456', 'admin1234567', 'letmein12345', 'welcome12345', 'iloveyou1234'];

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 12) return 'Use at least 12 characters.';
  if (password.length > 128) return 'Use at most 128 characters.';
  if (/^(.)\1+$/.test(password)) return 'Do not repeat a single character.';
  const lower = password.toLowerCase();
  if (COMMON.some((c) => lower.includes(c))) return 'That password is too common. Try a few unrelated words and a number.';
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return 'The password should not contain your email name.';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return 'Include both letters and numbers.';
  return null;
}
