/** Trazas compactas de red para seguir el flujo sin volcar credenciales ni payloads. */
export function logRequestStart(method: string, url: string, label?: string): number {
  const startedAt = Date.now();
  console.info(`[request] → ${method.toUpperCase()} ${safeTarget(url)}${label ? ` (${label})` : ""}`);
  return startedAt;
}

export function logRequestEnd(
  method: string,
  url: string,
  startedAt: number,
  status: number | "ERROR",
  label?: string,
): void {
  const elapsed = Date.now() - startedAt;
  const outcome = status === "ERROR" ? "falló" : String(status);
  console.info(`[request] ← ${method.toUpperCase()} ${safeTarget(url)} ${outcome} ${elapsed}ms${label ? ` (${label})` : ""}`);
}

function safeTarget(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl.split("?")[0] ?? rawUrl;
  }
}
