import {
  completeReviewQueueItem,
  listReviewQueue,
  rebuildReviewQueueForUser,
  snoozeReviewQueueItem,
} from "../services/reviewQueueService.js";

export const getReviewQueue = async (req, res, next) => {
  try {
    const result = await listReviewQueue(req.user._id, {
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const rebuildReviewQueue = async (req, res, next) => {
  try {
    const result = await rebuildReviewQueueForUser(req.user._id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const completeReviewQueue = async (req, res, next) => {
  try {
    const item = await completeReviewQueueItem({
      userId: req.user._id,
      itemId: req.params.id,
    });
    res.json({ item });
  } catch (err) {
    next(err);
  }
};

export const snoozeReviewQueue = async (req, res, next) => {
  try {
    const item = await snoozeReviewQueueItem({
      userId: req.user._id,
      itemId: req.params.id,
      hours: req.body.hours,
    });
    res.json({ item });
  } catch (err) {
    next(err);
  }
};
