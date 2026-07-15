import { indexStudyMaterialChunks } from "../services/embeddingService.js";
import { askContextualTutor, gatherTutorContext } from "../services/tutorService.js";
import { streamTutorResponse } from "../services/streamingTutorService.js";
import { recordLearningEvent } from "../services/learningEventService.js";
import StudyMaterial from "../models/StudyMaterial.js";
import LearningEvent from "../models/LearningEvent.js";
import { NotFoundError } from "../utils/errors.js";
import logger from "../utils/logger.js";

export const askTutor = async (req, res, next) => {
  try {
    const { question, materialId = null } = req.body;

    logger.info("AI tutor question received", {
      requestId: req.requestId,
      userId: req.user?._id,
      questionLength: question ? question.length : 0, // Privacy / GDPR compliant logging
      materialId,
    });

    const response = await askContextualTutor({
      userId: req.user._id,
      question,
      materialId,
    });

    res.json(response);
  } catch (err) {
    next(err);
  }
};

export const reindexMaterialForTutor = async (req, res, next) => {
  try {
    const material = await StudyMaterial.findOne({
      _id: req.params.materialId,
      user: req.user._id,
    });

    if (!material) {
      return next(new NotFoundError("Study material not found"));
    }

    const chunks = await indexStudyMaterialChunks(material);
    
    logger.info("Reindexed material chunks for tutoring", {
      requestId: req.requestId,
      materialId: material._id,
      chunkCount: chunks.length,
    });

    res.json({ materialId: material._id, chunkCount: chunks.length });
  } catch (err) {
    next(err);
  }
};

export const getTutorHistory = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const [events, total] = await Promise.all([
      LearningEvent.find({
        user: req.user._id,
        eventType: "ai_tutoring_interaction",
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LearningEvent.countDocuments({
        user: req.user._id,
        eventType: "ai_tutoring_interaction",
      }),
    ]);

    res.json({
      history: events.map((e) => ({
        id: e._id,
        topic: e.topic,
        question: e.metadata?.question || "Grounded Chat Query",
        result: e.result,
        createdAt: e.createdAt,
      })),
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

export const askTutorStream = async (req, res, next) => {
  try {
    const { question, materialId = null } = req.body;

    logger.info("AI tutor stream request received", {
      requestId: req.requestId,
      userId: req.user?._id,
      questionLength: question ? question.length : 0,
      materialId,
    });

    const context = await gatherTutorContext({
      userId: req.user._id,
      question,
      materialId,
    });

    const {
      trimmedQuestion,
      materialContexts,
      weakTopics,
      retrievedTopics,
      mistakeHistory,
      flashcards,
    } = context;

    const stream = await streamTutorResponse({
      question: trimmedQuestion,
      materialContexts,
      weakTopics,
      mistakeHistory,
      flashcards,
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let fullAnswer = "";

    try {
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || "";
        if (text) {
          fullAnswer += text;
          res.write(`data: ${text}\n\n`);
        }
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (streamErr) {
      logger.error("Error during tutoring stream transmission", {
        requestId: req.requestId,
        error: streamErr.message,
      });
      if (!res.writableEnded) {
        res.write(`data: [ERROR] ${streamErr.message}\n\n`);
        res.end();
      }
      return;
    }

    try {
      await recordLearningEvent({
        userId: req.user._id,
        topic: weakTopics[0]?.topic || retrievedTopics[0] || "General",
        eventType: "ai_tutoring_interaction",
        result: materialContexts.length ? "completed" : "partial",
        confidence: weakTopics[0]?.confidence || 0,
        difficulty: weakTopics[0]?.recommendedDifficulty || "",
        metadata: {
          question: trimmedQuestion,
          materialId,
          retrievedChunkIds: materialContexts.map((c) => c._id),
          sourceCount: materialContexts.length,
          streamed: true,
        },
      });
    } catch (logErr) {
      logger.warn("Failed to record learning event for streamed tutor", {
        userId: req.user._id,
        error: logErr.message,
      });
    }
  } catch (err) {
    if (!res.headersSent) {
      next(err);
    } else {
      logger.error("Error after headers sent in askTutorStream", {
        requestId: req.requestId,
        error: err.message,
      });
      if (!res.writableEnded) {
        res.write(`data: [ERROR] ${err.message}\n\n`);
        res.end();
      }
    }
  }
};
