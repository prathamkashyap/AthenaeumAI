import LearningEvent from "../models/LearningEvent.js";
import { getDashboardAnalytics } from "../services/analyticsService.js";

export const dashboardAnalytics = async (req, res, next) => {
  try {
    const data = await getDashboardAnalytics(req.user._id);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

export const listLearningEvents = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [events, total] = await Promise.all([
      LearningEvent.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LearningEvent.countDocuments({ user: req.user._id }),
    ]);

    res.json({
      events,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};
