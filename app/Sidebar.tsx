import { Icon } from "@/app/components/Icon";
import { Tool } from "@/app/types";

export const Sidebar = ({
  tools,
  activeTool,
  setActiveTool,
}: {
  tools: Tool[];
  activeTool: string;
  setActiveTool: (str: string) => void;
}) => {
  return (
    <aside className="tool-panel">
      <div className="section-label">
        Your tools <span>{tools.length + 1}</span>
      </div>
      <nav aria-label="Image tools">
        <button
          className={activeTool === "Compress PNG" ? "tool active" : "tool"}
          onClick={() => setActiveTool("Compress PNG")}
        >
          <Icon name="compress" />
          <span>Compress PNG</span>
          <span className="tool-dot" />
        </button>
        {tools.map((tool, i) => (
          <button
            className={activeTool === tool.name ? "tool active" : "tool"}
            key={i}
            onClick={() => setActiveTool(tool.name)}
          >
            <Icon name="spark" />
            <span>{tool.name}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
};
