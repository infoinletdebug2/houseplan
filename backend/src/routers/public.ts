import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';

/** Stub: being built. See docs/CONTRACT.md. */
export const publicRouter = defineRouter({
  name: 'public',
  build(app) {
    app.onError(handleError);
  },
});
