import type { Preview } from "@storybook/react";
// Tailwind + app base styles so stories render like the real app.
import "../src/styles/global.css";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: {
      default: "clinical-dark",
      values: [
        { name: "clinical-dark", value: "#020617" },
        { name: "light", value: "#ffffff" },
      ],
    },
    layout: "fullscreen",
  },
};

export default preview;
