import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';

/** Stub: being built. See docs/CONTRACT.md. */
export const roomsRouter = defineRouter({
  name: 'rooms',
  build(app) {
    app.onError(handleError);
  },
});
