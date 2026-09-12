export const MAX_BODY_BYTES = 12 * 1024 * 1024;
export const MAX_CANVAS_ASSET_BYTES = 8 * 1024 * 1024;
export const CANVAS_REQUEST_TIMEOUT_MS = 60_000;

export type JsonObject = Record<string, unknown>;

export type DrawsySurfaceKind =
  | "canvas"
  | "presentation"
  | "kanban"
  | "jira"
  | "neutral";

export const surfaceSupportsLivePreview = (surfaceKind: DrawsySurfaceKind) =>
  surfaceKind === "canvas" || surfaceKind === "presentation";

export type CanvasSnapshot = {
  canvasId: string;
  canvasName: string;
  elements: unknown[];
  renderContext?: {
    theme: "light" | "dark";
    canvasBackgroundColor: string;
  };
  appState?: JsonObject;
  files?: JsonObject;
};

export type CanvasOperations = {
  upsertElements: unknown[];
  deleteElementIds: string[];
  files: CanvasFile[];
};

export type CanvasLayoutIssue = {
  kind:
    | "overlap"
    | "text_overflow"
    | "unbound_text"
    | "connector_collision";
  elementIds: string[];
  message: string;
};

export type CanvasLayoutReport = {
  canvasId: string;
  elementCount: number;
  issues: CanvasLayoutIssue[];
};

export type CanvasFile = {
  id: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  dataURL: string;
  created: number;
};

export type CanvasImageRequest = {
  sourcePath: string;
  x: number;
  y: number;
  maxWidth: number;
  maxHeight?: number;
  elementId?: string;
  frameId?: string | null;
};

export type CanvasContextBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasContextRequest = {
  elementIds?: string[];
  bounds?: CanvasContextBounds;
  includeSourceImages: boolean;
  maxDimension: number;
};

export type CanvasContextReference = {
  id: string;
  elementIds: string[];
  bounds: CanvasContextBounds;
};

export type AgentContextCapture = CanvasContextReference & {
  previewPath: string;
  sourceImages: Array<{ id: string; path: string }>;
};

export type CanvasImageReplacement = {
  targetElementId: string;
  file: CanvasFile;
  naturalWidth: number;
  naturalHeight: number;
};

