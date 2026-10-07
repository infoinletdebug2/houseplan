import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';

/** Stub: being built. See docs/CONTRACT.md. */
export const estimatesRouter = defineRouter({
  name: 'estimates',
  build(app) {
    app.onError(handleError);
  },
});
