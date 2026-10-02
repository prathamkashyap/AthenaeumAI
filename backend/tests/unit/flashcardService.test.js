/**
 * Unit Tests — flashcardService (SM-2+ Spaced Repetition)
 *
 * These tests import and execute the shipped production implementation of
 * `applySpacedRepetitionReview` from `backend/services/flashcardService.js`.
 *
 * Only the Mongoose persistence boundary is mocked. The rating map, the ease
 * factor formula and its [1.3, 3.0] clamp, the repetition rules, the interval
 * ladder, the 1.3 easy bonus, the next-review date, the nine scheduling field
 * writes and the `set.save()` call are all production code executed here.
 *
 * Every expected value below is a concrete number derived from the shipped
 * formula. No formula is reimplemented in this file, so a regression in
 * `flashcardService.js` fails these tests.
 */

import { jest } from "@jest/globals";

// ─── Mongoose boundary mock ──────────────────────────────────────────────────
// `flashcardService.js` performs `FlashcardSet.findOne(...)` and then mutates
// and saves the returned document. That round-trip is the only thing replaced;
// everything downstream of the lookup is real production code.

const findOne = jest.fn();

jest.unstable_mockModule("../../models/FlashcardSet.js", () => ({
  default: { findOne },
}));

const { applySpacedRepetitionReview } = await import("../../services/flashcardService.js");

// ─── Deterministic clock ──────────────────────────────────────────────────────
// `applySpacedRepetitionReview` derives `nextReviewAt` from `Date.now()`, so the
// clock is fixed to make every date assertion exact.

