import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';

/** Stub: being built. See docs/CONTRACT.md. */
export const financeRouter = defineRouter({
  name: 'finance',
  build(app) {
    app.onError(handleError);
  },
});
