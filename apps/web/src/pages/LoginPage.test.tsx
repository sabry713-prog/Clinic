import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { LoginPage } from "./LoginPage";

// Mock i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: "ar",
      changeLanguage: vi.fn().mockResolvedValue(undefined),
    },
  }),
}));

// Mock useAuth
const mockLogin = vi.fn();
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    login: mockLogin,
    loading: false,
    error: null,
    user: null,
    logout: vi.fn(),
  }),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockLogin.mockResolvedValue(undefined);
  });

  it("renders login button", () => {
    render(<LoginPage />);
    expect(screen.getByRole("button", { name: /login\.button/i })).toBeInTheDocument();
  });

  it("renders language toggle button", () => {
    render(<LoginPage />);
    expect(screen.getByRole("button", { name: /toggle language/i })).toBeInTheDocument();
  });

  it("calls login when button is clicked", async () => {
    render(<LoginPage />);
    const button = screen.getByRole("button", { name: /login\.button/i });
    fireEvent.click(button);
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("/");
    });
  });

  it("shows loading state after click", async () => {
    // Keep login pending
    mockLogin.mockReturnValue(new Promise(() => {}));
    render(<LoginPage />);
    const button = screen.getByRole("button", { name: /login\.button/i });
    fireEvent.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
  });
});
