/**
 * Reconciles the database's indexes with the ones the models declare.
 *
 * Why this exists
 * ---------------
 * Mongoose builds a declared index on connect, but its automatic path only ever
 * calls `createIndex`. It never drops an index whose key spec has changed. So
 * editing an index definition is not a migration: the old index keeps its name
 * only if the name is derived from the key spec, and a changed key spec produces
 * a NEW name -- leaving the superseded index alive next to the new one.
 *
 * For the open-item unique index on ReviewQueue this is not cosmetic. Widening
 * that key with `questionIndex` makes the old, coarser unique index still reject
 * a second failed question on the same topic with E11000, which is precisely the
 * write the change exists to allow. The application would look fixed and the
 * database would still refuse.
 *
 * So index changes in this repository require running this once per deployment.
 * It is intentionally a separate, explicit command rather than something done at
 * startup: dropping an index is a destructive, schema-visible operation and
 * should never happen as a side effect of booting a process.
 *
 * Usage:
 *   npm run indexes:sync              # reconcile every model
 *   npm run indexes:sync -- --dry-run # report what would change, change nothing
 *
 * It is safe to re-run: `syncIndexes` converges the collection to the declared set
 * and is a no-op once they agree.
 */

import "../config/env.js";
import mongoose from "mongoose";
import connectDB from "../config/database.js";
import logger from "../utils/logger.js";

// Imported for their side effect of registering the schema with Mongoose, which is
// what gives `mongoose.modelNames()` something to reconcile.
import "../models/User.js";
import "../models/StudyMaterial.js";
import "../models/MaterialChunk.js";
import "../models/Quiz.js";
import "../models/QuizAttempt.js";
import "../models/FlashcardSet.js";
import "../models/UserProgress.js";
import "../models/LearningEvent.js";
import "../models/ReviewQueue.js";
import "../models/BackgroundJob.js";
import "../models/Notification.js";
import "../models/RefreshToken.js";

const dryRun = process.argv.includes("--dry-run");

/**
 * Reports what the reconciliation would do, so an operator can see the superseded
 * index before it is dropped.
 */
const describeDiff = async (model) => {
  const { toDrop, toCreate, retained } = await model.diffIndexes();
  return { name: model.modelName, toDrop, toCreate, retained };
};

const runIndexSync = async () => {
  // `connectDB` reports through the shared connection rather than returning it.
  await connectDB();
  if (mongoose.connection.readyState !== 1) throw new Error("Could not connect to MongoDB");

  const modelNames = mongoose.modelNames().sort();
  const diffs = [];

  for (const name of modelNames) {
    diffs.push(await describeDiff(mongoose.model(name)));
  }

  const withChanges = diffs.filter((d) => d.toDrop.length || d.toCreate.length);

  if (!withChanges.length) {
    logger.info("Indexes already match the declared schemas; nothing to reconcile.");
  } else {
    for (const diff of withChanges) {
      if (diff.toDrop.length) {
        logger.warn(`Superseded index(es) to drop on ${diff.name}:`, {
          indexes: diff.toDrop,
          reason: "no longer declared in the schema",
        });
      }
      if (diff.toCreate.length) {
        logger.info(`Index(es) to create on ${diff.name}:`, { indexes: diff.toCreate });
      }
    }

    if (dryRun) {
      logger.info(`--dry-run: stopping before changing anything (${withChanges.length} model(s) differ).`);
      return;
    }

    for (const name of withChanges.map((d) => d.name)) {
      // syncIndexes drops what is no longer declared and creates what is, so the
      // database ends up enforcing exactly the declared set.
      const dropped = await mongoose.model(name).syncIndexes();
      logger.info(`Reconciled indexes on ${name}.`, {
        dropped: dropped.filter(Boolean),
      });
    }
  }

  // The assertion that matters after any index change: a unique index that is no
  // longer declared is still being enforced, silently.
  const reviewQueue = mongoose.model("ReviewQueue");
  const unique = (await reviewQueue.collection.indexes()).filter((i) => i.unique);
  if (unique.length !== 1) {
    logger.error("Expected exactly one unique index on ReviewQueue.", { unique });
    process.exitCode = 1;
    return;
  }
  logger.info("ReviewQueue enforces exactly one unique index.", { index: unique[0].name });

  if (dryRun) {
    await mongoose.connection.close();
    return;
  }
  await mongoose.connection.close();
};

runIndexSync()
  .catch((err) => {
    logger.error("Index reconciliation failed", { error: err.message });
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
    // Explicit: the driver's idle sockets would otherwise keep the process alive
    // after a command that has already finished its work.
    process.exit(process.exitCode || 0);
  });
