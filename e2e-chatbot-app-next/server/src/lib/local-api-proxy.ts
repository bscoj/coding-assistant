const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function getConfiguredApiProxy(): string | undefined {
  const proxy = process.env.API_PROXY?.trim();
  return proxy ? proxy : undefined;
}

export function shouldFailFastForLocalApiProxy(): boolean {
  const proxy = getConfiguredApiProxy();
  if (!proxy) {
    return false;
  }

  try {
    const url = new URL(proxy);
    return LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return (
      proxy.includes('localhost') ||
      proxy.includes('127.0.0.1') ||
      proxy.includes('[::1]')
    );
  }
}

export function formatLocalApiProxyUnavailableMessage(
  defaultMessage: string,
): string {
  const proxy = getConfiguredApiProxy();

  if (
    !proxy ||
    !shouldFailFastForLocalApiProxy() ||
    !defaultMessage.toLowerCase().includes('cannot connect to api')
  ) {
    return defaultMessage;
  }

  return `Local agent backend is unreachable at ${proxy}. Start it with \`uv run start-app\` from the repo root, or \`uv run start-server\` if the UI is already running.`;
}
