import fs from "fs";
import pdf from "pdf-parse-fixed";

function cleanText(text) {
  return text
    .replace(/[^\x00-\x7F]/g, "")   // remove weird chars
    .replace(/\s+/g, " ")           // normalize spaces
    .trim();
}

export const extractTextFromPDF = async (filePath) => {
  try {
    console.log("Reading file from:", filePath);

    const dataBuffer = fs.readFileSync(filePath);

    const data = await pdf(dataBuffer);

    console.log("PDF parsed successfully");

    return data.text;
  } catch (err) {
    console.error("REAL PDF ERROR:", err);
    throw new Error("Failed to parse PDF");
  }
};