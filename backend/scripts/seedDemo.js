import "../config/env.js";
import mongoose from "mongoose";
import connectDB from "../config/database.js";
import { hashPassword } from "../utils/auth.js";
import User from "../models/User.js";
import StudyMaterial from "../models/StudyMaterial.js";
import MaterialChunk from "../models/MaterialChunk.js";
import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import FlashcardSet from "../models/FlashcardSet.js";
import UserProgress from "../models/UserProgress.js";
import LearningEvent from "../models/LearningEvent.js";
import ReviewQueue from "../models/ReviewQueue.js";
import logger from "../utils/logger.js";

const runSeeder = async () => {
  logger.info("🌱 Starting Enhanced AthenaeumAI Demo Seeding...");

  // 1. Connect to Database
  const conn = await connectDB();
  if (!conn) {
    logger.error("❌ Database connection failed. Seeding aborted.");
    process.exit(1);
  }

  try {
    // 2. Clear existing collections
    logger.info("🗑️ Cleaning database collections...");
    await Promise.all([
      User.deleteMany({}),
      StudyMaterial.deleteMany({}),
      MaterialChunk.deleteMany({}),
      Quiz.deleteMany({}),
      QuizAttempt.deleteMany({}),
      FlashcardSet.deleteMany({}),
      UserProgress.deleteMany({}),
      LearningEvent.deleteMany({}),
      ReviewQueue.deleteMany({}),
    ]);
    logger.info("✅ Database cleared.");

    // 3. Seed User (joined 30 days ago)
    logger.info("👤 Seeding demo user...");
    const passwordHash = await hashPassword("demopassword123");
    const joinDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const user = await User.create({
      name: "Demo Learner",
      email: "demo@athenaeum.ai",
      passwordHash,
      profile: {
        program: "Computer Science",
        semester: "6",
        interests: ["Operating Systems", "Databases", "Computer Networks"],
      },
      streak: {
        current: 5,
        longest: 12,
        lastStudyDate: new Date().toISOString().split("T")[0],
      },
    });

    // Override User createdAt to 30 days ago
    await User.collection.updateOne(
      { _id: user._id },
      { $set: { createdAt: joinDate, updatedAt: joinDate } }
    );
    logger.info(`✅ Demo User created: ${user.email} (Joined: ${joinDate.toISOString()})`);

    // 4. Seed Study Materials
    logger.info("📁 Seeding study materials...");
    const matOS = await StudyMaterial.create({
      user: user._id,
      title: "Operating Systems Memory Management",
      originalFileName: "os-memory-management.pdf",
      storagePath: "uploads/os-memory-management.pdf",
      sizeBytes: 345000,
      tags: ["Operating Systems", "Memory Management"],
      extractedText: "A page table is the data structure used by a virtual memory system in a computer operating system...",
      textPreview: "Memory management is the functionality of an operating system which handles main memory...",
    });

    const matDBMS = await StudyMaterial.create({
      user: user._id,
      title: "Database Relational Normalization",
      originalFileName: "dbms-normalization.pdf",
      storagePath: "uploads/dbms-normalization.pdf",
      sizeBytes: 210000,
      tags: ["DBMS", "Normalization"],
      extractedText: "Database normalization is the process of structuring a database in accordance with normal forms...",
      textPreview: "Normalization rules prevent redundancy and preserve data integrity...",
    });

    const matCN = await StudyMaterial.create({
      user: user._id,
      title: "Computer Networks Transport Protocols",
      originalFileName: "cn-transport-layer.pdf",
      storagePath: "uploads/cn-transport-layer.pdf",
      sizeBytes: 412000,
      tags: ["Computer Networks", "Transport Layer"],
      extractedText: "The Transmission Control Protocol (TCP) and the User Datagram Protocol (UDP) are core protocols...",
      textPreview: "Comparing TCP reliability with UDP connectionless speed...",
    });

    // 5. Seed Material Chunks (with random mock embeddings)
    logger.info("📄 Seeding study material chunks...");
    await MaterialChunk.create({
      user: user._id,
      studyMaterial: matOS._id,
      chunkIndex: 0,
      chunkText: "Virtual memory maps virtual addresses used by an application into physical addresses. Paging is a memory management scheme that stores data in pages.",
      textPreview: "Virtual memory maps virtual addresses...",
      embedding: Array(128).fill(0).map(() => Math.random()),
      embeddingModel: "local-hash-v1",
      tokenEstimate: 50,
      sourceTitle: matOS.title,
      topics: ["Virtual Memory", "Operating Systems"],
    });

    await MaterialChunk.create({
      user: user._id,
      studyMaterial: matDBMS._id,
      chunkIndex: 0,
      chunkText: "First Normal Form (1NF) requires values to be atomic. Second Normal Form (2NF) removes partial dependencies. Third Normal Form (3NF) removes transitive dependencies.",
      textPreview: "Normal forms rule set summary...",
      embedding: Array(128).fill(0).map(() => Math.random()),
      embeddingModel: "local-hash-v1",
      tokenEstimate: 60,
      sourceTitle: matDBMS.title,
      topics: ["Normalization", "DBMS"],
    });

    await MaterialChunk.create({
      user: user._id,
      studyMaterial: matCN._id,
      chunkIndex: 0,
      chunkText: "TCP provides connection-oriented, reliable byte-stream transmission with congestion control. UDP provides faster, connectionless, unreliable datagram transmission.",
      textPreview: "TCP reliability vs UDP transmission...",
      embedding: Array(128).fill(0).map(() => Math.random()),
      embeddingModel: "local-hash-v1",
      tokenEstimate: 55,
      sourceTitle: matCN.title,
      topics: ["Transport Layer", "Computer Networks"],
    });

    // 6. Seed Quizzes
    logger.info("🧠 Seeding quizzes...");
    const quizOS1 = await Quiz.create({
      user: user._id,
      studyMaterial: matOS._id,
      title: "Memory Management Concepts",
      difficulty: "Medium",
      sourceFileName: matOS.originalFileName,
      questionCount: 4,
      subject: "Operating Systems",
      isDefault: false,
      questions: [
        {
          question: "What is virtual memory?",
          options: [
            "A memory management scheme mapping virtual to physical addresses",
            "A physical RAM hardware extension card",
            "A disk formatting algorithm used for speed",
            "A CPU scheduler method for background processes",
          ],
          answer: 0,
          explanation: "Virtual memory maps the virtual addresses used by an application to physical addresses in RAM.",
          topic: "Virtual Memory",
          cognitiveLevel: "Understand",
        },
        {
          question: "What is internal fragmentation?",
          options: [
            "Unused allocated memory space inside a page/block",
            "Free memory blocks scattered between allocated ones",
            "A physical disk write error leading to sector loss",
            "A CPU register timing inconsistency",
          ],
          answer: 0,
          explanation: "Internal fragmentation occurs when memory partitions allocated to processes are larger than the requested memory.",
          topic: "Fragmentation",
          cognitiveLevel: "Remember",
        },
        {
          question: "Which hardware component translates virtual addresses to physical ones?",
          options: [
            "Memory Management Unit (MMU)",
            "Arithmetic Logic Unit (ALU)",
            "Direct Memory Access (DMA) Controller",
            "Graphics Processing Unit (GPU)",
          ],
          answer: 0,
          explanation: "The Memory Management Unit (MMU) handles virtual-to-physical translations on the CPU.",
          topic: "Memory Management",
          cognitiveLevel: "Apply",
        },
        {
          question: "What is the primary purpose of a page table?",
          options: [
            "Store mappings between virtual pages and physical page frames",
            "List active software processes waiting for CPU time",
            "Track directory structures on external flash drives",
            "Configure port routing inside network interfaces",
          ],
          answer: 0,
          explanation: "The page table maps virtual pages of a process to physical page frames in memory.",
          topic: "Page Tables",
          cognitiveLevel: "Understand",
        },
      ],
    });

    const quizOS2 = await Quiz.create({
      user: user._id,
      studyMaterial: matOS._id,
      title: "Advanced OS Paging & Segmentation",
      difficulty: "Hard",
      sourceFileName: matOS.originalFileName,
      questionCount: 3,
      subject: "Operating Systems",
      isDefault: false,
      questions: [
        {
          question: "Which page replacement algorithm suffers from Belady's Anomaly?",
          options: ["First-In, First-Out (FIFO)", "Least Recently Used (LRU)", "Optimal Page Replacement", "Clock Page Replacement"],
          answer: 0,
          explanation: "Belady's anomaly shows that for FIFO, page faults can increase with more frames.",
          topic: "Page Replacement",
          cognitiveLevel: "Analyze",
        },
        {
          question: "What is the primary difference between segmentation and paging?",
          options: [
            "Segmentation is user-visible partition division; Paging is fixed-size system splitting",
            "Segmentation is fixed-size; Paging is variable-size",
            "Paging requires no hardware assistance; Segmentation does",
            "Segmentation has no internal fragmentation; Paging has no external fragmentation",
          ],
          answer: 0,
          explanation: "Paging divides memory into fixed blocks, whereas segmentation uses variable-length blocks mapping to program structures.",
          topic: "Segmentation",
          cognitiveLevel: "Evaluate",
        },
        {
          question: "What is a Translation Lookaside Buffer (TLB)?",
          options: [
            "A fast hardware cache of page table entries",
            "A disk sector cache for paging files",
            "A registry containing running thread references",
            "A CPU core interrupt flag register",
          ],
          answer: 0,
          explanation: "The TLB caches recent virtual-to-physical translations to speed up memory access.",
          topic: "TLB",
          cognitiveLevel: "Remember",
        },
      ],
    });

    const quizDBMS = await Quiz.create({
      user: user._id,
      studyMaterial: matDBMS._id,
      title: "DBMS Indexing & Normalization",
      difficulty: "Medium",
      sourceFileName: matDBMS.originalFileName,
      questionCount: 2,
      subject: "DBMS",
      isDefault: true,
      questions: [
        {
          question: "Which normal form requires removing partial functional dependencies?",
          options: ["First Normal Form (1NF)", "Second Normal Form (2NF)", "Third Normal Form (3NF)", "Boyce-Codd Normal Form (BCNF)"],
          answer: 1,
          explanation: "2NF is reached when a database is in 1NF and all non-key attributes are fully dependent on the primary key.",
          topic: "Normalization",
          cognitiveLevel: "Understand",
        },
        {
          question: "What does Third Normal Form (3NF) eliminate?",
          options: ["Transitive functional dependencies", "Partial functional dependencies", "Multivalued dependencies", "Trivial dependencies"],
          answer: 0,
          explanation: "3NF is reached when a database is in 2NF and there are no transitive dependencies.",
          topic: "Normalization",
          cognitiveLevel: "Remember",
        },
      ],
    });

    const quizCN = await Quiz.create({
      user: user._id,
      studyMaterial: matCN._id,
      title: "TCP/IP vs UDP Layering",
      difficulty: "Easy",
      sourceFileName: matCN.originalFileName,
      questionCount: 3,
      subject: "Computer Networks",
      isDefault: false,
      questions: [
        {
          question: "Which transport protocol is connection-oriented?",
          options: ["TCP", "UDP", "IP", "DNS"],
          answer: 0,
          explanation: "TCP establishes a connection via a 3-way handshake prior to sending data.",
          topic: "Transport Layer",
          cognitiveLevel: "Remember",
        },
        {
          question: "What header size does a standard TCP segment possess compared to UDP?",
          options: ["TCP is 20 bytes; UDP is 8 bytes", "TCP is 8 bytes; UDP is 20 bytes", "Both are 20 bytes", "TCP is 40 bytes; UDP is 16 bytes"],
          answer: 0,
          explanation: "TCP headers carry more control flags and are 20 bytes, while UDP headers are lightweight at 8 bytes.",
          topic: "Headers",
          cognitiveLevel: "Understand",
        },
        {
          question: "Which mechanism is used by TCP to control sender data flow rate?",
          options: ["Sliding Window", "Vector Routing", "CRC Checksum", "DNS Lookup"],
          answer: 0,
          explanation: "TCP uses a sliding window for flow control, adjusting data volume based on receiver buffer feedback.",
          topic: "Flow Control",
          cognitiveLevel: "Apply",
        },
      ],
    });

    matOS.linkedQuizzes = [quizOS1._id, quizOS2._id];
    await matOS.save();

    matDBMS.linkedQuizzes = [quizDBMS._id];
    await matDBMS.save();

    matCN.linkedQuizzes = [quizCN._id];
    await matCN.save();

    // 7. Seed 12 Historical Quiz Attempts (Spanning the last 30 days)
    logger.info("📊 Seeding historical quiz attempts...");
    const attemptsData = [
      { quiz: quizOS1, daysAgo: 28, score: 1, total: 4, answers: [0, 1, 1, 2] },
      { quiz: quizOS1, daysAgo: 25, score: 2, total: 4, answers: [0, 0, 1, 2] },
      { quiz: quizOS1, daysAgo: 22, score: 3, total: 4, answers: [0, 0, 0, 2] },
      { quiz: quizOS1, daysAgo: 18, score: 4, total: 4, answers: [0, 0, 0, 0] },
      { quiz: quizDBMS, daysAgo: 20, score: 1, total: 2, answers: [1, 2] },
      { quiz: quizDBMS, daysAgo: 15, score: 2, total: 2, answers: [1, 0] },
      { quiz: quizCN, daysAgo: 14, score: 1, total: 3, answers: [0, 1, 1] },
      { quiz: quizCN, daysAgo: 10, score: 2, total: 3, answers: [0, 0, 1] },
      { quiz: quizCN, daysAgo: 7, score: 3, total: 3, answers: [0, 0, 0] },
      { quiz: quizOS2, daysAgo: 6, score: 1, total: 3, answers: [0, 2, 2] },
      { quiz: quizOS2, daysAgo: 3, score: 2, total: 3, answers: [0, 0, 2] },
      { quiz: quizOS2, daysAgo: 1, score: 3, total: 3, answers: [0, 0, 0] },
    ];

    const attempts = [];
    for (const data of attemptsData) {
      const answersMap = data.answers.map((selected, idx) => {
        const q = data.quiz.questions[idx];
        return {
          questionIndex: idx,
          selected,
          correct: q.answer,
          isCorrect: selected === q.answer,
          topic: q.topic,
        };
      });

      const mistakeAnalyses = [];
      answersMap.forEach((ans, idx) => {
        if (!ans.isCorrect) {
          const q = data.quiz.questions[idx];
          mistakeAnalyses.push({
            questionIndex: idx,
            topic: ans.topic,
            misconception: `Selected distractor ${ans.selected} instead of correct answer.`,
            clarification: q.explanation,
            distractorReason: `Distractor option ${ans.selected} doesn't explain the underlying concept correctly.`,
            revisionSuggestion: `Revise study notes on topic ${ans.topic}.`,
          });
        }
      });

      const attemptDate = new Date(Date.now() - data.daysAgo * 24 * 60 * 60 * 1000);
      const attempt = await QuizAttempt.create({
        user: user._id,
        quiz: data.quiz._id,
        studyMaterial: data.quiz.studyMaterial,
        score: data.score,
        total: data.total,
        accuracy: Math.round((data.score / data.total) * 100),
        difficulty: data.quiz.difficulty,
        durationSeconds: 60 + Math.floor(Math.random() * 120),
        answers: answersMap,
        mistakeAnalyses,
      });

      // Override Mongoose timestamps
      await QuizAttempt.collection.updateOne(
        { _id: attempt._id },
        { $set: { createdAt: attemptDate, updatedAt: attemptDate } }
      );

      attempts.push(attempt);
    }

    // Update Quiz schemas to embed attempt sub-objects
    for (const q of [quizOS1, quizOS2, quizDBMS, quizCN]) {
      const qAttempts = attempts.filter((a) => String(a.quiz) === String(q._id));
      q.attempts = qAttempts.map((a) => ({
        score: a.score,
        total: a.total,
        answers: a.answers.map((ans) => ans.selected),
        completedAt: a.createdAt,
      }));
      await q.save();
    }

    // 8. Seed Flashcard Sets (3 sets)
    logger.info("🃏 Seeding flashcard sets...");
    const flashOS = await FlashcardSet.create({
      user: user._id,
      studyMaterial: matOS._id,
      title: "Memory Management & Paging",
      sourceType: "material",
      tags: ["Operating Systems", "Memory Management"],
      cards: [
        {
          front: "What is the Memory Management Unit (MMU)?",
          back: "A hardware device that translates virtual memory addresses to physical memory addresses.",
          topic: "Memory Management",
          review: {
            dueAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // overdue by 2 days
            nextReviewAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
            easeFactor: 2.5,
            interval: 1,
            repetitions: 1,
            ease: 2.5,
            intervalDays: 1,
            reviewCount: 1,
          },
        },
        {
          front: "Explain Thrashing.",
          back: "A state in virtual memory where the CPU spends more time swapping pages in and out of disk than executing instructions.",
          topic: "Virtual Memory",
          review: {
            dueAt: new Date(), // due today
            nextReviewAt: new Date(),
            easeFactor: 2.8,
            interval: 14,
            repetitions: 4,
            ease: 2.8,
            intervalDays: 14,
            reviewCount: 4,
          },
        },
        {
          front: "What is a Page Fault?",
          back: "An interrupt raised by system hardware when a running program accesses a memory page that is not currently mapped into physical RAM.",
          topic: "Page Tables",
          review: {
            dueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // future
            nextReviewAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
            easeFactor: 2.6,
            interval: 4,
            repetitions: 2,
            ease: 2.6,
            intervalDays: 4,
            reviewCount: 2,
          },
        },
      ],
    });

    const flashDBMS = await FlashcardSet.create({
      user: user._id,
      studyMaterial: matDBMS._id,
      title: "DBMS Functional Dependencies",
      sourceType: "material",
      tags: ["DBMS", "Normalization"],
      cards: [
        {
          front: "What is a transitive dependency?",
          back: "A functional dependency where A -> B and B -> C, leading to the transitive dependency A -> C.",
          topic: "Normalization",
          review: {
            dueAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // overdue by 1 day
            nextReviewAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
            easeFactor: 2.5,
            interval: 2,
            repetitions: 2,
            ease: 2.5,
            intervalDays: 2,
            reviewCount: 2,
          },
        },
        {
          front: "What is a partial dependency?",
          back: "A functional dependency where a non-prime attribute depends on only a part of a composite primary key.",
          topic: "Normalization",
          review: {
            dueAt: new Date(), // due today
            nextReviewAt: new Date(),
            easeFactor: 2.4,
            interval: 3,
            repetitions: 1,
            ease: 2.4,
            intervalDays: 3,
            reviewCount: 1,
          },
        },
      ],
    });

    const flashCN = await FlashcardSet.create({
      user: user._id,
      studyMaterial: matCN._id,
      title: "CN Headers & Handshakes",
      sourceType: "material",
      tags: ["Computer Networks", "Transport Layer"],
      cards: [
        {
          front: "Describe the TCP three-way handshake.",
          back: "The process of establishing a TCP connection: client sends SYN, server responds with SYN-ACK, client sends ACK.",
          topic: "Transport Layer",
          review: {
            dueAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // future
            nextReviewAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
            easeFactor: 2.7,
            interval: 10,
            repetitions: 3,
            ease: 2.7,
            intervalDays: 10,
            reviewCount: 3,
          },
        },
      ],
    });

    matOS.linkedFlashcardSets = [flashOS._id];
    await matOS.save();
    matDBMS.linkedFlashcardSets = [flashDBMS._id];
    await matDBMS.save();
    matCN.linkedFlashcardSets = [flashCN._id];
    await matCN.save();

    // 9. Seed User Progress
    // We set topic masteries matching: OS = 35% mastery, CN = 42% mastery, DBMS = 78% mastery.
    // Plus 2 strong topics: Data Structures = 92% mastery, Algorithms = 88% mastery.
    logger.info("📈 Seeding user progress...");
    await UserProgress.create({
      user: user._id,
      totals: {
        quizzesTaken: 12,
        questionsAnswered: 37,
        correctAnswers: 27,
        averageAccuracy: 73,
      },
      topics: [
        {
          topic: "Operating Systems",
          subject: "Operating Systems",
          attempted: 15,
          correct: 5,
          mastery: 35,
          weaknessScore: 65,
          confidence: 30,
          reviewCount: 4,
          lastWrongAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          lastPracticedAt: new Date(),
          recommendedDifficulty: "Easy",
        },
        {
          topic: "Computer Networks",
          subject: "Computer Networks",
          attempted: 12,
          correct: 5,
          mastery: 42,
          weaknessScore: 58,
          confidence: 40,
          reviewCount: 3,
          lastWrongAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          lastPracticedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          recommendedDifficulty: "Easy",
        },
        {
          topic: "DBMS",
          subject: "DBMS",
          attempted: 10,
          correct: 8,
          mastery: 78,
          weaknessScore: 22,
          confidence: 80,
          reviewCount: 2,
          lastWrongAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
          lastPracticedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
          recommendedDifficulty: "Hard",
        },
        {
          topic: "Data Structures",
          subject: "Computer Science",
          attempted: 10,
          correct: 9,
          mastery: 92,
          weaknessScore: 8,
          confidence: 95,
          reviewCount: 0,
          lastWrongAt: null,
          lastPracticedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
          recommendedDifficulty: "Hard",
        },
        {
          topic: "Algorithms",
          subject: "Computer Science",
          attempted: 8,
          correct: 7,
          mastery: 88,
          weaknessScore: 12,
          confidence: 90,
          reviewCount: 0,
          lastWrongAt: null,
          lastPracticedAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
          recommendedDifficulty: "Hard",
        },
      ],
    });

    // 10. Seed Review Queue (15 items: 5 overdue, 5 due today, 5 future)
    logger.info("📥 Seeding review queue items...");
    const reviewItems = [];
    
    // Overdue failed questions (using real quizzes and attempts)
    const overdueTopics = ["Virtual Memory", "Fragmentation", "Memory Management", "Page Tables", "Normalization"];
    for (let i = 0; i < 5; i++) {
      reviewItems.push({
        user: user._id,
        itemType: "failed_question",
        subject: i < 4 ? "Operating Systems" : "DBMS",
        topic: overdueTopics[i],
        title: `Overdue Review: Failed Question on ${overdueTopics[i]}`,
        description: "Review incorrect response from previous attempt.",
        priority: 3,
        dueAt: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000), // overdue
        status: "open",
        source: {
          quiz: i < 4 ? quizOS1._id : quizDBMS._id,
          attempt: attempts[i]._id,
        }
      });
    }

    // Due today flashcards (using real flashcards we created)
    const osCards = flashOS.cards;
    const dbmsCards = flashDBMS.cards;
    const cnCards = flashCN.cards;
    const cardsToReview = [
      { set: flashOS, card: osCards[0] },
      { set: flashOS, card: osCards[1] },
      { set: flashDBMS, card: dbmsCards[0] },
      { set: flashDBMS, card: dbmsCards[1] },
      { set: flashCN, card: cnCards[0] },
    ];

    for (let i = 0; i < 5; i++) {
      const item = cardsToReview[i];
      reviewItems.push({
        user: user._id,
        itemType: "due_flashcard",
        subject: item.set.title.includes("Memory") ? "Operating Systems" : (item.set.title.includes("DBMS") ? "DBMS" : "Computer Networks"),
        topic: item.card.topic,
        title: `Due Today: Flashcard - ${item.card.front.substring(0, 30)}...`,
        priority: 2,
        dueAt: new Date(), // due now
        status: "open",
        source: {
          flashcardSet: item.set._id,
          flashcardId: item.card._id,
        }
      });
    }

    // Future reviews (weak topics)
    const futureTopics = ["Virtual Memory", "Fragmentation", "Normalization", "Transport Layer", "Flow Control"];
    for (let i = 0; i < 5; i++) {
      reviewItems.push({
        user: user._id,
        itemType: "weak_topic",
        subject: i < 2 ? "Operating Systems" : (i === 2 ? "DBMS" : "Computer Networks"),
        topic: futureTopics[i],
        title: `Future Review: Weak Topic - ${futureTopics[i]}`,
        priority: 1,
        dueAt: new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000), // in future
        status: "open",
      });
    }

    await ReviewQueue.create(reviewItems);

    // 11. Seed Tutor Conversations (5 chats)
    logger.info("📋 Seeding tutor logs and conversations...");
    const chats = [
      { q: "What is deadlock?", a: "A deadlock occurs when two or more processes are unable to make progress because each is waiting for the other to release a resource.", topic: "Operating Systems", daysAgo: 10 },
      { q: "Explain normalization", a: "Normalization is the systematic process of organizing data in a database to eliminate redundant data (anomalies) and ensure functional dependencies make sense.", topic: "DBMS", daysAgo: 8 },
      { q: "Difference between TCP and UDP", a: "TCP is connection-oriented, reliable, guarantees order, and features flow/congestion control. UDP is connectionless, lightweight, fast, but unreliable.", topic: "Computer Networks", daysAgo: 5 },
      { q: "How does virtual memory work?", a: "Virtual memory maps process-visible logical addresses to physical hardware RAM partitions using hardware units (MMU) and lookup sheets (Page Tables).", topic: "Operating Systems", daysAgo: 3 },
      { q: "What is B+ Tree indexing?", a: "A B+ Tree is a self-balancing tree search structure where all keys are stored in leaf nodes and sequential sibling links enable efficient range search operations.", topic: "DBMS", daysAgo: 1 },
    ];

    for (const chat of chats) {
      const chatDate = new Date(Date.now() - chat.daysAgo * 24 * 60 * 60 * 1000);
      const event = await LearningEvent.create({
        user: user._id,
        topic: chat.topic,
        eventType: "ai_tutoring_interaction",
        result: "completed",
        confidence: 80,
        metadata: {
          question: chat.q,
          answer: chat.a,
          streamed: false,
        },
      });

      // Override createdAt
      await LearningEvent.collection.updateOne(
        { _id: event._id },
        { $set: { createdAt: chatDate, updatedAt: chatDate } }
      );
    }

    logger.info("🎉 AthenaeumAI Enhanced Demo Seeding completed successfully!");
  } catch (err) {
    logger.error("❌ Error during demo seeding:", err);
  } finally {
    await mongoose.connection.close();
    logger.info("🔌 Database connection closed.");
    process.exit(0);
  }
};

runSeeder();
