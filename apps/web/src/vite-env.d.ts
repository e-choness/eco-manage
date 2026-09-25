
/// <reference types="vite/client" />


declare module 'json-bigint' {
  const JSONbig: { parse: (text: string) => unknown; stringify: (value: unknown) => string };
  export default JSONbig;
}
