import {
  getRecommendationSnapshot,
  recordRecommendationFollowed,
} from "../services/recommendationService.js";

export const getRecommendations = async (req, res) => {
  const recommendations = await getRecommendationSnapshot(req.user._id);
  res.json(recommendations);
};

export const followRecommendation = async (req, res) => {
  const { recommendationType, topic = "General", metadata = {} } = req.body;

  await recordRecommendationFollowed({
    userId: req.user._id,
    recommendationType,
    topic,
    metadata,
  });

  res.json({ message: "Recommendation event recorded" });
};
