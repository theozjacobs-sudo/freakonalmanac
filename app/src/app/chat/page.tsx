import { Suspense } from "react";
import ChatClient from "./ChatClient";

export const metadata = { title: "Chat — Fact Finder HQ" };

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatClient />
    </Suspense>
  );
}
