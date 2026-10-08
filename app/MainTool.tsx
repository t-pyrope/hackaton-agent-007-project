import CompressPng from "@/components/image-tools/CompressPng";

export const MainTool = ({
  activeTool,
  setActiveTool,
}: {
  activeTool: string;
  setActiveTool: (val: string) => void;
}) => {
  return (
    <main className="editor">
      {activeTool === "Compress PNG" ? (
        <CompressPng />
      ) : (
        <>
          <div className="editor-heading">
            <div>
              <h2>{activeTool}</h2>
              <p>Your new tool is installed as a demo.</p>
            </div>
          </div>
          <div className="mock-notice">
            This tool uses a simulated installation. PNG compression is
            available in Compress PNG.
            <button
              className="text-button"
              onClick={() => setActiveTool("Compress PNG")}
            >
              Open Compress PNG →
            </button>
          </div>
        </>
      )}
    </main>
  );
};
