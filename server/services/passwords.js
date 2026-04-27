import bcrypt from 'bcrypt';

const COST = 12;

export async function hash(plain) {
  return bcrypt.hash(plain, COST);
}

export async function verify(plain, storedHash) {
  if (!storedHash) return false;
  return bcrypt.compare(plain, storedHash);
}
