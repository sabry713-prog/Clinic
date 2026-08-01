/**
 * ReceptionistTab tests (Sprint 10).
 *
 * The assertions that matter are the safety ones: drafts must be visibly
 * drafts, AI-written clinical text must be labelled as such, and nothing may
 * dispatch without a click.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import ReceptionistTab, { type PostCarePackage } from "./ReceptionistTab";

const PACKAGE: PostCarePackage = {
  followup_slots: [
    {
      starts_at: "2026-08-03T09:00:00Z",
      department: "Cardiology",
      appointment_type: "follow-up",
      status: "draft",
    },
  ],
  lab_prep_reminders: [
    {
      lab: "Lipid profile",
      instruction: "Do not eat or drink anything except water for 9-12 hours before this test.",
      source: "static_reference_table",
    },
  ],
  care_instructions: {
    text: "Keep taking Atorvastatin 20 mg and come back in one week.",
    requires_clinician_review: true,
  },
  dispatch_payloads: [
    {
      patient_id: "pat-1",
      channel: "whatsapp",
      kind: "care_instructions",
      body: "Keep taking Atorvastatin 20 mg and come back in one week.",
      status: "draft",
    },
  ],
};

describe("ReceptionistTab", () => {
  it("explains itself when nothing has been drafted yet", () => {
    render(<ReceptionistTab postCare={null} />);
    expect(screen.getByText(/No post-care package drafted yet/i)).toBeInTheDocument();
  });

  it("warns that nothing has been booked or sent", () => {
    render(<ReceptionistTab postCare={PACKAGE} />);
    expect(screen.getByText(/nothing below has been booked or sent/i)).toBeInTheDocument();
  });

  it("labels AI-written patient text as needing review", () => {
    render(<ReceptionistTab postCare={PACKAGE} />);
    expect(screen.getByText(/AI-drafted clinical text/i)).toBeInTheDocument();
    expect(screen.getByTestId("care-instructions")).toHaveTextContent("Atorvastatin 20 mg");
  });

  it("renders follow-up slots and lab prep from the package", () => {
    render(<ReceptionistTab postCare={PACKAGE} />);
    expect(screen.getByText("Cardiology")).toBeInTheDocument();
    expect(screen.getByText(/9-12 hours/)).toBeInTheDocument();
  });

  it("shows the channel for each outreach message", () => {
    render(<ReceptionistTab postCare={PACKAGE} />);
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
  });

  it("does not dispatch anything without a click", () => {
    const onDispatch = vi.fn().mockResolvedValue(undefined);
    render(<ReceptionistTab postCare={PACKAGE} onDispatch={onDispatch} pendingIntegration={false} />);
    expect(onDispatch).not.toHaveBeenCalled();
  });

  // ---- audit M-2: no success badge for work that never left the browser ----

  it("defaults to a Pending integration chip instead of an actionable button", () => {
    render(<ReceptionistTab postCare={PACKAGE} onDispatch={vi.fn()} onBookSlot={vi.fn()} />);
    expect(screen.getAllByTestId("pending-integration").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: /Dispatch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Book/i })).not.toBeInTheDocument();
  });

  it("never claims Dispatched or Booked while pending integration", () => {
    render(<ReceptionistTab postCare={PACKAGE} onDispatch={vi.fn()} onBookSlot={vi.fn()} />);
    expect(screen.queryByText("Dispatched")).not.toBeInTheDocument();
    expect(screen.queryByText("Booked")).not.toBeInTheDocument();
  });

  it("cannot fire a handler while pending integration", () => {
    const onDispatch = vi.fn().mockResolvedValue(undefined);
    render(<ReceptionistTab postCare={PACKAGE} onDispatch={onDispatch} />);
    fireEvent.click(screen.getAllByTestId("pending-integration")[0]!);
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("says plainly that booking and dispatch are not connected", () => {
    render(<ReceptionistTab postCare={PACKAGE} />);
    expect(screen.getByText(/not connected to a backend yet/i)).toBeInTheDocument();
  });

  it("dispatches the exact payload on click and confirms", async () => {
    const onDispatch = vi.fn().mockResolvedValue(undefined);
    render(<ReceptionistTab postCare={PACKAGE} onDispatch={onDispatch} pendingIntegration={false} />);

    fireEvent.click(screen.getByRole("button", { name: /Dispatch/i }));
    await waitFor(() =>
      expect(onDispatch).toHaveBeenCalledWith(PACKAGE.dispatch_payloads[0]),
    );
    expect(await screen.findByText("Dispatched")).toBeInTheDocument();
  });

  it("books the exact slot on click", async () => {
    const onBookSlot = vi.fn().mockResolvedValue(undefined);
    render(<ReceptionistTab postCare={PACKAGE} onBookSlot={onBookSlot} pendingIntegration={false} />);

    fireEvent.click(screen.getByRole("button", { name: /Book/i }));
    await waitFor(() => expect(onBookSlot).toHaveBeenCalledWith(PACKAGE.followup_slots[0]));
  });

  it("returns to idle so a failed dispatch can be retried", async () => {
    const onDispatch = vi.fn().mockRejectedValue(new Error("provider down"));
    render(<ReceptionistTab postCare={PACKAGE} onDispatch={onDispatch} pendingIntegration={false} />);

    const button = screen.getByRole("button", { name: /Dispatch/i });
    fireEvent.click(button);
    await waitFor(() => expect(onDispatch).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /Dispatch/i })).toBeEnabled();
    expect(screen.queryByText("Dispatched")).not.toBeInTheDocument();
  });

  it("hides action buttons entirely when no handler is supplied", () => {
    render(<ReceptionistTab postCare={PACKAGE} pendingIntegration={false} />);
    expect(screen.queryByRole("button", { name: /Dispatch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Book/i })).not.toBeInTheDocument();
  });

  it("omits sections the package has no data for", () => {
    render(
      <ReceptionistTab
        postCare={{ ...PACKAGE, lab_prep_reminders: [], care_instructions: null }}
      />,
    );
    expect(screen.queryByText(/Lab preparation/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("care-instructions")).not.toBeInTheDocument();
    // The sections that DO have data still render.
    const slots = screen.getByText("Cardiology");
    expect(within(slots.parentElement as HTMLElement).getByText("Cardiology")).toBeInTheDocument();
  });
});
