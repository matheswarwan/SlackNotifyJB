declare module 'postmonger' {
  import type { Transport } from './session';
  const postmonger: { Session: new () => Transport };
  export default postmonger;
}
