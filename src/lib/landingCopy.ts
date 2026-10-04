/**
 * Every word of public-facing copy lives here rather than inside the component,
 * so it can be asserted on in tests without rendering a page. The same approach as
 * `dashboardCopy.ts`.
 *
 * Editorial rule for this file: the product already renders truthful empty states
 * and real achievements (see `Profile.tsx`, where nothing is claimed until it is
 * earned). The public face has to hold the same line. Each claim below is mapped
 * to a route that exists in `backend/routes` or a value read from the database —
 * if you cannot point at the backing code, it does not belong in this file.
 */

export type Stage = {
  step: number;
  title: string;
  /** Which real endpoint or surface makes this stage true. */
  backing: string;
  body: string;
};

/** The spine of the product: material becomes mastery through five stages. */
export const LEARNING_LOOP: Stage[] = [
  {
    step: 1,
    title: "Upload your material",
    backing: "library · background jobs",
    body: "Drop in a PDF. The text is extracted, chunked and indexed into your own library, so the next stage is working from your own syllabus rather than a generic question bank.",
  },
  {
    step: 2,
    title: "Generate an assessment",
    backing: "quiz generation · Groq",
    body: "Athenaeum writes exam-style multiple-choice questions grounded in the material you uploaded, each with an explanation. Generation runs in the background, so a long document does not block your browser.",
  },
  {
    step: 3,
    title: "Attempt it honestly",
    backing: "quiz attempts",
    body: "Answer under the same conditions as the real thing. Every attempt is stored with your topic-level responses, which is what makes the next stage a measurement instead of a guess.",
  },
  {
    step: 4,
    title: "See real mastery",
    backing: "analytics · topic mastery",
    body: "Accuracy trends, weak topics and per-topic mastery are computed from your stored attempts. Nothing here is inferred or flattering — an empty dashboard says so rather than inventing a score.",
  },
  {
    step: 5,
    title: "Revise what failed",
    backing: "flashcards · review queue · recommendations",
    body: "The topics you actually got wrong drive a spaced review queue and a flashcard pass, so revision is scheduled by your mistakes instead of your intentions.",
  },
];

export type Capability = {
  icon: string;
  title: string;
  body: string;
};

export const CAPABILITIES: Capability[] = [
  {
    icon: "Library",
    title: "A library that persists",
    body: "Uploaded material is stored against your account and reused. Re-upload a corrected file and the old copy is superseded rather than silently duplicated.",
  },
  {
    icon: "Brain",
    title: "Tutor with retrieval",
    body: "Ask a question and the tutor pulls the relevant passages out of your own material before answering, instead of answering from memory alone.",
  },
  {
    icon: "BarChart3",
    title: "Analytics from real attempts",
    body: "Trends and weak topics come from attempts recorded in the database. No demo data, no seeded scores, no invented streaks.",
  },
  {
    icon: "CalendarCheck",
    title: "Scheduled revision",
    body: "A review queue and flashcard pass are built from your incorrect answers, so the workload reflects what you have not yet proved you know.",
  },
  {
    icon: "Trophy",
    title: "Achievements you can audit",
    body: "Badges unlock from recorded events — your first completed assessment, a genuine three-day streak — and are marked earned the moment they qualify.",
  },
  {
    icon: "Layers",
    title: "Light and dark, honestly",
    body: "One visual system across every surface, with both themes treated as first-class rather than an inverted afterthought.",
  },
];

export type StackItem = {
  label: string;
  value: string;
  why: string;
};

export const STACK: StackItem[] = [
  {
    label: "Generation",
    value: "Groq",
    why: "Fast inference on a free tier. The model is configured by environment variable, so it can be swapped without a code change.",
  },
  {
    label: "Data",
    value: "MongoDB Atlas M0",
    why: "Documents fit the shape of material, chunks and attempts. Transactions are supported on the free tier and are used for score writes.",
  },
  {
    label: "Jobs",
    value: "BullMQ on Redis",
    why: "Indexing and generation run as queued jobs, so a slow document never blocks the request that started it.",
  },
  {
    label: "Serving",
    value: "Static frontend + Node API",
    why: "The static site is cached at the edge; the API runs as one process that serves requests and drains its own queue.",
  },
];

/**
 * Verification counts, as of the commit that introduced this file.
 * These drift as the suite grows — update them in the same commit that changes
 * the numbers, which `landingPage.test.tsx` is written to nudge you about.
 */
export const PROOF = {
  backendUnit: 942,
  backendIntegration: 101,
  frontend: 374,
  endToEnd: 26,
};

export type Boundary = { does: string; doesNot: string };

/**
 * The section that keeps the marketing honest. Modelled on the same discipline as
 * the Profile page: state the limit explicitly rather than letting a visitor
 * infer a stronger claim than the product supports.
 */
export const AI_BOUNDARY: Boundary[] = [
  {
    does: "Write questions and explanations grounded in the text you uploaded.",
    doesNot: "Grade your understanding. Your score is the stored record of what you actually selected.",
  },
  {
    does: "Retrieve relevant passages from your library to ground a tutor answer.",
    doesNot: "Pretend to know your course. It answers from your material, and says so when it has nothing.",
  },
  {
    does: "Compute topic mastery and weak areas from your recorded attempts.",
    doesNot: "Predict your grade. No model is trained on your history, and none is implied.",
  },
  {
    does: "Unlock achievements from real events, such as a completed first assessment.",
    doesNot: "Infer skills or award badges it cannot point to an event for.",
  },
];

/** The surfaces a signed-in member actually uses, named as the sidebar names them. */
export const WORKSPACE_SURFACES = [
  { name: "Library", purpose: "Your uploaded material and its indexing state" },
  { name: "Assessments", purpose: "Generate, attempt and review question sets" },
  { name: "Practice", purpose: "Flashcards built from what you got wrong" },
  { name: "Review", purpose: "Today's scheduled queue" },
  { name: "Analytics", purpose: "Accuracy, weak topics and mastery" },
  { name: "Tutor", purpose: "Ask questions against your own material" },
];

export type Faq = { question: string; answer: string };

export const FAQ: Faq[] = [
  {
    question: "Do I need to upload anything before it works?",
    answer: "Yes. Generation and the tutor are grounded in material you upload, so the library is the starting point rather than an optional extra.",
  },
  {
    question: "Which model writes the questions?",
    answer: "A Groq-hosted open model, selected by environment variable. The specific model is not baked into the interface, so it can be changed without shipping a new build.",
  },
  {
    question: "Is this free to run?",
    answer: "The whole stack is arranged to run on free tiers: static hosting, one API process that also drains its job queue, a managed Redis, a free MongoDB cluster and Groq's free tier. There is no paid dependency.",
  },
  {
    question: "What happens to my uploaded material?",
    answer: "It is stored against your account and used to generate assessments and ground tutor answers. Removing it from the library removes it.",
  },
  {
    question: "Do the achievements mean anything?",
    answer: "They unlock from recorded events. If you have not earned one, the page shows what would unlock it instead of displaying it as though you had.",
  },
];
