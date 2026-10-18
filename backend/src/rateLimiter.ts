
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

export type SendReservation = {
  allowed: boolean;
  retryAfterMs: number;
  reason:
    | "allowed"
    | "global_hourly_limit"
    | "sender_hourly_limit"
    | "minimum_delay";
};

export async function getRateLimitSettings(): Promise<RateLimitSettings> {
  const values = await connection.mget(
    "reachinbox:settings:globalHourlyLimit",
    "reachinbox:settings:senderHourlyLimit",
    "reachinbox:settings:minimumDelaySeconds"
  );

  const minimumDelayValue = values[2];

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
      minimumDelayValue !== null &&
        minimumDelayValue !== undefined &&
        Number.isFinite(Number(minimumDelayValue))
        ? Number(minimumDelayValue)
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
local hourWait = tonumber(ARGV[6])

local globalCurrent = tonumber(redis.call("GET", KEYS[1]) or "0")
local senderCurrent = tonumber(redis.call("GET", KEYS[2]) or "0")

if globalCurrent >= globalLimit then
  return {0, hourWait, "global_hourly_limit"}
end

if senderCurrent >= senderLimit then
  return {0, hourWait, "sender_hourly_limit"}
end

local nextAllowed = tonumber(redis.call("GET", KEYS[3]) or "0")

if now < nextAllowed then
  return {0, nextAllowed - now, "minimum_delay"}
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

return {1, 0, "allowed"}
`;

export async function reserveEmailSend(
  senderEmail: string
): Promise<SendReservation> {
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
  )) as [number | string, number | string, string];

  return {
    allowed: Number(result[0]) === 1,
    retryAfterMs: Number(result[1]),
    reason: result[2] as SendReservation["reason"],
  };
}
