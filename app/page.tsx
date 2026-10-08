"use client";

import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/app/AppHeader";
import { Icon } from "@/app/components/Icon";
import { Tool } from "@/app/types";
import { MainTool } from "@/app/MainTool";
import { Sidebar } from "@/app/Sidebar";
import { Chat } from "@/app/Chat";

export default function Home() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [activeTool, setActiveTool] = useState("Compress PNG");

  return (
    <div className="app">
      <AppHeader tools={tools} />

      <div className={`workspace`}>
        <Sidebar
          setActiveTool={setActiveTool}
          activeTool={activeTool}
          tools={tools}
        />
        <MainTool activeTool={activeTool} setActiveTool={setActiveTool} />
        <Chat tools={tools} setTools={setTools} />
      </div>
    </div>
  );
}
