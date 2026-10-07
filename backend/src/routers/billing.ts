import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';

/** Stub: being built. See docs/CONTRACT.md. */
export const billingRouter = defineRouter({
  name: 'billing',
  build(app) {
    app.onError(handleError);
  },
});