const FIXED_NOW = new Date("2026-01-15T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const USER_ID = "user-1";
const SET_ID = "set-1";
const CARD_ID = "card-1";

// ─── Test fixtures ────────────────────────────────────────────────────────────

/**
 * A minimal card carrying the scheduling state the production function reads
 * (`flashcardService.js:170-173`): `easeFactor`/`ease`, `repetitions`,
 * `interval`/`intervalDays` and `reviewCount`. The caller may override any of
 * these to place the card in a specific SM-2 position.
 */
const buildCard = (review = {}) => ({
  _id: CARD_ID,
  front: "What is a process control block?",
  back: "A record the operating system keeps for a single process.",
  topic: "Operating Systems",
  review: {
    easeFactor: 2.5,
    ease: 2.5,
    interval: 0,
    intervalDays: 0,
    repetitions: 0,
    nextReviewAt: null,
    dueAt: null,
    lastReviewedAt: null,
    reviewCount: 0,
    ...review,
  },
});

/** A minimal set exposing the `cards.id(cardId)` accessor production relies on. */
const buildSet = (cards) => {
  const cardList = [...cards];
  cardList.id = (cardId) => cardList.find((card) => String(card._id) === String(cardId));

  const save = jest.fn(async () => undefined);
  return { set: { _id: SET_ID, cards: cardList, save }, save };
};

/**
 * Drives the real production function against a single-card set.
 * Returns the card, the set and the value the service returned, so a test can
 * assert on production-written state rather than on a local calculation.
 */
const reviewCard = async ({ review, rating }) => {
  const card = buildCard(review);
  const { set, save } = buildSet([card]);
  findOne.mockResolvedValue(set);

  const returned = await applySpacedRepetitionReview({
    userId: USER_ID,
    setId: SET_ID,
    cardId: CARD_ID,
    rating,
  });

  return { card, set, save, returned };
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(FIXED_NOW);
  findOne.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── Rating mapping ───────────────────────────────────────────────────────────
// The service maps again→1, hard→3, good→4, easy→5 (`flashcardService.js:148-154`).
// Each rating moves ease by a different amount, so concrete ease values
// distinguish the four ratings independently of any relative comparison.

describe("rating mapping", () => {
  test("maps 'good' to quality 4, which leaves the ease factor at 2.5", async () => {
    const { card } = await reviewCard({ rating: "good" });
    expect(card.review.easeFactor).toBe(2.5);
  });

  test("maps 'easy' to quality 5, which raises the ease factor to 2.6", async () => {
    const { card } = await reviewCard({ rating: "easy" });
    expect(card.review.easeFactor).toBe(2.6);
  });

  test("maps 'hard' to quality 3, which lowers the ease factor to 2.36", async () => {
    const { card } = await reviewCard({ rating: "hard" });
    expect(card.review.easeFactor).toBe(2.36);
  });

  test("maps 'again' to quality 1, which lowers the ease factor to 1.96", async () => {
    const { card } = await reviewCard({ rating: "again" });
    expect(card.review.easeFactor).toBe(1.96);
  });

  test("treats an unrecognised rating as quality 4 rather than rejecting it", async () => {
    const { card } = await reviewCard({ rating: "not-a-real-rating", review: { repetitions: 0 } });
    // Quality 4 behaviour: ease unchanged at 2.5, and the first-repetition
    // interval. 'hard' would have produced 2.36, so this is distinguishable.
    expect(card.review.easeFactor).toBe(2.5);
    expect(card.review.repetitions).toBe(1);
    expect(card.review.interval).toBe(1);
  });
});

// ─── Ease factor ──────────────────────────────────────────────────────────────
// Production: clamp(EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02)), 1.3, 3.0)
// (`flashcardService.js:176-180`). The expected numbers below are the results of
// that formula, not of any code in this file.

describe("ease factor", () => {
  test("applies the shipped ease formula for 'good' from 2.5", async () => {
    const { card } = await reviewCard({ rating: "good", review: { easeFactor: 2.5, ease: 2.5 } });
    expect(card.review.easeFactor).toBe(2.5);
  });

  test("applies the shipped ease formula for 'easy' from 2.5", async () => {
    const { card } = await reviewCard({ rating: "easy", review: { easeFactor: 2.5, ease: 2.5 } });
    expect(card.review.easeFactor).toBe(2.6);
  });

  test("applies the shipped ease formula for 'hard' from 2.5", async () => {
    const { card } = await reviewCard({ rating: "hard", review: { easeFactor: 2.5, ease: 2.5 } });
    expect(card.review.easeFactor).toBe(2.36);
  });

  test("applies the shipped ease formula for 'again' from 2.5", async () => {
    const { card } = await reviewCard({ rating: "again", review: { easeFactor: 2.5, ease: 2.5 } });
    expect(card.review.easeFactor).toBe(1.96);
  });

  test("applies the shipped ease formula from a non-default starting ease of 2.0", async () => {
    const { card } = await reviewCard({ rating: "again", review: { easeFactor: 2.0, ease: 2.0 } });
    expect(card.review.easeFactor).toBe(1.46);
  });

  test("clamps the ease factor at the 1.3 lower bound", async () => {
    const { card } = await reviewCard({ rating: "again", review: { easeFactor: 1.3, ease: 1.3 } });
    expect(card.review.easeFactor).toBe(1.3);
  });

  test("clamps the ease factor at the 3.0 upper bound", async () => {
    const { card } = await reviewCard({ rating: "easy", review: { easeFactor: 3.0, ease: 3.0 } });
    expect(card.review.easeFactor).toBe(3.0);
  });

  test("keeps the ease factor within [1.3, 3.0] across a long run of 'again' reviews", async () => {
    let card = buildCard({ easeFactor: 1.35, ease: 1.35 });
    const { set } = buildSet([card]);
    findOne.mockResolvedValue(set);

    for (let review = 0; review < 5; review += 1) {
      await applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "again" });
      expect(card.review.easeFactor).toBeGreaterThanOrEqual(1.3);
    }
    expect(card.review.easeFactor).toBe(1.3);
  });
});

// ─── Repetitions ──────────────────────────────────────────────────────────────
// Production: `quality < 3 ? 0 : currentRepetitions + 1` (`flashcardService.js:182`).

