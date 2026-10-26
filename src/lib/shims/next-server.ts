export type NextRequest = Request;

export interface CookieSetOptions {
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none" | boolean;
  secure?: boolean;
  path?: string;
  maxAge?: number;
}

export class NextResponse extends Response {
  cookies: {
    set: (name: string, value: string, opts?: CookieSetOptions) => void;
    delete: (name: string) => void;
  };

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
    this.cookies = {
      set: (name: string, value: string, opts?: CookieSetOptions) => {
        const parts = [`${name}=${encodeURIComponent(value)}`];
        parts.push(`Path=${opts?.path || "/"}`);
        if (typeof opts?.maxAge === "number") {
          parts.push(`Max-Age=${opts.maxAge}`);
        }
        if (opts?.httpOnly !== false) {
          parts.push("HttpOnly");
        }
        if (opts?.sameSite) {
          const ss =
            typeof opts.sameSite === "string"
              ? opts.sameSite.charAt(0).toUpperCase() + opts.sameSite.slice(1)
              : "Lax";
          parts.push(`SameSite=${ss}`);
        }
        if (opts?.secure) {
          parts.push("Secure");
        }
        this.headers.append("set-cookie", parts.join("; "));
      },
      delete: (name: string) => {
        this.headers.append("set-cookie", `${name}=; Path=/; Max-Age=0; HttpOnly`);
      },
    };
  }

  static json<T = unknown>(data: T, init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json; charset=utf-8");
    }
    return new NextResponse(JSON.stringify(data), {
      ...init,
      headers,
    });
  }
}
