import bcrypt from 'bcrypt';

const DEFAULT_COST = 12;
const envCost = Number.parseInt(process.env.BCRYPT_COST ?? '', 10);
const COST = Number.isInteger(envCost) && envCost >= 4 && envCost <= 15 ? envCost : DEFAULT_COST;

export async function hash(plain) {
  return bcrypt.hash(plain, COST);
}

export async function verify(plain, storedHash) {
  if (!storedHash) return false;
  return bcrypt.compare(plain, storedHash);
}
