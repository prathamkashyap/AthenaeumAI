import FlashcardSet from "../models/FlashcardSet.js";
import {
  applySpacedRepetitionReview,
  createFlashcardSet,
  getDueFlashcards,
} from "../services/flashcardService.js";
import { recordLearningEvent } from "../services/learningEventService.js";
import ReviewQueue from "../models/ReviewQueue.js";
import { NotFoundError } from "../utils/errors.js";

export const listFlashcardSets = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const [sets, total] = await Promise.all([
      FlashcardSet.find({ user: req.user._id })
        .populate("studyMaterial", "title originalFileName")
        .populate("quiz", "title difficulty")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      FlashcardSet.countDocuments({ user: req.user._id }),
    ]);

    res.json({
      sets,
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

export const listDueFlashcards = async (req, res, next) => {
  try {
    const cards = await getDueFlashcards({
      userId: req.user._id,
      limit: req.query.limit,
    });

    res.json({ cards, dueCount: cards.length });
  } catch (err) {
    next(err);
  }
};

export const generateFlashcardSet = async (req, res, next) => {
  try {
    const { sourceType = "weak-topics", sourceId = null, count = 12 } = req.body;

    const set = await createFlashcardSet({
      userId: req.user._id,
      sourceType,
      sourceId,
      count,
    });

    res.status(201).json({ set });
  } catch (err) {
    next(err);
  }
};

export const reviewFlashcard = async (req, res, next) => {
  try {
    const { rating } = req.body;
    const card = await applySpacedRepetitionReview({
      userId: req.user._id,
      setId: req.params.setId,
      cardId: req.params.cardId,
      rating,
    });

    await Promise.all([
      recordLearningEvent({
        userId: req.user._id,
        topic: card.topic,
        eventType: "flashcard_review",
        result: "reviewed",
        confidence: rating === "easy" ? 85 : rating === "hard" || rating === "again" ? 35 : 65,
        metadata: {
          setId: req.params.setId,
          cardId: req.params.cardId,
          rating,
          nextReviewAt: card.review?.nextReviewAt,
          interval: card.review?.interval,
        },
      }),
      ReviewQueue.updateMany(
        {
          user: req.user._id,
          status: "open",
          "source.flashcardSet": req.params.setId,
          "source.flashcardId": req.params.cardId,
        },
        { status: "completed", completedAt: new Date() }
      ),
    ]);

    res.json({ card });
  } catch (err) {
    next(err);
  }
};

export const deleteFlashcardSet = async (req, res, next) => {
  try {
    const setId = req.params.id;
    const set = await FlashcardSet.findOneAndUpdate(
      { _id: setId, user: req.user._id, deletedAt: null },
      { deletedAt: new Date() },
      { new: true }
    );

    if (!set) {
      return next(new NotFoundError("Flashcard set not found"));
    }

    res.json({ message: "Flashcard set soft-deleted successfully" });
  } catch (err) {
    next(err);
  }
};
