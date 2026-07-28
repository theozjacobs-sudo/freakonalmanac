import { Suspense } from "react";
import BrowseClient from "./BrowseClient";

export const metadata = { title: "Browse — Fact Finder HQ" };

export default function BrowsePage() {
  return (
    <Suspense fallback={null}>
      <BrowseClient />
    </Suspense>
  );
}
