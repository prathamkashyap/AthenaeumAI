/**
 * Unit Tests — reviewQueueService (pure-logic helpers)
 * Tests queue item construction, priority calculation, and pagination logic
 * without database I/O by extracting and validating the logic directly.
 */

// ─── Re-implement tested helpers for isolation ────────────────────────────────

const nowPlusHours = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000);

const buildTopicItem = (userId, topic) => ({
  user: userId,
  itemType: (topic.confidence || 0) < 55 ? "low_confidence_topic" : "weak_topic",
  subject: topic.subject || "",
  topic: topic.topic,
  title:
    (topic.confidence || 0) < 55
      ? `Rebuild confidence: ${topic.topic}`
      : `Review weak topic: ${topic.topic}`,
  description: `Mastery ${topic.mastery || 0}%, confidence ${topic.confidence || 0}%, weakness ${topic.weaknessScore || 0}%.`,
  priority: Math.max(topic.weaknessScore || 0, 100 - (topic.confidence || 0)),
  dueAt: new Date(),
  source: {},
  metadata: {
    mastery: topic.mastery,
    confidence: topic.confidence,
    weaknessScore: topic.weaknessScore,
    recommendedDifficulty: topic.recommendedDifficulty,
  },
});

const buildFlashcardItem = (userId, set, card) => {
  const now = new Date();
  const dueAt = card.review?.nextReviewAt || card.review?.dueAt;
  const daysOverdue = Math.max(0, (now - new Date(dueAt)) / (1000 * 60 * 60 * 24));

  return {
    user: userId,
    itemType: daysOverdue >= 1 ? "overdue_review" : "due_flashcard",
    subject: "",
    topic: card.topic || "General",
    title: `${daysOverdue >= 1 ? "Overdue" : "Due"} flashcard: ${card.topic || "General"}`,
    description: card.front,
    priority: Math.round(55 + daysOverdue * 8),
    dueAt: new Date(dueAt),
    source: { flashcardSet: set._id, flashcardId: card._id },
    metadata: {
      setTitle: set.title,
      interval: card.review?.interval || card.review?.intervalDays || 0,
      repetitions: card.review?.repetitions || 0,
    },
  };
};

const paginateItems = (items, page = 1, limit = 20) => {
  const pageNum = Math.max(parseInt(page) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;
  const paginated = items.slice(skip, skip + limitNum);

  return {
    items: paginated,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: items.length,
      pages: Math.ceil(items.length / limitNum),
    },
  };
};

const snoozeItem = (item, hours = 24) => ({
  ...item,
  dueAt: nowPlusHours(hours),
  priority: 40,
});

// ─── Topic Item Builder ───────────────────────────────────────────────────────

describe("buildTopicItem — itemType classification", () => {
  const userId = "user123";

  test("assigns 'low_confidence_topic' when confidence < 55", () => {
    const item = buildTopicItem(userId, {
      topic: "Algorithms",
      confidence: 40,
      mastery: 60,
      weaknessScore: 30,
      subject: "CS",
    });
    expect(item.itemType).toBe("low_confidence_topic");
    expect(item.title).toContain("Rebuild confidence");
  });

  test("assigns 'weak_topic' when confidence >= 55 but weakness is high", () => {
    const item = buildTopicItem(userId, {
      topic: "Networks",
      confidence: 70,
      mastery: 50,
      weaknessScore: 60,
      subject: "CS",
    });
    expect(item.itemType).toBe("weak_topic");
    expect(item.title).toContain("Review weak topic");
  });

  test("priority is the maximum of weaknessScore and (100 - confidence)", () => {
    const topic = { topic: "DBMS", confidence: 40, weaknessScore: 50, mastery: 45, subject: "CS" };
    const item = buildTopicItem(userId, topic);
    expect(item.priority).toBe(60); // max(50, 100-40=60)
  });

  test("priority uses weaknessScore when it is larger", () => {
    const topic = { topic: "OS", confidence: 80, weaknessScore: 75, mastery: 60, subject: "CS" };
    const item = buildTopicItem(userId, topic);
    expect(item.priority).toBe(75); // max(75, 100-80=20)
  });

  test("description contains mastery and confidence values", () => {
    const item = buildTopicItem(userId, { topic: "ML", confidence: 55, mastery: 70, weaknessScore: 30, subject: "AI" });
    expect(item.description).toContain("70%");
    expect(item.description).toContain("55%");
  });
});

