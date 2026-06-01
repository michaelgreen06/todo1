declare module "node:child_process" {
  export function execFileSync(
    file: string,
    args: ReadonlyArray<string>,
    options: { readonly encoding: "utf8" },
  ): string;
}

declare module "node:crypto" {
  export function createHash(
    algorithm: "sha256",
  ): {
    update(data: string, inputEncoding?: "utf8"): {
      digest(encoding: "hex"): string;
    };
  };

  export function randomBytes(size: number): {
    toString(encoding: "hex"): string;
  };
}

declare module "node:http" {
  export type IncomingHttpHeaders = Readonly<
    Record<string, string | ReadonlyArray<string> | undefined>
  >;

  export type IncomingMessage = {
    readonly method?: string;
    readonly url?: string;
    readonly headers: IncomingHttpHeaders;
    on(event: "data", listener: (chunk: Uint8Array) => void): void;
    on(event: "end", listener: () => void): void;
    on(event: "error", listener: (error: Error) => void): void;
  };

  export type ServerResponse = {
    statusCode: number;
    setHeader(name: string, value: string | ReadonlyArray<string>): void;
    end(data?: string): void;
  };

  export type Server = {
    listen(port: number, hostname: string, callback?: () => void): void;
  };

  export function createServer(
    listener: (request: IncomingMessage, response: ServerResponse) => void,
  ): Server;
}

declare module "node:process" {
  export const argv: ReadonlyArray<string>;
  export const env: Record<string, string | undefined>;
  export function exit(code?: number): never;
}
