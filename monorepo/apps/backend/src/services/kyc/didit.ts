// Didit identity verification (M7). Hosted document + liveness flow: we create a session, the user
// completes it at the returned URL, and we learn the outcome from the vendor API. We treat the
// `GET decision` endpoint (authenticated with our API key) as the SOURCE OF TRUTH for tier upgrades;
// the webhook is only a fast "go check this session now" ping. That keeps correctness independent of
// the exact webhook signature/canonical-string format, which we still verify best-effort for authenticity.
import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from '../../envConfig';

import type { KycDecision, KycProvider, KycStartResult } from './provider';

const REPLAY_WINDOW_S = 300; // reject webhooks older than 5 min (replay defense)

/** Map Didit's status strings to our normalized outcome. */
function mapStatus(s: unknown): KycDecision['status'] {
  switch (String(s ?? '').toLowerCase()) {
    case 'approved':
      return 'approved';
    case 'declined':
      return 'declined';
    case 'in review':
    case 'in_review':
      return 'in_review';
    case 'expired':
    case 'kyc expired':
    case 'abandoned':
      return 'expired'; // terminal-but-unverified — stop reconciling (the user can start over)
    default:
      return 'pending'; // Not Started / In Progress / Awaiting User / Resubmitted
  }
}

// ISO 3166-1 alpha-3 → alpha-2. Didit reports document countries as alpha-3 (e.g. "IND");
// users.country stores alpha-2. Full official assignment list + XKX (Kosovo, common on documents).
const A3_TO_A2: Record<string, string> = Object.fromEntries(
  (
    'AFG:AF ALA:AX ALB:AL DZA:DZ ASM:AS AND:AD AGO:AO AIA:AI ATA:AQ ATG:AG ARG:AR ARM:AM ABW:AW AUS:AU AUT:AT AZE:AZ ' +
    'BHS:BS BHR:BH BGD:BD BRB:BB BLR:BY BEL:BE BLZ:BZ BEN:BJ BMU:BM BTN:BT BOL:BO BES:BQ BIH:BA BWA:BW BVT:BV ' +
    'BRA:BR IOT:IO BRN:BN BGR:BG BFA:BF BDI:BI CPV:CV KHM:KH CMR:CM CAN:CA CYM:KY CAF:CF TCD:TD CHL:CL CHN:CN ' +
    'CXR:CX CCK:CC COL:CO COM:KM COD:CD COG:CG COK:CK CRI:CR CIV:CI HRV:HR CUB:CU CUW:CW CYP:CY CZE:CZ DNK:DK ' +
    'DJI:DJ DMA:DM DOM:DO ECU:EC EGY:EG SLV:SV GNQ:GQ ERI:ER EST:EE SWZ:SZ ETH:ET FLK:FK FRO:FO FJI:FJ FIN:FI ' +
    'FRA:FR GUF:GF PYF:PF ATF:TF GAB:GA GMB:GM GEO:GE DEU:DE GHA:GH GIB:GI GRC:GR GRL:GL GRD:GD GLP:GP GUM:GU ' +
    'GTM:GT GGY:GG GIN:GN GNB:GW GUY:GY HTI:HT HMD:HM VAT:VA HND:HN HKG:HK HUN:HU ISL:IS IND:IN IDN:ID IRN:IR ' +
    'IRQ:IQ IRL:IE IMN:IM ISR:IL ITA:IT JAM:JM JPN:JP JEY:JE JOR:JO KAZ:KZ KEN:KE KIR:KI PRK:KP KOR:KR KWT:KW ' +
    'KGZ:KG LAO:LA LVA:LV LBN:LB LSO:LS LBR:LR LBY:LY LIE:LI LTU:LT LUX:LU MAC:MO MDG:MG MWI:MW MYS:MY MDV:MV ' +
    'MLI:ML MLT:MT MHL:MH MTQ:MQ MRT:MR MUS:MU MYT:YT MEX:MX FSM:FM MDA:MD MCO:MC MNG:MN MNE:ME MSR:MS MAR:MA ' +
    'MOZ:MZ MMR:MM NAM:NA NRU:NR NPL:NP NLD:NL NCL:NC NZL:NZ NIC:NI NER:NE NGA:NG NIU:NU NFK:NF MKD:MK MNP:MP ' +
    'NOR:NO OMN:OM PAK:PK PLW:PW PSE:PS PAN:PA PNG:PG PRY:PY PER:PE PHL:PH PCN:PN POL:PL PRT:PT PRI:PR QAT:QA ' +
    'REU:RE ROU:RO RUS:RU RWA:RW BLM:BL SHN:SH KNA:KN LCA:LC MAF:MF SPM:PM VCT:VC WSM:WS SMR:SM STP:ST SAU:SA ' +
    'SEN:SN SRB:RS SYC:SC SLE:SL SGP:SG SXM:SX SVK:SK SVN:SI SLB:SB SOM:SO ZAF:ZA SGS:GS SSD:SS ESP:ES LKA:LK ' +
    'SDN:SD SUR:SR SJM:SJ SWE:SE CHE:CH SYR:SY TWN:TW TJK:TJ TZA:TZ THA:TH TLS:TL TGO:TG TKL:TK TON:TO TTO:TT ' +
    'TUN:TN TUR:TR TKM:TM TCA:TC TUV:TV UGA:UG UKR:UA ARE:AE GBR:GB USA:US UMI:UM URY:UY UZB:UZ VUT:VU VEN:VE ' +
    'VNM:VN VGB:VG VIR:VI WLF:WF ESH:EH YEM:YE ZMB:ZM ZWE:ZW XKX:XK'
  )
    .split(' ')
    .map((p) => p.split(':') as [string, string]),
);

