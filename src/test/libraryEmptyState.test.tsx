/**
 * Library — request failure is not an empty library
 * ================================================
 *
 * `Upload.tsx` used to collapse a failed `GET /library` into `materials = []`,
 * which rendered "No materials indexed yet" and offered the create/upload path.
 * Both halves of that are wrong for a learner who already has material: the page
 * asserted something it did not know, and the CTA it offered in response would
 * have led them to upload a duplicate.
 *
 * These tests pin the distinction. A failure must be a failure, must not claim
 * ownership of the learner's library, and must not offer the empty-state action;
 * a genuine empty library must still be actionable.
 *
 * Assertions use accessible role and text, so neither a restyle nor a copy edit
 * can make a wrong state look right.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/components/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/api", () => ({ apiFetch }));

import UploadPage from "@/pages/Upload";

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const material = {
  _id: "mat-1",
  title: "OS Notes",
  originalFileName: "os.pdf",
  sizeBytes: 1024 * 1024,
  tags: ["os"],
  textPreview: "Deadlocks require four conditions.",
  createdAt: "2026-01-01T00:00:00Z",
};

const renderPage = async () => {
  // A real MemoryRouter rather than a mock, so `Link` renders a genuine anchor
  // and the href assertions below check the real destination rather than a prop.
  const view = render(
    <MemoryRouter>
      <UploadPage />
    </MemoryRouter>
  );
  // The page debounces its request by 180ms, so every assertion waits it out.
  await waitFor(() => expect(apiFetch).toHaveBeenCalled());
  return view;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a failed library request", () => {
  beforeEach(() => {
    apiFetch.mockRejectedValue(new Error("network down"));
  });

  it("does not claim the learner has no materials", async () => {
    await renderPage();

    // The exact failure this task exists to prevent.
    expect(await screen.findByText(/couldn't load your library/i)).toBeTruthy();
    expect(screen.queryByText(/no materials indexed yet/i)).toBeNull();
  });

  it("does not offer the upload path", async () => {
    await renderPage();

    // Following this CTA would duplicate material the learner may already have.
    expect(screen.queryByRole("link", { name: /upload and generate/i })).toBeNull();
  });

  it("says the materials are unaffected rather than lost", async () => {
    await renderPage();

    // The page knows nothing about what the learner owns, so it must not imply
    // anything was deleted.
    expect(screen.getByRole("status").textContent).toMatch(/unaffected/i);
  });

  it("offers a retry", async () => {
    await renderPage();
    const retry = await screen.findByRole("button", { name: /try again/i });

    apiFetch.mockResolvedValue(ok({ materials: [material] }));
    fireEvent.click(retry);

    // Proves the button actually re-issues the request rather than resetting state
    // that already failed.
    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(1));
    expect(await screen.findByText("OS Notes")).toBeTruthy();
  });

  it("recovers to a normal list once the request succeeds", async () => {
    apiFetch.mockResolvedValueOnce(ok({ materials: [material] }));
    await renderPage();

    expect(await screen.findByText("OS Notes")).toBeTruthy();
    expect(screen.queryByText(/couldn't load your library/i)).toBeNull();
  });
});

describe("a genuinely empty library", () => {
  beforeEach(() => {
    apiFetch.mockResolvedValue(ok({ materials: [] }));
  });

  it("says so, because this time the page knows", async () => {
    await renderPage();

    expect(await screen.findByText(/no materials indexed yet/i)).toBeTruthy();
    expect(screen.queryByText(/couldn't load your library/i)).toBeNull();
  });

  it("offers a route to add material", async () => {
    await renderPage();

    const cta = await screen.findByRole("link", { name: /upload and generate/i });
    // Reuses the existing ingestion route. No new endpoint or page.
    expect(cta.getAttribute("href")).toBe("/assessments/create");
  });
});

describe("a populated library", () => {
  beforeEach(() => {
    apiFetch.mockResolvedValue(ok({ materials: [material] }));
  });

  it("renders the material list unchanged", async () => {
    await renderPage();

    expect(await screen.findByText("OS Notes")).toBeTruthy();
    expect(screen.getByText("os.pdf · 1.00 MB")).toBeTruthy();
  });

  it("shows neither an empty nor an error state", async () => {
    await renderPage();

    await screen.findByText("OS Notes");
    expect(screen.queryByText(/no materials indexed yet/i)).toBeNull();
    expect(screen.queryByText(/couldn't load your library/i)).toBeNull();
  });
});
