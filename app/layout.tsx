import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
export const metadata: Metadata = { title: "Frankenframe — Your Image Workshop", description: "Local image editing and a toolkit built around your ideas." };
export default function RootLayout({ children }: LayoutProps<"/">) { return <html lang="en" className={inter.variable}><body>{children}</body></html>; }
