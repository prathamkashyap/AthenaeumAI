/**
 * The fabricated Question Bank surface is gone
 * ============================================
 *
 * `src/pages/Quiz.tsx` was a design mockup: one hardcoded operating-systems
 * question, no network calls at all, and two buttons with no `onClick`. It was
 * routed at both `/question-bank` and the legacy `/quiz` alias, and the sidebar
 * advertised it as "Question Bank" — so a reviewer clicking a visible navigation
 * item landed on a page that looked like a working feature and was not. The real
 * quiz flow lives at `/assessments/:id` and never linked to it.
 *
 * Nothing replaces it. The point of removing it is that the product only exposes
 * functionality that exists, so these tests pin the absence rather than a
 * substitute:
 *
 *   - neither path resolves to fabricated content any more;
 *   - both fall through to the real NotFound page, so a stale bookmark is honest
 *     rather than silently serving a mock;
 *   - no navigation entry advertises either path;
 *   - the mock module itself is gone, so it cannot be reintroduced by a leftover
 *     import and re-routed by accident.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Outlet } from "react-router-dom";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api", () => ({ apiFetch }));

// The router is exercised through the real `App`, so the three providers that
// would otherwise demand a session, a database, or a queue are reduced to their
// children. The route table itself is the real one, which is the thing under test.
vi.mock("@/context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/context/QuizContext", () => ({
  QuizProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ProtectedRoute", () => ({
  ProtectedRoute: () => <Outlet />,
}));


// The sidebar's own primitives are reduced to passthroughs so the test asserts on
// the navigation entries themselves rather than on sidebar layout behaviour.
vi.mock("@/components/ui/sidebar", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Sidebar: passthrough,
    SidebarContent: passthrough,
    SidebarGroup: passthrough,
    SidebarGroupContent: passthrough,
    SidebarGroupLabel: passthrough,
    SidebarMenu: passthrough,
    SidebarMenuButton: passthrough,
    SidebarMenuItem: passthrough,
    SidebarHeader: passthrough,
    useSidebar: () => ({ state: "expanded" }),
  };
});

import App from "@/App";
import { AppSidebar } from "@/components/AppSidebar";

// Resolved from the repository root, which is where vitest runs.
const mockPagePath = resolve(process.cwd(), "src/pages/Quiz.tsx");

const visit = async (path: string) => {
  window.history.pushState({}, "", path);
  render(<App />);
  return screen.findByText(/page not found/i);
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe("the fabricated Question Bank surface", () => {
  it("no longer exists as a module", () => {
    // Asserted at the filesystem rather than by import, because a missing module
    // is precisely what a stale import would have to survive.
    expect(existsSync(mockPagePath)).toBe(false);
  });

  it.each(["/question-bank", "/quiz"])("resolves %s to the real NotFound page", async (path) => {
    expect(await visit(path)).toBeTruthy();
    // The distinguishing detail: a genuine 404, not a page styled to look real.
    expect(screen.getByText("404")).toBeTruthy();
  });

  it("keeps the real quiz flow routable", async () => {
    // The routes that replaced it must not have been collaterally removed.
    window.history.pushState({}, "", "/assessments/quiz-1");
    render(<App />);
    // The assessment page is lazy and needs the provider stack, so the assertion
    // is that it does not fall through to NotFound.
    await vi.waitFor(() => {
      expect(screen.queryByText(/page not found/i)).toBeNull();
    });
  });

  it("is not advertised anywhere in the sidebar", () => {
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Question Bank")).toBeNull();
    const dead = screen
      .queryAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .filter((href) => href === "/question-bank" || href === "/quiz");
    expect(dead).toEqual([]);
  });

  it("still offers the real study surfaces", () => {
    render(
      <MemoryRouter>
        <AppSidebar />
      </MemoryRouter>,
    );

    // Removing one entry must not have emptied the navigation.
    for (const label of ["Dashboard", "Library", "Assessments", "Practice", "AI Tutor"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});