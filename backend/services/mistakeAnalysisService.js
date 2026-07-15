import { generateMistakeAnalysesFromAI } from "./aiQuizService.js";
import logger from "../utils/logger.js";

const fallbackAnalysis = (mistake) => ({
  questionIndex: mistake.questionIndex,
  topic: mistake.topic || "General",
  misconception: "The selected option suggests the concept boundary may be unclear.",
  clarification: mistake.explanation || `The correct answer is "${mistake.correctOption}". Revisit the underlying concept and compare it with the chosen option.`,
  distractorReason: mistake.selectedOption
    ? `"${mistake.selectedOption}" may look plausible because it overlaps with part of the concept, but it does not satisfy the full question.`
    : "No answer was selected, so the gap is likely recall confidence or time pressure.",
  revisionSuggestion: `Review ${mistake.topic || "this topic"} and retry a short targeted quiz.`,
  relatedFlashcards: [
    `Explain ${mistake.topic || "the concept"} in your own words.`,
    `Why is "${mistake.correctOption}" the best answer?`,
  ],
});

export const analyzeMistakesForAttempt = async ({ quiz, normalizedAnswers, limit = 5 }) => {
  const mistakes = normalizedAnswers
    .filter((answer) => !answer.isCorrect)
    .slice(0, limit)
    .map((answer) => {
      const question = quiz.questions[answer.questionIndex];
      return {
        questionIndex: answer.questionIndex,
        topic: answer.topic || question?.topic || "General",
        question: question?.question || "",
        options: question?.options || [],
        selectedOption: question?.options?.[answer.selected] || "",
        correctOption: question?.options?.[answer.correct] || "",
        explanation: question?.explanation || "",
      };
    });

  if (!mistakes.length) return [];

  try {
    const analyses = await generateMistakeAnalysesFromAI({
      quizTitle: quiz.title,
      difficulty: quiz.difficulty,
      mistakes,
    });

    if (analyses.length) {
      return mistakes.map((mistake) => (
        analyses.find((analysis) => analysis.questionIndex === mistake.questionIndex) || fallbackAnalysis(mistake)
      ));
    }
  } catch (err) {
    logger.warn("Mistake analysis AI failed, using fallback", { error: err.message });
  }

  return mistakes.map(fallbackAnalysis);
};
