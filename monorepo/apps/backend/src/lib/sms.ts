/** SMS recipients must be a single normalized phone number, never a URI or a recipient list. */
export function smsInviteUrl(phone: string, message: string, ios = false): string {
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error('invalid_phone');
  return `sms:${phone}${ios ? '&' : '?'}body=${encodeURIComponent(message)}`;
}
