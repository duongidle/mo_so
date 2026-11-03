import crypto from 'node:crypto';

// ULID: 10 ký tự thời gian + 16 ký tự ngẫu nhiên, sắp xếp được theo thời gian tạo.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = 0;
let lastRandom = null;

function encodeTime(t) {
  let s = '';
  for (let i = 0; i < 10; i++) {
    s = ALPHABET[t % 32] + s;
    t = Math.floor(t / 32);
  }
  return s;
}

function randomPart() {
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
}

function incrementRandom(r) {
  const chars = r.split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = ALPHABET.indexOf(chars[i]);
    if (idx < 31) {
      chars[i] = ALPHABET[idx + 1];
      return chars.join('');
    }
    chars[i] = ALPHABET[0];
  }
  return chars.join('');
}

export function ulid() {
  const now = Date.now();
  if (now === lastTime && lastRandom) {
    lastRandom = incrementRandom(lastRandom);
  } else {
    lastTime = now;
    lastRandom = randomPart();
  }
  return encodeTime(now) + lastRandom;
}

/** Tạo ID có tiền tố, vd newId('ord') → ord_01J… */
export function newId(prefix) {
  return `${prefix}_${ulid()}`;
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}
