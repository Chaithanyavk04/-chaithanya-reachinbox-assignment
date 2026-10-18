
import { Router } from "express";
import {
  getRateLimitSettings,
  saveRateLimitSettings,
} from "./rateLimiter.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    res.json(await getRateLimitSettings());
  } catch (error) {
    console.error("Unable to read settings:", error);
    res.status(500).json({ error: "Unable to read settings" });
  }
});

router.put("/", async (req, res) => {
  const { globalHourlyLimit, senderHourlyLimit, minimumDelaySeconds } =
    req.body ?? {};

  const validInteger = (value: unknown, min: number, max: number) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max;

  if (
    !validInteger(globalHourlyLimit, 1, 100000) ||
    !validInteger(senderHourlyLimit, 1, 100000) ||
    !validInteger(minimumDelaySeconds, 0, 3600)
  ) {
    res.status(400).json({
      error:
        "globalHourlyLimit and senderHourlyLimit must be integers from 1 to 100000; minimumDelaySeconds must be an integer from 0 to 3600.",
    });
    return;
  }

  try {
    const settings = {
      globalHourlyLimit,
      senderHourlyLimit,
      minimumDelaySeconds,
    };

    await saveRateLimitSettings(settings);
    res.json({ message: "Settings saved", settings });
  } catch (error) {
    console.error("Unable to save settings:", error);
    res.status(500).json({ error: "Unable to save settings" });
  }
});

export default router;
