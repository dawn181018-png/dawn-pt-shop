"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error-boundary]", error);
  }, [error]);

  return (
    <div className="min-h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-lg font-semibold">문제가 발생했어요</div>
      <div className="text-sm text-gray-500">
        예상치 못한 오류로 화면을 표시하지 못했어요. 다시 시도해주세요.
      </div>
      <button
        onClick={reset}
        className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        다시 시도
      </button>
    </div>
  );
}
