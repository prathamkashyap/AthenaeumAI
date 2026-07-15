const buckets = new Map();

const pruneOldBuckets = (now) => {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

export const userAiQuota = ({
  windowMs = 60 * 1000,
  max = 5,
  label = "AI generation",
} = {}) => {
  return (req, res, next) => {
    const now = Date.now();
    pruneOldBuckets(now);

    const userId = String(req.user?._id || req.ip || "anonymous");
    const key = `${label}:${userId}`;
    const bucket = buckets.get(key) || {
      count: 0,
      resetAt: now + windowMs,
    };

    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    res.setHeader("X-AI-Quota-Limit", String(max));
    res.setHeader("X-AI-Quota-Remaining", String(Math.max(0, max - bucket.count)));
    res.setHeader("X-AI-Quota-Reset", new Date(bucket.resetAt).toISOString());

    if (bucket.count > max) {
      return res.status(429).json({
        error: `${label} quota exceeded. Please wait before starting another AI task.`,
        resetAt: new Date(bucket.resetAt).toISOString(),
      });
    }

    next();
  };
};
