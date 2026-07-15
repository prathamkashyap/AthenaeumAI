export const cleanText = (text) => {
  return text
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/Page \d+/gi, "")
    .replace(/Faculty.*?University/gi, "")
    .replace(/Class Notes/gi, "")
    .slice(0, 8000);
};