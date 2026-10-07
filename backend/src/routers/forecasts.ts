import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';

/** Stub: being built. See docs/CONTRACT.md. */
export const forecastsRouter = defineRouter({
  name: 'forecasts',
  build(app) {
    app.onError(handleError);
  },
});
