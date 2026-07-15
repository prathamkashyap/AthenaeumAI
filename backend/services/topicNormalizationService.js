const TOPIC_MAPPINGS = {
  "os": "Operating Systems",
  "operating system": "Operating Systems",
  "operating systems": "Operating Systems",
  "dsa": "Data Structures & Algorithms",
  "data structures": "Data Structures & Algorithms",
  "algorithms": "Data Structures & Algorithms",
  "data structures and algorithms": "Data Structures & Algorithms",
  "cn": "Computer Networks",
  "network": "Computer Networks",
  "networks": "Computer Networks",
  "computer network": "Computer Networks",
  "computer networks": "Computer Networks",
  "dbms": "DBMS",
  "database": "DBMS",
  "databases": "DBMS",
  "database management system": "DBMS",
  "database management systems": "DBMS",
  "dl": "Deep Learning",
  "deeplearning": "Deep Learning",
  "nlp": "Natural Language Processing",
  "natural language": "Natural Language Processing",
  "cv": "Computer Vision",
  "computervision": "Computer Vision",
};

/**
 * Converts a string to Title Case.
 */
export const toTitleCase = (str) => {
  if (!str) return "";
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

/**
 * Normalizes a topic string into a clean, canonical format.
 * @param {string} rawTopic - The raw topic string.
 * @returns {string} The normalized canonical topic.
 */
export const normalizeTopic = (rawTopic) => {
  if (!rawTopic || typeof rawTopic !== "string") {
    return "General";
  }

  const trimmed = rawTopic.trim();
  const key = trimmed.toLowerCase();

  // Check lookup dictionary
  if (TOPIC_MAPPINGS[key]) {
    return TOPIC_MAPPINGS[key];
  }

  // Fallback to cleaned title casing
  return toTitleCase(trimmed);
};

export default normalizeTopic;
