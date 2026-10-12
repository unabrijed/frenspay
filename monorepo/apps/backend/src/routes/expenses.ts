import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ExpenseEdit } from '@fpay/shared';
import { requireUserId } from '../auth';
import {
  addExpensePayment,
  createExpense,
  editExpense,
  eligiblePaymentsPage,
  ExpenseError,
  expenseForTransfer,
  expenseSpendSummary,
  getExpense,
  listExpensesPage,
  publishExpense,
  removeExpensePayment,
} from '../db/expenses';
import { metrics } from '../services/metrics';

const uuid = { type: 'string', format: 'uuid' } as const;
const version = { type: 'integer', minimum: 1 } as const;
const params = { type: 'object', required: ['id'], properties: { id: uuid } } as const;
export async function expenseReply<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ExpenseError) {
      metrics.inc(`expense_${e.message}`);
      return reply.code(e.status).send({ error: e.message });
    }
    if (
      e instanceof Error &&
      ['invalid_amount', 'invalid_participants', 'shares_exceed_amount', 'unbalanced_expense'].includes(e.message)
    )
      return reply.code(400).send({ error: e.message });
    throw e;
  }
}
export async function registerExpenseRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { filter?: 'all' | 'personal' | 'trips'; timeZone?: string } }>(
    '/expenses/summary',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            filter: { type: 'string', enum: ['all', 'personal', 'trips'] },
            timeZone: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const zone = req.query.timeZone ?? 'UTC';
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
      } catch {
        return reply.code(400).send({ error: 'invalid_timezone' });
      }
      return expenseSpendSummary(requireUserId(req), req.query.filter ?? 'all', zone);
    },
  );
  const pageSchema = {
    querystring: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cursor: { type: 'string', maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  };
  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/expenses',
    { schema: pageSchema },
    async (req, reply) => expenseReply(reply, () => listExpensesPage(requireUserId(req), req.query)),
  );
  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    '/expenses/eligible-payments',
    { schema: pageSchema },
    async (req, reply) => expenseReply(reply, () => eligiblePaymentsPage(requireUserId(req), req.query)),
  );
  app.get<{ Params: { id: string } }>('/expenses/for-transfer/:id', { schema: { params } }, async (req, reply) =>
    expenseReply(reply, async () => ({ expense: await expenseForTransfer(req.params.id, requireUserId(req)) })),
  );
  app.get<{ Params: { id: string } }>('/expenses/:id', { schema: { params } }, async (req, reply) =>
    expenseReply(reply, () => getExpense(req.params.id, requireUserId(req))),
  );
  app.post<{ Body: { transferId: string; groupId?: string | null } }>(
    '/expenses',
    {
      schema: {
        body: {
          type: 'object',
          required: ['transferId'],
          additionalProperties: false,
          properties: { transferId: uuid, groupId: { anyOf: [uuid, { type: 'null' }] } },
        },
      },
    },
    async (req, reply) =>
      expenseReply(reply, () => createExpense(requireUserId(req), req.body.transferId, req.body.groupId)),
  );
  app.patch<{ Params: { id: string }; Body: ExpenseEdit }>(
    '/expenses/:id',
    {
      schema: {
        params,
        body: {
          type: 'object',
          required: ['version'],
          additionalProperties: false,
          properties: {
            version,
            note: { type: 'string', minLength: 1, maxLength: 80 },
            groupId: { anyOf: [uuid, { type: 'null' }] },
            equal: { type: 'boolean' },
            participants: {
              type: 'array',
              minItems: 1,
              maxItems: 21,
              items: {
                type: 'object',
                required: ['handle'],
                additionalProperties: false,
                properties: {
                  handle: { type: 'string', maxLength: 40 },
                  shareUsd: { type: 'string', pattern: '^\\d{1,14}(\\.\\d{1,6})?$' },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => expenseReply(reply, () => editExpense(requireUserId(req), req.params.id, req.body)),
  );
  app.post<{ Params: { id: string }; Body: { transferId: string; version: number } }>(
    '/expenses/:id/payments',
    {
      schema: {
        params,
        body: {
          type: 'object',
          required: ['transferId', 'version'],
          additionalProperties: false,
          properties: { transferId: uuid, version },
        },
      },
    },
    async (req, reply) =>
      expenseReply(reply, () =>
        addExpensePayment(requireUserId(req), req.params.id, req.body.transferId, req.body.version),
      ),
  );
  app.delete<{ Params: { id: string; transferId: string }; Body: { version: number } }>(
    '/expenses/:id/payments/:transferId',
    {
      schema: {
        params: { type: 'object', required: ['id', 'transferId'], properties: { id: uuid, transferId: uuid } },
        body: { type: 'object', required: ['version'], additionalProperties: false, properties: { version } },
      },
    },
    async (req, reply) =>
      expenseReply(reply, () =>
        removeExpensePayment(requireUserId(req), req.params.id, req.params.transferId, req.body.version),
      ),
  );
  app.post<{ Params: { id: string }; Body: { version: number } }>(
    '/expenses/:id/publish',
    {
      schema: {
        params,
        body: { type: 'object', required: ['version'], additionalProperties: false, properties: { version } },
      },
    },
    async (req, reply) =>
      expenseReply(reply, async () => {
        return publishExpense(requireUserId(req), req.params.id, req.body.version);
      }),
  );
}