export type LivePreviewRequest = {
  previewId?: string;
  url: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type AgentMetadata = {
  model: string;
  modelProvider: string;
  reasoningEffort: string | null;
  serviceTier: string | null;
};

export type AgentAccessMode = "workspace" | "readOnly";

export type AgentEngine = "codex" | "opencode";

export type AgentModelOption = {
  id: string;
  model: string;
  providerId?: string;
  displayName: string;
  description: string;
  efforts: Array<{ id: string; description: string }>;
  defaultEffort: string;
  isDefault: boolean;
};

export type AgentApiKeyProviderOption = {
  id: string;
  name: string;
  label: string;
  fields: Array<{
    key: string;
    label: string;
    placeholder?: string;
    type: "text" | "select";
    options?: Array<{ label: string; value: string; hint?: string }>;
    when?: { key: string; op: "eq" | "neq"; value: string };
  }>;
};

export type AgentSkillOption = {
  name: string;
  displayName: string;
  description: string;
  path: string;
};

export type AgentPluginOption = {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  path: string;
};

export type AgentMcpOption = {
  name: string;
  toolCount: number;
  authStatus: string;
};

export type AgentControls = {
  accessMode: AgentAccessMode;
  internetEnabled: boolean;
  models: AgentModelOption[];
  skills: AgentSkillOption[];
  plugins: AgentPluginOption[];
  mcpServers: AgentMcpOption[];
  apiKeyProviders: AgentApiKeyProviderOption[];
};

export type AgentSettingsPatch = {
  model?: string;
  effort?: string;
  accessMode?: AgentAccessMode;
  internetEnabled?: boolean;
  modelProvider?: string;
};

export type AgentPromptTag = {
  name: string;
  path: string;
};

export type ConnectorCapability =
  | "mail"
  | "calendar"
  | "drive"
  | "notion"
  | "slack"
  | "github"
  | "read-ai"
  | "fireflies"
  | "aws";

export type AgentConnectorSource = {
  connectionId: string;
  capability: ConnectorCapability;
  label: string;
  accountLabel: string;
};

export type AgentConnectorGrant = {
  connectionId: string;
  grant: string;
  expiresAt: number;
};

export type AgentConnectorTurn = {
  turnId: string;
  sources: AgentConnectorSource[];
  grants: AgentConnectorGrant[];
};

export type AiResourceId = "kanban" | "jira";

export type AgentResourceTurn = {
  turnId: string;
  resources: AiResourceId[];
  grant: string;
  expiresAt: number;
};

export type BridgeEvent =
  | {
      type: "session.ready";
      data: { folderName: string; agent: AgentMetadata };
    }
  | { type: "assistant.delta"; data: { delta: string; itemId: string } }
  | { type: "assistant.final"; data: { text: string; itemId: string } }
  | { type: "turn.status"; data: { status: string; error?: string } }
  | {
      type: "tool.status";
      data: {
        itemId: string;
        tool: string;
        status: "inProgress" | "completed" | "failed" | "warning";
        message?: string;
        error?: string;
      };
    }
  | {
      type: "canvas.request";
      data: {
        requestId: string;
        action:
          | "read"
          | "apply"
          | "inspect"
          | "capture"
          | "replaceImage"
          | "preview";
        canvasId: string;
        operations?: CanvasOperations;
        contextRequest?: CanvasContextRequest;
        imageReplacement?: CanvasImageReplacement;
        previewRequest?: LivePreviewRequest;
      };
    }
  | { type: "error"; data: { message: string; code: string } };

export const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const renderedElementType = (element: JsonObject) => {
  const type = typeof element.type === "string" ? element.type : "unknown";
  const rounded = isRecord(element.roundness);

  if (type === "ellipse") {
    if (element.dimensionality === "3d") {
      return "cylinder";
    }
    const width =
      typeof element.width === "number" ? Math.abs(element.width) : 0;
    const height =
      typeof element.height === "number" ? Math.abs(element.height) : 0;
    return width > 0 &&
      height > 0 &&
      Math.abs(width - height) / Math.max(width, height) <= 0.05
      ? "circle"
      : "ellipse";
  }
  if (type === "diamond") {
    return rounded ? "rounded diamond" : "diamond";
  }
  if (type === "rectangle") {
    return rounded ? "rounded rectangle" : "rectangle";
  }
  return type;
};

export const addCanvasRenderSemantics = (value: unknown): unknown => {
  if (!isRecord(value) || !Array.isArray(value.elements)) {
    return value;
  }
  const renderContext = isRecord(value.renderContext)
    ? value.renderContext
    : {};
  return {
    ...value,
    renderSemantics: {
      canvas: {
        theme:
          renderContext.theme === "dark" || renderContext.theme === "light"
            ? renderContext.theme
            : "unknown",
        backgroundColor:
          typeof renderContext.canvasBackgroundColor === "string"
            ? renderContext.canvasBackgroundColor
            : "unknown"
      },
      elements: value.elements.flatMap((element) =>
        isRecord(element) &&
        element.isDeleted !== true &&
        typeof element.id === "string"
          ? [
              {
                id: element.id,
                renderedType: renderedElementType(element)
              }
            ]
          : []
      )
    }
  };
};

const CONNECTOR_CAPABILITIES = new Set<ConnectorCapability>([
  "mail",
  "calendar",
  "drive",
  "notion",
  "slack",
  "github",
  "read-ai",
  "fireflies",
  "aws"
]);

export const isConnectorCapability = (
  value: unknown
): value is ConnectorCapability =>
  typeof value === "string" &&
  CONNECTOR_CAPABILITIES.has(value as ConnectorCapability);

const boundedConnectorString = (
  value: unknown,
  label: string,
  maxLength: number
) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
};

