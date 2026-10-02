/**
 * Indexing status — the asynchronous half of an upload
 * =====================================================
 *
 * Uploading and generating a quiz is synchronous; making the material retrievable
 * is not. `INDEX_MATERIAL` chunks and embeds the text in the background, and that
 * job is what later lets the tutor answer from the material. The backend reports
 * its state truthfully, including `not_scheduled` — material and quiz committed,
 * index never built — and the client discarded that report, so a learner could
 * not distinguish an index that is building from one that will never exist.
 *
 * These tests pin one thing per status: that each renders as its own state, and
 * that no status borrows another's wording. A UI that renders all six correctly
 * but would also render a seventh unknown status as "failed" is not trustworthy,
 * so unknown and absent statuses are covered explicitly.
 *
 * Assertions are on rendered text and accessible roles rather than class names,
 * so a restyle cannot make a failure look like a success.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IndexingStatus } from "@/components/IndexingStatus";
import type { BackgroundProcessing } from "@/context/QuizContext";

const job = (over: Partial<BackgroundProcessing> = {}): BackgroundProcessing => ({
  task: "INDEX_MATERIAL",
  status: "queued",
  jobId: "6abbf2e9b01acd4afb38b214",
  ...over,
});

describe("in-flight states", () => {
  it.each([
    ["pending", /preparing your material/i, /^pending$/i],
    ["queued", /queued for indexing/i, /^queued$/i],
  ])("renders %s as its own in-flight state", (status, title, badge) => {
    render(<IndexingStatus backgroundProcessing={job({ status: status as never })} />);

    expect(screen.getByText(title)).toBeInTheDocument();
    // Anchored, because "queued" also appears in the title and detail text.
    expect(screen.getByText(badge as RegExp)).toBeInTheDocument();
    // In-flight work needs nothing from the learner, and must not imply it failed.
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not scheduled/i)).not.toBeInTheDocument();
  });

  it("tells the learner they can start the quiz while indexing runs", () => {
    render(<IndexingStatus backgroundProcessing={job({ status: "running" })} />);

    expect(screen.getByText(/indexing your material/i)).toBeInTheDocument();
    // Stating this explicitly is the difference between a progress indicator that
    // reads as a blocker and one that reads as background work.
    expect(screen.getByText(/start your quiz now/i)).toBeInTheDocument();
  });
});

describe("terminal states", () => {
  it("renders completed as ready to use", () => {
    render(<IndexingStatus backgroundProcessing={job({ status: "completed" })} />);

    expect(screen.getByText(/your material is indexed/i)).toBeInTheDocument();
    expect(screen.getByText(/tutor can now answer/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });

  it("renders failed as saved but unusable, and does not claim the material was lost", () => {
    render(<IndexingStatus backgroundProcessing={job({ status: "failed" })} />);

    expect(screen.getByText(/indexing failed/i)).toBeInTheDocument();
    // The material and quiz were committed before the job was scheduled, so a
    // failure loses the index and nothing else. Saying otherwise would make a
    // recoverable outcome look like data loss.
    expect(screen.getByText(/were saved/i)).toBeInTheDocument();
    expect(screen.getByText(/still take the quiz/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be saved|deleted|lost/i)).not.toBeInTheDocument();
  });

  it("renders not_scheduled distinctly from failed", () => {
    render(<IndexingStatus backgroundProcessing={job({ status: "not_scheduled" })} />);

    expect(screen.getByText(/indexing was not scheduled/i)).toBeInTheDocument();
    expect(screen.getByText(/never started/i)).toBeInTheDocument();
    // A failed job ran; this one never began. The remedy differs — retry rather
    // than investigate — so the two must not share wording.
    expect(screen.queryByText(/^indexing failed$/i)).not.toBeInTheDocument();
  });

  it("explains the consequence of not_scheduled in terms of the tutor", () => {
    // This is the case that motivated the work: without it, a learner whose index
    // was never built meets a tutor that refuses every question with no
    // explanation of why.
    render(<IndexingStatus backgroundProcessing={job({ status: "not_scheduled" })} />);

    expect(screen.getByText(/tutor cannot use this material/i)).toBeInTheDocument();
  });

  it("shows the backend's own message when one is present", () => {
    render(
      <IndexingStatus
        backgroundProcessing={job({
          status: "not_scheduled",
          error: { code: "QUEUE_ENQUEUE_FAILED", message: "Background work could not be scheduled." },
        })}
      />,
    );

    // More specific than anything the panel could infer, and already free of
    // queue or infrastructure detail.
    expect(screen.getByText("Background work could not be scheduled.")).toBeInTheDocument();
  });

  it("renders without a message when the backend sent none", () => {
    render(
      <IndexingStatus
        backgroundProcessing={job({ status: "failed", error: { code: null, message: null } })}
      />,
    );

    expect(screen.getByText(/indexing failed/i)).toBeInTheDocument();
  });
});

describe("states the client must not invent", () => {
  it("renders nothing when the response carried no job", () => {
    // No field means no job was tracked. That is neither success nor failure, and
    // a panel claiming either would be asserting something the response never said.
    const { container } = render(<IndexingStatus backgroundProcessing={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a status it does not recognise", () => {
    // A status the backend has not defined yet is not a reason to guess. Defaulting
    // it to a failure would raise a false alarm, and defaulting it to success
    // would hide one.
    const { container } = render(
      <IndexingStatus backgroundProcessing={job({ status: "retrying" as never })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the panel is a status, not decoration", () => {
  it("announces its state to assistive technology", () => {
    render(<IndexingStatus backgroundProcessing={job({ status: "running" })} />);

    const status = screen.getByRole("status", { name: /material indexing status/i });
    expect(status).toHaveAttribute("aria-live", "polite");
    // The state is carried by text and an icon, not by colour alone.
    expect(status).toHaveTextContent(/indexing your material/i);
  });

  it("identifies the job for a settled status so it can be looked up", () => {
    render(<IndexingStatus backgroundProcessing={job({ status: "completed" })} />);

    expect(screen.getByText(/6abbf2e9b01acd4afb38b214/)).toBeInTheDocument();
  });

  it("explains what indexing is for on every state", () => {
    render(<IndexingStatus backgroundProcessing={job({ status: "queued" })} />);

    // Repeated deliberately: it is the one line that connects an opaque job to
    // the tutor feature the learner actually came for.
    expect(screen.getByText(/lets the tutor answer from your material/i)).toBeInTheDocument();
  });
});
