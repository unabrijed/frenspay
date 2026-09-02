// groups.ts — trips and circles (docs/04 §Trips, circles and splitting). A group is a named roster;
// what it holds are ordinary transfers that carry its id. Nothing here moves money: splitting and
// moving an expense live next to the request routes in money.ts, because a share IS a request.
// Every read is gated on membership and every write on ownership, inside the query itself.
import type { FastifyInstance } from 'fastify';

import type { AddMemberRequest, ApiGroupDetail, CreateGroupRequest, GroupsResponse } from '@fpay/shared';

import { requireUserId } from '../auth';
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  findUserByHandle,
  getGroupDetail,
  listGroupsForUser,
  removeGroupMember,
} from '../db/queries';

const NAME_MAX = 40; // mirrors groups_name_chk (0026) so a long name is a 400, not a 500

export async function registerGroupRoutes(app: FastifyInstance) {
  app.get('/groups', async (req): Promise<GroupsResponse> => {
    const userId = requireUserId(req);
    return { groups: await listGroupsForUser(userId) };
  });

  app.post<{ Body: CreateGroupRequest }>('/groups', async (req, reply) => {
    const userId = requireUserId(req);
    const name = (req.body?.name ?? '').trim();
    if (!name || name.length > NAME_MAX) return reply.code(400).send({ error: 'invalid_name' });
    return { id: await createGroup(userId, name) };
  });

  app.get<{ Params: { id: string } }>('/groups/:id', async (req, reply): Promise<ApiGroupDetail | undefined> => {
    const userId = requireUserId(req);
    const detail = await getGroupDetail(req.params.id, userId);
    if (!detail) {
      reply.code(404).send({ error: 'group_not_found' });
      return undefined;
    }
    return detail;
  });

  app.post<{ Params: { id: string }; Body: AddMemberRequest }>('/groups/:id/members', async (req, reply) => {
    const userId = requireUserId(req);
    const user = req.body?.handle ? await findUserByHandle(req.body.handle) : null;
    if (!user) return reply.code(404).send({ error: 'unknown_handle' });
    const ok = await addGroupMember(req.params.id, userId, user.id);
    if (!ok) return reply.code(404).send({ error: 'group_not_found' });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; userId: string } }>('/groups/:id/members/:userId', async (req, reply) => {
    const userId = requireUserId(req);
    const ok = await removeGroupMember(req.params.id, userId, req.params.userId);
    if (!ok) return reply.code(404).send({ error: 'group_not_found' });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/groups/:id', async (req, reply) => {
    const userId = requireUserId(req);
    const ok = await deleteGroup(req.params.id, userId);
    if (!ok) return reply.code(404).send({ error: 'group_not_found' });
    return { ok: true };
  });
}
