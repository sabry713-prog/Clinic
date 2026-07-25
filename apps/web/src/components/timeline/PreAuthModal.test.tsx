/**
 * PreAuthModal tests (Sprint 9).
 *
 * The load-bearing assertions are the honesty ones: the modal must show the
 * exact codes that will enter the FHIR bundle, and must not offer submission
 * when there is nothing real to submit to.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PreAuthModal, { type PreAuthFields } from "./PreAuthModal";

const FIELDS: PreAuthFields = {
  orderId: "order-3",
  encounterId: "enc-77",
  orderDisplay: "Echocardiogram, transthoracic",
  sbsCode: "11712-00-10",
  sbsDisplay: "Echocardiogram, transthoracic",
  icd10Code: "I10",
  icd10Display: "Essential (primary) hypertension",
  clinicalDocument: "S: Chest tightness on exertion.\nP: Echocardiogram.",
};

function setup(overrides: Partial<React.ComponentProps<typeof PreAuthModal>> = {}) {
  const onClose = vi.fn();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<PreAuthModal fields={FIELDS} onClose={onClose} onSubmit={onSubmit} {...overrides} />);
  return { onClose, onSubmit };
}

describe("PreAuthModal", () => {
  it("shows the codes that will be sent in the FHIR bundle", () => {
    setup();
    expect(screen.getByText(/11712-00-10/)).toBeInTheDocument();
    expect(screen.getByText(/I10/)).toBeInTheDocument();
  });

  it("shows the clinical justification that will be attached", () => {
    setup();
    expect(screen.getByTestId("clinical-justification")).toHaveTextContent("Chest tightness on exertion");
  });

  it("submits with the exact fields it displayed", async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Submit Pre-Auth to NPHIES Now/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(FIELDS));
  });

  it("shows a spinner while the submission is in flight", async () => {
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    setup({ onSubmit: vi.fn().mockReturnValue(pending) });

    fireEvent.click(screen.getByRole("button", { name: /Submit Pre-Auth to NPHIES Now/i }));
    expect(await screen.findByText("Submitting…")).toBeInTheDocument();
    release();
  });

  it("closes after a successful submission", async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Submit Pre-Auth to NPHIES Now/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("surfaces a submission failure instead of closing", async () => {
    const { onClose } = setup({
      onSubmit: vi.fn().mockRejectedValue(new Error("NPHIES engine is unreachable")),
    });
    fireEvent.click(screen.getByRole("button", { name: /Submit Pre-Auth to NPHIES Now/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("NPHIES engine is unreachable");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables submission and explains why when there is nothing to submit to", () => {
    setup({ disabledReason: "Demo mode — no patient encounter wired in." });
    expect(screen.getByRole("button", { name: /Submit Pre-Auth to NPHIES Now/i })).toBeDisabled();
    expect(screen.getByText(/Demo mode/)).toBeInTheDocument();
  });

  it("closes on cancel", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