export const parseAgentConnectorTurn = (
  value: unknown
): AgentConnectorTurn | null => {
  if (value === undefined) return null;
  if (!isRecord(value)) {
    throw new Error("connectors must be an object.");
  }
  const allowedKeys = new Set(["turnId", "sources", "grants"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("connectors contains an unknown field.");
  }
  const turnId = boundedConnectorString(value.turnId, "turnId", 256);
  if (
    !Array.isArray(value.sources) ||
    value.sources.length < 1 ||
    value.sources.length > 12
  ) {
    throw new Error("connectors.sources must contain 1 to 12 sources.");
  }
  const sources = value.sources.map((source): AgentConnectorSource => {
    if (
      !isRecord(source) ||
      Object.keys(source).some(
        (key) =>
          !["connectionId", "capability", "label", "accountLabel"].includes(key)
      ) ||
      !isConnectorCapability(source.capability)
    ) {
      throw new Error("A connected source is invalid.");
    }
    return {
      connectionId: boundedConnectorString(
        source.connectionId,
        "source connectionId",
        256
      ),
      capability: source.capability,
      label: boundedConnectorString(source.label, "source label", 64),
      accountLabel: boundedConnectorString(
        source.accountLabel,
        "source accountLabel",
        256
      )
    };
  });
  if (
    new Set(
      sources.map((source) => `${source.connectionId}:${source.capability}`)
    ).size !== sources.length
  ) {
    throw new Error("Connected sources must be unique.");
  }
  if (
    !Array.isArray(value.grants) ||
    value.grants.length < 1 ||
    value.grants.length > 6
  ) {
    throw new Error("connectors.grants must contain 1 to 6 grants.");
  }
  const grants = value.grants.map((grant): AgentConnectorGrant => {
    if (
      !isRecord(grant) ||
      Object.keys(grant).some(
        (key) => !["connectionId", "grant", "expiresAt"].includes(key)
      ) ||
      typeof grant.expiresAt !== "number" ||
      !Number.isInteger(grant.expiresAt) ||
      grant.expiresAt <= Date.now() ||
      grant.expiresAt > Date.now() + 15 * 60 * 1000
    ) {
      throw new Error("A connector grant is invalid or expired.");
    }
    return {
      connectionId: boundedConnectorString(
        grant.connectionId,
        "grant connectionId",
        256
      ),
      grant: boundedConnectorString(grant.grant, "connector grant", 8_192),
      expiresAt: grant.expiresAt
    };
  });
  if (
    new Set(grants.map((grant) => grant.connectionId)).size !== grants.length
  ) {
    throw new Error("Connector grants must be unique per connection.");
  }
  const grantedConnections = new Set(grants.map((grant) => grant.connectionId));
  if (sources.some((source) => !grantedConnections.has(source.connectionId))) {
    throw new Error("Every connected source requires a matching grant.");
  }
  return { turnId, sources, grants };
};

const AI_RESOURCES = new Set<AiResourceId>(["kanban", "jira"]);

export const parseAgentResourceTurn = (
  value: unknown
): AgentResourceTurn | null => {
  if (value === undefined) return null;
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !["turnId", "resources", "grant", "expiresAt"].includes(key)
    ) ||
    !Array.isArray(value.resources) ||
    value.resources.length < 1 ||
    value.resources.length > AI_RESOURCES.size ||
    value.resources.some(
      (resource) =>
        typeof resource !== "string" ||
        !AI_RESOURCES.has(resource as AiResourceId)
    ) ||
    new Set(value.resources).size !== value.resources.length ||
    typeof value.expiresAt !== "number" ||
    !Number.isInteger(value.expiresAt) ||
    value.expiresAt <= Date.now() ||
    value.expiresAt > Date.now() + 15 * 60 * 1000
  ) {
    throw new Error("A Drawsy resource grant is invalid or expired.");
  }
  return {
    turnId: boundedConnectorString(value.turnId, "resource turnId", 256),
    resources: value.resources as AiResourceId[],
    grant: boundedConnectorString(value.grant, "resource grant", 8_192),
    expiresAt: value.expiresAt
  };
};

