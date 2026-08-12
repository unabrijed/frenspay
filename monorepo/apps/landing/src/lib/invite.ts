// invite.ts — what the landing page knows about invite codes, which is deliberately almost nothing.
//
// There used to be a checkInvite() here that asked the backend "is this code good?" before handing
// off to the app. It is gone: the code is now spent by the same request that joins the f list
// (lib/waitlist.ts), because a check and a later burn are two moments and two people fit between
// them. All that survives is the cheap shape filter below.

/** Loose client-side shape check, so an obviously-wrong entry never costs a request against the
 *  5/min rate limit. The server canonicalises for real — this only filters the hopeless. */
export const looksLikeCode = (raw: string): boolean => raw.replace(/[^0-9a-zA-Z]/g, '').length >= 8;
