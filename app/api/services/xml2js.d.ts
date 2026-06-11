declare module "xml2js" {
  export class Builder {
    constructor(opts?: Record<string, unknown>);
    buildObject(rootObj: Record<string, unknown>): string;
  }

  export function parseStringPromise(
    xml: string,
    options?: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
}
