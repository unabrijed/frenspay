export interface FlistInvite {
  code: string;
  used: boolean;
}

/** Email comes from the authenticated identity, never a request parameter. */
export interface FlistResponse {
  email: string;
  member: boolean;
  invites: FlistInvite[];
}
