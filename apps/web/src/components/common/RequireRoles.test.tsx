/**
 * RequireRoles — client-side route role guard.
 *
 * Backend RBAC remains the enforcement point; this guard only decides
 * whether a restricted page renders at all. These tests pin the two
 * behaviors that matter: allowed roles render children, everything else
 * gets the access-denied screen (never the page, never a crash when the
 * user object is missing entirely).
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import RequireRoles, { ADMIN_ROLES } from "./RequireRoles";
import { useAuth } from "../../hooks/useAuth";

vi.mock("../../hooks/useAuth");
const mockUseAuth = vi.mocked(useAuth);

function renderGuard(roles: string[]): void {
  mockUseAuth.mockReturnValue({
    user: { id: "u1", displayName: "Test User", email: null, preferredLanguage: "en", roles },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
  });
  render(
    <MemoryRouter>
      <RequireRoles roles={ADMIN_ROLES}>
        <div data-testid="protected-content">secret</div>
      </RequireRoles>
    </MemoryRouter>,
  );
}

describe("RequireRoles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders children when the user holds one of the required roles", () => {
    renderGuard(["hospital_admin"]);
    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
  });

  it("shows the access-denied screen for a user without the role", () => {
    renderGuard(["physician"]);
    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    // the denied screen names the roles it needs, so the user knows why
    expect(screen.getByText(/hospital_admin/)).toBeInTheDocument();
  });

  it("denies safely when there is no user object", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <RequireRoles roles={ADMIN_ROLES}>
          <div data-testid="protected-content">secret</div>
        </RequireRoles>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });
});
