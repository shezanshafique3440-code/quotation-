import { NextResponse } from "next/server";
import { AppError } from "./errors";

export function jsonError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  console.error("[api] unhandled error", error);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Something went wrong." } },
    { status: 500 },
  );
}
