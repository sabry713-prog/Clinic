import "@testing-library/jest-dom/vitest";

// jsdom does not implement scrollIntoView (used by QAConversation auto-scroll).
Element.prototype.scrollIntoView = () => {};
