import fs from "fs";
import pdf from "pdf-parse-fixed";
import logger from "../utils/logger.js";

function cleanText(text) {
  return text
    .replace(/[^\x00-\x7F]/g, "")   // remove weird chars
    .replace(/\s+/g, " ")           // normalize spaces
    .trim();
}

export const extractTextFromPDF = async (filePath) => {
  try {
    logger.info("Reading file from path for parsing:", { filePath });

    const dataBuffer = fs.readFileSync(filePath);

    const data = await pdf(dataBuffer);

    logger.info("PDF parsed successfully", { filePath });

    return cleanText(data.text);
  } catch (err) {
    logger.error("Error during PDF parsing:", err);
    throw new Error("Failed to parse PDF");
  }
};