describe("repetition counting", () => {
  test("resets repetitions to 0 after an 'again' review", async () => {
    const { card } = await reviewCard({ rating: "again", review: { repetitions: 5 } });
    expect(card.review.repetitions).toBe(0);
  });

  test("increments repetitions after a 'good' review", async () => {
    const { card } = await reviewCard({ rating: "good", review: { repetitions: 2 } });
    expect(card.review.repetitions).toBe(3);
  });

  test("increments repetitions after a 'hard' review because quality 3 is not a reset", async () => {
    const { card } = await reviewCard({ rating: "hard", review: { repetitions: 2 } });
    expect(card.review.repetitions).toBe(3);
  });

  test("increments repetitions after an 'easy' review", async () => {
    const { card } = await reviewCard({ rating: "easy", review: { repetitions: 4 } });
    expect(card.review.repetitions).toBe(5);
  });
});

// ─── Interval ladder ──────────────────────────────────────────────────────────
// Production (`flashcardService.js:183-195`):
//   quality < 3   -> 0 days for 'again', otherwise 1 day
//   repetitions 1  -> 1 day
//   repetitions 2  -> 6 days
//   repetitions >=3-> max(1, round(currentInterval * currentEase)), times 1.3 for 'easy'

describe("interval ladder", () => {
  test("schedules 0 days for an 'again' review", async () => {
    const { card } = await reviewCard({ rating: "again", review: { repetitions: 4, interval: 10, intervalDays: 10 } });
    expect(card.review.interval).toBe(0);
  });

  test("schedules 1 day for the first successful repetition", async () => {
    const { card } = await reviewCard({ rating: "good", review: { repetitions: 0 } });
    expect(card.review.repetitions).toBe(1);
    expect(card.review.interval).toBe(1);
  });

  test("schedules 6 days for the second successful repetition", async () => {
    const { card } = await reviewCard({ rating: "good", review: { repetitions: 1 } });
    expect(card.review.repetitions).toBe(2);
    expect(card.review.interval).toBe(6);
  });

  test("calculates 25 days for a later 'good' repetition from interval 10 and ease 2.5", async () => {
    const { card } = await reviewCard({
      rating: "good",
      review: { repetitions: 3, interval: 10, intervalDays: 10, easeFactor: 2.5, ease: 2.5 },
    });
    expect(card.review.repetitions).toBe(4);
    expect(card.review.interval).toBe(25);
  });

  test("calculates 6 days for a later 'hard' repetition when the previous interval was 0", async () => {
    // interval 0 would round to 0, so the Math.max(1, ...) floor is what is under test.
    const { card } = await reviewCard({
      rating: "hard",
      review: { repetitions: 3, interval: 0, intervalDays: 0, easeFactor: 2.5, ease: 2.5 },
    });
    expect(card.review.interval).toBe(1);
  });

  test("applies the 1.3 easy interval bonus: 33 days where 'good' gives 25", async () => {
    // Identical starting state for both reviews. 10 * 2.5 = 25, and
    // 10 * (2.5 * 1.3) = 32.5 which rounds to 33. Removing the 1.3 multiplier
    // from production would make this 25 and fail the second assertion.
    const good = await reviewCard({
      rating: "good",
      review: { repetitions: 3, interval: 10, intervalDays: 10, easeFactor: 2.5, ease: 2.5 },
    });
    const easy = await reviewCard({
      rating: "easy",
      review: { repetitions: 3, interval: 10, intervalDays: 10, easeFactor: 2.5, ease: 2.5 },
    });

    expect(good.card.review.interval).toBe(25);
    expect(easy.card.review.interval).toBe(33);
  });

  test("uses the ease factor that was in effect before the update, not the new one", async () => {
    // easeFactor 2.0 with 'easy' advances to 2.1, but the interval multiplier is
    // built from the pre-update ease: round(10 * (2.0 * 1.3)) = 26, not 27.
    const { card } = await reviewCard({
      rating: "easy",
      review: { repetitions: 3, interval: 10, intervalDays: 10, easeFactor: 2.0, ease: 2.0 },
    });
    expect(card.review.easeFactor).toBe(2.1);
    expect(card.review.interval).toBe(26);
  });
});

