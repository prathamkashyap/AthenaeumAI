import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { extractTextFromPDF } from "../utils/pdfParser.js";
import { generateQuiz } from "../services/quizService.js";
import Quiz from "../models/Quiz.js";
import logger from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Default subjects mapped to the study material directory structure.
 * Each entry picks ONE representative PDF from the subject folder.
 */
const DEFAULT_SUBJECTS = [
  {
    subject: "Operating Systems",
    shortName: "OS",
    folder: "CSE 3003 Operating System",
    icon: "🖥️",
  },
  {
    subject: "Data Structures & Algorithms",
    shortName: "DSA",
    folder: "CSD 3009 Data Structures And Analysis of Algorithms",
    icon: "🌲",
  },
  {
    subject: "Computer Networks",
    shortName: "CN",
    folder: "CSE 3006 Computer Networks",
    icon: "🌐",
  },
  {
    subject: "DBMS",
    shortName: "DBMS",
    folder: "DBMS",
    icon: "🗄️",
  },
  {
    subject: "Data Mining",
    shortName: "DM",
    folder: "CSA3006 Data Mining and Data Warehousing",
    icon: "⛏️",
  },
  {
    subject: "Deep Learning",
    shortName: "DL",
    folder: "CSA3007 Deep Learning",
    icon: "🧠",
  },
  {
    subject: "Natural Language Processing",
    shortName: "NLP",
    folder: "CSA4028 Natural Language Processing",
    icon: "💬",
  },
  {
    subject: "Computer Vision",
    shortName: "CV",
    folder: "CSE3010 Computer Vision",
    icon: "👁️",
  },
];

/**
 * Finds the first readable PDF in a directory (recursive, max depth 2).
 */
const findFirstPDF = (dirPath, depth = 0) => {
  if (depth > 2 || !fs.existsSync(dirPath)) return null;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    // First pass: look for PDFs in current directory (prefer Module 1)
    const pdfs = entries
      .filter((e) => e.isFile() && e.name.endsWith(".pdf") && !e.name.startsWith("."))
      .map((e) => path.join(dirPath, e.name));

    if (pdfs.length > 0) return pdfs[0];

    // Second pass: recurse into subdirectories (prefer Module folders)
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .sort((a, b) => {
        // Prioritize "Module 1" type folders
        const aModule = a.name.match(/module.?1/i) ? 0 : 1;
        const bModule = b.name.match(/module.?1/i) ? 0 : 1;
        return aModule - bModule || a.name.localeCompare(b.name);
      });

    for (const dir of dirs) {
      const found = findFirstPDF(path.join(dirPath, dir.name), depth + 1);
      if (found) return found;
    }
  } catch (err) {
    // Ignore permission errors
  }

  return null;
};

/**
 * Seeds default subject quizzes from the study material directory.
 * Only runs if MongoDB is connected and quizzes don't already exist.
 *
 * @param {string} studyMaterialPath - Path to the study material root directory
 */
export const seedDefaultQuizzes = async (studyMaterialPath) => {
  // Check if study material directory exists
  if (!fs.existsSync(studyMaterialPath)) {
    logger.warn("📁 Study material directory not found, skipping default quiz seeding");
    return;
  }

  logger.info("📚 Checking default subject quizzes...");

  let seeded = 0;
  let skipped = 0;

  for (const subject of DEFAULT_SUBJECTS) {
    try {
      // Check if this subject's default quiz already exists
      const existing = await Quiz.findOne({
        subject: subject.subject,
        isDefault: true,
      });

      if (existing) {
        skipped++;
        continue;
      }

      // Find a PDF for this subject
      const subjectDir = path.join(studyMaterialPath, subject.folder);
      const pdfPath = findFirstPDF(subjectDir);

      if (!pdfPath) {
        logger.warn(`   ⚠️  No PDF found for ${subject.shortName} in ${subject.folder}`);
        continue;
      }

      logger.info(`   📄 Generating quiz for ${subject.shortName} from ${path.basename(pdfPath)}...`);

      // Extract text
      const text = await extractTextFromPDF(pdfPath);

      if (!text || text.trim().length < 100) {
        logger.warn(`   ⚠️  Not enough text in PDF for ${subject.shortName}`);
        continue;
      }

      // Generate quiz (10 questions, Medium difficulty for default quizzes)
      const questions = await generateQuiz(text, "Medium", 10);

      if (!questions || questions.length === 0) {
        logger.warn(`   ⚠️  Failed to generate questions for ${subject.shortName}`);
        continue;
      }

      // Save to database
      await Quiz.create({
        title: `${subject.subject} — Fundamentals`,
        difficulty: "Medium",
        subject: subject.subject,
        isDefault: true,
        sourceFileName: path.basename(pdfPath),
        questionCount: questions.length,
        questions,
      });

      seeded++;
      logger.info(`   ✅ ${subject.shortName}: ${questions.length} questions generated`);
    } catch (err) {
      logger.error(`   ❌ Error seeding ${subject.shortName}:`, err);
    }
  }

  logger.info(`📚 Seeding complete: ${seeded} new, ${skipped} already existed`);
};

/**
 * Returns the list of available default subjects (for frontend display).
 */
export const getDefaultSubjects = () => {
  return DEFAULT_SUBJECTS.map(({ subject, shortName, icon }) => ({
    subject,
    shortName,
    icon,
  }));
};

export { DEFAULT_SUBJECTS };
