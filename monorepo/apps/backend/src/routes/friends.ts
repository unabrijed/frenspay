import type { FastifyInstance } from 'fastify';
import type { SavedFriend, PeopleSuggestions, SuggestedPerson } from '@fpay/shared';
import { rankPeople } from '../lib/expenses';
import { canonicalHandle } from '../db/queries';
import { requireUserId } from '../auth';
import { getPool } from '../db/pool';

export async function registerFriendRoutes(app: FastifyInstance) {
  app.get('/friends', async (req): Promise<{ friends: SavedFriend[] }> => {
    const { rows } = await getPool().query<SavedFriend>(
      `select u.id as "userId",u.handle,coalesce(u.display_name,u.handle) as name,f.favorite
      from saved_friends f join users u on u.id=f.friend_user_id where f.owner_user_id=$1 and u.status='active'
      order by f.favorite desc,lower(coalesce(u.display_name,u.handle)),u.id`,
      [requireUserId(req)],
    );
    return { friends: rows };
  });
  app.put<{ Body: { handle: string; favorite?: boolean } }>(
    '/friends',
    {
      schema: {
        body: {
          type: 'object',
          required: ['handle'],
          additionalProperties: false,
          properties: { handle: { type: 'string', maxLength: 40 }, favorite: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => {
      const user = requireUserId(req),
        handle = canonicalHandle(req.body.handle);
      const result = await getPool().query(
        `insert into saved_friends(owner_user_id,friend_user_id,favorite)
      select $1,u.id,coalesce($3,false) from users u where u.handle=$2 and u.id<>$1 and u.status='active'
      on conflict(owner_user_id,friend_user_id) do update set favorite=coalesce($3,saved_friends.favorite)`,
        [user, handle, req.body.favorite ?? null],
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'unknown_handle' });
      return { ok: true };
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/friends/:id',
    {
      schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } },
    },
    async (req) => {
      await getPool().query('delete from saved_friends where owner_user_id=$1 and friend_user_id=$2', [
        requireUserId(req),
        req.params.id,
      ]);
      return { ok: true };
    },
  );
  app.get<{ Querystring: { groupId?: string; timeZone?: string } }>(
    '/friends/suggestions',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { groupId: { type: 'string', format: 'uuid' }, timeZone: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (req, reply): Promise<PeopleSuggestions | unknown> => {
      const user = requireUserId(req),
        group = req.query.groupId ?? null,
        tz = req.query.timeZone ?? 'UTC';
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
      } catch {
        return reply.code(400).send({ error: 'invalid_timezone' });
      }
      if (
        group &&
        !(await getPool().query('select 1 from group_members where group_id=$1 and user_id=$2', [group, user])).rowCount
      )
        return reply.code(404).send({ error: 'group_not_found' });
      const { rows } = await getPool().query<
        SavedFriend & { saved: boolean; trip: boolean; count: number; routineCount: number; lastAt: number }
      >(
        `
      with interactions as (
        select other.user_id as person,e.created_at as at from expenses e
        join expense_participants me on me.expense_id=e.id and me.user_id=$1
        join expense_participants other on other.expense_id=e.id and other.user_id<>$1
        where e.state='published' and e.created_at>now()-interval '90 days'
        union all
        select case when t.from_user_id=$1 then t.to_user_id else t.from_user_id end,t.created_at
        from transfers t where (t.from_user_id=$1 or t.to_user_id=$1) and t.status='confirmed' and t.kind='send'
        and t.created_at>now()-interval '90 days' and t.request_id is null
        and not exists(select 1 from expense_payments ep where ep.transfer_id=t.id)
        and not exists(select 1 from payment_requests r where r.transfer_id=t.id)
      ), history as (
        select person,count(*)::integer as count,extract(epoch from max(at))*1000 as last_at,
          count(*) filter(where (extract(isodow from at at time zone $3) in (6,7))=(extract(isodow from now() at time zone $3) in (6,7))
            and floor(extract(hour from at at time zone $3)/6)=floor(extract(hour from now() at time zone $3)/6))::integer as routine_count
        from interactions where person is not null and person<>$1 group by person
      ) select u.id as "userId",u.handle,coalesce(u.display_name,u.handle) as name,coalesce(f.favorite,false) as favorite,
        f.friend_user_id is not null as saved,m.user_id is not null as trip,coalesce(h.count,0) as count,
        coalesce(h.routine_count,0) as "routineCount",coalesce(h.last_at,0)::float8 as "lastAt"
      from users u left join saved_friends f on f.friend_user_id=u.id and f.owner_user_id=$1
      left join history h on h.person=u.id left join group_members m on m.user_id=u.id and m.group_id=$2
      where u.id<>$1 and u.status='active' and (f.friend_user_id is not null or h.person is not null or m.user_id is not null)`,
        [user, group, tz],
      );
      const people: SuggestedPerson[] = rankPeople(rows)
        .slice(0, 12)
        .map((p) => ({
          userId: p.userId,
          handle: p.handle,
          name: p.name,
          favorite: p.favorite,
          saved: p.saved,
          reason: p.trip
            ? 'trip'
            : p.favorite
              ? 'favorite'
              : p.routineCount >= 3
                ? 'routine'
                : p.count >= 3
                  ? 'frequent'
                  : 'recent',
        }));
      const { rows: groups } = await getPool().query<{ id: string; name: string }>(
        `select g.id,g.name from groups g
      join group_members me on me.group_id=g.id and me.user_id=$1
      order by (g.id=$2) desc nulls last,coalesce((select max(e.created_at) from expenses e where e.group_id=g.id),g.created_at) desc,g.id limit 5`,
        [user, group],
      );
      return { people, groups };
    },
  );
  // Return only an unused invite belonging to this account. The client opens the user's own
  // SMS composer; no phone number is uploaded here and no SMS is sent by the backend.
  app.get('/friends/invite', async (req) => {
    const { rows } = await getPool().query<{ code: string }>(
      `select i.code from invite_codes i join users u on u.id=$1
      where i.revoked_at is null and i.redeemed_at is null and (i.owner_id=u.id or i.owner_email=u.email)
      order by i.created_at,i.code limit 1`,
      [requireUserId(req)],
    );
    return { code: rows[0]?.code ?? null };
  });
}
