import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';

/** Stub: being built. See docs/CONTRACT.md. */
export const projectsRouter = defineRouter({
  name: 'projects',
  build(app) {
    app.onError(handleError);
  },
});
