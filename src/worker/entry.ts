import { handle, type Env } from './app';

export { ChannelGate } from './gate';

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};
