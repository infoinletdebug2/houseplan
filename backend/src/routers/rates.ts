import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';

/** Stub: being built. See docs/CONTRACT.md. */
export const ratesRouter = defineRouter({
  name: 'rates',
  build(app) {
    app.onError(handleError);
  },
});
