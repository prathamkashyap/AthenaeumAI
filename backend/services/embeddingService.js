import MaterialChunk from "../models/MaterialChunk.js";
import StudyMaterial from "../models/StudyMaterial.js";

const EMBEDDING_DIMENSIONS = 384;
const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 260;
const EMBEDDING_MODEL = "local-hash-v1";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in",
  "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "were", "with",
]);

const tokenize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

const hashToken = (token) => {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const normalizeVector = (vector) => {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
};

export const generateEmbedding = (text) => {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenize(text);

  tokens.forEach((token, position) => {
    const hash = hashToken(token);
    const index = hash % EMBEDDING_DIMENSIONS;
    const sign = hash % 2 === 0 ? 1 : -1;
    const positionWeight = 1 + Math.max(0, 1 - position / Math.max(tokens.length, 1)) * 0.08;
    vector[index] += sign * positionWeight;
  });

  return normalizeVector(vector);
};

export const cosineSimilarity = (a, b) => {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
};

export const chunkMaterialText = (text, { size = CHUNK_SIZE, overlap = CHUNK_OVERLAP } = {}) => {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const chunks = [];
  let start = 0;

  while (start < cleaned.length) {
    const end = Math.min(start + size, cleaned.length);
    let sliceEnd = end;

    if (end < cleaned.length) {
      const boundary = cleaned.lastIndexOf(". ", end);
      if (boundary > start + size * 0.6) sliceEnd = boundary + 1;
    }

    const chunkText = cleaned.slice(start, sliceEnd).trim();
    if (chunkText.length > 120) chunks.push(chunkText);
    if (sliceEnd >= cleaned.length) break;
    start = Math.max(0, sliceEnd - overlap);
  }

  return chunks;
};

const inferTopics = (chunkText) => {
  const tokens = tokenize(chunkText);
  const counts = new Map();
  tokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([token]) => token);
};

export const indexStudyMaterialChunks = async (material) => {
  if (!material?.extractedText) return [];

  const chunks = chunkMaterialText(material.extractedText);
  const operations = chunks.map((chunkText, index) => ({
    updateOne: {
      filter: {
        user: material.user,
        studyMaterial: material._id,
        chunkIndex: index,
      },
      update: {
        $set: {
          user: material.user,
          studyMaterial: material._id,
          chunkIndex: index,
          chunkText,
          textPreview: chunkText.slice(0, 260),
          embedding: generateEmbedding(chunkText),
          embeddingModel: EMBEDDING_MODEL,
          tokenEstimate: Math.ceil(chunkText.split(/\s+/).length * 1.3),
          sourceTitle: material.title,
          topics: inferTopics(chunkText),
          metadata: {
            originalFileName: material.originalFileName,
            indexedAt: new Date(),
          },
        },
      },
      upsert: true,
    },
  }));

  if (!operations.length) return [];

  await MaterialChunk.bulkWrite(operations);
  await MaterialChunk.deleteMany({
    user: material.user,
    studyMaterial: material._id,
    chunkIndex: { $gte: chunks.length },
  });

  return MaterialChunk.find({ user: material.user, studyMaterial: material._id })
    .sort({ chunkIndex: 1 })
    .lean();
};

export const ensureChunksForUser = async (userId, materialId = null) => {
  const filter = { user: userId };
  if (materialId) filter._id = materialId;

  const materials = await StudyMaterial.find(filter).select("+extractedText");
  const indexed = [];

  for (const material of materials) {
    const existingCount = await MaterialChunk.countDocuments({
      user: userId,
      studyMaterial: material._id,
    });

    if (existingCount === 0 && material.extractedText) {
      indexed.push(...await indexStudyMaterialChunks(material));
    }
  }

  return indexed;
};

const keywordOverlapScore = (query, text) => {
  const queryTokens = new Set(tokenize(query));
  if (!queryTokens.size) return 0;
  const textTokens = new Set(tokenize(text));
  let overlap = 0;
  queryTokens.forEach((token) => {
    if (textTokens.has(token)) overlap += 1;
  });
  return overlap / queryTokens.size;
};

export const searchMaterialChunks = async ({
  userId,
  query,
  materialId = null,
  limit = 5,
}) => {
  await ensureChunksForUser(userId, materialId);

  const filter = { user: userId };
  if (materialId) filter.studyMaterial = materialId;

  const chunks = await MaterialChunk.find(filter)
    .populate("studyMaterial", "title originalFileName tags")
    .lean();

  const queryEmbedding = generateEmbedding(query);

  return chunks
    .map((chunk) => {
      const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
      const lexicalScore = keywordOverlapScore(query, chunk.chunkText);
      return {
        ...chunk,
        score: Number(((vectorScore * 0.78) + (lexicalScore * 0.22)).toFixed(4)),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(Number(limit) || 5, 1), 12));
};
