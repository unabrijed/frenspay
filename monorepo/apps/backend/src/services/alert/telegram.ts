// alert/telegram.ts — the LP alert channel that works today.
//
// Chosen over web push and email on the merits for THIS job: it reaches a locked phone in about a
// second, needs no service worker (SwKiller.tsx removes those), no app install, no store review and
// no Meta approval, and costs nothing. Email is in the registry too but is the wrong tool for a
// lock race measured in seconds; it earns its keep on KYB decisions and bond warnings.
//
// One `fetch`, no SDK — the same call shape services/email.ts uses for Resend.
import { config } from '../../envConfig';

import type { AlertMessage, AlertProvider } from './provider';

/** Telegram renders a small HTML subset; anything user-supplied has to be escaped or a payee name
 *  containing '<' silently drops the rest of the message (or 400s the whole send). */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const telegramProvider: AlertProvider = {
  id: 'telegram',
  async send(to: string, msg: AlertMessage): Promise<boolean> {
    if (!config.telegramBotToken || !to) return false;
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: to,
          text: `<b>${esc(msg.title)}</b>\n${esc(msg.body)}`,
          parse_mode: 'HTML',
          // The button is the point: an alert an LP has to go and find the app for is an alert that
          // loses the lock race to whoever was already looking at their screen.
          ...(msg.url
            ? { reply_markup: { inline_keyboard: [[{ text: 'Open', url: msg.url }]] } }
            : {}),
        }),
      });
      return res.ok;
    } catch {
      return false; // never throws: see the contract in provider.ts
    }
  },
};
