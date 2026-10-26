export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  if (typeof window === "undefined") return {} as T;
  const subMatch = window.location.pathname.match(/^\/sub\/([^/?#]+)/);
  if (subMatch) {
    return { token: decodeURIComponent(subMatch[1]) } as unknown as T;
  }
  return {} as T;
}

export function useRouter() {
  return {
    push: (url: string) => {
      window.location.href = url;
    },
    replace: (url: string) => {
      window.location.replace(url);
    },
    back: () => {
      window.history.back();
    },
  };
}

export function usePathname(): string {
  return typeof window !== "undefined" ? window.location.pathname : "/";
}
