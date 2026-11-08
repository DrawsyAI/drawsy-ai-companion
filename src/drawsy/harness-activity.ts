const usageFields = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cachedInputTokens",
  "reasoningTokens",
  "cacheWriteTokens",
  "costUsd"
] as const;

type Usage = Partial<Record<typeof usageFields[number], number>>;
type UsageSummary = Usage & { samples: number };
type DailyActivity = { prompts: number; usage: UsageSummary };
type ModelActivity = {
  model: string | null;
  provider: string | null;
  messages: number;
  usage: UsageSummary;
  usageIds: string[];
  daily?: Record<string, DailyActivity>;
};

type ActivityChat = {
  id: string;
  title: string;
  canvasName: string | null;
  updatedAt: number;
  messageCount: number;
  activity?: ModelActivity[];
};

const record = (value: unknown) =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const label = (value: unknown) =>
  typeof value === "string" ? value.trim() || null : null;

const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value : 0;

const modelKey = (model: string | null, provider: string | null) =>
  JSON.stringify([model, provider]);

const readUsage = (value: unknown): Usage => {
  const source = record(value);
  const result: Usage = {};
  for (const field of usageFields) {
    const amount = source[field];
    if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0 &&
        (field === "costUsd" || Number.isSafeInteger(amount))) {
      result[field] = amount;
    }
  }
  return result;
};

const readUsageSummary = (value: unknown): UsageSummary => ({
  ...readUsage(value),
  samples: count(record(value).samples)
});

const readDaily = (value: unknown): ModelActivity["daily"] => {
  const days = Object.entries(record(value))
    .filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day));
  if (!days.length) return undefined;
  return Object.fromEntries(days.map(([day, entry]) => {
    const item = record(entry);
    return [day, { prompts: count(item.prompts), usage: readUsageSummary(item.usage) }];
  }));
};

export const readHarnessActivity = (value: unknown): ModelActivity[] | undefined =>
  Array.isArray(value) ? value.map((entry) => {
    const item = record(entry);
    const model = label(item.model);
    return {
      model,
      provider: model ? label(item.provider) : null,
      messages: count(item.messages),
      usage: readUsageSummary(item.usage),
      daily: readDaily(item.daily),
      usageIds: Array.isArray(item.usageIds)
        ? item.usageIds.filter((id): id is string => typeof id === "string") : []
    };
  }) : undefined;

const modelActivity = (chat: ActivityChat, modelName: unknown, providerName: unknown) => {
  const model = label(modelName);
  const provider = model ? label(providerName) : null;
  const activities = chat.activity ??= [];
  const existing = activities.find((item) => item.model === model && item.provider === provider);
  if (existing) return existing;
  const entry: ModelActivity = { model, provider, messages: 0, usage: { samples: 0 }, usageIds: [] };
  activities.push(entry);
  return entry;
};

const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);

const activityForDay = (entry: ModelActivity, day: string) => {
  const daily = entry.daily ??= {};
  return daily[day] ??= { prompts: 0, usage: { samples: 0 } };
};

export const recordHarnessMessage = (chat: ActivityChat, model: unknown, provider: unknown) => {
  const entry = modelActivity(chat, model, provider);
  entry.messages += 1;
  activityForDay(entry, utcDay(chat.updatedAt)).prompts += 1;
};

const addUsage = (target: Usage, source: Usage) => {
  for (const field of usageFields) {
    const amount = source[field];
    if (amount !== undefined) target[field] = (target[field] ?? 0) + amount;
  }
};

export const recordHarnessUsage = (
  chat: ActivityChat,
  event: { usageId: string; usage: unknown; model?: string; modelProvider?: string },
  recordedAt = Date.now()
) => {
  if (!event.usageId || chat.activity?.some((item) => item.usageIds.includes(event.usageId))) return;
  const usage = readUsage(event.usage);
  if (!Object.keys(usage).length) return;
  const entry = modelActivity(chat, event.model, event.modelProvider);
  entry.usageIds.push(event.usageId);
  entry.usage.samples += 1;
  addUsage(entry.usage, usage);
  const daily = activityForDay(entry, utcDay(recordedAt));
  daily.usage.samples += 1;
  addUsage(daily.usage, usage);
};

export const listHarnessActivity = (
  chats: ActivityChat[], page: number, filter: string | null, now = Date.now()
) => {
  const models = new Map<string, { key: string; model: string | null; provider: string | null }>();
  const usage: UsageSummary = { samples: 0 };
  const daily = new Map<string, DailyActivity>();
  const today = utcDay(now);
  const firstDay = utcDay(now - 29 * 86_400_000);
  const matched = [];
  for (const chat of chats) {
    if (!chat.messageCount) continue;
    const activity = chat.activity ?? [];
    const legacyMessages = Math.max(0, chat.messageCount - activity.reduce((sum, item) => sum + item.messages, 0));
    let messages = filter === null || filter === modelKey(null, null) ? legacyMessages : 0;
    let included = messages > 0;
    if (legacyMessages) {
      const key = modelKey(null, null);
      models.set(key, { key, model: null, provider: null });
    }
    for (const item of activity) {
      const key = modelKey(item.model, item.provider);
      models.set(key, { key, model: item.model, provider: item.provider });
      if (filter !== null && filter !== key) continue;
      included = true;
      messages += item.messages;
      usage.samples += item.usage.samples;
      addUsage(usage, item.usage);
      for (const [day, entry] of Object.entries(item.daily ?? {})) {
        if (day < firstDay || day > today) continue;
        const summary = daily.get(day) ?? { prompts: 0, usage: { samples: 0 } };
        summary.prompts += entry.prompts;
        summary.usage.samples += entry.usage.samples;
        addUsage(summary.usage, entry.usage);
        daily.set(day, summary);
      }
    }
    if (included) {
      const { id, title, canvasName, updatedAt } = chat;
      matched.push({ id, title, canvasName, updatedAt, messageCount: messages });
    }
  }
  const pageSize = 10;
  matched.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  return {
    models: [...models.values()].sort((a, b) => {
      if (a.model === null) return b.model === null ? 0 : 1;
      if (b.model === null) return -1;
      return a.model.localeCompare(b.model) || (a.provider ?? "").localeCompare(b.provider ?? "");
    }),
    chats: matched.slice((page - 1) * pageSize, page * pageSize),
    total: matched.length,
    page,
    pageSize,
    usage,
    daily: [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, summary]) => ({ day, ...summary }))
  };
};
