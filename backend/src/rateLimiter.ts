
import { connection } from "./queue.js";

const HOUR_MS = 60 * 60 * 1000;

const DEFAULTS = {
  globalHourlyLimit: 100,
  senderHourlyLimit: 30,
  minimumDelaySeconds: 2,
};

export type RateLimitSettings = {
  globalHourlyLimit: number;
  senderHourlyLimit: number;
  minimumDelaySeconds: number;
};

export async function getRateLimitSettings(): Promise<RateLimitSettings> {
  const values = await connection.mget(
    "reachinbox:settings:globalHourlyLimit",
    "reachinbox:settings:senderHourlyLimit",
    "reachinbox:settings:minimumDelaySeconds"
  );

  return {
    globalHourlyLimit: Math.max(
      1,
      Number(values[0]) || DEFAULTS.globalHourlyLimit
    ),
    senderHourlyLimit: Math.max(
      1,
      Number(values[1]) || DEFAULTS.senderHourlyLimit
    ),
    
minimumDelaySeconds: Math.max(
  0,
  values[2] !== null && values[2] !== undefined &&
    Number.isFinite(Number(values[2]))
    ? Number(values[2])
    : DEFAULTS.minimumDelaySeconds
),
  };
}

export async function saveRateLimitSettings(
  settings: RateLimitSettings
): Promise<void> {
  await connection
    .multi()
    .set(
      "reachinbox:settings:globalHourlyLimit",
      String(settings.globalHourlyLimit)
    )
    .set(
      "reachinbox:settings:senderHourlyLimit",
      String(settings.senderHourlyLimit)
    )
    .set(
      "reachinbox:settings:minimumDelaySeconds",
      String(settings.minimumDelaySeconds)
    )
    .exec();
}

/**
 * Atomically checks hourly limits and reserves the next send slot.
 * Counters are incremented only when a send slot is available.
 */
const reserveSendScript = `
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local globalLimit = tonumber(ARGV[3])
local senderLimit = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])

local globalCurrent = tonumber(redis.call("GET", KEYS[1]) or "0")
local senderCurrent = tonumber(redis.call("GET", KEYS[2]) or "0")

local globalBlocked = globalCurrent >= globalLimit
local senderBlocked = senderCurrent >= senderLimit

if globalBlocked or senderBlocked then
  local hourWait = tonumber(ARGV[6])
  return {0, hourWait}
end

local nextAllowed = tonumber(redis.call("GET", KEYS[3]) or "0")

if now < nextAllowed then
  return {0, nextAllowed - now}
end

if globalCurrent == 0 then
  redis.call("SET", KEYS[1], 1, "EX", ttl)
else
  redis.call("INCR", KEYS[1])
end

if senderCurrent == 0 then
  redis.call("SET", KEYS[2], 1, "EX", ttl)
else
  redis.call("INCR", KEYS[2])
end

if interval > 0 then
  redis.call(
    "SET",
    KEYS[3],
    now + interval,
    "PX",
    math.max(interval * 10, 60000)
  )
end

return {1, 0}
`;

export async function reserveEmailSend(
  senderEmail: string
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const settings = await getRateLimitSettings();
  const now = Date.now();

  const hourBucket = Math.floor(now / HOUR_MS);
  const retryAfterMs = HOUR_MS - (now % HOUR_MS);
  const ttlSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

  const normalizedSender = senderEmail.trim().toLowerCase();

  const result = (await connection.eval(
    reserveSendScript,
    3,
    `email-rate-limit:global:${hourBucket}`,
    `email-rate-limit:sender:${normalizedSender}:${hourBucket}`,
    "email-send-spacing",
    now,
    settings.minimumDelaySeconds * 1000,
    settings.globalHourlyLimit,
    settings.senderHourlyLimit,
    ttlSeconds,
    retryAfterMs
  )) as [number | string, number | string];

  return {
    allowed: Number(result[0]) === 1,
    retryAfterMs: Number(result[1]),
  };
}
