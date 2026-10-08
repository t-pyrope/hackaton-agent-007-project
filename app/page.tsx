"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/app/AppHeader";
import { Tool } from "@/app/types";
import { MainTool } from "@/app/MainTool";
import { Sidebar } from "@/app/Sidebar";
import { Chat } from "@/app/Chat";

export default function Home() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [activeTool, setActiveTool] = useState("Compress PNG");

  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    fetch("/api/tools")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load installed tools.");
        const data = await response.json();
        setTools((current) => {
          const merged = new Map(current.map((t) => [t.id, t]));
          for (const t of data.tools as Tool[]) merged.set(t.id, t);
          return [...merged.values()];
        });
      })
      .catch(() =>
        setLoadError("Could not load installed tools. Refresh to try again."),
      );
  }, []);
  return (
    <div className="app">
      <AppHeader tools={tools} />
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}

      <div className={`workspace`}>
        <Sidebar
          setActiveTool={setActiveTool}
          activeTool={activeTool}
          tools={tools}
        />
        <MainTool activeTool={activeTool} tools={tools} />
        <Chat tools={tools} setTools={setTools} />
      </div>
    </div>
  );
}