// ─── Next review date ─────────────────────────────────────────────────────────
// Production: `new Date(Date.now() + nextInterval * 24 * 60 * 60 * 1000)`
// (`flashcardService.js:197`).

describe("next review date", () => {
  test("schedules the same instant for an 'again' review that has a zero-day interval", async () => {
    const { card } = await reviewCard({ rating: "again", review: { repetitions: 2, interval: 5, intervalDays: 5 } });
    expect(card.review.interval).toBe(0);
    expect(card.review.nextReviewAt).toEqual(FIXED_NOW);
  });

  test("adds exactly one day for a one-day interval", async () => {
    const { card } = await reviewCard({ rating: "good", review: { repetitions: 0 } });
    expect(card.review.interval).toBe(1);
    expect(card.review.nextReviewAt).toEqual(new Date(FIXED_NOW.getTime() + 1 * DAY_MS));
  });

  test("adds exactly six days for a six-day interval", async () => {
    const { card } = await reviewCard({ rating: "good", review: { repetitions: 1 } });
    expect(card.review.interval).toBe(6);
    expect(card.review.nextReviewAt).toEqual(new Date(FIXED_NOW.getTime() + 6 * DAY_MS));
  });

  test("adds exactly 25 days for the 25-day interval produced by the ladder", async () => {
    const { card } = await reviewCard({
      rating: "good",
      review: { repetitions: 3, interval: 10, intervalDays: 10, easeFactor: 2.5, ease: 2.5 },
    });
    expect(card.review.interval).toBe(25);
    expect(card.review.nextReviewAt).toEqual(new Date(FIXED_NOW.getTime() + 25 * DAY_MS));
  });

  test("mirrors nextReviewAt onto dueAt", async () => {
    const { card } = await reviewCard({ rating: "good", review: { repetitions: 1 } });
    expect(card.review.dueAt).toEqual(card.review.nextReviewAt);
  });
});

// ─── Persisted scheduling state ───────────────────────────────────────────────
// Production writes nine fields (`flashcardService.js:199-207`). The names below
// are the names the implementation actually writes.

