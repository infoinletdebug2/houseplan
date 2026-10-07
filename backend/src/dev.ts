import { serve } from '@hono/node-server';
import worker from './index';

/** Local dev server. `wrangler dev` is the higher-fidelity option. */
const port = Number(process.env.PORT ?? 8797);

serve({ fetch: worker.fetch, port }, (info) => {
  console.log(`houseplan backend on http://localhost:${info.port}`);
});
