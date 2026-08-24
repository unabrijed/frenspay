// telegram/assert.ts — boot-time config sanity for the Telegram surface, in the
// assertKycConfig/assertPhoneOtpConfig family (server.ts calls it before accepting traffic).
//
// Every half-configured state here is one that boots "healthy" and then does nothing, silently —
// the exact failure class envConfig's other guards exist for. Unlike its siblings NOTHING here is
// fatal: this runs before app.listen and a throw exits(1), so a mistyped bot secret would take
// every payment on this backend into a Railway crash-loop for a channel that carries no money.
// Trading a money outage for a bot outage is the wrong trade — name the variable and boot.
import { config } from '../../envConfig';

/** Telegram's documented charset for setWebhook's secret_token: 1-256 characters, and only
 *  letters, digits, underscore and hyphen. `openssl rand -hex 32` (the documented recipe) always
 *  passes; the muscle-memory `-base64 32` yields + / = and is rejected AT setWebhook, so catching
 *  it here is the difference between a named warning and a bot that is silently never registered. */
const SECRET_TOKEN_RE = /^[A-Za-z0-9_-]{1,256}$/;

export function assertTelegramConfig(): void {
  const token = config.telegramBotToken;
  const secret = config.telegramWebhookSecret;

  if (secret && !SECRET_TOKEN_RE.test(secret)) {
    console.warn(
      '[telegram] TELEGRAM_WEBHOOK_SECRET has characters Telegram rejects (allowed: A-Za-z0-9_-). ' +
        'setWebhook will fail and the bot will never receive an update. Regenerate with `openssl rand -hex 32`.',
    );
  }
  if (!token) return; // no bot on this tier — legitimate, and the adapter/bot are inert

  // Token present: exactly one transport should be able to run. Name the dead zone if none can.
  const webhookable = !!(config.publicBaseUrl && secret);
  if (!webhookable && !config.telegramLongPollEnabled) {
    console.warn(
      config.isLocal
        ? '[telegram] bot token set but the long-poller will not start: set LOCAL_TELEGRAM_BOT_TOKEN ' +
            'to a DEV bot token (an inherited/shared STAGE_ token is refused — a local poller would ' +
            'consume stage updates). The bot is inert on this boot.'
        : `[telegram] bot token set but ${[
            secret ? null : 'TELEGRAM_WEBHOOK_SECRET',
            config.publicBaseUrl ? null : 'PUBLIC_BASE_URL',
          ]
            .filter(Boolean)
            .join(' and ')} missing — the webhook cannot register and the bot is inert on this boot.`,
    );
  }
}
