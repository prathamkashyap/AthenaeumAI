import Notification from "../models/Notification.js";
import { isDBConnected } from "../config/database.js";
import { DatabaseError, NotFoundError } from "../utils/errors.js";

/**
 * GET /api/v1/notifications
 * Fetch user's notifications.
 */
export const getNotifications = async (req, res, next) => {
  if (!isDBConnected()) return next(new DatabaseError("Database not available"));

  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments({ user: req.user._id, isRead: false }),
    ]);

    res.json({
      notifications,
      unreadCount,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/notifications/:id/read
 * Mark a specific notification as read.
 */
export const markAsRead = async (req, res, next) => {
  if (!isDBConnected()) return next(new DatabaseError("Database not available"));

  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return next(new NotFoundError("Notification not found"));
    }

    res.json(notification);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/notifications/read-all
 * Mark all notifications as read.
 */
export const markAllAsRead = async (req, res, next) => {
  if (!isDBConnected()) return next(new DatabaseError("Database not available"));

  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true }
    );

    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    next(err);
  }
};
