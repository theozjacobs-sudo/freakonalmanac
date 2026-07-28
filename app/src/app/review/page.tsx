import { Suspense } from "react";
import ReviewClient from "./ReviewClient";

export const metadata = { title: "Review — Fact Finder HQ" };

export default function ReviewPage() {
  return (
    <Suspense fallback={null}>
      <ReviewClient />
    </Suspense>
  );
}
