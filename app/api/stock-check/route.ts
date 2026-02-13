import { NextResponse } from "next/server";
import { client } from "@/sanity/lib/client";
import { PRODUCTS_BY_IDS_QUERY } from "@/sanity/queries/products";

export async function POST(req: Request) {
  try {
    const { ids } = await req.json();

    const products = await client.fetch(PRODUCTS_BY_IDS_QUERY, { ids });

    return NextResponse.json(products);
  } catch (err) {
    console.error("Sanity API crash:", err);
    return NextResponse.json({ error: "Stock fetch failed" }, { status: 500 });
  }
}