describe("persisted scheduling state", () => {
  test("persists every scheduling field the implementation writes", async () => {
    const { card } = await reviewCard({
      rating: "easy",
      review: { repetitions: 3, interval: 10, intervalDays: 10, easeFactor: 2.5, ease: 2.5, reviewCount: 4 },
    });

    expect(card.review.easeFactor).toBe(2.6);
    expect(card.review.ease).toBe(2.6);
    expect(card.review.interval).toBe(33);
    expect(card.review.intervalDays).toBe(33);
    expect(card.review.repetitions).toBe(4);
    expect(card.review.nextReviewAt).toEqual(new Date(FIXED_NOW.getTime() + 33 * DAY_MS));
    expect(card.review.dueAt).toEqual(card.review.nextReviewAt);
    expect(card.review.lastReviewedAt).toEqual(FIXED_NOW);
    expect(card.review.reviewCount).toBe(5);
  });

  test("keeps the ease alias and the easeFactor field in step", async () => {
    const { card } = await reviewCard({ rating: "hard", review: { easeFactor: 2.5, ease: 1.9 } });
    expect(card.review.easeFactor).toBe(2.36);
    expect(card.review.ease).toBe(card.review.easeFactor);
  });

  test("keeps the interval alias and the intervalDays field in step", async () => {
    const { card } = await reviewCard({ rating: "good", review: { repetitions: 1, intervalDays: 99 } });
    expect(card.review.interval).toBe(6);
    expect(card.review.intervalDays).toBe(card.review.interval);
  });

  test("reads a starting ease from the 'ease' alias when easeFactor is absent", async () => {
    // `currentEase = review.easeFactor || review.ease || 2.5` (flashcardService.js:171)
    // 'hard' subtracts 0.14, so an ease of 1.9 must land on 1.76.
    const card = buildCard({ ease: 1.9 });
    delete card.review.easeFactor;
    const { set } = buildSet([card]);
    findOne.mockResolvedValue(set);

    await applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "hard" });

    expect(card.review.easeFactor).toBe(1.76);
    expect(card.review.ease).toBe(1.76);
  });

  test("reads a starting interval from the 'intervalDays' alias when interval is absent", async () => {
    // `currentInterval = review.interval || review.intervalDays || 0` (flashcardService.js:173)
    // repetitions 3 -> 4, so round(10 * 2.5) = 25.
    const card = buildCard({ repetitions: 3, intervalDays: 10, easeFactor: 2.5, ease: 2.5 });
    delete card.review.interval;
    const { set } = buildSet([card]);
    findOne.mockResolvedValue(set);

    await applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "good" });

    expect(card.review.interval).toBe(25);
  });

  test("falls back to a 2.5 ease factor and 0 repetitions when the review record is empty", async () => {
    // `currentEase = review.easeFactor || review.ease || 2.5` (flashcardService.js:171)
    const card = buildCard();
    card.review = {};
    const { set } = buildSet([card]);
    findOne.mockResolvedValue(set);

    await applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "good" });

    expect(card.review.easeFactor).toBe(2.5);
    expect(card.review.ease).toBe(2.5);
    expect(card.review.repetitions).toBe(1);
    expect(card.review.interval).toBe(1);
    expect(card.review.reviewCount).toBe(1);
  });

  test("increments an existing reviewCount rather than resetting it", async () => {
    const { card } = await reviewCard({ rating: "again", review: { reviewCount: 12 } });
    expect(card.review.reviewCount).toBe(13);
  });

  test("does not modify the card's prompt fields", async () => {
    const { card } = await reviewCard({ rating: "good" });
    expect(card.front).toBe("What is a process control block?");
    expect(card.topic).toBe("Operating Systems");
  });
});

// ─── Persistence path ─────────────────────────────────────────────────────────
// These assertions are what distinguish a run through the shipped service from a
// calculation performed in the test file.

describe("persistence", () => {
  test("looks the set up by both set id and user id", async () => {
    await reviewCard({ rating: "good" });
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith({ _id: SET_ID, user: USER_ID });
  });

  test("saves the set exactly once per review", async () => {
    const { save } = await reviewCard({ rating: "good", review: { repetitions: 1 } });
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("saves only after the scheduling state has already been written", async () => {
    let stateWhenSaved = null;
    const card = buildCard({ repetitions: 1, easeFactor: 2.5, ease: 2.5 });
    const { set } = buildSet([card]);
    set.save.mockImplementation(async () => {
      stateWhenSaved = { ...card.review };
    });
    findOne.mockResolvedValue(set);

    await applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "good" });

    // If save() ran before the field writes, this snapshot would still hold the
    // pre-review interval of 0 and no nextReviewAt.
    expect(stateWhenSaved.interval).toBe(6);
    expect(stateWhenSaved.easeFactor).toBe(2.5);
    expect(stateWhenSaved.nextReviewAt).toEqual(new Date(FIXED_NOW.getTime() + 6 * DAY_MS));
    expect(stateWhenSaved.reviewCount).toBe(1);
  });

  test("returns the card it just saved", async () => {
    const { card, returned } = await reviewCard({ rating: "good" });
    expect(returned).toBe(card);
  });

  test("does not save when the card cannot be found", async () => {
    const { set, save } = buildSet([buildCard()]);
    findOne.mockResolvedValue(set);

    await expect(
      applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: "missing-card", rating: "good" }),
    ).rejects.toThrow("Flashcard not found");

    expect(save).not.toHaveBeenCalled();
  });
});

