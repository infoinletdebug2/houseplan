import { Hono } from 'hono';

/** Stub: the website (landing, legal, support, delete-account, admin console) is being built. */
export const site = new Hono();
site.get('/', (c) => c.text('HousePlan'));
