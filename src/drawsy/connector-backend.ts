const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const LOCAL_ORIGINS = new Set([
  "http://localhost:3001",
  "http://127.0.0.1:3001"
]);

const HOSTED_ORIGINS = new Set([
  "https://drawsyai.tech",
  "https://beta.drawsyai.tech",
  "https://drawsy.adarsh.rocks"
]);

export const DEFAULT_LOCAL_CONNECTOR_BACKEND_URL =
  "http://127.0.0.1:3004";
export const DEFAULT_HOSTED_CONNECTOR_BACKEND_URL =
  "https://backend.adarsh.rocks";

export type ConnectorBackendSource =
  | "configured"
  | "local-default"
  | "hosted-default"
  | "disabled";

export type ConnectorBackendResolution = {
  url: URL | null;
  source: ConnectorBackendSource;
};

export type ConnectorBackendResolverOptions = {
  configuredUrl?: string | null;
  localUrl?: string;
  hostedUrl?: string;
};

const parseConnectorBackendUrl = (value: string, label: string) => {
  const url = new URL(value);
  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${label} must be HTTPS or a loopback HTTP URL without credentials or query parameters.`
    );
  }
  return url;
};

export const createConnectorBackendResolver = (
  options: ConnectorBackendResolverOptions = {}
) => {
  const configuredValue =
    options.configuredUrl !== undefined
      ? options.configuredUrl
      : process.env.DRAWSY_CONNECTOR_BACKEND_URL;
  const localValue =
    options.localUrl ??
    process.env.DRAWSY_LOCAL_CONNECTOR_BACKEND_URL ??
    DEFAULT_LOCAL_CONNECTOR_BACKEND_URL;
  const hostedValue =
    options.hostedUrl ??
    process.env.DRAWSY_HOSTED_CONNECTOR_BACKEND_URL ??
    DEFAULT_HOSTED_CONNECTOR_BACKEND_URL;
  const configuredUrl = configuredValue?.trim()
    ? parseConnectorBackendUrl(
        configuredValue.trim(),
        "DRAWSY_CONNECTOR_BACKEND_URL"
      )
    : null;
  const localUrl = parseConnectorBackendUrl(
    localValue,
    "DRAWSY_LOCAL_CONNECTOR_BACKEND_URL"
  );
  const hostedUrl = parseConnectorBackendUrl(
    hostedValue,
    "DRAWSY_HOSTED_CONNECTOR_BACKEND_URL"
  );

  const resolve = (origin: string | undefined): ConnectorBackendResolution => {
    if (configuredUrl) {
      return { url: configuredUrl, source: "configured" };
    }
    if (origin && LOCAL_ORIGINS.has(origin)) {
      return { url: localUrl, source: "local-default" };
    }
    if (origin && HOSTED_ORIGINS.has(origin)) {
      return { url: hostedUrl, source: "hosted-default" };
    }
    return { url: null, source: "disabled" };
  };

  return {
    resolve,
    summary: configuredUrl
      ? "configured backend"
      : "automatic local/hosted routing"
  };
};