export const parseCanvasImageRequest = (value: unknown): CanvasImageRequest => {
  if (!isRecord(value)) {
    throw new Error("Canvas image request must be an object.");
  }
  const finiteWithin = (candidate: unknown, min: number, max: number) =>
    typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate >= min &&
    candidate <= max;
  if (typeof value.sourcePath !== "string" || !value.sourcePath.trim()) {
    throw new Error("sourcePath must be a non-empty string.");
  }
  if (
    !finiteWithin(value.x, -1_000_000, 1_000_000) ||
    !finiteWithin(value.y, -1_000_000, 1_000_000) ||
    !finiteWithin(value.maxWidth, Number.EPSILON, 100_000) ||
    (value.maxHeight !== undefined &&
      !finiteWithin(value.maxHeight, Number.EPSILON, 100_000)) ||
    (value.elementId !== undefined &&
      (typeof value.elementId !== "string" ||
        !value.elementId.trim() ||
        value.elementId.length > 128)) ||
    (value.frameId !== undefined &&
      value.frameId !== null &&
      (typeof value.frameId !== "string" ||
        !value.frameId.trim() ||
        value.frameId.length > 128))
  ) {
    throw new Error("Canvas image placement is invalid.");
  }
  return {
    sourcePath: value.sourcePath.trim(),
    x: value.x as number,
    y: value.y as number,
    maxWidth: value.maxWidth as number,
    ...(value.maxHeight === undefined
      ? {}
      : { maxHeight: value.maxHeight as number }),
    ...(value.elementId === undefined
      ? {}
      : { elementId: (value.elementId as string).trim() }),
    ...(value.frameId === undefined
      ? {}
      : {
          frameId:
            value.frameId === null ? null : (value.frameId as string).trim()
        })
  };
};

const finiteWithin = (candidate: unknown, min: number, max: number) =>
  typeof candidate === "number" &&
  Number.isFinite(candidate) &&
  candidate >= min &&
  candidate <= max;

export const parseLivePreviewRequest = (value: unknown): LivePreviewRequest => {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        !["previewId", "url", "title", "x", "y", "width", "height"].includes(
          key
        )
    ) ||
    typeof value.url !== "string" ||
    !value.url.trim() ||
    value.url.length > 2_048
  ) {
    throw new Error("Live preview request is invalid.");
  }

  let url: URL;
  try {
    url = new URL(value.url.trim());
  } catch {
    throw new Error("Live preview URL is invalid.");
  }
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
  if (url.hostname === "[::]") url.hostname = "[::1]";
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error("Live previews must use a local loopback URL.");
  }
  url.hash = "";

  const optionalString = (candidate: unknown, maxLength: number) =>
    candidate === undefined ||
    (typeof candidate === "string" &&
      !!candidate.trim() &&
      candidate.length <= maxLength &&
      !/[\u0000-\u001f\u007f]/.test(candidate));
  if (
    !optionalString(value.previewId, 128) ||
    !optionalString(value.title, 120) ||
    (value.x !== undefined && !finiteWithin(value.x, -1_000_000, 1_000_000)) ||
    (value.y !== undefined && !finiteWithin(value.y, -1_000_000, 1_000_000)) ||
    (value.width !== undefined && !finiteWithin(value.width, 360, 4_000)) ||
    (value.height !== undefined && !finiteWithin(value.height, 260, 4_000))
  ) {
    throw new Error("Live preview placement is invalid.");
  }

  return {
    url: url.toString(),
    ...(value.previewId === undefined
      ? {}
      : { previewId: (value.previewId as string).trim() }),
    ...(value.title === undefined
      ? {}
      : { title: (value.title as string).trim() }),
    ...(value.x === undefined ? {} : { x: value.x as number }),
    ...(value.y === undefined ? {} : { y: value.y as number }),
    ...(value.width === undefined ? {} : { width: value.width as number }),
    ...(value.height === undefined ? {} : { height: value.height as number })
  };
};

