import { NextResponse } from "next/server";

const BACKEND_URL = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

export async function proxyBackend(request: Request, backendPath: string) {
  const incomingUrl = new URL(request.url);
  const targetUrl = `${BACKEND_URL}${backendPath}${incomingUrl.search}`;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const init: RequestInit = {
    method: request.method,
    headers,
    signal: AbortSignal.timeout(15000),
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  try {
    const response = await fetch(targetUrl, init);
    const body = await response.arrayBuffer();
    const responseHeaders = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) responseHeaders.set("content-type", contentType);

    return new NextResponse(body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(`Backend proxy request failed for ${backendPath}:`, error);
    return NextResponse.json(
      {
        status: "error",
        error_code: "BACKEND_PROXY_ERROR",
        error_message: "The backend service is unavailable.",
      },
      { status: 502 },
    );
  }
}
