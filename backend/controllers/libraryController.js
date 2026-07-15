import StudyMaterial from "../models/StudyMaterial.js";
import Quiz from "../models/Quiz.js";
import FlashcardSet from "../models/FlashcardSet.js";

export const listMaterials = async (req, res) => {
  const search = String(req.query.search || "").trim();
  const filter = { user: req.user._id };

  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: "i" } },
      { tags: { $regex: search, $options: "i" } },
      { textPreview: { $regex: search, $options: "i" } },
    ];
  }

  const materials = await StudyMaterial.find(filter)
    .select("-extractedText")
    .populate("linkedQuizzes", "title difficulty questionCount createdAt")
    .populate("linkedFlashcardSets", "title cards createdAt")
    .sort({ createdAt: -1 })
    .lean();

  res.json({ materials });
};

export const getMaterial = async (req, res) => {
  const material = await StudyMaterial.findOne({ _id: req.params.id, user: req.user._id })
    .select("-extractedText")
    .populate("linkedQuizzes", "title difficulty questionCount createdAt")
    .populate("linkedFlashcardSets", "title cards createdAt")
    .lean();

  if (!material) return res.status(404).json({ error: "Study material not found" });
  res.json({ material });
};

export const updateMaterial = async (req, res) => {
  const { title, tags } = req.body;
  const updates = {};
  if (typeof title === "string" && title.trim()) updates.title = title.trim();
  if (Array.isArray(tags)) updates.tags = tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12);

  const material = await StudyMaterial.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    updates,
    { new: true }
  ).select("-extractedText");

  if (!material) return res.status(404).json({ error: "Study material not found" });
  res.json({ material });
};

export const deleteMaterial = async (req, res, next) => {
  try {
    const materialId = req.params.id;
    const material = await StudyMaterial.findOneAndUpdate(
      { _id: materialId, user: req.user._id, deletedAt: null },
      { deletedAt: new Date() },
      { new: true }
    );

    if (!material) {
      return res.status(404).json({ error: "Study material not found" });
    }

    // Cascading soft deletes for linked assessments & decks
    const deletedTime = new Date();
    await Promise.all([
      Quiz.updateMany(
        { studyMaterial: materialId, user: req.user._id, deletedAt: null },
        { deletedAt: deletedTime }
      ),
      FlashcardSet.updateMany(
        { studyMaterial: materialId, user: req.user._id, deletedAt: null },
        { deletedAt: deletedTime }
      ),
    ]);

    res.json({ message: "Study material and linked resources soft-deleted successfully" });
  } catch (err) {
    next(err);
  }
};
