import "../config/env.js";
import mongoose from "mongoose";
import connectDB from "../config/database.js";
import User from "../models/User.js";
import StudyMaterial from "../models/StudyMaterial.js";
import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import FlashcardSet from "../models/FlashcardSet.js";
import ReviewQueue from "../models/ReviewQueue.js";
import UserProgress from "../models/UserProgress.js";
import logger from "../utils/logger.js";

const verifySeeding = async () => {
  logger.info("🔍 Running Demo Seed Verification...");

  const conn = await connectDB();
  if (!conn) {
    logger.error("❌ Database connection failed. Verification aborted.");
    process.exit(1);
  }

  try {
    const counts = {
      users: await User.countDocuments({}),
      materials: await StudyMaterial.countDocuments({}),
      quizzes: await Quiz.countDocuments({}),
      attempts: await QuizAttempt.countDocuments({}),
      flashcards: await FlashcardSet.countDocuments({}),
      reviews: await ReviewQueue.countDocuments({}),
      progress: await UserProgress.countDocuments({}),
    };

    logger.info("📊 Current database counts:", counts);

    const targets = {
      users: 1,
      materials: 3,
      quizzes: 4,
      attempts: 12,
      flashcards: 3,
      reviews: 15,
      progress: 1,
    };

    let passed = true;
    for (const [key, targetVal] of Object.entries(targets)) {
      const currentVal = counts[key];
      if (currentVal !== targetVal) {
        logger.error(`❌ Count mismatch for ${key}: Expected ${targetVal}, Got ${currentVal}`);
        passed = false;
      } else {
        logger.info(`✅ ${key} count matches target: ${currentVal}`);
      }
    }

    if (passed) {
      logger.info("🎉 Verification PASS! Demo seeding verified successfully.");
      process.exit(0);
    } else {
      logger.error("❌ Verification FAIL! Some collection counts did not match expectations.");
      process.exit(1);
    }
  } catch (err) {
    logger.error("❌ Exception during seed verification:", err);
    process.exit(1);
  }
};

verifySeeding();
