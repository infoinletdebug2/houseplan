import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';

/** Stub: being built. See docs/CONTRACT.md. */
export const advisorRouter = defineRouter({
  name: 'advisor',
  build(app) {
    app.onError(handleError);
  },
});
