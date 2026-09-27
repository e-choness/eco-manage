// Packages without their own type declarations, typed as far as the converter uses them.

declare module 'draco3dgltf' {
  const draco3d: {
    createDecoderModule(options?: object): Promise<unknown>;
    createEncoderModule(options?: object): Promise<unknown>;
  };
  export default draco3d;
}

declare module 'gltf-validator' {
  interface Message {
    code: string;
    message: string;
    severity: number; // 0 error, 1 warning, 2 info, 3 hint
    pointer?: string;
  }
  interface Report {
    issues?: { numErrors: number; numWarnings: number; messages: Message[] };
  }
  const validator: {
    validateBytes(data: Uint8Array, options?: { maxIssues?: number; externalResourceFunction?: (uri: string) => Promise<Uint8Array> }): Promise<Report>;
  };
  export default validator;
}
