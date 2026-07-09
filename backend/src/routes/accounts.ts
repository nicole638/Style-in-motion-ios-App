import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import db from '../db';

const accountsRouter = new Hono();

const signupSchema = z.object({
  name: z.string(),
  email: z.string(),
  password: z.string(),
});

const loginSchema = z.object({
  email: z.string(),
  password: z.string(),
});

type AccountRow = {
  id: number;
  name: string;
  email: string;
  password: string;
  created_at: string;
};

// POST /signup/public
accountsRouter.post(
  '/signup/public',
  zValidator('json', signupSchema),
  (c) => {
    try {
      const { name, email, password } = c.req.valid('json');

      const existing = db.prepare('SELECT id FROM public_accounts WHERE email = ?').get(email);
      if (existing) {
        return c.json({ data: { result: 'email_taken' } });
      }

      db.prepare('INSERT INTO public_accounts (name, email, password) VALUES (?, ?, ?)').run(name, email, password);
      return c.json({ data: { result: 'success', name, email } });
    } catch (err) {
      console.error('POST /signup/public error:', err);
      return c.json({ error: { message: 'Internal server error', code: 'INTERNAL_ERROR' } }, 500);
    }
  }
);

// POST /login/public
accountsRouter.post(
  '/login/public',
  zValidator('json', loginSchema),
  (c) => {
    try {
      const { email, password } = c.req.valid('json');

      const account = db.prepare('SELECT * FROM public_accounts WHERE email = ?').get(email) as AccountRow | null;
      if (!account) {
        return c.json({ data: { result: 'not_found' } });
      }
      if (account.password !== password) {
        return c.json({ data: { result: 'wrong_password' } });
      }
      return c.json({ data: { result: 'success', name: account.name, email: account.email } });
    } catch (err) {
      console.error('POST /login/public error:', err);
      return c.json({ error: { message: 'Internal server error', code: 'INTERNAL_ERROR' } }, 500);
    }
  }
);

// POST /signup/creator
accountsRouter.post(
  '/signup/creator',
  zValidator('json', signupSchema),
  (c) => {
    try {
      const { name, email, password } = c.req.valid('json');

      const existing = db.prepare('SELECT id FROM creator_accounts WHERE email = ?').get(email);
      if (existing) {
        return c.json({ data: { result: 'email_taken' } });
      }

      db.prepare('INSERT INTO creator_accounts (name, email, password) VALUES (?, ?, ?)').run(name, email, password);
      return c.json({ data: { result: 'success', name, email } });
    } catch (err) {
      console.error('POST /signup/creator error:', err);
      return c.json({ error: { message: 'Internal server error', code: 'INTERNAL_ERROR' } }, 500);
    }
  }
);

// POST /login/creator
accountsRouter.post(
  '/login/creator',
  zValidator('json', loginSchema),
  (c) => {
    try {
      const { email, password } = c.req.valid('json');

      const account = db.prepare('SELECT * FROM creator_accounts WHERE email = ?').get(email) as AccountRow | null;
      if (!account) {
        return c.json({ data: { result: 'not_found' } });
      }
      if (account.password !== password) {
        return c.json({ data: { result: 'wrong_password' } });
      }
      return c.json({ data: { result: 'success', name: account.name, email: account.email } });
    } catch (err) {
      console.error('POST /login/creator error:', err);
      return c.json({ error: { message: 'Internal server error', code: 'INTERNAL_ERROR' } }, 500);
    }
  }
);

export { accountsRouter };
