/** World asset paths ("assets/...") are served by the client from /assets for now. */
export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return '/' + path.replace(/^\/+/, '');
}