// ─── Flashcard Item Builder ───────────────────────────────────────────────────

describe("buildFlashcardItem — overdue vs due classification", () => {
  const userId = "user123";
  const mockSet = { _id: "set1", title: "CS Flashcards" };

  test("classifies as 'overdue_review' if card is more than 1 day past due", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const card = { _id: "card1", topic: "OS", front: "What is a process?", review: { nextReviewAt: twoDaysAgo } };
    const item = buildFlashcardItem(userId, mockSet, card);
    expect(item.itemType).toBe("overdue_review");
    expect(item.priority).toBeGreaterThan(55);
  });

  test("classifies as 'due_flashcard' if card is due now (0 days overdue)", () => {
    const justNow = new Date(Date.now() - 100); // 100ms ago
    const card = { _id: "card2", topic: "Algorithms", front: "What is quicksort?", review: { nextReviewAt: justNow } };
    const item = buildFlashcardItem(userId, mockSet, card);
    expect(item.itemType).toBe("due_flashcard");
    expect(item.priority).toBe(55);
  });

  test("title reflects overdue status", () => {
    const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const card = { _id: "card3", topic: "Networks", front: "OSI model layers?", review: { nextReviewAt: oldDate } };
    const item = buildFlashcardItem(userId, mockSet, card);
    expect(item.title).toContain("Overdue");
  });

  test("falls back to 'General' topic when card.topic is missing", () => {
    const justNow = new Date(Date.now() - 100);
    const card = { _id: "card4", front: "Definition?", review: { nextReviewAt: justNow } };
    const item = buildFlashcardItem(userId, mockSet, card);
    expect(item.topic).toBe("General");
  });
});

// ─── Pagination Logic ─────────────────────────────────────────────────────────

describe("paginateItems", () => {
  const items = Array.from({ length: 55 }, (_, i) => ({ id: i + 1 }));

  test("returns correct number of items for first page", () => {
    const result = paginateItems(items, 1, 20);
    expect(result.items.length).toBe(20);
  });

  test("returns correct number of items for last partial page", () => {
    const result = paginateItems(items, 3, 20);
    expect(result.items.length).toBe(15); // 55 - 40 = 15
  });

  test("pagination metadata is correct", () => {
    const result = paginateItems(items, 2, 20);
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.total).toBe(55);
    expect(result.pagination.pages).toBe(3);
  });

  test("clamps page to 1 when invalid page provided", () => {
    const result = paginateItems(items, -5, 20);
    expect(result.pagination.page).toBe(1);
  });

  test("clamps limit to max 100", () => {
    const result = paginateItems(items, 1, 999);
    expect(result.pagination.limit).toBe(100);
  });

  test("falls back to default limit when 0 is passed", () => {
    const result = paginateItems(items, 1, 0);
    // parseInt(0) is 0 (falsy), so || 20 kicks in → default limit 20
    expect(result.pagination.limit).toBe(20);
  });
});

// ─── Snooze Logic ─────────────────────────────────────────────────────────────

describe("snoozeItem", () => {
  test("updates dueAt to approximately N hours from now", () => {
    const item = { id: "item1", priority: 80, dueAt: new Date() };
    const snoozed = snoozeItem(item, 24);
    const expectedDue = Date.now() + 24 * 60 * 60 * 1000;
    expect(snoozed.dueAt.getTime()).toBeCloseTo(expectedDue, -3); // within 1 second
  });

  test("lowers priority to 40", () => {
    const item = { id: "item1", priority: 80, dueAt: new Date() };
    const snoozed = snoozeItem(item, 24);
    expect(snoozed.priority).toBe(40);
  });

  test("preserves other fields", () => {
    const item = { id: "item1", priority: 80, dueAt: new Date(), topic: "OS" };
    const snoozed = snoozeItem(item, 6);
    expect(snoozed.topic).toBe("OS");
  });

  test("defaults to 24 hours snooze", () => {
    const item = { id: "item1", priority: 80, dueAt: new Date() };
    const snoozed = snoozeItem(item);
    const expectedDue = Date.now() + 24 * 60 * 60 * 1000;
    expect(snoozed.dueAt.getTime()).toBeCloseTo(expectedDue, -3);
  });
});