// ─── Lookup failure boundaries ────────────────────────────────────────────────
// Both branches already exist in production (`flashcardService.js:157-168`) with a
// 404 status attached to the error. No new error semantics are introduced.

describe("lookup failures", () => {
  test("throws a 404 when the flashcard set does not exist", async () => {
    findOne.mockResolvedValue(null);

    await expect(
      applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "good" }),
    ).rejects.toThrow("Flashcard set not found");
  });

  test("attaches status 404 to the missing-set error", async () => {
    findOne.mockResolvedValue(null);

    const error = await applySpacedRepetitionReview({
      userId: USER_ID,
      setId: SET_ID,
      cardId: CARD_ID,
      rating: "good",
    }).catch((err) => err);

    expect(error.status).toBe(404);
  });

  test("throws a 404 when the card is not in the set", async () => {
    const { set } = buildSet([buildCard()]);
    findOne.mockResolvedValue(set);

    await expect(
      applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: "no-such-card", rating: "easy" }),
    ).rejects.toThrow("Flashcard not found");
  });

  test("attaches status 404 to the missing-card error", async () => {
    const { set } = buildSet([buildCard()]);
    findOne.mockResolvedValue(set);

    const error = await applySpacedRepetitionReview({
      userId: USER_ID,
      setId: SET_ID,
      cardId: "no-such-card",
      rating: "good",
    }).catch((err) => err);

    expect(error.status).toBe(404);
  });

  test("does not treat a different user as a valid owner of the set", async () => {
    // The lookup is scoped by user, so another user's set is simply not found.
    // The mock returns null to model the real driver's response for a miss.
    findOne.mockResolvedValue(null);

    await expect(
      applySpacedRepetitionReview({ userId: "someone-else", setId: SET_ID, cardId: CARD_ID, rating: "good" }),
    ).rejects.toThrow("Flashcard set not found");
  });
});

// ─── Multi-review sequence ───────────────────────────────────────────────────
// Exercises the same card object through several production calls, which is how
// a learner's card actually evolves.

describe("consecutive reviews of the same card", () => {
  test("walks the first-repetition, second-repetition and ladder intervals in order", async () => {
    const card = buildCard();
    const { set } = buildSet([card]);
    findOne.mockResolvedValue(set);

    await applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "good" });
    expect([card.review.repetitions, card.review.interval]).toEqual([1, 1]);

    await applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "good" });
    expect([card.review.repetitions, card.review.interval]).toEqual([2, 6]);

    // Third success: round(6 * 2.5) = 15
    await applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "good" });
    expect([card.review.repetitions, card.review.interval]).toEqual([3, 15]);

    // Fourth success: round(15 * 2.5) = 38 (37.5 rounds up)
    await applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "good" });
    expect([card.review.repetitions, card.review.interval]).toEqual([4, 38]);

    expect(card.review.reviewCount).toBe(4);
  });

  test("a failed 'again' review drops the card back to a same-day state", async () => {
    const card = buildCard();
    const { set } = buildSet([card]);
    findOne.mockResolvedValue(set);

    await applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "good" });
    await applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "easy" });
    const easeBeforeReset = card.review.easeFactor;
    expect(card.review.repetitions).toBe(2);

    await applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "again" });

    expect(card.review.repetitions).toBe(0);
    expect(card.review.interval).toBe(0);
    expect(card.review.easeFactor).toBeLessThan(easeBeforeReset);
    expect(card.review.nextReviewAt).toEqual(FIXED_NOW);
    // The review itself is still counted, and the card can climb back up.
    expect(card.review.reviewCount).toBe(3);

    await applySpacedRepetitionReview({ userId: USER_ID, setId: SET_ID, cardId: CARD_ID, rating: "good" });
    expect([card.review.repetitions, card.review.interval]).toEqual([1, 1]);
  });
});