const parseContextBounds = (value: unknown): CanvasContextBounds => {
  if (
    !isRecord(value) ||
    !finiteWithin(value.x, -1_000_000, 1_000_000) ||
    !finiteWithin(value.y, -1_000_000, 1_000_000) ||
    !finiteWithin(value.width, Number.EPSILON, 2_000_000) ||
    !finiteWithin(value.height, Number.EPSILON, 2_000_000)
  ) {
    throw new Error("Canvas context bounds are invalid.");
  }
  return {
    x: value.x as number,
    y: value.y as number,
    width: value.width as number,
    height: value.height as number
  };
};

const parseElementIds = (value: unknown) => {
  if (
    !Array.isArray(value) ||
    value.length > 250 ||
    value.some((id) => typeof id !== "string" || !id.trim() || id.length > 128)
  ) {
    throw new Error("Canvas context elementIds are invalid.");
  }
  return [...new Set(value.map((id) => (id as string).trim()))];
};

export const parseCanvasContextRequest = (
  value: unknown
): CanvasContextRequest => {
  if (!isRecord(value)) {
    throw new Error("Canvas context request must be an object.");
  }
  const hasElementIds = value.elementIds !== undefined;
  const hasBounds = value.bounds !== undefined;
  if (hasElementIds === hasBounds) {
    throw new Error("Choose either elementIds or bounds for canvas context.");
  }
  const elementIds = hasElementIds ? parseElementIds(value.elementIds) : null;
  if (elementIds && !elementIds.length) {
    throw new Error("Canvas context requires at least one element.");
  }
  const maxDimension = value.maxDimension ?? 2048;
  if (!finiteWithin(maxDimension, 256, 4096)) {
    throw new Error("Canvas context maxDimension must be 256 to 4096.");
  }
  return {
    ...(elementIds ? { elementIds } : {}),
    ...(hasBounds ? { bounds: parseContextBounds(value.bounds) } : {}),
    includeSourceImages: value.includeSourceImages !== false,
    maxDimension: maxDimension as number
  };
};

export const parseCanvasContextReference = (
  value: unknown
): CanvasContextReference => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(value.id)
  ) {
    throw new Error("Canvas context reference is invalid.");
  }
  return {
    id: value.id,
    elementIds: parseElementIds(value.elementIds),
    bounds: parseContextBounds(value.bounds)
  };
};

export const parseCanvasOperations = (value: unknown): CanvasOperations => {
  if (!isRecord(value)) {
    throw new Error("Canvas operations must be an object.");
  }
  const upsertElements = value.upsertElements ?? [];
  const deleteElementIds = value.deleteElementIds ?? [];
  const files = value.files ?? [];
  if (!Array.isArray(upsertElements)) {
    throw new Error("upsertElements must be an array.");
  }
  if (
    !Array.isArray(deleteElementIds) ||
    deleteElementIds.some((id) => typeof id !== "string" || !id.trim())
  ) {
    throw new Error("deleteElementIds must contain non-empty strings.");
  }
  if (!Array.isArray(files) || files.length > 8) {
    throw new Error("files must be an array of at most 8 canvas assets.");
  }
  const parsedFiles = files.map((file) => {
    if (
      !isRecord(file) ||
      typeof file.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(file.id) ||
      (file.mimeType !== "image/png" &&
        file.mimeType !== "image/jpeg" &&
        file.mimeType !== "image/gif" &&
        file.mimeType !== "image/webp") ||
      typeof file.dataURL !== "string" ||
      !file.dataURL.startsWith(`data:${file.mimeType};base64,`) ||
      file.dataURL.length > Math.ceil((MAX_CANVAS_ASSET_BYTES * 4) / 3) + 64 ||
      typeof file.created !== "number" ||
      !Number.isFinite(file.created) ||
      file.created <= 0
    ) {
      throw new Error("files contains an invalid canvas image asset.");
    }
    return {
      id: file.id,
      mimeType: file.mimeType,
      dataURL: file.dataURL,
      created: file.created
    } as CanvasFile;
  });
  if (new Set(parsedFiles.map((file) => file.id)).size !== parsedFiles.length) {
    throw new Error("files must contain unique ids.");
  }
  return { upsertElements, deleteElementIds, files: parsedFiles };
};
