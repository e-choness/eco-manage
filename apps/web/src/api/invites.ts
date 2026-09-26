import type { InviteAccept, InvitePreview } from '@ecomanage/shared';
import api, { errorMessage } from './api';
import type { SessionUser } from './types';

export class InviteError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

const statusOf = (error: unknown): number => (error as { response?: { status?: number } }).response?.status ?? 0;

// Description: What an invite link is for, before accepting it
// Endpoint: GET /api/invites/:token (no sign-in)
// Response: InvitePreview (@ecomanage/shared); 404 unknown link, 410 used or expired
export const getInvite = async (token: string): Promise<InvitePreview> => {
  try {
    const response = await api.get(`/api/invites/${encodeURIComponent(token)}`);
    return response.data;
  } catch (error) {
    throw new InviteError(errorMessage(error), statusOf(error));
  }
};

// Description: Accept an invite: creates the account (name + password) or signs in the existing one
// Endpoint: POST /api/invites/:token/accept
// Response: user fields plus { accessToken }; the refresh token is set as an httpOnly cookie
export const acceptInvite = async (token: string, body: InviteAccept): Promise<SessionUser & { accessToken: string }> => {
  try {
    const response = await api.post(`/api/invites/${encodeURIComponent(token)}/accept`, body);
    return response.data;
  } catch (error) {
    throw new InviteError(errorMessage(error), statusOf(error));
  }
};
