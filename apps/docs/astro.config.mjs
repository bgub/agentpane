import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"

export default defineConfig({
  integrations: [
    starlight({
      title: "AgentPane",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/bgub/agentpane",
        },
      ],
      sidebar: [
        { label: "Getting Started", slug: "getting-started" },
        { label: "Architecture", slug: "architecture" },
        {
          label: "Guides",
          items: [
            { label: "Multi-Pane Layout", slug: "guides/multi-pane" },
            { label: "Agents", slug: "guides/agents" },
          ],
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
})