/** Best-effort: the document's issuing country from a decision payload, normalized to alpha-2.
 *  Didit v3 nests it under `id_verification` (`issuing_state`/`nationality`, alpha-3); we also
 *  accept top-level and alpha-2 forms so a workflow/schema drift degrades to undefined, never throws. */
function extractCountry(data: Record<string, unknown>): string | undefined {
  for (const container of [data.id_verification, data.kyc, data]) {
    if (typeof container !== 'object' || container === null) continue;
    const src = container as Record<string, unknown>;
    for (const key of ['issuing_state', 'document_country', 'nationality']) {
      const raw = String(src[key] ?? '').toUpperCase();
      const iso = raw.length === 3 ? A3_TO_A2[raw] : raw;
      if (iso && /^[A-Z]{2}$/.test(iso)) return iso;
    }
  }
  return undefined;
}

const FETCH_TIMEOUT_MS = 10_000;

async function diditFetch(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.diditBaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': config.diditApiKey, ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`didit ${path} → ${res.status} ${detail}`);
    }
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export const diditProvider: KycProvider = {
  name: 'didit',

  async start({ vendorData, callbackUrl }): Promise<KycStartResult> {
    const data = await diditFetch('/v3/session/', {
      method: 'POST',
      body: JSON.stringify({
        workflow_id: config.diditWorkflowId,
        vendor_data: vendorData,
        ...(callbackUrl ? { callback: callbackUrl } : {}),
      }),
    });
    const sessionId = typeof data.session_id === 'string' ? data.session_id : '';
    const url = typeof data.url === 'string' ? data.url : '';
    if (!sessionId || !url) throw new Error('didit: session response missing session_id/url');
    return { mode: 'redirect', sessionId, url };
  },

  async pollDecision(sessionId): Promise<KycDecision | null> {
    const data = await diditFetch(`/v3/session/${encodeURIComponent(sessionId)}/decision/`, { method: 'GET' });
    return { sessionId, status: mapStatus(data.status), country: extractCountry(data) };
  },

  verifyWebhook(body, headers): boolean {
    // No secret configured → treat as open (dev/sandbox only), mirroring the Helius webhook.
    if (!config.diditWebhookSecret) return true;

    const ts = Number(headers['x-timestamp']);
    if (Number.isFinite(ts) && Math.abs(Date.now() / 1000 - ts) > REPLAY_WINDOW_S) return false;

    const provided = headers['x-signature-simple'] || headers['x-signature'];
    if (!provided) return false;

    // Didit's "simple" signature is an HMAC-SHA256 over a small canonical string. The exact field
    // order has varied across docs, so we accept either documented form — and the decision poll is
    // authoritative regardless, so a format drift only disables the webhook fast-path, never safety.
    const candidates = [
      `${String(body.session_id)}|${String(body.status)}|${String(body.created_at)}`,
      `${headers['x-timestamp']}:${String(body.session_id)}:${String(body.status)}:${String(body.webhook_type)}`,
    ];
    return candidates.some((msg) => {
      const expected = createHmac('sha256', config.diditWebhookSecret).update(msg).digest('hex');
      try {
        return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
      } catch {
        return false; // length mismatch
      }
    });
  },
};
