// Minimal base58 (Bitcoin alphabet) encoder — used to turn Dynamic's raw signature bytes
// into the base58 transaction signature string the backend expects. Avoids a bs58 dep.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58encode(bytes: Uint8Array): string {
  const digits = [0];
  for (let i = 0; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = '';
  for (let k = 0; k < bytes.length && bytes[k] === 0; k += 1) str += '1';
  for (let q = digits.length - 1; q >= 0; q -= 1) str += ALPHABET[digits[q]];
  return str;
}
