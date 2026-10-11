import { NextResponse } from "next/server";

import {
  casUpdateUserBlob,
  handle,
  pickFields,
  readJsonObject,
  readUserBlob,
  requireExpectedUpdatedAt,
  validation,
} from "@/lib/tasks-api";

export const dynamic = "force-dynamic";

const present = (value: string[] | null, updatedAt: string) => ({
  categories: value ?? [],
  updated_at: updatedAt,
});

/** GET /api/categories → the ordered board columns. */
export async function GET(request: Request) {
  return handle(request, "GET /api/categories", async (api) => {
    const { value, updated_at } = await readUserBlob<string[]>(api, "categories");
    return NextResponse.json(present(value, updated_at));
  });
}

/**
 * PUT /api/categories { categories, expected_updated_at } — replaces the
 * ordered column list. Tasks are not touched: a task whose category is no
 * longer listed still shows on the board as an extra column (as in the app).
 */
export async function PUT(request: Request) {
  return handle(request, "PUT /api/categories", async (api) => {
    const body = await readJsonObject(request);
    const expected = requireExpectedUpdatedAt(body);
    pickFields(body, [], ["expected_updated_at", "categories"]);
    const list = body.categories;
    if (
      !Array.isArray(list) ||
      list.length > 100 ||
      list.some((c) => typeof c !== "string" || !c.trim() || c.length > 100) ||
      new Set(list.map((c: string) => c.trim())).size !== list.length
    ) {
      throw validation("categories must be an array (max 100) of distinct non-empty strings");
    }
    const categories = (list as string[]).map((c) => c.trim());
    const updatedAt = await casUpdateUserBlob(
      api,
      "categories",
      expected,
      categories,
      { action: "set_categories", categories },
      present
    );
    return NextResponse.json(present(categories, updatedAt));
  });
}
